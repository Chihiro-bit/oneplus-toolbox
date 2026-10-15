import { parseCriticalUnlocked, parseGetvarAll, slotsFromVars } from '@shared/bootdiag'
import type { BootState, OperationResult } from '@shared/types'
import { detect, getProps, getvar, rootStatus, selectedSerial, waitForMode } from '../device'
import { exec, tools } from '../exec'
import { adb, fastboot, OpError, waitForAdb, type OpContext } from './common'

const yesNo = (v: string | undefined): boolean | undefined => (v === 'yes' ? true : v === 'no' ? false : undefined)

/**
 * 开机诊断的信息采集，只读，不改动手机：
 * - Fastboot：getvar all（槽位状态、解锁、snapshot 状态）+ oem device-info（critical 是否解锁）
 * - fastbootd：getvar all 里没有 slot-*，单独查询；slot-successful 不可靠，不采用
 * - 开机 / 卡开机时 adb 连得上：getprop、Root 状态、logcat -b crash
 * - 手机不在线且允许等待：adb wait-for-device 抓开机过程中 adb 能连上的那几秒
 */
export async function bootCollect(waitAdb: boolean, ctx: OpContext): Promise<OperationResult> {
  let d = await detect(ctx.signal)
  if (d.needsPick && !selectedSerial()) throw new OpError('连接了多台设备，请先在左下角选择要操作的那一台')
  // 选中的那台不在线（例如正卡在开机），当作没连上
  if (d.needsPick) d = { mode: 'none' }
  if (d.mode === 'unauthorized') throw new OpError('设备未授权，请在手机弹窗中允许 USB 调试')
  if (d.mode === 'edl') throw new OpError('手机在 9008 模式，读不到开机状态。长按 音量上 + 电源键退出后再试')

  const st: BootState = { mode: d.mode, serial: d.serial, slots: {}, notes: [] }

  if (d.mode === 'none') {
    if (!waitAdb)
      return { ok: true, message: '没有连接设备，只能根据你选择的现象来判断', bootState: { ...st, notes: ['没有连接设备'] } }
    ctx.step('正在等待开机过程中的 adb 连接（最多 3 分钟）。请让手机重启，或长按电源键强制重启')
    const got = await waitForAdb(ctx)
    d = got ? await detect(ctx.signal) : d
    if (!got || !d.serial || (d.mode !== 'system' && d.mode !== 'recovery'))
      return {
        ok: true,
        message: '3 分钟内没有等到 adb 连接，只能根据你选择的现象来判断',
        bootState: { ...st, adbDuringBoot: false, notes: ['开机过程中 adb 一直没连上（也可能是这台电脑没被手机授权过 USB 调试）'] }
      }
    st.mode = d.mode
    st.serial = d.serial
    st.adbDuringBoot = true
    ctx.log('ok', `开机过程中连上了 adb：${d.serial}`)
  }
  const serial = d.serial!

  if (d.mode === 'fastboot' || d.mode === 'fastbootd') {
    const userspace = d.mode === 'fastbootd'
    ctx.step('正在读取 Fastboot 变量')
    const all = await exec(tools.fastboot, ['-s', serial, 'getvar', 'all'], { signal: ctx.signal, timeoutMs: 30_000, echoOutput: false })
    const vars = parseGetvarAll(all.all)
    if (userspace) {
      for (const s of ['a', 'b'])
        for (const k of ['slot-unbootable', 'slot-retry-count']) {
          const v = await getvar(serial, `${k}:${s}`, ctx.signal)
          if (v && !/unknown variable/i.test(v)) vars[`${k}:${s}`] = v
        }
      st.notes.push('fastbootd 下读不到槽位是否成功启动过；重启到 Fastboot（bootloader）再诊断一次，信息会更全')
    }
    const slot = vars['current-slot']
    st.currentSlot = slot === 'a' || slot === 'b' ? slot : undefined
    st.slots = slotsFromVars(vars, userspace)
    st.unlocked = yesNo(vars['unlocked'])
    st.snapshotStatus = vars['snapshot-update-status'] || undefined
    if (!userspace) {
      const info = await fastboot(serial, ['oem', 'device-info'], ctx, 10_000)
      st.criticalUnlocked = parseCriticalUnlocked(info.all)
      if (st.unlocked === undefined && /Device unlocked:\s*(true|false)/i.test(info.all)) st.unlocked = /Device unlocked:\s*true/i.test(info.all)
    }
    ctx.log('info', `当前 ${st.currentSlot?.toUpperCase() ?? '?'} 槽，槽位状态 ${JSON.stringify(st.slots)}，snapshot ${st.snapshotStatus ?? '未知'}`)
    return { ok: true, message: '已读取 Fastboot 下的设备状态', bootState: st }
  }

  // 开机或 Recovery（adb）
  ctx.step('正在读取系统属性')
  const props = await getProps(serial, ctx.signal)
  st.bootCompleted = props['sys.boot_completed'] === '1'
  const suffix = props['ro.boot.slot_suffix']?.replace(/^_/, '')
  st.currentSlot = suffix === 'a' || suffix === 'b' ? suffix : undefined
  // 还没开机完成就能连上 adb，等同于抓到了开机过程中的 adb
  if (d.mode === 'system' && !st.bootCompleted) st.adbDuringBoot = true
  if (d.mode === 'system') st.root = await rootStatus(serial, ctx.signal)
  if (d.mode === 'recovery') st.notes.push('手机在 Recovery，读到的是 Recovery 自己的属性')

  ctx.step('正在读取崩溃日志')
  const crash = await adb(serial, ['shell', 'logcat', '-b', 'crash', '-d', '-t', '80'], ctx, 20_000, false)
  if (crash.code === 0 && crash.stdout.trim()) st.crashLog = crash.stdout.trim()
  if (st.bootCompleted) st.notes.push('手机已经正常开机完成')
  return { ok: true, message: st.bootCompleted ? '手机已经正常开机，状态已读取' : '已读取开机过程中的状态', bootState: st }
}

/**
 * 处理没合并完的虚拟 A/B 更新，只能在 fastbootd 下执行：
 * cancel 放弃更新（之后才能正常刷分区），merge 让正在进行的合并继续完成
 */
export async function snapshotUpdate(action: 'cancel' | 'merge', ctx: OpContext): Promise<OperationResult> {
  const d = await detect(ctx.signal)
  if (d.needsPick) throw new OpError('连接了多台设备，请先在左下角选择要操作的那一台')
  if (!d.serial || (d.mode !== 'system' && d.mode !== 'fastboot' && d.mode !== 'fastbootd'))
    throw new OpError('请让手机进入 Fastboot，或者开机并开启 USB 调试')
  let serial = d.serial
  if (d.mode !== 'fastbootd') {
    ctx.step('正在重启到 fastbootd')
    if (d.mode === 'fastboot') await fastboot(serial, ['reboot', 'fastboot'], ctx)
    else await adb(serial, ['reboot', 'fastboot'], ctx)
    const fd = await waitForMode(['fastbootd'], { timeoutMs: 120_000, serial, signal: ctx.signal, log: ctx.log })
    ctx.device(fd)
    serial = fd.serial!
  }
  const before = await getvar(serial, 'snapshot-update-status', ctx.signal)
  ctx.log('info', `snapshot-update-status: ${before ?? '未知'}`)
  if (before === 'none') return { ok: true, message: '没有未合并的系统更新，不需要处理。手机停留在 fastbootd' }

  ctx.step(action === 'cancel' ? '正在取消未合并的更新' : '正在继续合并更新')
  const r = await fastboot(serial, ['snapshot-update', action], ctx, action === 'merge' ? 1_800_000 : 60_000)
  if (r.code !== 0) return { ok: false, message: `snapshot-update ${action} 失败，详见日志。手机停留在 fastbootd` }
  const after = await getvar(serial, 'snapshot-update-status', ctx.signal)
  return {
    ok: true,
    message: `已执行 snapshot-update ${action}，现在的状态是 ${after ?? '未知'}。手机停留在 fastbootd，可以在「重启与模式」中开机`
  }
}
