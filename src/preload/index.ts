import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { DeviceInfo, LogEntry, ToolboxApi } from '@shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const handler = (_e: IpcRendererEvent, v: T): void => cb(v)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: ToolboxApi = {
  getDevice: () => ipcRenderer.invoke('device:get'),
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
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
}

contextBridge.exposeInMainWorld('toolbox', api)
