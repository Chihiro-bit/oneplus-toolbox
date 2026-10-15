import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

/**
 * 开机时读到的设备信息，按序列号记到 userData\devices.json。
 * Fastboot 下读不到品牌和系统版本，卡开机时更是只能进 Fastboot，
 * 这时就靠之前开机连接时记下的信息（例如校验刷回的原厂镜像与系统版本是否一致）。
 */
export interface KnownDevice {
  brand?: string
  manufacturer?: string
  model?: string
  /** ro.build.date.utc，与 ROM payload 的 max_timestamp 相同 */
  buildDateUtc?: string
  buildId?: string
  romVersion?: string
  /** 最后一次开机连接的时间 */
  seen: number
}

let cache: Record<string, KnownDevice> | undefined

const file = (): string => join(app.getPath('userData'), 'devices.json')

function load(): Record<string, KnownDevice> {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(file(), 'utf8'))
    } catch {
      cache = {}
    }
  }
  return cache!
}

export function getKnown(serial: string): KnownDevice | undefined {
  return load()[serial]
}

export function remember(serial: string, info: Omit<KnownDevice, 'seen'>): void {
  const all = load()
  const prev = all[serial]
  const next = { ...info, seen: Date.now() }
  all[serial] = next
  // 信息没变就不写盘（轮询每次状态变化都会调用）
  if (prev && JSON.stringify({ ...prev, seen: 0 }) === JSON.stringify({ ...next, seen: 0 })) return
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(all, null, 2))
  } catch {
    /* 写不进去只是少了离线信息 */
  }
}
