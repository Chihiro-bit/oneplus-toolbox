import { useEffect, useState } from 'react'
import { ArrowRight, Download, Save } from 'lucide-react'
import type { CatalogState, Settings, UpdateInfo } from '@shared/types'
import { PageHeader, type PageProps } from './pages'
import { Callout, Card } from './ui'

export function SettingsPage(_: PageProps) {
  const [settings, setSettings] = useState<Settings>({ catalogUrl: '', updateRepo: '' })
  const [catalog, setCatalog] = useState<CatalogState | null>(null)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.toolbox.getSettings().then(setSettings)
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
      <PageHeader title="设置" desc="方案目录与版本更新" />

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
                <button className="link-btn" onClick={() => window.toolbox.openExternal(update.url!)}>
                  前往下载 <ArrowRight size={13} />
                </button>
              </Callout>
            ) : (
              <p className="muted small">已是最新版本（{update.current}）</p>
            )}
          </div>
        )}
      </Card>
    </>
  )
}
