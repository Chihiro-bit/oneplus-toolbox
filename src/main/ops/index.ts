import { FEATURES } from '@shared/features'
import type { OperationRequest, OperationResult } from '@shared/types'
import { cloneApp, debloat, freezeApp, installPlay, listApps, listSystemApps, listUserApps, otaUpdates } from './apps'
import { appPermissions, grantPermission } from './permissions'
import { backupApp, restoreApp } from './appbackup'
export { loadIcons } from './apps'
import { reboot, setLock, switchSlot } from './basic'
import { backupPartitions } from './backup'
import { bootCollect, snapshotUpdate } from './bootdiag'
import { driverCheck } from './drivers'
import { listRemote, pullFile, pushFiles, screenshot } from './media'
import { wireless } from './wireless'
export { startMirror, stopMirror } from './media'
import { OpError, type OpContext } from './common'
import { exportDiagnostics } from './diagnostics'
import { edlDetect, edlFlash, edlProbe, edlReset } from './edl'
import { installApps } from './install'
import { installModules } from './modules'
import { network } from './network'
import { modules, restoreStock, undoFlash, unroot } from './rescue'
import { root } from './root'
import { shizuku } from './shizuku'

export type { OpContext }

export async function runOperation(req: OperationRequest, ctx: OpContext): Promise<OperationResult> {
  // 9008 关闭时界面上没有入口，这里再兜一层，防止旧界面或脚本调用
  if (!FEATURES.edl && (req.kind.startsWith('edl') || (req.kind === 'reboot' && req.target === 'edl')))
    throw new OpError('9008 / EDL 相关功能暂时停用')
  switch (req.kind) {
    case 'reboot':
      return reboot(req.target, ctx)
    case 'unlock':
      return setLock(true, ctx)
    case 'relock':
      return setLock(false, ctx)
    case 'switchSlot':
      return switchSlot(ctx)
    case 'root':
      return root(req.options, ctx)
    case 'unroot':
      return unroot(req.options, ctx)
    case 'restoreStock':
      return restoreStock(req.options, ctx)
    case 'undoFlash':
      return undoFlash(ctx)
    case 'backup':
      return backupPartitions(req.options, ctx)
    case 'screenshot':
      return screenshot(ctx)
    case 'wireless':
      return wireless(req.request, ctx)
    case 'listRemote':
      return listRemote(req.path, ctx)
    case 'pushFiles':
      return pushFiles(req.files, req.to, ctx)
    case 'pullFile':
      return pullFile(req.path, ctx)
    case 'driverCheck':
      return driverCheck(ctx)
    case 'bootCollect':
      return bootCollect(req.waitAdb, ctx)
    case 'snapshotUpdate':
      return snapshotUpdate(req.action, ctx)
    case 'modules':
      return modules(req.action, ctx)
    case 'installApps':
      return installApps(req.files, ctx)
    case 'exportDiagnostics':
      return exportDiagnostics(ctx)
    case 'listApps':
      return listApps(ctx)
    case 'listSystemApps':
      return listSystemApps(ctx)
    case 'debloat':
      return debloat(req.package, req.remove, ctx)
    case 'cloneApp':
      return cloneApp(req.package, req.enable, ctx)
    case 'installPlay':
      return installPlay(req.apk, ctx)
    case 'otaUpdates':
      return otaUpdates(req.disable, ctx)
    case 'shizuku':
      return shizuku(req.action, ctx)
    case 'listUserApps':
      return listUserApps(ctx)
    case 'freezeApp':
      return freezeApp(req.package, req.freeze, ctx)
    case 'appPermissions':
      return appPermissions(req.package, ctx)
    case 'grantPermission':
      return grantPermission(req.package, req.permission, req.grant, ctx)
    case 'network':
      return network(req.request, ctx)
    case 'backupApp':
      return backupApp(req.package, req.label, req.withData, ctx)
    case 'restoreApp':
      return restoreApp(req.dir, ctx)
    case 'installModules':
      return installModules(req.files, ctx)
    case 'edlDetect':
      return edlDetect(ctx)
    case 'edlProbe':
      return edlProbe(req.profile, ctx)
    case 'edlFlash':
      return edlFlash(req.profile, ctx)
    case 'edlReset':
      return edlReset(ctx)
  }
  // 界面比主进程新（例如开发时只热更新了界面）时会走到这里
  throw new OpError(`主进程不认识「${(req as { kind: string }).kind}」操作，请重启工具箱`)
}

export function isOpError(e: unknown): e is Error {
  return e instanceof OpError
}
