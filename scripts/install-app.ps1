param(
    [Parameter(Mandatory = $false)][string]$SourceRoot = '',
    [Parameter(Mandatory = $false)][string]$InstallRoot = '',
    [Parameter(Mandatory = $false)][switch]$SkipIntegrations,
    [Parameter(Mandatory = $false)][switch]$Launch
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ([string]::IsNullOrWhiteSpace($SourceRoot)) {
    $candidate = [IO.Path]::GetFullPath($PSScriptRoot)
    $SourceRoot = if (Test-Path -LiteralPath (Join-Path $candidate 'AI-Office-Dollhouse.exe')) {
        $candidate
    } else {
        [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    }
}
$SourceRoot = [IO.Path]::GetFullPath($SourceRoot)
$allowedParent = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'))
$expectedInstallRoot = [IO.Path]::GetFullPath((Join-Path $allowedParent 'AI Office Dollhouse'))
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = $expectedInstallRoot
}
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not [String]::Equals($InstallRoot, $expectedInstallRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "For safety, AI Office Dollhouse installs only to $expectedInstallRoot."
}
if (Test-Path -LiteralPath $InstallRoot) {
    $installRootItem = Get-Item -LiteralPath $InstallRoot
    if (($installRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Refusing to install through a reparse-point application directory.'
    }
}
$sourceExe = Join-Path $SourceRoot 'AI-Office-Dollhouse.exe'
$sourceResources = Join-Path $SourceRoot 'resources.neu'
$sourceNode = Join-Path $SourceRoot 'runtime\node.exe'
$sourceNodeManifest = Join-Path $SourceRoot 'runtime\NODE_RUNTIME_MANIFEST.json'
if (-not (Test-Path -LiteralPath $sourceExe) -or -not (Test-Path -LiteralPath $sourceResources) -or
    -not (Test-Path -LiteralPath $sourceNode) -or -not (Test-Path -LiteralPath $sourceNodeManifest)) {
    throw 'This installer must be run from the extracted Windows release package.'
}
$sourceReleaseFiles = @(Get-ChildItem -LiteralPath $SourceRoot -File -Recurse).Count

$targetExe = Join-Path $InstallRoot 'AI-Office-Dollhouse.exe'
if (Test-Path -LiteralPath $targetExe) {
    $running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        [string]$_.ExecutablePath -eq $targetExe
    })
    if ($running.Count) { throw 'Please close AI Office Dollhouse before updating it.' }
}

if (-not (Test-Path -LiteralPath $InstallRoot)) { New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null }
foreach ($name in @('AI-Office-Dollhouse.exe', 'resources.neu', 'README.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md')) {
    $source = Join-Path $SourceRoot $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $InstallRoot $name) -Force }
}
foreach ($directoryName in @('scripts', 'docs', 'runtime')) {
    $sourceDirectory = Join-Path $SourceRoot $directoryName
    if (-not (Test-Path -LiteralPath $sourceDirectory)) { continue }
    $destinationRoot = [IO.Path]::GetFullPath((Join-Path $InstallRoot $directoryName))
    Get-ChildItem -LiteralPath $sourceDirectory -File -Recurse | ForEach-Object {
        $relative = $_.FullName.Substring($sourceDirectory.Length + 1)
        $destination = [IO.Path]::GetFullPath((Join-Path $destinationRoot $relative))
        if (-not $destination.StartsWith($destinationRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Refusing to copy a file outside the $directoryName directory."
        }
        $destinationDirectory = Split-Path -Parent $destination
        if (-not (Test-Path -LiteralPath $destinationDirectory)) { New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null }
        Copy-Item -LiteralPath $_.FullName -Destination $destination -Force
    }
}
foreach ($installerName in @('Install-AI-Office-Dollhouse.cmd', 'Install-AI-Office-Dollhouse.ps1', 'Uninstall-AI-Office-Dollhouse.cmd', 'Uninstall-AI-Office-Dollhouse.ps1')) {
    $source = Join-Path $SourceRoot $installerName
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination (Join-Path $InstallRoot $installerName) -Force }
}

$integrationScript = Join-Path $InstallRoot 'scripts\install-integrations.ps1'
$integration = $null
if ($SkipIntegrations) {
    # Package/file verification does not need to alter any provider configuration.
    # The Codex read-only observer remains available when all hook integration is
    # deliberately skipped for a local verification run.
    $integration = [pscustomobject]@{
        ok = $true
        skipped = $true
        reason = 'explicit_skip'
        results = @()
        codexObserver = [pscustomobject]@{
            provider = 'codex'
            mode = 'read_only_session_observer'
            automaticHookInstallSkipped = $true
        }
    }
} elseif (Test-Path -LiteralPath $integrationScript) {
    # Install every provider's official user-level integration. Codex itself still
    # requires its normal /hooks review before a non-managed command hook can run;
    # this installer never bypasses or impersonates that review.
    $integrationResults = @()
    foreach ($provider in @('codex', 'claude', 'gemini', 'grok')) {
        $integrationText = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $integrationScript -Provider $provider -Action install
        if ($LASTEXITCODE -ne 0) { throw "Application files were installed, but $provider lifecycle hook integration failed." }
        $providerIntegration = $integrationText | Select-Object -Last 1 | ConvertFrom-Json
        if (-not $providerIntegration.ok) { throw "Application files were installed, but $provider lifecycle hook integration reported failure." }
        foreach ($providerResult in @($providerIntegration.results)) { $integrationResults += $providerResult }
    }
    $codexHook = @($integrationResults | Where-Object { $_.provider -eq 'codex' } | Select-Object -First 1)
    $integration = [pscustomobject]@{
        ok = $true
        results = @($integrationResults)
        codexHook = if ($codexHook.Count) { $codexHook[0] } else { $null }
        codexObserver = [pscustomobject]@{
            provider = 'codex'
            mode = 'read_only_session_observer'
            fallbackWhenHookUntrusted = $true
        }
    }
}

$shell = New-Object -ComObject WScript.Shell
$shortcutLabel = 'AI ' + [char]0x73A9 + [char]0x5076 + [char]0x8FA6 + [char]0x516C + [char]0x5BA4
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$shortcutLabel.lnk"
$startMenuDirectory = Join-Path ([Environment]::GetFolderPath('Programs')) $shortcutLabel
if (-not (Test-Path -LiteralPath $startMenuDirectory)) { New-Item -ItemType Directory -Path $startMenuDirectory -Force | Out-Null }
$startShortcut = Join-Path $startMenuDirectory "$shortcutLabel.lnk"
foreach ($shortcutPath in @($desktopShortcut, $startShortcut)) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $targetExe
    $shortcut.WorkingDirectory = $InstallRoot
    $shortcut.IconLocation = "$targetExe,0"
    $shortcut.Description = 'AI Office Dollhouse - read-only local work animation'
    $shortcut.Save()
}

if ($Launch) { Start-Process -FilePath $targetExe -WorkingDirectory $InstallRoot }

[pscustomobject]@{
    ok = $true
    installRoot = $InstallRoot
    executable = $targetExe
    desktopShortcut = $desktopShortcut
    startShortcut = $startShortcut
    integrations = $integration
    launched = [bool]$Launch
    sourceReleaseFiles = $sourceReleaseFiles
} | ConvertTo-Json -Depth 8 -Compress
