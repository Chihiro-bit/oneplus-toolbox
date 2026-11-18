import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Package, X } from 'lucide-react'
import { summarizeDrain, type MonitorApp, type MonitorState, type TemperatureSample } from '@shared/monitor'
import { Card } from './ui'

export const stamp = (time: number) => new Date(time).toLocaleString('zh-CN', { hour12: false })

export function bytes(value: number) {
  const unit = value >= 1 ? Math.min(3, Math.floor(Math.log(value) / Math.log(1024))) : 0
  return `${(value / 1024 ** unit).toFixed(unit ? 2 : 0)} ${['B', 'KB', 'MB', 'GB'][unit]}`
}

export interface AppTarget {
  packages: string[]
  uid?: number
  rank?: number
}

type Metadata = Record<string, MonitorApp>

function appLabel(target: AppTarget, metadata: Metadata) {
  return target.packages.map(p => metadata[p]?.label ?? p).join(' / ') || '未识别应用 / 系统服务'
}

function AppIcon({ icon }: { icon?: string }) {
  const [failed, setFailed] = useState(false)
  return <span className="monitor-app-icon" aria-hidden="true">
    {icon && !failed ? <img src={icon} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Package size={17} />}
  </span>
}

export function AppIdentity({ target, metadata, onOpen }: {
  target: AppTarget; metadata: Metadata; onOpen: (target: AppTarget) => void
}) {
  const icon = metadata[target.packages[0]]?.icon
  return <button type="button" className="monitor-app-link" onClick={() => onOpen(target)}>
    <AppIcon key={icon} icon={icon} />
    <span>
      <strong>{target.rank ? `${target.rank}. ` : ''}{appLabel(target, metadata)}</strong>
      {target.uid !== undefined && <small>UID {target.uid}{target.packages.length > 1 ? ' · 共享 UID' : ''}</small>}
    </span>
  </button>
}

const mah = (value: number) => `${value.toLocaleString('zh-CN', { maximumSignificantDigits: 3 })} mAh`
const percent = (value: number) => value.toFixed(1)

function durationLabel(ms: number) {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

function DrainRate({ title, duration, drop }: { title: string; duration: number; drop: number }) {
  return <div className="monitor-drain-stat">
    <span className="muted">{title}</span>
    <strong>{duration >= 15 * 60_000 ? `${percent(drop * 3_600_000 / duration)}% / 小时` : '待累积'}</strong>
    <span className="small muted">{duration ? `已记录 ${durationLabel(duration)}，掉电 ${percent(drop)} 个百分点` : '暂无有效记录'}</span>
  </div>
}

export function BatteryInsights({ history, data, identity }: {
  history: TemperatureSample[]; data?: MonitorState; identity: (target: AppTarget) => ReactNode
}) {
  const drain = summarizeDrain(history)
  const latest = history.at(-1)
  const power = data?.power
  const [expanded, setExpanded] = useState(false)
  return <>
    <Card>
      <h3 className="card-title">电量与待机掉电</h3>
      <div className="monitor-drain-grid">
        <div className="monitor-drain-stat">
          <span className="muted">电池状态</span>
          <strong>{latest?.level === undefined ? '不可用' : `${Math.round(latest.level)}%`}</strong>
          <span className="small muted">健康度 {data?.healthPercent === undefined ? '未提供' : `${data.healthPercent}%`} · 循环次数 {data?.cycles ?? '未提供'}</span>
        </div>
        <DrainRate title="亮屏掉电" {...drain.screen} />
        <DrainRate title="待机掉电" {...drain.standby} />
      </div>
      <p className="small muted">使用未接电源的采样，按两端亮灭屏状态估算。累计 15 分钟后显示掉电速率。USB 通常会给手机供电，可通过无线调试采集待机数据。</p>
      {drain.longest && <p className="small">最长连续待机 · {durationLabel(drain.longest.until - drain.longest.from)} · 掉电 {percent(drain.longest.drop)} 个百分点 · {stamp(drain.longest.from)} 至 {stamp(drain.longest.until)}</p>}
    </Card>
    <Card>
      <h3 className="card-title">应用耗电排行</h3>
      <p className="small muted">Android 系统的累计耗电估算，以 mAh 计。系统决定统计窗口，共享 UID 的应用合并显示。{data?.powerSince ? `统计开始于 ${stamp(data.powerSince)}。` : ''}{data ? `读取于 ${stamp(data.time)}。` : ''}</p>
      {power?.length ? <>
        <div className="monitor-table-wrap"><table className="monitor-table">
          <thead><tr><th>排名 / 应用</th><th>估算耗电</th></tr></thead>
          <tbody>{(expanded ? power : power.slice(0, 10)).map((row, index) => <tr key={row.uid}>
            <td>{identity({ uid: row.uid, packages: row.packages, rank: index + 1 })}</td><td>{mah(row.mah)}</td>
          </tr>)}</tbody>
        </table></div>
        {power.length > 10 && <button className="btn btn-ghost" onClick={() => setExpanded(value => !value)}>{expanded ? '收起排行' : `查看全部 ${power.length} 项`}</button>}
      </> : <p className="muted">{!data ? '点击「读取 / 刷新」读取应用耗电。' : power ? '系统尚无应用耗电记录。' : '手机未提供可解析的应用耗电统计。'}</p>}
    </Card>
  </>
}

export function MonitorAppDetail({ target, metadata, report, powerReport, sample, available, onClose, manageApp }: {
  target: AppTarget
  metadata: Metadata
  report?: MonitorState
  powerReport?: MonitorState
  sample?: TemperatureSample
  available: boolean
  onClose: () => void
  manageApp: (entry: MonitorApp) => void
}) {
  const modal = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = modal.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  const matches = (row: AppTarget) => target.uid !== undefined ? row.uid === target.uid : row.packages.some(p => target.packages.includes(p))
  const traffic = report?.traffic?.filter(matches) ?? []
  const power = powerReport?.power?.filter(matches) ?? []
  const cpu = sample?.cpu.filter(p => target.packages.includes(p.name)) ?? []
  return <dialog className="modal monitor-app-modal" ref={modal} aria-labelledby={titleId} onCancel={onClose}
    onClick={e => { if (e.target === e.currentTarget) onClose() }}>
    <div>
      <header>
        <h2 id={titleId}>{appLabel(target, metadata)}</h2>
        <button className="icon-btn" aria-label="关闭应用详情" onClick={onClose}><X size={18} /></button>
      </header>
      {target.uid !== undefined && <p className="small muted">UID {target.uid}{target.packages.length > 1 ? ' · 以下流量和耗电由这些应用共享' : ''}</p>}
      <ul className="monitor-app-detail-list">{target.packages.map(pkg => {
        const entry = metadata[pkg]
        return <li key={pkg}>
          <AppIcon key={entry?.icon} icon={entry?.icon} />
          <span><strong>{entry?.label ?? pkg}</strong>{entry?.label !== pkg && <small>{pkg}</small>}</span>
          {entry && <button className="btn btn-secondary" disabled={!available} onClick={() => manageApp(entry)}>
            {(target.uid ?? 0) >= 100_000 ? '应用管理（主用户）' : '应用管理'}
          </button>}
        </li>
      })}</ul>
      <dl className="monitor-app-stats">
        <dt>流量 · {report?.days === 7 ? '最近 7 天' : '最近 24 小时'}</dt>
        <dd>{traffic.length ? traffic.map(row => <div key={row.uid}>UID {row.uid} · {bytes(row.rx + row.tx)} · 移动 {bytes(row.mobile)} · Wi-Fi {bytes(row.wifi)}</div>) : '暂无记录'}</dd>
        <dt>系统累计耗电</dt>
        <dd>{power.length ? power.map(row => <div key={row.uid}>UID {row.uid} · {mah(row.mah)}</div>) : '暂无记录'}</dd>
        <dt>所选采样的 CPU 占用</dt>
        <dd>{cpu.length ? cpu.map(p => <div key={p.name}>{metadata[p.name]?.label ?? p.name} · {percent(p.percent)}%</div>) : '未出现在所选采样的高负载列表中'}</dd>
      </dl>
    </div>
  </dialog>
}
