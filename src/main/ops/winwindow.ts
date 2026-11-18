import { powershellPath } from '../device'
import { exec } from '../exec'

/**
 * 设置另一个进程（scrcpy）的窗口是否置顶。
 * scrcpy 只有启动参数 --always-on-top，没有对应的快捷键，也不能在运行时改，
 * 所以这里用 PowerShell 调 SetWindowPos：HWND_TOPMOST / HWND_NOTOPMOST。
 */
export interface TopmostResult {
  ok: boolean
  /** 设置之后窗口实际的置顶状态 */
  topmost?: boolean
  message?: string
}

/** C# 声明 Win32 API；窗口按进程号找，不依赖标题（标题会随手机型号变） */
const CSHARP = String.raw`
using System;
using System.Runtime.InteropServices;

public static class ToolboxTopmost
{
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "GetWindowTextLengthW")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    // 顶层、可见、有标题、没有 owner 的窗口就是 scrcpy 的投屏窗口
    public static IntPtr Find(uint processId)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam)
        {
            uint pid;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == processId && IsWindowVisible(hWnd) && GetWindow(hWnd, 4) == IntPtr.Zero && GetWindowTextLength(hWnd) > 0)
            {
                found = hWnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static bool IsTopmost(IntPtr hWnd)
    {
        return (GetWindowLong(hWnd, -20) & 0x00000008) != 0;
    }

    public static bool Apply(IntPtr hWnd, bool on)
    {
        // HWND_TOPMOST = -1，HWND_NOTOPMOST = -2；SWP_NOMOVE | SWP_NOSIZE = 0x0003
        return SetWindowPos(hWnd, new IntPtr(on ? -1 : -2), 0, 0, 0, 0, 0x0003);
    }
}
`

/**
 * 生成 PowerShell 脚本。最多等待 waitMs 毫秒直到窗口出现（投屏刚启动时窗口晚于进程），
 * 然后用 Add-Type 编译上面的 C#，最后按实际状态回报 OK True / OK False。
 */
export function topmostScript(pid: number, on: boolean, waitMs: number): string {
  return `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
${CSHARP.trim()}
'@ -Language CSharp

$target = [uint32]${Math.trunc(pid)}
$want = $${on ? 'true' : 'false'}
$deadline = [DateTime]::UtcNow.AddMilliseconds(${Math.max(0, Math.trunc(waitMs))})
do {
    $hwnd = [ToolboxTopmost]::Find($target)
    if ($hwnd -ne [IntPtr]::Zero) { break }
    if ([DateTime]::UtcNow -ge $deadline) { break }
    Start-Sleep -Milliseconds 120
} while ($true)

if ($hwnd -eq [IntPtr]::Zero) {
    Write-Output 'NOT_FOUND'
    exit 3
}
if (-not [ToolboxTopmost]::Apply($hwnd, $want)) {
    Write-Output ('FAILED ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error())
    exit 4
}
if ([ToolboxTopmost]::IsTopmost($hwnd) -ne $want) {
    Write-Output 'MISMATCH'
    exit 5
}
Write-Output ('OK ' + [ToolboxTopmost]::IsTopmost($hwnd))
`
}

/** 解析脚本最后一行的结果；PowerShell 偶尔会先在 stdout 打点别的东西 */
export function parseTopmostOutput(out: string): TopmostResult {
  const line = out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .pop() ?? ''
  if (line === 'OK True') return { ok: true, topmost: true }
  if (line === 'OK False') return { ok: true, topmost: false }
  if (line === 'NOT_FOUND') return { ok: false, message: '没有找到投屏窗口，可能还在打开中' }
  if (line === 'MISMATCH') return { ok: false, message: 'Windows 没有接受置顶设置' }
  const failed = line.match(/^FAILED\s+(\d+)$/)
  if (failed) return { ok: false, message: `系统调用失败（错误 ${failed[1]}）` }
  return { ok: false, message: '置顶设置没有返回结果' }
}

/** 把脚本用 -EncodedCommand 交给 Windows PowerShell，避开引号和换行的转义问题 */
export async function setWindowTopmost(pid: number, on: boolean, waitMs = 0): Promise<TopmostResult> {
  const script = topmostScript(pid, on, waitMs)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const r = await exec(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeoutMs: 20_000, echoOutput: false }
    )
    return parseTopmostOutput(r.stdout)
  } catch (e) {
    return { ok: false, message: `调用 PowerShell 失败：${(e as Error).message}` }
  }
}
