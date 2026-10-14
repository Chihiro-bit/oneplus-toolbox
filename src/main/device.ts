import type { DeviceInfo, DeviceMode, LogLevel } from '@shared/types'
import { CancelledError, exec, sleep, tools } from './exec'

interface RawDevice {
  serial: string
  mode: DeviceMode
}

const ADB_STATES: Record<string, DeviceMode> = {
  device: 'system',
  recovery: 'recovery',
  sideload: 'recovery',
  rescue: 'recovery',
  unauthorized: 'unauthorized'
}

/** adb devices / fastboot devices 双路探测 */
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
    if (m) found.push({ serial: m[1], mode: 'fastboot' })
  }
  return found
}

export async function detect(signal?: AbortSignal): Promise<DeviceInfo> {
  const list = await listDevices(signal)
  if (list.length === 0) return { mode: 'none' }
  return { ...list[0], multiple: list.length > 1 }
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

/** 读取解锁状态：先 oem device-info，再 getvar unlocked */
export async function isUnlocked(serial: string, signal?: AbortSignal): Promise<boolean | undefined> {
  const info = await exec(tools.fastboot, ['-s', serial, 'oem', 'device-info'], { signal, timeoutMs: 10_000 })
  if (/Device unlocked:\s*true/i.test(info.all)) return true
  if (/Device unlocked:\s*false/i.test(info.all)) return false
  const v = await getvar(serial, 'unlocked', signal)
  if (v === 'yes') return true
  if (v === 'no') return false
  return undefined
}

/**
 * 开机时读到的品牌与型号，按序列号记住。Fastboot 下读不到品牌，
 * 如果这台设备之前以开机状态连过，就沿用记下的信息。
 */
const identity = new Map<string, Pick<DeviceInfo, 'brand' | 'manufacturer' | 'model'>>()

/** 补全设备详情：开机/Recovery 读 getprop，Fastboot 读 getvar */
export async function describe(base: DeviceInfo, signal?: AbortSignal): Promise<DeviceInfo> {
  if (!base.serial) return base
  try {
    if (base.mode === 'system' || base.mode === 'recovery') {
      const p = await getProps(base.serial, signal)
      const id = {
        model: p['ro.product.marketname'] || p['ro.vendor.oplus.market.name'] || p['ro.product.model'],
        brand: p['ro.product.brand'],
        manufacturer: p['ro.product.manufacturer']
      }
      if (id.brand || id.manufacturer) identity.set(base.serial, id)
      return {
        ...base,
        ...id,
        device: p['ro.product.device'],
        androidVersion: p['ro.build.version.release'],
        buildId: p['ro.build.display.id'],
        romVersion: p['ro.build.version.oplusrom'] || p['ro.rom.version'],
        slot: p['ro.boot.slot_suffix']?.replace(/^_/, '')
      }
    }
    if (base.mode === 'fastboot') {
      const [product, slot] = [
        await getvar(base.serial, 'product', signal),
        await getvar(base.serial, 'current-slot', signal)
      ]
      const unlocked = await isUnlocked(base.serial, signal)
      return { ...identity.get(base.serial), ...base, device: product, slot, unlocked }
    }
  } catch (e) {
    if (e instanceof CancelledError) throw e
  }
  return base
}

/** 轮询等待设备进入指定模式 */
export async function waitForMode(
  modes: DeviceMode[],
  opts: { timeoutMs: number; signal?: AbortSignal; log?: (l: LogLevel, t: string) => void }
): Promise<DeviceInfo> {
  const deadline = Date.now() + opts.timeoutMs
  let warnedUnauthorized = false
  while (Date.now() < deadline) {
    const d = await detect(opts.signal)
    if (modes.includes(d.mode)) return d
    if (d.mode === 'unauthorized' && !warnedUnauthorized) {
      opts.log?.('warn', '手机上出现了 USB 调试授权弹窗，请勾选“始终允许”并点击允许')
      warnedUnauthorized = true
    }
    await sleep(1500, opts.signal)
  }
  throw new Error(`等待设备超时（${Math.round(opts.timeoutMs / 1000)} 秒）。请检查数据线和驱动`)
}
