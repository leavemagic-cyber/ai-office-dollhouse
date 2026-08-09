param(
    [Parameter(Mandatory = $true)][ValidateSet('codex', 'claude', 'gemini', 'grok', 'all')][string]$Provider,
    [Parameter(Mandatory = $false)][ValidateSet('status', 'install')][string]$Action = 'status',
    [Parameter(Mandatory = $false)][string]$ConfigRoot = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$relaySourceExe = Join-Path $PSScriptRoot 'relay\AIOfficeHookRelay.exe'
$relaySourceFallback = Join-Path $PSScriptRoot 'hook-relay.ps1'
$installedRelayPath = ''

function Test-AiOfficeCommand {
    param([string]$Command)
    return ($Command -match [regex]::Escape('AIOfficeHookRelay.exe')) -or ($Command -match [regex]::Escape('hook-relay.ps1'))
}

function Install-AiOfficeRelay {
    $dataRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) {
        Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AIOfficeDollhouse\integration'
    }
    else {
        Join-Path $ConfigRoot '.ai-office-data\integration'
    }
    if (-not (Test-Path -LiteralPath $dataRoot)) { New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null }
    if (Test-Path -LiteralPath $relaySourceExe) {
        $destination = Join-Path $dataRoot 'AIOfficeHookRelay.exe'
        Copy-Item -LiteralPath $relaySourceExe -Destination $destination -Force
        return $destination
    }
    if (Test-Path -LiteralPath $relaySourceFallback) {
        $destination = Join-Path $dataRoot 'hook-relay.ps1'
        Copy-Item -LiteralPath $relaySourceFallback -Destination $destination -Force
        return $destination
    }
    throw 'No AI Office event relay is available. Build the project before installing integrations.'
}

function Get-AiOfficeHookCommand {
    param([string]$TargetProvider)
    $escapedRelay = $installedRelayPath.Replace('"', '\"')
    if ($installedRelayPath.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
        return "`"$escapedRelay`" $TargetProvider auto"
    }
    return "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$escapedRelay`" -Provider $TargetProvider -SurfaceKind auto"
}

function New-AiOfficeHookGroup {
    param([string]$TargetProvider, [int]$Timeout)
    $handler = [pscustomobject]@{
        type = 'command'
        command = Get-AiOfficeHookCommand $TargetProvider
        timeout = $Timeout
    }
    [pscustomobject]@{ hooks = @($handler) }
}

function Test-AiOfficeMarker {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    return Test-AiOfficeCommand ([IO.File]::ReadAllText($Path))
}

function Merge-AiOfficeJsonHooks {
    param(
        [string]$Path,
        [string]$TargetProvider,
        [string[]]$Events,
        [int]$Timeout
    )
    $directory = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $directory)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
    $config = [pscustomobject]@{}
    if (Test-Path -LiteralPath $Path) {
        $raw = [IO.File]::ReadAllText($Path)
        if (-not [string]::IsNullOrWhiteSpace($raw)) { $config = $raw | ConvertFrom-Json }
    }
    if ($null -eq $config.PSObject.Properties['hooks']) {
        $config | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{})
    }
    foreach ($eventName in $Events) {
        $existing = @()
        $property = $config.hooks.PSObject.Properties[$eventName]
        if ($null -ne $property) { $existing = @($property.Value) }
        $alreadyPresent = $false
        foreach ($group in $existing) {
            foreach ($hook in @($group.hooks)) {
                if (Test-AiOfficeCommand ([string]$hook.command)) {
                    $hook.command = Get-AiOfficeHookCommand $TargetProvider
                    $hook.timeout = $Timeout
                    $alreadyPresent = $true
                }
            }
        }
        if (-not $alreadyPresent) { $existing += New-AiOfficeHookGroup $TargetProvider $Timeout }
        if ($null -eq $property) {
            $config.hooks | Add-Member -NotePropertyName $eventName -NotePropertyValue $existing
        }
        else { $config.hooks.$eventName = $existing }
    }
    if (Test-Path -LiteralPath $Path) {
        $backup = "$Path.bak_ai_office_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item -LiteralPath $Path -Destination $backup
    }
    $tempPath = "$Path.ai_office_tmp"
    $json = $config | ConvertTo-Json -Depth 50
    [IO.File]::WriteAllText($tempPath, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

function Install-AiOfficeProvider {
    param([string]$TargetProvider)
    $userRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) { [Environment]::GetFolderPath('UserProfile') } else { $ConfigRoot }
    switch ($TargetProvider) {
        'codex' {
            $nestedPath = Join-Path $userRoot '.codex\hooks\hooks.json'
            $disabledNested = "$nestedPath.disabled"
            $officialPath = Join-Path $userRoot '.codex\hooks.json'
            $targetPath = if ((Test-Path -LiteralPath $nestedPath) -or (Test-Path -LiteralPath $disabledNested)) { $nestedPath } else { $officialPath }
            Merge-AiOfficeJsonHooks $targetPath 'codex' @('SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'PermissionRequest') 3
            return [pscustomobject]@{ provider = 'codex'; installed = $true; path = $targetPath; requiresTrust = $true; note = 'Review and trust this hook once in Codex /hooks.' }
        }
        'claude' {
            $targetPath = Join-Path $userRoot '.claude\settings.json'
            Merge-AiOfficeJsonHooks $targetPath 'claude' @('SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'Notification') 3
            return [pscustomobject]@{ provider = 'claude'; installed = $true; path = $targetPath; requiresTrust = $false; note = 'A host guard ignores Grok compatibility loads.' }
        }
        'gemini' {
            $targetPath = Join-Path $userRoot '.gemini\settings.json'
            Merge-AiOfficeJsonHooks $targetPath 'gemini' @('SessionStart', 'BeforeAgent', 'AfterAgent', 'SessionEnd') 5000
            return [pscustomobject]@{ provider = 'gemini'; installed = $true; path = $targetPath; requiresTrust = $false; note = 'Observes session and turn events only; tool calls never invent agent population.' }
        }
        'grok' {
            $targetPath = Join-Path $userRoot '.grok\hooks\ai-office-dollhouse.json'
            Merge-AiOfficeJsonHooks $targetPath 'grok' @('SessionStart', 'UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'Notification') 3
            return [pscustomobject]@{ provider = 'grok'; installed = $true; path = $targetPath; requiresTrust = $false; note = 'Uses a dedicated global Grok hook file; config.toml is unchanged.' }
        }
    }
}

function Get-AiOfficeStatus {
    param([string]$TargetProvider)
    $userRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) { [Environment]::GetFolderPath('UserProfile') } else { $ConfigRoot }
    $paths = @(switch ($TargetProvider) {
        'codex' { @((Join-Path $userRoot '.codex\hooks\hooks.json'), (Join-Path $userRoot '.codex\hooks.json')) }
        'claude' { @((Join-Path $userRoot '.claude\settings.json')) }
        'gemini' { @((Join-Path $userRoot '.gemini\settings.json')) }
        'grok' { @((Join-Path $userRoot '.grok\hooks\ai-office-dollhouse.json')) }
    })
    $activePath = $paths | Where-Object { Test-AiOfficeMarker $_ } | Select-Object -First 1
    [pscustomobject]@{
        provider = $TargetProvider
        installed = [bool]$activePath
        path = if ($activePath) { $activePath } else { $paths[0] }
        relayAvailable = (Test-Path -LiteralPath $relaySourceExe) -or (Test-Path -LiteralPath $relaySourceFallback)
    }
}

try {
    if ($Action -eq 'install') { $installedRelayPath = Install-AiOfficeRelay }
    $targets = if ($Provider -eq 'all') { @('codex', 'claude', 'gemini', 'grok') } else { @($Provider) }
    $results = foreach ($target in $targets) {
        if ($Action -eq 'install') { Install-AiOfficeProvider $target } else { Get-AiOfficeStatus $target }
    }
    [pscustomobject]@{ ok = $true; action = $Action; results = @($results) } | ConvertTo-Json -Depth 8 -Compress
}
catch {
    [pscustomobject]@{ ok = $false; action = $Action; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
