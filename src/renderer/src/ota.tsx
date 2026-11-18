import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, FileCheck, RefreshCw, Smartphone } from 'lucide-react'
import {
  filterOtas, matchDeviceOta, OTA_DOCUMENTATION, otaArchiveUrl, otaDownloadPage, otaRegionLabel,
  type OtaCatalog, type OtaEntry, type OtaForDevice, type VerifiedOta
} from '@shared/ota'
import { PageHeader, type PageProps } from './pages'
import { Callout, Card } from './ui'

const PAGE_SIZE = 12
const sizeLabel = (bytes?: number) => bytes ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : '未提供'
const empty = { model: '', region: '', version: '' }
type Target = 'root' | 'rescue'

export function OtaPage({ tb, useOta }: PageProps & { useOta: (page: Target, ota: OtaForDevice) => void }) {
  const device = tb.device
  const hasDevice = !!device.serial && !device.needsPick && ['system', 'fastboot', 'fastbootd'].includes(device.mode)
  const deviceFilter = hasDevice ? {
    model: device.otaModel ?? device.model ?? '',
    region: device.otaRegion ?? '',
    version: device.otaVersion ?? device.buildId ?? ''
  } : empty
  const [catalog, setCatalog] = useState<OtaCatalog>()
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<typeof empty>()
  const [selected, setSelected] = useState<string>()
  const [verified, setVerified] = useState<VerifiedOta>()
  const [picking, setPicking] = useState(false)
  const [page, setPage] = useState(0)
  const detail = useRef<HTMLDivElement>(null)
  const currentFilters = filters ?? deviceFilter

  const refresh = async () => {
    setLoading(true)
    try { setCatalog(await window.toolbox.getOtaCatalog()) }
    catch { setCatalog(previous => ({ entries: previous?.entries ?? [], cached: !!previous?.entries.length, error: '在线目录读取失败' })) }
    finally { setLoading(false) }
  }

  useEffect(() => { void refresh() }, [])
  const entries = catalog?.entries ?? []
  const exact = hasDevice ? matchDeviceOta(entries, device) : undefined
  const regions = useMemo(() => [...new Set(filterOtas(entries, currentFilters.model, '', '').map(row => row.region))].sort(), [entries, currentFilters.model])
  const results = filterOtas(entries, currentFilters.model, currentFilters.region, currentFilters.version)
  const currentPage = Math.min(page, Math.max(0, Math.ceil(results.length / PAGE_SIZE) - 1))
  const shown = results.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const active = results.find(ota => ota.id === selected) ?? results.find(ota => ota.id === exact?.id) ?? (results.length === 1 ? results[0] : undefined)
  const selectedOta = verified?.entryId === active?.id ? verified : undefined
  const compatible = selectedOta && exact?.id === active?.id && device.otaRegion === active?.region
    && selectedOta.timestamp === device.buildDateUtc && device.serial
    ? { ...selectedOta, serial: device.serial } : undefined

  const changeFilters = (next: typeof empty | undefined) => {
    setFilters(next)
    setSelected(undefined)
    setPage(0)
  }

  const verify = async (entry: OtaEntry) => {
    setPicking(true)
    try {
      const path = await window.toolbox.pickFile('选择下载好的全量 OTA ZIP', ['zip'])
      if (!path) return
      setVerified(undefined)
      const result = await tb.start('校验本地全量 OTA', { kind: 'verifyOta', id: entry.id, path })
      if (result.ok && result.ota) setVerified(result.ota)
    } finally { setPicking(false) }
  }

  return <>
    <PageHeader title="全量 OTA" desc="按一加机型、地区和构建号查找全量包，下载后可校验本地 ZIP" />
    <div className="stack">
      <Card>
        <div className="card-head">
          <h3 className="card-title">查询固件</h3>
          <button className="btn btn-secondary" disabled={loading} onClick={() => void refresh()}>
            <RefreshCw size={15} className={loading ? 'spin' : ''} /> {loading ? '正在读取目录' : '刷新目录'}
          </button>
        </div>
        <div className="ota-fields">
          <label>机型或型号<input value={currentFilters.model} placeholder="例如 一加 13 或 PJZ110"
            onChange={event => changeFilters({ model: event.target.value, region: '', version: filters?.version ?? '' })} /></label>
          <label>地区<select value={currentFilters.region} onChange={event => changeFilters({ ...currentFilters, region: event.target.value })}>
            <option value="">全部地区</option>
            {currentFilters.region && !regions.includes(currentFilters.region) &&
              <option value={currentFilters.region}>{otaRegionLabel(currentFilters.region)}</option>}
            {regions.map(region => <option key={region} value={region}>{otaRegionLabel(region)}</option>)}
          </select></label>
          <label>系统版本或构建号<input value={currentFilters.version} placeholder="例如 16.0.10.501"
            onChange={event => changeFilters({ ...currentFilters, version: event.target.value })} /></label>
        </div>
        <div className="card-actions">
          <button className="btn btn-secondary" disabled={!deviceFilter.model} onClick={() => changeFilters(undefined)}><Smartphone size={15} /> 使用当前设备</button>
          <button className="btn btn-ghost" onClick={() => changeFilters({ ...currentFilters, version: '' })}>查看该机型其他版本</button>
          <button className="btn btn-ghost" onClick={() => changeFilters(empty)}>清空筛选</button>
        </div>
        {hasDevice && deviceFilter.version && <p className="small muted">
          {device.mode === 'system' ? '当前设备' : '上次开机记录'} · {device.otaModel ?? device.model} · {device.buildId ?? deviceFilter.version}
          {!device.otaRegion && ' · 未识别固件地区'}
          {exact ? ' · 目录有同版本条目' : loading ? '' : ' · 未找到唯一的同版本条目'}
        </p>}
        {catalog?.error && <Callout tone="warn">{catalog.error}{catalog.cached ? '。显示上次缓存的目录。' : ''}</Callout>}
        <p className="small muted">
          来源 <button className="ota-text-button" onClick={() => void window.toolbox.openExternal(OTA_DOCUMENTATION)}>Daniel Springer ROM Archive</button>
          {catalog?.updated && <> · 目录更新时间 {catalog.updated.slice(0, 10)}</>}
        </p>
      </Card>

      {results.length > 1 ? <Card>
        <div className="card-head"><h3 className="card-title">查询结果</h3><span className="small muted">{results.length} 个版本</span></div>
        <div className="monitor-table-wrap">
          <table className="monitor-table">
            <thead><tr><th>版本</th><th>机型 / 地区</th><th>大小</th><th>详情</th></tr></thead>
            <tbody>{shown.map(entry => <tr key={entry.id} className={entry.id === active?.id ? 'ota-selected' : undefined}>
              <td><strong>{entry.version}</strong>{entry.id === exact?.id && <span className="chip ota-match">同版本</span>}</td>
              <td>{entry.device}<div className="small muted">{entry.model} · {otaRegionLabel(entry.region)}</div></td>
              <td>{sizeLabel(entry.size)}</td>
              <td><button className="btn btn-ghost" aria-pressed={entry.id === active?.id} onClick={() => {
                setSelected(entry.id)
                requestAnimationFrame(() => detail.current?.scrollIntoView({ block: 'nearest' }))
              }}>查看</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        {results.length > PAGE_SIZE && <div className="card-actions">
          <button className="btn btn-secondary" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</button>
          <span className="small muted">{currentPage + 1} / {Math.ceil(results.length / PAGE_SIZE)}</span>
          <button className="btn btn-secondary" disabled={(currentPage + 1) * PAGE_SIZE >= results.length} onClick={() => setPage(currentPage + 1)}>下一页</button>
        </div>}
      </Card> : !loading && !results.length && <Card><p className="muted">{catalog?.error && !entries.length ? '目录暂不可用，可稍后刷新。' : '没有匹配的记录。可清除版本筛选，或检查型号和地区。'}</p></Card>}

      {active && <div ref={detail}><Card>
        <h3 className="card-title">{active.version}{active.id === exact?.id && <span className="chip ota-match">同版本</span>}</h3>
        <p className="small muted">{active.device} · {active.model} · {otaRegionLabel(active.region)}</p>
        <p className="small muted">构建号 <code>{active.otaVersion}</code> · {sizeLabel(active.size)}</p>
        {active.sha256 && <p className="small ota-digest">目录 SHA-256 <code>{active.sha256}</code></p>}
        {active.md5 && <p className="small ota-digest">目录 MD5 <code>{active.md5}</code></p>}
        {!active.md5 && !active.sha256 && <p className="small muted">目录未提供摘要，可查看下载来源，本页无法校验该版本。</p>}
        <div className="card-actions">
          <button className="btn btn-primary" onClick={() => void window.toolbox.openExternal(otaDownloadPage(active))}>
            <ExternalLink size={15} /> 打开下载来源
          </button>
          {otaDownloadPage(active) !== otaArchiveUrl(active) && <button className="btn btn-ghost" onClick={() => void window.toolbox.openExternal(otaArchiveUrl(active))}>打开目录来源页</button>}
          <button className="btn btn-secondary" disabled={picking || tb.run.running || (!active.md5 && !active.sha256)} onClick={() => void verify(active)}>
            <FileCheck size={15} /> 校验下载好的 ZIP
          </button>
        </div>
        <p className="muted small">若打开的是来源页，请选同一地区和构建号。工具箱会按目录摘要检查文件，并确认 ZIP 内含全量 A/B OTA 元数据和 payload.bin。</p>
        {selectedOta && <>
          <p className="small ota-digest">本地文件 SHA-256 <code>{selectedOta.sha256}</code></p>
          {compatible ? <div className="card-actions">
            <button className="btn btn-secondary" disabled={tb.run.running || device.mode !== 'system'} onClick={() => useOta('root', compatible)}>填入一键 Root</button>
            <button className="btn btn-secondary" disabled={tb.run.running} onClick={() => useOta('rescue', compatible)}>填入救援与恢复</button>
          </div> : <p className="small muted">已校验 ZIP。匹配到手机的机型、地区、版本及构建时间后，可填入 Root 或恢复页。</p>}
        </>}
      </Card></div>}
    </div>
  </>
}
