import { describe, expect, it } from 'vitest'
import { parseTopmostOutput, topmostScript } from '../src/main/ops/winwindow'

describe('topmostScript', () => {
  it('带上进程号、目标状态和等待时间', () => {
    const script = topmostScript(4321, true, 3000)
    expect(script).toContain('[uint32]4321')
    expect(script).toContain('$want = $true')
    expect(script).toContain('AddMilliseconds(3000)')
    expect(script).toContain('[ToolboxTopmost]::Apply')
    expect(script).toContain('[ToolboxTopmost]::IsTopmost')
  })

  it('取消置顶', () => {
    expect(topmostScript(1, false, 0)).toContain('$want = $false')
  })

  it('C# 放在单引号 here-string 里，不会被 PowerShell 展开', () => {
    const script = topmostScript(1, true, 0)
    expect(script).toContain("Add-Type -TypeDefinition @'")
    expect(script).toContain("\n'@ -Language CSharp")
    expect(script).toContain('SetWindowPos')
  })

  it('进程号取整、等待时间不为负', () => {
    const script = topmostScript(12.7, true, -5)
    expect(script).toContain('[uint32]12')
    expect(script).toContain('AddMilliseconds(0)')
  })
})

describe('parseTopmostOutput', () => {
  it('成功时按实际状态返回', () => {
    expect(parseTopmostOutput('OK True\r\n')).toEqual({ ok: true, topmost: true })
    expect(parseTopmostOutput('OK False\n')).toEqual({ ok: true, topmost: false })
  })

  it('忽略前面的杂项输出，只看最后一行', () => {
    expect(parseTopmostOutput('WARNING: something\n\nOK True\n')).toEqual({ ok: true, topmost: true })
  })

  it('找不到窗口', () => {
    const r = parseTopmostOutput('NOT_FOUND\n')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('没有找到投屏窗口')
  })

  it('SetWindowPos 失败时带上错误码', () => {
    const r = parseTopmostOutput('FAILED 5\n')
    expect(r.ok).toBe(false)
    expect(r.message).toContain('5')
  })

  it('状态没有变化', () => {
    expect(parseTopmostOutput('MISMATCH\n').ok).toBe(false)
  })

  it('没有输出', () => {
    const r = parseTopmostOutput('')
    expect(r.ok).toBe(false)
    expect(r.message).toBeTruthy()
  })
})
