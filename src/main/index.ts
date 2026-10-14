import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { DeviceInfo, LogEntry, LogLevel, OperationRequest, OperationResult, Settings } from '@shared/types'
import { getCatalog } from './catalog'
import { describe, detect } from './device'
import { CancelledError, missingTools, tools } from './exec'
import { isOpError, loadIcons, runOperation } from './ops'
import { loadSettings, saveSettings } from './settings'
import { checkUpdate } from './update'

let win: BrowserWindow | null = null
let current: DeviceInfo = { mode: 'none' }
let busy: AbortController | null = null

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function log(level: LogLevel, text: string): void {
  const entry: LogEntry = { time: Date.now(), level, text }
  send('log', entry)
}

function setDevice(d: DeviceInfo): void {
  current = d
  send('device', d)
}

// ───────────── 设备轮询（执行操作期间暂停，由操作自己上报状态） ─────────────

let lastKey = ''
async function poll(): Promise<void> {
  if (!busy) {
    try {
      const d = await detect()
      const key = `${d.mode}|${d.serial ?? ''}|${d.multiple ? 1 : 0}`
      if (key !== lastKey) {
        lastKey = key
        setDevice(d)
        // 状态变化后补全详情（型号、版本、槽位、解锁状态）
        if (!busy) {
          const full = await describe(d)
          if (lastKey === key) setDevice(full)
        }
      }
    } catch {
      /* 轮询失败忽略，下一轮再试 */
    }
  }
  setTimeout(poll, 2000)
}

// ───────────── IPC ─────────────

ipcMain.handle('device:get', () => current)

ipcMain.handle('op:run', async (_e, req: OperationRequest): Promise<OperationResult> => {
  if (busy) return { ok: false, message: '已有操作正在进行' }
  busy = new AbortController()
  log('step', `── 开始：${describeRequest(req)} ──`)
  try {
    const result = await runOperation(req, {
      signal: busy.signal,
      log,
      step: (t) => {
        send('step', t)
        log('step', t)
      },
      device: setDevice
    })
    log(result.ok ? 'ok' : 'error', result.message)
    if (req.kind === 'listApps' && result.ok) loadIcons((icons) => send('apps:icons', icons)).catch(() => {})
    return result
  } catch (e) {
    const message =
      e instanceof CancelledError ? '操作已取消' : isOpError(e) ? e.message : `发生错误：${(e as Error).message}`
    log('error', message)
    return { ok: false, message }
  } finally {
    busy = null
    lastKey = '' // 操作结束后强制刷新一次设备状态
  }
})

ipcMain.handle('op:cancel', () => busy?.abort())

ipcMain.handle('dialog:rom', async () => {
  const r = await dialog.showOpenDialog(win!, {
    title: '选择 ROM 包（全量升级包）',
    properties: ['openFile'],
    filters: [
      { name: 'ROM 包', extensions: ['zip', 'ozip', 'bin'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:apk', async (_e, title: string) => {
  const r = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile'],
    filters: [{ name: 'Android 安装包', extensions: ['apk'] }]
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('catalog:get', (_e, refresh?: boolean) => getCatalog(refresh))
ipcMain.handle('settings:get', () => loadSettings())
ipcMain.handle('settings:set', async (_e, s: Settings) => {
  const saved = saveSettings(s)
  await getCatalog(true)
  return saved
})
ipcMain.handle('update:check', () => checkUpdate())

ipcMain.handle('shell:openPath', (_e, p: string) => shell.showItemInFolder(p))
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url)
})

function describeRequest(req: OperationRequest): string {
  switch (req.kind) {
    case 'reboot':
      return `重启到 ${req.target}`
    case 'unlock':
      return '解锁 Bootloader'
    case 'relock':
      return '上锁 Bootloader'
    case 'switchSlot':
      return '切换 A/B 槽位'
    case 'root':
      return `Root（${req.options.schemeId}）`
    case 'listApps':
      return '读取应用列表'
    case 'cloneApp':
      return req.enable ? `双开 ${req.package}` : `移除双开 ${req.package}`
    case 'installPlay':
      return '安装 Play 商店'
    case 'otaUpdates':
      return req.disable ? '禁用系统更新' : '恢复系统更新'
  }
}

// ───────────── 窗口 ─────────────

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#16171b' : '#f6f7f9',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e7ea' : '#1d1f24',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  nativeTheme.on('updated', () => {
    win?.setTitleBarOverlay({ symbolColor: nativeTheme.shouldUseDarkColors ? '#e6e7ea' : '#1d1f24' })
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))

  win.webContents.once('did-finish-load', () => {
    const missing = missingTools()
    if (missing.length) log('error', `缺少工具：${missing.join(', ')}。开发环境请先运行 npm run prepare-tools`)
  })
}

app.whenReady().then(() => {
  createWindow()
  poll()
})

app.on('window-all-closed', () => app.quit())

// 退出时关闭 adb server，避免残留进程占用 5037 端口
app.on('will-quit', () => {
  spawnSync(tools.adb, ['kill-server'], { windowsHide: true, timeout: 3000 })
})
