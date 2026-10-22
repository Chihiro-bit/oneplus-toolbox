import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
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
  /** 投屏，随附的 DLL 和 scrcpy-server 必须与它同目录 */
  get scrcpy() { return join(binDir(), 'scrcpy', 'scrcpy.exe') },
  /** AAB 转分包 APK */
  get bundletool() { return join(binDir(), 'bundletool', 'bundletool.jar') },
  /** 随安装包的精简 Java 运行时（bundletool 用），用户不需要自己安装 Java */
  get java() { return join(binDir(), 'jre', 'bin', 'java.exe') },
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
  const started = Date.now()

  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    let all = ''
    const streams = [
      { decoder: new StringDecoder('utf8'), pending: '' },
      { decoder: new StringDecoder('utf8'), pending: '' }
    ]
    let settled = false

    const flush = (stream: typeof streams[number], final = false): void => {
      if (!log || !echoOutput) return
      const parts = stream.pending.split(/\r\n|[\r\n]/)
      stream.pending = final ? '' : parts.pop() ?? ''
      for (const line of parts) if (line.trim()) log('info', line.trimEnd())
    }
    const collect = (isErr: boolean, s: string): void => {
      if (isErr) stderr += s
      else stdout += s
      all += s
      if (echoOutput) {
        const stream = streams[Number(isErr)]
        stream.pending += s
        flush(stream)
      }
    }
    const onData = (isErr: boolean) => (buf: Buffer): void => {
      if (!settled) collect(isErr, streams[Number(isErr)].decoder.write(buf))
    }
    child.stdout.on('data', onData(false))
    child.stderr.on('data', onData(true))

    const finish = (fn: () => void): void => {
      if (settled) return
      for (const [i, stream] of streams.entries()) {
        collect(i === 1, stream.decoder.end())
        flush(stream, true)
      }
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      fn()
    }
    const onAbort = (): void => {
      child.kill()
      finish(() => {
        log?.('warn', `命令已取消（耗时 ${Date.now() - started} ms）`)
        reject(new CancelledError())
      })
    }
    signal?.addEventListener('abort', onAbort)
    const timer = setTimeout(() => {
      child.kill()
      finish(() => {
        log?.('error', `命令超时（限制 ${timeoutMs} ms，耗时 ${Date.now() - started} ms）`)
        resolve({ code: -1, stdout, stderr: stderr + '\n[超时]', all: all + '\n[超时]' })
      })
    }, timeoutMs)

    child.on('error', (err) => finish(() => {
      log?.('error', `命令执行错误：${err.message}（耗时 ${Date.now() - started} ms）`)
      reject(err)
    }))
    child.on('close', (code) => {
      finish(() => {
        log?.(code === 0 ? 'info' : 'error', `命令结束：退出码 ${code ?? -1}，耗时 ${Date.now() - started} ms${echoOutput ? '' : '（此命令的输出为内部数据，不在日志中显示）'}`)
        resolve({ code: code ?? -1, stdout, stderr, all })
      })
    })

    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

function quoteForLog(a: string): string {
  // 仅用于展示（不作为 shell 命令执行），完整保留多行脚本及参数边界。
  return !a || /[\s"\\]/.test(a) ? `"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : a
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
