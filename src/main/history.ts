import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { undoableFlash } from '@shared/bootdiag'
import type { FlashRecord } from '@shared/types'
import { sha256File } from './download'

/**
 * 刷写记录，按序列号存到 userData\flash-history.json。
 * 每次刷写前记下槽位、分区、方案、系统版本和刷入镜像的 sha256，并把被覆盖分区的原厂镜像备份到
 * 文档\一加工具箱\backups\<序列号>\<构建时间>\。卡开机时「撤销上一次刷写」和开机诊断都靠这份记录。
 */
const KEEP_PER_DEVICE = 20

let cache: Record<string, FlashRecord[]> | undefined

const file = (): string => join(app.getPath('userData'), 'flash-history.json')

function load(): Record<string, FlashRecord[]> {
  if (!cache) {
    try {
      cache = JSON.parse(readFileSync(file(), 'utf8'))
    } catch {
      cache = {}
    }
  }
  return cache!
}

function save(): void {
  try {
    mkdirSync(dirname(file()), { recursive: true })
    writeFileSync(file(), JSON.stringify(load(), null, 2))
  } catch {
    /* 写不进去只是少了记录，不影响刷写本身 */
  }
}

export function history(serial: string): FlashRecord[] {
  return load()[serial] ?? []
}

/** 最近一条记录（不论成败） */
export function lastFlash(serial: string): FlashRecord | undefined {
  return history(serial).at(-1)
}

export function addFlash(r: Omit<FlashRecord, 'id' | 'time' | 'status'>): FlashRecord {
  const rec: FlashRecord = { ...r, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, time: Date.now(), status: 'started' }
  const all = load()
  all[r.serial] = [...(all[r.serial] ?? []), rec].slice(-KEEP_PER_DEVICE)
  save()
  return rec
}

export function undoable(serial: string): FlashRecord | undefined {
  return undoableFlash(history(serial))
}

export function updateFlash(serial: string, id: string, patch: Partial<Pick<FlashRecord, 'status' | 'undone'>>): void {
  const rec = history(serial).find((r) => r.id === id)
  if (!rec) return
  Object.assign(rec, patch)
  save()
}

/** 备份目录：文档\一加工具箱\backups\<序列号>\<构建时间或 unknown> */
export function backupDir(documents: string, serial: string, buildDateUtc?: string): string {
  const dir = join(documents, '一加工具箱', 'backups', serial.replace(/[^\w.-]/g, '_'), buildDateUtc || 'unknown')
  mkdirSync(dir, { recursive: true })
  return dir
}

/** 把原厂镜像复制到备份目录；同名文件已存在且内容相同就不再复制 */
export async function backupImage(
  serial: string,
  buildDateUtc: string | undefined,
  partition: string,
  src: string
): Promise<{ path: string; sha256: string }> {
  const sha256 = await sha256File(src)
  const path = join(backupDir(app.getPath('documents'), serial, buildDateUtc), `${partition}.img`)
  if (!existsSync(path) || (await sha256File(path)) !== sha256) copyFileSync(src, path)
  return { path, sha256 }
}
