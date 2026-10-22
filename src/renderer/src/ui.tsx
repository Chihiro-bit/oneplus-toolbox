import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FolderOpen, Loader2, Minimize2, Power, ShieldAlert, Trash2, X, XCircle } from 'lucide-react'
import type { CloseAction, DeviceInfo, DeviceMode, LogEntry } from '@shared/types'
import { MODE_LABEL, randomCode, type RunState } from './state'

export function ModeBadge({ mode }: { mode: DeviceMode }) {
  return (
    <span className={`badge mode-${mode}`}>
      <span className="dot" />
      {MODE_LABEL[mode]}
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`card ${className}`}>{children}</section>
}

export function Callout({ tone, children }: { tone: 'warn' | 'info' | 'danger'; children: ReactNode }) {
  return (
    <div className={`callout callout-${tone}`}>
      <AlertTriangle size={16} />
      <div>{children}</div>
    </div>
  )
}

// ───────────── 运行状态横幅 ─────────────

export function RunBanner({ run, onCancel, onDismiss }: { run: RunState; onCancel: () => void; onDismiss: () => void }) {
  if (!run.running && !run.result) return null
  if (run.running)
    return (
      <div className="banner banner-running">
        <Loader2 size={18} className="spin" />
        <div className="banner-body">
          <strong>{run.title}</strong>
          <span>{run.step}</span>
        </div>
        <button className="btn btn-ghost" onClick={onCancel}>
          取消
        </button>
        <div className="progress-indeterminate" />
      </div>
    )
  const r = run.result!
  return (
    <div className={`banner ${r.ok ? 'banner-ok' : 'banner-error'}`}>
      {r.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
      <div className="banner-body">
        <strong>
          {run.title} · {r.ok ? '完成' : '失败'}
        </strong>
        <span>{r.message}</span>
      </div>
      {r.outputPath && (
        <button className="btn btn-ghost" onClick={() => window.toolbox.openPath(r.outputPath!)}>
          <FolderOpen size={15} /> 打开文件位置
        </button>
      )}
      <button className="icon-btn" onClick={onDismiss} aria-label="关闭">
        <X size={16} />
      </button>
    </div>
  )
}

// ───────────── 危险操作确认对话框 ─────────────

export interface ConfirmSpec {
  title: string
  danger?: boolean
  intro?: ReactNode
  checks: string[]
  confirmText: string
  confirmationPhrase?: string
  waitSeconds?: number
  onConfirm: () => void
}

export function ConfirmDialog({ spec, onClose }: { spec: ConfirmSpec | null; onClose: () => void }) {
  const [checked, setChecked] = useState<boolean[]>([])
  const [input, setInput] = useState('')
  const [phrase, setPhrase] = useState('')
  const [waiting, setWaiting] = useState<{ spec: ConfirmSpec; until: number; left: number } | null>(null)
  const code = useMemo(() => randomCode(), [spec])

  useEffect(() => {
    setChecked(spec ? spec.checks.map(() => false) : [])
    setInput('')
    setPhrase('')
    if (!spec) { setWaiting(null); return }
    const until = Date.now() + (spec.waitSeconds ?? 0) * 1000
    const tick = () => setWaiting({ spec, until, left: Math.max(0, Math.ceil((until - Date.now()) / 1000)) })
    tick()
    const timer = setInterval(tick, 200)
    return () => clearInterval(timer)
  }, [spec])

  if (!spec) return null
  const left = waiting?.spec === spec ? waiting.left : (spec.waitSeconds ?? 0)
  const ready = checked.length === spec.checks.length && checked.every(Boolean) && left === 0
    && (!spec.danger || input.trim().toUpperCase() === code)
    && (!spec.confirmationPhrase || phrase === spec.confirmationPhrase)

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header>
          <h2>{spec.title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </header>
        {spec.intro && <div className="modal-intro">{spec.intro}</div>}
        <div className="checklist">
          {spec.checks.map((c, i) => (
            <label key={c} className="check">
              <input
                type="checkbox"
                checked={checked[i] ?? false}
                onChange={(e) => setChecked((arr) => arr.map((v, j) => (j === i ? e.target.checked : v)))}
              />
              <span>{c}</span>
            </label>
          ))}
        </div>
        {spec.danger && (
          <div className="code-confirm">
            <span>
              请输入确认码 <code>{code}</code>
            </span>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={code.length}
              spellCheck={false}
            />
          </div>
        )}
        {spec.confirmationPhrase && (
          <label className="code-confirm">
            <span>请输入「{spec.confirmationPhrase}」</span>
            <input value={phrase} onChange={(e) => setPhrase(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
        )}
        <footer>
          <button className="btn btn-ghost" onClick={onClose}>
            取消
          </button>
          <button
            className={`btn ${spec.danger ? 'btn-danger' : 'btn-primary'}`}
            disabled={!ready}
            onClick={() => {
              onClose()
              spec.onConfirm()
            }}
          >
            {left > 0 ? `请阅读风险提示（${left} 秒）` : spec.confirmText}
          </button>
        </footer>
      </div>
    </div>
  )
}

// ───────────── 关闭确认 ─────────────

/** 点关闭按钮时由主进程通知弹出，样式与项目里的其它对话框一致 */
export function CloseDialog({ onClose }: { onClose: (action: CloseAction, remember: boolean) => Promise<void> }) {
  const [remember, setRemember] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const choose = async (action: CloseAction) => {
    if (saving) return
    setSaving(true)
    try { await onClose(action, action !== 'cancel' && remember) }
    catch { setError('无法保存关闭设置，请重试或取消勾选“记住本次操作”。') }
    finally { setSaving(false) }
  }
  return (
    <div className="modal-backdrop" onMouseDown={() => choose('cancel')}>
      <div
        className="modal modal-close"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-title"
      >
        <div className="close-icon">
          <Power size={24} />
        </div>
        <h2 id="close-title">要关闭一加工具箱吗？</h2>
        <p className="modal-intro">
          选择「收起到系统托盘」后，程序会继续在后台运行，投屏和正在进行的操作都不会中断；点击屏幕右下角托盘里的图标即可重新打开。
        </p>
        <label className="check">
          <input type="checkbox" checked={remember} disabled={saving} onChange={(e) => setRemember(e.target.checked)} />
          <span>记住本次操作（可在设置中更改）</span>
        </label>
        {error && <p className="error-text small" role="alert">{error}</p>}
        <footer>
          <button className="btn btn-ghost" disabled={saving} onClick={() => choose('cancel')}>
            取消
          </button>
          <button className="btn btn-secondary" disabled={saving} onClick={() => choose('quit')}>
            关闭程序
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => choose('tray')}>
            <Minimize2 size={15} /> 收起到系统托盘
          </button>
        </footer>
      </div>
    </div>
  )
}

// ───────────── 非一加设备警告 ─────────────

const BRAND_WARNING_SECONDS = 15

/** 检测到非一加设备时弹出；倒计时结束前不能关闭（不响应遮罩点击和 Esc） */
export function BrandWarning({ device, onClose }: { device: DeviceInfo | null; onClose: () => void }) {
  const [left, setLeft] = useState(BRAND_WARNING_SECONDS)

  useEffect(() => {
    if (!device) return
    setLeft(BRAND_WARNING_SECONDS)
    const t = setInterval(() => setLeft((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [device?.serial])

  if (!device) return null
  const brand = device.brand || device.manufacturer || ''
  // 型号里通常已带品牌（如 Xiaomi 15），避免显示成「Xiaomi Xiaomi 15」
  const name = device.model?.toLowerCase().startsWith(brand.toLowerCase()) ? device.model : [brand, device.model].filter(Boolean).join(' ')

  return (
    <div className="modal-backdrop">
      <div className="modal modal-warning" role="alertdialog" aria-modal="true" aria-labelledby="brand-warning-title">
        <div className="warning-icon">
          <ShieldAlert size={26} />
        </div>
        <h2 id="brand-warning-title">检测到非一加设备</h2>
        <p className="warning-device">{name || '未知设备'}</p>
        <div className="warning-body">
          <p>本工具只针对一加手机开发和测试，在其它品牌上从未验证过。</p>
          <ul>
            <li>各品牌的解锁方式、分区结构和刷机包格式都不同，这里的命令可能不适用</li>
            <li>在其它品牌上执行解锁、Root、刷写等操作，可能导致数据丢失或<strong>无法开机（变砖）</strong></li>
            <li>OPPO、realme 虽然系统相近，但解锁和刷机流程与一加不同，同样未经验证</li>
          </ul>
          <p>继续使用产生的一切后果需要你自行承担。</p>
        </div>
        <footer>
          <button className="btn btn-danger" disabled={left > 0} onClick={onClose}>
            {left > 0 ? `请阅读以上内容（${left} 秒）` : '我已了解风险，继续使用'}
          </button>
        </footer>
      </div>
    </div>
  )
}

// ───────────── 日志面板 ─────────────

export function LogPanel({ logs, onClear }: { logs: LogEntry[]; onClear: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const last = logs[logs.length - 1]

  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight
  }, [logs, open])

  return (
    <div className={`logpanel ${open ? 'open' : ''}`}>
      <div className="logbar" onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={15} className="chev" />
        <strong>日志</strong>
        {!open && last && <span className={`logbar-last lvl-${last.level}`} title={last.text}>{last.text}</span>}
        <span className="spacer" />
        <button className="icon-btn" onClick={(e) => { e.stopPropagation(); window.toolbox.openLogDir() }} aria-label="打开完整日志文件夹" title="打开完整日志文件夹（保留 30 天）">
          <FolderOpen size={15} />
        </button>
        {open && (
          <button
            className="icon-btn"
            onClick={(e) => {
              e.stopPropagation()
              onClear()
            }}
            aria-label="清空面板日志"
            title="仅清空面板，保留日志文件"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {open && (
        <div className="logbody" ref={ref}>
          <div className="muted">面板显示最近 2000 条日志；完整操作日志保存在日志文件夹中，保留 30 天。</div>
          {logs.length === 0 && <div className="log-empty">暂无日志</div>}
          {logs.map((l, i) => (
            <div key={i} className={`logline lvl-${l.level}`}>
              <time>{new Date(l.time).toLocaleTimeString('zh-CN', { hour12: false })}</time>
              <span>{l.level === 'cmd' ? `$ ${l.text}` : l.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
