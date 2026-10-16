import { describe, expect, it } from 'vitest'
import { CAPTIVE_CN, parseNetworkState, validDnsHost } from '../src/shared/network'
import { isRooted } from '../src/shared/root'
import { checkArchive, parsePmPath, parseVersion, safeName } from '../src/main/ops/appbackup'
import { installScript, isModuleListing } from '../src/main/ops/modules'

describe('parseNetworkState', () => {
  it('没改过时是系统默认', () => {
    const out = 'captive_portal_https_url=null\ncaptive_portal_http_url=null\nprivate_dns_mode=null\nprivate_dns_specifier=null\n'
    expect(parseNetworkState(out)).toEqual({ captive: 'default', captiveUrl: undefined, dnsMode: 'opportunistic', dnsHost: undefined })
  })
  it('识别国内地址和指定的 DNS 服务器', () => {
    const out = `captive_portal_https_url=${CAPTIVE_CN.captive_portal_https_url}\r\nprivate_dns_mode=hostname\r\nprivate_dns_specifier=dns.alidns.com\r\n`
    expect(parseNetworkState(out)).toMatchObject({ captive: 'cn', dnsMode: 'hostname', dnsHost: 'dns.alidns.com' })
  })
  it('别的工具改过的地址算自定义', () => {
    expect(parseNetworkState('captive_portal_https_url=https://example.com/204\nprivate_dns_mode=off').captive).toBe('custom')
  })
})

describe('validDnsHost', () => {
  it.each(['dns.alidns.com', 'dot.pub', 'one.one.one.one'])('接受 %s', (h) => expect(validDnsHost(h)).toBe(true))
  it.each(['https://dns.google', 'dns.google:853', '1.1.1.1', 'localhost', "a.com'; reboot"])('拒绝 %s', (h) => expect(validDnsHost(h)).toBe(false))
})

describe('isRooted', () => {
  it('区分已 Root 和未 Root', () => {
    expect(isRooted('Magisk 30.7')).toBe(true)
    expect(isRooted('KernelSU 3.3.1')).toBe(true)
    expect(isRooted('未 Root')).toBe(false)
    expect(isRooted('未检测到（装有 Magisk App）')).toBe(false)
    expect(isRooted(undefined)).toBe(false)
  })
})

describe('应用备份', () => {
  it('parsePmPath 取出全部分包', () => {
    const out = 'package:/data/app/~~ab==/com.tencent.mm-cd==/base.apk\npackage:/data/app/~~ab==/com.tencent.mm-cd==/split_config.arm64_v8a.apk\n'
    expect(parsePmPath(out)).toEqual([
      '/data/app/~~ab==/com.tencent.mm-cd==/base.apk',
      '/data/app/~~ab==/com.tencent.mm-cd==/split_config.arm64_v8a.apk'
    ])
  })
  it('parseVersion', () => {
    expect(parseVersion('    versionCode=2860 minSdk=23 targetSdk=34\n    versionName=8.0.50\n')).toEqual({ versionName: '8.0.50', versionCode: '2860' })
  })
  it('safeName 去掉 Windows 不允许的字符', () => {
    expect(safeName('微信: 测试/版')).toBe('微信_测试_版')
    expect(safeName('...')).toBe('app')
  })
  it('checkArchive 只接受该应用目录下的文件', () => {
    expect(checkArchive('com.a/\ncom.a/files/x.db\ncom.a/shared_prefs/p.xml\n', 'com.a')).toBe(true)
    expect(checkArchive('com.a/\ncom.b/files/x\n', 'com.a')).toBe(false)
    expect(checkArchive('com.a/../com.b/x\n', 'com.a')).toBe(false)
    expect(checkArchive('com.ab/x\n', 'com.a')).toBe(false)
    expect(checkArchive('', 'com.a')).toBe(false)
  })
})

describe('Root 模块', () => {
  it('根目录有 module.prop 才算模块', () => {
    const mod = '2024-01-01 00:00:00 .....          123          100  module.prop\r\n2024-01-01 00:00:00 .....          1          1  META-INF/com/google/android/update-binary\r\n'
    expect(isModuleListing(mod)).toBe(true)
    expect(isModuleListing('2024-01-01 00:00:00 .....  1  1  sub/module.prop\n')).toBe(false)
    expect(isModuleListing('2024-01-01 00:00:00 .....  1  1  payload.bin\n')).toBe(false)
  })
  it('按 KernelSU → APatch → Magisk 的顺序找安装命令', () => {
    const s = installScript('/data/local/tmp/oneplus-toolbox/module_0.zip')
    expect(s.indexOf('ksud')).toBeLessThan(s.indexOf('apd'))
    expect(s.indexOf('apd')).toBeLessThan(s.indexOf('magisk'))
  })
})
