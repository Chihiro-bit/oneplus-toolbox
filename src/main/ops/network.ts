import { CAPTIVE_CN, CAPTIVE_KEYS, parseNetworkState, validDnsHost, type NetworkRequest, type NetworkState } from '@shared/network'
import type { OperationResult } from '@shared/types'
import { adb, OpError, requireSystem, shq, type OpContext } from './common'

const READ_KEYS = [...CAPTIVE_KEYS, 'private_dns_mode', 'private_dns_specifier']

async function readState(serial: string, ctx: OpContext): Promise<NetworkState> {
  const script = READ_KEYS.map((k) => `echo "${k}=$(settings get global ${k})"`).join('; ')
  const r = await adb(serial, ['shell', script], ctx, 15_000, false)
  if (r.code !== 0) throw new OpError('读取网络设置失败，详见日志')
  return parseNetworkState(r.stdout)
}

/** 联网检测地址和私人 DNS，都是 settings global 里的键，不需要 Root，改完重连 Wi-Fi 生效 */
export async function network(req: NetworkRequest, ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  const put = (k: string, v: string) => adb(serial, ['shell', 'settings', 'put', 'global', k, shq(v)], ctx, 15_000)
  const del = (k: string) => adb(serial, ['shell', 'settings', 'delete', 'global', k], ctx, 15_000)
  let message = ''

  if (req.action === 'status') {
    ctx.step('正在读取网络设置')
    message = '已读取网络设置'
  } else if (req.action === 'captive') {
    ctx.step(req.fix ? '正在把联网检测地址改成国内地址' : '正在恢复系统默认的联网检测地址')
    for (const k of CAPTIVE_KEYS) await (req.fix ? put(k, CAPTIVE_CN[k]) : del(k))
    message = req.fix
      ? '已改成国内的联网检测地址。请关掉 Wi-Fi 再打开（或重新连接一次），感叹号就会消失'
      : '已恢复系统默认的联网检测地址，重新连接 Wi-Fi 后生效'
  } else {
    const host = req.host?.trim().toLowerCase()
    if (req.mode === 'hostname' && (!host || !validDnsHost(host)))
      throw new OpError('请填写私人 DNS 服务器的主机名，例如 dns.alidns.com（不要带 https:// 或端口）')
    ctx.step('正在设置私人 DNS')
    if (req.mode === 'hostname') await put('private_dns_specifier', host!)
    await put('private_dns_mode', req.mode)
    message =
      req.mode === 'hostname'
        ? `私人 DNS 已设为 ${host}。如果设置后打不开网页，说明当前网络连不上这个服务器，换一个或改回「自动」`
        : req.mode === 'off'
          ? '已关闭私人 DNS'
          : '私人 DNS 已改回自动（系统默认）'
  }

  const state = await readState(serial, ctx)
  if (req.action === 'captive' && (state.captive === 'cn') !== req.fix) return { ok: false, message: '设置没有生效，详见日志', network: state }
  if (req.action === 'dns' && state.dnsMode !== req.mode) return { ok: false, message: '设置没有生效，详见日志', network: state }
  return { ok: true, message, network: state }
}
