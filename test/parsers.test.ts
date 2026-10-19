import { describe, expect, it } from 'vitest'
import { parseEdlDevices, parseRootProbe } from '../src/main/device'
import { maskReport } from '../src/main/ops/diagnostics'
import { pickSplits } from '../src/main/ops/install'
import { newer } from '../src/main/update'

describe('parseEdlDevices', () => {
  it('解析 QDLoader 端口', () => {
    const out = 'Qualcomm HS-USB QDLoader 9008 (COM5)|USB\\VID_05C6&PID_9008\\5&1\r\n'
    expect(parseEdlDevices(out)).toEqual([{ port: 'COM5', name: 'Qualcomm HS-USB QDLoader 9008 (COM5)' }])
  })
  it('900E 也算，读不到端口时留空', () => {
    expect(parseEdlDevices('Qualcomm HS-USB Diagnostics 900E|X')).toEqual([{ port: '', name: 'Qualcomm HS-USB Diagnostics 900E' }])
  })
  it('不把含 9008 的长数字当成 9008', () => {
    expect(parseEdlDevices('Some Device 190088|X\nUSB Hub|Y')).toEqual([])
  })
})

describe('parseRootProbe', () => {
  it('Magisk', () => expect(parseRootProbe('M|30.7:MAGISK:R\nS|30.7:MAGISKSU\n')).toBe('Magisk 30.7'))
  it('KernelSU', () => expect(parseRootProbe('M|\nS|3.3.1:KernelSU\n')).toBe('KernelSU 3.3.1'))
  it('装了管理器但 Root 没生效', () =>
    expect(parseRootProbe('M|\nS|\npackage:me.bmax.apatch\n')).toBe('未检测到（装有 APatch App）'))
  it('未 Root', () => expect(parseRootProbe('M|\nS|\n')).toBe('未 Root'))
})

describe('newer', () => {
  it.each([
    ['0.2.0', '0.1.0', true],
    ['v0.1.10', '0.1.9', true],
    ['0.1.0', '0.1.0', false],
    ['0.1', '0.1.0', false],
    ['0.1.0', '0.2.0', false]
  ])('%s > %s = %s', (a, b, want) => expect(newer(a, b)).toBe(want))
})

describe('pickSplits', () => {
  const names = ['base.apk', 'split_config.arm64_v8a.apk', 'split_config.armeabi_v7a.apk', 'split_config.zh.apk', 'standalones/x.apk', 'icon.png']
  it('只留首选 ABI', () =>
    expect(pickSplits(names, 'arm64-v8a,armeabi-v7a,armeabi')).toEqual(['base.apk', 'split_config.arm64_v8a.apk', 'split_config.zh.apk']))
  it('首选 ABI 不存在时退到下一个', () =>
    expect(pickSplits(['base.apk', 'split_config.armeabi_v7a.apk'], 'arm64-v8a,armeabi-v7a')).toEqual(['base.apk', 'split_config.armeabi_v7a.apk']))
  it('bundletool 目录输出的分包名', () =>
    expect(
      pickSplits(
        ['splits/base-master.apk', 'splits/base-arm64_v8a.apk', 'splits/base-x86_64.apk', 'splits/base-zh.apk', 'toc.pb'],
        'arm64-v8a,x86_64'
      )
    ).toEqual(['splits/base-master.apk', 'splits/base-arm64_v8a.apk', 'splits/base-zh.apk']))
})

describe('maskReport', () => {
  it('序列号、用户名、主目录打码', () => {
    const out = maskReport('serial b8a048d8 at C:\\Users\\alice\\x by alice', ['b8a048d8'], 'alice', 'C:\\Users\\alice')
    expect(out).toBe('serial b8****d8 at %USERPROFILE%\\x by <user>')
  })
})
