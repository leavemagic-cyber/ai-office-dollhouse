param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeLockPath = Join-Path $projectRoot 'runtime-lock.json'
if (-not (Test-Path -LiteralPath $runtimeLockPath)) { throw 'Pinned runtime lock file is missing.' }
$runtimeLock = [IO.File]::ReadAllText($runtimeLockPath, [Text.UTF8Encoding]::new($false)) | ConvertFrom-Json
if ([int]$runtimeLock.schemaVersion -ne 1) { throw 'Unsupported pinned runtime lock schema.' }

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
    if (-not (Test-Path -LiteralPath $clientPath -PathType Leaf)) { throw "Client library is missing: $clientPath" }
}

$binaryName = [string]$runtimeLock.neutralino.binary.path
if ($binaryName -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid Neutralino binary filename.' }
$binRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'bin'))
$targetPath = [IO.Path]::GetFullPath((Join-Path $binRoot $binaryName))
if (-not $targetPath.StartsWith($binRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Neutralino binary path escapes the bin directory.'
}
if (Test-Path -LiteralPath $targetPath -PathType Leaf) {
    [pscustomobject]@{
        ok = $true
        downloaded = $false
        binary = $targetPath
        bytes = (Get-Item -LiteralPath $targetPath).Length
        version = [string]$runtimeLock.neutralino.version
    } | ConvertTo-Json -Compress
    exit 0
}

$archiveUri = [Uri][string]$runtimeLock.neutralino.archive.url
if ($archiveUri.Scheme -ne 'https' -or $archiveUri.Host -ne 'github.com') {
    throw 'Pinned Neutralino archive must use the official GitHub HTTPS host.'
}
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
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
    $matches = @(Get-ChildItem -LiteralPath $extractRoot -File -Recurse | Where-Object { $_.Name -eq $binaryName })
    if ($matches.Count -ne 1) { throw 'Pinned Neutralino archive did not contain exactly one expected Windows binary.' }
    if ($matches[0].Length -le 0) { throw 'Pinned Neutralino Windows binary is empty.' }
    if (-not (Test-Path -LiteralPath $binRoot)) { New-Item -ItemType Directory -Path $binRoot -Force | Out-Null }
    Copy-Item -LiteralPath $matches[0].FullName -Destination $targetPath -Force
} finally {
    if (Test-Path -LiteralPath $tempRoot) { Remove-Item -LiteralPath $tempRoot -Recurse -Force }
}

[pscustomobject]@{
    ok = $true
    downloaded = $true
    binary = $targetPath
    bytes = (Get-Item -LiteralPath $targetPath).Length
    version = [string]$runtimeLock.neutralino.version
} | ConvertTo-Json -Compress
