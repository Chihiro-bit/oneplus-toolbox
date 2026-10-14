import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, net } from 'electron'
import { BUILTIN_CATALOG, mergeCatalog, validateCatalog } from '@shared/catalog'
import type { CatalogState, RootScheme } from '@shared/types'
import { loadSettings } from './settings'

let cached: CatalogState | null = null

function cacheFile(): string {
  return join(app.getPath('userData'), 'catalog-cache.json')
}

/** 读取方案目录：配置了远程地址就拉取并校验，失败时退回本地缓存，再退回内置目录 */
export async function getCatalog(refresh = false): Promise<CatalogState> {
  if (cached && !refresh) return cached
  const { catalogUrl } = loadSettings()
  if (!catalogUrl) return (cached = { schemes: BUILTIN_CATALOG.schemes, source: 'builtin' })
  try {
    const res = await net.fetch(catalogUrl, { cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const remote = validateCatalog(await res.json())
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(cacheFile(), JSON.stringify(remote, null, 2))
    return (cached = { schemes: mergeCatalog(remote), source: 'remote' })
  } catch (e) {
    const error = `远程目录读取失败：${(e as Error).message}`
    try {
      const local = validateCatalog(JSON.parse(readFileSync(cacheFile(), 'utf8')))
      return (cached = { schemes: mergeCatalog(local), source: 'cache', error })
    } catch {
      return (cached = { schemes: BUILTIN_CATALOG.schemes, source: 'builtin', error })
    }
  }
}

export async function findScheme(id: string): Promise<RootScheme | undefined> {
  return (await getCatalog()).schemes.find((s) => s.id === id)
}
