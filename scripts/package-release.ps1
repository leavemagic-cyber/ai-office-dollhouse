param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$packageName = 'AI-Office-Dollhouse-v0.2.0-win-x64'
$packageRoot = [IO.Path]::GetFullPath((Join-Path $releaseRoot $packageName))
$zipPath = [IO.Path]::GetFullPath((Join-Path $releaseRoot "$packageName.zip"))
$runtimeLockPath = Join-Path $projectRoot 'runtime-lock.json'
if (-not (Test-Path -LiteralPath $runtimeLockPath)) { throw 'Pinned runtime lock file is missing.' }
$runtimeLock = [IO.File]::ReadAllText($runtimeLockPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
if ([int]$runtimeLock.schemaVersion -ne 1) { throw 'Unsupported pinned runtime lock schema.' }

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Copy-VerifiedPortableNode([string]$DestinationDirectory, $NodeLock) {
    $nodeUri = [Uri][string]$NodeLock.url
    $expectedHash = [string]$NodeLock.sha256
    $expectedBytes = [int64]$NodeLock.bytes
    $licenseUri = [Uri][string]$NodeLock.license.url
    $expectedLicenseHash = [string]$NodeLock.license.sha256
    $expectedLicenseBytes = [int64]$NodeLock.license.bytes
    if ($nodeUri.Scheme -ne 'https' -or $nodeUri.Host -ne 'nodejs.org') {
        throw 'Portable Node runtime must use the official Node.js HTTPS host.'
    }
    if ($licenseUri.Scheme -ne 'https' -or $licenseUri.Host -ne 'raw.githubusercontent.com') {
        throw 'Portable Node license must use the official Node.js GitHub HTTPS host.'
    }
    if ($expectedHash -notmatch '^[a-f0-9]{64}$' -or $expectedBytes -le 0 -or
        $expectedLicenseHash -notmatch '^[a-f0-9]{64}$' -or $expectedLicenseBytes -le 0) {
        throw 'Portable Node runtime lock is invalid.'
    }
    $destinationDirectory = [IO.Path]::GetFullPath($DestinationDirectory)
    if (-not $destinationDirectory.StartsWith($packageRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Portable Node runtime directory escapes the release package.'
    }
    if (-not (Test-Path -LiteralPath $destinationDirectory)) { New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null }
    $targetPath = Join-Path $destinationDirectory 'node.exe'
    $licenseTargetPath = Join-Path $destinationDirectory 'NODE_LICENSE.txt'

    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $tempRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("ai-office-node-" + [Guid]::NewGuid().ToString('N'))))
    if (-not $tempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary Node runtime directory escapes the system temporary directory.'
    }
    try {
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        $downloadPath = Join-Path $tempRoot 'node.exe'
        $licenseDownloadPath = Join-Path $tempRoot 'NODE_LICENSE.txt'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $nodeUri.AbsoluteUri -OutFile $downloadPath
        Invoke-WebRequest -UseBasicParsing -Uri $licenseUri.AbsoluteUri -OutFile $licenseDownloadPath
        if (-not (Test-Path -LiteralPath $downloadPath -PathType Leaf)) { throw 'Portable Node download did not create node.exe.' }
        if (-not (Test-Path -LiteralPath $licenseDownloadPath -PathType Leaf)) { throw 'Portable Node license download did not create NODE_LICENSE.txt.' }
        $actualHash = Get-Sha256 $downloadPath
        $actualBytes = (Get-Item -LiteralPath $downloadPath).Length
        $actualLicenseHash = Get-Sha256 $licenseDownloadPath
        $actualLicenseBytes = (Get-Item -LiteralPath $licenseDownloadPath).Length
        if (-not [String]::Equals($actualHash, $expectedHash, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Portable Node SHA-256 mismatch. Expected $expectedHash but found $actualHash."
        }
        if ($actualBytes -ne $expectedBytes) {
            throw "Portable Node size mismatch. Expected $expectedBytes but found $actualBytes."
        }
        if (-not [String]::Equals($actualLicenseHash, $expectedLicenseHash, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Portable Node license SHA-256 mismatch. Expected $expectedLicenseHash but found $actualLicenseHash."
        }
        if ($actualLicenseBytes -ne $expectedLicenseBytes) {
            throw "Portable Node license size mismatch. Expected $expectedLicenseBytes but found $actualLicenseBytes."
        }
        Copy-Item -LiteralPath $downloadPath -Destination $targetPath -Force
        Copy-Item -LiteralPath $licenseDownloadPath -Destination $licenseTargetPath -Force
    } finally {
        if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
    }

    $finalHash = Get-Sha256 $targetPath
    $finalBytes = (Get-Item -LiteralPath $targetPath).Length
    $finalLicenseHash = Get-Sha256 $licenseTargetPath
    $finalLicenseBytes = (Get-Item -LiteralPath $licenseTargetPath).Length
    if (-not [String]::Equals($finalHash, $expectedHash, [StringComparison]::OrdinalIgnoreCase) -or $finalBytes -ne $expectedBytes -or
        -not [String]::Equals($finalLicenseHash, $expectedLicenseHash, [StringComparison]::OrdinalIgnoreCase) -or $finalLicenseBytes -ne $expectedLicenseBytes) {
        throw 'Copied portable Node runtime verification failed.'
    }
    $manifest = [ordered]@{
        schemaVersion = 1
        runtime = 'Node.js'
        version = [string]$NodeLock.version
        platform = [string]$NodeLock.platform
        sourceUrl = $nodeUri.AbsoluteUri
        sha256 = $finalHash
        bytes = $finalBytes
        licenseFile = 'NODE_LICENSE.txt'
        licenseSourceUrl = $licenseUri.AbsoluteUri
        licenseSha256 = $finalLicenseHash
        licenseBytes = $finalLicenseBytes
        purpose = 'Read-only local existing-work snapshot support'
    } | ConvertTo-Json
    [IO.File]::WriteAllText((Join-Path $destinationDirectory 'NODE_RUNTIME_MANIFEST.json'), $manifest + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
    return [pscustomobject]@{ version = [string]$NodeLock.version; sha256 = $finalHash; bytes = $finalBytes; path = $targetPath }
}

function Assert-ReleaseManifest([string]$PackageDirectory) {
    $packageDirectory = [IO.Path]::GetFullPath($PackageDirectory)
    $manifestPath = Join-Path $packageDirectory 'SHA256SUMS.txt'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Release SHA256SUMS.txt is missing.' }
    $rows = @(Get-Content -LiteralPath $manifestPath)
    if ($rows.Count -eq 0) { throw 'Release SHA256SUMS.txt is empty.' }
    foreach ($row in $rows) {
        $match = [regex]::Match($row, '^(?<hash>[a-f0-9]{64})  (?<relative>.+)$')
        if (-not $match.Success) { throw "Invalid SHA256SUMS.txt row: $row" }
        $relative = $match.Groups['relative'].Value
        if ($relative -match '(^|[\\/])\.\.([\\/]|$)' -or $relative -match '^[\\/]' -or $relative -match '^[A-Za-z]:') {
            throw "Release manifest path escapes its package: $relative"
        }
        $filePath = [IO.Path]::GetFullPath((Join-Path $packageDirectory ($relative.Replace('/', '\\'))))
        if (-not $filePath.StartsWith($packageDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Release manifest path escapes its package: $relative"
        }
        if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "Release manifest file is missing: $relative" }
        $actualHash = Get-Sha256 $filePath
        if (-not [String]::Equals($actualHash, $match.Groups['hash'].Value, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Release manifest hash mismatch: $relative"
        }
    }
    return $rows.Count
}

function Assert-ReleaseZip([string]$ZipFile, [string]$ExpectedPackageName) {
    $tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    $tempRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("ai-office-release-verify-" + [Guid]::NewGuid().ToString('N'))))
    if (-not $tempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Temporary release verification directory escapes the system temporary directory.'
    }
    try {
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        Expand-Archive -LiteralPath $ZipFile -DestinationPath $tempRoot -Force
        $expandedPackage = Join-Path $tempRoot $ExpectedPackageName
        if (-not (Test-Path -LiteralPath $expandedPackage -PathType Container)) {
            throw 'Release ZIP does not contain the expected top-level package directory.'
        }
        return Assert-ReleaseManifest $expandedPackage
    } finally {
        if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
    }
}

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
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'prepare-pinned-runtime.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Pinned Neutralino runtime preparation failed.' }
& npm.cmd run build
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
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\desktop-luminance.ps1') -Destination (Join-Path $packageRoot 'scripts\desktop-luminance.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\screen-metrics.ps1') -Destination (Join-Path $packageRoot 'scripts\screen-metrics.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\set-click-through.ps1') -Destination (Join-Path $packageRoot 'scripts\set-click-through.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\snapshot-work.mjs') -Destination (Join-Path $packageRoot 'scripts\snapshot-work.mjs')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\hook-relay.ps1') -Destination (Join-Path $packageRoot 'scripts\hook-relay.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\relay\AIOfficeHookRelay.exe') -Destination (Join-Path $packageRoot 'scripts\relay\AIOfficeHookRelay.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\install-app.ps1') -Destination (Join-Path $packageRoot 'Install-AI-Office-Dollhouse.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\uninstall-app.ps1') -Destination (Join-Path $packageRoot 'Uninstall-AI-Office-Dollhouse.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\Install-AI-Office-Dollhouse.cmd') -Destination (Join-Path $packageRoot 'Install-AI-Office-Dollhouse.cmd')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\Uninstall-AI-Office-Dollhouse.cmd') -Destination (Join-Path $packageRoot 'Uninstall-AI-Office-Dollhouse.cmd')
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $packageRoot 'README.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $packageRoot 'LICENSE')
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $packageRoot 'THIRD_PARTY_NOTICES.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'SECURITY.md') -Destination (Join-Path $packageRoot 'SECURITY.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md') -Destination (Join-Path $packageRoot 'AI_OFFICE_DOLLHOUSE_DESIGN_SPEC.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md') -Destination (Join-Path $packageRoot 'AI_OFFICE_DOLLHOUSE_V2_OWNER_GOAL_PLAN.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'DETECTION_AND_DISPLAY_EVIDENCE_20260809.md') -Destination (Join-Path $packageRoot 'DETECTION_AND_DISPLAY_EVIDENCE_20260809.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'GROK_V06_DISPLAY_REVIEW_20260809.md') -Destination (Join-Path $packageRoot 'GROK_V06_DISPLAY_REVIEW_20260809.md')
foreach ($reviewName in @(
    'GROK_STAGE1_COMPACT_TOWER_REVIEW_20260809.md',
    'GROK_STAGE2_2_5D_REVIEW_20260809.md',
    'GROK_STAGE3_MULTI_TASK_CHOREOGRAPHY_REVIEW_20260809.md',
    'GROK_STAGE4_RESOURCE_INSTALL_REVIEW_20260809.md',
    'GROK_STAGE5_OWNER_VISUAL_CORRECTION_REVIEW_20260809.md',
    'GROK_STAGE5_PER_FLOOR_VISUAL_IP_REVIEW_20260809.md'
)) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $reviewName) -Destination (Join-Path $packageRoot $reviewName)
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\ARCHITECTURE.md') -Destination (Join-Path $packageRoot 'docs\ARCHITECTURE.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\TESTING.md') -Destination (Join-Path $packageRoot 'docs\TESTING.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\PRIVACY.md') -Destination (Join-Path $packageRoot 'docs\PRIVACY.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\INTEGRATIONS.md') -Destination (Join-Path $packageRoot 'docs\INTEGRATIONS.md')
$portableNode = Copy-VerifiedPortableNode (Join-Path $packageRoot 'runtime') $runtimeLock.portableNode

$hashRows = Get-ChildItem -LiteralPath $packageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    $hash = Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256
    $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
    "$($hash.Hash.ToLowerInvariant())  $relative"
}
[IO.File]::WriteAllLines((Join-Path $packageRoot 'SHA256SUMS.txt'), $hashRows, [Text.UTF8Encoding]::new($false))
$manifestFiles = Assert-ReleaseManifest $packageRoot
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipManifestFiles = Assert-ReleaseZip $zipPath $packageName
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()

[pscustomobject]@{
    ok = $true
    package = $packageRoot
    zip = $zipPath
    zipBytes = (Get-Item -LiteralPath $zipPath).Length
    sha256 = $zipHash
    manifestFiles = $manifestFiles
    zipManifestFiles = $zipManifestFiles
    portableNode = $portableNode
} | ConvertTo-Json -Compress
