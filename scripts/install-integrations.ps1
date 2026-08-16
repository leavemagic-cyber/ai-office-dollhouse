param(
    [Parameter(Mandatory = $true)][ValidateSet('codex', 'claude', 'gemini', 'grok', 'all')][string]$Provider,
    [Parameter(Mandatory = $false)][ValidateSet('status', 'install', 'uninstall')][string]$Action = 'status',
    [Parameter(Mandatory = $false)][string]$ConfigRoot = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$relaySourceExe = Join-Path $PSScriptRoot 'relay\AIOfficeHookRelay.exe'
$relaySourceFallback = Join-Path $PSScriptRoot 'hook-relay.ps1'
$installedRelayPath = ''
$relayUpdateDeferred = $false
# Gemini CLI's hook schema defines timeout in milliseconds. Keep this explicit
# so it is never mistaken for the three-second values used by other providers.
$GeminiHookTimeoutMilliseconds = 5000

function Test-AiOfficeCommand {
    param([string]$Command)
    return ($Command -match [regex]::Escape('AIOfficeHookRelay.exe')) -or ($Command -match [regex]::Escape('hook-relay.ps1'))
}

function Test-AiOfficeSameFile {
    param([string]$Source, [string]$Destination)
    if (-not (Test-Path -LiteralPath $Source -PathType Leaf) -or -not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
        return $false
    }
    $sourceInfo = Get-Item -LiteralPath $Source
    $destinationInfo = Get-Item -LiteralPath $Destination
    if ($sourceInfo.Length -ne $destinationInfo.Length) { return $false }
    $hashFile = {
        param([string]$Path)
        $algorithm = [System.Security.Cryptography.SHA256]::Create()
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace('-', '')
        }
        finally {
            $stream.Dispose()
            $algorithm.Dispose()
        }
    }
    return (& $hashFile $Source) -eq (& $hashFile $Destination)
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
        # A running overlay or hook may keep this executable locked.  If the freshly
        # built relay is byte-identical, retain the live file instead of failing an
        # otherwise harmless hook-config update.
        if (Test-AiOfficeSameFile $relaySourceExe $destination) { return $destination }
        try {
            Copy-Item -LiteralPath $relaySourceExe -Destination $destination -Force
        }
        catch [System.IO.IOException] {
            # A visible overlay can keep the relay executable open.  Its current relay
            # remains usable for the hook merge; report the deferred binary refresh and
            # let the next launch replace it, rather than failing the entire install.
            if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw }
            $script:relayUpdateDeferred = $true
        }
        return $destination
    }
    if (Test-Path -LiteralPath $relaySourceFallback) {
        $destination = Join-Path $dataRoot 'hook-relay.ps1'
        if (Test-AiOfficeSameFile $relaySourceFallback $destination) { return $destination }
        try {
            Copy-Item -LiteralPath $relaySourceFallback -Destination $destination -Force
        }
        catch [System.IO.IOException] {
            if (-not (Test-Path -LiteralPath $destination -PathType Leaf)) { throw }
            $script:relayUpdateDeferred = $true
        }
        return $destination
    }
    throw 'No AI Office event relay is available. Build the project before installing integrations.'
}

function ConvertTo-AiOfficeBashPath {
    param([string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $match = [regex]::Match($fullPath, '^(?<drive>[A-Za-z]):\\(?<tail>.*)$')
    if (-not $match.Success) { throw 'Claude hook relay must use an absolute Windows drive path.' }
    $drive = $match.Groups['drive'].Value.ToLowerInvariant()
    $tail = $match.Groups['tail'].Value.Replace('\', '/')
    return "/$drive/$tail"
}

function Quote-AiOfficeBashArgument {
    param([string]$Value)
    # A single quote inside a POSIX single-quoted argument is represented by closing the
    # quote, writing a double-quoted quote, then reopening it.
    return "'" + $Value.Replace("'", "'`"'`"'") + "'"
}

function Get-AiOfficeHookCommand {
    param([string]$TargetProvider)
    $escapedRelay = $installedRelayPath.Replace('"', '\"')
    if ($installedRelayPath.EndsWith('.exe', [StringComparison]::OrdinalIgnoreCase)) {
        if ($TargetProvider -eq 'claude') {
            # Claude Code for Windows executes hooks through Git Bash. A bare C:\ path
            # loses every backslash there, so use a quoted /c/... path that Bash can run.
            $bashRelay = Quote-AiOfficeBashArgument (ConvertTo-AiOfficeBashPath $installedRelayPath)
            return "$bashRelay $TargetProvider auto"
        }
        # Grok Build's Windows hook runner passes the command through a shell.
        # A leading quoted executable is parsed inconsistently there.  The
        # normal per-user install path contains no spaces, so keep it bare;
        # retain quoting only for custom roots that genuinely need it.
        if ($escapedRelay -notmatch '\s') { return "$escapedRelay $TargetProvider auto" }
        return "`"$escapedRelay`" $TargetProvider auto"
    }
    return "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$escapedRelay`" -Provider $TargetProvider -SurfaceKind auto"
}

function New-AiOfficeJsonList {
    param([object[]]$Values = @())
    # ConvertTo-Json can collapse a single PowerShell pipeline value.  Hook
    # schemas require arrays even when there is only one group or command, so
    # retain them as a concrete collection before serialising the config.
    $list = [System.Collections.ArrayList]::new()
    foreach ($value in @($Values)) { [void]$list.Add($value) }
    Write-Output -NoEnumerate $list
}

function New-AiOfficeHookGroup {
    param([string]$TargetProvider, [int]$Timeout)
    $handler = [pscustomobject]@{
        type = 'command'
        command = Get-AiOfficeHookCommand $TargetProvider
        timeout = $Timeout
    }
    [pscustomobject]@{ hooks = (New-AiOfficeJsonList @($handler)) }
}

function Normalize-AiOfficeHookCollections {
    param($Config)
    if ($null -eq $Config.PSObject.Properties['hooks']) { return }
    foreach ($property in @($Config.hooks.PSObject.Properties)) {
        $groups = New-AiOfficeJsonList @($property.Value)
        foreach ($group in $groups) {
            if ($null -ne $group -and $null -ne $group.PSObject.Properties['hooks']) {
                $group.hooks = New-AiOfficeJsonList @($group.hooks)
            }
        }
        $Config.hooks.($property.Name) = $groups
    }
}

function ConvertTo-AiOfficeJson {
    param($Config)
    Normalize-AiOfficeHookCollections $Config
    # Use -InputObject rather than pipeline input so the root config itself is
    # also serialised as one object.  Provider-specific timeout units are left
    # unchanged here; this merger must not infer or convert their schema.
    ConvertTo-Json -InputObject $Config -Depth 50
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
        $existing = New-AiOfficeJsonList
        $property = $config.hooks.PSObject.Properties[$eventName]
        if ($null -ne $property) { $existing = New-AiOfficeJsonList @($property.Value) }
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
        if (-not $alreadyPresent) { [void]$existing.Add((New-AiOfficeHookGroup $TargetProvider $Timeout)) }
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
    $json = ConvertTo-AiOfficeJson $config
    [IO.File]::WriteAllText($tempPath, $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $Path -Force
}

function Remove-AiOfficeJsonHooks {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return $false }
    $raw = [IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $false }
    $config = $raw | ConvertFrom-Json
    if ($null -eq $config.PSObject.Properties['hooks']) { return $false }
    $changed = $false
    foreach ($property in @($config.hooks.PSObject.Properties)) {
        $existing = New-AiOfficeJsonList @($property.Value)
        $remaining = New-AiOfficeJsonList
        foreach ($group in $existing) {
            $isAiOfficeGroup = $null -ne $group -and (@($group.hooks) | Where-Object {
                Test-AiOfficeCommand ([string]$_.command)
            })
            if (-not $isAiOfficeGroup) { [void]$remaining.Add($group) }
        }
        if ($remaining.Count -eq $existing.Count) { continue }
        $changed = $true
        if ($remaining.Count) { $config.hooks.($property.Name) = $remaining }
        else { $config.hooks.PSObject.Properties.Remove($property.Name) }
    }
    if (-not $changed) { return $false }
    $backup = "$Path.bak_ai_office_uninstall_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
    Copy-Item -LiteralPath $Path -Destination $backup
    $tempPath = "$Path.ai_office_tmp"
    [IO.File]::WriteAllText($tempPath, (ConvertTo-AiOfficeJson $config), [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath $tempPath -Destination $Path -Force
    return $true
}

function Install-AiOfficeProvider {
    param([string]$TargetProvider)
    $userRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) { [Environment]::GetFolderPath('UserProfile') } else { $ConfigRoot }
    switch ($TargetProvider) {
        'codex' {
            # Codex CLI 0.146.0 loads user command hooks from
            # ~/.codex/hooks/hooks.json.  The root hooks.json may exist for other
            # local metadata, but is not the dispatch source on this installed build.
            # Removing this app's group there must never alter unrelated hooks.
            # Codex separately requires the user to trust hook commands.
            $targetPath = Join-Path $userRoot '.codex\hooks\hooks.json'
            $legacyPath = Join-Path $userRoot '.codex\hooks.json'
            Merge-AiOfficeJsonHooks $targetPath 'codex' @('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'PermissionRequest') 3
            # Remove only the AI Office groups from the legacy file. Other hooks remain
            # untouched and the removal routine creates its own backup.
            $legacyMigrated = Remove-AiOfficeJsonHooks $legacyPath
            return [pscustomobject]@{ provider = 'codex'; installed = $true; path = $targetPath; requiresTrust = $true; legacyMigrated = $legacyMigrated; relayUpdateDeferred = $relayUpdateDeferred; note = 'Review and trust this hook once in Codex /hooks.' }
        }
        'claude' {
            $targetPath = Join-Path $userRoot '.claude\settings.json'
            Merge-AiOfficeJsonHooks $targetPath 'claude' @('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'Notification') 3
            return [pscustomobject]@{ provider = 'claude'; installed = $true; path = $targetPath; requiresTrust = $false; note = 'A host guard ignores Grok compatibility loads.' }
        }
        'gemini' {
            $targetPath = Join-Path $userRoot '.gemini\settings.json'
            Merge-AiOfficeJsonHooks $targetPath 'gemini' @('SessionStart', 'BeforeAgent', 'BeforeTool', 'AfterTool', 'AfterAgent', 'SessionEnd') $GeminiHookTimeoutMilliseconds
            return [pscustomobject]@{ provider = 'gemini'; installed = $true; path = $targetPath; requiresTrust = $false; note = 'Observes session and turn events only; tool calls never invent agent population.' }
        }
        'grok' {
            $targetPath = Join-Path $userRoot '.grok\hooks\ai-office-dollhouse.json'
            # Grok's documented default is five seconds. Three seconds loses real
            # SessionStart events during CLI startup before this relay even runs.
            Merge-AiOfficeJsonHooks $targetPath 'grok' @('SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SubagentStart', 'SubagentStop', 'SessionEnd', 'Notification') 5
            return [pscustomobject]@{ provider = 'grok'; installed = $true; path = $targetPath; requiresTrust = $false; note = 'Uses a dedicated global Grok hook file; config.toml is unchanged.' }
        }
    }
}

function Uninstall-AiOfficeProvider {
    param([string]$TargetProvider)
    $userRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) { [Environment]::GetFolderPath('UserProfile') } else { $ConfigRoot }
    $paths = @(switch ($TargetProvider) {
        'codex' { @((Join-Path $userRoot '.codex\hooks\hooks.json'), (Join-Path $userRoot '.codex\hooks.json')) }
        'claude' { @((Join-Path $userRoot '.claude\settings.json')) }
        'gemini' { @((Join-Path $userRoot '.gemini\settings.json')) }
        'grok' { @((Join-Path $userRoot '.grok\hooks\ai-office-dollhouse.json')) }
    })
    $removed = 0
    foreach ($path in $paths) { if (Remove-AiOfficeJsonHooks $path) { $removed += 1 } }
    return [pscustomobject]@{ provider = $TargetProvider; removed = ($removed -gt 0); changedFiles = $removed }
}

function Get-AiOfficeStatus {
    param([string]$TargetProvider)
    $userRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) { [Environment]::GetFolderPath('UserProfile') } else { $ConfigRoot }
    $paths = @(switch ($TargetProvider) {
        'codex' { @((Join-Path $userRoot '.codex\hooks\hooks.json')) }
        'claude' { @((Join-Path $userRoot '.claude\settings.json')) }
        'gemini' { @((Join-Path $userRoot '.gemini\settings.json')) }
        'grok' { @((Join-Path $userRoot '.grok\hooks\ai-office-dollhouse.json')) }
    })
    $activePath = $paths | Where-Object { Test-AiOfficeMarker $_ } | Select-Object -First 1
    $legacyPath = if ($TargetProvider -eq 'codex') { Join-Path $userRoot '.codex\hooks.json' } else { '' }
    [pscustomobject]@{
        provider = $TargetProvider
        installed = [bool]$activePath
        path = if ($activePath) { $activePath } else { $paths[0] }
        legacyDetected = [bool]($legacyPath -and (Test-AiOfficeMarker $legacyPath))
        requiresTrust = ($TargetProvider -eq 'codex')
        relayAvailable = (Test-Path -LiteralPath $relaySourceExe) -or (Test-Path -LiteralPath $relaySourceFallback)
    }
}

try {
    if ($Action -eq 'install') { $installedRelayPath = Install-AiOfficeRelay }
    $targets = if ($Provider -eq 'all') { @('codex', 'claude', 'gemini', 'grok') } else { @($Provider) }
    $results = foreach ($target in $targets) {
        if ($Action -eq 'install') { Install-AiOfficeProvider $target }
        elseif ($Action -eq 'uninstall') { Uninstall-AiOfficeProvider $target }
        else { Get-AiOfficeStatus $target }
    }
    if ($Action -eq 'uninstall' -and $Provider -eq 'all') {
        $relayRoot = if ([string]::IsNullOrWhiteSpace($ConfigRoot)) {
            Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AIOfficeDollhouse\integration'
        } else {
            Join-Path $ConfigRoot '.ai-office-data\integration'
        }
        foreach ($relayName in @('AIOfficeHookRelay.exe', 'hook-relay.ps1')) {
            $relayPath = Join-Path $relayRoot $relayName
            if (Test-Path -LiteralPath $relayPath) { Remove-Item -LiteralPath $relayPath -Force }
        }
        if ((Test-Path -LiteralPath $relayRoot) -and -not (Get-ChildItem -LiteralPath $relayRoot -Force | Select-Object -First 1)) {
            Remove-Item -LiteralPath $relayRoot -Force
        }
    }
    [pscustomobject]@{ ok = $true; action = $Action; results = @($results) } | ConvertTo-Json -Depth 8 -Compress
}
catch {
    [pscustomobject]@{ ok = $false; action = $Action; error = $_.Exception.Message } | ConvertTo-Json -Compress
    exit 1
}
