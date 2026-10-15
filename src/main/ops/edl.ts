import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import type { EdlDevice, EdlProfile, EdlState, LogLevel, OperationResult } from '@shared/types'
import { listEdlDevices } from '../device'
import { exec, tools } from '../exec'
import { OpError, type OpContext } from './common'

// ───────────── 9008 救砖 ─────────────
//
// 工具箱本身不实现 Sahara / Firehose，也不打包任何欧加真的专有文件：
// 刷写交给 qdl（BSD-3-Clause，随安装包分发），设备编程器、签名摘要和深刷散包
// 全部由用户自备。这里负责的是检测、文件校验、参数排序、日志和风险提示。

const FLASH_TIMEOUT_MS = 60 * 60_000
const DRY_RUN_TIMEOUT_MS = 15 * 60_000

/** LUN5 上的分区一旦写错很难恢复，默认不刷 */
const LUN5_XML = /^(rawprogram|patch)5(_\d+)?\.xml$/i

function ensureQdl(): void {
  if (!existsSync(tools.qdl)) throw new OpError('缺少 qdl.exe，请先运行 npm run fetch-tools 准备第三方工具')
}

/**
 * qdl 把正常信息写 stdout、错误写 stderr，两者在 exec 里都按 info 记录。
 * 这里按关键字把失败原因标成 error，日志面板里一眼能看见。
 * （qdl 的百分比进度条只在 stdout 是控制台时才输出，用管道运行时不会有刷屏问题）
 */
function qdlLog(ctx: OpContext) {
  return (level: LogLevel, text: string): void =>
    ctx.log(level === 'info' && /failed|error|unable|invalid|refus|reject|not found/i.test(text) ? 'error' : level, text)
}

const qdl = (args: string[], ctx: OpContext, timeoutMs: number) =>
  exec(tools.qdl, args, { signal: ctx.signal, log: qdlLog(ctx), timeoutMs })

/** 找到唯一一台在线的 9008 设备 */
async function requireSingleEdl(ctx: OpContext): Promise<EdlDevice[]> {
  ctx.step('正在查找 9008 设备')
  const ports = await listEdlDevices(ctx.signal)
  if (ports.length === 0)
    throw new OpError(
      '没有检测到 9008 设备。请依次确认：①已安装高通 9008（QDLoader）驱动；②手机确实进入了 EDL 模式；③数据线支持数据传输'
    )
  if (ports.length > 1) throw new OpError(`检测到 ${ports.length} 个 9008 设备，请只连接一台`)
  ctx.log('ok', `已找到 ${ports[0].port || '9008 设备'}（${ports[0].name}）`)
  return ports
}

/** 返回文件集的问题列表，空数组表示可以开工 */
function profileProblems(p: EdlProfile): string[] {
  const problems: string[] = []
  if (!p.programmer.trim()) problems.push('未选择设备编程器（devprg*.mbn）')
  else if (!existsSync(p.programmer)) problems.push(`找不到编程器：${p.programmer}`)
  if (!p.imagesDir.trim()) problems.push('未选择散包目录')
  else if (!existsSync(p.imagesDir)) problems.push(`找不到散包目录：${p.imagesDir}`)
  if (p.xmls.length === 0) problems.push('未选择 rawprogram / patch XML')
  for (const x of p.xmls) if (!existsSync(x)) problems.push(`找不到 XML：${x}`)
  if (p.vipDir && !existsSync(p.vipDir)) problems.push(`找不到摘要表目录：${p.vipDir}`)
  return problems
}

/**
 * qdl 按命令行顺序发送 XML，patch 必须排在 rawprogram 之后。
 * 同时按「保护 LUN5」把 rawprogram5 / patch5 挑出来。
 */
function orderXmls(xmls: string[], protectLun5: boolean): { kept: string[]; skipped: string[] } {
  const kept: string[] = []
  const skipped: string[] = []
  for (const x of xmls) {
    if (protectLun5 && LUN5_XML.test(basename(x))) skipped.push(basename(x))
    else kept.push(x)
  }
  const rank = (p: string): number => (/^patch/i.test(basename(p)) ? 1 : 0)
  kept.sort((a, b) => rank(a) - rank(b) || basename(a).localeCompare(basename(b), 'en', { numeric: true }))
  return { kept, skipped }
}

function buildArgs(p: EdlProfile, xmls: string[], dryRun: boolean): string[] {
  const args: string[] = []
  if (dryRun) args.push('--dry-run')
  args.push(`--storage=${p.storage}`)
  if (p.vipDir) args.push(`--vip-table-path=${p.vipDir}`)
  if (p.imagesDir) args.push(`--include=${p.imagesDir}`)
  if (p.allowMissing) args.push('--allow-missing')
  if (p.skipReset) args.push('--skip-reset')
  args.push(p.programmer, ...xmls)
  return args
}

const asCommand = (args: string[]): string => `qdl ${args.join(' ')}`

// ───────────── 检测 ─────────────

export async function edlDetect(ctx: OpContext): Promise<OperationResult> {
  ensureQdl()
  ctx.step('正在查找 9008 设备')
  const ports = await listEdlDevices(ctx.signal)
  for (const p of ports) ctx.log('info', `9008 端口：${p.name}`)

  ctx.step('正在让 qdl 枚举设备')
  const listed = await qdl(['list'], ctx, 30_000)
  const state: EdlState = { ports, qdlList: listed.all.trim(), saharaOk: false }

  if (ports.length === 0) {
    return {
      ok: false,
      message: '没有检测到 9008 设备。请先安装高通 9008（QDLoader）驱动，再让手机进入 EDL 模式',
      edl: state
    }
  }
  ctx.log('ok', `qdl 枚举到 ${ports.length} 台 9008 设备`)
  return { ok: true, message: `已找到 ${ports.length} 台 9008 设备`, edl: state }
}

// ───────────── 预检（全程只读） ─────────────

export async function edlProbe(profile: EdlProfile, ctx: OpContext): Promise<OperationResult> {
  ensureQdl()
  const ports = await requireSingleEdl(ctx)

  ctx.step('正在通过 Sahara 读取芯片信息（只读）')
  const chip = await qdl(['chipinfo'], ctx, 60_000)
  const saharaOk = chip.code === 0
  const state: EdlState = { ports, chipInfo: chip.all.trim(), saharaOk }

  if (!saharaOk) {
    ctx.log('error', chip.all.trim() || 'qdl chipinfo 失败')
    return {
      ok: false,
      message:
        'Sahara 通信失败。请先确认 9008 驱动、数据线和端口都正常；如果这台机器已经更新过带熔断的版本（例如一加 13 的 16.0.3.501 及以后），免授权 EDL 已经不可用',
      edl: state
    }
  }
  ctx.log('ok', 'Sahara 通信正常，芯片信息已读出')

  const problems = profileProblems(profile)
  if (problems.length) return { ok: false, message: `Sahara 正常。文件还没准备好：${problems.join('；')}`, edl: state }

  ctx.step('正在离线预检文件集（qdl --dry-run，不接触设备）')
  const { kept, skipped } = orderXmls(profile.xmls, profile.protectLun5)
  if (skipped.length) ctx.log('warn', `按「保护 LUN5」跳过：${skipped.join('、')}`)
  if (kept.length === 0) throw new OpError('过滤后没有可用的 XML，请检查 rawprogram / patch 文件')

  const args = buildArgs(profile, kept, true)
  const dry = await qdl(args, ctx, DRY_RUN_TIMEOUT_MS)
  return {
    ok: dry.code === 0,
    message:
      dry.code === 0
        ? '预检通过：Sahara 正常，文件集与摘要表一致，可以开始刷写'
        : '预检未通过：qdl --dry-run 报错，请按日志修正文件集后再试',
    edl: { ...state, command: asCommand(args) }
  }
}

// ───────────── 刷写 ─────────────

export async function edlFlash(profile: EdlProfile, ctx: OpContext): Promise<OperationResult> {
  ensureQdl()
  const problems = profileProblems(profile)
  if (problems.length) throw new OpError(`文件不完整：${problems.join('；')}`)
  const ports = await requireSingleEdl(ctx)

  const { kept, skipped } = orderXmls(profile.xmls, profile.protectLun5)
  if (skipped.length) ctx.log('warn', `按「保护 LUN5」跳过：${skipped.join('、')}`)
  if (kept.length === 0) throw new OpError('过滤后没有可用的 XML，请检查 rawprogram / patch 文件')

  // 无论如何都先跑一遍离线预检：XML 与摘要表不匹配时，绝不碰设备
  ctx.step('刷写前先做一次离线预检')
  const dryArgs = buildArgs(profile, kept, true)
  const dry = await qdl(dryArgs, ctx, DRY_RUN_TIMEOUT_MS)
  if (dry.code !== 0) {
    return {
      ok: false,
      message: '预检未通过，没有向设备写入任何数据。请按日志修正文件集后重试',
      edl: { ports, saharaOk: true, command: asCommand(dryArgs) }
    }
  }
  ctx.log('ok', '预检通过')

  if (profile.dryRunOnly) {
    return {
      ok: true,
      message: '预检通过。按你的设置只做预检，没有刷入任何分区',
      edl: { ports, saharaOk: true, command: asCommand(dryArgs) }
    }
  }

  const args = buildArgs(profile, kept, false)
  const command = asCommand(args)
  ctx.step('正在刷写分区')
  ctx.log('warn', '刷写期间不要拔线、不要让电脑休眠或断电')
  const r = await qdl(args, ctx, FLASH_TIMEOUT_MS)

  if (r.code !== 0) {
    return { ok: false, message: '刷写失败。请完整保留日志里的 qdl 输出，再对照散包与机型排查', edl: { ports, saharaOk: true, command } }
  }
  return {
    ok: true,
    message: profile.skipReset ? '刷写完成。按你的设置没有重启，设备仍停留在 9008' : '刷写完成，已向设备发出重启指令',
    edl: { ports, saharaOk: true, command }
  }
}

// ───────────── 退出 9008 ─────────────

export async function edlReset(ctx: OpContext): Promise<OperationResult> {
  ensureQdl()
  const ports = await requireSingleEdl(ctx)
  ctx.step('正在让设备退出 9008 并重启')
  const r = await qdl(['reset'], ctx, 60_000)
  return {
    ok: r.code === 0,
    message: r.code === 0 ? '已发送重启指令' : '重启指令失败。可以长按电源键 10 秒以上强制重启',
    edl: { ports, saharaOk: false }
  }
}
