param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$packageName = 'AI-Office-Dollhouse-v0.1.0-win-x64'
$packageRoot = [IO.Path]::GetFullPath((Join-Path $releaseRoot $packageName))
$zipPath = [IO.Path]::GetFullPath((Join-Path $releaseRoot "$packageName.zip"))

if (-not $packageRoot.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to package outside the project release directory.'
}

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-relay.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Relay build failed.' }
& npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
& npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw 'Project checks failed.' }
& npm.cmd run test:soak
if ($LASTEXITCODE -ne 0) { throw 'Soak test failed.' }
& npx.cmd neu build --release
if ($LASTEXITCODE -ne 0) { throw 'Neutralino release build failed.' }

if (-not (Test-Path -LiteralPath $releaseRoot)) { New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null }
if (Test-Path -LiteralPath $packageRoot) { Remove-Item -LiteralPath $packageRoot -Recurse -Force }
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'scripts\relay') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'docs') -Force | Out-Null

$distRoot = Join-Path $projectRoot 'dist\ai-office-dollhouse'
Copy-Item -LiteralPath (Join-Path $distRoot 'ai-office-dollhouse-win_x64.exe') -Destination (Join-Path $packageRoot 'AI-Office-Dollhouse.exe')
Copy-Item -LiteralPath (Join-Path $distRoot 'resources.neu') -Destination (Join-Path $packageRoot 'resources.neu')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\discover.ps1') -Destination (Join-Path $packageRoot 'scripts\discover.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\install-integrations.ps1') -Destination (Join-Path $packageRoot 'scripts\install-integrations.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\set-low-priority.ps1') -Destination (Join-Path $packageRoot 'scripts\set-low-priority.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\hook-relay.ps1') -Destination (Join-Path $packageRoot 'scripts\hook-relay.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\relay\AIOfficeHookRelay.exe') -Destination (Join-Path $packageRoot 'scripts\relay\AIOfficeHookRelay.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $packageRoot 'README.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $packageRoot 'LICENSE')
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $packageRoot 'THIRD_PARTY_NOTICES.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'SECURITY.md') -Destination (Join-Path $packageRoot 'SECURITY.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md') -Destination (Join-Path $packageRoot 'AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'DETECTION_AND_DISPLAY_EVIDENCE_20260809.md') -Destination (Join-Path $packageRoot 'DETECTION_AND_DISPLAY_EVIDENCE_20260809.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'GROK_V06_DISPLAY_REVIEW_20260809.md') -Destination (Join-Path $packageRoot 'GROK_V06_DISPLAY_REVIEW_20260809.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\ARCHITECTURE.md') -Destination (Join-Path $packageRoot 'docs\ARCHITECTURE.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\TESTING.md') -Destination (Join-Path $packageRoot 'docs\TESTING.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\PRIVACY.md') -Destination (Join-Path $packageRoot 'docs\PRIVACY.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\INTEGRATIONS.md') -Destination (Join-Path $packageRoot 'docs\INTEGRATIONS.md')

$hashRows = Get-ChildItem -LiteralPath $packageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
    "$($hash.Hash.ToLowerInvariant())  $relative"
}
[IO.File]::WriteAllLines((Join-Path $packageRoot 'SHA256SUMS.txt'), $hashRows, [Text.UTF8Encoding]::new($false))
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

[pscustomobject]@{
    ok = $true
    package = $packageRoot
    zip = $zipPath
    zipBytes = (Get-Item -LiteralPath $zipPath).Length
    sha256 = $zipHash
} | ConvertTo-Json -Compress
