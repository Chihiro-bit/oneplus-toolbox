import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
import { spawn } from 'node:child_process'
import { CancelledError, exec } from '../src/main/exec'

function processStub() {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn()
  })
}

describe('命令日志完整性', () => {
  beforeEach(() => vi.clearAllMocks())

  it('完整记录多行命令、分块中文和两个输出流的末行', async () => {
    const child = processStub()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const log = vi.fn()
    const task = exec('adb.exe', ['shell', 'echo first\necho second\necho third'], { log })
    const chinese = Buffer.from('中文输出')
    child.stdout.write(chinese.subarray(0, 2))
    child.stderr.write(Buffer.from('错误流'))
    child.stdout.write(chinese.subarray(2))
    child.emit('close', 0)
    const r = await task
    expect(log.mock.calls[0][1]).toContain('echo first\necho second\necho third')
    expect(r.stdout).toBe('中文输出')
    expect(log.mock.calls).toContainEqual(['info', '中文输出'])
    expect(log.mock.calls).toContainEqual(['info', '错误流'])
    expect(log.mock.calls.at(-1)?.[1]).toContain('退出码 0')
  })

  it('超时和取消保留末行并只记录一次终止原因', async () => {
    vi.useFakeTimers()
    try {
      const child = processStub()
      vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
      const log = vi.fn()
      const task = exec('adb.exe', [], { log, timeoutMs: 100 })
      child.stdout.write('尚未换行')
      await vi.advanceTimersByTimeAsync(100)
      expect((await task).code).toBe(-1)
      child.emit('close', 1)
      expect(log.mock.calls).toContainEqual(['info', '尚未换行'])
      expect(log.mock.calls.filter(([level]) => level === 'error')).toHaveLength(1)

      const controller = new AbortController()
      const cancelled = exec('adb.exe', [], { log, signal: controller.signal })
      const assertion = expect(cancelled).rejects.toBeInstanceOf(CancelledError)
      child.stderr.write('取消前的输出')
      controller.abort()
      await assertion
      expect(log.mock.calls).toContainEqual(['info', '取消前的输出'])
      expect(log.mock.calls.at(-1)?.[1]).toContain('命令已取消')
    } finally { vi.useRealTimers() }
  })

  it('启动失败记录错误，隐藏内部数据时仍记录命令结果', async () => {
    const child = processStub()
    vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
    const log = vi.fn()
    const failed = exec('missing.exe', [], { log })
    const assertion = expect(failed).rejects.toThrow('ENOENT')
    child.emit('error', new Error('ENOENT'))
    await assertion
    expect(log.mock.calls.at(-1)?.[1]).toContain('ENOENT')

    const hidden = exec('adb.exe', [], { log, echoOutput: false })
    child.stdout.write('base64 internal data')
    child.emit('close', 1)
    expect((await hidden).stdout).toBe('base64 internal data')
    expect(log.mock.calls.some(([, text]) => text.includes('base64 internal data'))).toBe(false)
    expect(log.mock.calls.at(-1)?.[1]).toContain('退出码 1')
  })
})
