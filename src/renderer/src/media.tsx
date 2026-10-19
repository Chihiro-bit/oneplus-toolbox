import { useState, type DragEvent } from 'react'
import { Camera, ChevronRight, Download, File, Folder, FolderUp, MonitorSmartphone, RefreshCw, Upload } from 'lucide-react'
import { DISPLAY_SIZES, type AppEntry, type DisplaySize, type RemoteEntry, type WirelessRequest } from '@shared/types'
import type { Toolbox } from './state'
import { Card } from './ui'

const ROOT = '/sdcard'

function size(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

// ───────────── 投屏与截图 ─────────────

export function MirrorCard({ tb, gate }: { tb: Toolbox; gate: { disabled: boolean; reason?: string } }) {
  const [separate, setSeparate] = useState(false)
  const [turnScreenOff, setTurnScreenOff] = useState(false)
  const [stayAwake, setStayAwake] = useState(true)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [apps, setApps] = useState<AppEntry[] | null>(null)
  const [app, setApp] = useState('')
  const [size, setSize] = useState<DisplaySize>('1920x1080')
  const [keepApp, setKeepApp] = useState(false)
  const [audioOnPhone, setAudioOnPhone] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 投屏不占用操作队列，有操作在进行时也可以打开
  const mirrorBlocked = tb.device.mode !== 'system' ? '需要手机开机并开启 USB 调试' : tb.device.needsPick ? '请先在左下角选择要操作的设备' : undefined

  const loadApps = async () => {
    const r = await tb.start('读取应用列表', { kind: 'listUserApps' })
    if (r.ok && r.apps) setApps(r.apps.filter((a) => !a.disabled))
  }

  const start = async () => {
    const r = await window.toolbox.startMirror({
      turnScreenOff,
      stayAwake,
      alwaysOnTop,
      display: separate ? { app: app || undefined, size, keepApp, audioOnPhone } : undefined
    })
    setMsg({ ok: r.ok, text: r.message })
  }

  return (
    <Card className="action-card">
      <div className="action-icon accent">
        <MonitorSmartphone size={20} />
      </div>
      <h3>投屏与截图</h3>
      <div className="segmented">
        <button className={!separate ? 'on' : ''} onClick={() => setSeparate(false)}>
          镜像手机屏幕
        </button>
        <button className={separate ? 'on' : ''} onClick={() => setSeparate(true)}>
          独立屏幕
        </button>
      </div>
      {!separate ? (
        <>
          <p className="muted">用 scrcpy 把手机画面投到电脑上，可以用鼠标键盘直接操作，拖文件进窗口就能发送到手机。</p>
          <label className="check">
            <input type="checkbox" checked={stayAwake} onChange={(e) => setStayAwake(e.target.checked)} />
            <span>投屏期间手机保持亮屏</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={turnScreenOff} onChange={(e) => setTurnScreenOff(e.target.checked)} />
            <span>关闭手机屏幕（只在电脑上显示，更省电）</span>
          </label>
        </>
      ) : (
        <>
          <p className="muted">
            在手机上新建一块虚拟屏幕投到电脑上：电脑上用一个应用，手机上照常用别的，互不影响，手机锁屏后电脑上也能继续用。
            同一个应用不能同时在两边打开；银行、支付类应用在电脑上会黑屏。
          </p>
          <div className="mirror-row">
            <select value={app} onChange={(e) => setApp(e.target.value)} aria-label="在电脑上打开的应用">
              <option value="">副屏桌面（在电脑上自己选应用）</option>
              {apps?.map((a) => (
                <option key={a.package} value={a.package}>
                  {a.label}
                </option>
              ))}
            </select>
            <button className="btn btn-ghost" disabled={gate.disabled} title={gate.reason} onClick={loadApps}>
              <RefreshCw size={14} /> {apps ? '刷新' : '读取应用'}
            </button>
          </div>
          <div className="mirror-row">
            <select value={size} onChange={(e) => setSize(e.target.value as DisplaySize)} aria-label="分辨率">
              {Object.entries(DISPLAY_SIZES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={audioOnPhone} onChange={(e) => setAudioOnPhone(e.target.checked)} />
            <span>声音留在手机上（不勾时所有应用的声音都转到电脑）</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={keepApp} onChange={(e) => setKeepApp(e.target.checked)} />
            <span>关掉窗口后把应用移回手机（会跳到手机屏幕前台）</span>
          </label>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={alwaysOnTop} onChange={(e) => setAlwaysOnTop(e.target.checked)} />
        <span>投屏窗口始终置顶（不会被其它窗口挡住）</span>
      </label>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={!!mirrorBlocked} title={mirrorBlocked} onClick={start}>
          <MonitorSmartphone size={15} /> {separate ? '打开独立屏幕' : '开始投屏'}
        </button>
        <button className="btn btn-secondary" disabled={gate.disabled} title={gate.reason} onClick={() => tb.start('截图', { kind: 'screenshot' })}>
          <Camera size={15} /> 截图
        </button>
      </div>
      {msg && <p className={`small ${msg.ok ? 'muted' : 'error-text'}`}>{msg.text}</p>}
    </Card>
  )
}

// ───────────── 无线调试 ─────────────

export function WirelessCard({ tb }: { tb: Toolbox }) {
  const [host, setHost] = useState('')
  const [pairPort, setPairPort] = useState('')
  const [code, setCode] = useState('')
  const [port, setPort] = useState('')
  const d = tb.device
  const busy = tb.run.running
  const usbReady = d.mode === 'system' && !d.needsPick && !d.serial?.includes(':')
  const wireless = (request: WirelessRequest) => tb.start('无线调试', { kind: 'wireless', request })

  return (
    <Card className="wireless-card">
      <div className="card-head">
        <h3 className="card-title">无线调试</h3>
        <button className="btn btn-ghost" disabled={busy} onClick={() => wireless({ action: 'disconnect' })}>
          断开无线连接
        </button>
      </div>
      <p className="muted small">
        电脑和手机连同一个 Wi-Fi。Android 11 及以上：在手机「开发者选项 → 无线调试」里打开开关，第一次使用先点「使用配对码配对设备」配对，之后只需要连接。
      </p>
      <div className="wireless-grid">
        <label className="field-label" htmlFor="wl-host">手机 IP</label>
        <input id="wl-host" className="text-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.23" spellCheck={false} />
        <span />

        <label className="field-label" htmlFor="wl-pair">配对</label>
        <div className="wireless-inline">
          <input id="wl-pair" className="text-input" value={pairPort} onChange={(e) => setPairPort(e.target.value)} placeholder="配对端口" inputMode="numeric" />
          <input className="text-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6 位配对码" inputMode="numeric" maxLength={6} />
        </div>
        <button
          className="btn btn-secondary"
          disabled={busy || !host.trim() || !pairPort.trim() || code.trim().length !== 6}
          onClick={() => wireless({ action: 'pair', host, port: pairPort, code })}
        >
          配对
        </button>

        <label className="field-label" htmlFor="wl-port">连接</label>
        <input id="wl-port" className="text-input" value={port} onChange={(e) => setPort(e.target.value)} placeholder="无线调试页面上方显示的端口" inputMode="numeric" />
        <button className="btn btn-primary" disabled={busy || !host.trim() || !port.trim()} onClick={() => wireless({ action: 'connect', host, port })}>
          连接
        </button>
      </div>
      <div className="card-actions">
        <button
          className="btn btn-secondary"
          disabled={busy || !usbReady}
          title={!usbReady ? '需要手机开机、用数据线连接' : undefined}
          onClick={() => wireless({ action: 'fromUsb' })}
        >
          从数据线切换到无线
        </button>
        <span className="muted small">插着数据线时一键切换（adb tcpip 5555），适合没有「无线调试」选项的老系统；手机重启后失效</span>
      </div>
    </Card>
  )
}

// ───────────── 文件传输 ─────────────

export function FilesCard({ tb, gate }: { tb: Toolbox; gate: { disabled: boolean; reason?: string } }) {
  const [path, setPath] = useState(ROOT)
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null)
  const [dragging, setDragging] = useState(false)

  const open = async (p: string) => {
    const r = await tb.start(`浏览 ${p}`, { kind: 'listRemote', path: p })
    if (r.ok && r.remote) {
      setPath(r.remote.path)
      setEntries(r.remote.entries)
    }
  }

  const send = async (files: string[]) => {
    if (files.length === 0 || gate.disabled) return
    const r = await tb.start(files.length === 1 ? `发送 ${files[0].split(/[\\/]/).pop()}` : `发送 ${files.length} 个文件`, {
      kind: 'pushFiles',
      files,
      to: path
    })
    if (r.ok && entries) open(path)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    send([...e.dataTransfer.files].map((f) => window.toolbox.pathForFile(f)).filter(Boolean))
  }

  const crumbs = path.split('/').filter(Boolean)

  return (
    <Card className="files-card">
      <div className="card-head">
        <h3 className="card-title">文件传输</h3>
        <div className="btn-row">
          <button
            className="btn btn-secondary"
            disabled={gate.disabled}
            title={gate.reason}
            onClick={async () => send(await window.toolbox.pickFiles('选择要发送到手机的文件', []))}
          >
            <Upload size={15} /> 发送文件…
          </button>
          <button className="btn btn-ghost" disabled={gate.disabled} title={gate.reason} onClick={() => open(path)}>
            <RefreshCw size={15} /> {entries ? '刷新' : '浏览手机存储'}
          </button>
        </div>
      </div>
      <div
        className={`files-body ${dragging ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <div className="crumbs small">
          {crumbs.map((c, i) => {
            const to = `/${crumbs.slice(0, i + 1).join('/')}`
            return (
              <span key={to}>
                {i > 0 && <ChevronRight size={12} />}
                <button className="link-btn" disabled={gate.disabled} onClick={() => open(to)}>
                  {i === 0 ? '内置存储' : c}
                </button>
              </span>
            )
          })}
          <span className="muted">　把文件拖到这里，发送到当前文件夹</span>
        </div>
        {entries && (
          <ul className="file-browser">
            {path !== ROOT && (
              <li>
                <button className="fb-row" disabled={gate.disabled} onClick={() => open(path.slice(0, path.lastIndexOf('/')) || ROOT)}>
                  <FolderUp size={15} />
                  <span className="fb-name">上一级</span>
                </button>
              </li>
            )}
            {entries.length === 0 && <li className="muted small fb-empty">空文件夹</li>}
            {entries.map((e) => (
              <li key={e.name}>
                {e.dir ? (
                  <button className="fb-row" disabled={gate.disabled} onClick={() => open(`${path}/${e.name}`)}>
                    <Folder size={15} />
                    <span className="fb-name">{e.name}</span>
                  </button>
                ) : (
                  <div className="fb-row">
                    <File size={15} />
                    <span className="fb-name" title={e.name}>
                      {e.name}
                    </span>
                    <span className="muted small">{size(e.size)}</span>
                    <button
                      className="icon-btn"
                      disabled={gate.disabled}
                      title="保存到电脑"
                      aria-label={`保存 ${e.name} 到电脑`}
                      onClick={() => tb.start(`接收 ${e.name}`, { kind: 'pullFile', path: `${path}/${e.name}` })}
                    >
                      <Download size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <p className="muted small">从手机接收的文件保存在「文档\一加工具箱\传输」。</p>
    </Card>
  )
}
