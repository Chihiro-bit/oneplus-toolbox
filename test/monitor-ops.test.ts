import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/ops/common', () => ({
  adb: vi.fn(), requireSystem: vi.fn(async () => 'phone-a'), OpError: class extends Error {}
}))
vi.mock('electron', () => ({ app: { getPath: () => 'test-user-data' } }))
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), rename: vi.fn() }))

import { readFile, writeFile, rename } from 'node:fs/promises'
import { adb, requireSystem, type OpContext } from '../src/main/ops/common'
import { monitor } from '../src/main/ops/monitor'

const ctx = (): OpContext => ({ signal: new AbortController().signal, log: vi.fn(), step: vi.fn(), device: vi.fn() })
const result = (stdout: string, code = 0) => ({ stdout, stderr: '', all: stdout, code })

describe('监控采集与设备隔离', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(requireSystem).mockResolvedValue('phone-a')
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error(), { code: 'ENOENT' }))
    vi.mocked(adb).mockImplementation(async (_serial, args) => {
      if (args.includes('battery')) return result('temperature: 382\nUSB powered: true')
      if (args.includes('cpuinfo')) return result('CPU usage from 1000ms to 0ms ago:\n  12% 123/com.example.app: 12% user')
      if (args.includes('packages')) return result('package:com.example.app uid:10001')
      if (args.includes('date')) return result(String(Math.floor(Date.now() / 1000)))
      return result('Permission Denial', 1)
    })
  })
  it('流量权限不足仍提供温度，显式标记未知且不需要 Root', async () => {
    const r = await monitor(1, ctx())
    expect(r.monitor?.sample).toMatchObject({ battery: 38.2, charging: true, cpu: [{ name: 'com.example.app', percent: 12 }] })
    expect(r.monitor?.traffic).toBeUndefined()
    expect(r.monitor?.notes.join(' ')).toContain('流量统计读取失败')
    expect(vi.mocked(adb).mock.calls.some(([, args]) => args.includes('--uid'))).toBe(true)
    expect(vi.mocked(adb).mock.calls.every(([serial, args]) => serial === 'phone-a' && !args.includes('su'))).toBe(true)
    expect(rename).toHaveBeenCalledOnce()
  })
  it('清理过期数据，并为不同设备使用不同历史文件', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify([
      { time: Date.now() - 8 * 86400000, battery: 32, cpu: [] },
      { time: Date.now() - 100000, battery: 36, cpu: [] }
    ]))
    const r = await monitor(7, ctx())
    expect(r.monitor?.history).toHaveLength(2)
    vi.mocked(requireSystem).mockResolvedValue('phone-b')
    await monitor(1, ctx())
    expect(vi.mocked(writeFile).mock.calls[0][0]).not.toBe(vi.mocked(writeFile).mock.calls[1][0])
  })
  it('取消不保存残缺记录', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(monitor(1, { ...ctx(), signal: controller.signal })).rejects.toThrow('取消')
    expect(writeFile).not.toHaveBeenCalled()
  })
  it('非法范围不会执行手机命令', async () => {
    await expect(monitor(30 as 1, ctx())).rejects.toThrow('24 小时或 7 天')
    expect(adb).not.toHaveBeenCalled()
  })
  it('保存失败时保留当前数据并告知用户', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full'))
    const r = await monitor(1, ctx())
    expect(r.monitor?.sample.battery).toBe(38.2)
    expect(r.monitor?.notes.join(' ')).toContain('无法保存')
  })
})
