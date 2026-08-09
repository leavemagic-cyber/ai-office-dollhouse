param()

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Get-AiOfficeCommandInfo {
    param([Parameter(Mandatory = $true)][string]$Name)
    $resolved = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $resolved) {
        return [pscustomobject]@{ installed = $false; executableName = ''; version = '' }
    }
    $source = [string]$resolved.Source
    $version = ''
    if ($source -and (Test-Path -LiteralPath $source)) {
        $version = [string](Get-Item -LiteralPath $source -ErrorAction SilentlyContinue).VersionInfo.FileVersion
    }
    [pscustomobject]@{
        installed = $true
        executableName = if ($source) { [IO.Path]::GetFileName($source) } else { $Name }
        version = $version
    }
}

function Get-AiOfficePackage {
    param([Parameter(Mandatory = $true)][string]$Name)
    $package = Get-AppxPackage -Name $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $package) {
        return [pscustomobject]@{ installed = $false; version = '' }
    }
    [pscustomobject]@{ installed = $true; version = [string]$package.Version }
}

$aiOfficeProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -in @('ChatGPT.exe', 'codex.exe', 'Claude.exe', 'claude.exe', 'grok.exe')
})
$aiOfficeProcessById = @{}
foreach ($row in $aiOfficeProcesses) { $aiOfficeProcessById[[int]$row.ProcessId] = $row }

function Test-AiOfficeAncestorName {
    param(
        [Parameter(Mandatory = $true)]$Process,
        [Parameter(Mandatory = $true)][string]$ExpectedName
    )
    $current = $Process
    for ($depth = 0; $depth -lt 6 -and $null -ne $current; $depth++) {
        if ([string]$current.Name -ieq $ExpectedName) { return $true }
        $parentId = [int]$current.ParentProcessId
        if (-not $aiOfficeProcessById.ContainsKey($parentId)) { break }
        $current = $aiOfficeProcessById[$parentId]
    }
    return $false
}

$codexPackage = Get-AiOfficePackage -Name 'OpenAI.Codex'
$claudePackage = Get-AiOfficePackage -Name 'Claude'
$codexCommand = Get-AiOfficeCommandInfo -Name 'codex'
$claudeCommand = Get-AiOfficeCommandInfo -Name 'claude'
$geminiCommand = Get-AiOfficeCommandInfo -Name 'gemini'
$grokCommand = Get-AiOfficeCommandInfo -Name 'grok'
$agyCommand = Get-AiOfficeCommandInfo -Name 'agy'

$chatGptProcesses = @($aiOfficeProcesses | Where-Object { $_.Name -ieq 'ChatGPT.exe' })
$codexNativeProcesses = @($aiOfficeProcesses | Where-Object { $_.Name -ieq 'codex.exe' })
$codexCliProcesses = @($codexNativeProcesses | Where-Object { -not (Test-AiOfficeAncestorName -Process $_ -ExpectedName 'ChatGPT.exe') })
$claudeDesktopProcesses = @($aiOfficeProcesses | Where-Object {
    $_.Name -ieq 'Claude.exe' -and ([string]$_.ExecutablePath -match 'WindowsApps|Claude')
})
$claudeCliProcesses = @($aiOfficeProcesses | Where-Object {
    $_.Name -ieq 'claude.exe' -and -not ([string]$_.ExecutablePath -match 'WindowsApps')
})
$grokProcesses = @($aiOfficeProcesses | Where-Object { $_.Name -ieq 'grok.exe' })

$surfaces = @(
    [pscustomobject]@{
        provider = 'codex'; surfaceId = 'codex:app'; surfaceKind = 'app'
        installed = [bool]$codexPackage.installed; appOpen = ($chatGptProcesses.Count -gt 0)
        processState = if ($chatGptProcesses.Count -gt 0) { 'open' } else { 'closed' }
        version = [string]$codexPackage.version; executableName = 'ChatGPT.exe'
        observationTier = 'D'; presenceConfidence = if ($chatGptProcesses.Count -gt 0 -and $codexPackage.installed) { 'high' } else { 'unknown' }
    },
    [pscustomobject]@{
        provider = 'codex'; surfaceId = 'codex:cli'; surfaceKind = 'cli'
        installed = [bool]$codexCommand.installed; appOpen = ($codexCliProcesses.Count -gt 0)
        processState = if ($codexCliProcesses.Count -gt 0) { 'open' } else { 'closed' }
        version = [string]$codexCommand.version; executableName = [string]$codexCommand.executableName
        observationTier = 'D'; presenceConfidence = if ($codexCliProcesses.Count -gt 0) { 'medium' } else { 'unknown' }
    },
    [pscustomobject]@{
        provider = 'claude'; surfaceId = 'claude:desktop'; surfaceKind = 'desktop'
        installed = [bool]$claudePackage.installed; appOpen = ($claudeDesktopProcesses.Count -gt 0)
        processState = if ($claudeDesktopProcesses.Count -gt 0) { 'open' } else { 'closed' }
        version = [string]$claudePackage.version; executableName = 'Claude.exe'
        observationTier = 'D'; presenceConfidence = if ($claudeDesktopProcesses.Count -gt 0 -and $claudePackage.installed) { 'high' } else { 'unknown' }
    },
    [pscustomobject]@{
        provider = 'claude'; surfaceId = 'claude:cli'; surfaceKind = 'cli'
        installed = [bool]$claudeCommand.installed; appOpen = ($claudeCliProcesses.Count -gt 0)
        processState = if ($claudeCliProcesses.Count -gt 0) { 'open' } else { 'closed' }
        version = [string]$claudeCommand.version; executableName = [string]$claudeCommand.executableName
        observationTier = 'D'; presenceConfidence = if ($claudeCliProcesses.Count -gt 0) { 'medium' } else { 'unknown' }
    },
    [pscustomobject]@{
        provider = 'gemini'; surfaceId = 'gemini:cli'; surfaceKind = 'cli'
        installed = [bool]$geminiCommand.installed; appOpen = $false; processState = 'unknown'
        version = [string]$geminiCommand.version; executableName = [string]$geminiCommand.executableName
        observationTier = 'D'; presenceConfidence = 'unknown'
    },
    [pscustomobject]@{
        provider = 'grok'; surfaceId = 'grok:cli'; surfaceKind = 'cli'
        installed = [bool]$grokCommand.installed; appOpen = ($grokProcesses.Count -gt 0)
        processState = if ($grokProcesses.Count -gt 0) { 'open' } else { 'closed' }
        version = [string]$grokCommand.version; executableName = [string]$grokCommand.executableName
        observationTier = 'D'; presenceConfidence = if ($grokProcesses.Count -gt 0) { 'high' } else { 'unknown' }
    },
    [pscustomobject]@{
        provider = 'other'; surfaceId = 'antigravity:cli'; surfaceKind = 'cli'
        installed = [bool]$agyCommand.installed; appOpen = $false; processState = 'unknown'
        version = [string]$agyCommand.version; executableName = [string]$agyCommand.executableName
        observationTier = 'D'; presenceConfidence = 'unknown'; displayLabel = 'Antigravity CLI'
    }
)

$operatingSystem = Get-CimInstance Win32_OperatingSystem -ErrorAction SilentlyContinue
$processor = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
$battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
$totalKb = [double]$operatingSystem.TotalVisibleMemorySize
$freeKb = [double]$operatingSystem.FreePhysicalMemory
$memoryLoad = if ($totalKb -gt 0) { [math]::Round((1 - ($freeKb / $totalKb)) * 100, 1) } else { $null }

$result = [pscustomobject]@{
    schemaVersion = 1
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    surfaces = $surfaces
    system = [pscustomobject]@{
        cpuLoadPercent = if ($null -ne $processor) { [int]$processor.LoadPercentage } else { $null }
        memoryLoadPercent = $memoryLoad
        freeMemoryMb = if ($freeKb -gt 0) { [math]::Round($freeKb / 1024, 0) } else { $null }
        onBattery = if ($null -ne $battery) { [int]$battery.BatteryStatus -notin @(2, 6, 7, 8, 9) } else { $false }
        batteryPercent = if ($null -ne $battery) { [int]$battery.EstimatedChargeRemaining } else { $null }
    }
}

$result | ConvertTo-Json -Depth 6 -Compress
