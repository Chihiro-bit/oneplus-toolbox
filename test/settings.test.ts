import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const location = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => location.dir } }))
import { loadSettings, normalizeCloseBehavior, saveSettings } from '../src/main/settings'

location.dir = mkdtempSync(join(tmpdir(), 'oneplus-settings-test-'))
afterAll(() => rmSync(location.dir, { recursive: true, force: true }))

describe('关闭行为设置', () => {
  it('旧配置与无效值使用每次询问', () => {
    expect(loadSettings().closeBehavior).toBe('ask')
    writeFileSync(join(location.dir, 'settings.json'), JSON.stringify({ catalogUrl: '', updateRepo: '' }))
    expect(loadSettings().closeBehavior).toBe('ask')
    expect(normalizeCloseBehavior('cancel')).toBe('ask')
    expect(normalizeCloseBehavior(null)).toBe('ask')
  })

  it('记住托盘或退出操作后可以恢复询问，其他设置保留', () => {
    for (const closeBehavior of ['tray', 'quit', 'ask'] as const) {
      const settings = { catalogUrl: 'https://example.com/catalog.json', updateRepo: 'Chihiro-bit/oneplus-toolbox', closeBehavior }
      expect(saveSettings(settings)).toEqual(settings)
      expect(loadSettings()).toEqual(settings)
      expect(JSON.parse(readFileSync(join(location.dir, 'settings.json'), 'utf8')).closeBehavior).toBe(closeBehavior)
    }
  })
})
