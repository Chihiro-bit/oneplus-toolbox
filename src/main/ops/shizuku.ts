import { SHIZUKU } from '@shared/catalog'
import { parsePackagePermissions } from '@shared/permissions'
import type { OperationResult, ShizukuAction, ShizukuState } from '@shared/types'
import { downloadVerified } from '../download'
import { sleep } from '../exec'
import { adb, OpError, requireSystem, type OpContext } from './common'

const WRITE_SECURE_SETTINGS = 'android.permission.WRITE_SECURE_SETTINGS'
const BOOT_RECEIVER = 'moe.shizuku.manager.receiver.BootCompleteReceiver'

/**
 * Shizuku 用 adb 启动后，以 shell 身份常驻（进程名 shizuku_server），其它应用通过它调用系统 API。
 * 免 Root 的启动方式每次重启手机都要重新执行一次。
 *
 * 13.x 起官方给出的命令是直接运行应用原生库目录里的 libshizuku.so；
 * 旧版本、或原生库没有解压出来时，退回打开过一次应用后写在 Android/data 下的 start.sh。
 * 装了 Shizuku 时，DUMPSYS| 之后是 dumpsys package 的完整输出（版本、权限、被关掉的组件都从这里读）
 */
const PROBE = [
  `P=${SHIZUKU.package}`,
  'echo "SDK|$(getprop ro.build.version.sdk)"',
  'pid=$(pidof shizuku_server)',
  '[ -n "$pid" ] && echo "RUNNING|$pid"',
  `apk=$(pm path $P 2>/dev/null | head -n 1 | sed 's/^package://')`,
  'if [ -n "$apk" ]; then',
  '  d=${apk%/*}',
  '  for f in $d/lib/arm64/libshizuku.so $d/lib/*/libshizuku.so /sdcard/Android/data/$P/start.sh; do',
  '    [ -f "$f" ] && { echo "STARTER|$f"; break; }',
  '  done',
  '  echo "DUMPSYS|"',
  '  dumpsys package $P',
  'fi',
  'true'
].join('\n')

/** dumpsys package 里 disabledComponents: 段列出的组件 */
function disabledComponents(dump: string): Set<string> {
  const out = new Set<string>()
  let indent = -1
  for (const line of dump.split(/\r?\n/)) {
    const depth = line.length - line.trimStart().length
    if (line.trim() === 'disabledComponents:') indent = depth
    else if (indent >= 0 && line.trim() && depth > indent) out.add(line.trim())
    else indent = -1
  }
  return out
}

/** 解析 PROBE 的输出 */
export function parseShizukuProbe(out: string): ShizukuState & { starter?: string } {
  const state: ShizukuState & { starter?: string } = { installed: false, running: false }
  const at = out.indexOf('DUMPSYS|')
  const head = at >= 0 ? out.slice(0, at) : out
  for (const line of head.split(/\r?\n/)) {
    const [kind, ...rest] = line.trim().split('|')
    const value = rest.join('|').trim()
    if (kind === 'SDK' && /^\d+$/.test(value)) state.sdk = Number(value)
    else if (kind === 'STARTER' && value) state.starter = value
    else if (kind === 'RUNNING' && value) state.running = true
  }
  if (at >= 0) {
    const dump = out.slice(at + 'DUMPSYS|'.length)
    state.installed = true
    state.version = dump.match(/versionName=(\S+)/)?.[1]
    state.secureSettings = parsePackagePermissions(dump).granted.has(WRITE_SECURE_SETTINGS)
    state.bootReceiver = !disabledComponents(dump).has(BOOT_RECEIVER)
  }
  return state
}

async function probe(serial: string, ctx: OpContext) {
  const r = await adb(serial, ['shell', PROBE], ctx, 30_000, false)
  return parseShizukuProbe(r.stdout)
}

function describeState(s: ShizukuState): string {
  if (!s.installed) return '手机上没有安装 Shizuku'
  return `Shizuku ${s.version ?? ''} ${s.running ? '正在运行' : '已安装，未运行'}`.replace(/\s+/g, ' ')
}

/** 开机自启时，Shizuku 用自己配对过的密钥连本机的无线调试，这几步只能在手机上做 */
const AUTOSTART_PHONE_STEPS =
  '还需要在手机上完成：① 连上常用的 Wi-Fi，在 Shizuku 里用「通过无线调试启动」配对并启动一次（之后开机才连得上无线调试）；' +
  '② ColorOS / 氧 OS：设置 → 应用 → Shizuku → 允许自启动'

/**
 * 免 Root 开机自启（Shizuku 13.6+，Android 13+）：开机广播里用 WRITE_SECURE_SETTINGS 打开无线调试，
 * 再用 Shizuku 自己配对过的密钥连上去执行启动命令。电脑这边能做的是授予权限、确认开机广播没被关掉
 */
async function autostart(serial: string, state: ShizukuState, ctx: OpContext): Promise<OperationResult> {
  if (!state.installed) throw new OpError('手机上还没有安装 Shizuku，请先点「启动 Shizuku」')
  if (state.sdk !== undefined && state.sdk < 33)
    throw new OpError('免 Root 开机自启需要 Android 13 及以上。Android 12 及以下每次重启后需要重新启动 Shizuku')

  if (!state.secureSettings) {
    ctx.step('正在授予 Shizuku「修改安全系统设置」权限')
    await adb(serial, ['shell', 'pm', 'grant', SHIZUKU.package, WRITE_SECURE_SETTINGS], ctx)
  }
  if (!state.bootReceiver) {
    ctx.step('正在打开 Shizuku 的开机启动')
    await adb(serial, ['shell', 'pm', 'enable', `${SHIZUKU.package}/${BOOT_RECEIVER}`], ctx)
  }
  const now = await probe(serial, ctx)
  if (!now.secureSettings) return { ok: false, message: '没能授予 Shizuku「修改安全系统设置」权限，详见日志', shizuku: now }
  if (!now.bootReceiver) return { ok: false, message: '没能打开 Shizuku 的开机启动，可以在 Shizuku 设置里手动打开', shizuku: now }
  return { ok: true, message: `电脑这边已准备好。${AUTOSTART_PHONE_STEPS}`, shizuku: now }
}

export async function shizuku(action: ShizukuAction, ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  ctx.step('正在检查 Shizuku 状态')
  let state = await probe(serial, ctx)
  if (action === 'status') return { ok: true, message: describeState(state), shizuku: state }
  if (action === 'autostart') return autostart(serial, state, ctx)

  if (state.running) return { ok: true, message: `${describeState(state)}，不需要再启动`, shizuku: state }

  if (!state.installed) {
    const apk = await downloadVerified(SHIZUKU.url, SHIZUKU.sha256, {
      signal: ctx.signal,
      log: ctx.log,
      step: ctx.step,
      label: `Shizuku ${SHIZUKU.version}`
    })
    ctx.step('正在安装 Shizuku，请留意手机上的安装提示')
    const r = await adb(serial, ['install', '-r', apk], ctx, 180_000)
    if (r.code !== 0 || !r.all.includes('Success')) throw new OpError('Shizuku 安装失败，详见日志。ColorOS 上可能需要在手机弹窗里允许「通过 USB 安装应用」')
    ctx.log('ok', 'Shizuku 已安装')
    state = await probe(serial, ctx)
  }

  if (!state.starter)
    throw new OpError('找不到 Shizuku 的启动程序。请在手机上打开一次 Shizuku 应用，再回来重试')

  ctx.step('正在启动 Shizuku')
  const run = state.starter.endsWith('.sh') ? ['sh', state.starter] : [state.starter]
  await adb(serial, ['shell', ...run], ctx, 60_000)

  // 启动程序退出后服务端才在后台起来，稍等几秒再确认
  for (let i = 0; i < 5 && !state.running; i++) {
    await sleep(1000, ctx.signal)
    state = await probe(serial, ctx)
  }
  if (!state.running) return { ok: false, message: 'Shizuku 没有启动成功，详见日志', shizuku: state }
  return {
    ok: true,
    message: 'Shizuku 已启动。在 Shizuku 应用里给需要的应用授权即可；手机重启后需要重新启动，或者设置开机自启',
    shizuku: state
  }
}
