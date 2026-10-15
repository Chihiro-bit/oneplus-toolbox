import { useEffect, useMemo, useState } from 'react'
import { Copy, Package, RefreshCw, Search, X } from 'lucide-react'
import type { AppEntry } from '@shared/types'
import { PageHeader, useGate, type PageProps } from './pages'
import { Callout, Card } from './ui'

type Tab = 'clone' | 'system'

export function AppsPage({ tb, confirm }: PageProps) {
  const [tab, setTab] = useState<Tab>('clone')
  const [lists, setLists] = useState<Record<Tab, AppEntry[] | null>>({ clone: null, system: null })
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const apps = lists[tab]

  // 列表出来后，图标在后台分批到达
  useEffect(() => window.toolbox.onAppIcons((batch) => setIcons((m) => ({ ...m, ...batch }))), [])
  const gate = useGate(tb, ['system'])

  const load = async () => {
    const r = await tb.start(tab === 'clone' ? '读取应用列表' : '读取系统应用列表', { kind: tab === 'clone' ? 'listApps' : 'listSystemApps' })
    if (r.ok && r.apps) setLists((l) => ({ ...l, [tab]: r.apps! }))
  }

  const patch = (pkg: string, change: Partial<AppEntry>) =>
    setLists((l) => ({ ...l, [tab]: l[tab]?.map((x) => (x.package === pkg ? { ...x, ...change } : x)) ?? null }))

  const toggleClone = async (a: AppEntry) => {
    setPending(a.package)
    const r = await tb.start(a.cloned ? `移除双开：${a.label}` : `双开：${a.label}`, {
      kind: 'cloneApp',
      package: a.package,
      enable: !a.cloned
    })
    setPending(null)
    if (r.ok) patch(a.package, { cloned: !a.cloned })
  }

  const toggleSystem = (a: AppEntry) => {
    const run = async () => {
      setPending(a.package)
      const r = await tb.start(a.removed ? `恢复：${a.label}` : `卸载：${a.label}`, { kind: 'debloat', package: a.package, remove: !a.removed })
      setPending(null)
      if (r.ok) patch(a.package, { removed: !a.removed })
    }
    if (a.removed) return run()
    confirm({
      title: `卸载 ${a.label}`,
      intro: (
        <>
          对当前用户卸载 <code>{a.package}</code>（<code>pm uninstall --user 0</code>）。APK 仍保留在系统分区，随时可以在这里恢复，恢复出厂设置也会让它回来。
          卸掉其它应用依赖的组件，可能导致相关功能失灵甚至反复崩溃。
        </>
      ),
      checks: ['我确认知道这个应用是做什么的，卸载它不会影响我需要的功能'],
      confirmText: '卸载',
      onConfirm: run
    })
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!apps || !q) return apps
    return apps.filter((a) => a.label.toLowerCase().includes(q) || a.package.toLowerCase().includes(q))
  }, [apps, query])

  return (
    <>
      <PageHeader title="应用管理" desc="把第三方应用克隆到分身空间，或者卸载用不到的预装应用" />
      <div className="segmented apps-tabs">
        <button className={tab === 'clone' ? 'on' : ''} onClick={() => setTab('clone')}>
          应用双开
        </button>
        <button className={tab === 'system' ? 'on' : ''} onClick={() => setTab('system')}>
          预装应用
        </button>
      </div>
      {tab === 'clone' ? (
        <Callout tone="info">
          利用 ColorOS / 氧 OS 自带的分身空间（用户 999）。首次使用前，需要先在手机「设置 → 应用 → 应用分身」中任意双开一个应用，系统才会创建分身空间。
        </Callout>
      ) : (
        <Callout tone="warn">
          卸载只针对当前用户，不需要 Root，随时可以恢复。但工具箱不知道哪些预装应用卸掉后会影响其它功能，请只卸载你确认用不到的。
          开机、解锁、权限管理等必需组件已被锁定，不能卸载。
        </Callout>
      )}

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
            {tab === 'clone' ? <Copy size={28} /> : <Package size={28} />}
            <p>
              {gate.reason && !tb.run.running
                ? gate.reason
                : tab === 'clone'
                  ? '点击「读取应用列表」，应用较多时需要一分钟左右'
                  : '点击「读取应用列表」，系统应用有几百个，需要一两分钟'}
            </p>
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
                {tab === 'clone' && a.cloned && <span className="chip chip-ok">已双开</span>}
                {tab === 'system' && a.removed && <span className="chip">已卸载</span>}
                {tab === 'system' && a.disabled && !a.removed && <span className="chip">已停用</span>}
                {tab === 'system' && a.protected && <span className="chip">系统必需</span>}
                {tab === 'clone' ? (
                  <button className={`btn ${a.cloned ? 'btn-ghost' : 'btn-secondary'}`} disabled={gate.disabled} onClick={() => toggleClone(a)}>
                    {pending === a.package ? '处理中…' : a.cloned ? '移除' : '双开'}
                  </button>
                ) : (
                  <button
                    className={`btn ${a.removed ? 'btn-secondary' : 'btn-ghost'}`}
                    disabled={gate.disabled || (a.protected && !a.removed)}
                    title={a.protected && !a.removed ? '系统运行必需的组件，不允许卸载' : undefined}
                    onClick={() => toggleSystem(a)}
                  >
                    {pending === a.package ? '处理中…' : a.removed ? '恢复' : '卸载'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {tab === 'clone' && apps && (
        <p className="gate-hint">ColorOS 桌面在重启后可能不显示分身应用的图标，这是系统桌面的限制，可改用第三方桌面。</p>
      )}
    </>
  )
}
