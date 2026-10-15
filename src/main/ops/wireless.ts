import type { OperationResult, WirelessRequest } from '@shared/types'
import { exec, sleep, tools } from '../exec'
import { adb, OpError, requireSystem, type OpContext } from './common'

const HOST = /^(?:\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:]+\]|[a-z0-9][a-z0-9.-]{0,252})$/i

export function checkAddress(host: string, port: string): string {
  const h = host.trim()
  const p = port.trim()
  if (!HOST.test(h)) throw new OpError('IP 地址不正确')
  if (!/^\d{1,5}$/.test(p) || Number(p) < 1 || Number(p) > 65535) throw new OpError('端口不正确')
  return `${h}:${p}`
}

const run = (args: string[], ctx: OpContext, timeoutMs = 30_000) =>
  exec(tools.adb, args, { signal: ctx.signal, log: ctx.log, timeoutMs })

/**
 * 无线调试（Android 11+）：
 * - pair：手机「无线调试 → 使用配对码配对设备」里显示的 IP:端口 和 6 位配对码，每台电脑只需配对一次
 * - connect：无线调试页面上方显示的 IP:端口（和配对用的端口不同）
 * - fromUsb：插着线时一键切到无线（adb tcpip 5555 后连手机的 Wi-Fi IP），适合没有配对界面的老系统
 */
export async function wireless(req: WirelessRequest, ctx: OpContext): Promise<OperationResult> {
  if (req.action === 'pair') {
    const addr = checkAddress(req.host, req.port)
    if (!/^\d{6}$/.test(req.code.trim())) throw new OpError('配对码是 6 位数字')
    ctx.step(`正在与 ${addr} 配对`)
    const r = await run(['pair', addr, req.code.trim()], ctx)
    if (!/Successfully paired/i.test(r.all)) return { ok: false, message: '配对失败：请确认配对码没过期，电脑和手机在同一个 Wi-Fi 下' }
    return { ok: true, message: '配对成功。接下来用无线调试页面上方显示的 IP 和端口连接' }
  }

  if (req.action === 'connect') {
    const addr = checkAddress(req.host, req.port)
    ctx.step(`正在连接 ${addr}`)
    const r = await run(['connect', addr], ctx)
    if (!/connected to/i.test(r.all) || /failed|cannot/i.test(r.all))
      return { ok: false, message: '连接失败：请确认手机已打开无线调试、这台电脑已配对过，且端口是无线调试页面上方显示的那个' }
    return { ok: true, message: `已通过无线连接 ${addr}，可以拔掉数据线了` }
  }

  if (req.action === 'disconnect') {
    await run(['disconnect'], ctx)
    return { ok: true, message: '已断开所有无线连接' }
  }

  // fromUsb
  const serial = await requireSystem(ctx)
  if (serial.includes(':')) throw new OpError('当前已经是无线连接')
  ctx.step('正在读取手机的 Wi-Fi 地址')
  const ip = (await adb(serial, ['shell', 'ip -f inet addr show wlan0'], ctx)).stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1]
  if (!ip) throw new OpError('读不到手机的 Wi-Fi 地址，请确认手机已连上 Wi-Fi')
  ctx.step('正在打开 adb 网络调试端口 5555')
  await adb(serial, ['tcpip', '5555'], ctx)
  await sleep(2000, ctx.signal)
  const r = await run(['connect', `${ip}:5555`], ctx)
  if (!/connected to/i.test(r.all) || /failed|cannot/i.test(r.all))
    return { ok: false, message: `连接 ${ip}:5555 失败：请确认电脑和手机在同一个 Wi-Fi 下` }
  return { ok: true, message: `已通过无线连接 ${ip}:5555，可以拔掉数据线了。手机重启后需要重新用数据线切换` }
}
