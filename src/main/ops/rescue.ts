import { copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { KNOWN_MANAGERS } from '@shared/catalog'
import type { FlashKind, ModuleAction, OperationResult, RestoreOptions, StockPartition, UnrootOptions } from '@shared/types'
import { describe, detect, getProps, getvar, isUnlocked, waitForMode } from '../device'
import { sha256File } from '../download'
import { addFlash, undoable, updateFlash } from '../history'
import { getKnown } from '../known'
import { adb, ensureFastboot, fastboot, OpError, requireDevice, waitForAdb, type OpContext } from './common'
import { extractImages, findFile, workDir } from './root'

/** 可以从 ROM 刷回的原厂分区（都是 bootloader 下就能刷的物理分区，不含 super 里的逻辑分区） */
export const STOCK_PARTITIONS: StockPartition[] = ['init_boot', 'boot', 'vendor_boot', 'dtbo', 'vbmeta', 'vbmeta_system', 'vbmeta_vendor']

// ───────────── 刷回原厂镜像 ─────────────

/** 手机当前的系统版本：开机时直接读，Fastboot 下用上次开机时的记录 */
async function deviceBuild(serial: string, mode: string, ctx: OpContext): Promise<{ buildId?: string; romVersion?: string; buildDateUtc?: string }> {
  if (mode === 'system') {
    ctx.step('正在读取手机信息')
    const p = await getProps(serial, ctx.signal)
    return { buildId: p['ro.build.display.id'], romVersion: p['ro.build.version.oplusrom'], buildDateUtc: p['ro.build.date.utc'] }
  }
  const k = getKnown(serial)
  if (k) ctx.log('info', `使用这台手机上次开机时记下的系统版本：${k.buildId ?? ''} ${k.romVersion ?? ''}`.trim())
  return { buildId: k?.buildId, romVersion: k?.romVersion, buildDateUtc: k?.buildDateUtc }
}

/**
 * 从 ROM 中取出指定分区的原厂镜像，进 Fastboot 刷回当前槽位，并记入刷写记录。返回 Fastboot 下的序列号。
 * 开机状态下读手机版本做校验；Fastboot 下用之前开机连接时记下的版本，记录也没有时需要用户明确同意才继续。
 */
async function flashStock(
  rom: string,
  partitions: StockPartition[],
  allowUnverified: boolean,
  kind: FlashKind,
  ctx: OpContext
): Promise<string> {
  const d = await requireDevice(ctx)
  if (d.mode !== 'system' && d.mode !== 'fastboot' && d.mode !== 'fastbootd')
    throw new OpError('请让手机开机（开启 USB 调试），或者进入 Fastboot 模式后再操作')
  const parts = partitions.filter((p) => STOCK_PARTITIONS.includes(p))
  if (parts.length === 0) throw new OpError('请选择要刷回的分区')

  const build = await deviceBuild(d.serial, d.mode, ctx)
  if (!build.buildDateUtc && !allowUnverified)
    throw new OpError('手机在 Fastboot 模式下读不到系统版本，工具箱也没有这台手机之前开机时的记录。请确认 ROM 版本后勾选「读不到版本时仍然继续」')

  const dir = workDir()
  await extractImages(rom.trim(), build.buildDateUtc, dir, ctx, allowUnverified, parts)
  const images = parts.map((p) => [p, findFile(dir, `${p}.img`)] as const).filter((e): e is readonly [StockPartition, string] => !!e[1])
  if (images.length === 0) throw new OpError(`没能从 ROM 中提取出 ${parts.join(' / ')}，请确认选择的是完整的全量包`)
  const missing = parts.filter((p) => !images.some(([x]) => x === p))
  if (missing.length) ctx.log('warn', `ROM 中没有 ${missing.join('、')}，跳过`)
  ctx.log('ok', `将刷回原厂 ${images.map(([p]) => p).join('、')}`)

  const fb = await ensureFastboot(ctx)
  ctx.step('正在检测 Bootloader 解锁状态')
  if ((await isUnlocked(fb, ctx.signal)) !== true)
    throw new OpError('Bootloader 未解锁，无法刷写。设备停留在 Fastboot，可以在「重启与模式」中开机')

  const rec = addFlash({
    serial: fb,
    kind,
    slot: await getvar(fb, 'current-slot', ctx.signal),
    build,
    partitions: await Promise.all(images.map(async ([name, img]) => ({ name, source: 'stock' as const, sha256: await sha256File(img) }))),
    backups: {}
  })
  for (const [part, img] of images) {
    ctx.step(`正在刷回原厂 ${part}`)
    const r = await fastboot(fb, ['flash', part, img], ctx, 300_000)
    if (r.code !== 0) {
      updateFlash(fb, rec.id, { status: 'failed' })
      throw new OpError(`刷入 ${part} 失败，设备仍在 Fastboot 模式，可以重试或切换槽位`)
    }
  }
  updateFlash(fb, rec.id, { status: 'ok' })
  ctx.log('ok', '原厂镜像已刷回')
  await fastboot(fb, ['reboot'], ctx)
  return fb
}

/** 从 ROM 刷回指定的原厂分区（开机诊断里「刷回原厂 vbmeta」等修复用） */
export async function restoreStock(opts: RestoreOptions, ctx: OpContext): Promise<OperationResult> {
  await flashStock(opts.rom, opts.partitions, opts.allowUnverified, 'restore', ctx)
  return { ok: true, message: `已刷回原厂 ${opts.partitions.join('、')}，手机正在重启` }
}

/**
 * 卸载 Root：把 ROM 里原厂的 boot / init_boot 一起刷回当前槽位。各家 Root 方案改的都是这两个分区之一，
 * 两个都刷回原厂就等于卸载了 Root；Root 后卡开机时，这也是最可靠的救法。
 */
export async function unroot(opts: UnrootOptions, ctx: OpContext): Promise<OperationResult> {
  const fb = await flashStock(opts.rom, ['init_boot', 'boot'], opts.allowUnverified, 'unroot', ctx)

  if (!opts.uninstallManagers)
    return { ok: true, message: '已刷回原厂镜像，手机正在重启。Root 模块文件仍保留在手机上，重新 Root 后会再次生效' }

  // 卸载管理器需要 adb，等手机开机
  ctx.step('等待手机开机，以便卸载 Root 管理器（最多 3 分钟）')
  let serial: string
  try {
    serial = (await waitForMode(['system'], { timeoutMs: 180_000, serial: fb, signal: ctx.signal, log: ctx.log })).serial!
  } catch (e) {
    if (ctx.signal.aborted) throw e
    return { ok: true, message: '已刷回原厂镜像。没等到手机开机，Root 管理器 App 未卸载，可以在手机上手动卸载' }
  }
  ctx.step('正在卸载 Root 管理器')
  const removed: string[] = []
  for (const pkg of KNOWN_MANAGERS) {
    const r = await adb(serial, ['shell', 'pm', 'uninstall', pkg], ctx, 30_000, false)
    if (r.stdout.includes('Success')) removed.push(pkg)
  }
  ctx.device(await describe(await detect(ctx.signal), ctx.signal))
  return {
    ok: true,
    message: `已刷回原厂镜像，手机已开机。${removed.length ? `已卸载 ${removed.join('、')}` : '没有找到需要卸载的管理器 App'}`
  }
}

// ───────────── 撤销上一次刷写 ─────────────

/**
 * 把上一次刷写前备份的原厂镜像刷回原来的分区和槽位。不需要 ROM，是 Root 后卡开机最快的救法。
 * 手机在那之后升级过系统（构建时间变了）时拒绝：备份对应的是旧系统，刷回去反而可能起不来。
 */
export async function undoFlash(ctx: OpContext): Promise<OperationResult> {
  const d = await requireDevice(ctx)
  if (d.mode !== 'system' && d.mode !== 'fastboot' && d.mode !== 'fastbootd')
    throw new OpError('请让手机开机（开启 USB 调试），或者进入 Fastboot 模式后再操作')
  const rec = undoable(d.serial)
  if (!rec) throw new OpError('这台手机没有可以撤销的刷写。工具箱只能撤销由它完成、并且刷写前备份过原厂镜像的 Root')
  ctx.log('info', `上一次刷写：${new Date(rec.time).toLocaleString('zh-CN', { hour12: false })} ${rec.scheme ?? rec.kind}，${rec.partitions.map((p) => p.name).join('、')}，${rec.slot?.toUpperCase() ?? '?'} 槽`)

  const build = await deviceBuild(d.serial, d.mode, ctx)
  if (rec.build.buildDateUtc && build.buildDateUtc && rec.build.buildDateUtc !== build.buildDateUtc)
    throw new OpError('上一次刷写之后，手机的系统版本已经变了（升级过系统），备份的原厂镜像不再对应当前系统。请改用「刷回原厂镜像」并选择当前版本的 ROM')

  ctx.step('正在校验备份的原厂镜像')
  const dir = workDir()
  const images: [string, string][] = []
  for (const [part, b] of Object.entries(rec.backups)) {
    if (!existsSync(b.path)) throw new OpError(`找不到备份文件 ${b.path}，可能被删除或移动了`)
    if ((await sha256File(b.path)) !== b.sha256) throw new OpError(`备份文件 ${b.path} 的内容和刷写时记录的不一致，为了安全已停止`)
    // 复制到临时目录再刷，避开「文档\一加工具箱」中文路径
    const tmp = join(dir, `${part}.img`)
    copyFileSync(b.path, tmp)
    images.push([part, tmp])
  }

  const fb = await ensureFastboot(ctx)
  ctx.step('正在检测 Bootloader 解锁状态')
  if ((await isUnlocked(fb, ctx.signal)) !== true)
    throw new OpError('Bootloader 未解锁，无法刷写。设备停留在 Fastboot，可以在「重启与模式」中开机')

  // 刷回当时的槽位；之后切换过槽位也不会刷错
  const slot = rec.slot === 'a' || rec.slot === 'b' ? rec.slot : undefined
  const undo = addFlash({
    serial: fb,
    kind: 'undo',
    slot: slot ?? (await getvar(fb, 'current-slot', ctx.signal)),
    build: rec.build,
    partitions: images.map(([name]) => ({ name, source: 'stock' as const, sha256: rec.backups[name].sha256 })),
    backups: {}
  })
  for (const [part, img] of images) {
    const target = slot ? `${part}_${slot}` : part
    ctx.step(`正在刷回原厂 ${target}`)
    const r = await fastboot(fb, ['flash', target, img], ctx, 300_000)
    if (r.code !== 0) {
      updateFlash(fb, undo.id, { status: 'failed' })
      throw new OpError(`刷入 ${target} 失败，设备仍在 Fastboot 模式，可以重试`)
    }
  }
  updateFlash(fb, undo.id, { status: 'ok' })
  updateFlash(fb, rec.id, { undone: true })
  await fastboot(fb, ['reboot'], ctx)
  return { ok: true, message: `已把 ${images.map(([p]) => p).join('、')} 恢复成刷写前的原厂镜像，手机正在重启` }
}

// ───────────── 模块导致卡开机 ─────────────

const MODULES_DIR = '/data/adb/modules'

/** 在 su 里执行；输出 RESULT|n 表示处理了 n 个模块，没拿到 Root 时什么也不输出 */
const SU_SCRIPT: Record<'disable' | 'enable', string> = {
  disable: `n=0; for m in ${MODULES_DIR}/*; do [ -d "$m" ] || continue; touch "$m/disable" && n=$((n+1)) && echo "MOD|\${m##*/}"; done; echo "RESULT|$n"`,
  enable: `n=0; for m in ${MODULES_DIR}/*; do [ -f "$m/disable" ] || continue; rm -f "$m/disable" && n=$((n+1)) && echo "MOD|\${m##*/}"; done; echo "RESULT|$n"`
}

const SAFE_MODE_TIP =
  'KernelSU / APatch 可以进安全模式（所有模块临时失效）：开机过程中出现第一屏后连续按几次音量下键；Magisk 的安全模式是开机时一直按住音量下键'

/**
 * 卡开机时 adb 往往只在开机过程中连得上几秒，所以手机不在线时先 `adb wait-for-device` 等着，一连上立刻执行。
 * 前提是这台电脑之前已经被手机授权过 USB 调试。
 */
export async function modules(action: ModuleAction, ctx: OpContext): Promise<OperationResult> {
  let serial: string
  const d = await detect(ctx.signal)
  // needsPick：选中的那台不在线（例如正卡在开机），当作「没连上」去等它
  const online = d.mode !== 'none' && !d.needsPick
  if (online && d.mode === 'unauthorized') throw new OpError('设备未授权，请在手机弹窗中允许 USB 调试')
  if (online && (d.mode === 'system' || d.mode === 'recovery')) serial = d.serial!
  else {
    if (online) throw new OpError('请让手机开机（卡在开机画面也可以），这个功能需要 adb 连接')
    ctx.step('正在等待手机连上 adb（最多 3 分钟）。卡开机的话，请让它重启或长按电源键强制重启')
    const got = await waitForAdb(ctx)
    if (!got) throw new OpError('3 分钟内没有等到 adb 连接。可能这台电脑没被手机授权过 USB 调试，或系统还没启动到 adb 阶段')
    serial = got
    ctx.log('ok', `已连接 ${serial}`)
  }

  if (action === 'remove') {
    ctx.step('正在执行 magisk --remove-modules')
    const r = await adb(serial, ['shell', 'command -v magisk >/dev/null && magisk --remove-modules || echo NO_MAGISK'], ctx, 60_000)
    if (r.stdout.includes('NO_MAGISK'))
      return { ok: false, message: `手机上没有 Magisk，无法用这个办法。${SAFE_MODE_TIP}` }
    // 成功时 Magisk 会删除全部模块并立即重启，adb 随之断开
    return { ok: true, message: '已删除全部 Magisk 模块，手机正在重启' }
  }

  ctx.step(action === 'disable' ? '正在禁用全部模块，手机上弹出 Root 授权时请点允许' : '正在重新启用全部模块')
  // timeout：没有管理器能弹授权窗（例如卡开机）时，Magisk 默认 10 秒后拒绝
  const r = await adb(serial, ['shell', `timeout 30 su -c '${SU_SCRIPT[action]}' 2>&1`], ctx, 45_000)
  const n = r.stdout.match(/^RESULT\|(\d+)/m)?.[1]
  if (n === undefined)
    return {
      ok: false,
      message:
        action === 'disable'
          ? `没有拿到 Root 授权，模块未改动。使用 Magisk 时可以改用「删除全部模块」；${SAFE_MODE_TIP}`
          : '没有拿到 Root 授权，模块未改动。请在 Root 管理器里允许 Shell 的超级用户权限后再试'
    }
  if (n === '0')
    return { ok: true, message: action === 'disable' ? '手机上没有需要禁用的模块' : '没有被禁用的模块' }

  if (action === 'enable') return { ok: true, message: `已重新启用 ${n} 个模块，重启手机后生效` }
  ctx.step('正在重启手机')
  await adb(serial, ['reboot'], ctx)
  return { ok: true, message: `已禁用 ${n} 个模块，手机正在重启。确认能开机后，可以在 Root 管理器里逐个启用，找出有问题的模块` }
}
