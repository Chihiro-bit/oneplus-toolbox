import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, release, userInfo } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { DeviceInfo, OperationResult } from '@shared/types'
import { getCatalog } from '../catalog'
import { describe, detect, getProps } from '../device'
import { exec, tools } from '../exec'
import { getKnown } from '../known'
import { recentLogs } from '../logfile'
import type { OpContext } from './common'
import { outputDir } from './root'

/** 只导出和刷机相关的属性，不含 IMEI、账号、网络等信息 */
const PROP_ALLOW =
  /^(ro\.product\.|ro\.build\.|ro\.boot\.(slot_suffix|verifiedbootstate|vbmeta\.device_state|flash\.locked|hwc)$|ro\.oplus|ro\.vendor\.oplus|ro\.rom\.version|ro\.crypto\.|ro\.virtual_ab|ro\.treble|ro\.kernel\.|sys\.boot_completed|init\.svc\.adbd)/
const PROP_DENY = /serial|imei|meid|iccid|uuid|mac|android_id/i

/** 序列号只留首尾两位；Windows 用户名和主目录换成占位符 */
export function maskReport(text: string, serials: string[], user: string, home: string): string {
  let out = text
  for (const s of serials.filter((x) => x && x.length > 4))
    out = out.split(s).join(`${s.slice(0, 2)}${'*'.repeat(s.length - 4)}${s.slice(-2)}`)
  if (home) out = out.split(home).join('%USERPROFILE%')
  if (user && user.length > 2) out = out.split(user).join('<user>')
  return out
}

/**
 * 导出诊断信息：工具箱版本、系统、设备状态（开机读 getprop 白名单，Fastboot 读 getvar all）和最近两天的日志，
 * 写成一个纯文本文件，提交问题反馈时直接附上。
 */
export async function exportDiagnostics(ctx: OpContext): Promise<OperationResult> {
  ctx.step('正在收集诊断信息')
  const lines: string[] = []
  const section = (title: string) => lines.push('', `==== ${title} ====`)

  lines.push(`一加工具箱诊断信息  ${new Date().toLocaleString('zh-CN', { hour12: false })}`)
  section('环境')
  lines.push(`工具箱 ${app.getVersion()}  Electron ${process.versions.electron}  Windows ${release()}`)
  const catalog = await getCatalog()
  lines.push(`方案目录：${catalog.source}${catalog.error ? `（${catalog.error}）` : ''}`)

  let device: DeviceInfo = { mode: 'none' }
  try {
    device = await describe(await detect(ctx.signal), ctx.signal)
  } catch (e) {
    if (ctx.signal.aborted) throw e
  }
  section('设备')
  lines.push(JSON.stringify(device, null, 2))
  if (device.serial) {
    const k = getKnown(device.serial)
    if (k) lines.push(`上次开机时的记录：${JSON.stringify(k)}`)
  }

  if (device.serial && device.mode === 'system') {
    const props = await getProps(device.serial, ctx.signal)
    section('getprop（已过滤）')
    for (const [k, v] of Object.entries(props).sort())
      if (PROP_ALLOW.test(k) && !PROP_DENY.test(k)) lines.push(`${k}=${v}`)
  }
  if (device.serial && (device.mode === 'fastboot' || device.mode === 'fastbootd')) {
    const r = await exec(tools.fastboot, ['-s', device.serial, 'getvar', 'all'], { signal: ctx.signal, timeoutMs: 20_000 })
    section('fastboot getvar all')
    lines.push(...r.all.split(/\r?\n/).filter((l) => l.trim() && !/serial/i.test(l)))
  }

  section('最近日志')
  lines.push(...recentLogs(1500))

  const dir = join(outputDir(), 'diagnostics')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const file = join(dir, `diagnostics_${stamp}.txt`)
  let user = ''
  try {
    user = userInfo().username
  } catch {
    /* 取不到就不替换 */
  }
  writeFileSync(file, maskReport(lines.join('\n'), [device.serial ?? ''], user, homedir()))
  return { ok: true, message: '诊断信息已导出，提交问题反馈时请附上这个文件', outputPath: file }
}
