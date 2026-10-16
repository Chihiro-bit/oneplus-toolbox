/**
 * 可以用 adb 的 `pm grant` 授予的权限：保护级别带 development 标记，普通应用申请了也拿不到，
 * 只能由用户手动敲命令授予。只有应用在清单里申请了的才能授予，否则 pm grant 会报错。
 */
export const GRANTABLE_PERMISSIONS: Record<string, { label: string; desc: string }> = {
  'android.permission.WRITE_SECURE_SETTINGS': {
    label: '修改安全系统设置',
    desc: '自动化（Tasker、MacroDroid）、按键映射、手势、SystemUI Tuner 等切换系统开关时需要'
  },
  'android.permission.DUMP': { label: '读取系统状态（dumpsys）', desc: '电池、性能监控类应用需要' },
  'android.permission.READ_LOGS': { label: '读取系统日志', desc: '日志查看器、部分自动化应用需要' },
  'android.permission.PACKAGE_USAGE_STATS': { label: '读取应用使用情况', desc: '使用时长统计、按前台应用触发的自动化需要' },
  'android.permission.BATTERY_STATS': { label: '读取电池统计', desc: '耗电分析类应用需要' },
  'android.permission.SET_ANIMATION_SCALE': { label: '修改动画速度', desc: '调节系统动画倍率的应用需要' },
  'android.permission.CHANGE_CONFIGURATION': { label: '修改系统配置', desc: '切换语言、字体缩放等的应用需要' }
}

export const isGrantable = (p: string): boolean => Object.hasOwn(GRANTABLE_PERMISSIONS, p)

/**
 * 解析 `dumpsys package <包名>`：requested permissions 段列出申请的权限，
 * install / runtime permissions 段里 `权限: granted=true` 表示已授予
 */
export function parsePackagePermissions(out: string): { requested: string[]; granted: Set<string> } {
  const requested: string[] = []
  const granted = new Set<string>()
  let indent = -1
  for (const line of out.split(/\r?\n/)) {
    const depth = line.length - line.trimStart().length
    const text = line.trim()
    if (text === 'requested permissions:') {
      indent = depth
      continue
    }
    if (indent >= 0) {
      if (text && depth > indent) {
        const name = text.split(/[:,\s]/)[0]
        if (!requested.includes(name)) requested.push(name)
        continue
      }
      indent = -1
    }
    // 开发者权限记在 install permissions 段，有多个用户时其它用户另起一行并带 userId=N，只看用户 0
    const m = text.match(/^([\w.]+): granted=true/)
    const user = text.match(/userId=(\d+)/)?.[1]
    if (m && (!user || user === '0')) granted.add(m[1])
  }
  return { requested, granted }
}
