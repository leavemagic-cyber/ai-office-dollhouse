# Reports the primary screen in both unit systems the overlay needs.
# Neutralino sizes windows in logical pixels but moves them in physical pixels, so the app
# needs the scale factor to park itself against a screen edge on a scaled display.
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Windows.Forms
    # This process is not DPI aware, so these numbers come back in logical pixels.
    $area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea

    $physicalWidth = 0
    $physicalHeight = 0
    $controllers = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue)
    foreach ($controller in $controllers) {
        if ($controller.CurrentHorizontalResolution -gt $physicalWidth) {
            $physicalWidth = [int]$controller.CurrentHorizontalResolution
            $physicalHeight = [int]$controller.CurrentVerticalResolution
        }
    }
    if ($physicalWidth -le 0) {
        $physicalWidth = [int]$area.Width
        $physicalHeight = [int]$area.Height
    }

    $scale = 1.0
    if ($area.Width -gt 0) { $scale = [math]::Round($physicalWidth / $area.Width, 4) }

    ConvertTo-Json ([ordered]@{
        ok = $true
        left = [int]$area.Left
        top = [int]$area.Top
        width = [int]$area.Width
        height = [int]$area.Height
        physicalWidth = $physicalWidth
        physicalHeight = $physicalHeight
        scale = $scale
    }) -Compress
} catch {
    ConvertTo-Json ([ordered]@{ ok = $false; reason = 'metrics-unavailable' }) -Compress
}
