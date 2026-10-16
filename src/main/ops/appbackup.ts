import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { isRooted } from '@shared/root'
import type { AppBackupManifest, OperationResult } from '@shared/types'
import { getProps, rootStatus } from '../device'
import { exec, tools } from '../exec'
import { adb, OpError, REMOTE_DIR, requireSystem, shq, type OpContext } from './common'
import { installApps } from './install'
import { outputDir, workDir } from './root'

const stamp = (): string => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

/** 应用数据所在的两个目录：凭据加密（解锁后才能读）和设备加密（开机就能读，闹钟等应用用） */
const DATA_ROOTS: { file: string; root: string }[] = [
  { file: 'data.tgz', root: '/data/data' },
  { file: 'data_de.tgz', root: '/data/user_de/0' }
]

/** 缓存不备份；lib 在老系统上是指向 /data/app 的链接，也不备份。恢复时这几项原样保留 */
const SKIP_DIRS = ['cache', 'code_cache', 'lib']

/** `pm path` 的输出：每行 package:<APK 路径>，有分包时多行 */
export function parsePmPath(out: string): string[] {
  return [...out.matchAll(/^package:(\/\S+\.apk)\s*$/gm)].map((m) => m[1])
}

/** 从 `dumpsys package <包名>` 里取版本 */
export function parseVersion(dumpsys: string): { versionName?: string; versionCode?: string } {
  return {
    versionName: dumpsys.match(/^\s*versionName=(\S+)/m)?.[1],
    versionCode: dumpsys.match(/^\s*versionCode=(\d+)/m)?.[1]
  }
}

/** 用作 Windows 文件夹名 */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 60) || 'app'
}

/**
 * 恢复前检查数据压缩包（`tar -tzf` 的输出）：每一项都必须在 <包名>/ 下、不含 ..，
 * 防止拿别人的压缩包以 Root 身份把文件解到别的应用或系统目录里
 */
export function checkArchive(list: string, pkg: string): boolean {
  const entries = list.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  return entries.length > 0 && entries.every((e) => (e === pkg || e === `${pkg}/` || e.startsWith(`${pkg}/`)) && !e.split('/').includes('..'))
}

/** 在 su 里跑脚本。拿到 Root 时脚本自己输出的标记才会出现；timeout 防止没人点授权时一直挂着 */
const su = (serial: string, script: string, ctx: OpContext, timeoutSec: number) =>
  adb(serial, ['shell', `timeout ${timeoutSec} su -c ${shq(script)} 2>&1`], ctx, (timeoutSec + 15) * 1000)

async function requireRoot(serial: string, ctx: OpContext): Promise<void> {
  const root = await rootStatus(serial, ctx.signal)
  if (!isRooted(root)) throw new OpError(`备份和恢复应用数据需要 Root，这台手机当前是「${root ?? '未知'}」。不勾选「同时备份数据」可以只备份安装包`)
}

/**
 * 备份一个应用到「文档\一加工具箱\应用备份\<应用名>_<版本>_<时间>\」：
 * 安装包从 `pm path` 拉回（有分包时打成 .apks，能直接用「安装应用」装回去）；
 * withData 时用 su 把 /data/data 和 /data/user_de 下的应用目录打成 tgz（不含缓存）
 */
export async function backupApp(pkg: string, label: string, withData: boolean, ctx: OpContext): Promise<OperationResult> {
  if (!/^[\w.]+$/.test(pkg)) throw new OpError('包名不合法')
  const serial = await requireSystem(ctx)
  if (withData) await requireRoot(serial, ctx)

  ctx.step(`正在读取 ${label} 的安装包位置`)
  const paths = parsePmPath((await adb(serial, ['shell', 'pm', 'path', pkg], ctx, 15_000)).stdout)
  if (paths.length === 0) throw new OpError(`手机上没有安装 ${pkg}`)
  const version = parseVersion((await adb(serial, ['shell', 'dumpsys', 'package', pkg], ctx, 30_000, false)).stdout)

  const tmp = workDir()
  const apkDir = join(tmp, 'apk')
  mkdirSync(apkDir)
  for (const [i, p] of paths.entries()) {
    ctx.step(`正在拉取安装包（${i + 1}/${paths.length}）`)
    const r = await adb(serial, ['pull', p, join(apkDir, basename(p))], ctx, 600_000)
    if (r.code !== 0) throw new OpError(`拉取 ${basename(p)} 失败，详见日志`)
  }
  let apk = 'app.apk'
  if (paths.length > 1) {
    apk = 'app.apks'
    const z = await exec(tools.sevenZip, ['a', '-tzip', '-mx=1', join(tmp, apk), join(apkDir, '*')], { signal: ctx.signal, timeoutMs: 600_000 })
    if (z.code !== 0) throw new OpError('打包分包失败，详见日志')
  } else copyFileSync(join(apkDir, basename(paths[0])), join(tmp, apk))

  const data: string[] = []
  if (withData) {
    await adb(serial, ['shell', 'mkdir', '-p', REMOTE_DIR], ctx)
    ctx.step(`正在停止 ${label}，避免备份到写了一半的数据`)
    await adb(serial, ['shell', 'am', 'force-stop', pkg], ctx)
    for (const { file, root } of DATA_ROOTS) {
      ctx.step(`正在打包 ${root}/${pkg}，手机上弹出 Root 授权时请点允许`)
      const remote = `${REMOTE_DIR}/${file}`
      const excludes = SKIP_DIRS.map((d) => `--exclude=${pkg}/${d}`).join(' ')
      const r = await su(
        serial,
        `[ -d ${root}/${pkg} ] || { echo NO_DIR; exit 0; }; cd ${root} && tar -czf ${remote} ${excludes} ${pkg} && chmod 644 ${remote} && echo TAR_OK`,
        ctx,
        1800
      )
      if (r.stdout.includes('NO_DIR')) continue
      if (!r.stdout.includes('TAR_OK'))
        throw new OpError(r.stdout.includes('tar') ? `打包 ${root}/${pkg} 失败，详见日志` : '没有拿到 Root 授权。请在 Root 管理器里允许 Shell 的超级用户权限后再试')
      const pulled = await adb(serial, ['pull', remote, join(tmp, file)], ctx, 1_800_000)
      await adb(serial, ['shell', 'rm', '-f', remote], ctx)
      if (pulled.code !== 0) throw new OpError(`拉取 ${file} 失败，详见日志`)
      data.push(file)
    }
    if (data.length === 0) ctx.log('warn', '这个应用没有数据目录，只备份了安装包')
  }

  const props = await getProps(serial, ctx.signal)
  const manifest: AppBackupManifest = { package: pkg, label, ...version, apk, data, time: Date.now(), model: props['ro.product.model'] }
  const dir = join(outputDir(), '应用备份', `${safeName(label)}_${safeName(version.versionName ?? 'unknown')}_${stamp()}`)
  mkdirSync(dir, { recursive: true })
  for (const f of [apk, ...data]) copyFileSync(join(tmp, f), join(dir, f))
  writeFileSync(join(dir, 'backup.json'), JSON.stringify(manifest, null, 2))
  return {
    ok: true,
    message: `已备份 ${label}${version.versionName ? ` ${version.versionName}` : ''}${data.length ? '（含应用数据）' : '（只有安装包）'}`,
    outputPath: dir
  }
}

function readManifest(dir: string): AppBackupManifest {
  let m: AppBackupManifest
  try {
    m = JSON.parse(readFileSync(join(dir, 'backup.json'), 'utf8'))
  } catch {
    throw new OpError('这个文件夹里没有 backup.json，请选择工具箱备份出来的应用文件夹')
  }
  if (typeof m.package !== 'string' || !/^[\w.]+$/.test(m.package)) throw new OpError('backup.json 里的包名不合法')
  if (!['app.apk', 'app.apks'].includes(m.apk) || !existsSync(join(dir, m.apk))) throw new OpError('备份文件夹里缺少安装包')
  m.data = (Array.isArray(m.data) ? m.data : []).filter((f) => DATA_ROOTS.some((d) => d.file === f) && existsSync(join(dir, f)))
  return m
}

/**
 * 从备份文件夹恢复：先装安装包，备份里有数据、手机也已 Root 时，再把数据解回去，
 * 并把属主改成新装应用的 uid、恢复 SELinux 标签（换了手机或重装后 uid 会变）
 */
export async function restoreApp(dir: string, ctx: OpContext): Promise<OperationResult> {
  const m = readManifest(dir)
  const name = `${m.label}${m.versionName ? ` ${m.versionName}` : ''}`
  const serial = await requireSystem(ctx)
  const rooted = m.data.length > 0 && isRooted(await rootStatus(serial, ctx.signal))

  const installed = await installApps([join(dir, m.apk)], ctx)
  if (!installed.ok) throw new OpError(`安装 ${name} 失败。手机上已有的版本更新、或签名不同时都装不上，可以先卸载手机上的再恢复`)
  if (m.data.length === 0) return { ok: true, message: `已安装 ${name}（备份里没有应用数据）` }
  if (!rooted) return { ok: true, message: `已安装 ${name}。手机没有 Root，应用数据没有恢复` }

  await adb(serial, ['shell', 'mkdir', '-p', REMOTE_DIR], ctx)
  ctx.step(`正在停止 ${m.label}`)
  await adb(serial, ['shell', 'am', 'force-stop', m.package], ctx)
  const keep = SKIP_DIRS.map((d) => `! -name ${d}`).join(' ')
  for (const { file, root } of DATA_ROOTS.filter((d) => m.data.includes(d.file))) {
    ctx.step(`正在恢复 ${root}/${m.package}`)
    const remote = `${REMOTE_DIR}/${file}`
    const pushed = await adb(serial, ['push', join(dir, file), remote], ctx, 1_800_000)
    if (pushed.code !== 0) throw new OpError(`推送 ${file} 失败，详见日志`)
    const list = await adb(serial, ['shell', 'tar', '-tzf', remote], ctx, 300_000, false)
    if (list.code !== 0 || !checkArchive(list.stdout, m.package)) {
      await adb(serial, ['shell', 'rm', '-f', remote], ctx)
      throw new OpError(`${file} 里有不属于 ${m.package} 的文件，为了安全已停止`)
    }
    // 先清掉现有数据（缓存和 lib 保留），解压后属主改成这台手机上新装应用的 uid
    const d = `${root}/${m.package}`
    const r = await su(
      serial,
      [
        `[ -d ${d} ] || { echo NO_DIR; exit 0; }`,
        `U=$(stat -c %u ${d})`,
        `find ${d} -mindepth 1 -maxdepth 1 ${keep} -exec rm -rf {} +`,
        `tar -xzf ${remote} -C ${root} || exit 1`,
        `chown -R $U:$U ${d}`,
        `restorecon -RF ${d}`,
        'echo RESTORE_OK'
      ].join('\n'),
      ctx,
      1800
    )
    await adb(serial, ['shell', 'rm', '-f', remote], ctx)
    if (r.stdout.includes('NO_DIR')) {
      ctx.log('warn', `手机上没有 ${d}，跳过`)
      continue
    }
    if (!r.stdout.includes('RESTORE_OK'))
      throw new OpError(r.stdout.includes('tar') ? `恢复 ${file} 失败，详见日志` : '没有拿到 Root 授权，应用已安装但数据没有恢复')
  }
  return { ok: true, message: `已恢复 ${name} 和它的数据。换了手机时，部分应用的登录状态可能失效，需要重新登录` }
}
