import { describe, expect, it } from 'vitest'
import { parseShizukuProbe } from '../src/main/ops/shizuku'

const DUMP = `Packages:
  Package [moe.shizuku.privileged.api] (3c1f2a1):
    versionCode=1086 minSdk=24 targetSdk=35
    versionName=13.6.0.r1086.2650830c
    requested permissions:
      android.permission.WRITE_SECURE_SETTINGS
      android.permission.INTERNET
    install permissions:
      android.permission.INTERNET: granted=true
    User 0: ceDataInode=1234 installed=true hidden=false suspended=false
      runtime permissions:
        android.permission.WRITE_SECURE_SETTINGS: granted=true, flags=[ USER_SET ]
      disabledComponents:
        moe.shizuku.manager.receiver.BootCompleteReceiver
`

describe('parseShizukuProbe', () => {
  it('未安装', () => expect(parseShizukuProbe('SDK|35\n')).toEqual({ installed: false, running: false, sdk: 35 }))

  it('已安装、未运行，找到 libshizuku.so', () => {
    const out = 'SDK|35\r\nSTARTER|/data/app/~~a==/moe.shizuku.privileged.api-b==/lib/arm64/libshizuku.so\r\nDUMPSYS|\r\n' + DUMP
    expect(parseShizukuProbe(out)).toEqual({
      installed: true,
      version: '13.6.0.r1086.2650830c',
      running: false,
      sdk: 35,
      starter: '/data/app/~~a==/moe.shizuku.privileged.api-b==/lib/arm64/libshizuku.so',
      secureSettings: true,
      bootReceiver: false
    })
  })

  it('正在运行，开机广播没被关', () => {
    const s = parseShizukuProbe('SDK|34\nRUNNING|12345\nSTARTER|/sdcard/Android/data/moe.shizuku.privileged.api/start.sh\nDUMPSYS|\n    versionName=13.6.0\n')
    expect(s.running).toBe(true)
    expect(s.starter).toMatch(/start\.sh$/)
    expect(s.secureSettings).toBe(false)
    expect(s.bootReceiver).toBe(true)
  })

  it('dumpsys 里的 | 不影响解析', () => {
    const s = parseShizukuProbe('SDK|35\nDUMPSYS|\n  RUNNING|1 STARTER|x\n')
    expect(s.running).toBe(false)
    expect(s.starter).toBeUndefined()
  })
})
