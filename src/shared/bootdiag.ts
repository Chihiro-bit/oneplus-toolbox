import type { BootState, BootSymptom, FlashRecord, LastAction } from './types'

/**
 * 开机诊断规则。输入「设备状态 + 刷写记录 + 用户看到的现象」，输出可能的原因、可信度和修复办法。
 * 纯函数，不连设备，规则都有单元测试（test/bootdiag.test.ts）。
 *
 * 判断槽位状态时注意（一加 13 实测）：
 * - 正常 OTA 之后，另一个槽位常被标成 unbootable，这本身不是故障
 * - fastbootd 报的 slot-successful 和 bootloader 不一致，采集时已丢弃 fastbootd 的这个值
 */

export type FixKind =
  | 'undoFlash'
  | 'unroot'
  | 'restoreVbmeta'
  | 'modulesDisable'
  | 'modulesRemove'
  | 'safeMode'
  | 'snapshotCancel'
  | 'snapshotMerge'
  | 'switchSlot'
  | 'fullFlash'
  | 'wipeData'
  | 'service'

export interface Fix {
  kind: FixKind
  /** 补充说明，显示在按钮旁 */
  note?: string
}

export type Confidence = 'high' | 'medium' | 'low'

export interface Finding {
  id: string
  title: string
  confidence: Confidence
  /** 判断依据，逐条显示 */
  evidence: string[]
  /** 推荐的修复办法，按优先级排列 */
  fixes: Fix[]
}

export interface DiagnoseInput {
  state: BootState
  symptoms: BootSymptom[]
  lastAction: LastAction
  /** 最近一次刷写记录 */
  lastFlash?: FlashRecord
  /** 有能撤销的刷写（带原厂备份） */
  canUndo: boolean
}

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }

const other = (s: 'a' | 'b'): 'a' | 'b' => (s === 'a' ? 'b' : 'a')

/** 另一个槽位明确可用：没被标成不可启动，并且成功启动过 */
function otherSlotUsable(st: BootState): boolean {
  if (!st.currentSlot) return false
  const o = st.slots[other(st.currentSlot)]
  return o?.unbootable === false && o.successful === true
}

function currentUnbootable(st: BootState): boolean {
  const c = st.currentSlot && st.slots[st.currentSlot]
  return !!c && (c.unbootable === true || c.retryCount === 0)
}

export function diagnose(input: DiagnoseInput): Finding[] {
  const { state: st, symptoms, lastAction, lastFlash } = input
  const has = (s: BootSymptom) => symptoms.includes(s)
  const findings: Finding[] = []
  const slotName = st.currentSlot?.toUpperCase()

  // ── Bootloader 已上锁：什么都不能刷，只剩清数据和售后 ──
  if (st.unlocked === false) {
    findings.push({
      id: 'locked',
      title: 'Bootloader 已上锁，工具箱无法刷写',
      confidence: 'high',
      evidence: ['Fastboot 报告 unlocked: no', '上锁状态下镜像被改过就会起不来，而且不能再刷写任何分区'],
      fixes: [{ kind: 'wipeData', note: '只对数据分区不兼容的情况有效' }, { kind: 'service' }]
    })
    return findings
  }

  const rootRecent = lastAction === 'root' || (lastFlash?.kind === 'root' && !lastFlash.undone && lastAction === 'unknown')

  // ── 修补后的镜像不兼容（版本不对、KMI 不匹配、刷错分区） ──
  if (rootRecent) {
    const evidence = ['出问题前最后一次操作是 Root（刷入了修补后的镜像）']
    if (lastFlash?.kind === 'root') evidence.push(`刷写记录：${lastFlash.scheme ?? ''} 修补 ${lastFlash.partitions.filter((p) => p.source === 'patched').map((p) => p.name).join('、')}，${lastFlash.slot?.toUpperCase() ?? '?'} 槽`)
    if (has('crashdump')) evidence.push('出现 QUALCOMM CrashDump Mode，内核或 ramdisk 在启动早期就崩了')
    if (currentUnbootable(st)) evidence.push(`当前 ${slotName} 槽已被 bootloader 标为不可启动`)
    const strong = has('crashdump') || currentUnbootable(st)
    const looping = has('logo') || has('bootloop')
    findings.push({
      id: 'patched-image',
      title: '修补后的镜像和系统不兼容',
      confidence: strong ? 'high' : looping ? 'medium' : 'low',
      evidence,
      fixes: [
        ...(input.canUndo ? [{ kind: 'undoFlash' as const, note: '用刷写前备份的原厂镜像恢复，不需要 ROM' }] : []),
        { kind: 'unroot', note: '需要和手机系统版本一致的全量包' }
      ]
    })
  }

  // ── 模块导致卡开机 ──
  const rooted = !!st.root && st.root !== '未 Root' && !st.root.startsWith('未检测到')
  if (lastAction === 'module' || (st.adbDuringBoot && rooted && !rootRecent && (has('logo') || has('bootloop')))) {
    const evidence: string[] = []
    if (lastAction === 'module') evidence.push('出问题前最后一次操作是安装或更新模块')
    if (st.adbDuringBoot) evidence.push('开机过程中 adb 能连上，说明内核和 Root 已经起来，卡在了更后面')
    if (rooted) evidence.push(`Root 状态：${st.root}`)
    findings.push({
      id: 'module',
      title: 'Root 模块导致卡开机',
      confidence: lastAction === 'module' ? (st.adbDuringBoot ? 'high' : 'medium') : 'low',
      evidence,
      fixes: [{ kind: 'modulesDisable' }, { kind: 'modulesRemove' }, { kind: 'safeMode' }]
    })
  }

  // ── vbmeta / 镜像校验失败 ──
  if (has('destroyed')) {
    findings.push({
      id: 'vbmeta',
      title: 'vbmeta 或镜像校验失败',
      confidence: 'high',
      evidence: ['出现 The current image have been destroyed，bootloader 校验镜像签名没通过'],
      fixes: [
        { kind: 'restoreVbmeta', note: '刷回和系统版本一致的原厂 vbmeta' },
        ...(input.canUndo ? [{ kind: 'undoFlash' as const }] : []),
        { kind: 'wipeData', note: '之前用 --disable-verity 关过校验的话，恢复校验后需要清除数据' }
      ]
    })
  }

  // ── 系统更新的数据还没合并完 ──
  const snap = st.snapshotStatus?.toLowerCase()
  if (snap === 'snapshotted' || snap === 'merging') {
    const afterUpdate = lastAction === 'ota' || lastAction === 'flash'
    findings.push({
      id: 'snapshot',
      title: snap === 'merging' ? '系统更新正在合并，合并没能完成' : '有一个还没合并的系统更新',
      confidence: snap === 'merging' || afterUpdate ? 'high' : 'medium',
      evidence: [
        `snapshot-update-status: ${snap}`,
        snap === 'merging'
          ? '虚拟 A/B 更新的数据还在往原分区合并，中途被打断或失败都会卡开机'
          : '更新已经装好但还没开机合并；这时手动刷分区，新旧数据会冲突'
      ],
      fixes:
        snap === 'merging'
          ? [{ kind: 'snapshotMerge', note: '在 fastbootd 下让合并继续完成' }]
          : [{ kind: 'snapshotCancel', note: '放弃这次更新；之后可以重新升级或刷写' }]
    })
  }

  // ── 刷系统后槽位不一致、只刷了一半 ──
  if (lastAction === 'flash' || lastAction === 'ota') {
    const usable = otherSlotUsable(st)
    findings.push({
      id: 'slots',
      title: lastAction === 'ota' ? '系统更新没装好，当前槽位起不来' : '系统没刷完整，两个槽位的版本可能不一致',
      confidence: currentUnbootable(st) ? 'high' : 'medium',
      evidence: [
        lastAction === 'ota' ? '出问题前最后一次操作是系统更新' : '出问题前最后一次操作是刷系统',
        ...(currentUnbootable(st) ? [`当前 ${slotName} 槽已被标为不可启动`] : []),
        usable
          ? `另一个 ${other(st.currentSlot!).toUpperCase()} 槽成功启动过，也没被标为不可启动`
          : '另一个槽位不确定是否完好（被标为不可启动，或读不到状态）'
      ],
      fixes: usable ? [{ kind: 'switchSlot' }, { kind: 'fullFlash' }] : [{ kind: 'fullFlash' }]
    })
  }

  // ── 跨版本刷机后数据分区不兼容 ──
  if (has('recovery')) {
    findings.push({
      id: 'data',
      title: '数据分区和当前系统不兼容',
      confidence: lastAction === 'flash' || lastAction === 'ota' ? 'high' : 'medium',
      evidence: ['开机后自动进入 Recovery 并提示无法启动系统，通常是降级或跨版本刷机后，旧数据新系统读不了'],
      fixes: [{ kind: 'wipeData', note: '会清除全部数据' }]
    })
  }

  // ── 没有 Root 相关操作却进了 CrashDump ──
  if (has('crashdump') && !rootRecent) {
    findings.push({
      id: 'crash',
      title: '系统在启动早期崩溃',
      confidence: 'medium',
      evidence: ['出现 QUALCOMM CrashDump Mode，但最近没有刷入修补后的镜像，可能是固件或内核镜像损坏'],
      fixes: [...(otherSlotUsable(st) ? [{ kind: 'switchSlot' as const }] : []), { kind: 'fullFlash' }, { kind: 'service' }]
    })
  }

  // ── 没有规则命中 ──
  if (findings.length === 0) {
    findings.push({
      id: 'unknown',
      title: '没有找到明确的原因',
      confidence: 'low',
      evidence: ['根据目前采集到的信息和你选择的现象，没有匹配到已知的情况。可以补充「最后做了什么」，或导出诊断信息反馈问题'],
      fixes: [...(otherSlotUsable(st) ? [{ kind: 'switchSlot' as const }] : []), ...(input.canUndo ? [{ kind: 'undoFlash' as const }] : []), { kind: 'service' }]
    })
  }

  return findings.sort((a, b) => RANK[a.confidence] - RANK[b.confidence])
}

/** 还能撤销的最近一次刷写：没被撤销过、带原厂备份；失败的撤销不算数，可以重试 */
export function undoableFlash(history: FlashRecord[]): FlashRecord | undefined {
  const last = history.filter((r) => r.kind !== 'undo' || r.status === 'ok').at(-1)
  return last && !last.undone && last.kind !== 'undo' && Object.keys(last.backups).length ? last : undefined
}

/** 从刷写记录推断「最后做了什么」的默认值：一天内刷过 Root 且没撤销就预选 Root */
export function guessLastAction(lastFlash: FlashRecord | undefined, now = Date.now()): LastAction {
  if (lastFlash?.kind === 'root' && !lastFlash.undone && now - lastFlash.time < 86_400_000) return 'root'
  return 'unknown'
}

// ───────────── 解析 fastboot 输出（纯函数，便于测试） ─────────────

/** 这些变量带一个子键，例如 slot-retry-count:b:7、partition-size:boot_a:0x6000000 */
const SUBKEY_VARS = /^(slot-successful|slot-unbootable|slot-retry-count|partition-size|partition-type|has-slot|is-logical)$/

/** 解析 getvar all 的输出（每行 (bootloader) key:value）。值里可能还有冒号（如 fingerprint），只按第一个冒号切 */
export function parseGetvarAll(out: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^\(bootloader\)\s+([\w.-]+):(.*)$/)
    if (!m) continue
    let [, key, rest] = m
    const i = rest.indexOf(':')
    if (SUBKEY_VARS.test(key) && i >= 0) {
      key = `${key}:${rest.slice(0, i)}`
      rest = rest.slice(i + 1)
    }
    vars[key] = rest.trim()
  }
  return vars
}

const yesNo = (v: string | undefined): boolean | undefined => (v === 'yes' ? true : v === 'no' ? false : undefined)

/** 从 getvar 结果整理槽位状态。fastbootd 报的 slot-successful 不可靠（实测与 bootloader 相反），丢弃 */
export function slotsFromVars(vars: Record<string, string>, userspace: boolean): BootState['slots'] {
  const slots: BootState['slots'] = {}
  for (const s of ['a', 'b'] as const) {
    const retry = vars[`slot-retry-count:${s}`]
    const st = {
      successful: userspace ? undefined : yesNo(vars[`slot-successful:${s}`]),
      unbootable: yesNo(vars[`slot-unbootable:${s}`]),
      retryCount: retry !== undefined && /^\d+$/.test(retry) ? Number(retry) : undefined
    }
    if (Object.values(st).some((v) => v !== undefined)) slots[s] = st
  }
  return slots
}

/** oem device-info 里的 Device critical unlocked */
export function parseCriticalUnlocked(out: string): boolean | undefined {
  const m = out.match(/Device critical unlocked:\s*(true|false)/i)
  return m ? m[1].toLowerCase() === 'true' : undefined
}
