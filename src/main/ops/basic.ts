import { isRooted } from '@shared/root'
import type { OperationResult, RebootTarget } from '@shared/types'
import { describe, getvar, isUnlocked, rootStatus } from '../device'
import { lastFlash } from '../history'
import { adb, ensureFastboot, fastboot, OpError, requireDevice, type OpContext } from './common'

const NAMES: Record<RebootTarget, string> = {
  system: '系统',
  recovery: 'Recovery',
  bootloader: 'Fastboot',
  fastbootd: 'fastbootd',
  edl: 'EDL（9008）'
}

// ───────────── 重启到各模式 ─────────────

export async function reboot(target: RebootTarget, ctx: OpContext): Promise<OperationResult> {
  const d = await requireDevice(ctx)
  ctx.step(`正在重启到${NAMES[target]}`)
  if (d.mode === 'fastboot' || d.mode === 'fastbootd') {
    const args: Record<RebootTarget, string[]> = {
      system: ['reboot'],
      recovery: ['reboot', 'recovery'],
      bootloader: ['reboot', 'bootloader'],
      fastbootd: ['reboot', 'fastboot'],
      edl: ['reboot', 'emergency']
    }
    const r = await fastboot(d.serial, args[target], ctx)
    if (target === 'edl') ctx.log('warn', '大部分机型不支持从 Fastboot 进入 EDL，建议在开机状态使用')
    if (target === 'recovery' && r.code !== 0)
      return { ok: false, message: '该机型不支持从 Fastboot 直接进入 Recovery，可用音量键选择 Recovery mode 后按电源键' }
    return { ok: r.code === 0, message: r.code === 0 ? `已发送重启到${NAMES[target]}的指令` : '指令执行失败' }
  }
  const args: Record<RebootTarget, string[]> = {
    system: ['reboot'],
    recovery: ['reboot', 'recovery'],
    bootloader: ['reboot', 'bootloader'],
    fastbootd: ['reboot', 'fastboot'],
    edl: ['reboot', 'edl']
  }
  const r = await adb(d.serial, args[target], ctx)
  const tip = target === 'edl' ? '。退出 EDL：长按 音量上 + 电源键（老机型长按电源键）' : ''
  return { ok: r.code === 0, message: r.code === 0 ? `已发送重启到${NAMES[target]}的指令${tip}` : '指令执行失败' }
}

// ───────────── 解锁 / 上锁 Bootloader ─────────────

/**
 * 上锁前确认系统没被改过：镜像被修补过时上锁，手机会因为校验失败起不来，而上锁后又不能再刷写，只能售后。
 * 能查的有两处：开机时的 Root 状态，以及工具箱自己的刷写记录（最后一次是 Root 且没撤销）。
 */
async function checkStockBeforeLock(ctx: OpContext): Promise<void> {
  const d = await requireDevice(ctx)
  if (d.mode === 'system') {
    const root = await rootStatus(d.serial, ctx.signal)
    if (isRooted(root))
      throw new OpError(`手机当前是 ${root}，镜像被修改过，上锁后会无法开机。请先在「救援与恢复」里刷回原厂镜像再上锁`)
  }
  const last = lastFlash(d.serial)
  if (last?.kind === 'root' && !last.undone)
    throw new OpError(`工具箱记录到这台手机最后一次刷写是 Root（${last.scheme ?? ''}，${new Date(last.time).toLocaleDateString('zh-CN')}），之后没有刷回原厂。请先刷回原厂镜像再上锁`)
}

export async function setLock(unlock: boolean, ctx: OpContext): Promise<OperationResult> {
  if (!unlock) {
    ctx.step('正在检查系统是否为原厂状态')
    await checkStockBeforeLock(ctx)
  }
  const serial = await ensureFastboot(ctx)
  ctx.step('正在检测当前锁定状态')
  const state = await isUnlocked(serial, ctx.signal)
  if (state === unlock) {
    await fastboot(serial, ['reboot'], ctx)
    return { ok: true, message: unlock ? '设备已经解锁，无需重复操作（已重启）' : '设备已经上锁，无需重复操作（已重启）' }
  }

  ctx.step(unlock ? '正在发送解锁指令' : '正在发送上锁指令')
  const verb = unlock ? 'unlock' : 'lock'
  // 老机型用 oem unlock，新机型用 flashing unlock
  let r = await fastboot(serial, ['oem', verb], ctx)
  if (r.code !== 0) r = await fastboot(serial, ['flashing', verb], ctx)
  if (r.code !== 0) {
    await fastboot(serial, ['reboot'], ctx)
    return {
      ok: false,
      message: unlock
        ? '解锁失败：请在「开发者选项」中打开「OEM 解锁」；需要深度测试的机型须先通过深度测试申请'
        : '上锁失败：设备可能已上锁，或该机型不支持此指令'
    }
  }
  const option = unlock ? 'UNLOCK THE BOOTLOADER' : 'LOCK THE BOOTLOADER'
  return {
    ok: true,
    message: `最后一步：请在手机上用音量键选中「${option}」，再按电源键确认。设备将清除全部数据并重启`
  }
}

// ───────────── A/B 槽位切换 ─────────────

export async function switchSlot(ctx: OpContext): Promise<OperationResult> {
  const serial = await ensureFastboot(ctx)
  const before = await getvar(serial, 'current-slot', ctx.signal)
  if (!before) return { ok: false, message: '无法读取当前槽位，该设备可能不是 A/B 分区机型' }
  ctx.step(`当前为 ${before.toUpperCase()} 槽，正在切换`)
  const r = await fastboot(serial, ['--set-active=other'], ctx)
  const after = await getvar(serial, 'current-slot', ctx.signal)
  if (r.code !== 0 || !after || after === before) return { ok: false, message: '槽位切换失败' }
  ctx.device(await describe({ mode: 'fastboot', serial }, ctx.signal))
  return { ok: true, message: `已从 ${before.toUpperCase()} 槽切换到 ${after.toUpperCase()} 槽，设备仍停留在 Fastboot，可在「重启」中开机` }
}
