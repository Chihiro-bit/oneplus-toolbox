import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DeviceInfo, DeviceMode, EdlDevice, LogLevel } from '@shared/types'
import { CancelledError, exec, sleep, tools } from './exec'
import { getKnown, remember } from './known'

interface RawDevice {
  serial: string
  mode: DeviceMode
  /** 仅 edl：QDLoader 9008 的 COM 端口 */
  edlPort?: string
  /** 仅 edl：设备管理器里的名称 */
  label?: string
}

const ADB_STATES: Record<string, DeviceMode> = {
  device: 'system',
  recovery: 'recovery',
  sideload: 'recovery',
  rescue: 'recovery',
  unauthorized: 'unauthorized'
}

// ───────────── 9008（高通 EDL）检测 ─────────────

/**
 * 9008 既不归 adb 也不归 fastboot 管，只能靠 PnP 枚举（只读，不需要管理员权限）。
 * 为了不在「一直没插手机」时反复启动 PowerShell，这里做了两件事：
 * 只有 adb / fastboot 都没结果时才去查，且最多每 15 秒查一次
 * （实测一次 Get-PnpDevice 要 1~2 秒，间隔太短会在待机时空耗 CPU）。
 */
const EDL_PROBE_INTERVAL_MS = 15_000
const EDL_NAME = /QDLoader|(?<!\d)900[8E](?!\d)/i
let edlCache: { at: number; devices: EdlDevice[] } = { at: 0, devices: [] }

const PNP_SCRIPT =
  "$ErrorActionPreference='SilentlyContinue';" +
  'Get-PnpDevice -PresentOnly | Where-Object { $_.FriendlyName -match \'QDLoader|9008|900E\' } |' +
  "ForEach-Object { '{0}|{1}' -f $_.FriendlyName, $_.InstanceId }"

export function parseEdlDevices(out: string): EdlDevice[] {
  const devices: EdlDevice[] = []
  for (const line of out.split(/\r?\n/)) {
    // PowerShell 侧已经按名称粗筛过，这里再按「QDLoader / 9008 / 900E」精确判定
    const name = line.split('|')[0] ?? ''
    if (!EDL_NAME.test(name)) continue
    devices.push({
      port: name.match(/\((COM\d+)\)/i)?.[1]?.toUpperCase() ?? '',
      name: name.trim()
    })
  }
  return devices
}

/** 用绝对路径调用 PowerShell，避免 PATH 被改过时找不到 */
export function powershellPath(): string {
  const p = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(p) ? p : 'powershell.exe'
}

/** 列出当前在线的 9008 设备。PowerShell 不可用时按「没有设备」处理，不影响其它功能 */
export async function listEdlDevices(signal?: AbortSignal): Promise<EdlDevice[]> {
  const r = await exec(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', PNP_SCRIPT], {
    signal,
    timeoutMs: 20_000,
    echoOutput: false
  })
  return parseEdlDevices(r.all)
}

/** adb devices / fastboot devices / 9008 三路探测 */
export async function listDevices(signal?: AbortSignal): Promise<RawDevice[]> {
  const found: RawDevice[] = []
  const adb = await exec(tools.adb, ['devices'], { signal, timeoutMs: 15_000 })
  for (const line of adb.stdout.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+(\S+)$/)
    if (m && ADB_STATES[m[2]]) found.push({ serial: m[1], mode: ADB_STATES[m[2]] })
  }
  const fb = await exec(tools.fastboot, ['devices'], { signal, timeoutMs: 10_000 })
  for (const line of fb.all.split(/\r?\n/)) {
    const m = line.match(/^(\S+)\s+fastboot\b/)
    // fastboot devices 不区分 bootloader 和 fastbootd，只能问 is-userspace（一加 13 实测：bootloader 下 no，fastbootd 下 yes）
    if (m) found.push({ serial: m[1], mode: (await getvar(m[1], 'is-userspace', signal)) === 'yes' ? 'fastbootd' : 'fastboot' })
  }

  if (found.length === 0) {
    if (Date.now() - edlCache.at > EDL_PROBE_INTERVAL_MS) {
      try {
        edlCache = { at: Date.now(), devices: await listEdlDevices(signal) }
      } catch (e) {
        if (e instanceof CancelledError) throw e
        edlCache = { at: Date.now(), devices: [] }
      }
    }
    for (const d of edlCache.devices) {
      found.push({ serial: d.port || d.name, mode: 'edl', edlPort: d.port, label: d.name })
    }
  }
  return found
}

// ───────────── 多台设备 ─────────────

/**
 * 界面上选中的设备序列号。连了多台时，所有操作都只针对它；没选的话操作直接拒绝，避免刷错手机。
 * 只连一台时不看这个值。
 */
let selected: string | undefined

export function selectDevice(serial: string | undefined): void {
  selected = serial
}

export function selectedSerial(): string | undefined {
  return selected
}

function toInfo(d: RawDevice, list: RawDevice[]): DeviceInfo {
  // adb / fastboot 下 label 为空，型号由 describe() 补全；edl 下就用设备管理器里的名称
  const { label, ...rest } = d
  if (list.length <= 1) return { ...rest, device: label }
  return {
    ...rest,
    device: label,
    multiple: true,
    devices: list.map((x) => ({ serial: x.serial, mode: x.mode, label: x.label })),
    selected,
    needsPick: d.serial !== selected
  }
}

export async function detect(signal?: AbortSignal): Promise<DeviceInfo> {
  const list = await listDevices(signal)
  if (list.length === 0) return { mode: 'none' }
  return toInfo(list.find((d) => d.serial === selected) ?? list[0], list)
}

function parseGetprop(out: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const m of out.matchAll(/^\[([^\]]+)\]: \[([^\]]*)\]/gm)) props[m[1]] = m[2]
  return props
}

export async function getProps(serial: string, signal?: AbortSignal): Promise<Record<string, string>> {
  const r = await exec(tools.adb, ['-s', serial, 'shell', 'getprop'], { signal, timeoutMs: 15_000 })
  return parseGetprop(r.stdout)
}

/** fastboot getvar 的结果写在 stderr，形如 "unlocked: yes" */
export async function getvar(serial: string, name: string, signal?: AbortSignal): Promise<string | undefined> {
  const r = await exec(tools.fastboot, ['-s', serial, 'getvar', name], { signal, timeoutMs: 10_000 })
  const m = r.all.match(new RegExp(`^${name}:\\s*(.*)$`, 'm'))
  return m?.[1].trim() || undefined
}

/** 读取解锁状态：先 oem device-info，再 getvar unlocked（fastbootd 不支持 oem 命令，会走到后者） */
export async function isUnlocked(serial: string, signal?: AbortSignal): Promise<boolean | undefined> {
  const info = await exec(tools.fastboot, ['-s', serial, 'oem', 'device-info'], { signal, timeoutMs: 10_000 })
  if (/Device unlocked:\s*true/i.test(info.all)) return true
  if (/Device unlocked:\s*false/i.test(info.all)) return false
  const v = await getvar(serial, 'unlocked', signal)
  if (v === 'yes') return true
  if (v === 'no') return false
  return undefined
}

// ───────────── Root 状态 ─────────────

/** 管理器包名 → 显示名，只用于「装了 App 但 Root 没生效」的提示 */
const MANAGER_LABEL: Record<string, string> = {
  'com.topjohnwu.magisk': 'Magisk',
  'io.github.huskydg.magisk': 'Kitsune Mask',
  'io.github.vvb2060.magisk': 'Magisk Alpha',
  'me.bmax.apatch': 'APatch',
  'me.weishu.kernelsu': 'KernelSU',
  'com.rifsxd.ksunext': 'KernelSU Next',
  'com.sukisu.ultra': 'SukiSU Ultra',
  'com.resukisu.resukisu': 'ReSukiSU'
}

/**
 * 不需要 Root 授权的探测：`magisk -v` 对 shell 可见；`su -v` 只打印版本、不会弹授权窗
 * （KernelSU / APatch 没给 shell 授权时 su 对 shell 不可见，这时只能靠管理器包名判断）
 */
const ROOT_PROBE =
  'echo "M|$(magisk -v 2>/dev/null)"; echo "S|$(su -v 2>/dev/null)"; ' +
  `pm list packages 2>/dev/null | grep -E '${Object.keys(MANAGER_LABEL).join('|').replace(/\./g, '\\.')}'`

export function parseRootProbe(out: string): string {
  const magisk = out.match(/^M\|(.+)$/m)?.[1].trim()
  const su = out.match(/^S\|(.+)$/m)?.[1].trim()
  // magisk -v 形如 30.7:MAGISK:R；su -v 在 KernelSU 下形如 3.3.1:KernelSU
  if (magisk) return `Magisk ${magisk.split(':')[0]}`
  if (su) {
    const [ver, name] = su.split(':')
    return name ? `${name} ${ver}` : `已 Root（${su}）`
  }
  const pkgs = [...out.matchAll(/^package:([\w.]+)/gm)].map((m) => MANAGER_LABEL[m[1]]).filter(Boolean)
  return pkgs.length ? `未检测到（装有 ${pkgs.join('、')} App）` : '未 Root'
}

export async function rootStatus(serial: string, signal?: AbortSignal): Promise<string | undefined> {
  const r = await exec(tools.adb, ['-s', serial, 'shell', ROOT_PROBE], { signal, timeoutMs: 15_000 })
  return r.code === 0 ? parseRootProbe(r.stdout) : undefined
}

// ───────────── 设备详情 ─────────────

/** 补全设备详情：开机/Recovery 读 getprop，Fastboot 读 getvar（品牌、型号用之前开机时记下的） */
export async function describe(base: DeviceInfo, signal?: AbortSignal): Promise<DeviceInfo> {
  if (!base.serial) return base
  try {
    if (base.mode === 'system' || base.mode === 'recovery') {
      const p = await getProps(base.serial, signal)
      const info = {
        model: p['ro.product.marketname'] || p['ro.vendor.oplus.market.name'] || p['ro.product.model'],
        brand: p['ro.product.brand'],
        manufacturer: p['ro.product.manufacturer'],
        buildId: p['ro.build.display.id'],
        romVersion: p['ro.build.version.oplusrom'] || p['ro.rom.version']
      }
      // Recovery 里的 getprop 是 Recovery 自己的，版本信息不可靠，只在开机时记录
      if (base.mode === 'system' && (info.brand || info.manufacturer))
        remember(base.serial, { ...info, buildDateUtc: p['ro.build.date.utc'] })
      return {
        ...base,
        ...info,
        device: p['ro.product.device'],
        androidVersion: p['ro.build.version.release'],
        slot: p['ro.boot.slot_suffix']?.replace(/^_/, ''),
        root: base.mode === 'system' ? await rootStatus(base.serial, signal) : undefined
      }
    }
    if (base.mode === 'fastboot' || base.mode === 'fastbootd') {
      const [product, slot] = [
        await getvar(base.serial, 'product', signal),
        await getvar(base.serial, 'current-slot', signal)
      ]
      const unlocked = await isUnlocked(base.serial, signal)
      const k = getKnown(base.serial)
      const id = k && { brand: k.brand, manufacturer: k.manufacturer, model: k.model }
      return { ...id, ...base, device: product, slot, unlocked }
    }
  } catch (e) {
    if (e instanceof CancelledError) throw e
  }
  return base
}

/**
 * 轮询等待设备进入指定模式。给了 serial 时只认这台（连着多台手机时不会等到别的那台）；
 * 只连着一台时不比对序列号，兼容 adb 和 fastboot 下序列号不一样的机型。
 */
export async function waitForMode(
  modes: DeviceMode[],
  opts: { timeoutMs: number; serial?: string; signal?: AbortSignal; log?: (l: LogLevel, t: string) => void }
): Promise<DeviceInfo> {
  const deadline = Date.now() + opts.timeoutMs
  let warnedUnauthorized = false
  while (Date.now() < deadline) {
    const list = await listDevices(opts.signal)
    const want = opts.serial ?? selected
    const raw = list.find((x) => x.serial === want) ?? (list.length === 1 ? list[0] : undefined)
    const d: DeviceInfo = raw ? toInfo(raw, list) : { mode: 'none' }
    if (raw && modes.includes(d.mode)) {
      // fastboot 下序列号变了（少数机型），跟着改选中的设备，后续操作才找得到它
      if (list.length > 1 || selected) selected = raw.serial
      return { ...d, needsPick: false }
    }
    if (d.mode === 'unauthorized' && !warnedUnauthorized) {
      opts.log?.('warn', '手机上出现了 USB 调试授权弹窗，请勾选“始终允许”并点击允许')
      warnedUnauthorized = true
    }
    await sleep(1500, opts.signal)
  }
  throw new Error(`等待设备超时（${Math.round(opts.timeoutMs / 1000)} 秒）。请检查数据线和驱动`)
}
