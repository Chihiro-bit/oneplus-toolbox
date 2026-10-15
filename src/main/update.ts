import { app, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from '@shared/types'
import { loadSettings } from './settings'

function parse(v: string): number[] {
  return v.replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0)
}

export function newer(a: string, b: string): boolean {
  const x = parse(a)
  const y = parse(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0)
  }
  return false
}

/** 安装版才能自动下载替换；便携版（electron-builder 会设 PORTABLE_EXECUTABLE_DIR）和开发环境只能去发布页下载 */
export function canAutoUpdate(): boolean {
  return app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR
}

/** 通过 releases/latest 的跳转地址取最新 tag，不走 GitHub API，避免限流 */
export async function checkUpdate(): Promise<UpdateInfo> {
  const current = app.getVersion()
  const { updateRepo } = loadSettings()
  const canAuto = canAutoUpdate()
  if (!updateRepo) return { current, hasUpdate: false, canAuto, error: '未配置更新仓库' }
  try {
    const res = await net.fetch(`https://github.com/${updateRepo}/releases/latest`, { redirect: 'manual' } as RequestInit)
    const loc = res.headers.get('location') ?? ''
    const tag = loc.match(/\/releases\/tag\/([^/?#]+)/)?.[1]
    if (!tag) return { current, hasUpdate: false, canAuto, error: '该仓库还没有发布版本' }
    const latest = decodeURIComponent(tag)
    return { current, latest, url: `https://github.com/${updateRepo}/releases/tag/${tag}`, hasUpdate: newer(latest, current), canAuto }
  } catch (e) {
    return { current, hasUpdate: false, canAuto, error: (e as Error).message }
  }
}

// ───────────── 自动下载并替换（electron-updater，只用于安装版） ─────────────

let progressListener: ((percent: number) => void) | null = null
let listening = false

/**
 * 从更新仓库的最新 Release 下载安装包（读 latest.yml，electron-updater 会校验其中的 sha512）。
 * 只下载不安装，下载完由用户点「重启并安装」
 */
export async function downloadUpdate(onProgress: (percent: number) => void): Promise<{ ok: boolean; message: string }> {
  if (!canAutoUpdate()) return { ok: false, message: '便携版不支持自动更新，请到发布页下载新版本' }
  const { updateRepo } = loadSettings()
  const [owner, repo] = updateRepo.split('/')
  if (!owner || !repo) return { ok: false, message: '未配置更新仓库' }
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.setFeedURL({ provider: 'github', owner, repo })
  progressListener = onProgress
  if (!listening) {
    autoUpdater.on('download-progress', (p) => progressListener?.(p.percent))
    listening = true
  }
  try {
    const r = await autoUpdater.checkForUpdates()
    if (!r?.isUpdateAvailable) return { ok: false, message: '没有可用的更新' }
    await autoUpdater.downloadUpdate()
    return { ok: true, message: `新版本 ${r.updateInfo.version} 已下载，重启后安装` }
  } catch (e) {
    return { ok: false, message: `下载更新失败：${(e as Error).message}` }
  }
}

export function installUpdate(): void {
  // isSilent=false：显示安装界面；isForceRunAfter=true：装完重新打开
  autoUpdater.quitAndInstall(false, true)
}
