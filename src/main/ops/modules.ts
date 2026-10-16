import { copyFileSync, existsSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { isRooted } from '@shared/root'
import type { OperationResult } from '@shared/types'
import { rootStatus } from '../device'
import { exec, tools } from '../exec'
import { adb, OpError, REMOTE_DIR, requireSystem, shq, type OpContext } from './common'
import { workDir } from './root'

/** `7z l` 的输出里根目录有 module.prop，才是 Magisk / KernelSU / APatch 模块（防止误把卡刷包当模块装） */
export function isModuleListing(out: string): boolean {
  return /\s(?:\.\/)?module\.prop\s*$/m.test(out)
}

/**
 * 按当前的 Root 方案调用它自己的安装命令，三家的模块格式相同。
 * ksud / apd 在 /data/adb 下、只有 Root 能看到，所以整段在 su 里判断
 */
export function installScript(zip: string): string {
  return [
    `Z=${zip}`,
    'if [ -x /data/adb/ksud ]; then /data/adb/ksud module install "$Z"',
    'elif [ -x /data/adb/apd ]; then /data/adb/apd module install "$Z"',
    'elif command -v magisk >/dev/null 2>&1; then magisk --install-module "$Z"',
    'else echo NO_TOOL; exit 0; fi',
    'echo "EXIT|$?"'
  ].join('\n')
}

/** 推到手机临时目录后逐个安装；全部装完才需要重启一次 */
export async function installModules(files: string[], ctx: OpContext): Promise<OperationResult> {
  if (files.length === 0) throw new OpError('请先选择模块的 .zip 文件')
  const serial = await requireSystem(ctx)
  const root = await rootStatus(serial, ctx.signal)
  if (!isRooted(root)) throw new OpError(`安装模块需要 Root，这台手机当前是「${root ?? '未知'}」`)

  const dir = workDir()
  await adb(serial, ['shell', 'mkdir', '-p', REMOTE_DIR], ctx)
  const ok: string[] = []
  const failed: string[] = []
  for (const [i, file] of files.entries()) {
    const name = basename(file)
    if (extname(file).toLowerCase() !== '.zip' || !existsSync(file)) {
      ctx.log('warn', `跳过 ${name}：不是 .zip 文件`)
      failed.push(name)
      continue
    }
    const listing = await exec(tools.sevenZip, ['l', file], { signal: ctx.signal, timeoutMs: 60_000 })
    if (!isModuleListing(listing.stdout)) {
      ctx.log('error', `${name} 里没有 module.prop，不是 Root 模块（卡刷包、ROM 不能用这个功能安装）`)
      failed.push(name)
      continue
    }

    ctx.step(`正在安装 ${name}（${i + 1}/${files.length}），手机上弹出 Root 授权时请点允许`)
    const local = join(dir, `module_${i}.zip`)
    copyFileSync(file, local)
    const remote = `${REMOTE_DIR}/module_${i}.zip`
    const pushed = await adb(serial, ['push', local, remote], ctx, 600_000)
    if (pushed.code !== 0) {
      ctx.log('error', `${name} 推送失败`)
      failed.push(name)
      continue
    }
    const r = await adb(serial, ['shell', `timeout 300 su -c ${shq(installScript(remote))} 2>&1`], ctx, 320_000)
    await adb(serial, ['shell', 'rm', '-f', remote], ctx)
    const code = r.stdout.match(/^EXIT\|(\d+)/m)?.[1]
    if (r.stdout.includes('NO_TOOL')) throw new OpError('拿到了 Root，但没找到 Magisk / KernelSU / APatch 的命令行工具，请在 Root 管理器里安装')
    if (code === undefined) throw new OpError('没有拿到 Root 授权。请在 Root 管理器里允许 Shell 的超级用户权限后再试')
    if (code === '0') {
      ok.push(name)
      ctx.log('ok', `${name} 安装成功`)
    } else {
      failed.push(name)
      ctx.log('error', `${name} 安装失败（退出码 ${code}），模块自带的安装脚本输出见上方日志`)
    }
  }

  const tail = '重启手机后生效。万一重启后卡开机，可以在「救援与恢复」里禁用全部模块'
  if (failed.length === 0) return { ok: true, message: `${ok.length === 1 ? ok[0] : `${ok.length} 个模块`}已安装，${tail}` }
  return { ok: ok.length > 0, message: `成功 ${ok.length} 个，失败 ${failed.length} 个（${failed.join('、')}），失败原因见日志${ok.length ? `。${tail}` : ''}` }
}
