import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import {
  isNewTemperatureEvent, parseAppPower, parseBatteryHealth, parseBatteryStatus, parseCpu, parseTemperature,
  parseTraffic, parseUidPackages, type MonitorDays, type MonitorReading, type TemperatureSample
} from '@shared/monitor'
import type { OperationResult } from '@shared/types'
import { adb, OpError, requireSystem, type OpContext } from './common'

const DAY = 86_400_000
const monitorDir = () => join(app.getPath('userData'), 'monitor')
const historyFile = (serial: string) => join(monitorDir(), `${createHash('sha256').update(serial).digest('hex')}.json`)

async function read(serial: string, ctx: OpContext, args: string[], notes: string[], label?: string) {
  const r = await adb(serial, ['shell', ...args], ctx, 30_000, false)
  if (r.code !== 0 || /Permission Denial|Permission denied|SecurityException|Can't find service/i.test(r.all)) {
    if (label) notes.push(`${label}读取失败或系统未开放权限`)
    return ''
  }
  return r.stdout
}

export async function readMonitorHistory(serial: string, time = Date.now(), notes?: string[]): Promise<TemperatureSample[]> {
  try {
    const saved: unknown = JSON.parse(await readFile(historyFile(serial), 'utf8'))
    if (Array.isArray(saved)) return saved.filter((s): s is TemperatureSample =>
      s && Number.isFinite(s.time) && s.time > time - 7 * DAY && s.time <= time &&
      (s.battery === undefined || (Number.isFinite(s.battery) && s.battery >= -30 && s.battery <= 100)) &&
      (s.level === undefined || (Number.isFinite(s.level) && s.level >= 0 && s.level <= 100)) &&
      Array.isArray(s.cpu) && s.cpu.every((c: { name?: unknown; percent?: unknown }) => typeof c?.name === 'string' && typeof c.percent === 'number' && Number.isFinite(c.percent))).sort((a, b) => a.time - b.time)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') notes?.push('本地监控历史无法读取，本次重新开始记录')
  }
  return []
}

async function collectSample(serial: string, ctx: OpContext, notes: string[]) {
  const [battery, cpu, power] = await Promise.all([
    read(serial, ctx, ['dumpsys', 'battery'], notes, '电池状态'),
    read(serial, ctx, ['dumpsys', 'cpuinfo'], notes, '进程负载'),
    read(serial, ctx, ['dumpsys', 'power'], notes, '亮灭屏状态')
  ])
  const simulated = /UPDATES STOPPED/i.test(battery)
  if (simulated) notes.push('手机电池数据处于模拟状态，本次跳过温度和电量')
  const sample: TemperatureSample = {
    time: Date.now(), battery: simulated ? undefined : parseTemperature(battery), cpu: parseCpu(cpu),
    cpuWindow: cpu.match(/^CPU usage[^\r\n]*/m)?.[0],
    ...parseBatteryStatus(battery, power)
  }
  if (!simulated && sample.battery === undefined) notes.push('系统没有返回有效电池温度')
  return { sample, health: parseBatteryHealth(battery) }
}

async function recordSample(serial: string, sample: TemperatureSample, ctx: OpContext, notes: string[]): Promise<MonitorReading> {
  const history = await readMonitorHistory(serial, sample.time, notes)
  if (ctx.signal.aborted) throw new OpError('操作已取消')
  if (sample.battery === undefined && sample.level === undefined && !sample.cpu.length) {
    throw new OpError('没有读到监控数据，请检查手机连接和调试权限')
  }
  if (isNewTemperatureEvent(history, sample)) sample.highTemperatureEvent = true
  const next = [...history.filter(s => s.time !== sample.time), sample].slice(-10080)
  const file = historyFile(serial)
  try {
    await mkdir(monitorDir(), { recursive: true })
    await writeFile(`${file}.tmp`, JSON.stringify(next), 'utf8')
    await rename(`${file}.tmp`, file)
  } catch { notes.push('无法保存本地监控历史，本次数据仍可查看') }
  return { serial, sample, history: next, notes }
}

export async function sampleMonitor(serial: string, ctx: OpContext): Promise<MonitorReading> {
  const notes: string[] = []
  const { sample } = await collectSample(serial, ctx, notes)
  return recordSample(serial, sample, ctx, notes)
}

const HEALTH_SYSFS = [
  'for dir in /sys/class/power_supply/battery /sys/class/power_supply/bms; do',
  'for key in soh cycle_count; do',
  'value=$(cat "$dir/$key" 2>/dev/null) && printf "%s: %s\\n" "$key" "$value";',
  'done; done; true'
].join(' ')

export async function monitor(days: MonitorDays, ctx: OpContext): Promise<OperationResult> {
  if (days !== 1 && days !== 7) throw new OpError('请选择最近 24 小时或 7 天')
  const serial = await requireSystem(ctx)
  const notes: string[] = []
  ctx.step('正在读取温度、进程负载、耗电和应用流量')
  const [reading, packages, net, phoneClock, powerStats, healthSysfs] = await Promise.all([
    collectSample(serial, ctx, notes),
    read(serial, ctx, ['pm', 'list', 'packages', '-U', '--user', 'all'], notes, '应用 UID'),
    read(serial, ctx, ['dumpsys', 'netstats', '--full', '--uid'], notes, '流量统计'),
    read(serial, ctx, ['date', '+%s'], notes, '手机时间'),
    read(serial, ctx, ['dumpsys', 'batterystats', '-c'], notes, '应用耗电'),
    read(serial, ctx, [HEALTH_SYSFS], notes)
  ])
  const uids = parseUidPackages(packages || await read(serial, ctx, ['pm', 'list', 'packages', '-U'], notes))
  const { sample, history } = await recordSample(serial, reading.sample, ctx, notes)
  const time = sample.time
  const phoneTime = /^\d+$/.test(phoneClock.trim()) ? Number(phoneClock.trim()) * 1000 : undefined
  const traffic = phoneTime ? parseTraffic(net, uids, phoneTime - days * DAY, phoneTime) : undefined
  if (!traffic?.recognized) notes.push('系统流量历史不可用')
  const power = parseAppPower(powerStats, uids)
  const health = parseBatteryHealth(healthSysfs)
  return { ok: true, message: '监控数据已更新', monitor: {
    serial, time, days, sample, history: history.filter(s => s.time >= time - days * DAY),
    traffic: traffic?.recognized ? traffic.rows : undefined,
    trafficStart: traffic?.start, trafficEnd: traffic?.end,
    power: power.rows, powerSince: power.since,
    healthPercent: reading.health.healthPercent ?? health.healthPercent,
    cycles: reading.health.cycles ?? health.cycles,
    notes
  } }
}
