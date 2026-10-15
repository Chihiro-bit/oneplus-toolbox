import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { LogEntry } from '@shared/types'

const KEEP_DAYS = 30

let dir: string | undefined

/** 文档\一加工具箱\logs，每天一个文件 */
export function logDir(): string {
  if (!dir) {
    dir = join(app.getPath('documents'), '一加工具箱', 'logs')
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

const day = (t: number): string => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 写入失败（磁盘满、文档目录被重定向到不可写位置等）只影响落盘，不影响操作本身 */
export function appendLog(e: LogEntry): void {
  try {
    const time = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false })
    const text = e.level === 'cmd' ? `$ ${e.text}` : e.text
    appendFileSync(join(logDir(), `${day(e.time)}.log`), `${time} [${e.level}] ${text}\n`)
  } catch {
    /* 忽略 */
  }
}

/** 删除 30 天前的日志 */
export function pruneLogs(): void {
  try {
    const cutoff = day(Date.now() - KEEP_DAYS * 86_400_000)
    for (const f of readdirSync(logDir())) {
      if (/^\d{4}-\d{2}-\d{2}\.log$/.test(f) && f.slice(0, 10) < cutoff) rmSync(join(logDir(), f), { force: true })
    }
  } catch {
    /* 忽略 */
  }
}

/** 最近两天日志的最后 maxLines 行 */
export function recentLogs(maxLines: number): string[] {
  const lines: string[] = []
  for (const t of [Date.now() - 86_400_000, Date.now()]) {
    const f = join(logDir(), `${day(t)}.log`)
    if (existsSync(f)) lines.push(`──── ${day(t)} ────`, ...readFileSync(f, 'utf8').split('\n').filter(Boolean))
  }
  return lines.slice(-maxLines)
}
