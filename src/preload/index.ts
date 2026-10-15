import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { DeviceInfo, LogEntry, ToolboxApi } from '@shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: ToolboxApi = {
  getDevice: () => ipcRenderer.invoke('device:get'),
  selectDevice: (serial) => ipcRenderer.invoke('device:select', serial),
  onDevice: (cb) => subscribe<DeviceInfo>('device', cb),
  onLog: (cb) => subscribe<LogEntry>('log', cb),
  onStep: (cb) => subscribe<string>('step', cb),
  onAppIcons: (cb) => subscribe<Record<string, string>>('apps:icons', cb),
  run: (req) => ipcRenderer.invoke('op:run', req),
  cancel: () => ipcRenderer.invoke('op:cancel'),
  pickRom: () => ipcRenderer.invoke('dialog:rom'),
  pickApk: (title) => ipcRenderer.invoke('dialog:apk', title),
  pickFile: (title, extensions) => ipcRenderer.invoke('dialog:file', title, extensions),
  pickFiles: (title, extensions) => ipcRenderer.invoke('dialog:files', title, extensions),
  pickDir: (title) => ipcRenderer.invoke('dialog:dir', title),
  getCatalog: (refresh) => ipcRenderer.invoke('catalog:get', refresh),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (s) => ipcRenderer.invoke('settings:set', s),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  onUpdateProgress: (cb) => subscribe<number>('update:progress', cb),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  openLogDir: () => ipcRenderer.invoke('shell:openLogDir'),
  getHistory: (serial) => ipcRenderer.invoke('history:get', serial),
  startMirror: (opts) => ipcRenderer.invoke('mirror:start', opts),
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('toolbox', api)
