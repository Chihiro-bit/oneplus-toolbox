import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { FileArchive, Link2, ScanSearch, Stethoscope } from 'lucide-react'
import { diagnose, guessLastAction, undoableFlash, type Confidence, type Finding, type Fix, type FixKind } from '@shared/bootdiag'
import type { BootState, BootSymptom, FlashRecord, LastAction, OperationRequest } from '@shared/types'
import { PageHeader, type PageProps } from './pages'
import { MODE_LABEL } from './state'
import { Callout, Card } from './ui'

const SYMPTOMS: { id: BootSymptom; label: string }[] = [
  { id: 'logo', label: '一直停在开机 logo / 开机动画' },
  { id: 'bootloop', label: '进系统几秒后自动重启，反复循环' },
  { id: 'crashdump', label: '黑屏出现 QUALCOMM CrashDump Mode' },
  { id: 'destroyed', label: '出现 The current image have been destroyed' },
  { id: 'recovery', label: '自动进入 Recovery，提示无法启动系统' }
]

const ACTIONS: { id: LastAction; label: string }[] = [
  { id: 'root', label: 'Root' },
  { id: 'module', label: '装模块' },
  { id: 'ota', label: '系统更新' },
  { id: 'flash', label: '刷系统' },
  { id: 'unknown', label: '不清楚' }
]

const CONFIDENCE: Record<Confidence, string> = { high: '可能性高', medium: '有可能', low: '可能性低' }

/** 需要 ROM 的修复 */
const NEEDS_ROM: FixKind[] = ['unroot', 'restoreVbmeta']

const FIX_TEXT: Record<FixKind, { label: string; guide?: string }> = {
  undoFlash: { label: '撤销上一次刷写' },
  unroot: { label: '刷回原厂 boot / init_boot' },
  restoreVbmeta: { label: '刷回原厂 vbmeta' },
  modulesDisable: { label: '禁用全部模块' },
  modulesRemove: { label: '删除全部 Magisk 模块' },
  safeMode: {
    label: '进安全模式',
    guide: 'KernelSU / APatch：开机出现第一屏后连续按几次音量下键；Magisk：开机时一直按住音量下键。安全模式下所有模块临时失效'
  },
  snapshotCancel: { label: '取消未合并的更新' },
  snapshotMerge: { label: '继续合并更新' },
  switchSlot: { label: '切换到另一个槽位' },
  fullFlash: {
    label: '完整线刷',
    guide: '工具箱暂不支持完整线刷。请用官方的本地升级包或线刷工具重新刷入完整系统；注意不能刷比当前版本更旧的系统（防回滚，会变硬砖）'
  },
  wipeData: {
    label: '清除数据',
    guide: '在 Recovery 里选择「清除数据」或「格式化数据」，会删除手机上的全部数据。只在确认是数据分区的问题时再做'
  },
  service: { label: '联系售后', guide: '带上购机凭证去官方售后，说明做过的操作。导出「设置 → 日志与诊断」里的诊断信息，能帮助定位问题' }
}

export function BootDiagPage({ tb, confirm }: PageProps) {
  const d = tb.device
  const [symptoms, setSymptoms] = useState<BootSymptom[]>([])
  const [lastAction, setLastAction] = useState<LastAction>('unknown')
  const [waitAdb, setWaitAdb] = useState(true)
  const [state, setState] = useState<BootState | null>(null)
  const [history, setHistory] = useState<FlashRecord[]>([])
  const [rom, setRom] = useState('')
  const [allowUnverified, setAllowUnverified] = useState(false)
  const busy = tb.run.running
  const pickFirst = !!d.multiple && !d.selected
  const serial = state?.serial ?? d.serial

  // 换了设备或采集到序列号后，读这台手机的刷写记录，并据此预选「最后做了什么」
  useEffect(() => {
    if (!serial) return setHistory([])
    window.toolbox.getHistory(serial).then((h) => {
      setHistory(h)
      setLastAction((a) => (a === 'unknown' ? guessLastAction(h.at(-1)) : a))
    })
  }, [serial, tb.run.result])

  const last = history.at(-1)
  const undo = undoableFlash(history)
  const canUndo = !!undo
  const findings = useMemo(
    () => (state ? diagnose({ state, symptoms, lastAction, lastFlash: last, canUndo }) : []),
    [state, symptoms, lastAction, last, canUndo]
  )

  const collect = async () => {
    const r = await tb.start('开机诊断：读取设备状态', { kind: 'bootCollect', waitAdb })
    if (r.bootState) setState(r.bootState)
  }

  const toggle = (s: BootSymptom) => setSymptoms((list) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s]))

  const runFix = (fix: Fix) => {
    const start = (title: string, req: OperationRequest) => tb.start(title, req)
    const ask = (title: string, intro: string, checks: string[], confirmText: string, req: OperationRequest, danger = false) =>
      confirm({ title, intro, checks, confirmText, danger, onConfirm: () => start(title, req) })
    switch (fix.kind) {
      case 'undoFlash':
        return ask(
          '撤销上一次刷写',
          `把 ${undo ? new Date(undo.time).toLocaleString('zh-CN', { hour12: false }) : ''} 刷写前备份的原厂 ${Object.keys(undo?.backups ?? {}).join('、')} 刷回 ${undo?.slot?.toUpperCase() ?? '原来的'} 槽，然后重启。`,
          ['手机在那之后没有升级过系统'],
          '撤销',
          { kind: 'undoFlash' }
        )
      case 'unroot':
        return ask(
          '刷回原厂 boot / init_boot',
          '从 ROM 中提取原厂的 boot / init_boot，刷回当前槽位后重启。',
          ['ROM 与手机当前系统版本完全一致', ...(allowUnverified ? ['我确认这个 ROM 就是手机现在的系统版本（工具箱无法校验）'] : [])],
          '刷回原厂',
          { kind: 'unroot', options: { rom: rom.trim(), uninstallManagers: false, allowUnverified } },
          true
        )
      case 'restoreVbmeta':
        return ask(
          '刷回原厂 vbmeta',
          '从 ROM 中提取原厂的 vbmeta / vbmeta_system / vbmeta_vendor，刷回当前槽位后重启。',
          ['ROM 与手机当前系统版本完全一致', ...(allowUnverified ? ['我确认这个 ROM 就是手机现在的系统版本（工具箱无法校验）'] : [])],
          '刷回原厂',
          { kind: 'restoreStock', options: { rom: rom.trim(), partitions: ['vbmeta', 'vbmeta_system', 'vbmeta_vendor'], allowUnverified } },
          true
        )
      case 'modulesDisable':
        return ask(
          '禁用全部模块',
          '给每个模块写入 disable 标记后重启。手机不在线时会一直等到开机过程中 adb 连上。',
          ['这台电脑之前已经被手机授权过 USB 调试'],
          '禁用并重启',
          { kind: 'modules', action: 'disable' }
        )
      case 'modulesRemove':
        return ask(
          '删除全部 Magisk 模块',
          '执行 magisk --remove-modules：删除全部模块并立即重启，模块的设置会一起丢失。',
          ['这台电脑之前已经被手机授权过 USB 调试', '我知道模块会被删除，无法恢复'],
          '删除全部模块',
          { kind: 'modules', action: 'remove' },
          true
        )
      case 'snapshotCancel':
        return ask(
          '取消未合并的更新',
          '重启到 fastbootd，执行 fastboot snapshot-update cancel。这次系统更新会被放弃，之后需要重新升级或刷写。',
          ['我知道这次系统更新会被放弃'],
          '取消更新',
          { kind: 'snapshotUpdate', action: 'cancel' },
          true
        )
      case 'snapshotMerge':
        return ask(
          '继续合并更新',
          '重启到 fastbootd，执行 fastboot snapshot-update merge，让没合并完的更新继续合并。可能需要几分钟到半小时，中途不要拔线。',
          ['电量充足，过程中不会拔线'],
          '继续合并',
          { kind: 'snapshotUpdate', action: 'merge' }
        )
      case 'switchSlot':
        return ask(
          '切换 A/B 槽位',
          '进入 Fastboot 后执行 fastboot --set-active=other，完成后设备停留在 Fastboot。',
          ['我了解切换后可能需要再切回来'],
          '切换槽位',
          { kind: 'switchSlot' }
        )
    }
  }

  const needRom = findings.some((f) => f.fixes.some((x) => NEEDS_ROM.includes(x.kind)))
  const isUrl = /^https?:\/\//i.test(rom.trim())

  return (
    <>
      <PageHeader title="开机诊断" desc="卡开机、开不了机但还能进 Fastboot 时，根据现象和设备状态推断原因，并给出对应的修复办法" />

      <div className="stack">
        <Card>
          <h3 className="card-title">1. 你看到了什么</h3>
          <div className="checklist">
            {SYMPTOMS.map((s) => (
              <label key={s.id} className="check">
                <input type="checkbox" checked={symptoms.includes(s.id)} onChange={() => toggle(s.id)} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <div className="row diag-row">
            <span className="muted small">出问题前最后做了什么</span>
            <div className="segmented">
              {ACTIONS.map((a) => (
                <button key={a.id} className={lastAction === a.id ? 'on' : ''} onClick={() => setLastAction(a.id)}>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
          {last && (
            <p className="muted small">
              工具箱记录的最后一次刷写：{new Date(last.time).toLocaleString('zh-CN', { hour12: false })}，
              {FLASH_KIND[last.kind]}
              {last.scheme ? `（${last.scheme}）` : ''}，{last.partitions.map((p) => p.name).join('、')}，{last.slot?.toUpperCase() ?? '?'} 槽
              {last.status === 'failed' ? '，刷写失败' : last.status === 'started' ? '，没有完成' : ''}
              {last.undone ? '，已撤销' : ''}
            </p>
          )}
        </Card>

        <Card>
          <h3 className="card-title">2. 读取设备状态</h3>
          <p className="muted small">
            只读取，不改动手机。最好让手机进入 <strong>Fastboot</strong>（关机后同时按住 音量下 + 电源键）：能读到两个槽位的状态、解锁状态和系统更新状态。
            卡在开机画面时也可以直接读取，工具箱会抓开机过程中 adb 能连上的那几秒。
          </p>
          <p className="small">
            当前：<strong>{MODE_LABEL[d.mode]}</strong>
            {d.mode === 'fastbootd' && <span className="muted">（fastbootd 下读不到槽位是否成功启动过，切到 bootloader 再读一次更准）</span>}
          </p>
          <label className={`check ${d.mode !== 'none' ? 'disabled' : ''}`}>
            <input type="checkbox" checked={waitAdb} disabled={d.mode !== 'none'} onChange={(e) => setWaitAdb(e.target.checked)} />
            <span>手机连不上时，等待开机过程中的 adb（最多 3 分钟，需要这台电脑之前被手机授权过 USB 调试）</span>
          </label>
          <div className="card-actions">
            <button className="btn btn-primary" disabled={busy || pickFirst} title={pickFirst ? '请先在左下角选择要操作的设备' : undefined} onClick={collect}>
              <ScanSearch size={15} /> {state ? '重新读取' : '读取状态并诊断'}
            </button>
            {pickFirst && <span className="gate-hint inline">连接了多台设备，请先在左下角选择要操作的那一台</span>}
          </div>
          {state && <StateSummary state={state} />}
        </Card>

        {state && (
          <Card>
            <h3 className="card-title">3. 诊断结果</h3>
            {symptoms.length === 0 && lastAction === 'unknown' && (
              <Callout tone="info">还没选择现象和最后做的操作，结果只根据设备状态推断。补充这两项能让判断准确得多。</Callout>
            )}
            {needRom && (
              <div className="diag-rom">
                <p className="muted small">部分修复需要和手机当前系统版本完全一致的全量包：</p>
                <div className="rom-input">
                  {isUrl ? <Link2 size={16} /> : <FileArchive size={16} />}
                  <input value={rom} onChange={(e) => setRom(e.target.value)} placeholder="选择本地全量包，或粘贴下载链接" spellCheck={false} />
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
                  <input type="checkbox" checked={allowUnverified} onChange={(e) => setAllowUnverified(e.target.checked)} />
                  <span>读不到手机系统版本时仍然继续（只在确定 ROM 版本正确时勾选）</span>
                </label>
              </div>
            )}
            <div className="findings">
              {findings.map((f) => (
                <FindingCard key={f.id} f={f} busy={busy} rom={rom.trim()} onFix={runFix} />
              ))}
            </div>
          </Card>
        )}

        <Card>
          <h3 className="card-title">工具箱救不了的情况</h3>
          <ul className="steps small">
            <li>连 Fastboot 都进不去：只能 9008 深刷或送售后（新系统上免授权 9008 已被熔断）</li>
            <li>Bootloader 已上锁、系统又起不来：不能再刷写任何分区，只能清除数据或送售后</li>
          </ul>
        </Card>
      </div>
    </>
  )
}

const FLASH_KIND: Record<FlashRecord['kind'], string> = { root: 'Root', unroot: '刷回原厂', restore: '刷回原厂分区', undo: '撤销刷写' }

function yn(v: boolean | undefined, yes: string, no: string): string {
  return v === undefined ? '未知' : v ? yes : no
}

function StateSummary({ state: s }: { state: BootState }) {
  const rows: [string, ReactNode][] = [
    ['读取时的模式', MODE_LABEL[s.mode]],
    ['当前槽位', s.currentSlot?.toUpperCase()],
    ['Bootloader', s.unlocked === undefined ? undefined : s.unlocked ? '已解锁' : '已上锁'],
    ['关键分区（critical）', s.criticalUnlocked === undefined ? undefined : s.criticalUnlocked ? '已解锁' : '未解锁'],
    ['系统更新合并状态', s.snapshotStatus],
    ['开机过程中 adb', s.adbDuringBoot === undefined ? undefined : s.adbDuringBoot ? '连上过' : '没连上'],
    ['Root', s.root]
  ]
  return (
    <div className="diag-state">
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
      {(s.slots.a || s.slots.b) && (
        <table className="diag-slots">
          <thead>
            <tr>
              <th>槽位</th>
              <th>成功启动过</th>
              <th>不可启动</th>
              <th>剩余重试</th>
            </tr>
          </thead>
          <tbody>
            {(['a', 'b'] as const).map((k) => {
              const v = s.slots[k]
              return (
                <tr key={k} className={s.currentSlot === k ? 'current' : ''}>
                  <td>
                    {k.toUpperCase()}
                    {s.currentSlot === k ? '（当前）' : ''}
                  </td>
                  <td>{yn(v?.successful, '是', '否')}</td>
                  <td>{yn(v?.unbootable, '是', '否')}</td>
                  <td>{v?.retryCount ?? '未知'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {s.notes.map((n) => (
        <p key={n} className="muted small">
          · {n}
        </p>
      ))}
      {s.crashLog && (
        <details className="diag-crash">
          <summary className="small">崩溃日志（logcat -b crash）</summary>
          <pre>{s.crashLog}</pre>
        </details>
      )}
    </div>
  )
}

function FindingCard({ f, busy, rom, onFix }: { f: Finding; busy: boolean; rom: string; onFix: (fix: Fix) => void }) {
  return (
    <div className={`finding conf-${f.confidence}`}>
      <div className="finding-head">
        <Stethoscope size={16} />
        <strong>{f.title}</strong>
        <span className={`chip conf-chip-${f.confidence}`}>{CONFIDENCE[f.confidence]}</span>
      </div>
      <ul className="finding-evidence small muted">
        {f.evidence.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <div className="finding-fixes">
        {f.fixes.map((fix, i) => {
          const t = FIX_TEXT[fix.kind]
          if (t.guide)
            return (
              <div key={fix.kind} className="fix-guide small">
                <strong>{t.label}：</strong>
                {t.guide}
                {fix.note && <span className="muted">（{fix.note}）</span>}
              </div>
            )
          const noRom = NEEDS_ROM.includes(fix.kind) && !rom
          return (
            <div key={fix.kind} className="fix-row">
              <button
                className={`btn ${i === 0 ? 'btn-primary' : 'btn-secondary'}`}
                disabled={busy || noRom}
                title={noRom ? '请先在上面选择 ROM' : undefined}
                onClick={() => onFix(fix)}
              >
                {t.label}
              </button>
              {(fix.note || noRom) && <span className="muted small">{noRom ? '需要先选择 ROM' : fix.note}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
