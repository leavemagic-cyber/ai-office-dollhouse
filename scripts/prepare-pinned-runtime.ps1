param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeLockPath = Join-Path $projectRoot 'runtime-lock.json'
if (-not (Test-Path -LiteralPath $runtimeLockPath)) { throw 'Pinned runtime lock file is missing.' }
$runtimeLock = [IO.File]::ReadAllText($runtimeLockPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
if ([int]$runtimeLock.schemaVersion -ne 1) { throw 'Unsupported pinned runtime lock schema.' }

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-Sha256([string]$Path, [string]$Expected, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "$Label is missing: $Path" }
    if ($Expected -notmatch '^[a-f0-9]{64}$') { throw "Invalid pinned SHA-256 for $Label." }
    $actual = Get-Sha256 $Path
    if (-not [String]::Equals($actual, $Expected, [StringComparison]::OrdinalIgnoreCase)) {
        throw "$Label SHA-256 mismatch. Expected $Expected but found $actual."
    }
    return $actual
}

$configPath = Join-Path $projectRoot 'neutralino.config.json'
$config = [IO.File]::ReadAllText($configPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
if ([string]$config.cli.binaryVersion -ne [string]$runtimeLock.neutralino.version) {
    throw 'neutralino.config.json binaryVersion does not match runtime-lock.json.'
}
if ([string]$config.cli.clientVersion -ne [string]$runtimeLock.neutralino.version) {
    throw 'neutralino.config.json clientVersion does not match runtime-lock.json.'
}

foreach ($clientLibrary in @($runtimeLock.neutralino.clientLibraries)) {
    $clientPath = [IO.Path]::GetFullPath((Join-Path $projectRoot ([string]$clientLibrary.path)))
    if (-not $clientPath.StartsWith($projectRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Client library path escapes the project root.'
    }
    Assert-Sha256 $clientPath ([string]$clientLibrary.sha256) ([string]$clientLibrary.path) | Out-Null
}

$binaryName = [string]$runtimeLock.neutralino.binary.path
if ($binaryName -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid Neutralino binary filename.' }
$binRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'bin'))
$targetPath = [IO.Path]::GetFullPath((Join-Path $binRoot $binaryName))
if (-not $targetPath.StartsWith($binRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Neutralino binary path escapes the bin directory.'
}
$expectedBinaryHash = [string]$runtimeLock.neutralino.binary.sha256

if ((Test-Path -LiteralPath $targetPath -PathType Leaf) -and
    [String]::Equals((Get-Sha256 $targetPath), $expectedBinaryHash, [StringComparison]::OrdinalIgnoreCase)) {
    [pscustomobject]@{
        ok = $true
        downloaded = $false
        binary = $targetPath
        sha256 = $expectedBinaryHash
        version = [string]$runtimeLock.neutralino.version
    } | ConvertTo-Json -Compress
    exit 0
}

$archiveUri = [Uri][string]$runtimeLock.neutralino.archive.url
if ($archiveUri.Scheme -ne 'https' -or $archiveUri.Host -ne 'github.com') {
    throw 'Pinned Neutralino archive must use the official GitHub HTTPS host.'
}
$expectedArchiveHash = [string]$runtimeLock.neutralino.archive.sha256
if ($expectedArchiveHash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid pinned Neutralino archive SHA-256.' }

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = [IO.Path]::GetFullPath((Join-Path $tempBase ("ai-office-neutralino-" + [Guid]::NewGuid().ToString('N'))))
if (-not $tempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Temporary runtime directory escapes the system temporary directory.'
}

try {
    New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
    $archivePath = Join-Path $tempRoot 'neutralino.zip'
    $extractRoot = Join-Path $tempRoot 'extract'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $archiveUri.AbsoluteUri -OutFile $archivePath
    Assert-Sha256 $archivePath $expectedArchiveHash 'Pinned Neutralino archive' | Out-Null
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $matches = @(Get-ChildItem -LiteralPath $extractRoot -File -Recurse | Where-Object { $_.Name -eq $binaryName })
    if ($matches.Count -ne 1) { throw 'Pinned Neutralino archive did not contain exactly one expected Windows binary.' }
    Assert-Sha256 $matches[0].FullName $expectedBinaryHash 'Pinned Neutralino Windows binary' | Out-Null
    if (-not (Test-Path -LiteralPath $binRoot)) { New-Item -ItemType Directory -Path $binRoot -Force | Out-Null }
    Copy-Item -LiteralPath $matches[0].FullName -Destination $targetPath -Force
    Assert-Sha256 $targetPath $expectedBinaryHash 'Prepared Neutralino Windows binary' | Out-Null
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

[pscustomobject]@{
    ok = $true
    downloaded = $true
    binary = $targetPath
    sha256 = $expectedBinaryHash
    version = [string]$runtimeLock.neutralino.version
} | ConvertTo-Json -Compress
