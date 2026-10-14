import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Check, Eye, EyeOff, FileArchive, FileUp, Link2, RefreshCw, Sparkles } from 'lucide-react'
import { FAMILY_LABEL } from '@shared/catalog'
import type { CatalogState, PatchTarget, RootFamily, RootScheme } from '@shared/types'
import { PageHeader, useGate, type PageProps } from './pages'
import { Callout, Card } from './ui'

const FLOW: Record<RootFamily, string[]> = {
  magisk: [
    '读取 ROM 元数据，与手机 ro.build.date.utc 比对',
    '提取 boot.img / init_boot.img',
    '下载 Magisk 并校验 sha256',
    '在手机上运行 Magisk 自带的 boot_patch.sh 修补',
    '安装 Magisk App，进入 Fastboot 刷入',
    '开机后在 Magisk App 中完成「额外的设置」'
  ],
  apatch: [
    '读取 ROM 元数据，与手机 ro.build.date.utc 比对',
    '提取 boot.img（APatch 修补内核）',
    '下载 APatch 并校验 sha256',
    '用你设置的超级密钥运行 APatch 的 boot_patch.sh',
    '安装 APatch，进入 Fastboot 刷入',
    '开机后打开 APatch，输入超级密钥激活'
  ],
  ksu: [
    '读取 ROM 元数据，与手机 ro.build.date.utc 比对',
    '提取 init_boot.img / boot.img',
    '下载管理器并校验 sha256',
    '运行 ksud boot-patch（LKM 模式），失败时自动推算 KMI 重试',
    '安装管理器，进入 Fastboot 刷入',
    '开机后打开管理器，确认显示「工作中」'
  ]
}

function formatSize(bytes?: number): string {
  return bytes ? `${(bytes / 1048576).toFixed(1)} MB` : ''
}

function superkeyError(key: string): string | undefined {
  if (key.length < 8) return '至少 8 位'
  if (!/[a-zA-Z]/.test(key) || !/\d/.test(key)) return '必须同时包含字母和数字'
  if (!/^[A-Za-z0-9_.@#%+=-]+$/.test(key)) return '只能包含字母、数字和 _ . @ # % + = -'
  return undefined
}

export function RootPage({ tb, confirm }: PageProps) {
  const [catalog, setCatalog] = useState<CatalogState | null>(null)
  const [schemeId, setSchemeId] = useState('magisk')
  const [customApk, setCustomApk] = useState('')
  const [customFamily, setCustomFamily] = useState<RootFamily>('magisk')
  const [rom, setRom] = useState('')
  const [target, setTarget] = useState<PatchTarget>('auto')
  const [superkey, setSuperkey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [patchOnly, setPatchOnly] = useState(false)
  const [flashOther, setFlashOther] = useState(true)
  const [uninstallOthers, setUninstallOthers] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const gate = useGate(tb, ['system'])
  const d = tb.device

  useEffect(() => {
    window.toolbox.getCatalog().then(setCatalog)
  }, [])

  const scheme: RootScheme | undefined = catalog?.schemes.find((s) => s.id === schemeId)
  const family: RootFamily = schemeId === 'custom' ? customFamily : (scheme?.family ?? 'magisk')
  const isUrl = /^https?:\/\//i.test(rom.trim())
  const keyError = family === 'apatch' ? superkeyError(superkey) : undefined

  useEffect(() => {
    if (family === 'apatch' && target === 'init_boot') setTarget('auto')
  }, [family, target])

  const missing = useMemo(() => {
    if (!rom.trim()) return '请先选择 ROM'
    if (schemeId === 'custom' && !customApk) return '请选择自定义 APK'
    if (keyError) return `超级密钥${keyError}`
    return undefined
  }, [rom, schemeId, customApk, keyError])

  const refresh = async () => {
    setRefreshing(true)
    setCatalog(await window.toolbox.getCatalog(true))
    setRefreshing(false)
  }

  const start = () => {
    const name = schemeId === 'custom' ? `自定义 APK（${FAMILY_LABEL[customFamily]}）` : (scheme?.name ?? schemeId)
    const go = () =>
      tb.start(`${name} Root`, {
        kind: 'root',
        options: {
          rom: rom.trim(),
          schemeId,
          customApk: schemeId === 'custom' ? customApk : undefined,
          customFamily: schemeId === 'custom' ? customFamily : undefined,
          target,
          superkey: family === 'apatch' ? superkey : undefined,
          patchOnly,
          flashOther,
          uninstallOthers
        }
      })
    if (patchOnly) return go()
    confirm({
      title: `开始 Root（${name}）`,
      danger: true,
      intro: '修补完成后会安装管理器 App，并自动进入 Fastboot 刷入修补后的镜像。',
      checks: [
        'Bootloader 已经解锁',
        'ROM 与手机当前系统版本完全一致',
        ...(family === 'apatch' ? ['我已记下超级密钥，开机后需要用它激活 APatch'] : []),
        '如果以前装过 Root 模块，我知道它们可能被重新启用，不兼容时可能导致无法开机'
      ],
      confirmText: '开始 Root',
      onConfirm: go
    })
  }

  return (
    <>
      <PageHeader title="一键 Root" desc="从与手机当前系统一致的 ROM 中提取镜像，在手机上用所选方案的官方工具修补后刷入" />

      <div className="root-layout">
        <div className="stack">
          <Card>
            <div className="card-head">
              <h3 className="card-title">1. 选择方案</h3>
              <span className="muted small">
                {catalog?.source === 'remote' ? '远程目录' : catalog?.source === 'cache' ? '远程目录（缓存）' : '内置目录'}
              </span>
              <button className="icon-btn" onClick={refresh} title="刷新方案目录" aria-label="刷新方案目录">
                <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              </button>
            </div>
            {catalog?.error && <Callout tone="warn">{catalog.error}</Callout>}
            <div className="scheme-grid">
              {catalog?.schemes.map((s) => (
                <button
                  key={s.id}
                  className={`scheme ${schemeId === s.id ? 'on' : ''}`}
                  onClick={() => setSchemeId(s.id)}
                  title={s.note}
                >
                  <div className="scheme-top">
                    <strong>{s.name}</strong>
                    {schemeId === s.id && <Check size={15} />}
                  </div>
                  <span className="scheme-ver">
                    {s.version}
                    {s.apk.size ? ` · ${formatSize(s.apk.size)}` : s.apk.bundled ? ' · 离线' : ''}
                  </span>
                  <span className={`chip fam-${s.family}`}>{FAMILY_LABEL[s.family]}</span>
                </button>
              ))}
              <button className={`scheme ${schemeId === 'custom' ? 'on' : ''}`} onClick={() => setSchemeId('custom')}>
                <div className="scheme-top">
                  <strong>自定义 APK</strong>
                  {schemeId === 'custom' && <Check size={15} />}
                </div>
                <span className="scheme-ver">Kitsune / Alpha / ReSukiSU 等</span>
                <span className="chip">本地文件</span>
              </button>
            </div>

            {scheme?.note && schemeId !== 'custom' && <p className="muted small scheme-note">{scheme.note}</p>}

            {schemeId === 'custom' && (
              <div className="custom-box">
                <div className="rom-input">
                  <FileUp size={16} />
                  <input value={customApk} readOnly placeholder="选择管理器 APK（请从项目官方发布页获取）" />
                  <button
                    className="btn btn-secondary"
                    onClick={async () => {
                      const p = await window.toolbox.pickApk('选择 Root 管理器 APK')
                      if (p) setCustomApk(p)
                    }}
                  >
                    浏览…
                  </button>
                </div>
                <div className="row">
                  <span className="muted small">修补方式</span>
                  <div className="segmented">
                    {(['magisk', 'apatch', 'ksu'] as RootFamily[]).map((f) => (
                      <button key={f} className={customFamily === f ? 'on' : ''} onClick={() => setCustomFamily(f)}>
                        {FAMILY_LABEL[f]}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="muted small">Kitsune、Alpha 选「Magisk 系」，ReSukiSU 等 KernelSU 分支选「KernelSU 系」。自定义 APK 无法校验来源。</p>
              </div>
            )}

            {family === 'apatch' && (
              <div className="superkey">
                <label className="field-label" htmlFor="superkey">
                  超级密钥
                </label>
                <div className={`rom-input ${superkey && keyError ? 'invalid' : ''}`}>
                  <input
                    id="superkey"
                    type={showKey ? 'text' : 'password'}
                    value={superkey}
                    onChange={(e) => setSuperkey(e.target.value)}
                    placeholder="至少 8 位，同时包含字母和数字"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <button className="icon-btn" onClick={() => setShowKey((v) => !v)} aria-label={showKey ? '隐藏' : '显示'}>
                    {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                <p className={`small ${superkey && keyError ? 'error-text' : 'muted'}`}>
                  {superkey && keyError ? keyError : '开机后要用它激活 APatch，请务必记住。工具箱不会保存或上传'}
                </p>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="card-title">2. 选择 ROM 包</h3>
            <p className="muted small">
              需要与手机<strong>当前系统版本完全一致</strong>的全量包。标准 OTA 包会自动比对版本，不一致时拒绝继续。
            </p>
            {d.mode === 'system' && (d.buildId || d.romVersion) && (
              <div className="ref-box">
                <span>手机当前版本</span>
                <code>{d.buildId}</code>
                {d.romVersion && <code>{d.romVersion}</code>}
              </div>
            )}
            <div className="rom-input">
              {isUrl ? <Link2 size={16} /> : <FileArchive size={16} />}
              <input
                value={rom}
                onChange={(e) => setRom(e.target.value)}
                placeholder="选择本地文件，或粘贴 ROM 的下载链接"
                spellCheck={false}
              />
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  const p = await window.toolbox.pickRom()
                  if (p) setRom(p)
                }}
              >
                浏览…
              </button>
            </div>
            {isUrl && <p className="muted small">使用链接时只会按需读取所需部分，不会下载整个 ROM 包。</p>}

            <h3 className="card-title">3. 修补目标</h3>
            <div className="segmented">
              {(
                [
                  ['auto', '自动'],
                  ['init_boot', 'init_boot'],
                  ['boot', 'boot']
                ] as [PatchTarget, string][]
              ).map(([v, label]) => (
                <button
                  key={v}
                  className={target === v ? 'on' : ''}
                  disabled={family === 'apatch' && v === 'init_boot'}
                  onClick={() => setTarget(v)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="muted small">
              {family === 'apatch'
                ? 'APatch 修补内核，固定使用 boot.img。'
                : '自动：ROM 中有 init_boot.img（Android 13 及以后出厂的机型）就修补它，否则修补 boot.img。'}
            </p>

            <h3 className="card-title">4. 选项</h3>
            <label className="check">
              <input type="checkbox" checked={patchOnly} onChange={(e) => setPatchOnly(e.target.checked)} />
              <span>只生成修补后的镜像，不刷入（保存到「文档\一加工具箱」）</span>
            </label>
            <label className={`check ${patchOnly ? 'disabled' : ''}`}>
              <input type="checkbox" checked={flashOther} disabled={patchOnly} onChange={(e) => setFlashOther(e.target.checked)} />
              <span>同时刷回 ROM 中原厂的另一个分区，清除之前装过的其它 Root</span>
            </label>
            <label className={`check ${patchOnly ? 'disabled' : ''}`}>
              <input
                type="checkbox"
                checked={uninstallOthers}
                disabled={patchOnly}
                onChange={(e) => setUninstallOthers(e.target.checked)}
              />
              <span>卸载其它 Root 管理器（Magisk / APatch / KernelSU 及其分支）</span>
            </label>

            <div className="card-actions">
              <button
                className="btn btn-primary btn-lg"
                disabled={gate.disabled || !!missing}
                title={gate.reason ?? missing}
                onClick={start}
              >
                <Sparkles size={16} /> {patchOnly ? '开始修补' : '开始 Root'}
              </button>
              {!tb.run.running && (gate.reason || missing) && <span className="gate-hint inline">{gate.reason ?? missing}</span>}
            </div>
          </Card>
        </div>

        <Card className="flow-card">
          <h3 className="card-title">流程 · {FAMILY_LABEL[family]}</h3>
          <ol className="flow">
            {FLOW[family].map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          {scheme?.homepage && schemeId !== 'custom' && (
            <button className="link-btn" onClick={() => window.toolbox.openExternal(scheme.homepage!)}>
              {scheme.name} 项目主页 <ArrowRight size={13} />
            </button>
          )}
        </Card>
      </div>
    </>
  )
}
