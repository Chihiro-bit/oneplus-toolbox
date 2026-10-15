import type { AppEntry, OperationResult } from '@shared/types'
import { exec, tools } from '../exec'
import { adb, OpError, REMOTE_DIR, requireSystem, shq, type OpContext } from './common'

const CLONE_USER = '999'

// ───────────── 应用双开 ─────────────

/**
 * 读应用名和图标的手机端脚本。listCmd 输出 `pm list packages -f` 的格式（package:<apk 路径>=<包名>），
 * 应用名用手机端的 aapt2 读取，整个循环在一次 adb shell 里完成，避免每个应用一次 adb 往返；extra 追加在最后。
 */
function appListScript(listCmd: string, extra: string[]): string {
  const field = (prefix: string) =>
    `$(echo "$b" | grep "^${prefix}:" | head -n 1 | sed "s/^[^:]*:'\\(.*\\)'$/\\1/")`
  // 每个应用一个子 shell，8 个一批并行跑 aapt2（串行时 200 个应用要两分多钟）。
  // 图标路径也来自同一次 badging 输出，不增加耗时；只取位图（自适应图标是 XML，无法直接显示）
  return [
    `A=${REMOTE_DIR}/aapt2`,
    'chmod 755 $A',
    'i=0',
    `for e in $(${listCmd} | sed "s/^package://"); do`,
    // APK 路径里可能有 =（base64 目录名），包名里没有，所以按最后一个 = 切
    '  p=${e##*=}; path=${e%=*}',
    '  (',
    '    b=$($A d badging "$path" 2>/dev/null | grep -E "^application-(label(-zh-CN)?|icon-(160|240|320|480)):")',
    `    l=${field('application-label-zh-CN')}`,
    `    [ -z "$l" ] && l=${field('application-label')}`,
    '    ic=""',
    '    for d in 240 320 160 480; do',
    `      c=${field('application-icon-$d')}`,
    '      case "$c" in *.png|*.webp|*.jpg) ic=$c; break;; esac',
    '    done',
    '    echo "APP|$p|$path|$ic|$l"',
    '  ) &',
    '  i=$((i + 1)); [ $((i % 8)) -eq 0 ] && wait',
    'done',
    'wait',
    ...extra
  ].join('\n')
}

/** 跑 appListScript 并解析结果；marks 收集 extra 输出的「标记|包名」行 */
async function readApps(serial: string, script: string, ctx: OpContext): Promise<{ apps: AppEntry[]; marks: Map<string, Set<string>> }> {
  await adb(serial, ['shell', 'mkdir', '-p', REMOTE_DIR], ctx)
  await adb(serial, ['push', tools.aapt2, `${REMOTE_DIR}/aapt2`], ctx, 60_000)
  const r = await adb(serial, ['shell', script], ctx, 600_000, false)
  const marks = new Map<string, Set<string>>()
  const apps: AppEntry[] = []
  iconSources.clear()
  for (const line of r.stdout.split(/\r?\n/)) {
    const [kind, pkg, apk, icon, ...rest] = line.split('|')
    const name = pkg?.trim()
    if (!name || !kind) continue
    if (kind === 'APP') {
      apps.push({ package: name, label: rest.join('|').trim() || name, cloned: false })
      if (apk && icon?.trim()) iconSources.set(name, { serial, apk: apk.trim(), icon: icon.trim() })
    } else {
      if (!marks.has(kind)) marks.set(kind, new Set())
      marks.get(kind)!.add(name)
    }
  }
  return { apps, marks }
}

/** 列出第三方应用及其中文名，并标出已在双开空间（用户 999）中的应用 */
export async function listApps(ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  ctx.step('正在检查双开空间')
  const users = await adb(serial, ['shell', 'pm', 'list', 'users'], ctx)
  if (!new RegExp(`UserInfo\\{${CLONE_USER}:`).test(users.stdout))
    throw new OpError('手机上还没有双开空间。请先在系统「设置 → 应用 → 应用分身」中任意双开一个应用，再回来刷新')

  ctx.step('正在读取应用列表，应用较多时需要一分钟左右')
  const script = appListScript('pm list packages -3 -f', [
    `for p in $(pm list packages -3 --user ${CLONE_USER} | sed "s/package://"); do echo "CLONED|$p"; done`
  ])
  const { apps, marks } = await readApps(serial, script, ctx)
  const cloned = marks.get('CLONED') ?? new Set()
  for (const a of apps) a.cloned = cloned.has(a.package)
  apps.sort((a, b) => Number(b.cloned) - Number(a.cloned) || a.label.localeCompare(b.label, 'zh-CN'))
  return { ok: true, message: `共 ${apps.length} 个应用，其中 ${cloned.size} 个已双开`, apps }
}

// ───────────── 预装应用精简 ─────────────

/**
 * 卸了会导致无法开机、无法解锁屏幕或无法再用 adb 恢复的系统组件，工具箱直接拒绝。
 * 这不是「可以随便卸」的白名单：不在这里的应用也可能有依赖，卸之前请确认用途。
 */
export const PROTECTED_PACKAGES = new Set([
  'android',
  'com.android.systemui',
  'com.android.settings',
  'com.android.phone',
  'com.android.shell',
  'com.android.packageinstaller',
  'com.android.permissioncontroller',
  'com.google.android.permissioncontroller',
  'com.android.providers.settings',
  'com.android.providers.telephony',
  'com.android.providers.media',
  'com.android.providers.contacts',
  'com.android.providers.downloads',
  'com.android.inputmethod.latin',
  'com.android.keychain',
  'com.android.location.fused',
  'com.android.server.telecom',
  'com.android.networkstack',
  'com.google.android.networkstack',
  'com.android.externalstorage',
  // 桌面：卸了开机后没有主屏幕（ColorOS / 氧 OS 的桌面包名是 com.android.launcher）
  'com.android.launcher',
  'com.android.launcher3',
  // ColorOS 的权限管理
  'com.oplus.securitypermission'
])

/** 列出系统预装应用，标出已对当前用户卸载（pm uninstall --user 0）的 */
export async function listSystemApps(ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  ctx.step('正在读取系统应用列表，数量较多，需要一两分钟')
  // -u 连已对当前用户卸载的也列出来，再对照 --user 0 的已安装列表
  const script = appListScript('pm list packages -s -u -f', [
    'for p in $(pm list packages -s --user 0 | sed "s/package://"); do echo "INSTALLED|$p"; done',
    'for p in $(pm list packages -s -d --user 0 | sed "s/package://"); do echo "DISABLED|$p"; done'
  ])
  const { apps, marks } = await readApps(serial, script, ctx)
  const installed = marks.get('INSTALLED') ?? new Set()
  const disabled = marks.get('DISABLED') ?? new Set()
  for (const a of apps) {
    a.system = true
    a.removed = !installed.has(a.package)
    a.disabled = disabled.has(a.package)
    a.protected = PROTECTED_PACKAGES.has(a.package)
  }
  apps.sort((a, b) => Number(b.removed) - Number(a.removed) || a.label.localeCompare(b.label, 'zh-CN'))
  const removed = apps.filter((a) => a.removed).length
  return { ok: true, message: `共 ${apps.length} 个系统应用，其中 ${removed} 个已卸载`, apps }
}

/**
 * remove：pm uninstall --user 0，只对当前用户卸载，系统分区里的 APK 还在；
 * restore：pm install-existing 恢复。恢复出厂设置也会让所有被卸载的预装应用回来
 */
export async function debloat(pkg: string, remove: boolean, ctx: OpContext): Promise<OperationResult> {
  if (!/^[\w.]+$/.test(pkg)) throw new OpError('包名不合法')
  if (remove && PROTECTED_PACKAGES.has(pkg)) throw new OpError(`${pkg} 是系统运行必需的组件，卸载后可能无法开机或无法恢复，工具箱不允许卸载`)
  const serial = await requireSystem(ctx)
  ctx.step(remove ? `正在卸载 ${pkg}` : `正在恢复 ${pkg}`)
  const r = remove
    ? await adb(serial, ['shell', 'pm', 'uninstall', '-k', '--user', '0', pkg], ctx)
    : await adb(serial, ['shell', 'pm', 'install-existing', '--user', '0', pkg], ctx)
  const ok = r.code === 0 && /Success|installed for user/i.test(r.all)
  if (!ok) return { ok: false, message: remove ? `卸载 ${pkg} 失败，详见日志` : `恢复 ${pkg} 失败，详见日志` }
  return { ok: true, message: remove ? `已卸载 ${pkg}（只对当前用户，可以随时恢复）` : `已恢复 ${pkg}` }
}

// ───────────── 应用图标（列表显示后在后台补全） ─────────────

interface IconSource {
  serial: string
  apk: string
  icon: string
}

/** 最近一次 listApps 得到的图标位置 */
const iconSources = new Map<string, IconSource>()
/** 已取回的图标，按「APK 路径 + 图标路径」缓存；应用更新后 APK 路径会变，自然失效 */
const iconCache = new Map<string, string>()

const MIME: Record<string, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' }
const ICON_BATCH = 20

/**
 * 从各 APK 中解出图标位图，分批回传 data URL。独立于操作队列运行，失败只会少几个图标。
 * 200 个应用约 5 秒。
 */
export async function loadIcons(onBatch: (icons: Record<string, string>) => void): Promise<void> {
  const pending: [string, IconSource][] = []
  const cached: Record<string, string> = {}
  for (const [pkg, src] of iconSources) {
    const hit = iconCache.get(`${src.apk}|${src.icon}`)
    if (hit) cached[pkg] = hit
    else pending.push([pkg, src])
  }
  if (Object.keys(cached).length) onBatch(cached)

  for (let i = 0; i < pending.length; i += ICON_BATCH) {
    const batch = pending.slice(i, i + ICON_BATCH)
    const script = batch
      .map(([pkg, s]) => `echo "ICON|${pkg}|$(unzip -p ${shq(s.apk)} ${shq(s.icon)} 2>/dev/null | base64 -w 0)"`)
      .join('\n')
    const r = await exec(tools.adb, ['-s', batch[0][1].serial, 'shell', script], { timeoutMs: 60_000 })
    const icons: Record<string, string> = {}
    for (const line of r.stdout.split(/\r?\n/)) {
      const [kind, pkg, b64] = line.split('|')
      const src = iconSources.get(pkg)
      if (kind !== 'ICON' || !src || !b64?.trim()) continue
      const url = `data:${MIME[src.icon.split('.').pop()!.toLowerCase()]};base64,${b64.trim()}`
      iconCache.set(`${src.apk}|${src.icon}`, url)
      icons[pkg] = url
    }
    if (Object.keys(icons).length) onBatch(icons)
  }
}

export async function cloneApp(pkg: string, enable: boolean, ctx: OpContext): Promise<OperationResult> {
  if (!/^[\w.]+$/.test(pkg)) throw new OpError('包名不合法')
  const serial = await requireSystem(ctx)
  ctx.step(enable ? `正在双开 ${pkg}` : `正在移除 ${pkg} 的双开`)
  const r = enable
    ? await adb(serial, ['shell', 'pm', 'install-existing', '--user', CLONE_USER, pkg], ctx)
    : await adb(serial, ['shell', 'pm', 'uninstall', '--user', CLONE_USER, pkg], ctx)
  const ok = r.code === 0 && /installed|Success/i.test(r.all)
  if (!ok) return { ok: false, message: enable ? '双开失败，该应用可能不支持分身' : '移除双开失败' }
  return {
    ok: true,
    message: enable ? '双开成功。注意：ColorOS 桌面重启后可能不显示分身图标，可改用第三方桌面' : '已移除该应用的双开'
  }
}

// ───────────── 安装 Play 商店 ─────────────

export async function installPlay(apk: string, ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  ctx.step('正在卸载系统内置 Play 商店的更新')
  await adb(serial, ['shell', 'pm', 'uninstall', 'com.android.vending'], ctx)
  ctx.step('正在安装 Play 商店')
  const r = await adb(serial, ['install', '-r', '-d', apk], ctx, 300_000)
  if (r.code !== 0 || !r.all.includes('Success')) return { ok: false, message: 'Play 商店安装失败，详见日志' }
  // 通过应用商店的详情页触发 Play 商店自身更新
  for (const uri of ['oppomarket://details?packagename=com.android.vending', 'market://details?id=com.android.vending'])
    await adb(serial, ['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', shq(uri)], ctx)
  return { ok: true, message: 'Play 商店已安装。如果手机上弹出了更新提示，请点击「更新」' }
}

// ───────────── 禁用 / 恢复系统更新 ─────────────

const OTA_PACKAGES = ['com.oneplus.opbackup', 'com.oppo.ota', 'com.oplus.ota', 'com.oplus.romupdate']
const SUSPEND_PACKAGES = ['com.oplus.ota', 'com.oplus.romupdate']
const PLAY_UPDATE_ACTIVITY = 'com.android.vending/com.google.android.finsky.systemupdateactivity.SystemUpdateActivity'

export async function otaUpdates(disable: boolean, ctx: OpContext): Promise<OperationResult> {
  const serial = await requireSystem(ctx)
  const sh = (...args: string[]) => adb(serial, ['shell', ...args], ctx, 30_000)
  if (disable) {
    ctx.step('正在禁用系统更新')
    await sh('settings', 'put', 'system', 'strong_prompt_ota', '0')
    await sh('settings', 'put', 'system', 'has_new_version_to_update', '0')
    // 先 suspend 再卸载：卸载之后 suspend 会失败
    for (const p of SUSPEND_PACKAGES) await sh('pm', 'suspend', p)
    for (const p of OTA_PACKAGES) await sh('pm', 'uninstall', '--user', '0', p)
    await sh('pm', 'disable', PLAY_UPDATE_ACTIVITY)
    return { ok: true, message: '系统更新已禁用。需要恢复时，回到这里点击「恢复系统更新」' }
  }
  ctx.step('正在恢复系统更新')
  for (const p of OTA_PACKAGES) await sh('pm', 'install-existing', p)
  for (const p of SUSPEND_PACKAGES) await sh('pm', 'unsuspend', p)
  await sh('pm', 'enable', PLAY_UPDATE_ACTIVITY)
  return { ok: true, message: '系统更新已恢复' }
}
