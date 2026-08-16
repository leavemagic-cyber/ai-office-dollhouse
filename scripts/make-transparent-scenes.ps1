param(
  [string[]]$Scene = @(
    (Join-Path $PSScriptRoot '..\resources\scenes\first-floor-static.png'),
    (Join-Path $PSScriptRoot '..\resources\scenes\execution-floor-static.png')
  )
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function ConvertTo-TransparentLineArt {
  param([Parameter(Mandatory)][string]$Path)

  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $temporary = "$resolved.alpha-tmp.png"
  $sourceImage = [System.Drawing.Image]::FromFile($resolved)
  try {
    $source = [System.Drawing.Bitmap]::new($sourceImage)
    try {
      $output = [System.Drawing.Bitmap]::new($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      try {
        for ($y = 0; $y -lt $source.Height; $y += 1) {
          for ($x = 0; $x -lt $source.Width; $x += 1) {
            $pixel = $source.GetPixel($x, $y)
            # The supplied images use a near-white checkerboard as a fake transparency
            # background.  Keep only genuine grayscale line/shadow information.  A soft
            # ramp preserves anti-aliased edges while making every floor and wall wash
            # fully alpha-transparent rather than merely white.
            $luminance = ($pixel.R * 0.2126) + ($pixel.G * 0.7152) + ($pixel.B * 0.0722)
            $alpha = [Math]::Min(255, [Math]::Max(0, [Math]::Round((242 - $luminance) * 4.25)))
            $output.SetPixel($x, $y, [System.Drawing.Color]::FromArgb([int]$alpha, $pixel.R, $pixel.G, $pixel.B))
          }
        }
        $output.Save($temporary, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $output.Dispose()
      }
    } finally {
      $source.Dispose()
    }
  } finally {
    $sourceImage.Dispose()
  }
  Move-Item -LiteralPath $temporary -Destination $resolved -Force
}

foreach ($path in $Scene) {
  ConvertTo-TransparentLineArt -Path $path
  Write-Output "transparent-line-art=$((Resolve-Path -LiteralPath $path).Path)"
}
