import { Fragment, useEffect, useMemo, useState } from 'react'
import { Archive, ArchiveRestore, Copy, KeyRound, Package, RefreshCw, Search, Snowflake, X } from 'lucide-react'
import { isRooted } from '@shared/root'
import type { AppEntry, AppPermission } from '@shared/types'
import { PageHeader, useGate, type PageProps } from './pages'
import { Callout, Card } from './ui'

type Tab = 'clone' | 'user' | 'backup' | 'system'

const LOAD: Record<Tab, { title: string; kind: 'listApps' | 'listUserApps' | 'listSystemApps' }> = {
  clone: { title: '读取应用列表', kind: 'listApps' },
  user: { title: '读取应用列表', kind: 'listUserApps' },
  backup: { title: '读取应用列表', kind: 'listUserApps' },
  system: { title: '读取系统应用列表', kind: 'listSystemApps' }
}

export function AppsPage({ tb, confirm }: PageProps) {
  const [tab, setTab] = useState<Tab>('clone')
  const [lists, setLists] = useState<Record<Tab, AppEntry[] | null>>({ clone: null, user: null, backup: null, system: null })
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [icons, setIcons] = useState<Record<string, string>>({})
  const [perms, setPerms] = useState<{ pkg: string; list: AppPermission[] } | null>(null)
  const [withData, setWithData] = useState(false)
  const apps = lists[tab]
  const rooted = isRooted(tb.device.root)

  // 列表出来后，图标在后台分批到达
  useEffect(() => window.toolbox.onAppIcons((batch) => setIcons((m) => ({ ...m, ...batch }))), [])
  const gate = useGate(tb, ['system'])

  const load = async () => {
    const r = await tb.start(LOAD[tab].title, { kind: LOAD[tab].kind })
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

  const toggleFreeze = (a: AppEntry) => {
    const run = async () => {
      setPending(a.package)
      const r = await tb.start(a.disabled ? `解冻：${a.label}` : `冻结：${a.label}`, { kind: 'freezeApp', package: a.package, freeze: !a.disabled })
      setPending(null)
      if (r.ok) patch(a.package, { disabled: !a.disabled })
    }
    // 第三方应用冻结了也不影响系统；预装应用可能被别的功能依赖，先确认
    if (a.disabled || !a.system) return run()
    confirm({
      title: `冻结 ${a.label}`,
      intro: (
        <>
          停用 <code>{a.package}</code>（<code>pm disable-user</code>），应用和数据都保留，随时可以在这里解冻。
          冻结其它功能依赖的预装组件，可能导致相关功能失灵。
        </>
      ),
      checks: ['我确认知道这个应用是做什么的，冻结它不会影响我需要的功能'],
      confirmText: '冻结',
      onConfirm: run
    })
  }

  const togglePerms = async (a: AppEntry) => {
    if (perms?.pkg === a.package) return setPerms(null)
    const r = await tb.start(`读取 ${a.label} 的权限`, { kind: 'appPermissions', package: a.package })
    if (r.ok && r.permissions) setPerms({ pkg: a.package, list: r.permissions })
  }

  const grant = async (pkg: string, p: AppPermission) => {
    const r = await tb.start(`${p.granted ? '撤销' : '授予'}「${p.label}」`, { kind: 'grantPermission', package: pkg, permission: p.name, grant: !p.granted })
    if (r.permissions) setPerms({ pkg, list: r.permissions })
  }

  const backup = async (a: AppEntry) => {
    setPending(a.package)
    await tb.start(`备份：${a.label}`, { kind: 'backupApp', package: a.package, label: a.label, withData: withData && rooted })
    setPending(null)
  }

  const restore = async () => {
    const dir = await window.toolbox.pickDir('选择应用备份文件夹（里面有 backup.json）')
    if (!dir) return
    confirm({
      title: '从备份恢复应用',
      intro: (
        <>
          先安装备份里的安装包；备份里有应用数据、手机也已 Root 时，会<strong>清空这个应用在手机上现有的数据</strong>，换成备份里的。
          只恢复工具箱备份出来的文件夹。
        </>
      ),
      checks: ['我知道手机上这个应用现有的数据会被备份覆盖'],
      confirmText: '恢复',
      onConfirm: () => tb.start('恢复应用', { kind: 'restoreApp', dir })
    })
  }

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!apps || !q) return apps
    return apps.filter((a) => a.label.toLowerCase().includes(q) || a.package.toLowerCase().includes(q))
  }, [apps, query])

  const freezeButton = (a: AppEntry) => (
    <button
      className={`btn ${a.disabled ? 'btn-secondary' : 'btn-ghost'}`}
      disabled={gate.disabled || (a.protected && !a.disabled)}
      title={a.protected && !a.disabled ? '系统运行必需的组件，不允许冻结' : undefined}
      onClick={() => toggleFreeze(a)}
    >
      {pending === a.package ? '处理中…' : a.disabled ? '解冻' : '冻结'}
    </button>
  )

  return (
    <>
      <PageHeader title="应用管理" desc="应用双开、冻结不常用的应用、一键授予 adb 权限、备份应用（Root 后可含数据），或者卸载用不到的预装应用" />
      <div className="segmented apps-tabs">
        <button className={tab === 'clone' ? 'on' : ''} onClick={() => setTab('clone')}>
          应用双开
        </button>
        <button className={tab === 'user' ? 'on' : ''} onClick={() => setTab('user')}>
          冻结与权限
        </button>
        <button className={tab === 'backup' ? 'on' : ''} onClick={() => setTab('backup')}>
          备份与恢复
        </button>
        <button className={tab === 'system' ? 'on' : ''} onClick={() => setTab('system')}>
          预装应用
        </button>
      </div>
      {tab === 'clone' && (
        <Callout tone="info">
          利用 ColorOS / 氧 OS 自带的分身空间（用户 999）。首次使用前，需要先在手机「设置 → 应用 → 应用分身」中任意双开一个应用，系统才会创建分身空间。
        </Callout>
      )}
      {tab === 'user' && (
        <Callout tone="info">
          <strong>冻结</strong>：应用和数据都保留，只是不能运行、图标从桌面消失，随时可以解冻。
          <strong>权限</strong>：自动化、按键映射、手势类应用常要求「用电脑执行 adb 命令授权」，点「权限」就能看到它申请了哪些、一键授予。
        </Callout>
      )}
      {tab === 'backup' && (
        <Callout tone="info">
          把应用的安装包备份到「文档\一加工具箱\应用备份」，有分包时打成 <code>.apks</code>，也能直接拖进「系统工具 → 安装应用」装回去。
          手机已 Root 时可以连同应用数据（聊天记录、设置、存档等，不含缓存和 <code>Android/data</code> 里的文件）一起备份。
          换手机恢复后，部分应用的登录状态会失效，需要重新登录。
        </Callout>
      )}
      {tab === 'system' && (
        <Callout tone="warn">
          卸载和冻结都只针对当前用户，不需要 Root，随时可以恢复。但工具箱不知道哪些预装应用停掉后会影响其它功能，请只处理你确认用不到的。
          开机、解锁、权限管理等必需组件已被锁定，不能卸载或冻结。
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
        {tab === 'backup' && (
          <div className="backup-bar">
            <label className="check" title={rooted ? undefined : `需要 Root，这台手机当前是「${tb.device.root ?? '未知'}」`}>
              <input type="checkbox" checked={withData && rooted} disabled={!rooted} onChange={(e) => setWithData(e.target.checked)} />
              <span>同时备份应用数据{rooted ? '（备份前会先停止应用）' : '（需要 Root）'}</span>
            </label>
            <button className="btn btn-ghost" disabled={gate.disabled} title={gate.reason} onClick={restore}>
              <ArchiveRestore size={15} /> 从备份恢复…
            </button>
          </div>
        )}

        {!apps && (
          <div className="empty">
            {tab === 'clone' ? <Copy size={28} /> : tab === 'user' ? <Snowflake size={28} /> : tab === 'backup' ? <Archive size={28} /> : <Package size={28} />}
            <p>
              {gate.reason && !tb.run.running
                ? gate.reason
                : tab === 'system'
                  ? '点击「读取应用列表」，系统应用有几百个，需要一两分钟'
                  : '点击「读取应用列表」，应用较多时需要一分钟左右'}
            </p>
          </div>
        )}

        {shown && (
          <ul className="app-list">
            {shown.length === 0 && <li className="muted app-none">没有匹配的应用</li>}
            {shown.map((a) => (
              <Fragment key={a.package}>
                <li className="app-row">
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
                  {tab !== 'clone' && a.disabled && !a.removed && <span className="chip">已冻结</span>}
                  {tab === 'system' && a.removed && <span className="chip">已卸载</span>}
                  {tab === 'system' && a.protected && <span className="chip">系统必需</span>}
                  {tab === 'clone' && (
                    <button className={`btn ${a.cloned ? 'btn-ghost' : 'btn-secondary'}`} disabled={gate.disabled} onClick={() => toggleClone(a)}>
                      {pending === a.package ? '处理中…' : a.cloned ? '移除' : '双开'}
                    </button>
                  )}
                  {tab === 'user' && (
                    <>
                      <button className={`btn ${perms?.pkg === a.package ? 'btn-secondary' : 'btn-ghost'}`} disabled={gate.disabled} onClick={() => togglePerms(a)}>
                        <KeyRound size={14} /> 权限
                      </button>
                      {freezeButton(a)}
                    </>
                  )}
                  {tab === 'backup' && (
                    <button className="btn btn-secondary" disabled={gate.disabled} onClick={() => backup(a)}>
                      <Archive size={14} /> {pending === a.package ? '备份中…' : '备份'}
                    </button>
                  )}
                  {tab === 'system' && (
                    <>
                      {!a.removed && freezeButton(a)}
                      <button
                        className={`btn ${a.removed ? 'btn-secondary' : 'btn-ghost'}`}
                        disabled={gate.disabled || (a.protected && !a.removed)}
                        title={a.protected && !a.removed ? '系统运行必需的组件，不允许卸载' : undefined}
                        onClick={() => toggleSystem(a)}
                      >
                        {pending === a.package ? '处理中…' : a.removed ? '恢复' : '卸载'}
                      </button>
                    </>
                  )}
                </li>
                {tab === 'user' && perms?.pkg === a.package && (
                  <li className="perm-panel">
                    {perms.list.length === 0 && (
                      <p className="muted small">这个应用没有申请需要用 adb 授予的权限。它要的如果是悬浮窗、无障碍、通知使用权等，请在手机设置里打开。</p>
                    )}
                    {perms.list.map((p) => (
                      <div key={p.name} className="perm-row">
                        <div className="app-text">
                          <strong>{p.label}</strong>
                          <span title={p.name}>{p.desc}</span>
                        </div>
                        {p.granted && <span className="chip chip-ok">已授予</span>}
                        <button className={`btn ${p.granted ? 'btn-ghost' : 'btn-primary'}`} disabled={gate.disabled} onClick={() => grant(a.package, p)}>
                          {p.granted ? '撤销' : '授予'}
                        </button>
                      </div>
                    ))}
                  </li>
                )}
              </Fragment>
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
