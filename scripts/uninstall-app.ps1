param(
    [Parameter(Mandatory = $false)][string]$InstallRoot = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$allowedParent = [IO.Path]::GetFullPath((Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Programs'))
$expectedInstallRoot = [IO.Path]::GetFullPath((Join-Path $allowedParent 'AI Office Dollhouse'))
if ([string]::IsNullOrWhiteSpace($InstallRoot)) { $InstallRoot = $expectedInstallRoot }
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if (-not [String]::Equals($InstallRoot, $expectedInstallRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to uninstall an unexpected directory.'
}
if (Test-Path -LiteralPath $InstallRoot) {
    $installRootItem = Get-Item -LiteralPath $InstallRoot
    if (($installRootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'Refusing to uninstall through a reparse-point application directory.'
    }
}

function Test-OwnedShortcut($Shell, [string]$ShortcutPath, [string]$ExpectedTarget) {
    if (-not (Test-Path -LiteralPath $ShortcutPath -PathType Leaf)) { return $false }
    try {
        $targetPath = [string]$Shell.CreateShortcut($ShortcutPath).TargetPath
        if ([string]::IsNullOrWhiteSpace($targetPath)) { return $false }
        $targetPath = [IO.Path]::GetFullPath($targetPath)
        return [String]::Equals($targetPath, $ExpectedTarget, [StringComparison]::OrdinalIgnoreCase)
    } catch {
        return $false
    }
}

$targetExe = Join-Path $InstallRoot 'AI-Office-Dollhouse.exe'
$running = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    [string]$_.ExecutablePath -eq $targetExe
})
if ($running.Count) { throw 'Please close AI Office Dollhouse before uninstalling it.' }

$integrationScript = Join-Path $InstallRoot 'scripts\install-integrations.ps1'
$integrationsRemoved = $false
if (Test-Path -LiteralPath $integrationScript) {
    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $integrationScript -Provider all -Action uninstall | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Lifecycle hook removal failed; application files were left in place.' }
    $integrationsRemoved = $true
}
$shortcutLabel = 'AI ' + [char]0x73A9 + [char]0x5076 + [char]0x8FA6 + [char]0x516C + [char]0x5BA4
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) "$shortcutLabel.lnk"
$startMenuDirectory = Join-Path ([Environment]::GetFolderPath('Programs')) $shortcutLabel
$startShortcut = Join-Path $startMenuDirectory "$shortcutLabel.lnk"
$shell = New-Object -ComObject WScript.Shell
$desktopShortcutRemoved = $false
$startShortcutRemoved = $false
$startMenuDirectoryRemoved = $false
if (Test-OwnedShortcut $shell $desktopShortcut $targetExe) {
    Remove-Item -LiteralPath $desktopShortcut -Force
    $desktopShortcutRemoved = $true
}
if (Test-OwnedShortcut $shell $startShortcut $targetExe) {
    Remove-Item -LiteralPath $startShortcut -Force
    $startShortcutRemoved = $true
}
if (Test-Path -LiteralPath $startMenuDirectory -PathType Container) {
    $remainingStartMenuItems = @(Get-ChildItem -LiteralPath $startMenuDirectory -Force)
    if ($remainingStartMenuItems.Count -eq 0) {
        Remove-Item -LiteralPath $startMenuDirectory -Force
        $startMenuDirectoryRemoved = $true
    }
}
if (Test-Path -LiteralPath $InstallRoot) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }

$preservedDataDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AIOfficeDollhouse'

[pscustomobject]@{
    ok = $true
    removed = $InstallRoot
    integrationsRemoved = $integrationsRemoved
    desktopShortcutRemoved = $desktopShortcutRemoved
    startShortcutRemoved = $startShortcutRemoved
    startMenuDirectoryRemoved = $startMenuDirectoryRemoved
    preservedDataDirectory = $preservedDataDirectory
} | ConvertTo-Json -Compress
