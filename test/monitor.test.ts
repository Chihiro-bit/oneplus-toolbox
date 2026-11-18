import { describe, expect, it } from 'vitest'
import { isNewTemperatureEvent, parseAppPower, parseBatteryHealth, parseBatteryStatus, parseCpu, parseTemperature, parseTraffic, parseUidPackages, summarizeDrain, type TemperatureSample } from '../src/shared/monitor'

describe('温度与 CPU 解析', () => {
  it('温度以 0.1°C 为单位，拒绝未知及异常读数', () => {
    expect(parseTemperature('  temperature: 387\n')).toBe(38.7)
    expect(parseTemperature('temperature: -50')).toBe(-5)
    expect(parseTemperature('Permission denied')).toBeUndefined()
    expect(parseTemperature('temperature: 9999')).toBeUndefined()
  })
  it('合并应用子进程，排除 TOTAL 汇总，保留系统进程', () => {
    expect(parseCpu(`CPU usage from 1200ms to 0ms ago:
  12% 123/com.example.app: 8% user + 4% kernel
  3.5% 124/com.example.app:worker: 3.5% user
  8% 50/system_server: 8% user
  23.5% TOTAL: 20% user
`)).toEqual([{ name: 'com.example.app', percent: 15.5 }, { name: 'system_server', percent: 8 }])
  })
})

const identities = parseUidPackages('package:com.example.a uid:10001\npackage:com.example.b uid:10001\npackage:com.example.c uid:10002')

describe('耗电和高温事件', () => {
  const at = (minute: number, changes: Partial<TemperatureSample> = {}): TemperatureSample =>
    ({ time: minute * 60_000, cpu: [], screenOn: false, charging: false, level: 80, battery: 44, ...changes })

  it('从 Android 累计窗口提取 UID 耗电，排除设备组件和其它窗口', () => {
    const report = parseAppPower([
      '9,0,l,bt,0,51686442,34680056,61537447,44531061,1794909905041,23196976,6190584,6000',
      '9,0,l,pws,6000,3888,3888,3888',
      '9,0,l,pwi,scrn,1176,1,0,0',
      '9,10001,l,pwi,uid,320,1,0,0',
      '9,10002,u,pwi,uid,600,1,0,0',
      '9,10002,l,pwi,uid,2.3e-2,1,0,0',
      '9,10002,l,pwi,uid,,1,0,0'
    ].join('\n'), identities)
    expect(report).toEqual({ since: 1794909905041, rows: [
      { uid: 10001, packages: ['com.example.a', 'com.example.b'], mah: 320 },
      { uid: 10002, packages: ['com.example.c'], mah: 0.023 }
    ] })
    expect(parseAppPower('Permission Denial', identities).rows).toBeUndefined()
  })

  it('掉电速率排除断连、充电、切换屏幕与状态未知，保留最长连续待机', () => {
    const result = summarizeDrain([
      at(0), at(1, { level: 79 }), at(2, { level: 78 }),
      at(6, { level: 75 }), at(7, { level: 74, screenOn: true }),
      at(8, { level: 73, screenOn: true }), at(9, { level: 75, charging: true }),
      at(10, { level: 74, charging: undefined })
    ])
    expect(result).toEqual({
      screen: { duration: 60_000, drop: 1 },
      standby: { duration: 120_000, drop: 2 },
      longest: { from: 0, until: 120_000, drop: 2 }
    })
  })

  it('三次连续高温后只触发一次，恢复正常或间隔过长后重新计算', () => {
    expect(isNewTemperatureEvent([at(0), at(1)], at(2))).toBe(true)
    expect(isNewTemperatureEvent([at(0), at(0.2)], at(0.4))).toBe(false)
    expect(isNewTemperatureEvent([at(0), at(1), at(2, { highTemperatureEvent: true })], at(3))).toBe(false)
    expect(isNewTemperatureEvent([at(0), at(1), at(2, { battery: 41 }), at(3)], at(4))).toBe(false)
    expect(isNewTemperatureEvent([at(0), at(1)], at(4))).toBe(false)
  })

  it('只使用明确的电池字段，兼容模拟状态和厂商可选信息', () => {
    const battery = 'AC powered: false\nUSB powered: false\nWireless powered: false\nlevel: 40\nscale: 100\nhealth: 2'
    expect(parseBatteryStatus(battery, 'mWakefulness=Dozing')).toEqual({ level: 40, screenOn: false, charging: false })
    expect(parseBatteryStatus(`UPDATES STOPPED\n${battery}`, 'mWakefulness=Awake')).toEqual({})
    expect(parseBatteryHealth(battery).healthPercent).toBeUndefined()
    expect(parseBatteryHealth('cycle_count: 88\nsoh: 96')).toEqual({ cycles: 88, healthPercent: 96 })
  })
})
const bucket = (network: string, uid: number, set: string, tag: string, bytes: number, start = 1000) => `  ident=[{type=${network}, metered=false}] uid=${uid} set=${set} tag=${tag}
    NetworkStatsHistory: bucketDuration=1000
      st=${start} rb=${bytes} rp=1 tb=20 tp=1 op=0
`

describe('近期应用流量', () => {
  it('兼容真机的秒时间戳及桶时长，与毫秒格式结果一致', () => {
    const sec = 1_794_960_000
    const compact = `UID stats:\n${bucket('1', 10001, 'DEFAULT', '0x0', 100, sec).replace('bucketDuration=1000', 'bucketDuration=3600')}`
    const millis = compact.replace(`st=${sec}`, `st=${sec * 1000}`).replace('bucketDuration=3600', 'bucketDuration=3600000')
    const from = (sec + 1800) * 1000, until = (sec + 3600) * 1000
    expect(parseTraffic(compact, identities, from, until)).toEqual(parseTraffic(millis, identities, from, until))
    expect(parseTraffic(compact, identities, from, until).rows[0].wifi).toBe(60)
  })
  it('合并前后台与网络；排除 dev/xt、tag 和 debug 统计，避免重复计算', () => {
    const text = `Dev stats:\n${bucket('WIFI', 10001, 'DEFAULT', '0x0', 9999)}
Xt stats:\n${bucket('WIFI', 10001, 'DEFAULT', '0x0', 9999)}
UID stats:\n${bucket('WIFI', 10001, 'DEFAULT', '0x0', 100)}${bucket('MOBILE', 10001, 'FOREGROUND', '0x0', 200)}${bucket('WIFI', 10001, 'DBG_VPN_IN', '0x0', 9999)}${bucket('WIFI', 10001, 'DEFAULT', '0x42', 9999)}${bucket('WIFI', 10002, 'DEFAULT', '0x0', 400)}
UID tag stats:\n${bucket('WIFI', 10001, 'DEFAULT', '0x0', 9999)}`
    const result = parseTraffic(text, identities, 1000, 2000)
    expect(result.recognized).toBe(true)
    expect(result.rows.map(r => r.uid)).toEqual([10002, 10001])
    expect(result.rows[1]).toEqual({ uid: 10001, packages: ['com.example.a', 'com.example.b'], mobile: 220, wifi: 120, other: 0, rx: 300, tx: 40 })
  })
  it('边界桶按比例估算，排除窗口外历史；未知 UID 仍保留', () => {
    const result = parseTraffic(`UID stats:\n${bucket('1', 999, '0', '0', 100)}${bucket('0', 999, '1', '0', 100, 3000)}`, identities, 1500, 2000)
    expect(result.rows).toEqual([{ uid: 999, packages: [], wifi: 60, mobile: 0, other: 0, rx: 50, tx: 10 }])
    expect(result.start).toBe(1500)
    expect(result.end).toBe(2000)
  })
  it('无历史、权限失败及不支持格式不伪装成零流量', () => {
    expect(parseTraffic('Permission Denial', identities, 0, 2000).recognized).toBe(false)
    expect(parseTraffic('UID stats:\nunknown vendor format', identities, 0, 2000).recognized).toBe(false)
    expect(parseTraffic(`UID stats:\n${bucket('WIFI', 10001, 'DEFAULT', '0x0', 100, 3000)}`, identities, 0, 2000)).toMatchObject({ recognized: true, rows: [] })
  })
  it('可解析长字段名并将未知网络单独计入全部流量', () => {
    const result = parseTraffic(`UID stats:\n${bucket('ETHERNET', 10001, 'DEFAULT', '0x0', 100).replace('st=', 'bucketStart=').replace('rb=', 'rxBytes=').replace('tb=', 'txBytes=')}`, identities, 1000, 2000)
    expect(result.rows[0].other).toBe(120)
  })
})
