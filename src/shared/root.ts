/** DeviceInfo.root / BootState.root 表示已经拿到 Root（「未 Root」「未检测到（装有 … App）」都不算） */
export function isRooted(root?: string): boolean {
  return !!root && root !== '未 Root' && !root.startsWith('未检测到')
}
