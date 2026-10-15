import { useEffect, useState } from 'react'
import { ArrowRight, Download, FileText, FolderOpen, Save } from 'lucide-react'
import type { CatalogState, Settings, UpdateInfo } from '@shared/types'
import { PageHeader, type PageProps } from './pages'
import { Callout, Card } from './ui'

export function SettingsPage({ tb }: PageProps) {
  const [settings, setSettings] = useState<Settings>({ catalogUrl: '', updateRepo: '' })
  const [catalog, setCatalog] = useState<CatalogState | null>(null)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [download, setDownload] = useState<DownloadState>({ state: 'idle' })

  useEffect(() => {
    window.toolbox.getSettings().then((s) => {
      setSettings(s)
      // 从侧栏的「新版本」进来时直接显示结果
      if (s.updateRepo) window.toolbox.checkUpdate().then(setUpdate)
    })
    window.toolbox.getCatalog().then(setCatalog)
  }, [])

  const save = async () => {
    try {
      const s = await window.toolbox.setSettings(settings)
      setSettings(s)
      const c = await window.toolbox.getCatalog()
      setCatalog(c)
      setSaveMsg(c.error ? { ok: false, text: c.error } : { ok: true, text: '已保存' })
    } catch (e) {
      setSaveMsg({ ok: false, text: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  }

  const check = async () => {
    setChecking(true)
    setUpdate(await window.toolbox.checkUpdate())
    setChecking(false)
  }

  return (
    <>
      <PageHeader title="设置" desc="方案目录、版本更新、日志与诊断" />

      <div className="stack">
        <Card>
          <h3 className="card-title">Root 方案目录</h3>
          <p className="muted small">
            留空时只使用内置目录。可以填一个自己维护的 <code>catalog.json</code> 地址（例如 GitHub 上的 raw 链接），用来更新各方案的
            APK 版本。目录只包含下载地址和 sha256，不会下发任何脚本；每个 APK 下载后都会强制校验哈希。
          </p>
          <label className="field-label" htmlFor="catalogUrl">
            目录地址
          </label>
          <div className="rom-input">
            <input
              id="catalogUrl"
              value={settings.catalogUrl}
              onChange={(e) => setSettings({ ...settings, catalogUrl: e.target.value })}
              placeholder="https://raw.githubusercontent.com/<owner>/<repo>/main/catalog/catalog.json"
              spellCheck={false}
            />
          </div>
          {catalog && (
            <p className="muted small">
              当前：{catalog.source === 'remote' ? '远程目录' : catalog.source === 'cache' ? '远程目录（离线缓存）' : '内置目录'}，共{' '}
              {catalog.schemes.length} 个方案
            </p>
          )}

          <h3 className="card-title">检查更新</h3>
          <p className="muted small">填写发布本工具的 GitHub 仓库，会读取该仓库最新的 Release 版本号。</p>
          <label className="field-label" htmlFor="updateRepo">
            GitHub 仓库
          </label>
          <div className="rom-input">
            <input
              id="updateRepo"
              value={settings.updateRepo}
              onChange={(e) => setSettings({ ...settings, updateRepo: e.target.value })}
              placeholder="owner/repo"
              spellCheck={false}
            />
          </div>

          <div className="card-actions">
            <button className="btn btn-primary" onClick={save}>
              <Save size={15} /> 保存
            </button>
            <button className="btn btn-secondary" onClick={check} disabled={checking}>
              <Download size={15} /> {checking ? '检查中…' : '检查更新'}
            </button>
            {saveMsg && <span className={`small ${saveMsg.ok ? 'ok-text' : 'error-text'}`}>{saveMsg.text}</span>}
          </div>

          {update && (
            <div className="update-result">
              {update.error ? (
                <Callout tone="warn">
                  当前版本 {update.current}。{update.error}
                </Callout>
              ) : update.hasUpdate ? (
                <Callout tone="info">
                  发现新版本 {update.latest}（当前 {update.current}）。{' '}
                  {update.canAuto && download.state !== 'failed' ? (
                    <UpdateActions download={download} setDownload={setDownload} />
                  ) : (
                    <>
                      {download.state === 'failed' && <span className="error-text">{download.message} </span>}
                      <button className="link-btn" onClick={() => window.toolbox.openExternal(update.url!)}>
                        前往下载 <ArrowRight size={13} />
                      </button>
                    </>
                  )}
                </Callout>
              ) : (
                <p className="muted small">已是最新版本（{update.current}）</p>
              )}
            </div>
          )}
        </Card>

        <Card>
          <h3 className="card-title">日志与诊断</h3>
          <p className="muted small">
            每次操作的日志都会保存到「文档\一加工具箱\logs」，保留 30 天。提交问题反馈时，请导出诊断信息并附上：里面有工具箱版本、
            设备状态（开机时读取与刷机相关的系统属性，Fastboot 下读取 <code>getvar all</code>）和最近两天的日志。序列号会被打码，
            不包含 IMEI、账号等信息。
          </p>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={tb.run.running}
              onClick={() => tb.start('导出诊断信息', { kind: 'exportDiagnostics' })}
            >
              <FileText size={15} /> 导出诊断信息
            </button>
            <button className="btn btn-secondary" onClick={() => window.toolbox.openLogDir()}>
              <FolderOpen size={15} /> 打开日志文件夹
            </button>
          </div>
        </Card>
      </div>
    </>
  )
}

type DownloadState =
  | { state: 'idle' }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; message: string }
  | { state: 'failed'; message: string }

/** 安装版：下载新版本（显示进度），下载完重启安装 */
function UpdateActions({ download, setDownload }: { download: DownloadState; setDownload: (d: DownloadState) => void }) {
  useEffect(
    () => window.toolbox.onUpdateProgress((percent) => setDownload({ state: 'downloading', percent })),
    [setDownload]
  )
  if (download.state === 'downloading')
    return <span className="small">正在下载 {Math.round(download.percent)}%</span>
  if (download.state === 'ready')
    return (
      <button className="link-btn" onClick={() => window.toolbox.installUpdate()}>
        重启并安装 <ArrowRight size={13} />
      </button>
    )
  return (
    <button
      className="link-btn"
      onClick={async () => {
        setDownload({ state: 'downloading', percent: 0 })
        const r = await window.toolbox.downloadUpdate()
        setDownload(r.ok ? { state: 'ready', message: r.message } : { state: 'failed', message: r.message })
      }}
    >
      下载并安装 <ArrowRight size={13} />
    </button>
  )
}
