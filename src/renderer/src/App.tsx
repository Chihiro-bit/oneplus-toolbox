import { useEffect, useState } from 'react'
import { ArrowLeftRight, ArrowUpCircle, Copy, Cpu, HardDrive, Home, LifeBuoy, LockKeyhole, Power, Settings, Smartphone, Sparkles, Stethoscope, Wrench } from 'lucide-react'
import { FEATURES } from '@shared/features'
import type { UpdateInfo } from '@shared/types'
import { AppsPage } from './apps'
import { BootDiagPage } from './bootdiag'
import { EdlPage } from './edl'
import { BootloaderPage, OverviewPage, RebootPage, SlotPage } from './pages'
import { RescuePage } from './rescue'
import { RootPage } from './root'
import { SettingsPage } from './settings'
import { isOnePlus, MODE_LABEL, useToolbox } from './state'
import { ToolsPage } from './tools'
import { BrandWarning, CloseDialog, ConfirmDialog, LogPanel, ModeBadge, RunBanner, type ConfirmSpec } from './ui'

export type PageId = 'overview' | 'reboot' | 'bootloader' | 'root' | 'diagnose' | 'rescue' | 'slot' | 'edl' | 'apps' | 'tools' | 'settings'

const NAV: { id: PageId; label: string; icon: typeof Home }[] = [
  { id: 'overview', label: '概览', icon: Home },
  { id: 'reboot', label: '重启与模式', icon: Power },
  { id: 'bootloader', label: 'Bootloader', icon: LockKeyhole },
  { id: 'root', label: '一键 Root', icon: Sparkles },
  { id: 'diagnose', label: '开机诊断', icon: Stethoscope },
  { id: 'rescue', label: '救援与恢复', icon: LifeBuoy },
  { id: 'slot', label: 'A/B 槽位', icon: ArrowLeftRight },
  ...(FEATURES.edl ? [{ id: 'edl' as const, label: '9008 救砖', icon: HardDrive }] : []),
  { id: 'apps', label: '应用管理', icon: Copy },
  { id: 'tools', label: '系统工具', icon: Wrench }
]

export default function App() {
  const tb = useToolbox()
  const [page, setPage] = useState<PageId>('overview')
  const [confirm, setConfirm] = useState<ConfirmSpec | null>(null)
  const [closeAsk, setCloseAsk] = useState(false)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  // 本次运行中已确认过警告的设备，不再重复弹出
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())
  const { device } = tb
  const warnDevice = device.serial && isOnePlus(device) === false && !acknowledged.has(device.serial) ? device : null

  // 主进程拦截关闭按钮后，由界面弹出自己的确认框
  useEffect(() => window.toolbox.onCloseRequest(() => setCloseAsk(true)), [])

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
          <button className="update-pill" onClick={() => (update.canAuto ? setPage('settings') : window.toolbox.openExternal(update.url!))}>
            <ArrowUpCircle size={15} /> 新版本 {update.latest}
          </button>
        )}
        {device.devices && (
          <div className="device-picker">
            <label className="small muted" htmlFor="device-picker">
              连接了 {device.devices.length} 台设备，操作哪一台？
            </label>
            <select
              id="device-picker"
              value={device.selected ?? ''}
              disabled={tb.run.running}
              onChange={(e) => window.toolbox.selectDevice(e.target.value)}
            >
              {!device.selected && <option value="">请选择…</option>}
              {device.selected && !device.devices.some((x) => x.serial === device.selected) && (
                <option value={device.selected}>{device.selected}（不在线）</option>
              )}
              {device.devices.map((x) => (
                <option key={x.serial} value={x.serial}>
                  {x.label ?? x.serial} · {MODE_LABEL[x.mode]}
                </option>
              ))}
            </select>
          </div>
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
          {page === 'diagnose' && <BootDiagPage {...props} />}
          {page === 'rescue' && <RescuePage {...props} />}
          {page === 'slot' && <SlotPage {...props} />}
          {FEATURES.edl && page === 'edl' && <EdlPage {...props} />}
          {page === 'apps' && <AppsPage {...props} />}
          {page === 'tools' && <ToolsPage {...props} />}
          {page === 'settings' && <SettingsPage {...props} />}
        </div>
        <LogPanel logs={tb.logs} onClear={tb.clearLogs} />
      </main>

      <ConfirmDialog spec={confirm} onClose={() => setConfirm(null)} />
      <BrandWarning device={warnDevice} onClose={() => setAcknowledged((s) => new Set(s).add(device.serial!))} />
      {closeAsk && (
        <CloseDialog
          onClose={(action) => {
            setCloseAsk(false)
            void window.toolbox.resolveClose(action)
          }}
        />
      )}
    </div>
  )
}
