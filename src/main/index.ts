import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import type { DeviceInfo, LogEntry, LogLevel, OperationRequest, OperationResult, Settings } from '@shared/types'
import { getCatalog } from './catalog'
import { describe, detect, selectDevice } from './device'
import { CancelledError, missingTools, tools } from './exec'
import { history } from './history'
import { appendLog, logDir, pruneLogs } from './logfile'
import { isOpError, loadIcons, runOperation, startMirror, stopMirror } from './ops'
import { loadSettings, saveSettings } from './settings'
import { checkUpdate, downloadUpdate, installUpdate } from './update'

let win: BrowserWindow | null = null
let current: DeviceInfo = { mode: 'none' }
let busy: AbortController | null = null

function send(channel: string, payload: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function log(level: LogLevel, text: string): void {
  const entry: LogEntry = { time: Date.now(), level, text }
  send('log', entry)
  appendLog(entry)
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
      const key = `${d.mode}|${d.serial ?? ''}|${d.needsPick ? 1 : 0}|${(d.devices ?? []).map((x) => `${x.serial}:${x.mode}`).join(',')}`
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
ipcMain.handle('device:select', (_e, serial: string) => {
  selectDevice(serial)
  lastKey = '' // 下一轮轮询立即刷新
})

ipcMain.handle('op:run', async (_e, req: OperationRequest): Promise<OperationResult> => {
  if (busy) return { ok: false, message: '已有操作正在进行' }
  busy = new AbortController()
  log('step', `── 开始：${describeRequest(req) ?? req.kind} ──`)
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
    if ((req.kind === 'listApps' || req.kind === 'listSystemApps' || req.kind === 'listUserApps') && result.ok) loadIcons((icons) => send('apps:icons', icons)).catch(() => {})
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

function extFilters(extensions: string[]): { name: string; extensions: string[] }[] {
  if (extensions.length === 0) return []
  return [
    { name: extensions.map((e) => e.toUpperCase()).join(' / '), extensions },
    { name: '所有文件', extensions: ['*'] }
  ]
}

ipcMain.handle('dialog:file', async (_e, title: string, extensions: string[]) => {
  const r = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile'],
    filters: extFilters(extensions)
  })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog:files', async (_e, title: string, extensions: string[]) => {
  const r = await dialog.showOpenDialog(win!, {
    title,
    properties: ['openFile', 'multiSelections'],
    filters: extFilters(extensions)
  })
  return r.canceled ? [] : r.filePaths
})

ipcMain.handle('dialog:dir', async (_e, title: string) => {
  const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory'] })
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
ipcMain.handle('update:download', () => downloadUpdate((p) => send('update:progress', p)))
ipcMain.handle('update:install', () => installUpdate())

ipcMain.handle('shell:openPath', (_e, p: string) => shell.showItemInFolder(p))
ipcMain.handle('shell:openExternal', (_e, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url)
})
ipcMain.handle('shell:openLogDir', () => shell.openPath(logDir()))
ipcMain.handle('mirror:start', (_e, opts: { turnScreenOff: boolean; stayAwake: boolean }) => startMirror(opts, log))
ipcMain.handle('history:get', (_e, serial: string) => history(serial))

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
    case 'unroot':
      return '刷回原厂镜像'
    case 'restoreStock':
      return `刷回原厂 ${req.options.partitions.join('、')}`
    case 'undoFlash':
      return '撤销上一次刷写'
    case 'bootCollect':
      return '开机诊断：采集设备状态'
    case 'driverCheck':
      return '检查驱动'
    case 'screenshot':
      return '截图'
    case 'wireless':
      return { pair: '无线调试配对', connect: '无线连接', disconnect: '断开无线连接', fromUsb: '切换到无线调试' }[req.request.action]
    case 'listRemote':
      return `浏览 ${req.path}`
    case 'pushFiles':
      return `发送 ${req.files.length} 个文件到手机`
    case 'pullFile':
      return `从手机接收 ${req.path}`
    case 'backup':
      return req.options.source === 'device' ? '备份关键分区' : '从 ROM 保存原厂镜像'
    case 'snapshotUpdate':
      return req.action === 'cancel' ? '取消未合并的系统更新' : '继续合并系统更新'
    case 'modules':
      return { disable: '禁用全部模块', enable: '重新启用全部模块', remove: '删除全部 Magisk 模块' }[req.action]
    case 'installApps':
      return `安装应用（${req.files.length} 个文件）`
    case 'exportDiagnostics':
      return '导出诊断信息'
    case 'listApps':
      return '读取应用列表'
    case 'listSystemApps':
      return '读取系统应用列表'
    case 'debloat':
      return req.remove ? `卸载预装应用 ${req.package}` : `恢复预装应用 ${req.package}`
    case 'cloneApp':
      return req.enable ? `双开 ${req.package}` : `移除双开 ${req.package}`
    case 'installPlay':
      return '安装 Play 商店'
    case 'otaUpdates':
      return req.disable ? '禁用系统更新' : '恢复系统更新'
    case 'shizuku':
      return { start: '启动 Shizuku', status: '检查 Shizuku 状态', autostart: '设置 Shizuku 开机自启' }[req.action]
    case 'listUserApps':
      return '读取应用列表'
    case 'freezeApp':
      return req.freeze ? `冻结 ${req.package}` : `解冻 ${req.package}`
    case 'appPermissions':
      return `读取 ${req.package} 的权限`
    case 'grantPermission':
      return `${req.grant ? '授予' : '撤销'} ${req.package} 的 ${req.permission}`
    case 'edlDetect':
      return '查找 9008 设备'
    case 'edlProbe':
      return '9008 预检（只读）'
    case 'edlFlash':
      return req.profile.dryRunOnly ? '9008 预检（只读）' : '9008 刷写'
    case 'edlReset':
      return '退出 9008'
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
    if (missing.length) log('error', `缺少工具：${missing.join(', ')}。开发环境请先运行 npm run fetch-tools`)
  })
}

app.whenReady().then(() => {
  pruneLogs()
  createWindow()
  poll()
})

app.on('window-all-closed', () => app.quit())

// 退出时关闭 adb server，避免残留进程占用 5037 端口
app.on('will-quit', () => {
  stopMirror()
  spawnSync(tools.adb, ['kill-server'], { windowsHide: true, timeout: 3000 })
})
