import { describe, expect, it } from 'vitest'
import { BUILTIN_CATALOG, mergeCatalog, validateCatalog } from '../src/shared/catalog'

const scheme = {
  id: 'magisk',
  name: 'Magisk 新版',
  family: 'magisk',
  version: '31.0',
  package: 'com.topjohnwu.magisk',
  apk: { url: 'https://example.com/m.apk', sha256: 'A'.repeat(64) }
}

describe('validateCatalog', () => {
  it('内置目录本身能通过校验（bundled 方案除外）', () => {
    const remote = { ...BUILTIN_CATALOG, schemes: BUILTIN_CATALOG.schemes.filter((s) => !s.apk.bundled) }
    expect(() => validateCatalog(remote)).not.toThrow()
  })
  it('sha256 统一转小写，丢弃未知字段', () => {
    const c = validateCatalog({ schemaVersion: 1, schemes: [{ ...scheme, evil: 1 }] })
    expect(c.schemes[0].apk.sha256).toBe('a'.repeat(64))
    expect(c.schemes[0]).not.toHaveProperty('evil')
  })
  it.each([
    ['schemaVersion 不对', { schemaVersion: 2, schemes: [] }],
    ['http 下载地址', { schemaVersion: 1, schemes: [{ ...scheme, apk: { ...scheme.apk, url: 'http://x/a.apk' } }] }],
    ['sha256 长度不对', { schemaVersion: 1, schemes: [{ ...scheme, apk: { ...scheme.apk, sha256: 'abc' } }] }],
    ['未知 family', { schemaVersion: 1, schemes: [{ ...scheme, family: 'other' }] }],
    ['id 含大写', { schemaVersion: 1, schemes: [{ ...scheme, id: 'Magisk' }] }]
  ])('拒绝：%s', (_, raw) => expect(() => validateCatalog(raw)).toThrow())
})

describe('mergeCatalog', () => {
  it('远程覆盖同 id，新 id 追加，内置离线方案保留', () => {
    const merged = mergeCatalog(
      validateCatalog({
        schemaVersion: 1,
        schemes: [scheme, { ...scheme, id: 'magisk-bundled' }, { ...scheme, id: 'new-one' }]
      })
    )
    expect(merged.find((s) => s.id === 'magisk')?.version).toBe('31.0')
    expect(merged.find((s) => s.id === 'magisk-bundled')?.apk.bundled).toBe(true)
    expect(merged.at(-1)?.id).toBe('new-one')
    expect(merged.length).toBe(BUILTIN_CATALOG.schemes.length + 1)
  })
})
