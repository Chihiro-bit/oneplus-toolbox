import { describe, expect, it } from 'vitest'
import { parseStat, remotePath } from '../src/main/ops/media'

describe('remotePath', () => {
  it('规范化', () => {
    expect(remotePath('/sdcard/Download/../DCIM/./Camera/')).toBe('/sdcard/DCIM/Camera')
    expect(remotePath('/sdcard')).toBe('/sdcard')
  })
  it.each(['/data/local/tmp', '/sdcard/../data', '/sdcardx', '/'])('拒绝 %s', (p) => expect(() => remotePath(p)).toThrow())
})

describe('parseStat', () => {
  it('目录在前、按名字排序，修改时间换成毫秒', () => {
    const out = 'regular file|1234|1700000000|/sdcard/b.txt\ndirectory|3452|1700000001|/sdcard/DCIM\ndirectory|3452|1700000002|/sdcard/Alarms\n'
    expect(parseStat(out)).toEqual([
      { name: 'Alarms', dir: true, size: 3452, mtime: 1700000002000 },
      { name: 'DCIM', dir: true, size: 3452, mtime: 1700000001000 },
      { name: 'b.txt', dir: false, size: 1234, mtime: 1700000000000 }
    ])
  })
  it('文件名里有 |', () => expect(parseStat('regular file|1|1|/sdcard/a|b.txt')[0].name).toBe('a|b.txt'))
})
