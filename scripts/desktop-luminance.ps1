# Reports the average luminance of the current desktop wallpaper so the sketch
# overlay can pick its ink (dark strokes) or white (light strokes) theme.
# Read-only: touches nothing but the current user's wallpaper settings.
$ErrorActionPreference = 'Stop'

function Get-WallpaperPath {
    $desktop = Get-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name 'WallPaper' -ErrorAction SilentlyContinue
    if ($null -ne $desktop) {
        $path = $desktop.WallPaper
        if (-not [string]::IsNullOrWhiteSpace($path) -and (Test-Path -LiteralPath $path)) { return $path }
    }
    # Themes and slideshows leave the registry value empty and cache the image here instead.
    $transcoded = Join-Path $env:APPDATA 'Microsoft\Windows\Themes\TranscodedWallpaper'
    if (Test-Path -LiteralPath $transcoded) { return $transcoded }
    return $null
}

function Get-LuminanceFromWallpaper {
    $path = Get-WallpaperPath
    if ($null -eq $path) { return $null }

    Add-Type -AssemblyName System.Drawing
    $image = [System.Drawing.Image]::FromFile($path)
    try {
        $size = 16
        $thumb = New-Object System.Drawing.Bitmap $size, $size
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($thumb)
            try {
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.DrawImage($image, 0, 0, $size, $size)
            } finally {
                $graphics.Dispose()
            }
            $total = 0.0
            for ($x = 0; $x -lt $size; $x++) {
                for ($y = 0; $y -lt $size; $y++) {
                    $pixel = $thumb.GetPixel($x, $y)
                    $total += (0.2126 * $pixel.R + 0.7152 * $pixel.G + 0.0722 * $pixel.B) / 255.0
                }
            }
            return $total / ($size * $size)
        } finally {
            $thumb.Dispose()
        }
    } finally {
        $image.Dispose()
    }
}

function Get-LuminanceFromSolidColor {
    $colors = Get-ItemProperty -Path 'HKCU:\Control Panel\Colors' -Name 'Background' -ErrorAction SilentlyContinue
    if ($null -eq $colors) { return $null }
    $parts = @($colors.Background -split '\s+' | Where-Object { $_ -ne '' })
    if ($parts.Count -lt 3) { return $null }
    return (0.2126 * [double]$parts[0] + 0.7152 * [double]$parts[1] + 0.0722 * [double]$parts[2]) / 255.0
}

$luminance = $null
$source = 'none'
try {
    $luminance = Get-LuminanceFromWallpaper
    if ($null -ne $luminance) {
        $source = 'wallpaper'
    } else {
        $luminance = Get-LuminanceFromSolidColor
        if ($null -ne $luminance) { $source = 'solid-color' }
    }
} catch {
    $luminance = $null
    $source = 'probe-failed'
}

if ($null -eq $luminance) {
    ConvertTo-Json ([ordered]@{ ok = $false; reason = $source }) -Compress
} else {
    ConvertTo-Json ([ordered]@{ ok = $true; luminance = [math]::Round([double]$luminance, 4); source = $source }) -Compress
}
