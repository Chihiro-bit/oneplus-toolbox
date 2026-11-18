export type MonitorDays = 1 | 7
export interface CpuConsumer { name: string; percent: number }
export const MONITOR_INTERVAL = 60_000
export const MONITOR_MAX_GAP = 95_000
export const HIGH_TEMPERATURE = 43
export interface TemperatureSample {
  time: number
  battery?: number
  charging?: boolean
  level?: number
  screenOn?: boolean
  highTemperatureEvent?: boolean
  cpuWindow?: string
  cpu: CpuConsumer[]
}
export interface AppPower { uid: number; packages: string[]; mah: number }
export interface MonitorApp { package: string; label: string; icon?: string; system: boolean }
export interface MonitorReading {
  serial: string
  sample: TemperatureSample
  history: TemperatureSample[]
  notes: string[]
}
export interface TrafficApp {
  uid: number
  packages: string[]
  mobile: number
  wifi: number
  other: number
  rx: number
  tx: number
}
export interface MonitorState {
  serial: string
  time: number
  days: MonitorDays
  sample: TemperatureSample
  history: TemperatureSample[]
  traffic?: TrafficApp[]
  trafficStart?: number
  trafficEnd?: number
  power?: AppPower[]
  powerSince?: number
  healthPercent?: number
  cycles?: number
  notes: string[]
}

function batteryField(text: string, name: string) {
  const value = text.match(new RegExp(`^\\s*${name}:\\s*(\\d+)\\s*$`, 'mi'))?.[1]
  return value === undefined ? undefined : Number(value)
}

export function parseBatteryStatus(battery: string, power: string) {
  if (/UPDATES STOPPED/i.test(battery)) return {}
  const rawLevel = batteryField(battery, 'level')
  const scale = batteryField(battery, 'scale')
  const level = rawLevel !== undefined && scale && rawLevel <= scale ? rawLevel / scale * 100 : undefined
  const plugs = [...battery.matchAll(/^\s*(?:AC|USB|Wireless|Dock) powered:\s*(true|false)\s*$/gmi)]
  const charging = plugs.some(p => p[1].toLowerCase() === 'true') ? true : plugs.length >= 3 ? false : undefined
  const wakefulness = power.match(/^\s*mWakefulness=(\w+)/m)?.[1]
  const screenOn = wakefulness === 'Awake' || wakefulness === 'Dreaming' ? true
    : wakefulness === 'Asleep' || wakefulness === 'Dozing' ? false : undefined
  return { level, charging, screenOn }
}

export function parseBatteryHealth(text: string) {
  const health = batteryField(text, '(?:soh|state.of.health)')
  const cycles = batteryField(text, 'cycle[ _-]?count')
  return {
    healthPercent: health !== undefined && health >= 1 && health <= 100 ? health : undefined,
    cycles: cycles !== undefined && cycles <= 100_000 ? cycles : undefined
  }
}

/** BatteryStats checkin category l is the system's cumulative statistics window. */
export function parseAppPower(text: string, packages: Map<number, string[]>) {
  let since: number | undefined
  const consumers = new Map<number, AppPower>()
  let recognized = false
  for (const line of text.split(/\r?\n/)) {
    const fields = line.split(',')
    if (fields[2] !== 'l') continue
    const [, rawUid, , kind, scope, amount] = fields
    if (kind === 'bt') {
      const start = Number(fields[9])
      if (Number.isFinite(start) && start > 0) since = start
    }
    if (kind === 'pws' && scope && Number.isFinite(Number(scope))) recognized = true
    if (kind !== 'pwi' || scope !== 'uid' || !/^\d+$/.test(rawUid) || !amount) continue
    const uid = Number(rawUid), mah = Number(amount)
    if (!Number.isFinite(mah) || mah < 0) continue
    recognized = true
    if (mah > 0) consumers.set(uid, { uid, packages: packages.get(uid) ?? [], mah })
  }
  return { since, rows: recognized ? [...consumers.values()].sort((a, b) => b.mah - a.mah) : undefined }
}

export function summarizeDrain(history: TemperatureSample[]) {
  const screen = { duration: 0, drop: 0 }
  const standby = { duration: 0, drop: 0 }
  let stretch: { from: number; until: number; drop: number } | undefined
  let longest: typeof stretch
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1], next = history[i]
    const duration = next.time - prev.time
    if (duration <= 0 || duration > MONITOR_MAX_GAP || prev.charging !== false || next.charging !== false ||
      prev.level === undefined || next.level === undefined || next.level > prev.level ||
      prev.screenOn === undefined || prev.screenOn !== next.screenOn) {
      stretch = undefined
      continue
    }
    const drop = prev.level - next.level
    const bucket = next.screenOn ? screen : standby
    bucket.duration += duration
    bucket.drop += drop
    if (next.screenOn) { stretch = undefined; continue }
    stretch = { from: stretch?.from ?? prev.time, until: next.time, drop: (stretch?.drop ?? 0) + drop }
    if (!longest || stretch.until - stretch.from > longest.until - longest.from) longest = stretch
  }
  return { screen, standby, longest }
}

/** Require three readings spanning about two minutes, and alert once per continuous hot episode. */
export function isNewTemperatureEvent(history: TemperatureSample[], sample: TemperatureSample): boolean {
  if (sample.battery === undefined || sample.battery < HIGH_TEMPERATURE) return false
  let next = sample.time, count = 1
  for (let i = history.length - 1; i >= 0; i--) {
    const prev = history[i]
    if (next - prev.time > MONITOR_MAX_GAP || prev.battery === undefined || prev.battery < HIGH_TEMPERATURE) break
    if (prev.highTemperatureEvent) return false
    next = prev.time
    count++
  }
  return count >= 3 && sample.time - next >= 110_000
}

export function parseTemperature(text: string): number | undefined {
  const match = text.match(/^\s*temperature:\s*(-?\d+)\s*$/m)
  if (!match) return undefined
  const value = Number(match[1]) / 10
  return value >= -30 && value <= 100 ? value : undefined
}

/** Android cpuinfo 是系统最近一次采样窗口的进程占用，不是每个应用的温度。 */
export function parseCpu(text: string): CpuConsumer[] {
  const totals = new Map<string, number>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([\d.]+)%\s+\d+\/([^:]+(?::[^\s:]+)?):\s/)
    if (!m) continue
    const name = m[2].replace(/:.*$/, '')
    const percent = Number(m[1])
    if (Number.isFinite(percent)) totals.set(name, (totals.get(name) ?? 0) + percent)
  }
  return [...totals].map(([name, percent]) => ({ name, percent })).sort((a, b) => b.percent - a.percent).slice(0, 8)
}

export function parseUidPackages(text: string): Map<number, string[]> {
  const result = new Map<number, string[]>()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^package:([\w.]+)\s+uid:(\d+)/)
    if (!m) continue
    const uid = Number(m[2])
    result.set(uid, [...new Set([...(result.get(uid) ?? []), m[1]])])
  }
  return result
}

/** Only UID (untagged) history: dev/xt and UID-tag sections would double count. */
export function parseTraffic(text: string, packages: Map<number, string[]>, from: number, until: number) {
  const rows = new Map<number, TrafficApp>()
  let inUid = false, recognized = false
  let uid: number | undefined, duration = 0
  let network: 'mobile' | 'wifi' | 'other' = 'other'
  let start: number | undefined, end: number | undefined
  for (const line of text.split(/\r?\n/)) {
    if (/^\S.*:\s*$/.test(line)) {
      inUid = /^UID stats:\s*$/i.test(line)
      uid = undefined
    }
    if (!inUid) continue
    if (/\bident=/.test(line)) {
      uid = undefined
      duration = 0
      const u = line.match(/\buid=(-?\d+)/)
      const tag = line.match(/\btag=(0x[\da-f]+|\d+)/i)
      if (u && tag && Number(tag[1]) === 0 && /\bset=(?:DEFAULT|FOREGROUND|0|1)\b/.test(line)) uid = Number(u[1])
      network = /\btype=(?:WIFI|1)\b/i.test(line) ? 'wifi' : /\btype=(?:MOBILE|0)\b/i.test(line) ? 'mobile' : 'other'
    }
    const d = line.match(/\bbucketDuration=(\d+)/)
    if (d) { duration = Number(d[1]); recognized = true }
    if (uid === undefined || duration <= 0) continue
    const st = line.match(/\b(?:st|bucketStart)=(\d+)/)
    const rb = line.match(/\b(?:rb|rxBytes)=(\d+)/)
    const tb = line.match(/\b(?:tb|txBytes)=(\d+)/)
    if (!st || !rb || !tb) continue
    const rawTime = Number(st[1])
    // AOSP 的紧凑 dump 将 st 和 bucketDuration 除以 1000；部分 ROM 保留毫秒。
    const scale = rawTime >= 1_000_000_000 && rawTime < 100_000_000_000 ? 1000 : 1
    const time = rawTime * scale, bucketMs = duration * scale
    const overlap = Math.min(time + bucketMs, until) - Math.max(time, from)
    if (overlap <= 0) continue
    // 边界桶按时间占比估算，页面明确说明不是运营商账单。
    const rx = Number(rb[1]) * overlap / bucketMs, tx = Number(tb[1]) * overlap / bucketMs
    if (![rx, tx].every(Number.isFinite)) continue
    start = Math.min(start ?? Infinity, Math.max(time, from))
    end = Math.max(end ?? 0, Math.min(time + bucketMs, until))
    const row = rows.get(uid) ?? { uid, packages: packages.get(uid) ?? [], mobile: 0, wifi: 0, other: 0, rx: 0, tx: 0 }
    row[network] += rx + tx
    row.rx += rx
    row.tx += tx
    rows.set(uid, row)
  }
  return { recognized, start, end, rows: [...rows.values()].sort((a, b) => b.rx + b.tx - a.rx - a.tx) }
}
