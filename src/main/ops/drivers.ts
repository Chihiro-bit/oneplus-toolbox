import type { DriverEntry, OperationResult } from '@shared/types'
import { powershellPath } from '../device'
import { exec } from '../exec'
import type { OpContext } from './common'

/**
 * 列出和手机有关的 USB 设备及其驱动状态（只读，不需要管理员权限）。
 * 按厂商 ID 认：一加 2A70、OPPO 22D9（一加 13 实测用的是这个）、Google 18D1（fastboot 通用接口）、高通 05C6（9008）；
 * 没装驱动的设备在「其他设备」里，名字常常只是「Android」，所以也按名字兜底。
 */
const PNP_SCRIPT =
  "$ErrorActionPreference='SilentlyContinue';" +
  'Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match \'VID_(2A70|22D9|18D1|05C6)\' -or $_.FriendlyName -match \'Android|ADB|Fastboot|Bootloader|QDLoader|OnePlus\' } |' +
  // ConfigManagerErrorCode 默认格式化成 CM_PROB_NONE 这样的枚举名，转成数字再输出
  "ForEach-Object { '{0}|{1}|{2}|{3}|{4}' -f $_.FriendlyName, $_.InstanceId, $_.Status, $_.Class, [int]$_.ConfigManagerErrorCode }"

/** 设备管理器错误代码 → 说明 */
const PROBLEM: Record<number, string> = {
  1: '设备配置不正确',
  10: '设备无法启动',
  18: '需要重新安装驱动',
  22: '设备已被禁用',
  28: '没有安装驱动',
  31: '驱动加载失败',
  39: '驱动损坏或丢失',
  43: '设备报告了问题',
  52: '驱动签名验证失败'
}

/** 根据设备类型给出该装哪个驱动 */
function driverHint(name: string, id: string): string {
  if (/QDLoader|9008|VID_05C6&PID_9008/i.test(`${name} ${id}`)) return '需要高通 QDLoader 9008 驱动'
  if (/fastboot|bootloader/i.test(name)) return '需要 Google USB 驱动里的 Android Bootloader Interface（Fastboot 用）'
  if (/adb|composite/i.test(name)) return '需要 Google USB 驱动里的 Android ADB Interface'
  return '安装 Google USB 驱动后，在设备管理器里对它「更新驱动程序」并选择驱动所在的文件夹'
}

export function parseDrivers(out: string): DriverEntry[] {
  const list: DriverEntry[] = []
  for (const line of out.split(/\r?\n/)) {
    const [name, instanceId, status, cls, code] = line.split('|')
    if (!instanceId?.trim()) continue
    const problem = Number(code) || 0
    // USB 复合设备的父节点（\USB\VID_xxx&PID_xxx\序列号）没有问题时不显示，避免一台手机出现两三行
    if (problem === 0 && /^USB Composite Device$|^USB 复合设备$/i.test(name.trim())) continue
    list.push({
      name: name.trim() || '（无名称）',
      instanceId: instanceId.trim(),
      ok: problem === 0 && status?.trim() === 'OK',
      className: cls?.trim() || undefined,
      problem: problem ? `${PROBLEM[problem] ?? '设备异常'}（代码 ${problem}）` : status?.trim() !== 'OK' ? `状态 ${status?.trim() || '未知'}` : undefined,
      hint: problem || status?.trim() !== 'OK' ? driverHint(name, instanceId) : undefined
    })
  }
  return list
}

export async function driverCheck(ctx: OpContext): Promise<OperationResult> {
  ctx.step('正在查询设备管理器')
  const r = await exec(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', PNP_SCRIPT], {
    signal: ctx.signal,
    timeoutMs: 30_000,
    echoOutput: false
  })
  const drivers = parseDrivers(r.all)
  for (const d of drivers) ctx.log(d.ok ? 'info' : 'warn', `${d.name}  ${d.instanceId}  ${d.problem ?? '正常'}`)
  const bad = drivers.filter((d) => !d.ok)
  if (drivers.length === 0)
    return { ok: true, message: '设备管理器里没有找到手机。请换一根支持数据传输的线、换一个 USB 口，并确认手机已开启 USB 调试', drivers }
  return {
    ok: true,
    message: bad.length ? `有 ${bad.length} 个设备的驱动有问题，见下方说明` : '找到了手机，驱动都正常。仍然连不上的话，请检查手机上的 USB 调试授权',
    drivers
  }
}
