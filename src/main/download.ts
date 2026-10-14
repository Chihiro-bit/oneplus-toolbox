import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app, net } from 'electron'
import type { LogLevel } from '@shared/types'
import { CancelledError } from './exec'

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/**
 * 下载文件到缓存目录并校验 sha256。缓存以哈希命名，校验通过的文件可重复使用。
 * 哈希不一致时删除文件并报错 —— 绝不使用未通过校验的文件。
 */
export async function downloadVerified(
  url: string,
  sha256: string,
  opts: { signal: AbortSignal; log: (l: LogLevel, t: string) => void; step: (t: string) => void; label: string }
): Promise<string> {
  const dir = join(app.getPath('userData'), 'apk-cache')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `${sha256.toLowerCase()}.apk`)
  if (existsSync(target) && (await sha256File(target)) === sha256.toLowerCase()) {
    opts.log('ok', `使用已缓存的 ${opts.label}`)
    return target
  }

  opts.step(`正在下载 ${opts.label}`)
  opts.log('cmd', `GET ${url}`)
  const res = await net.fetch(url, { signal: opts.signal } as RequestInit)
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
  const total = Number(res.headers.get('content-length')) || 0
  const tmp = `${target}.part`
  const hash = createHash('sha256')
  let got = 0
  let lastPct = -10
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    got += chunk.length
    if (total) {
      const pct = Math.floor((got / total) * 100)
      if (pct >= lastPct + 10) {
        lastPct = pct
        opts.step(`正在下载 ${opts.label}（${pct}%，${(got / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB）`)
      }
    }
  })
  try {
    await pipeline(body, createWriteStream(tmp))
  } catch (e) {
    rmSync(tmp, { force: true })
    if (opts.signal.aborted) throw new CancelledError()
    throw e
  }
  const actual = hash.digest('hex')
  if (actual !== sha256.toLowerCase()) {
    rmSync(tmp, { force: true })
    throw new Error(`${opts.label} 校验失败：期望 sha256 ${sha256}，实际 ${actual}。文件可能被篡改或下载不完整，已丢弃`)
  }
  renameSync(tmp, target)
  opts.log('ok', `${opts.label} 下载完成，sha256 校验通过`)
  return target
}
