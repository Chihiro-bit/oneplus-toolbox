import { describe, expect, it } from 'vitest'
import { parseDrivers } from '../src/main/ops/drivers'

describe('parseDrivers', () => {
  it('正常的设备不给提示，复合设备父节点不显示', () => {
    const out = [
      'USB Composite Device|USB\\VID_22D9&PID_2766\\B8A048D8|OK|USB|0',
      '一加 13|USB\\VID_22D9&PID_2769\\B8A048D8|OK|USBDevice|0',
      'Android Bootloader Interface|USB\\VID_18D1&PID_4EE0\\B8A048D8|OK|AndroidUsbDeviceClass|0'
    ].join('\r\n')
    const list = parseDrivers(out)
    expect(list.map((d) => d.name)).toEqual(['一加 13', 'Android Bootloader Interface'])
    expect(list.every((d) => d.ok && !d.hint)).toBe(true)
  })

  it('没装驱动的 Fastboot 设备', () => {
    const [d] = parseDrivers('Android|USB\\VID_18D1&PID_D00D\\B8A048D8|Error||28')
    expect(d.ok).toBe(false)
    expect(d.problem).toBe('没有安装驱动（代码 28）')
    expect(d.hint).toContain('Google USB')
  })

  it('9008 驱动签名失败', () => {
    const [d] = parseDrivers('Qualcomm HS-USB QDLoader 9008 (COM5)|USB\\VID_05C6&PID_9008\\5&1|Error|Ports|52')
    expect(d.problem).toBe('驱动签名验证失败（代码 52）')
    expect(d.hint).toContain('9008')
  })

  it('有问题的复合设备也要显示', () => {
    expect(parseDrivers('USB Composite Device|USB\\VID_22D9&PID_2766\\X|Error|USB|10')).toHaveLength(1)
  })
})
