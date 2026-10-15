import { useCallback, useEffect, useState } from 'react'
import type { DeviceInfo, DeviceMode, LogEntry, OperationRequest, OperationResult } from '@shared/types'

export interface RunState {
  running: boolean
  title?: string
  step?: string
  result?: OperationResult
}

const MAX_LOGS = 2000

export function useToolbox() {
  const [device, setDevice] = useState<DeviceInfo>({ mode: 'none' })
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [run, setRun] = useState<RunState>({ running: false })

  useEffect(() => {
    window.toolbox.getDevice().then(setDevice)
    const offs = [
      window.toolbox.onDevice(setDevice),
      window.toolbox.onLog((e) => setLogs((l) => (l.length >= MAX_LOGS ? [...l.slice(-MAX_LOGS + 1), e] : [...l, e]))),
      window.toolbox.onStep((step) => setRun((r) => (r.running ? { ...r, step } : r)))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const start = useCallback(async (title: string, req: OperationRequest): Promise<OperationResult> => {
    setRun({ running: true, title, step: '准备中…' })
    const result = await window.toolbox.run(req)
    setRun({ running: false, title, result })
    return result
  }, [])

  const dismiss = useCallback(() => setRun({ running: false }), [])
  const clearLogs = useCallback(() => setLogs([]), [])

  return { device, logs, run, start, dismiss, clearLogs }
}

export type Toolbox = ReturnType<typeof useToolbox>

export const MODE_LABEL: Record<DeviceMode, string> = {
  none: '未连接',
  system: '开机',
  recovery: 'Recovery',
  fastboot: 'Fastboot',
  fastbootd: 'fastbootd',
  unauthorized: '未授权',
  edl: 'EDL (9008)'
}

/**
 * 是否为一加设备。品牌或厂商任一包含 OnePlus 即可；两者都读不到时返回 undefined（例如首次以 Fastboot 连接）。
 * 同属 OPlus 的 OPPO / realme 不算 —— 它们的解锁和刷机流程与一加不同。
 */
export function isOnePlus(d: DeviceInfo): boolean | undefined {
  if (!d.brand && !d.manufacturer) return undefined
  return /oneplus/i.test(`${d.brand ?? ''} ${d.manufacturer ?? ''}`)
}

/** 生成危险操作的确认码（去掉易混淆的字符） */
export function randomCode(len = 4): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
