import { describe, expect, it } from 'vitest'
import { diagnose, guessLastAction, parseCriticalUnlocked, parseGetvarAll, slotsFromVars, type DiagnoseInput } from '../src/shared/bootdiag'
import type { BootState, FlashRecord } from '../src/shared/types'

// 一加 13（2026-10-15 实测）bootloader 下 getvar all 的节选
const BOOTLOADER_ALL = `(bootloader) snapshot-update-status:none
(bootloader) parallel-download-flash:yes
(bootloader) unlocked:yes
(bootloader) erase-block-size: 0x1000
(bootloader) current-slot:a
(bootloader) slot-retry-count:b:7
(bootloader) slot-unbootable:b:yes
(bootloader) slot-successful:b:yes
(bootloader) slot-retry-count:a:6
(bootloader) slot-unbootable:a:no
(bootloader) slot-successful:a:yes
(bootloader) product:sun
(bootloader) is-userspace:no
(bootloader) version-bootloader:
all:
Finished. Total time: 0.059s`

// 同一台手机 fastbootd 下的节选：slot-* 只能单独查询，successful 与 bootloader 相反
const FASTBOOTD_ALL = `(bootloader) snapshot-update-status:none
(bootloader) is-userspace:yes
(bootloader) partition-size:boot_a:0x6000000
(bootloader) is-logical:system_a:yes
(bootloader) vendor-fingerprint:oplus/ossi/ossi:15/AP3A.240617.008/1785725844921:user/release-keys
(bootloader) current-slot:a
(bootloader) slot-successful:a:no
(bootloader) slot-unbootable:b:yes
(bootloader) version-bootloader:unknown`

describe('parseGetvarAll', () => {
  const v = parseGetvarAll(BOOTLOADER_ALL)
  it('普通变量', () => {
    expect(v['current-slot']).toBe('a')
    expect(v['product']).toBe('sun')
    expect(v['erase-block-size']).toBe('0x1000')
    expect(v['version-bootloader']).toBe('')
  })
  it('带槽位子键的变量', () => {
    expect(v['slot-retry-count:b']).toBe('7')
    expect(v['slot-unbootable:a']).toBe('no')
  })
  it('值里带冒号的不被切开', () => {
    const d = parseGetvarAll(FASTBOOTD_ALL)
    expect(d['vendor-fingerprint']).toBe('oplus/ossi/ossi:15/AP3A.240617.008/1785725844921:user/release-keys')
    expect(d['partition-size:boot_a']).toBe('0x6000000')
    expect(d['is-logical:system_a']).toBe('yes')
  })
})

describe('slotsFromVars', () => {
  it('bootloader 下全部可读', () => {
    expect(slotsFromVars(parseGetvarAll(BOOTLOADER_ALL), false)).toEqual({
      a: { successful: true, unbootable: false, retryCount: 6 },
      b: { successful: true, unbootable: true, retryCount: 7 }
    })
  })
  it('fastbootd 下丢弃 slot-successful', () => {
    expect(slotsFromVars(parseGetvarAll(FASTBOOTD_ALL), true)).toEqual({ b: { successful: undefined, unbootable: true, retryCount: undefined } })
  })
})

describe('parseCriticalUnlocked', () => {
  it('解析 oem device-info', () => {
    const out = '(bootloader) Verity mode: true\n(bootloader) Device unlocked: true\n(bootloader) Device critical unlocked: false\nOKAY'
    expect(parseCriticalUnlocked(out)).toBe(false)
  })
  it('fastbootd 下不支持', () => expect(parseCriticalUnlocked("FAILED (remote: 'Unable to do OEM command')")).toBeUndefined())
})

// ───────────── 诊断规则 ─────────────

/** 实测的正常状态：a 槽在用，b 槽被 OTA 标为不可启动 */
const healthy = (): BootState => ({
  mode: 'fastboot',
  serial: 'x',
  currentSlot: 'a',
  slots: { a: { successful: true, unbootable: false, retryCount: 6 }, b: { successful: true, unbootable: true, retryCount: 7 } },
  unlocked: true,
  criticalUnlocked: false,
  snapshotStatus: 'none',
  notes: []
})

const rootRecord = (over: Partial<FlashRecord> = {}): FlashRecord => ({
  id: 'r1',
  time: Date.now() - 3600_000,
  serial: 'x',
  kind: 'root',
  scheme: 'Magisk',
  slot: 'a',
  build: { buildDateUtc: '1785725844' },
  partitions: [{ name: 'init_boot', source: 'patched', sha256: 'aa' }],
  backups: { init_boot: { path: 'C:\\b\\init_boot.img', sha256: 'bb' } },
  status: 'ok',
  ...over
})

const run = (over: Partial<DiagnoseInput>) =>
  diagnose({ state: healthy(), symptoms: [], lastAction: 'unknown', canUndo: false, ...over })
const ids = (over: Partial<DiagnoseInput>) => run(over).map((f) => f.id)

describe('diagnose', () => {
  it('上锁时只给清数据和售后', () => {
    const f = run({ state: { ...healthy(), unlocked: false }, lastAction: 'root', symptoms: ['crashdump'] })
    expect(f.map((x) => x.id)).toEqual(['locked'])
    expect(f[0].fixes.map((x) => x.kind)).toEqual(['wipeData', 'service'])
  })

  it('Root 后 CrashDump：高可信，优先撤销上一次刷写', () => {
    const [top] = run({ lastAction: 'root', symptoms: ['crashdump'], lastFlash: rootRecord(), canUndo: true })
    expect(top.id).toBe('patched-image')
    expect(top.confidence).toBe('high')
    expect(top.fixes.map((x) => x.kind)).toEqual(['undoFlash', 'unroot'])
  })

  it('Root 后当前槽位被标为不可启动：高可信', () => {
    const st = healthy()
    st.slots.a = { successful: false, unbootable: true, retryCount: 0 }
    expect(run({ state: st, lastAction: 'root', symptoms: ['logo'] })[0]).toMatchObject({ id: 'patched-image', confidence: 'high' })
  })

  it('没有备份时不提供撤销', () => {
    const f = run({ lastAction: 'root', symptoms: ['logo'] }).find((x) => x.id === 'patched-image')!
    expect(f.confidence).toBe('medium')
    expect(f.fixes.map((x) => x.kind)).toEqual(['unroot'])
  })

  it('用户没选操作时，用没撤销的 Root 记录推断', () => {
    expect(ids({ lastFlash: rootRecord(), symptoms: ['logo'] })).toContain('patched-image')
    expect(ids({ lastFlash: rootRecord({ undone: true }), symptoms: ['logo'] })).not.toContain('patched-image')
  })

  it('另一个槽位被 OTA 标为不可启动是正常的，不单独报故障', () => {
    expect(ids({ symptoms: ['logo'] })).toEqual(['unknown'])
  })

  it('装模块后卡开机且 adb 能连上：高可信', () => {
    const f = run({ state: { ...healthy(), mode: 'system', adbDuringBoot: true, root: 'Magisk 30.7' }, lastAction: 'module', symptoms: ['bootloop'] })
    expect(f[0]).toMatchObject({ id: 'module', confidence: 'high' })
    expect(f[0].fixes.map((x) => x.kind)).toEqual(['modulesDisable', 'modulesRemove', 'safeMode'])
  })

  it('没选操作但 adb 在开机时连上且已 Root：低可信地怀疑模块', () => {
    const f = run({ state: { ...healthy(), adbDuringBoot: true, root: 'KernelSU 3.3.1' }, symptoms: ['logo'] })
    expect(f.find((x) => x.id === 'module')?.confidence).toBe('low')
  })

  it('image destroyed → vbmeta', () => {
    expect(run({ symptoms: ['destroyed'] })[0]).toMatchObject({ id: 'vbmeta', confidence: 'high' })
  })

  it('更新还没合并：snapshotted 给取消，merging 给继续合并', () => {
    const snapped = run({ state: { ...healthy(), snapshotStatus: 'snapshotted' }, lastAction: 'flash' }).find((x) => x.id === 'snapshot')!
    expect(snapped.confidence).toBe('high')
    expect(snapped.fixes[0].kind).toBe('snapshotCancel')
    const merging = run({ state: { ...healthy(), snapshotStatus: 'merging' } }).find((x) => x.id === 'snapshot')!
    expect(merging.fixes[0].kind).toBe('snapshotMerge')
  })

  it('刷系统后：另一个槽位完好才建议切换，否则完整线刷', () => {
    const st = healthy()
    st.slots.a = { successful: false, unbootable: true }
    st.slots.b = { successful: true, unbootable: false }
    expect(run({ state: st, lastAction: 'flash' }).find((x) => x.id === 'slots')!.fixes.map((x) => x.kind)).toEqual(['switchSlot', 'fullFlash'])
    // 实测状态：b 槽不可启动，不能切过去
    expect(run({ lastAction: 'flash' }).find((x) => x.id === 'slots')!.fixes.map((x) => x.kind)).toEqual(['fullFlash'])
  })

  it('fastbootd 下读不到 successful 时，不建议切换槽位', () => {
    const st: BootState = { ...healthy(), mode: 'fastbootd', slots: { a: { unbootable: true }, b: { unbootable: false } } }
    expect(run({ state: st, lastAction: 'ota' }).find((x) => x.id === 'slots')!.fixes.map((x) => x.kind)).toEqual(['fullFlash'])
  })

  it('自动进 Recovery → 清除数据', () => {
    expect(run({ symptoms: ['recovery'], lastAction: 'flash' }).find((x) => x.id === 'data')?.confidence).toBe('high')
  })

  it('结果按可信度排序', () => {
    const f = run({ state: { ...healthy(), adbDuringBoot: true, root: 'Magisk 30.7' }, symptoms: ['logo', 'destroyed'] })
    expect(f.map((x) => x.confidence)).toEqual(['high', 'low'])
  })
})

describe('guessLastAction', () => {
  const now = Date.now()
  it('一天内的 Root 记录', () => expect(guessLastAction(rootRecord({ time: now - 1000 }), now)).toBe('root'))
  it('太久以前的不算', () => expect(guessLastAction(rootRecord({ time: now - 2 * 86_400_000 }), now)).toBe('unknown'))
  it('撤销过的不算', () => expect(guessLastAction(rootRecord({ undone: true }), now)).toBe('unknown'))
})
