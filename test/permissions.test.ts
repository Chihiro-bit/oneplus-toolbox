import { describe, expect, it } from 'vitest'
import { isGrantable, parsePackagePermissions } from '../src/shared/permissions'

const DUMP = `Packages:
  Package [net.dinglisch.android.taskerm] (a1b2c3):
    versionName=6.5.11
    requested permissions:
      android.permission.WRITE_SECURE_SETTINGS
      android.permission.READ_LOGS
      android.permission.READ_SMS: restricted=true
      android.permission.INTERNET
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=1 installed=true
      runtime permissions:
        android.permission.WRITE_SECURE_SETTINGS: granted=true, flags=[ USER_SET ]
        android.permission.READ_LOGS: granted=false, flags=[ USER_SET ]
`

describe('parsePackagePermissions', () => {
  it('申请的权限和已授予的权限', () => {
    const { requested, granted } = parsePackagePermissions(DUMP)
    expect(requested).toEqual([
      'android.permission.WRITE_SECURE_SETTINGS',
      'android.permission.READ_LOGS',
      'android.permission.READ_SMS',
      'android.permission.INTERNET'
    ])
    expect([...granted].sort()).toEqual(['android.permission.INTERNET', 'android.permission.WRITE_SECURE_SETTINGS'])
  })

  it('只看用户 0（一加 13 实测：其它用户另起一行带 userId）', () => {
    const dump = [
      '    install permissions:',
      '      android.permission.WRITE_SECURE_SETTINGS: granted=false',
      '      android.permission.WRITE_SECURE_SETTINGS: granted=true, userId=10',
      '      android.permission.DUMP: granted=true',
      '      android.permission.DUMP: granted=false, userId=999'
    ].join('\n')
    expect([...parsePackagePermissions(dump).granted]).toEqual(['android.permission.DUMP'])
  })

  it('只认 development 权限', () => {
    expect(isGrantable('android.permission.WRITE_SECURE_SETTINGS')).toBe(true)
    expect(isGrantable('android.permission.READ_SMS')).toBe(false)
    expect(isGrantable('toString')).toBe(false)
  })
})
