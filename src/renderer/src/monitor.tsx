import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, RefreshCw } from 'lucide-react'
import { HIGH_TEMPERATURE, MONITOR_MAX_GAP, type MonitorApp, type MonitorDays, type MonitorState, type TemperatureSample } from '@shared/monitor'
import { PageHeader, type PageProps } from './pages'
import type { Toolbox } from './state'
import { Card, Callout } from './ui'
import { AppIdentity, BatteryInsights, bytes, MonitorAppDetail, stamp, type AppTarget } from './monitor-insights'

const degrees = (value?: number) => value === undefined ? '不可用' : `${value.toFixed(1)} °C`

type ManageApp = (entry: { package: string; system: boolean }) => void

export function MonitorPage({ tb, manageApp }: PageProps & { manageApp: ManageApp }) {
  return <MonitorPanel key={tb.device.serial ?? 'none'} tb={tb} manageApp={manageApp} />
}

function MonitorPanel({ tb, manageApp }: { tb: Toolbox; manageApp: ManageApp }) {
  const [days, setDays] = useState<MonitorDays>(1)
  const [auto, setAuto] = useState(false)
  const [data, setData] = useState<MonitorState>()
  const [history, setHistory] = useState<TemperatureSample[]>([])
  const [sampleNotes, setSampleNotes] = useState<string[]>([])
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<number>()
  const [detail, setDetail] = useState<AppTarget>()
  const [metadata, setMetadata] = useState<Record<string, MonitorApp>>({})
  const checkedPackages = useRef(new Set<string>())
  const pending = useRef(false)
  const serial = tb.device.serial
  const available = !!serial && tb.device.mode === 'system' && !tb.device.needsPick
  useEffect(() => {
    let active = true
    const off = window.toolbox.onMonitorSample(reading => {
      if (reading.serial !== serial) return
      setHistory(reading.history)
      setSampleNotes(reading.notes)
    })
    void window.toolbox.getMonitorEnabled().then(value => { if (active) setAuto(value) })
      .catch(() => { if (active) setError('无法读取后台采集状态') })
    if (serial) void window.toolbox.getMonitorHistory(serial).then(saved => {
      if (active) setHistory(existing => (existing.at(-1)?.time ?? 0) > (saved.at(-1)?.time ?? 0) ? existing : saved)
    }).catch(() => { if (active) setError('无法读取本地监控记录') })
    return () => { active = false; off() }
  }, [serial])

  const refresh = async (range = days) => {
    if (pending.current || tb.run.running || !available) return
    pending.current = true
    setError('')
    try {
      const result = await tb.start('温度、耗电与流量', { kind: 'monitor', days: range })
      const report = result.monitor
      if (report && report.serial === serial) {
        setData(report)
        const saved = await window.toolbox.getMonitorHistory(serial).catch(() => [])
        const sample = report.sample
        setHistory(existing => {
          if ((existing.at(-1)?.time ?? 0) > sample.time) return existing
          if (saved.at(-1)?.time === sample.time) return saved
          return [...new Map([...existing, ...report.history].map(s => [s.time, s])).values()].sort((a, b) => a.time - b.time)
        })
        setSampleNotes([])
        setSelected(undefined)
      }
      if (!result.ok) setError(result.message)
    } catch (e) {
      setError(String(e))
    } finally { pending.current = false }
  }

  const toggleMonitor = async (enabled: boolean) => {
    try { setAuto(await window.toolbox.setMonitorEnabled(enabled)) }
    catch (e) { setError(String(e)) }
  }

  const shown = data?.days === days ? data : undefined
  const latest = history.at(-1)
  const windowHistory = useMemo(() => history.filter(s => s.time >= Date.now() - days * 86_400_000), [days, history])
  const sample = windowHistory.find(s => s.time === selected) ?? windowHistory.at(-1)
  const points = windowHistory.filter((s): s is TemperatureSample & { battery: number } => s.battery !== undefined)
  const peak = points.length ? Math.max(...points.map(s => s.battery)) : undefined
  const [network, setNetwork] = useState<'all' | 'mobile' | 'wifi'>('all')
  const amount = (r: NonNullable<MonitorState['traffic']>[number]) => network === 'all' ? r.rx + r.tx : r[network]
  const rows = [...(shown?.traffic ?? [])].sort((a, b) => amount(b) - amount(a))
  const total = rows.reduce((sum, row) => sum + amount(row), 0)
  const [search, setSearch] = useState('')
  const packages = useMemo(() => {
    const names = new Set<string>()
    for (const cpu of sample?.cpu ?? []) names.add(cpu.name)
    const traffic = shown?.traffic ?? [], power = data?.power ?? []
    for (let i = 0; i < Math.max(traffic.length, power.length); i++) {
      for (const p of [...(traffic[i]?.packages ?? []), ...(power[i]?.packages ?? [])]) names.add(p)
    }
    return [...names]
  }, [sample, shown?.traffic, data?.power])
  useEffect(() => {
    if (!available || !serial || tb.run.running) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const next = async () => {
      const batch = packages.filter(p => !checkedPackages.current.has(p)).slice(0, 24)
      if (!batch.length) return
      const rows = await window.toolbox.getMonitorApps(serial, batch).catch(() => null)
      if (!active) return
      if (rows) {
        for (const p of batch) checkedPackages.current.add(p)
        setMetadata(known => ({ ...known, ...Object.fromEntries(rows.map(app => [app.package, app])) }))
      }
      timer = setTimeout(next, rows ? 1000 : 3000)
    }
    void next()
    return () => { active = false; clearTimeout(timer) }
  }, [available, packages, serial, tb.run.running])
  const identity = (target: AppTarget) => <AppIdentity target={target} metadata={metadata} onOpen={setDetail} />

  return <div className="monitor-page">
    <PageHeader title="温度与流量" desc="跟踪温度、耗电和流量，排查近期发热或掉电的应用" />
    <Card>
      <div className="monitor-toolbar">
        <label>统计范围 <select aria-label="统计范围" value={days} onChange={e => {
          const range = Number(e.target.value) as MonitorDays
          setDays(range)
          setSelected(undefined)
          if (data) void refresh(range)
        }} disabled={tb.run.running}>
          <option value={1}>最近 24 小时</option><option value={7}>最近 7 天</option>
        </select></label>
        <button className="btn btn-primary" disabled={!available || tb.run.running} onClick={() => void refresh()}><RefreshCw size={15} /> 读取 / 刷新</button>
        <label className="check"><input type="checkbox" checked={auto} onChange={e => void toggleMonitor(e.target.checked)} /> 后台采集与高温提醒</label>
      </div>
      <p className="small muted">开启后每分钟采集温度和电量，离开页面或收进托盘后继续。断连或执行其他任务时暂停，退出工具箱后停止。记录在电脑保存 7 天。</p>
      {!available && <Callout tone="info">请连接正常开机的手机，允许 USB 调试，并在多设备连接时选定手机。</Callout>}
      {error && <Callout tone="warn">{error}</Callout>}
      {latest && <p className="small muted">最后采集：{stamp(latest.time)}{!available ? ' · 当前离线，以下为上次数据' : ''}</p>}
      {[...new Set([...(shown?.notes ?? []), ...sampleNotes])].map(note => <p className="small error-text" key={note}>{note}</p>)}
    </Card>

    <div className="monitor-metrics">
      <Card><span className="muted">最新电池温度</span><strong>{degrees(latest?.battery)}</strong><span className="small muted">{latest?.charging ? '已连接电源' : '电池温度'}</span></Card>
      <Card><span className="muted">记录内最高温度</span><strong>{degrees(peak)}</strong><span className="small muted">{points.length} 个有效采样点</span></Card>
      <Card><span className="muted">所选网络总流量（估算）</span><strong>{shown?.traffic ? bytes(total) : '不可用'}</strong><span className="small muted">{network === 'all' ? '全部网络' : network === 'mobile' ? '移动数据' : 'Wi-Fi'} · 下载 + 上传</span></Card>
    </div>

    <Card>
      <h3 className="card-title">电池温度趋势</h3>
      {points.length ? <TemperatureChart points={points} onSelect={setSelected} /> : <p className="muted">点击「读取 / 刷新」开始记录温度。</p>}
      <p className="small muted">点击图中采样点查看当时负载。采样中断时，趋势线会断开。</p>
      {points.length > 0 && <label className="monitor-sample-picker">查看采样 <select aria-label="查看温度采样" value={sample?.time ?? ''} onChange={e => setSelected(Number(e.target.value))}>
        {windowHistory.slice().reverse().map(s => <option key={s.time} value={s.time}>{stamp(s.time)} · {degrees(s.battery)}</option>)}
      </select></label>}
    </Card>

    <BatteryInsights history={windowHistory} data={data} identity={identity} />

    <Card>
      <h3 className="card-title">持续高温记录</h3>
      <p className="small muted">电池达到 {HIGH_TEMPERATURE} °C 后，连续三次且持续约两分钟才记录一次。开启后台采集后会同时发送桌面提醒。</p>
      {windowHistory.some(s => s.highTemperatureEvent) ? <ul className="monitor-events">
        {windowHistory.filter(s => s.highTemperatureEvent).reverse().map(event => <li key={event.time}>
          <button className="btn btn-secondary" onClick={() => {
            setSelected(event.time)
            document.getElementById('monitor-cpu')?.scrollIntoView({ block: 'start' })
          }}>{stamp(event.time)} · {degrees(event.battery)}</button>
          <span className="small muted">{event.charging ? '接通电源' : event.charging === false ? '未接电源' : '电源状态未知'} · {event.cpu[0] ? `${metadata[event.cpu[0].name]?.label ?? event.cpu[0].name} ${event.cpu[0].percent.toFixed(1)}%` : '无负载记录'}</span>
        </li>)}
      </ul> : <p className="muted">所选时段没有持续高温记录。</p>}
    </Card>

    <Card>
      <div className="card-head" id="monitor-cpu"><h3 className="card-title"><Activity size={16} /> 发热排查：高 CPU 占用</h3><span className="small muted">{sample && stamp(sample.time)}</span></div>
      <p className="small muted">按系统最近采样窗口的 CPU 占用排序，同包名进程合并。这里只能提示可能相关的应用／系统进程，不能证明它导致发热，也不覆盖 GPU、屏幕、充电等热源。多核占用可能超过 100%。</p>
      {sample?.cpuWindow && <p className="small muted">系统负载窗口（可能早于温度采集时间）：{sample.cpuWindow}</p>}
      {sample?.cpu.length ? <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th>应用包名 / 系统进程</th><th>CPU 占用</th><th>线索</th></tr></thead><tbody>
        {sample.cpu.map((p, i) => <tr key={p.name}><td>{identity({ packages: [p.name] })}</td><td>{p.percent.toFixed(1)}%</td><td>{i === 0 && p.percent > 0 ? '本次负载最高，可优先排查' : '采样时正在占用 CPU'}</td></tr>)}
      </tbody></table></div> : <p className="muted">暂无可用的进程负载数据。</p>}
    </Card>

    <Card>
      <div className="card-head"><h3 className="card-title">应用流量排行</h3><select aria-label="网络类型" value={network} onChange={e => setNetwork(e.target.value as typeof network)}><option value="all">全部网络</option><option value="mobile">移动数据</option><option value="wifi">Wi-Fi</option></select></div>
      <p className="small muted">流量来自 Android 系统历史，边界时间按桶估算。共享 UID 的应用合并显示。无法读取应用资料时会显示包名或 UID。</p>
      {shown?.trafficStart !== undefined && shown.trafficEnd !== undefined && <p className="small muted">可用统计桶覆盖：{stamp(shown.trafficStart)} — {stamp(shown.trafficEnd)}（不保证期间连续完整）</p>}
      <input className="monitor-search" placeholder="搜索应用名称、包名或 UID" aria-label="搜索应用流量" value={search} onChange={e => setSearch(e.target.value)} />
      {shown?.traffic ? rows.length ? <div className="monitor-table-wrap"><table className="monitor-table"><thead><tr><th>排名 / 应用</th><th>所选网络用量</th><th>占比</th><th>全部网络下载 / 上传</th></tr></thead><tbody>
        {rows.map((r, i) => ({ r, i })).filter(({ r }) => `${r.uid} ${r.packages.map(p => `${p} ${metadata[p]?.label ?? ''}`).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase())).map(({ r, i }) => <tr key={r.uid}>
          <td>{identity({ packages: r.packages, uid: r.uid, rank: i + 1 })}</td>
          <td>{bytes(amount(r))}</td><td>{total ? (amount(r) / total * 100).toFixed(1) : '0.0'}%</td><td>{bytes(r.rx)} / {bytes(r.tx)}</td>
        </tr>)}
      </tbody></table></div> : <p className="muted">所选范围暂无可用流量记录。</p> : <p className="muted">尚未读取或系统未提供可解析的应用流量统计。</p>}
    </Card>
    {detail && <MonitorAppDetail target={detail} metadata={metadata} report={shown} powerReport={data} sample={sample}
      available={available && !tb.run.running} onClose={() => setDetail(undefined)} manageApp={manageApp} />}
  </div>
}

function TemperatureChart({ points, onSelect }: { points: (TemperatureSample & { battery: number })[]; onSelect: (time: number) => void }) {
  const first = points[0].time, last = points.at(-1)!.time
  const low = Math.floor(Math.min(...points.map(p => p.battery)) - 2)
  const high = Math.ceil(Math.max(...points.map(p => p.battery)) + 2)
  const x = (t: number) => first === last ? 370 : 50 + (t - first) / (last - first) * 640
  const y = (t: number) => 150 - (t - low) / (high - low) * 125
  return <><svg className="monitor-chart" viewBox="0 0 740 180" role="img" aria-label="电池温度趋势，使用下方采样选择器也可查看各点负载">
    {[low, (low + high) / 2, high].map(v => <g key={v}><line x1="50" x2="705" y1={y(v)} y2={y(v)} stroke="var(--border)" /><text x="4" y={y(v) + 4} fill="var(--muted)" fontSize="12">{v}°C</text></g>)}
    {points.map((p, i) => <g key={p.time}>
      {i > 0 && p.time - points[i - 1].time <= MONITOR_MAX_GAP && <line x1={x(points[i - 1].time)} y1={y(points[i - 1].battery)} x2={x(p.time)} y2={y(p.battery)} stroke="var(--accent)" strokeWidth="2" />}
      <circle cx={x(p.time)} cy={y(p.battery)} r="4" fill="var(--accent)" onClick={() => onSelect(p.time)} style={{ cursor: 'pointer' }}><title>{stamp(p.time)} · {degrees(p.battery)} · {p.cpu[0]?.name ?? '负载未知'}</title></circle>
    </g>)}
  </svg><div className="monitor-chart-times small muted"><span>{stamp(first)}</span><span>{stamp(last)}</span></div></>
}
