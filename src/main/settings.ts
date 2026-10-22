import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { Settings } from '@shared/types'

const DEFAULTS: Settings = { catalogUrl: '', updateRepo: __DEFAULT_UPDATE_REPO__, closeBehavior: 'ask' }

export function normalizeCloseBehavior(value: unknown): NonNullable<Settings['closeBehavior']> {
  return value === 'tray' || value === 'quit' ? value : 'ask'
}

function file(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(readFileSync(file(), 'utf8'))
    return { ...DEFAULTS, ...saved, closeBehavior: normalizeCloseBehavior(saved.closeBehavior) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings): Settings {
  const clean: Settings = {
    closeBehavior: normalizeCloseBehavior(s.closeBehavior),
    catalogUrl: s.catalogUrl.trim(),
    updateRepo: s.updateRepo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '')
  }
  if (clean.catalogUrl && !/^https:\/\//.test(clean.catalogUrl)) throw new Error('目录地址必须以 https:// 开头')
  if (clean.updateRepo && !/^[\w.-]+\/[\w.-]+$/.test(clean.updateRepo)) throw new Error('仓库格式应为 owner/repo')
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), JSON.stringify(clean, null, 2))
  return clean
}
