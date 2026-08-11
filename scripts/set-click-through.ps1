# Toggles WS_EX_TRANSPARENT on the overlay window so clicks land on the application
# underneath instead of being swallowed by the drawing. Windows only skips a window in
# hit testing when this extended style is set: fully transparent pixels pass clicks
# through by themselves, but every pixel the canvas actually paints does not.
# Always prints the window rect in physical pixels so the caller can hit-test the chrome.
param(
  [Parameter(Mandatory = $true)][int]$ProcessId,
  # 1 = pass clicks through, 0 = interactive, -1 = report the rect only.
  [int]$On = -1
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class AIOfficeHitTest {
  public const int GWL_EXSTYLE = -20;
  public const int WS_EX_TRANSPARENT = 0x20;
  [DllImport("user32.dll", SetLastError = true)] public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", SetLastError = true)] public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@

[void][AIOfficeHitTest]::SetProcessDPIAware()

$process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
if (-not $process -or $process.MainWindowHandle -eq [IntPtr]::Zero) {
  Write-Output '{"ok":false,"reason":"no window"}'
  exit 0
}
$handle = $process.MainWindowHandle

if ($On -ge 0) {
  $style = [AIOfficeHitTest]::GetWindowLong($handle, [AIOfficeHitTest]::GWL_EXSTYLE)
  if ($On -eq 1) { $next = $style -bor [AIOfficeHitTest]::WS_EX_TRANSPARENT }
  else { $next = $style -band -bnot [AIOfficeHitTest]::WS_EX_TRANSPARENT }
  if ($next -ne $style) { [void][AIOfficeHitTest]::SetWindowLong($handle, [AIOfficeHitTest]::GWL_EXSTYLE, $next) }
}

$rect = New-Object AIOfficeHitTest+RECT
[void][AIOfficeHitTest]::GetWindowRect($handle, [ref]$rect)
$state = [AIOfficeHitTest]::GetWindowLong($handle, [AIOfficeHitTest]::GWL_EXSTYLE)
$through = ($state -band [AIOfficeHitTest]::WS_EX_TRANSPARENT) -ne 0
Write-Output ('{"ok":true,"clickThrough":' + $through.ToString().ToLower() + ',"left":' + $rect.Left + ',"top":' + $rect.Top + ',"right":' + $rect.Right + ',"bottom":' + $rect.Bottom + '}')
