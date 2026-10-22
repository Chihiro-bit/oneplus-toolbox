import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/exec', () => ({ exec: vi.fn(), tools: {} }))
vi.mock('../src/main/ops/common', () => ({
  adb: vi.fn(), requireSystem: vi.fn(async () => 'phone'),
  OpError: class extends Error {}, REMOTE_DIR: '/data/local/tmp/toolbox',
  shq: (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
}))

import { adb, type OpContext } from '../src/main/ops/common'
import { debloat } from '../src/main/ops/apps'

const ctx = { signal: new AbortController().signal, log: vi.fn(), step: vi.fn(), device: vi.fn() } satisfies OpContext
const result = (stdout: string, code = 0) => ({ stdout, stderr: '', all: stdout, code })

describe('系统应用 Root 卸载', () => {
  beforeEach(() => vi.clearAllMocks())

  it('Root 模式也拒绝卸载必需组件及不合法包名', async () => {
    await expect(debloat('com.android.systemui', true, ctx, true)).rejects.toThrow('不允许卸载')
    await expect(debloat('com.example;reboot', true, ctx, true)).rejects.toThrow('包名不合法')
    expect(adb).not.toHaveBeenCalled()
  })

  it('未获 Root 授权时不执行卸载', async () => {
    vi.mocked(adb).mockResolvedValueOnce(result('Permission denied', 1))
    await expect(debloat('com.example.app', true, ctx, true)).rejects.toThrow('未获得 Root 权限')
    expect(adb).toHaveBeenCalledTimes(1)
  })

  it('授权后通过 su 执行当前用户卸载', async () => {
    vi.mocked(adb).mockResolvedValueOnce(result('0\n')).mockResolvedValueOnce(result('Success'))
    expect((await debloat('com.example.app', true, ctx, true)).ok).toBe(true)
    const args = vi.mocked(adb).mock.calls[1][1]
    expect(args[0]).toBe('shell')
    expect(args[1]).toContain('su -c')
    expect(args[1]).toContain('pm uninstall -k --user 0')
  })

  it('系统拒绝卸载时返回失败', async () => {
    vi.mocked(adb).mockResolvedValueOnce(result('0')).mockResolvedValueOnce(result('Failure [DELETE_FAILED_INTERNAL_ERROR]', 1))
    expect(await debloat('com.example.app', true, ctx, true)).toMatchObject({ ok: false, message: expect.stringContaining('系统仍拒绝') })
  })
})
