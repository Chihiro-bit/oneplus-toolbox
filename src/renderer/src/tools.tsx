import { useState, type DragEvent, type ReactNode } from 'react'
import { BellOff, BellRing, Check, FileUp, Package, PackagePlus, Power, RefreshCw, ShoppingBag, X, Zap } from 'lucide-react'
import { SHIZUKU } from '@shared/catalog'
import type { ShizukuAction, ShizukuState } from '@shared/types'
import { FilesCard, MirrorCard, WirelessCard } from './media'
import { PageHeader, useGate, type PageProps } from './pages'
import type { Toolbox } from './state'
import { Card } from './ui'

const INSTALL_EXTENSIONS = ['apk', 'apks', 'xapk']
const isInstallable = (p: string) => INSTALL_EXTENSIONS.includes(p.split('.').pop()?.toLowerCase() ?? '')
const fileName = (p: string) => p.split(/[\/]/).pop() ?? p

export function ToolsPage({ tb, confirm }: PageProps) {
  const [playApk, setPlayApk] = useState('')
  const [files, setFiles] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const [skipped, setSkipped] = useState(0)
  const gate = useGate(tb, ['system'])

  const add = (paths: string[]) => {
    const ok = paths.filter(isInstallable)
    setSkipped(paths.length - ok.length)
    setFiles((list) => [...list, ...ok.filter((p) => !list.includes(p))])
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setDragging(false)
    add([...e.dataTransfer.files].map((f) => window.toolbox.pathForFile(f)).filter(Boolean))
  }

  const install = async () => {
    const r = await tb.start(files.length === 1 ? `安装 ${fileName(files[0])}` : `安装 ${files.length} 个应用`, {
      kind: 'installApps',
      files
    })
    if (r.ok) setFiles([])
  }

  return (
    <>
      <PageHeader title="系统工具" desc="安装应用、投屏截图、文件传输和免 Root 的常用调整，需要手机开机并开启 USB 调试" />

      <Card className="install-card">
        <div className="card-head">
          <h3 className="card-title">安装应用</h3>
          {files.length > 0 && (
            <button className="btn btn-ghost" disabled={tb.run.running} onClick={() => setFiles([])}>
              清空
            </button>
          )}
        </div>
        <div
          className={`dropzone ${dragging ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <PackagePlus size={26} />
          <p>
            把 <code>.apk</code> / <code>.apks</code> / <code>.xapk</code> 拖到这里，可以一次拖多个
          </p>
          <button
            className="btn btn-secondary"
            onClick={async () => add(await window.toolbox.pickFiles('选择要安装的应用', INSTALL_EXTENSIONS))}
          >
            选择文件…
          </button>
        </div>
        {skipped > 0 && <p className="small error-text">已忽略 {skipped} 个不支持的文件</p>}
        {files.length > 0 && (
          <div className="file-list">
            {files.map((f) => (
              <div key={f} className="file-row">
                <Package size={14} />
                <span className="file-name" title={f}>
                  {fileName(f)}
                </span>
                {!/\.apk$/i.test(f) && <span className="chip">分包</span>}
                <button
                  className="icon-btn"
                  disabled={tb.run.running}
                  onClick={() => setFiles((list) => list.filter((x) => x !== f))}
                  aria-label="移除"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="card-actions">
          <button
            className="btn btn-primary"
            disabled={gate.disabled || files.length === 0}
            title={gate.reason ?? (files.length === 0 ? '请先添加文件' : undefined)}
            onClick={install}
          >
            <PackagePlus size={15} /> 安装{files.length > 1 ? `（${files.length} 个）` : ''}
          </button>
          <span className="muted small">
            覆盖安装时保留应用数据。分包会按手机的 CPU 架构挑选需要的部分，用 adb install-multiple 装成一个应用
          </span>
        </div>
      </Card>

      <div className="action-grid two">
        <MirrorCard tb={tb} gate={gate} />
        <ShizukuCard tb={tb} gate={gate} />
        <Card className="action-card">
          <div className="action-icon accent">
            <ShoppingBag size={20} />
          </div>
          <h3>安装 Play 商店</h3>
          <p className="muted">
            先卸载系统内置 Play 商店的更新，再安装你提供的 APK，最后通过应用商店的详情页触发 Play 商店自身更新。
          </p>
          <div className="rom-input">
            <FileUp size={16} />
            <input value={playApk} readOnly placeholder="选择 Play 商店 APK（com.android.vending）" />
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const p = await window.toolbox.pickApk('选择 Play 商店 APK')
                if (p) setPlayApk(p)
              }}
            >
              浏览…
            </button>
          </div>
          <button
            className="btn btn-primary"
            disabled={gate.disabled || !playApk}
            title={gate.reason ?? (!playApk ? '请先选择 APK' : undefined)}
            onClick={() => tb.start('安装 Play 商店', { kind: 'installPlay', apk: playApk })}
          >
            安装
          </button>
        </Card>

        <Card className="action-card">
          <div className="action-icon danger">
            <BellOff size={20} />
          </div>
          <h3>禁用 / 恢复系统更新</h3>
          <p className="muted">
            停用并卸载（仅对当前用户）系统更新组件，关闭更新提示。适用于 ColorOS、氧 OS、氢 OS。之后需要升级时，在这里恢复即可。
          </p>
          <div className="btn-row">
            <button
              className="btn btn-danger"
              disabled={gate.disabled}
              title={gate.reason}
              onClick={() =>
                confirm({
                  title: '禁用系统更新',
                  intro: '禁用后手机不会再收到系统更新推送，只能回到这里恢复。',
                  checks: ['我知道禁用后需要用本工具恢复，才能再次接收系统更新'],
                  confirmText: '禁用',
                  onConfirm: () => tb.start('禁用系统更新', { kind: 'otaUpdates', disable: true })
                })
              }
            >
              <BellOff size={15} /> 禁用系统更新
            </button>
            <button
              className="btn btn-secondary"
              disabled={gate.disabled}
              title={gate.reason}
              onClick={() => tb.start('恢复系统更新', { kind: 'otaUpdates', disable: false })}
            >
              <BellRing size={15} /> 恢复系统更新
            </button>
          </div>
        </Card>
      </div>
      <FilesCard tb={tb} gate={gate} />
      <WirelessCard tb={tb} />
      {gate.reason && !tb.run.running && <p className="gate-hint">{gate.reason}</p>}
    </>
  )
}

function Req({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'ok-text' : 'muted'}>
      {ok ? <Check size={13} /> : <X size={13} />} {children}
    </li>
  )
}

function ShizukuCard({ tb, gate }: { tb: Toolbox; gate: { disabled: boolean; reason?: string } }) {
  const [state, setState] = useState<ShizukuState | null>(null)
  const run = async (action: ShizukuAction) => {
    const r = await tb.start(action === 'start' ? '启动 Shizuku' : '检查 Shizuku 状态', { kind: 'shizuku', action })
    if (r.shizuku) setState(r.shizuku)
  }

  return (
    <Card className="action-card">
      <div className="action-icon accent">
        <Zap size={20} />
      </div>
      <h3>
        Shizuku{' '}
        {state && (
          <span className={`chip ${state.running ? 'chip-ok' : ''}`}>
            {!state.installed ? '未安装' : state.running ? '运行中' : '未运行'}
            {state.installed && state.version ? ` · ${state.version}` : ''}
          </span>
        )}
      </h3>
      <p className="muted">
        让其它应用免 Root 调用系统接口（如冰箱、App Ops、黑阈）。手机上没装时会先从{' '}
        <button className="link-btn" onClick={() => window.toolbox.openExternal(SHIZUKU.homepage)}>
          官方发布页
        </button>{' '}
        下载 {SHIZUKU.version} 并校验 sha256。免 Root 启动在手机重启后会失效，需要重新启动一次。
      </p>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={gate.disabled} title={gate.reason} onClick={() => run('start')}>
          <Zap size={15} /> {state && !state.installed ? '安装并启动' : '启动 Shizuku'}
        </button>
        <button className="btn btn-secondary" disabled={gate.disabled} title={gate.reason} onClick={() => run('status')}>
          <RefreshCw size={15} /> 检查状态
        </button>
        <button
          className="btn btn-secondary"
          disabled={gate.disabled || state?.installed === false}
          title={gate.reason ?? (state?.installed === false ? '请先安装并启动 Shizuku' : undefined)}
          onClick={() => run('autostart')}
        >
          <Power size={15} /> 开机自启
        </button>
      </div>
      {state?.installed && state.sdk !== undefined && (
        <ul className="shizuku-reqs small">
          <Req ok={state.sdk >= 33}>Android 13 及以上（免 Root 开机自启的前提）</Req>
          <Req ok={!!state.secureSettings}>已授予「修改安全系统设置」</Req>
          <Req ok={!!state.bootReceiver}>开机启动没有被关掉</Req>
          <li className="muted">
            另外需要在手机上：用 Shizuku 的「通过无线调试启动」配对并启动一次；在系统设置里允许 Shizuku 自启动
          </li>
        </ul>
      )}
    </Card>
  )
}
