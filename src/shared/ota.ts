export const OTA_API = 'https://roms.danielspringer.at/api/ota.php'
export const OTA_DOCUMENTATION = 'https://roms.danielspringer.at/api/ota.php?format=html&help=1'

export interface OtaEntry {
  id: string
  device: string
  model: string
  region: string
  version: string
  otaVersion: string
  buildTime?: string
  size?: number
  md5?: string
  sha256?: string
  sourceUrl: string
}

export interface OtaCatalog {
  entries: OtaEntry[]
  updated?: string
  cached?: boolean
  error?: string
}

export interface VerifiedOta {
  path: string
  sha256: string
  entryId: string
  timestamp: string
}

export type OtaForDevice = VerifiedOta & { serial: string }
export type RomVerification = Pick<OtaForDevice, 'serial' | 'sha256'>

export type OtaDevice = {
  model?: string
  otaModel?: string
  buildId?: string
  otaVersion?: string
  otaRegion?: string
  buildDateUtc?: string
}

const MODEL = /^(?:CPH\d{4}[A-Z]*|[A-Z]{2,4}\d{3,5}[A-Z]*|ONEPLUS\s?[A-Z]?\d{4})$/i
const REGIONS: Record<string, string> = {
  CN: '中国大陆', EU: '欧洲', GLO: '全球', IN: '印度', NA: '北美', US: '美国', RU: '俄罗斯'
}

export function otaRegionLabel(region: string): string {
  return REGIONS[region] ? `${REGIONS[region]}（${region}）` : region
}

function text(value: unknown, length = 160): string {
  return typeof value === 'string' && value.length <= length ? value.trim() : ''
}

export function isOtaId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{16,64}$/.test(value)
}

export function officialOtaUrl(value: unknown): URL | undefined {
  const link = text(value, 4000)
  try {
    const url = new URL(link)
    const vendor = /\.(?:allawntech|allawnos|allawnfs|allawnofs)\.com$/i.test(url.hostname)
      || url.hostname === 'android.googleapis.com'
    if (vendor && url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash) return url
  } catch { /* 非 URL */ }
}

export function parseOtaCatalog(data: unknown): OtaCatalog {
  const raw = data as { api_version?: unknown; catalog_updated_at?: unknown; releases?: unknown[] }
  if (raw?.api_version !== '1' || !Array.isArray(raw.releases) || raw.releases.length > 20_000) {
    throw new Error('全量 OTA 目录格式不受支持')
  }
  const entries = new Map<string, OtaEntry>()
  for (const value of raw.releases) {
    if (!value || typeof value !== 'object') continue
    const row = value as Record<string, unknown>
    const id = text(row.id), label = text(row.device), model = text(row.model).toUpperCase()
    const region = text(row.region).toUpperCase(), version = text(row.version), otaVersion = text(row.ota_version)
    const source = officialOtaUrl(row.source_url)
    if (!isOtaId(id) || !/^(?:OP\s|OnePlus\b)/i.test(label) || !MODEL.test(model)
      || !/^[A-Z0-9-]{2,12}$/.test(region) || !version || !otaVersion || !source) continue
    const md5 = text(row.md5).toLowerCase(), sha256 = text(row.sha256).toLowerCase()
    entries.set(id, {
      id, device: label.replace(/^OP\s+/i, 'OnePlus '), model, region, version, otaVersion,
      sourceUrl: source.href, buildTime: text(row.build_timestamp) || undefined,
      size: typeof row.size === 'number' && Number.isSafeInteger(row.size) && row.size > 0 ? row.size : undefined,
      md5: /^[0-9a-f]{32}$/.test(md5) ? md5 : undefined,
      sha256: /^[0-9a-f]{64}$/.test(sha256) ? sha256 : undefined
    })
  }
  if (!entries.size) throw new Error('目录没有可用的一加全量包记录')
  return {
    entries: [...entries.values()].sort((a, b) =>
      (b.buildTime ?? '').localeCompare(a.buildTime ?? '') || b.version.localeCompare(a.version, 'en', { numeric: true })),
    updated: text(raw.catalog_updated_at) || undefined
  }
}

export function otaArchiveUrl(entry: OtaEntry): string {
  const url = new URL('https://roms.danielspringer.at/index.php')
  url.search = new URLSearchParams({
    view: 'ota',
    archive_device: entry.device.replace(/^OnePlus/i, 'Oneplus'),
    archive_region: entry.region
  }).toString()
  return url.href
}

export function otaDownloadPage(entry: OtaEntry): string {
  const source = officialOtaUrl(entry.sourceUrl)
  return source && /\.zip$/i.test(source.pathname) ? source.href : otaArchiveUrl(entry)
}

export function detectOtaRegion(buildId?: string, imageRegion?: string, regionMark?: string): string | undefined {
  if (/\(CN\d*\)$/i.test(buildId?.trim() ?? '')) return 'CN'
  const image = imageRegion?.trim().toUpperCase().split(/[_-]/)[0]
  if (image && ['CN', 'EU', 'EEA', 'IN', 'NA', 'US', 'GLO'].includes(image)) return image === 'EEA' ? 'EU' : image === 'US' ? 'NA' : image
  const mark = regionMark?.trim().toUpperCase()
  return mark && ['EU', 'EEA', 'IN', 'NA', 'US', 'GLO'].includes(mark)
    ? mark === 'EEA' ? 'EU' : mark === 'US' ? 'NA' : mark : undefined
}

function normalized(input?: string): string {
  return (input ?? '').trim().toLowerCase().replace(/^一加/, 'oneplus').replace(/[\s_-]+/g, '')
}

export function filterOtas(entries: OtaEntry[], model: string, region: string, version: string): OtaEntry[] {
  const query = normalized(model)
  const build = normalized(version)
  return entries.filter(entry =>
    (!query || normalized(entry.device).includes(query) || normalized(entry.model).includes(query)) &&
    (!region || entry.region === region) &&
    (!build || normalized(entry.version).includes(build) || normalized(entry.otaVersion).includes(build)))
}

/** EX01 covers several channels. Prefer a unique exact match instead of guessing a region. */
export function matchDeviceOta(entries: OtaEntry[], device: OtaDevice): OtaEntry | undefined {
  const model = device.otaModel ?? device.model
  if (!model || (!device.otaVersion && !device.buildId)) return undefined
  const results = entries.filter(entry =>
    normalized(entry.model) === normalized(model) &&
    (!device.otaRegion || entry.region === device.otaRegion) &&
    (device.otaVersion ? normalized(entry.otaVersion) === normalized(device.otaVersion)
      : normalized(entry.version) === normalized(device.buildId)))
  return results.length === 1 ? results[0] : undefined
}

export function fullOtaTimestamp(metadata: string): string | undefined {
  const fields = new Map<string, string>()
  for (const line of metadata.split(/\r?\n/)) {
    const field = line.match(/^([a-z][a-z0-9-]*)=(.*)$/)
    if (field) fields.set(field[1], field[2].trim())
  }
  const time = fields.get('post-timestamp')
  if (fields.has('pre-build') || fields.has('pre-build-incremental') || fields.get('ota-type') !== 'AB'
    || !time || !/^\d{9,11}$/.test(time)) return undefined
  return time
}
