import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { DISPLAY_SIZES, type LogLevel, type MirrorOptions, type OperationResult, type RemoteEntry } from '@shared/types'
import { detect } from '../device'
import { tools } from '../exec'
import { adb, OpError, REMOTE_DIR, requireSystem, shq, type OpContext } from './common'
import { outputDir, workDir } from './root'

const stamp = (): string => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)

/** 手机上可以浏览的根目录；不允许跳出内置存储 */
export const REMOTE_ROOT = '/sdcard'

/** 规范化手机端路径，只接受 /sdcard 下的绝对路径 */
export function remotePath(p: string): string {
  const parts: string[] = []
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const out = `/${parts.join('/')}`
  if (out !== REMOTE_ROOT && !out.startsWith(`${REMOTE_ROOT}/`)) throw new OpError('只能访问手机内置存储（/sdcard）')
  return out
}

// ───────────── 截图 ─────────────

export async function screenshot(ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  ctx.step('正在截图')
  const remote = `${REMOTE_DIR}/screen.png`
  await adb(serial, ['shell', `mkdir -p ${REMOTE_DIR} && screencap -p ${remote}`], ctx, 30_000)
  // 先拉到临时目录（adb 对中文路径支持不好），再移到「文档\一加工具箱\截图」
  const tmp = join(workDir(), 'screen.png')
  const r = await adb(serial, ['pull', remote, tmp], ctx, 60_000)
  await adb(serial, ['shell', 'rm', '-f', remote], ctx)
  if (r.code !== 0 || !existsSync(tmp)) throw new OpError('截图失败，详见日志')
  const dir = join(outputDir(), '截图')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `screenshot_${stamp()}.png`)
  copyFileSync(tmp, file)
  return { ok: true, message: '截图已保存', outputPath: file }
}

// ───────────── 文件传输 ─────────────

/** 解析 stat -c '%F|%s|%Y|%n' 的输出 */
export function parseStat(out: string): RemoteEntry[] {
  const list: RemoteEntry[] = []
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([^|]+)\|(\d+)\|(\d+)\|(.+)$/)
    if (!m) continue
    const name = basename(m[4])
    if (name === '.' || name === '..') continue
    list.push({ name, dir: /directory/i.test(m[1]), size: Number(m[2]), mtime: Number(m[3]) * 1000 })
  }
  return list.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, 'zh-CN'))
}

export async function listRemote(path: string, ctx: OpContext): Promise<OperationResult> {
  const dir = remotePath(path)
  const serial = await requireSystem(ctx)
  // stat 跟随符号链接（-L），/sdcard 本身就是链接
  const r = await adb(serial, ['shell', `find ${shq(dir)}/ -mindepth 1 -maxdepth 1 -exec stat -L -c '%F|%s|%Y|%n' {} + 2>/dev/null`], ctx, 60_000, false)
  if (r.code !== 0 && !r.stdout.trim()) throw new OpError(`读取 ${dir} 失败`)
  const entries = parseStat(r.stdout)
  return { ok: true, message: `${dir}：${entries.length} 项`, remote: { path: dir, entries } }
}

/** 推送到手机：先复制到临时目录（避开中文路径），再 adb push */
export async function pushFiles(files: string[], to: string, ctx: OpContext): Promise<OperationResult> {
  if (files.length === 0) throw new OpError('请先选择文件')
  const dir = remotePath(to)
  const serial = await requireSystem(ctx)
  const tmp = workDir()
  const done: string[] = []
  for (const [i, f] of files.entries()) {
    if (!existsSync(f) || !statSync(f).isFile()) {
      ctx.log('warn', `跳过 ${f}：不是文件`)
      continue
    }
    ctx.step(`正在发送 ${basename(f)}（${i + 1}/${files.length}）`)
    const local = join(tmp, `${i}_${basename(f).replace(/[^\w.-]/g, '_')}`)
    copyFileSync(f, local)
    const r = await adb(serial, ['push', local, `${dir}/${basename(f)}`], ctx, 1_800_000)
    if (r.code !== 0) throw new OpError(`发送 ${basename(f)} 失败，详见日志`)
    done.push(basename(f))
  }
  return { ok: true, message: `已发送 ${done.length} 个文件到 ${dir}` }
}

/** 从手机拉取一个文件到「文档\一加工具箱\传输」 */
export async function pullFile(path: string, ctx: OpContext): Promise<OperationResult> {
  const remote = remotePath(path)
  const serial = await requireSystem(ctx)
  const name = basename(remote)
  ctx.step(`正在接收 ${name}`)
  const tmp = join(workDir(), 'pull.bin')
  const r = await adb(serial, ['pull', remote, tmp], ctx, 1_800_000)
  if (r.code !== 0 || !existsSync(tmp)) throw new OpError(`接收 ${name} 失败，详见日志`)
  const dir = join(outputDir(), '传输')
  mkdirSync(dir, { recursive: true })
  let file = join(dir, name)
  if (existsSync(file)) file = join(dir, `${stamp()}_${name}`)
  try {
    renameSync(tmp, file)
  } catch {
    copyFileSync(tmp, file)
  }
  return { ok: true, message: `已保存 ${name}`, outputPath: file }
}

// ───────────── 投屏 ─────────────

let mirror: ReturnType<typeof spawn> | null = null

/**
 * scrcpy 参数。独立屏幕用 --new-display 在手机上建一块虚拟屏幕（Android 10+），
 * 一加 13（ColorOS 16）上实测：不指定应用时显示系统的副屏桌面；指定的应用已在后台时会被移到虚拟屏，
 * 手机屏幕不受影响；手机锁屏后虚拟屏照常运行
 */
export function mirrorArgs(opts: MirrorOptions, title: string): string[] {
  const vd = opts.display
  if (!vd) {
    const args = ['--window-title', title]
    if (opts.turnScreenOff) args.push('--turn-screen-off')
    if (opts.stayAwake) args.push('--stay-awake')
    return args
  }
  if (vd.app !== undefined && !/^[\w.]+$/.test(vd.app)) throw new OpError('包名不合法')
  const size = DISPLAY_SIZES[vd.size]
  if (!size) throw new OpError('分辨率不合法')
  // 软键盘弹在虚拟屏上，不打扰手机屏幕；手机屏幕要留给用户用，不关屏也不保持亮屏（锁屏不影响虚拟屏）
  const args = ['--window-title', `${title}（独立屏幕）`, size.arg ? `--new-display=${size.arg}` : '--new-display', '--display-ime-policy=local']
  if (vd.app) args.push(`--start-app=${vd.app}`)
  if (vd.keepApp) args.push('--no-vd-destroy-content')
  if (vd.audioOnPhone) args.push('--no-audio')
  return args
}

/**
 * 启动 scrcpy 投屏。独立于操作队列运行（投屏期间可以照常做别的事），关掉窗口即结束。
 * ADB 环境变量指向工具箱自己的 adb，scrcpy 就不会再起一个不同版本的 adb server
 */
export async function startMirror(
  opts: MirrorOptions,
  log: (level: LogLevel, text: string) => void
): Promise<OperationResult> {
  if (mirror && mirror.exitCode === null) return { ok: false, message: '投屏窗口已经打开了' }
  const d = await detect()
  if (d.mode !== 'system' || !d.serial) return { ok: false, message: '投屏需要手机开机并开启 USB 调试' }
  if (d.needsPick) return { ok: false, message: '连接了多台设备，请先在左下角选择要操作的那一台' }
  if (!existsSync(tools.scrcpy)) return { ok: false, message: '缺少 scrcpy，开发环境请先运行 npm run fetch-tools' }
  let args: string[]
  try {
    args = ['-s', d.serial, ...mirrorArgs(opts, d.model ?? d.serial)]
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
  log('cmd', `scrcpy ${args.join(' ')}`)
  const child = spawn(tools.scrcpy, args, { windowsHide: true, env: { ...process.env, ADB: tools.adb } })
  mirror = child
  const onData = (buf: Buffer) => {
    for (const line of buf.toString('utf8').split(/\r?\n/)) if (line.trim()) log('info', `[scrcpy] ${line.trim()}`)
  }
  child.stdout?.on('data', onData)
  child.stderr?.on('data', onData)
  child.on('exit', (code) => {
    log(code === 0 ? 'info' : 'warn', `投屏已结束${code ? `（退出码 ${code}）` : ''}`)
    if (mirror === child) mirror = null
  })
  child.on('error', (e) => log('error', `scrcpy 启动失败：${e.message}`))
  return {
    ok: true,
    message: opts.display
      ? `独立屏幕正在打开${opts.display.app ? '' : '，在窗口里点右下角的图标选择应用'}。关掉窗口即结束${opts.display.keepApp ? '，应用会移回手机' : '，上面的应用会被关闭'}`
      : '投屏窗口正在打开，关掉窗口即结束投屏'
  }
}

export function stopMirror(): void {
  mirror?.kill()
}
