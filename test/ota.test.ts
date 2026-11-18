import { describe, expect, it } from 'vitest'
import { detectOtaRegion, filterOtas, fullOtaTimestamp, matchDeviceOta, otaDownloadPage, parseOtaCatalog } from '../src/shared/ota'

const release = {
  id: '98536222526d4f1c5c929aee',
  device: 'OP 13',
  model: 'PJZ110',
  region: 'CN',
  version: 'PJZ110_16.0.10.501(CN01)',
  ota_version: 'PJZ110_11.C.93_1930_202608031342',
  source_url: 'https://component-ota-cn.allawntech.com/downloadCheck?s=public',
  md5: '1'.repeat(32),
  size: 8975091784
}

const read = (...rows: object[]) => parseOtaCatalog({ api_version: '1', releases: rows }).entries

describe('全量 OTA 目录', () => {
  it('只收录一加的可信 HTTPS 来源，保留目录的实际摘要类型', () => {
    const [first] = read(release,
      { ...release, id: '2'.repeat(22), device: 'OPPO Find X8' },
      { ...release, id: '3'.repeat(22), source_url: 'https://x.allawntech.com.example.org/ota.zip' },
      { ...release, id: '4'.repeat(22), source_url: 'https://user@component-ota-cn.allawntech.com/ota.zip' })
    expect(read(release, { ...release, source_url: 'http://component-ota-cn.allawntech.com/ota.zip' })).toHaveLength(1)
    expect(first).toMatchObject({ id: release.id, device: 'OnePlus 13', md5: release.md5, size: release.size })
    expect(first.sha256).toBeUndefined()
    expect(otaDownloadPage(first)).toBe('https://roms.danielspringer.at/index.php?view=ota&archive_device=Oneplus+13&archive_region=CN')
    const [direct] = read({ ...release, source_url: 'https://gauss.allawnfs.com/files/ota.zip' })
    expect(otaDownloadPage(direct)).toBe(direct.sourceUrl)
  })

  it('识别中英文机型，手动搜索可使用片段，自动匹配要求精确构建号', () => {
    const entries = read(release)
    expect(filterOtas(entries, '一加 13', 'CN', '16.0.10')).toHaveLength(1)
    expect(filterOtas(entries, 'OnePlus 13', 'EU', '')).toHaveLength(0)
    expect(matchDeviceOta(entries, {
      model: 'OnePlus 13', otaModel: 'PJZ110', buildId: release.version, otaVersion: release.ota_version, otaRegion: 'CN'
    })?.id).toBe(release.id)
    expect(matchDeviceOta(entries, { model: 'PJZ110', otaVersion: release.ota_version + '0' })).toBeUndefined()
  })

  it('同构建号出现在多个地区时不猜测', () => {
    const global = { ...release, model: 'CPH2653', version: 'CPH2653_16.0.10.501(EX01)', ota_version: 'CPH2653_11.F.93_2930_202608071055', region: 'GLO' }
    const entries = read(global, { ...global, id: '2'.repeat(22), region: 'EU' })
    expect(detectOtaRegion(global.version, 'EX01', 'CN')).toBeUndefined()
    expect(detectOtaRegion(global.version, 'EEA_all')).toBe('EU')
    expect(detectOtaRegion(release.version, 'CN_all', 'CN')).toBe('CN')
    expect(matchDeviceOta(entries, { model: global.model, otaVersion: global.ota_version })).toBeUndefined()
    expect(matchDeviceOta(entries, { model: global.model, otaVersion: global.ota_version, otaRegion: 'EU' })?.region).toBe('EU')
  })
})

describe('全量 OTA 元数据校验', () => {
  const full = 'ota-type=AB\npost-timestamp=1785725462\npre-device=OP5D0DL1\n'

  it('接受标准 A/B 全量 ZIP 元数据，也兼容 CRLF', () => {
    expect(fullOtaTimestamp(full.replaceAll('\n', '\r\n'))).toBe('1785725462')
  })

  it('拒绝增量、非 A/B 和缺失构建时间的元数据', () => {
    expect(fullOtaTimestamp(full + 'pre-build-incremental=V.123\n')).toBeUndefined()
    expect(fullOtaTimestamp(full + 'pre-build=OnePlus/example\n')).toBeUndefined()
    expect(fullOtaTimestamp(full.replace('ota-type=AB', 'ota-type=BLOCK'))).toBeUndefined()
    expect(fullOtaTimestamp('ota-type=AB\n')).toBeUndefined()
  })
})
