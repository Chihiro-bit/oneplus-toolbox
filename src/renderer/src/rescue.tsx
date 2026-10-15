import { useEffect, useState } from 'react'
import { ArrowLeftRight, ArrowRight, BellOff, FileArchive, HardDriveDownload, Link2, RotateCcw, Stethoscope, ToggleLeft, ToggleRight, Trash2, Undo2 } from 'lucide-react'
import { undoableFlash } from '@shared/bootdiag'
import type { FlashRecord, ModuleAction } from '@shared/types'
import { PageHeader, useGate, type PageProps } from './pages'
import { Callout, Card } from './ui'

export function RescuePage({ tb, confirm, go }: PageProps) {
  const [rom, setRom] = useState('')
  const [uninstallManagers, setUninstallManagers] = useState(true)
  const [allowUnverified, setAllowUnverified] = useState(false)
  const unrootGate = useGate(tb, ['system', 'fastboot', 'fastbootd'])
  const systemGate = useGate(tb, ['system'])
  const d = tb.device
  const [undo, setUndo] = useState<FlashRecord>()
  useEffect(() => {
    if (!d.serial) return setUndo(undefined)
    window.toolbox.getHistory(d.serial).then((h) => setUndo(undoableFlash(h)))
  }, [d.serial, tb.run.result])
  const isUrl = /^https?:\/\//i.test(rom.trim())

  // 模块救援：手机不在线时也能点，工具会一直等到 adb 连上（卡开机时 adb 只出现几秒）
  const run = tb.run.running
  const modulesBlocked = run
    ? '有操作正在进行'
    : d.multiple && !d.selected
      ? '连接了多台设备，请先在左下角选择要操作的那一台'
      : d.mode === 'unauthorized'
        ? '请先在手机上允许 USB 调试'
        : d.mode === 'fastboot' || d.mode === 'fastbootd' || d.mode === 'edl'
          ? '需要手机开机（卡在开机画面也可以），Fastboot 下无法操作模块'
          : undefined

  const unroot = () =>
    confirm({
      title: '刷回原厂镜像',
      danger: true,
      intro: '会从 ROM 中提取原厂的 boot / init_boot，进入 Fastboot 刷回当前槽位，然后重启。',
      checks: [
        'ROM 与手机当前系统版本完全一致',
        'Bootloader 已经解锁',
        ...(allowUnverified ? ['我确认这个 ROM 就是手机现在的系统版本（工具箱无法校验）'] : [])
      ],
      confirmText: '刷回原厂',
      onConfirm: () =>
        tb.start('刷回原厂镜像', { kind: 'unroot', options: { rom: rom.trim(), uninstallManagers, allowUnverified } })
    })

  const modules = (action: ModuleAction) => {
    const title = { disable: '禁用全部模块', enable: '重新启用全部模块', remove: '删除全部 Magisk 模块' }[action]
    const start = () => tb.start(title, { kind: 'modules', action })
    if (action === 'enable') return start()
    confirm({
      title,
      danger: action === 'remove',
      intro:
        action === 'remove'
          ? '执行 magisk --remove-modules：删除 /data/adb/modules 下的全部模块并立即重启。模块的设置会一起丢失，无法恢复。'
          : '给每个模块写入 disable 标记后重启手机，模块文件和设置都会保留，之后可以在 Root 管理器里逐个启用。',
      checks:
        d.mode === 'none'
          ? ['这台电脑之前已经被手机授权过 USB 调试（否则卡开机时连不上 adb）']
          : ['我知道手机会立即重启'],
      confirmText: action === 'remove' ? '删除全部模块' : '禁用并重启',
      onConfirm: start
    })
  }

  return (
    <>
      <PageHeader title="救援与恢复" desc="Root 之后卡开机、想卸载 Root，先试这里。大多数情况下不需要用到 9008" />

      <div className="stack">
        {undo && (
          <Card>
            <h3 className="card-title">撤销上一次刷写</h3>
            <p className="muted small">
              {new Date(undo.time).toLocaleString('zh-CN', { hour12: false })} 用工具箱刷入了 {undo.scheme ?? ''}（
              {undo.partitions.map((p) => `${p.name}${p.source === 'patched' ? '（修补）' : ''}`).join('、')}，{undo.slot?.toUpperCase() ?? '?'} 槽）。
              刷写前备份了原厂镜像，可以直接恢复，不需要 ROM。Root 后卡开机时，这是最快的办法。
            </p>
            <div className="card-actions">
              <button
                className="btn btn-primary"
                disabled={unrootGate.disabled}
                title={unrootGate.reason}
                onClick={() =>
                  confirm({
                    title: '撤销上一次刷写',
                    intro: `把备份的原厂 ${Object.keys(undo.backups).join('、')} 刷回 ${undo.slot?.toUpperCase() ?? '原来的'} 槽，然后重启。手机在那之后升级过系统时，工具箱会拒绝执行。`,
                    checks: ['我知道撤销后 Root 会失效'],
                    confirmText: '撤销',
                    onConfirm: () => tb.start('撤销上一次刷写', { kind: 'undoFlash' })
                  })
                }
              >
                <Undo2 size={15} /> 撤销
              </button>
              {!run && unrootGate.reason && <span className="gate-hint inline">{unrootGate.reason}</span>}
            </div>
          </Card>
        )}

        <Card>
          <div className="card-head">
            <h3 className="card-title">刷回原厂镜像（卸载 Root）</h3>
          </div>
          <p className="muted small">
            从与手机系统版本一致的全量包中取出原厂的 <code>boot</code> 和 <code>init_boot</code>，一起刷回当前槽位。各家 Root
            方案改的都是这两个分区之一，刷回之后就彻底卸载了 Root；修补后的镜像不兼容导致卡开机时，这也是最可靠的救法。
          </p>
          {(d.mode === 'fastboot' || d.mode === 'fastbootd') && (
            <Callout tone="info">
              手机在 Fastboot 模式，读不到系统版本。工具箱会使用这台手机上次开机连接时记下的版本来校验；从来没有开机连过的话，需要勾选下面的「仍然继续」。
            </Callout>
          )}
          <div className="rom-input">
            {isUrl ? <Link2 size={16} /> : <FileArchive size={16} />}
            <input
              value={rom}
              onChange={(e) => setRom(e.target.value)}
              placeholder="选择本地全量包，或粘贴下载链接"
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
          <label className="check">
            <input type="checkbox" checked={uninstallManagers} onChange={(e) => setUninstallManagers(e.target.checked)} />
            <span>刷完等手机开机，再卸载 Root 管理器 App（Magisk / APatch / KernelSU 及其分支）</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={allowUnverified} onChange={(e) => setAllowUnverified(e.target.checked)} />
            <span>读不到手机系统版本时仍然继续（只在 Fastboot 下、且确定 ROM 版本正确时勾选）</span>
          </label>
          <div className="card-actions">
            <button
              className="btn btn-primary"
              disabled={unrootGate.disabled || !rom.trim()}
              title={unrootGate.reason ?? (!rom.trim() ? '请先选择 ROM' : undefined)}
              onClick={unroot}
            >
              <RotateCcw size={15} /> 刷回原厂
            </button>
            {!run && (unrootGate.reason || !rom.trim()) && (
              <span className="gate-hint inline">{unrootGate.reason ?? '请先选择 ROM'}</span>
            )}
          </div>
        </Card>

        <Card>
          <h3 className="card-title">模块导致卡开机</h3>
          <p className="muted small">
            装了模块之后卡在开机画面、或进系统几秒就重启，多半是模块的问题。卡开机时 adb 往往只在开机过程中能连上几秒：
            先点下面的按钮，再让手机重启（或长按电源键强制重启），工具箱会一直等着，连上的瞬间立即执行。
          </p>
          {d.root && d.mode === 'system' && <p className="muted small">当前 Root 状态：{d.root}</p>}
          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={!!modulesBlocked}
              title={modulesBlocked}
              onClick={() => modules('disable')}
            >
              <ToggleLeft size={15} /> 禁用全部模块
            </button>
            <button
              className="btn btn-secondary"
              disabled={!!modulesBlocked}
              title={modulesBlocked}
              onClick={() => modules('enable')}
            >
              <ToggleRight size={15} /> 重新启用全部模块
            </button>
            <button
              className="btn btn-danger"
              disabled={!!modulesBlocked}
              title={modulesBlocked}
              onClick={() => modules('remove')}
            >
              <Trash2 size={15} /> 删除全部模块（Magisk）
            </button>
          </div>
          {modulesBlocked && !run && <p className="gate-hint">{modulesBlocked}</p>}
          <ul className="steps small rescue-notes">
            <li>
              <strong>禁用</strong>需要 Root 授权：手机能进系统时请在弹窗里点允许；卡开机时只有 Magisk 能直接授权给 Shell，其它情况请用下面两种办法
            </li>
            <li>
              <strong>删除</strong>用的是 Magisk 官方的救砖命令 <code>magisk --remove-modules</code>，不需要授权，但模块会被删掉
            </li>
            <li>
              KernelSU / APatch 可以进<strong>安全模式</strong>（所有模块临时失效）：开机出现第一屏后连续按几次音量下键；Magisk
              的安全模式是开机时一直按住音量下键
            </li>
          </ul>
        </Card>

        <Card>
          <h3 className="card-title">备份关键分区</h3>
          <p className="muted small">
            趁手机还好好的时候做。<code>persist</code>、<code>modemst1/2</code>、<code>fsg</code>、<code>ocdt</code>{' '}
            存着这台手机独有的基带和校准数据，坏了刷什么 ROM 都恢复不了（IMEI 丢失、没信号），只能靠自己的备份。
          </p>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={systemGate.disabled}
              title={systemGate.reason}
              onClick={() => tb.start('备份关键分区', { kind: 'backup', options: { source: 'device' } })}
            >
              <HardDriveDownload size={15} /> 备份关键分区（需要 Root）
            </button>
            <button
              className="btn btn-secondary"
              disabled={systemGate.disabled || !rom.trim()}
              title={systemGate.reason ?? (!rom.trim() ? '请先在上面选择 ROM' : undefined)}
              onClick={() => tb.start('从 ROM 保存原厂镜像', { kind: 'backup', options: { source: 'rom', rom: rom.trim() } })}
            >
              <FileArchive size={15} /> 从 ROM 保存原厂镜像
            </button>
          </div>
          <ul className="steps small rescue-notes">
            <li>
              <strong>备份关键分区</strong>：用 Root 权限读出上面几个分区和当前槽位的 boot / init_boot / vendor_boot / dtbo，只读不写，附带 sha256 校验文件
            </li>
            <li>
              <strong>没 Root</strong>：用上面选择的、和手机版本一致的 ROM，提取原厂启动镜像和 vbmeta 存到本地，卡开机时不用再找 ROM
            </li>
            <li>备份在「文档\一加工具箱\backups」，建议再复制一份到网盘或其它电脑</li>
          </ul>
          {systemGate.reason && !run && <p className="gate-hint">{systemGate.reason}</p>}
        </Card>

        <Card>
          <h3 className="card-title">其它办法</h3>
          <div className="rescue-links">
            <button className="tile" onClick={() => go('diagnose')}>
              <div className="tile-icon">
                <Stethoscope size={18} />
              </div>
              <div className="tile-text">
                <strong>开机诊断</strong>
                <span>不确定原因时，按现象和设备状态推断该用哪种办法</span>
              </div>
              <ArrowRight size={16} className="tile-arrow" />
            </button>
            <button className="tile" onClick={() => go('slot')}>
              <div className="tile-icon">
                <ArrowLeftRight size={18} />
              </div>
              <div className="tile-text">
                <strong>切换 A/B 槽位</strong>
                <span>另一个槽位完好时，切过去往往能直接开机</span>
              </div>
              <ArrowRight size={16} className="tile-arrow" />
            </button>
            <button className="tile" onClick={() => go('tools')}>
              <div className="tile-icon">
                <BellOff size={18} />
              </div>
              <div className="tile-text">
                <strong>禁用系统更新</strong>
                <span>Root 后系统自动更新可能覆盖修补，甚至卡开机</span>
              </div>
              <ArrowRight size={16} className="tile-arrow" />
            </button>
          </div>
          <p className="muted small">
            以上都不行、连 Fastboot 都进不去时，请联系售后。导出「设置 → 日志与诊断」里的诊断信息，能帮助定位问题。
          </p>
        </Card>
      </div>
    </>
  )
}
