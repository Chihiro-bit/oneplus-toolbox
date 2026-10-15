import { useState } from 'react'
import {
  CirclePlay,
  FileCode,
  HardDriveDownload,
  Plug,
  PlugZap,
  ShieldAlert,
  Siren,
  Terminal,
  Usb
} from 'lucide-react'
import type { EdlProfile, EdlStorage } from '@shared/types'
import { PageHeader, type PageProps } from './pages'
import { Callout, Card } from './ui'

const STORAGES: EdlStorage[] = ['ufs', 'emmc', 'nand', 'nvme', 'spinor']

const FLOW = [
  '确认 9008 驱动已装好，手机进入 EDL 后这边能检测到端口',
  '把自备的设备编程器、签名摘要和深刷散包填进来',
  '先点「预检」：读芯片信息 + 离线校验文件集，全程不写设备',
  '通过后再「开始刷写」，qdl 先跑一次 --dry-run 才真正写分区',
  '刷完自动重启；如果卡在 9008，用「退出 9008」发重启指令'
]

export function EdlPage({ tb, confirm }: PageProps) {
  const [programmer, setProgrammer] = useState('')
  const [vipDir, setVipDir] = useState('')
  const [imagesDir, setImagesDir] = useState('')
  const [xmls, setXmls] = useState<string[]>([])
  const [storage, setStorage] = useState<EdlStorage>('ufs')
  const [protectLun5, setProtectLun5] = useState(true)
  const [allowMissing, setAllowMissing] = useState(false)
  const [skipReset, setSkipReset] = useState(false)
  const [dryRunOnly, setDryRunOnly] = useState(false)

  const running = tb.run.running
  const edl = tb.run.result?.edl
  // 端口优先用操作结果；没跑过操作时退回设备轮询的结果，插上就能看到
  const ports =
    edl?.ports.length
      ? edl.ports
      : tb.device.mode === 'edl'
        ? [{ port: tb.device.edlPort ?? '', name: tb.device.device ?? 'QDLoader 9008' }]
        : []
  const connected = ports.length > 0

  const profile: EdlProfile = {
    programmer,
    vipDir: vipDir.trim() || undefined,
    xmls,
    imagesDir,
    storage,
    protectLun5,
    allowMissing,
    skipReset,
    dryRunOnly
  }

  const missing = !programmer
    ? '请选择设备编程器（devprg*.mbn）'
    : !imagesDir
      ? '请选择散包目录'
      : xmls.length === 0
        ? '请选择 rawprogram / patch XML'
        : undefined
  const blocked = missing ?? (!connected ? '先点「检测设备」，确认手机已经在 9008 模式' : undefined)

  return (
    <>
      <PageHeader
        title="9008 救砖"
        desc="高通 EDL 深刷。工具箱只负责检测、校验、排序和日志，刷写由 qdl 完成，所有专有文件由你自备"
      />

      <Callout tone="danger">
        <strong>先看熔断这件事。</strong>
        一加 13 / 13T 自 ColorOS <strong>16.0.3.501</strong> 起提高了 xbl_config 的反回滚值并换掉了 EDL 证书签名，
        <strong>免授权 9008 已永久不可逆失效</strong>（16.0.8.xxx 同样如此），降级也救不回来。如果你的手机更新过这些版本，
        这里会连 9008 都进不去或直接卡在 Sahara，请改用 Fastboot（A/B 槽位、刷回原厂 boot）或送售后。
        本工具<strong>不提供、也不下载</strong>任何编程器、签名摘要和刷机包。
      </Callout>

      <div className="root-layout">
        <div className="stack">
          <Card>
            <div className="card-head">
              <h3 className="card-title">1. 连接 9008 设备</h3>
              {connected && <span className="chip chip-ok">已连接</span>}
            </div>
            <p className="muted small">
              需要先装好高通 9008（QDLoader）驱动。手机完全关机后，同时按住<strong>关机键 + 音量加 + 音量减</strong>进入 EDL，
              设备管理器里会出现「Qualcomm HS-USB QDLoader 9008」。
            </p>
            {ports.length > 0 ? (
              <div className="file-list">
                {ports.map((p) => (
                  <div key={p.name} className="file-row">
                    <Usb size={14} />
                    <span className="file-name">{p.name}</span>
                    {p.port && <span className="chip">{p.port}</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted small">还没有检测到 9008 设备。</p>
            )}
            {edl?.chipInfo && (
              <div className="ref-box">
                <span>{edl.saharaOk ? '芯片信息' : 'Sahara 输出'}</span>
                <code>{edl.chipInfo.split(/\r?\n/)[0]}</code>
              </div>
            )}
            <div className="row">
              <button
                className="btn btn-secondary"
                disabled={running}
                onClick={() => tb.start('查找 9008 设备', { kind: 'edlDetect' })}
              >
                <Usb size={15} /> 检测设备
              </button>
              <button
                className="btn btn-ghost"
                disabled={running || !connected}
                title={connected ? undefined : '先检测到 9008 设备'}
                onClick={() =>
                  confirm({
                    title: '让设备退出 9008',
                    intro: '会通过 Sahara 向设备发送重启指令。如果没反应，可以长按电源键 10 秒以上强制重启。',
                    checks: ['我确认现在可以让设备重启'],
                    confirmText: '发送重启',
                    onConfirm: () => tb.start('退出 9008', { kind: 'edlReset' })
                  })
                }
              >
                <Plug size={15} /> 退出 9008
              </button>
            </div>
          </Card>

          <Card>
            <h3 className="card-title">2. 准备文件（全部由你自备）</h3>
            <p className="muted small">
              编程器要按处理器选（例如 8Gen3 用 8Gen3 的引导文件），散包要按机型选。用错机型的散包会直接写坏分区。
            </p>

            <label className="field-label">设备编程器（devprg*.mbn / prog_firehose_ddr.elf）</label>
            <div className="rom-input">
              <PlugZap size={16} />
              <input value={programmer} readOnly placeholder="选择本机处理器对应的编程器文件" />
              <button
                className="btn btn-secondary"
                disabled={running}
                onClick={async () => {
                  const p = await window.toolbox.pickFile('选择设备编程器', ['mbn', 'elf', 'bin'])
                  if (p) setProgrammer(p)
                }}
              >
                浏览…
              </button>
            </div>

            <label className="field-label">签名摘要表目录（可选，安全启动设备必填）</label>
            <div className="rom-input">
              <FileCode size={16} />
              <input value={vipDir} readOnly placeholder="留空表示这台设备不校验签名摘要" />
              <button
                className="btn btn-secondary"
                disabled={running}
                onClick={async () => {
                  const p = await window.toolbox.pickDir('选择签名摘要表所在目录')
                  if (p) setVipDir(p)
                }}
              >
                浏览…
              </button>
            </div>

            <label className="field-label">散包目录（浏览器镜像所在文件夹）</label>
            <div className="rom-input">
              <HardDriveDownload size={16} />
              <input value={imagesDir} readOnly placeholder="选择解压后的深刷散包目录" />
              <button
                className="btn btn-secondary"
                disabled={running}
                onClick={async () => {
                  const p = await window.toolbox.pickDir('选择深刷散包目录')
                  if (p) setImagesDir(p)
                }}
              >
                浏览…
              </button>
            </div>

            <label className="field-label">rawprogram / patch XML</label>
            <div className="row">
              <button
                className="btn btn-secondary"
                disabled={running}
                onClick={async () => {
                  const picked = await window.toolbox.pickFiles('选择 rawprogram / patch XML', ['xml'])
                  if (picked.length) setXmls(picked)
                }}
              >
                <FileCode size={15} /> 选择 XML
              </button>
              {xmls.length > 0 && (
                <button className="btn btn-ghost" disabled={running} onClick={() => setXmls([])}>
                  清空
                </button>
              )}
            </div>
            {xmls.length > 0 && (
              <div className="file-list">
                {xmls.map((x) => (
                  <div key={x} className="file-row">
                    <FileCode size={14} />
                    <span className="file-name">{x.split(/[\\/]/).pop()}</span>
                  </div>
                ))}
                <p className="muted small">
                  会按 rawprogram* → patch* 的顺序发送；标了「保护 LUN5」时 rawprogram5 / patch5 会被跳过。
                </p>
              </div>
            )}

            <h3 className="card-title">3. 目标存储与选项</h3>
            <div className="segmented">
              {STORAGES.map((s) => (
                <button key={s} className={storage === s ? 'on' : ''} disabled={running} onClick={() => setStorage(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="muted small">一加手机的 UFS 一般是 ufs；只有明确知道是 eMMC 机型时才改。</p>

            <label className="check">
              <input type="checkbox" checked={protectLun5} onChange={(e) => setProtectLun5(e.target.checked)} />
              <span>保护 LUN5：跳过 rawprogram5 / patch5（强烈建议保持勾选）</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={dryRunOnly} onChange={(e) => setDryRunOnly(e.target.checked)} />
              <span>只做预检，不刷入（可随时先跑这一步确认文件集）</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={skipReset} onChange={(e) => setSkipReset(e.target.checked)} />
              <span>刷完不重启，把设备留在 9008（qdl --skip-reset）</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={allowMissing} onChange={(e) => setAllowMissing(e.target.checked)} />
              <span className="warn-text">散包缺少镜像时跳过而不中止（qdl --allow-missing，会让刷入的分区变少）</span>
            </label>
          </Card>

          <Card>
            <h3 className="card-title">4. 执行</h3>
            <p className="muted small">
              「预检」只读芯片信息并离线校验文件集，不写任何数据；「开始刷写」会先自动跑一遍同样的预检，通过后才写分区。
            </p>
            {edl?.command && (
              <div className="ref-box">
                <Terminal size={14} />
                <code>{edl.command}</code>
              </div>
            )}
            <div className="card-actions">
              <button
                className="btn btn-secondary"
                disabled={running || !connected}
                title={connected ? undefined : '先检测到 9008 设备'}
                onClick={() => tb.start('9008 预检（只读）', { kind: 'edlProbe', profile })}
              >
                <CirclePlay size={16} /> 预检
              </button>
              <button
                className="btn btn-danger btn-lg"
                disabled={running || !!blocked}
                title={blocked}
                onClick={() =>
                  confirm({
                    title: dryRunOnly ? '开始 9008 预检' : '开始 9008 刷写',
                    danger: !dryRunOnly,
                    intro: dryRunOnly
                      ? '只做离线预检，不接触设备、不写入任何分区。'
                      : '会按散包里的分区表覆盖手机上的对应分区。写错分区或机型不匹配，可能无法恢复。',
                    checks: dryRunOnly
                      ? ['我了解这一步不会刷入任何数据']
                      : [
                          '我确认散包与这台手机的型号、存储类型完全对应',
                          '我知道刷写会覆盖分区，刷错可能无法恢复',
                          '我确认了要跳过哪些分区（默认已保护 LUN5），并知道 persist / OCDT 写错的后果',
                          '刷写期间我不会拔线、断电或让电脑休眠'
                        ],
                    confirmText: dryRunOnly ? '开始预检' : '开始刷写',
                    onConfirm: () =>
                      tb.start(dryRunOnly ? '9008 预检（只读）' : '9008 刷写', { kind: 'edlFlash', profile })
                  })
                }
              >
                <Siren size={16} /> {dryRunOnly ? '开始预检' : '开始刷写'}
              </button>
              {blocked && !running && <span className="gate-hint inline">{blocked}</span>}
            </div>
          </Card>
        </div>

        <Card className="flow-card">
          <h3 className="card-title">流程</h3>
          <ol className="flow">
            {FLOW.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <div className="edl-limits">
            <strong>这个功能不做的事</strong>
            <ul>
              <li>不提供编程器、签名摘要、散包或驱动</li>
              <li>不做 super 分片合并与 OFP / OPS 解密</li>
              <li>不修 OCDT，不刷 persist</li>
            </ul>
            <p className="muted small">
              需要这些的话，请用能处理欧加真专有格式的外部工具，工具箱只做检测、校验和调度。
            </p>
          </div>
          <div className="edl-note">
            <ShieldAlert size={14} />
            <span className="muted small">
              进 EDL 后手机会一直黑屏；退出方式是长按 <strong>音量上 + 电源键</strong>（老机型长按电源键）。
            </span>
          </div>
        </Card>
      </div>
    </>
  )
}
