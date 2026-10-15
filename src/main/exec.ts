import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { LogLevel } from '@shared/types'

/** 打包后工具在 resources/bin，开发时在项目的 resources/bin */
export function binDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'bin')
    : join(app.getAppPath(), 'resources', 'bin')
}

export const tools = {
  get adb() { return join(binDir(), 'platform-tools', 'adb.exe') },
  get fastboot() { return join(binDir(), 'platform-tools', 'fastboot.exe') },
  get sevenZip() { return join(binDir(), '7za.exe') },
  /** payload-dumper-rust：支持 payload.bin、ROM zip 和 http(s) URL（按需读取） */
  get payloadDumper() { return join(binDir(), 'payload_dumper.exe') },
  get magiskApk() { return join(binDir(), 'magisk.apk') },
  /** Android 端的 aapt2，推到手机上读取应用名 */
  get aapt2() { return join(binDir(), 'aapt2') },
  /** 高通 9008 / EDL 刷写工具，随附的 DLL 必须与它同目录 */
  get qdl() { return join(binDir(), 'qdl', 'qdl.exe') }
}

export function missingTools(): string[] {
  return Object.entries(tools)
    .filter(([, p]) => !existsSync(p))
    .map(([k]) => k)
}

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
  /** stdout + stderr（fastboot 把大部分信息写在 stderr） */
  all: string
}

export interface ExecOptions {
  signal?: AbortSignal
  timeoutMs?: number
  /** 把输出逐行写入日志 */
  log?: (level: LogLevel, text: string) => void
  /** 写入日志时是否附带输出行（默认 true） */
  echoOutput?: boolean
  stdin?: string
}

export class CancelledError extends Error {
  constructor() {
    super('操作已取消')
  }
}

export function exec(file: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const { signal, timeoutMs = 60_000, log, echoOutput = true } = opts
  if (signal?.aborted) return Promise.reject(new CancelledError())
  log?.('cmd', `${basename(file, '.exe')} ${args.map(quoteForLog).join(' ')}`)

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let all = ''
    let pending = ''
    let settled = false

    const flush = (final = false): void => {
      if (!log || !echoOutput) return
      const parts = pending.split(/\r?\n|\r/)
      pending = final ? '' : parts.pop() ?? ''
      for (const line of parts) if (line.trim()) log('info', line.trimEnd())
    }
    const onData = (isErr: boolean) => (buf: Buffer): void => {
      const s = buf.toString('utf8')
      if (isErr) stderr += s
      else stdout += s
      all += s
      pending += s
      flush()
    }
    child.stdout.on('data', onData(false))
    child.stderr.on('data', onData(true))

    const finish = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = (): void => {
      child.kill()
      finish(() => reject(new CancelledError()))
    }
    signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => {
      child.kill()
      finish(() => resolve({ code: -1, stdout, stderr: stderr + '\n[超时]', all: all + '\n[超时]' }))
    }, timeoutMs)

    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => {
      flush(true)
      finish(() => resolve({ code: code ?? -1, stdout, stderr, all }))
    })

    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

function quoteForLog(a: string): string {
  // 多行 shell 脚本只显示第一行，避免刷屏
  if (a.includes('\n')) return `"${a.split('\n')[0]} …"（共 ${a.split('\n').length} 行脚本）`
  return /[\s"]/.test(a) ? `"${a}"` : a
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      reject(new CancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
