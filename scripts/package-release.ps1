param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'release'))
$packageJsonPath = Join-Path $projectRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageJsonPath)) { throw 'package.json is missing.' }
$packageVersion = [string](([IO.File]::ReadAllText($packageJsonPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json).version)
if ($packageVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'package.json version must be a plain semantic version.' }
$packageName = "AI-Office-Dollhouse-v$packageVersion-win-x64"
$packageRoot = [IO.Path]::GetFullPath((Join-Path $releaseRoot $packageName))
$zipPath = [IO.Path]::GetFullPath((Join-Path $releaseRoot "$packageName.zip"))
$runtimeLockPath = Join-Path $projectRoot 'runtime-lock.json'
if (-not (Test-Path -LiteralPath $runtimeLockPath)) { throw 'Pinned runtime lock file is missing.' }
$runtimeLock = [IO.File]::ReadAllText($runtimeLockPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
if ([int]$runtimeLock.schemaVersion -ne 1) { throw 'Unsupported pinned runtime lock schema.' }

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead([IO.Path]::GetFullPath($Path))
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
        $sha.Dispose()
        $stream.Dispose()
    }
}

function Remove-ProjectGeneratedDirectory([string]$Name) {
    # A local package build may safely recreate compiler outputs, but it must never
    # erase prior release ZIPs, archives, or an operator's visual-test material.
    # The current package root and ZIP are replaced explicitly below after their paths
    # have been resolved and checked.
    $allowed = @('.tmp', 'bin', 'dist')
    if ($Name -notin $allowed) { throw "Generated directory is not allowlisted: $Name" }
    $target = [IO.Path]::GetFullPath((Join-Path $projectRoot $Name))
    if (-not $target.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Generated directory escapes the project: $target"
    }
    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
}

function Copy-PortableNode([string]$DestinationDirectory, $NodeLock) {
    $nodeUri = [Uri][string]$NodeLock.url
    $expectedBytes = [int64]$NodeLock.bytes
    $licenseUri = [Uri][string]$NodeLock.license.url
    $expectedLicenseBytes = [int64]$NodeLock.license.bytes
    if ($nodeUri.Scheme -ne 'https' -or $nodeUri.Host -ne 'nodejs.org') {
        throw 'Portable Node runtime must use the official Node.js HTTPS host.'
    }
    if ($licenseUri.Scheme -ne 'https' -or $licenseUri.Host -ne 'raw.githubusercontent.com') {
        throw 'Portable Node license must use the official Node.js GitHub HTTPS host.'
    }
    if ($expectedBytes -le 0 -or $expectedLicenseBytes -le 0) {
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
        $actualBytes = (Get-Item -LiteralPath $downloadPath).Length
        $actualLicenseBytes = (Get-Item -LiteralPath $licenseDownloadPath).Length
        if ($actualBytes -ne $expectedBytes) {
            throw "Portable Node size mismatch. Expected $expectedBytes but found $actualBytes."
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
    if ($finalBytes -ne $expectedBytes -or $finalLicenseBytes -ne $expectedLicenseBytes) {
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
        foreach ($required in @('AI-Office-Dollhouse.exe', 'resources.neu', 'Install-AI-Office-Dollhouse.ps1')) {
            if (-not (Test-Path -LiteralPath (Join-Path $expandedPackage $required) -PathType Leaf)) {
                throw "Release ZIP is missing required file: $required"
            }
        }
        return @(Get-ChildItem -LiteralPath $expandedPackage -File -Recurse).Count
    } finally {
        if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
    }
}

if (-not $packageRoot.StartsWith($releaseRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to package outside the project release directory.'
}

foreach ($generatedDirectory in @('.tmp', 'bin', 'dist')) {
    Remove-ProjectGeneratedDirectory $generatedDirectory
}

& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-relay.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Relay build failed.' }
& powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-click-through.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Click-through guard build failed.' }
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
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'scripts\click-through') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'docs') -Force | Out-Null

$distRoot = Join-Path $projectRoot 'dist\ai-office-dollhouse'
Copy-Item -LiteralPath (Join-Path $distRoot 'ai-office-dollhouse-win_x64.exe') -Destination (Join-Path $packageRoot 'AI-Office-Dollhouse.exe')
Copy-Item -LiteralPath (Join-Path $distRoot 'resources.neu') -Destination (Join-Path $packageRoot 'resources.neu')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\discover.ps1') -Destination (Join-Path $packageRoot 'scripts\discover.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\install-integrations.ps1') -Destination (Join-Path $packageRoot 'scripts\install-integrations.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\set-low-priority.ps1') -Destination (Join-Path $packageRoot 'scripts\set-low-priority.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\desktop-luminance.ps1') -Destination (Join-Path $packageRoot 'scripts\desktop-luminance.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\screen-metrics.ps1') -Destination (Join-Path $packageRoot 'scripts\screen-metrics.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\snapshot-work.mjs') -Destination (Join-Path $packageRoot 'scripts\snapshot-work.mjs')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\observe-codex-sessions.mjs') -Destination (Join-Path $packageRoot 'scripts\observe-codex-sessions.mjs')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\hook-relay.ps1') -Destination (Join-Path $packageRoot 'scripts\hook-relay.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\relay\AIOfficeHookRelay.exe') -Destination (Join-Path $packageRoot 'scripts\relay\AIOfficeHookRelay.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\click-through\AIOfficeClickThrough.exe') -Destination (Join-Path $packageRoot 'scripts\click-through\AIOfficeClickThrough.exe')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\install-app.ps1') -Destination (Join-Path $packageRoot 'Install-AI-Office-Dollhouse.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\uninstall-app.ps1') -Destination (Join-Path $packageRoot 'Uninstall-AI-Office-Dollhouse.ps1')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\Install-AI-Office-Dollhouse.cmd') -Destination (Join-Path $packageRoot 'Install-AI-Office-Dollhouse.cmd')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts\Uninstall-AI-Office-Dollhouse.cmd') -Destination (Join-Path $packageRoot 'Uninstall-AI-Office-Dollhouse.cmd')
Copy-Item -LiteralPath (Join-Path $projectRoot 'README.md') -Destination (Join-Path $packageRoot 'README.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'CHANGELOG.md') -Destination (Join-Path $packageRoot 'CHANGELOG.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'LICENSE') -Destination (Join-Path $packageRoot 'LICENSE')
Copy-Item -LiteralPath (Join-Path $projectRoot 'THIRD_PARTY_NOTICES.md') -Destination (Join-Path $packageRoot 'THIRD_PARTY_NOTICES.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'SECURITY.md') -Destination (Join-Path $packageRoot 'SECURITY.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\ARCHITECTURE.md') -Destination (Join-Path $packageRoot 'docs\ARCHITECTURE.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\TESTING.md') -Destination (Join-Path $packageRoot 'docs\TESTING.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\PRIVACY.md') -Destination (Join-Path $packageRoot 'docs\PRIVACY.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\INTEGRATIONS.md') -Destination (Join-Path $packageRoot 'docs\INTEGRATIONS.md')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs\RELEASE_CHECKLIST.md') -Destination (Join-Path $packageRoot 'docs\RELEASE_CHECKLIST.md')
$portableNode = Copy-PortableNode (Join-Path $packageRoot 'runtime') $runtimeLock.portableNode

$hashRows = Get-ChildItem -LiteralPath $packageRoot -File -Recurse | Sort-Object FullName | ForEach-Object {
    $hash = Get-Sha256 $_.FullName
    $relative = $_.FullName.Substring($packageRoot.Length + 1).Replace('\', '/')
    "$hash  $relative"
}
[IO.File]::WriteAllLines((Join-Path $packageRoot 'SHA256SUMS.txt'), $hashRows, [Text.UTF8Encoding]::new($false))
$manifestFiles = $hashRows.Count
Compress-Archive -LiteralPath $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal
$zipManifestFiles = Assert-ReleaseZip $zipPath $packageName
$zipHash = Get-Sha256 $zipPath

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
