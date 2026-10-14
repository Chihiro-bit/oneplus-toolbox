import { useEffect, useMemo, useState } from 'react'
import { Copy, RefreshCw, Search, X } from 'lucide-react'
import type { AppEntry } from '@shared/types'
import { PageHeader, useGate, type PageProps } from './pages'
import { Callout, Card } from './ui'

export function AppsPage({ tb }: PageProps) {
  const [apps, setApps] = useState<AppEntry[] | null>(null)
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})

  // 列表出来后，图标在后台分批到达
  useEffect(() => window.toolbox.onAppIcons((batch) => setIcons((m) => ({ ...m, ...batch }))), [])
  const gate = useGate(tb, ['system'])

  const load = async () => {
    const r = await tb.start('读取应用列表', { kind: 'listApps' })
    if (r.ok && r.apps) setApps(r.apps)
  }

  const toggle = async (a: AppEntry) => {
    setPending(a.package)
    const r = await tb.start(a.cloned ? `移除双开：${a.label}` : `双开：${a.label}`, {
      kind: 'cloneApp',
      package: a.package,
      enable: !a.cloned
    })
    setPending(null)
    if (r.ok) setApps((list) => list?.map((x) => (x.package === a.package ? { ...x, cloned: !a.cloned } : x)) ?? null)
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!apps || !q) return apps
    return apps.filter((a) => a.label.toLowerCase().includes(q) || a.package.toLowerCase().includes(q))
  }, [apps, query])

  return (
    <>
      <PageHeader title="应用双开" desc="利用 ColorOS / 氧 OS 自带的分身空间（用户 999），把任意第三方应用克隆一份" />
      <Callout tone="info">
        首次使用前，需要先在手机「设置 → 应用 → 应用分身」中任意双开一个应用，系统才会创建分身空间。
      </Callout>

      <Card className="apps-card">
        <div className="apps-toolbar">
          <div className="search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索应用名或包名"
              disabled={!apps}
              spellCheck={false}
            />
            {query && (
              <button className="icon-btn" onClick={() => setQuery('')} aria-label="清空搜索">
                <X size={14} />
              </button>
            )}
          </div>
          <button className="btn btn-secondary" disabled={gate.disabled} title={gate.reason} onClick={load}>
            <RefreshCw size={15} /> {apps ? '刷新' : '读取应用列表'}
          </button>
        </div>

        {!apps && (
          <div className="empty">
            <Copy size={28} />
            <p>{gate.reason && !tb.run.running ? gate.reason : '点击「读取应用列表」，应用较多时需要一分钟左右'}</p>
          </div>
        )}

        {shown && (
          <ul className="app-list">
            {shown.length === 0 && <li className="muted app-none">没有匹配的应用</li>}
            {shown.map((a) => (
              <li key={a.package} className="app-row">
                {icons[a.package] ? (
                  <img className="app-icon" src={icons[a.package]} alt="" loading="lazy" />
                ) : (
                  <div className="app-avatar" aria-hidden>
                    {[...a.label][0]}
                  </div>
                )}
                <div className="app-text">
                  <strong>{a.label}</strong>
                  <span>{a.package}</span>
                </div>
                {a.cloned && <span className="chip chip-ok">已双开</span>}
                <button
                  className={`btn ${a.cloned ? 'btn-ghost' : 'btn-secondary'}`}
                  disabled={gate.disabled}
                  onClick={() => toggle(a)}
                >
                  {pending === a.package ? '处理中…' : a.cloned ? '移除' : '双开'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {apps && (
        <p className="gate-hint">ColorOS 桌面在重启后可能不显示分身应用的图标，这是系统桌面的限制，可改用第三方桌面。</p>
      )}
    </>
  )
}
