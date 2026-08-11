param(
    [Parameter(Mandatory = $true)][ValidateSet('codex', 'claude', 'gemini', 'grok')][string]$Provider,
    [Parameter(Mandatory = $false)][string]$SurfaceKind = 'auto'
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try { [Diagnostics.Process]::GetCurrentProcess().PriorityClass = 'BelowNormal' } catch {}

function Write-AiOfficeEmptyResult {
    [Console]::Out.Write('{}')
}

function Get-AiOfficeValue {
    param($Object, [string[]]$Names)
    foreach ($name in $Names) {
        $property = $Object.PSObject.Properties[$name]
        if ($null -ne $property -and $null -ne $property.Value) { return $property.Value }
    }
    return $null
}

function Get-AiOfficeHash {
    param([string]$Value, [int]$Length = 24)
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
        $hash = $sha.ComputeHash($bytes)
        return (-join ($hash | ForEach-Object { $_.ToString('x2') })).Substring(0, $Length)
    }
    finally { $sha.Dispose() }
}

function Get-AiOfficeSubagentStopOutcome {
    param($Payload)
    # A stop hook alone does not prove success. Only forward a terminal event
    # when the structured payload supplies an explicit result; otherwise the
    # UI will degrade the agent to unknown instead of showing a false delivery.
    # An explicit cancellation is neutral even if a provider also includes an
    # error-shaped diagnostic field for that cancellation.
    $status = ([string](Get-AiOfficeValue $Payload @('status', 'outcome', 'result', 'state', 'stop_reason', 'stopReason', 'reason')) -replace '[^A-Za-z0-9]', '').ToLowerInvariant()
    if ($status -in @('cancelled', 'canceled', 'aborted', 'interrupted', 'stopped', 'killed', 'terminated', 'cancel', 'abort', 'interrupt', 'stop', 'kill', 'terminate')) { return 'agent_cancelled' }
    if ($status -in @('success', 'succeeded', 'completed', 'complete', 'finished', 'done', 'ok')) { return 'agent_finished' }
    if ($status -in @('failed', 'failure', 'error', 'errored', 'timeout', 'timedout')) { return 'agent_failed' }

    foreach ($name in @('error', 'error_message', 'errorMessage', 'failure_reason', 'failureReason')) {
        $rawError = Get-AiOfficeValue $Payload @($name)
        if ($null -eq $rawError) { continue }
        if ($rawError -is [bool]) {
            if ($rawError) { return 'agent_failed' }
            continue
        }
        $errorText = ([string]$rawError).Trim()
        if ($errorText -and $errorText -notmatch '^(?i:false|none|null|0)$') { return 'agent_failed' }
    }

    $successText = ([string](Get-AiOfficeValue $Payload @('success', 'succeeded', 'is_success', 'isSuccess'))).Trim().ToLowerInvariant()
    if ($successText -in @('true', '1', 'yes')) { return 'agent_finished' }
    if ($successText -in @('false', '0', 'no')) { return 'agent_failed' }

    $exitCodeRaw = Get-AiOfficeValue $Payload @('exit_code', 'exitCode')
    $exitCode = 0
    if ($null -ne $exitCodeRaw -and [int]::TryParse([string]$exitCodeRaw, [ref]$exitCode)) {
        if ($exitCode -eq 0) { return 'agent_finished' }
        return 'agent_failed'
    }

    return ''
}

function Add-AiOfficeEventLine {
    param([string]$Path, [string]$Line)
    $encoding = [Text.UTF8Encoding]::new($false)
    for ($attempt = 0; $attempt -lt 4; $attempt += 1) {
        $stream = $null
        $writer = $null
        try {
            $stream = [IO.FileStream]::new($Path, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
            $writer = [IO.StreamWriter]::new($stream, $encoding)
            $writer.Write($Line)
            $writer.Flush()
            return $true
        }
        catch [IO.IOException] {
            if ($attempt -eq 3) { return $false }
            Start-Sleep -Milliseconds (15 * ($attempt + 1))
        }
        catch { return $false }
        finally {
            if ($null -ne $writer) { $writer.Dispose() }
            elseif ($null -ne $stream) { $stream.Dispose() }
        }
    }
    return $false
}

try {
    # Grok loads Claude-compatible hooks. The provider guard prevents a Grok event
    # from being recorded as Claude when both integrations are installed.
    if ($Provider -eq 'claude' -and -not [string]::IsNullOrWhiteSpace($env:GROK_HOOK_EVENT)) {
        Write-AiOfficeEmptyResult
        exit 0
    }

    $rawInput = [Console]::In.ReadToEnd()
    if ([string]::IsNullOrWhiteSpace($rawInput) -or $rawInput.Length -gt 1048576) {
        Write-AiOfficeEmptyResult
        exit 0
    }
    $payload = $rawInput | ConvertFrom-Json
    if ($null -eq $payload) {
        Write-AiOfficeEmptyResult
        exit 0
    }

    $hookNameRaw = [string](Get-AiOfficeValue $payload @('hook_event_name', 'hookEventName'))
    if (-not $hookNameRaw) { $hookNameRaw = [string]$env:GROK_HOOK_EVENT }
    $hookKey = ($hookNameRaw -replace '[^A-Za-z0-9]', '').ToLowerInvariant()
    $rawSessionId = [string](Get-AiOfficeValue $payload @('session_id', 'sessionId'))
    if ([string]::IsNullOrWhiteSpace($rawSessionId)) {
        Write-AiOfficeEmptyResult
        exit 0
    }

    $rawAgentId = [string](Get-AiOfficeValue $payload @('agent_id', 'agentId'))
    if (-not $rawAgentId) { $rawAgentId = [string](Get-AiOfficeValue $payload @('agent_name', 'agentName')) }
    $rawTurnId = [string](Get-AiOfficeValue $payload @('turn_id', 'turnId', 'tool_use_id', 'toolUseId'))
    $rawToolName = [string](Get-AiOfficeValue $payload @('tool_name', 'toolName'))
    $rawAgentType = [string](Get-AiOfficeValue $payload @('agent_type', 'agentType', 'agent_name', 'agentName'))
    $rawCwd = [string](Get-AiOfficeValue $payload @('cwd', 'workspaceRoot'))
    $rawTimestamp = Get-AiOfficeValue $payload @('timestamp')
    $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($null -ne $rawTimestamp) {
        try {
            if ($rawTimestamp -is [ValueType] -and [double]$rawTimestamp -gt 100000000000) {
                $timestamp = [int64]$rawTimestamp
            }
            else {
                $timestamp = [DateTimeOffset]::Parse([string]$rawTimestamp).ToUnixTimeMilliseconds()
            }
        } catch {}
    }

    $eventType = switch ($hookKey) {
        'sessionstart' { 'session_started' }
        'userpromptsubmit' { 'turn_started' }
        'beforeagent' { 'turn_started' }
        'stop' { 'turn_completed' }
        'afteragent' { 'turn_completed' }
        'sessionend' { 'session_stopped' }
        'subagentstart' { 'agent_spawned' }
        'subagentstop' { Get-AiOfficeSubagentStopOutcome $payload }
        'pretooluse' { 'tool_started' }
        'beforetool' { 'tool_started' }
        'posttooluse' { 'tool_finished' }
        'aftertool' { 'tool_finished' }
        'permissionrequest' { 'owner_input_required' }
        'notification' {
            $notificationType = [string](Get-AiOfficeValue $payload @('notification_type', 'notificationType'))
            if ($notificationType -match 'permission|elicitation') { 'owner_input_required' } else { '' }
        }
        default { '' }
    }
    if ([string]::IsNullOrWhiteSpace($eventType)) {
        Write-AiOfficeEmptyResult
        exit 0
    }

    $sessionId = Get-AiOfficeHash "$Provider`:$rawSessionId"
    $agentId = if ($rawAgentId) { Get-AiOfficeHash "$Provider`:$rawSessionId`:$rawAgentId" } else { $null }
    $parentAgentId = if ($eventType -eq 'agent_spawned') { "main:$sessionId" } else { $null }
    $safeLabel = if ($rawCwd) { [IO.Path]::GetFileName($rawCwd.TrimEnd('\', '/')) } else { 'Unnamed work' }
    if ([string]::IsNullOrWhiteSpace($safeLabel)) { $safeLabel = 'Unnamed work' }
    if ($safeLabel.Length -gt 42) { $safeLabel = $safeLabel.Substring(0, 39) + '...' }
    $surface = if ($SurfaceKind -eq 'auto') { 'unknown' } else { $SurfaceKind.ToLowerInvariant() }
    $eventId = Get-AiOfficeHash "$Provider|$rawSessionId|$hookKey|$rawAgentId|$rawTurnId|$rawToolName|$timestamp" 32

    $officeEvent = [ordered]@{
        schemaVersion = 1
        eventId = $eventId
        timestamp = $timestamp
        provider = $Provider
        surfaceId = "$Provider`:$surface"
        surfaceKind = $surface
        sessionId = $sessionId
        agentId = $agentId
        parentAgentId = $parentAgentId
        eventType = $eventType
        taskLabel = $safeLabel
        role = if ($rawAgentType) { $rawAgentType.Substring(0, [Math]::Min(24, $rawAgentType.Length)) } else { '' }
        toolName = if ($rawToolName) { $rawToolName.Substring(0, [Math]::Min(30, $rawToolName.Length)) } else { '' }
        observationTier = 'A'
        sourceConfidence = 'structured'
        important = $eventType -in @('owner_input_required', 'session_stopped', 'agent_failed')
    }

    $dataDirectory = if (-not [string]::IsNullOrWhiteSpace($env:AI_OFFICE_DATA_DIR)) {
        $env:AI_OFFICE_DATA_DIR
    }
    else {
        Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'AIOfficeDollhouse'
    }
    if (-not (Test-Path -LiteralPath $dataDirectory)) {
        New-Item -ItemType Directory -Path $dataDirectory -Force | Out-Null
    }
    $eventPath = Join-Path $dataDirectory 'events.ndjson'
    if ((Test-Path -LiteralPath $eventPath) -and (Get-Item -LiteralPath $eventPath).Length -gt 2097152) {
        $archivePath = Join-Path $dataDirectory 'events.1.ndjson'
        Move-Item -LiteralPath $eventPath -Destination $archivePath -Force
    }
    $line = ($officeEvent | ConvertTo-Json -Compress -Depth 8) + [Environment]::NewLine
    [void](Add-AiOfficeEventLine $eventPath $line)
}
catch {
    # Hooks must always fail open and must never expose raw payloads in stderr.
}

Write-AiOfficeEmptyResult
exit 0
