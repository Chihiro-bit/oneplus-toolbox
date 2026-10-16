import { GRANTABLE_PERMISSIONS, isGrantable, parsePackagePermissions } from '@shared/permissions'
import type { AppPermission, OperationResult } from '@shared/types'
import { adb, OpError, requireSystem, type OpContext } from './common'

async function readPermissions(serial: string, pkg: string, ctx: OpContext): Promise<AppPermission[]> {
  const r = await adb(serial, ['shell', 'dumpsys', 'package', pkg], ctx, 30_000, false)
  if (!r.stdout.includes(`Package [${pkg}]`)) throw new OpError(`手机上没有安装 ${pkg}`)
  const { requested, granted } = parsePackagePermissions(r.stdout)
  return requested.filter(isGrantable).map((name) => ({ name, ...GRANTABLE_PERMISSIONS[name], granted: granted.has(name) }))
}

/** 列出应用申请了、可以用 adb 授予的权限，以及是否已授予 */
export async function appPermissions(pkg: string, ctx: OpContext): Promise<OperationResult> {
  if (!/^[\w.]+$/.test(pkg)) throw new OpError('包名不合法')
  const serial = await requireSystem(ctx)
  ctx.step(`正在读取 ${pkg} 申请的权限`)
  const permissions = await readPermissions(serial, pkg, ctx)
  return {
    ok: true,
    message: permissions.length ? `${pkg} 有 ${permissions.length} 项权限可以用 adb 授予` : `${pkg} 没有申请需要用 adb 授予的权限`,
    permissions
  }
}

/** pm grant / pm revoke，完成后重新读一遍确认 */
export async function grantPermission(pkg: string, permission: string, grant: boolean, ctx: OpContext): Promise<OperationResult> {
  if (!/^[\w.]+$/.test(pkg)) throw new OpError('包名不合法')
  if (!isGrantable(permission)) throw new OpError(`工具箱不支持授予 ${permission}`)
  const serial = await requireSystem(ctx)
  const label = GRANTABLE_PERMISSIONS[permission].label
  ctx.step(grant ? `正在授予「${label}」` : `正在撤销「${label}」`)
  await adb(serial, ['shell', 'pm', grant ? 'grant' : 'revoke', pkg, permission], ctx)
  const permissions = await readPermissions(serial, pkg, ctx)
  const now = permissions.find((p) => p.name === permission)?.granted
  if (now !== grant) return { ok: false, message: `${grant ? '授予' : '撤销'}「${label}」失败，详见日志`, permissions }
  return {
    ok: true,
    message: grant ? `已授予「${label}」。应用正在运行的话，可能需要重新打开才能生效` : `已撤销「${label}」`,
    permissions
  }
}
