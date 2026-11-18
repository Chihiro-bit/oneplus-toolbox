import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, net } from 'electron'
import { OTA_API, parseOtaCatalog, type OtaCatalog } from '@shared/ota'

const REFRESH_INTERVAL = 15 * 60_000
const MAX_BYTES = 4 * 1024 * 1024
let checkedAt = 0
let cached: OtaCatalog | undefined
let pending: Promise<OtaCatalog> | undefined

interface Snapshot { etag?: string; raw: unknown }

async function load(): Promise<OtaCatalog> {
  const dir = app.getPath('userData')
  const file = join(dir, 'ota-catalog.json')
  let local: OtaCatalog | undefined, etag: string | undefined
  try {
    const value = (await readFile(file, 'utf8'))
    if (value.length > MAX_BYTES) throw new Error('本地目录超出大小限制')
    const snapshot = JSON.parse(value) as Snapshot
    local = parseOtaCatalog(snapshot.raw)
    etag = typeof snapshot.etag === 'string' && /^(?:W\/)?"[\w-]+"$/.test(snapshot.etag) ? snapshot.etag : undefined
  } catch { /* 缓存不存在或不可用 */ }

  try {
    const response = await net.fetch(OTA_API, {
      signal: AbortSignal.timeout(20_000), redirect: 'error',
      headers: { Accept: 'application/json', ...(etag ? { 'If-None-Match': etag } : {}) }
    })
    if (response.status === 304 && local) return local
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0, text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) {
        await reader.cancel()
        throw new Error('目录超出大小限制')
      }
      text += decoder.decode(value, { stream: true })
    }
    const raw: unknown = JSON.parse(text + decoder.decode())
    const catalog = parseOtaCatalog(raw)
    try {
      await mkdir(dir, { recursive: true })
      await writeFile(`${file}.tmp`, JSON.stringify({ etag: response.headers.get('etag'), raw }), 'utf8')
      await rename(`${file}.tmp`, file)
    } catch { /* 目录仍可在本次运行中使用 */ }
    return catalog
  } catch (error) {
    return {
      ...(local ?? cached ?? { entries: [] }), cached: !!(local ?? cached)?.entries.length,
      error: `在线目录读取失败：${(error as Error).message}`
    }
  }
}

export function getOtaCatalog(): Promise<OtaCatalog> {
  const interval = cached?.error ? 30_000 : REFRESH_INTERVAL
  if (cached && Date.now() - checkedAt < interval) return Promise.resolve(cached)
  return pending ??= load().then(result => {
    checkedAt = Date.now()
    cached = result
    return result
  }).finally(() => { pending = undefined })
}
