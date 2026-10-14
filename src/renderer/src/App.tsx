import { useEffect, useState } from 'react'
import { ArrowLeftRight, ArrowUpCircle, Copy, Cpu, Home, LockKeyhole, Power, Settings, Smartphone, Sparkles, Wrench } from 'lucide-react'
import type { UpdateInfo } from '@shared/types'
import { AppsPage } from './apps'
import { BootloaderPage, OverviewPage, RebootPage, SlotPage } from './pages'
import { RootPage } from './root'
import { SettingsPage } from './settings'
import { isOnePlus, MODE_LABEL, useToolbox } from './state'
import { ToolsPage } from './tools'
import { BrandWarning, ConfirmDialog, LogPanel, ModeBadge, RunBanner, type ConfirmSpec } from './ui'

export type PageId = 'overview' | 'reboot' | 'bootloader' | 'root' | 'slot' | 'apps' | 'tools' | 'settings'

const NAV: { id: PageId; label: string; icon: typeof Home }[] = [
  { id: 'overview', label: '概览', icon: Home },
  { id: 'reboot', label: '重启与模式', icon: Power },
  { id: 'bootloader', label: 'Bootloader', icon: LockKeyhole },
  { id: 'root', label: '一键 Root', icon: Sparkles },
  { id: 'slot', label: 'A/B 槽位', icon: ArrowLeftRight },
  { id: 'apps', label: '应用双开', icon: Copy },
  { id: 'tools', label: '系统工具', icon: Wrench }
]

export default function App() {
  const tb = useToolbox()
  const [page, setPage] = useState<PageId>('overview')
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  // 本次运行中已确认过警告的设备，不再重复弹出
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())
  const { device } = tb
  const warnDevice = device.serial && isOnePlus(device) === false && !acknowledged.has(device.serial) ? device : null

  // 配置了更新仓库时，启动后静默检查一次
  useEffect(() => {
    window.toolbox.getSettings().then((s) => {
      if (s.updateRepo) window.toolbox.checkUpdate().then((u) => u.hasUpdate && setUpdate(u))
    })
  }, [])

  const props = { tb, confirm: setConfirm, go: setPage }
  const navItem = ({ id, label, icon: Icon }: (typeof NAV)[number]) => (
    <button key={id} className={`nav-item ${page === id ? 'active' : ''}`} onClick={() => setPage(id)}>
      <Icon size={17} />
      {label}
    </button>
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand drag">
          <div className="brand-mark">
            <Cpu size={16} />
          </div>
          <span>一加工具箱</span>
        </div>
        <nav>
          {NAV.map(navItem)}
          <div className="nav-sep" />
          {navItem({ id: 'settings', label: '设置', icon: Settings })}
        </nav>
        {update && (
          <button className="update-pill" onClick={() => window.toolbox.openExternal(update.url!)}>
            <ArrowUpCircle size={15} /> 新版本 {update.latest}
          </button>
        )}
        <div className="sidebar-device" onClick={() => setPage('overview')}>
          <Smartphone size={18} />
          <div>
            <div className="sd-name">{device.model ?? (device.mode === 'none' ? '无设备' : (device.device ?? '设备'))}</div>
            <div className="sd-mode">{MODE_LABEL[device.mode]}</div>
          </div>
          <ModeBadge mode={device.mode} />
        </div>
      </aside>

      <main className="main">
        <div className="titlebar drag" />
        <div className="content">
          <RunBanner run={tb.run} onCancel={() => window.toolbox.cancel()} onDismiss={tb.dismiss} />
          {page === 'overview' && <OverviewPage {...props} />}
          {page === 'reboot' && <RebootPage {...props} />}
          {page === 'bootloader' && <BootloaderPage {...props} />}
          {page === 'root' && <RootPage {...props} />}
          {page === 'slot' && <SlotPage {...props} />}
          {page === 'apps' && <AppsPage {...props} />}
          {page === 'tools' && <ToolsPage {...props} />}
          {page === 'settings' && <SettingsPage {...props} />}
        </div>
        <LogPanel logs={tb.logs} onClear={tb.clearLogs} />
      </main>

      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
      <BrandWarning device={warnDevice} onClose={() => setAcknowledged((s) => new Set(s).add(device.serial!))} />
    </div>
  )
}
