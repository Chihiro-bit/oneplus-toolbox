import type { DeviceInfo, LogLevel } from '@shared/types'
import { detect, waitForMode } from '../device'
import { exec, tools } from '../exec'

export interface OpContext {
  signal: AbortSignal
  log: (level: LogLevel, text: string) => void
  step: (text: string) => void
  /** 操作过程中设备状态变化时通知界面 */
  device: (d: DeviceInfo) => void
}

/** 预期内的失败：消息直接展示给用户 */
export class OpError extends Error {}

export { REMOTE_DIR, shq } from './patch-script'

export async function requireDevice(ctx: OpContext): Promise<DeviceInfo & { serial: string }> {
  const d = await detect(ctx.signal)
  if (d.mode === 'none') throw new OpError('未检测到设备，请连接手机并开启 USB 调试')
  if (d.mode === 'unauthorized') throw new OpError('设备未授权，请在手机弹窗中允许 USB 调试')
  if (d.multiple) throw new OpError('检测到多台设备，请只保留一台')
  return d as DeviceInfo & { serial: string }
}

export async function requireSystem(ctx: OpContext): Promise<string> {
  const d = await requireDevice(ctx)
  if (d.mode !== 'system') throw new OpError('请让手机正常开机并开启 USB 调试后再使用本功能')
  return d.serial
}

export const adb = (serial: string, args: string[], ctx: OpContext, timeoutMs?: number, echoOutput = true) =>
  exec(tools.adb, ['-s', serial, ...args], { signal: ctx.signal, log: ctx.log, timeoutMs, echoOutput })

export const fastboot = (serial: string, args: string[], ctx: OpContext, timeoutMs?: number) =>
  exec(tools.fastboot, ['-s', serial, ...args], { signal: ctx.signal, log: ctx.log, timeoutMs })

/** 进入 Fastboot（已在 Fastboot 则直接返回） */
export async function ensureFastboot(ctx: OpContext): Promise<string> {
  const d = await requireDevice(ctx)
  if (d.mode === 'fastboot') return d.serial
  ctx.step('正在重启到 Fastboot 模式')
  await adb(d.serial, ['reboot', 'bootloader'], ctx)
  const fb = await waitForMode(['fastboot'], { timeoutMs: 90_000, signal: ctx.signal, log: ctx.log })
  ctx.device(fb)
  ctx.log('ok', '已连接 Fastboot 模式')
  return fb.serial!
}

