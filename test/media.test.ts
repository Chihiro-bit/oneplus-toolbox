import { describe, expect, it } from 'vitest'
import { mirrorArgs, parseStat, remotePath } from '../src/main/ops/media'

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

describe('mirrorArgs', () => {
  const base = { turnScreenOff: false, stayAwake: true }
  it('镜像手机屏幕', () => {
    expect(mirrorArgs({ ...base, turnScreenOff: true }, 'PJZ110')).toEqual(['--window-title', 'PJZ110', '--turn-screen-off', '--stay-awake'])
  })
  it('独立屏幕：指定应用和分辨率，不保持亮屏', () => {
    const args = mirrorArgs({ ...base, display: { app: 'tv.danmaku.bili', size: '1920x1080', keepApp: true, audioOnPhone: true } }, 'PJZ110')
    expect(args).toEqual([
      '--window-title',
      'PJZ110（独立屏幕）',
      '--new-display=1920x1080/240',
      '--display-ime-policy=local',
      '--start-app=tv.danmaku.bili',
      '--no-vd-destroy-content',
      '--no-audio'
    ])
  })
  it('独立屏幕：不指定应用时只开副屏桌面', () => {
    const args = mirrorArgs({ ...base, display: { size: 'auto', keepApp: false, audioOnPhone: false } }, 'x')
    expect(args).toContain('--new-display')
    expect(args.some((a) => a.startsWith('--start-app'))).toBe(false)
  })
  it('拒绝不合法的包名', () => {
    expect(() => mirrorArgs({ ...base, display: { app: 'a; reboot', size: 'auto', keepApp: false, audioOnPhone: false } }, 'x')).toThrow()
  })
})
