import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { FAMILY_LABEL, KNOWN_MANAGERS } from '@shared/catalog'
import type { FlashRecord, OperationResult, RootFamily, RootOptions, RootScheme } from '@shared/types'
import { findScheme } from '../catalog'
import { getProps, getvar, isUnlocked } from '../device'
import { downloadVerified, sha256File } from '../download'
import { exec, tools } from '../exec'
import { addFlash, backupImage, updateFlash } from '../history'
import { adb, ensureFastboot, fastboot, OpError, REMOTE_DIR, requireSystem, type OpContext } from './common'
import { patchScript } from './patch-script'

type Partition = 'boot' | 'init_boot'

// ───────────── 工作目录 ─────────────

export function workDir(): string {
  const dir = join(app.getPath('temp'), 'oneplus-toolbox', 'work')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  return dir
}

export function outputDir(): string {
  const dir = join(app.getPath('documents'), '一加工具箱')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 在目录中递归查找指定文件名 */
export function findFile(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) {
      const sub = findFile(p, name)
      if (sub) return sub
    } else if (entry.name === name && statSync(p).size > 0) return p
  }
  return undefined
}

// ───────────── 从 ROM 提取镜像 ─────────────

/**
 * 读取 payload 元数据中的 max_timestamp。它就是目标系统的构建时间，
 * 与 OTA 包 META-INF/com/android/metadata 里的 post-timestamp、手机上的 ro.build.date.utc 相同。
 * 不是标准 OTA 包时返回 undefined。
 */
async function payloadTimestamp(rom: string, dir: string, ctx: OpContext): Promise<string | undefined> {
  const metaDir = join(dir, 'metadata')
  const r = await exec(tools.payloadDumper, [rom, '--metadata', '-o', metaDir], {
    signal: ctx.signal,
    log: ctx.log,
    echoOutput: false,
    timeoutMs: 300_000
  })
  const file = join(metaDir, 'metadata.json')
  if (r.code !== 0 || !existsSync(file)) return undefined
  try {
    const ts = JSON.parse(readFileSync(file, 'utf8')).max_timestamp
    return ts ? String(ts) : undefined
  } catch {
    return undefined
  }
}

/**
 * 从 ROM 中取出指定分区的镜像（默认 boot.img / init_boot.img）。
 * 1. 标准 OTA（payload.bin，本地 zip 或 URL）：先比对 ROM 的构建时间与手机 ro.build.date.utc，不一致则拒绝
 * 2. 镜像直接放在 zip 根目录（线刷包）：用 7-Zip 提取，无法校验版本，只给警告
 *
 * allowUnknown：读不到手机版本时（例如卡开机只能进 Fastboot）只给警告、不拒绝。版本明确不一致时始终拒绝
 */
export async function extractImages(
  rom: string,
  deviceTimestamp: string | undefined,
  dir: string,
  ctx: OpContext,
  allowUnknown = false,
  partitions: string[] = ['boot', 'init_boot']
): Promise<void> {
  if (!partitions.every((p) => /^[a-z_]+$/.test(p))) throw new OpError('分区名不合法')
  const names = partitions.join(' / ')
  const isUrl = /^https?:\/\//i.test(rom)
  ctx.step(isUrl ? '正在从链接读取 ROM 信息（只读取需要的部分）' : '正在读取 ROM 信息')
  const romTs = await payloadTimestamp(rom, dir, ctx)
  if (romTs) {
    ctx.log('info', `ROM 构建时间 = ${romTs}，手机 ro.build.date.utc = ${deviceTimestamp ?? '未知'}`)
    if (!deviceTimestamp) {
      if (!allowUnknown) throw new OpError('无法读取手机的系统版本信息，可能是连接不稳定')
      ctx.log('warn', '读不到手机的系统版本，无法校验 ROM 是否一致，按你的选择继续')
    } else if (romTs !== deviceTimestamp)
      throw new OpError('ROM 与手机当前系统版本不一致，继续操作可能导致无法开机。为了安全，已停止操作')
    else ctx.log('ok', 'ROM 与手机系统版本一致')
    ctx.step(isUrl ? `正在从链接提取镜像（只下载 ${names} 所需的数据）` : '正在从 payload 中提取镜像')
    const r = await exec(tools.payloadDumper, [rom, '-i', partitions.join(','), '-o', dir, '-q'], {
      signal: ctx.signal,
      log: ctx.log,
      timeoutMs: 1_800_000
    })
    if (r.code !== 0) throw new OpError('从 ROM 中提取镜像失败，详见日志')
    return
  }

  if (isUrl) throw new OpError('无法从这个链接读取 ROM。链接需要直接指向完整的 OTA 包（.zip），并且服务器支持分段下载')

  ctx.step('正在用 7-Zip 查找镜像')
  const list = await exec(tools.sevenZip, ['l', rom], { signal: ctx.signal, echoOutput: false, timeoutMs: 120_000 })
  if (!new RegExp(String.raw`\s(${partitions.join('|')})\.img\r?$`, 'm').test(list.stdout))
    throw new OpError(`这个文件既不是标准 OTA 包，也没有在根目录找到 ${partitions.map((p) => `${p}.img`).join(' / ')}，请确认选择的是完整的全量包`)
  await exec(tools.sevenZip, ['x', rom, ...partitions.map((p) => `${p}.img`), `-o${dir}`, '-y'], {
    signal: ctx.signal,
    log: ctx.log,
    timeoutMs: 600_000
  })
  ctx.log('warn', '此 ROM 不含版本元数据，无法自动校验是否与手机系统一致，请自行确认')
}

// ───────────── 方案与 APK ─────────────

interface ResolvedScheme {
  name: string
  family: RootFamily
  package?: string
  apk: string
}

async function resolveScheme(opts: RootOptions, ctx: OpContext): Promise<ResolvedScheme> {
  if (opts.schemeId === 'custom') {
    if (!opts.customApk || !existsSync(opts.customApk)) throw new OpError('请选择要使用的 APK 文件')
    if (!opts.customFamily) throw new OpError('请选择 APK 对应的修补方式')
    ctx.log('warn', '使用自定义 APK：无法校验来源，请确认文件来自项目官方发布页')
    return { name: `自定义（${FAMILY_LABEL[opts.customFamily]}）`, family: opts.customFamily, apk: opts.customApk }
  }
  const scheme: RootScheme | undefined = await findScheme(opts.schemeId)
  if (!scheme) throw new OpError('找不到所选的 Root 方案，请刷新方案列表')
  if (scheme.apk.bundled) return { name: scheme.name, family: scheme.family, package: scheme.package, apk: tools.magiskApk }
  if (!scheme.apk.url || !scheme.apk.sha256) throw new OpError(`${scheme.name} 缺少下载地址或校验值`)
  const apk = await downloadVerified(scheme.apk.url, scheme.apk.sha256, {
    signal: ctx.signal,
    log: ctx.log,
    step: ctx.step,
    label: `${scheme.name} ${scheme.version}`
  })
  return { name: scheme.name, family: scheme.family, package: scheme.package, apk }
}

/** APatch 超级密钥：至少 8 位，同时包含字母和数字；限制字符集，避免拼进 shell 时出问题 */
export function validateSuperkey(key: string | undefined): string | undefined {
  if (!key) return '请设置超级密钥'
  if (key.length < 8) return '超级密钥至少 8 位'
  if (!/[a-zA-Z]/.test(key) || !/\d/.test(key)) return '超级密钥必须同时包含字母和数字'
  if (!/^[A-Za-z0-9_.@#%+=-]+$/.test(key)) return '超级密钥只能包含字母、数字和 _ . @ # % + = -'
  return undefined
}

const AFTER_ROOT: Record<RootFamily, string> = {
  magisk: '开机后打开 Magisk App，按提示完成「额外的设置」即可',
  apatch: '开机后打开 APatch，输入刚才设置的超级密钥完成激活',
  ksu: '开机后打开 KernelSU 管理器，确认显示「工作中」即可'
}

// ───────────── 主流程 ─────────────

export async function root(opts: RootOptions, ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)

  ctx.step('正在读取手机信息')
  const props = await getProps(serial, ctx.signal)
  const abi = props['ro.product.cpu.abi'] ?? ''
  if (!abi.includes('arm64')) throw new OpError(`当前仅支持 arm64 设备（检测到 ${abi || '未知架构'}）`)
  const echo = await adb(serial, ['shell', 'echo', 'hello'], ctx)
  if (!echo.stdout.includes('hello')) throw new OpError('adb shell 连接失败，可能连接不稳定')

  const scheme = await resolveScheme(opts, ctx)
  if (scheme.family === 'apatch') {
    const err = validateSuperkey(opts.superkey)
    if (err) throw new OpError(err)
  }
  ctx.log('ok', `Root 方案：${scheme.name}（${FAMILY_LABEL[scheme.family]}）`)

  const dir = workDir()
  await extractImages(opts.rom.trim(), props['ro.build.date.utc'], dir, ctx)
  const images: Record<Partition, string | undefined> = {
    boot: findFile(dir, 'boot.img'),
    init_boot: findFile(dir, 'init_boot.img')
  }
  ctx.log('info', `提取结果：boot.img ${images.boot ? '✓' : '✗'}  init_boot.img ${images.init_boot ? '✓' : '✗'}`)

  // APatch 修补内核，只能用 boot；其它方式在 Android 13 及以后出厂的机型上修补 init_boot
  let partition: Partition
  if (scheme.family === 'apatch') {
    if (opts.target === 'init_boot') throw new OpError('APatch 只能修补 boot.img')
    partition = 'boot'
  } else partition = opts.target === 'auto' ? (images.init_boot ? 'init_boot' : 'boot') : opts.target
  const source = images[partition]
  if (!source) throw new OpError(`未能从 ROM 中提取出 ${partition}.img，请确认选择的是完整的全量包`)
  ctx.log('ok', `将修补 ${partition}.img`)

  ctx.step(`正在手机上修补 ${partition}.img`)
  await adb(serial, ['shell', 'rm', '-rf', REMOTE_DIR], ctx)
  await adb(serial, ['shell', 'mkdir', '-p', REMOTE_DIR], ctx)
  const pushApk = await adb(serial, ['push', scheme.apk, `${REMOTE_DIR}/root.apk`], ctx, 300_000)
  const pushImg = await adb(serial, ['push', source, `${REMOTE_DIR}/${partition}.img`], ctx, 300_000)
  if (pushApk.code !== 0 || pushImg.code !== 0) throw new OpError('推送文件到手机失败')
  const scriptPath = join(dir, 'patch.sh')
  writeFileSync(scriptPath, patchScript(scheme.family, `${partition}.img`, opts.superkey))
  await adb(serial, ['push', scriptPath, `${REMOTE_DIR}/patch.sh`], ctx)
  const patch = await adb(serial, ['shell', 'sh', `${REMOTE_DIR}/patch.sh`], ctx, 600_000)
  if (!patch.stdout.includes('PATCH_OK')) {
    await adb(serial, ['shell', 'rm', '-rf', REMOTE_DIR], ctx)
    throw new OpError(`${partition}.img 修补失败，详见日志`)
  }

  const patched = join(dir, `patched_${partition}.img`)
  await adb(serial, ['pull', `${REMOTE_DIR}/out.img`, patched], ctx, 300_000)
  await adb(serial, ['shell', 'rm', '-rf', REMOTE_DIR], ctx)
  if (!existsSync(patched) || statSync(patched).size === 0) throw new OpError('从手机取回修补后的镜像失败')

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const tag = scheme.name.replace(/[^\w.-]+/g, '_')
  const saved = join(outputDir(), `${tag}_patched_${partition}_${props['ro.product.device'] ?? 'device'}_${stamp}.img`)
  copyFileSync(patched, saved)
  ctx.log('ok', `修补后的镜像已保存：${saved}`)

  if (opts.patchOnly)
    return { ok: true, message: `修补完成，镜像已保存。可手动执行 fastboot flash ${partition} 刷入`, outputPath: saved }

  if (opts.uninstallOthers) {
    ctx.step('正在卸载其它 Root 管理器')
    for (const pkg of KNOWN_MANAGERS.filter((p) => p !== scheme.package)) {
      const r = await adb(serial, ['shell', 'pm', 'uninstall', pkg], ctx, 30_000, false)
      if (r.stdout.includes('Success')) ctx.log('info', `已卸载 ${pkg}`)
    }
  }

  ctx.step(`正在安装 ${scheme.name} 管理器，请留意手机上的安装提示`)
  const install = await adb(serial, ['install', '-r', scheme.apk], ctx, 180_000)
  if (install.code === 0 && install.all.includes('Success')) ctx.log('ok', '管理器 App 已安装')
  else ctx.log('warn', '管理器 App 安装未确认，Root 完成后可手动安装')

  const fbSerial = await ensureFastboot(ctx)
  ctx.step('正在检测 Bootloader 解锁状态')
  if ((await isUnlocked(fbSerial, ctx.signal)) !== true) {
    await fastboot(fbSerial, ['reboot'], ctx)
    throw new OpError('Bootloader 未解锁，无法刷入。请先完成解锁（修补后的镜像已保存，可稍后手动刷入）')
  }

  // 原厂的另一个分区一并刷回，清除之前装过的其它 Root
  const other: Partition = partition === 'boot' ? 'init_boot' : 'boot'
  const withOther = opts.flashOther && !!images[other]

  // 刷之前记下操作，并把要覆盖的分区的原厂镜像备份好，卡开机时可以一键撤销
  ctx.step('正在备份原厂镜像')
  const build = { buildId: props['ro.build.display.id'], romVersion: props['ro.build.version.oplusrom'], buildDateUtc: props['ro.build.date.utc'] }
  const backups: FlashRecord['backups'] = {}
  for (const p of withOther ? [partition, other] : [partition]) backups[p] = await backupImage(fbSerial, build.buildDateUtc, p, images[p]!)
  ctx.log('info', `原厂镜像已备份到 ${dirname(backups[partition].path)}`)
  const rec = addFlash({
    serial: fbSerial,
    kind: 'root',
    scheme: scheme.name,
    slot: await getvar(fbSerial, 'current-slot', ctx.signal),
    build,
    partitions: [
      { name: partition, source: 'patched', sha256: await sha256File(patched) },
      ...(withOther ? [{ name: other, source: 'stock' as const, sha256: backups[other].sha256 }] : [])
    ],
    backups
  })

  // 用临时目录里的副本刷入，避开「文档\一加工具箱」中文路径
  ctx.step(`正在刷入 ${partition}`)
  const flash = await fastboot(fbSerial, ['flash', partition, patched], ctx, 300_000)
  if (flash.code !== 0) {
    updateFlash(fbSerial, rec.id, { status: 'failed' })
    throw new OpError(`刷入 ${partition} 失败，设备仍在 Fastboot 模式，可尝试重刷或切换槽位`)
  }

  if (withOther) {
    ctx.step(`正在刷入原厂 ${other}`)
    const r = await fastboot(fbSerial, ['flash', other, images[other]!], ctx, 300_000)
    if (r.code !== 0) ctx.log('warn', `原厂 ${other} 刷入失败，不影响本次 Root`)
  }
  updateFlash(fbSerial, rec.id, { status: 'ok' })

  await fastboot(fbSerial, ['reboot'], ctx)
  return { ok: true, message: `刷入完成，手机正在重启。${AFTER_ROOT[scheme.family]}`, outputPath: saved }
}
