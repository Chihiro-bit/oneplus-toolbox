/**
 * 联网检测（captive portal）和私人 DNS 用到的 settings 键。
 * 原生 Android 默认访问 Google 的 generate_204 判断能不能上网，国内访问不到，Wi-Fi 就会显示感叹号、
 * 「已连接但无法访问互联网」，部分应用还会因此不走 Wi-Fi。换成国内能访问的同类地址即可。
 */
export const CAPTIVE_KEYS = [
  'captive_portal_https_url',
  'captive_portal_http_url',
  'captive_portal_fallback_url',
  'captive_portal_other_fallback_urls'
] as const

/** 国内可以访问、返回 204 的检测地址（google.cn 和原生用的是同一套服务，小米的作为备用） */
export const CAPTIVE_CN: Record<(typeof CAPTIVE_KEYS)[number], string> = {
  captive_portal_https_url: 'https://www.google.cn/generate_204',
  captive_portal_http_url: 'http://www.google.cn/generate_204',
  captive_portal_fallback_url: 'http://connect.rom.miui.com/generate_204',
  captive_portal_other_fallback_urls: 'http://www.google.cn/generate_204'
}

/** 私人 DNS（DNS over TLS）的常用服务器 */
export const DNS_PRESETS: { host: string; label: string }[] = [
  { host: 'dns.alidns.com', label: '阿里 DNS' },
  { host: 'dot.pub', label: '腾讯 DNSPod' },
  { host: 'one.one.one.one', label: 'Cloudflare' },
  { host: 'dns.google', label: 'Google' }
]

/** off=关闭，opportunistic=自动（系统默认），hostname=指定服务器 */
export type PrivateDnsMode = 'off' | 'opportunistic' | 'hostname'

export interface NetworkState {
  /** 联网检测地址：custom=改过（包括工具箱改成国内地址），default=系统默认 */
  captive: 'cn' | 'custom' | 'default'
  /** 当前的 https 检测地址，default 时为空 */
  captiveUrl?: string
  dnsMode: PrivateDnsMode
  dnsHost?: string
}

export type NetworkRequest =
  | { action: 'status' }
  | { action: 'captive'; fix: boolean }
  | { action: 'dns'; mode: PrivateDnsMode; host?: string }

/** 只接受普通域名（私人 DNS 只能填主机名，不能带协议、端口或路径） */
export function validDnsHost(host: string): boolean {
  return host.length <= 253 && /^(?=.*[a-z])([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/i.test(host)
}

/** `settings get` 对没设置过的键输出 null */
const value = (v: string | undefined): string | undefined => {
  const t = v?.trim()
  return !t || t === 'null' ? undefined : t
}

/** 解析「键=值」形式的输出（一次 adb shell 读完全部键） */
export function parseNetworkState(out: string): NetworkState {
  const kv = new Map<string, string>()
  for (const line of out.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1))
  }
  const https = value(kv.get('captive_portal_https_url'))
  const http = value(kv.get('captive_portal_http_url'))
  const captive = !https && !http ? 'default' : https === CAPTIVE_CN.captive_portal_https_url ? 'cn' : 'custom'
  const mode = value(kv.get('private_dns_mode'))
  const dnsMode: PrivateDnsMode = mode === 'off' || mode === 'hostname' ? mode : 'opportunistic'
  return { captive, captiveUrl: https ?? http, dnsMode, dnsHost: dnsMode === 'hostname' ? value(kv.get('private_dns_specifier')) : undefined }
}
