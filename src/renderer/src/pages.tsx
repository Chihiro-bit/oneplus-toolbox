import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import {
  ArrowLeftRight,
  ArrowRight,
  Copy,
  HardDrive,
  LifeBuoy,
  Lock,
  LockOpen,
  Power,
  RotateCcw,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Stethoscope,
  Usb,
  Wrench,
  Zap
} from 'lucide-react'
import { FEATURES } from '@shared/features'
import type { DeviceMode, DriverEntry, RebootTarget } from '@shared/types'
import type { PageId } from './App'
import { isOnePlus, MODE_LABEL, type Toolbox } from './state'
import { Callout, Card, ModeBadge, type ConfirmSpec } from './ui'

export interface PageProps {
  tb: Toolbox
  confirm: Dispatch<SetStateAction<ConfirmSpec | null>>
  go: (p: PageId) => void
}

export function PageHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{desc}</p>
    </header>
  )
}

/** 根据设备模式决定按钮是否可用，并给出原因 */
export function useGate(tb: Toolbox, allowed: DeviceMode[]): { disabled: boolean; reason?: string } {
  if (tb.run.running) return { disabled: true, reason: '有操作正在进行' }
  if (tb.device.mode === 'none') return { disabled: true, reason: '未连接设备' }
  if (tb.device.needsPick) return { disabled: true, reason: '连接了多台设备，请先在左下角选择要操作的那一台' }
  if (!allowed.includes(tb.device.mode))
    return { disabled: true, reason: `需要在 ${allowed.map((m) => MODE_LABEL[m]).join(' / ')} 模式下使用` }
  return { disabled: false }
}

// ───────────── 概览 ─────────────

export function OverviewPage({ tb, go }: PageProps) {
  const d = tb.device
  const [drivers, setDrivers] = useState<DriverEntry[] | null>(null)
  const rows: [string, ReactNode][] = [
    ['设备代号', d.device],
    ['品牌', d.brand],
    ['Android 版本', d.androidVersion],
    ['系统版本', d.romVersion],
    ['构建号', d.buildId],
    ['当前槽位', d.slot?.toUpperCase()],
    ['Bootloader', d.unlocked === undefined ? undefined : d.unlocked ? '已解锁' : '已锁定'],
    ['Root', d.root],
    ['序列号', d.serial]
  ]

  return (
    <>
      <PageHeader title="概览" desc="连接手机后，这里会实时显示设备状态" />
      {isOnePlus(d) === false && (
        <Callout tone="danger">
          当前设备是 {d.brand || d.manufacturer}，不是一加手机。本工具只在一加手机上验证过，在其它品牌上解锁、Root 或刷写可能导致变砖。
        </Callout>
      )}
      <Card className="hero">
        <div className="hero-icon">
          <Smartphone size={30} />
        </div>
        <div className="hero-main">
          <div className="hero-title">
            <h2>{d.model ?? (d.mode === 'none' ? '等待设备连接' : (d.device ?? '未知设备'))}</h2>
            <ModeBadge mode={d.mode} />
          </div>
          {d.mode === 'none' && (
            <p className="muted">
              用数据线连接手机，并在「开发者选项」中打开「USB 调试」。如果一直检测不到，请先安装 USB 驱动。
            </p>
          )}
          {d.mode === 'unauthorized' && (
            <p className="muted">手机上弹出了 USB 调试授权窗口，请勾选「始终允许」并点击「允许」。</p>
          )}
          {d.needsPick && <p className="warn-text">连接了多台设备。为避免误操作，请先在左下角选择要操作的那一台。</p>}
          {d.mode === 'edl' && !FEATURES.edl && (
            <p className="muted">手机处于 9008 模式。工具箱的 9008 功能暂时停用；退出方法：长按 音量上 + 电源键直到重启。</p>
          )}
          {d.mode !== 'none' && d.mode !== 'unauthorized' && (
            <dl className="props">
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
          )}
        </div>
      </Card>

      {d.mode === 'none' && (
        <Card className="help-card">
          <Usb size={18} />
          <div>
            <strong>检测不到设备？</strong>
            <span className="muted">安装 Google USB 驱动，或换一根支持数据传输的线、换一个 USB 口</span>
          </div>
          <button
            className="btn btn-secondary"
            disabled={tb.run.running}
            onClick={async () => {
              const r = await tb.start('检查驱动', { kind: 'driverCheck' })
              setDrivers(r.drivers ?? null)
            }}
          >
            检查驱动
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => window.toolbox.openExternal('https://developer.android.com/studio/run/win-usb')}
          >
            驱动下载
          </button>
        </Card>
      )}
      {d.mode === 'none' && drivers && drivers.length > 0 && (
        <Card>
          <h3 className="card-title">设备管理器里的手机</h3>
          <ul className="driver-list">
            {drivers.map((x) => (
              <li key={x.instanceId} className={x.ok ? '' : 'bad'}>
                <strong>{x.name}</strong>
                <span className={x.ok ? 'ok-text small' : 'error-text small'}>{x.problem ?? '驱动正常'}</span>
                {x.hint && <span className="muted small">{x.hint}</span>}
                <code className="small muted">{x.instanceId}</code>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h3 className="section-title">常用功能</h3>
      <div className="tiles">
        <Tile icon={<Power size={20} />} title="重启与模式" desc={`系统 / Recovery / Fastboot${FEATURES.edl ? ' / EDL' : ''}`} onClick={() => go('reboot')} />
        <Tile icon={<LockOpen size={20} />} title="解锁 Bootloader" desc="Root 的前置步骤" onClick={() => go('bootloader')} />
        <Tile icon={<Sparkles size={20} />} title="一键 Root" desc="Magisk / APatch / KernelSU 等 6 种方案" onClick={() => go('root')} />
        <Tile icon={<Stethoscope size={20} />} title="开机诊断" desc="卡开机时找原因、给修复办法" onClick={() => go('diagnose')} />
        <Tile icon={<LifeBuoy size={20} />} title="救援与恢复" desc="卸载 Root、撤销刷写、模块导致卡开机" onClick={() => go('rescue')} />
        <Tile icon={<ArrowLeftRight size={20} />} title="A/B 槽位切换" desc="变砖时的自救手段" onClick={() => go('slot')} />
        {FEATURES.edl && (
          <Tile icon={<HardDrive size={20} />} title="9008 救砖" desc="高通 EDL 深刷（需自备散包）" onClick={() => go('edl')} />
        )}
        <Tile icon={<Copy size={20} />} title="应用管理" desc="应用双开、卸载预装应用" onClick={() => go('apps')} />
        <Tile icon={<Wrench size={20} />} title="系统工具" desc="安装应用、Play 商店、禁用系统更新" onClick={() => go('tools')} />
      </div>
    </>
  )
}

function Tile({ icon, title, desc, onClick }: { icon: ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button className="tile" onClick={onClick}>
      <div className="tile-icon">{icon}</div>
      <div className="tile-text">
        <strong>{title}</strong>
        <span>{desc}</span>
      </div>
      <ArrowRight size={16} className="tile-arrow" />
    </button>
  )
}

// ───────────── 重启 ─────────────

const REBOOT_ITEMS: { target: RebootTarget; title: string; desc: string; icon: ReactNode; modes: DeviceMode[] }[] = [
  { target: 'system', title: '重启到系统', desc: '正常开机', icon: <RotateCcw size={20} />, modes: ['system', 'recovery', 'fastboot', 'fastbootd'] },
  { target: 'recovery', title: 'Recovery', desc: '部分机型不支持从 Fastboot 直接进入', icon: <Wrench size={20} />, modes: ['system', 'recovery', 'fastboot', 'fastbootd'] },
  { target: 'bootloader', title: 'Fastboot', desc: '解锁、刷写分区时使用', icon: <Zap size={20} />, modes: ['system', 'recovery', 'fastboot', 'fastbootd'] },
  { target: 'fastbootd', title: 'fastbootd', desc: '用户空间的 Fastboot，取消未合并的系统更新、刷逻辑分区时用', icon: <Zap size={20} />, modes: ['system', 'recovery', 'fastboot', 'fastbootd'] },
  ...(FEATURES.edl
    ? [{ target: 'edl' as const, title: 'EDL / 9008', desc: '高通线刷 / MTK 深刷模式，建议从开机状态进入', icon: <ShieldAlert size={20} />, modes: ['system', 'recovery', 'fastboot', 'fastbootd'] as DeviceMode[] }]
    : [])
]

export function RebootPage({ tb, confirm }: PageProps) {
  const gate = useGate(tb, ['system', 'recovery', 'fastboot', 'fastbootd'])
  return (
    <>
      <PageHeader title="重启与模式" desc="在开机、Recovery、Fastboot 之间切换" />
      <div className="action-grid">
        {REBOOT_ITEMS.map((it) => (
          <Card key={it.target} className="action-card">
            <div className="action-icon">{it.icon}</div>
            <h3>{it.title}</h3>
            <p className="muted">{it.desc}</p>
            <button
              className="btn btn-secondary"
              disabled={gate.disabled}
              title={gate.reason}
              onClick={() => {
                const go = () => tb.start(`重启到 ${it.title}`, { kind: 'reboot', target: it.target })
                if (it.target !== 'edl') return go()
                confirm({
                  title: '进入 EDL 模式',
                  intro: 'EDL 是高通线刷 / MTK 深刷模式，手机会黑屏，只能用专用线刷工具或按键组合退出。',
                  checks: ['我知道如何退出 EDL：长按 音量上 + 电源键（老机型长按电源键）'],
                  confirmText: '进入 EDL',
                  onConfirm: go
                })
              }}
            >
              执行
            </button>
          </Card>
        ))}
      </div>
      {gate.reason && !tb.run.running && <p className="gate-hint">{gate.reason}</p>}
    </>
  )
}

// ───────────── Bootloader ─────────────

export function BootloaderPage({ tb, confirm }: PageProps) {
  const gate = useGate(tb, ['system', 'fastboot', 'fastbootd'])
  const d = tb.device
  return (
    <>
      <PageHeader title="Bootloader" desc="解锁是 Root 和刷第三方系统的前提。解锁、上锁都会清空手机全部数据" />
      {(d.mode === 'fastboot' || d.mode === 'fastbootd') && d.unlocked !== undefined && (
        <Callout tone="info">当前 Bootloader 状态：{d.unlocked ? '已解锁' : '已锁定'}</Callout>
      )}
      <div className="action-grid two">
        <Card className="action-card">
          <div className="action-icon accent">
            <LockOpen size={20} />
          </div>
          <h3>解锁 Bootloader</h3>
          <ol className="steps">
            <li>备份手机数据（解锁会清除全部数据，包括内置存储）</li>
            <li>在「开发者选项」中打开「OEM 解锁」</li>
            <li>部分机型需要先申请并通过「深度测试」</li>
            <li>执行后，在手机上用音量键选中 UNLOCK THE BOOTLOADER，按电源键确认</li>
          </ol>
          <button
            className="btn btn-primary"
            disabled={gate.disabled}
            title={gate.reason}
            onClick={() =>
              confirm({
                title: '解锁 Bootloader',
                danger: true,
                intro: '手机将自动进入 Fastboot 并发送解锁指令。确认后手机上的所有数据都会被清除。',
                checks: [
                  '我已备份手机数据到电脑、云端或其它设备',
                  '我已在开发者选项中打开「OEM 解锁」',
                  '我的机型不需要深度测试，或已通过深度测试审核'
                ],
                confirmText: '开始解锁',
                onConfirm: () => tb.start('解锁 Bootloader', { kind: 'unlock' })
              })
            }
          >
            开始解锁
          </button>
        </Card>

        <Card className="action-card">
          <div className="action-icon danger">
            <Lock size={20} />
          </div>
          <h3>上锁 Bootloader</h3>
          <Callout tone="danger">
            上锁前系统分区必须是<strong>完全官方、未经任何修改</strong>的状态。已 Root 或刷过第三方镜像时直接上锁，可能导致无法开机。
            不确定的话，请先用官方全量包本地升级或平刷一次。
          </Callout>
          <button
            className="btn btn-danger"
            disabled={gate.disabled}
            title={gate.reason}
            onClick={() =>
              confirm({
                title: '上锁 Bootloader',
                danger: true,
                intro: '上锁同样会清空全部数据。如果系统被修改过，上锁后可能无法开机。',
                checks: ['我已备份手机数据', '当前系统是完全官方、未修改的状态（已卸载 Magisk 或刚平刷过全量包）'],
                confirmText: '开始上锁',
                onConfirm: () => tb.start('上锁 Bootloader', { kind: 'relock' })
              })
            }
          >
            开始上锁
          </button>
        </Card>
      </div>
      {gate.reason && !tb.run.running && <p className="gate-hint">{gate.reason}</p>}
    </>
  )
}

// ───────────── A/B 槽位 ─────────────

export function SlotPage({ tb, confirm }: PageProps) {
  const gate = useGate(tb, ['system', 'recovery', 'fastboot', 'fastbootd'])
  const slot = tb.device.slot?.toUpperCase()
  return (
    <>
      <PageHeader title="A/B 槽位" desc="适用于 A/B 分区机型。刷坏一个槽位后，切换到另一个槽位往往能重新开机" />
      <Card className="slot-card">
        <div className="slots">
          {['A', 'B'].map((s) => (
            <div key={s} className={`slot ${slot === s ? 'current' : ''}`}>
              <span className="slot-letter">{s}</span>
              <span className="slot-label">{slot === s ? '当前槽位' : slot ? '备用槽位' : '未知'}</span>
            </div>
          ))}
        </div>
        <p className="muted">会先进入 Fastboot 模式，再执行 fastboot --set-active=other。完成后设备停留在 Fastboot。</p>
        <button
          className="btn btn-primary"
          disabled={gate.disabled}
          title={gate.reason}
          onClick={() =>
            confirm({
              title: '切换 A/B 槽位',
              intro: '另一个槽位里的系统可能是旧版本，或者是空的。请确认你清楚自己在做什么。',
              checks: ['我了解切换后可能需要再切回来'],
              confirmText: '切换槽位',
              onConfirm: () => tb.start('切换 A/B 槽位', { kind: 'switchSlot' })
            })
          }
        >
          <ArrowLeftRight size={16} /> 切换到另一个槽位
        </button>
        {gate.reason && !tb.run.running && <p className="gate-hint">{gate.reason}</p>}
      </Card>
    </>
  )
}
