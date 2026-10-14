import type { OperationRequest, OperationResult } from '@shared/types'
import { cloneApp, installPlay, listApps, otaUpdates } from './apps'
export { loadIcons } from './apps'
import { reboot, setLock, switchSlot } from './basic'
import { OpError, type OpContext } from './common'
import { root } from './root'

export type { OpContext }

export async function runOperation(req: OperationRequest, ctx: OpContext): Promise<OperationResult> {
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
    case 'listApps':
      return listApps(ctx)
    case 'cloneApp':
      return cloneApp(req.package, req.enable, ctx)
    case 'installPlay':
      return installPlay(req.apk, ctx)
    case 'otaUpdates':
      return otaUpdates(req.disable, ctx)
  }
}

export function isOpError(e: unknown): e is Error {
  return e instanceof OpError
}
