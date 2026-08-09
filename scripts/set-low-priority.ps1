param(
    [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int]$ProcessId
)

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
$root = $all | Where-Object { [int]$_.ProcessId -eq $ProcessId } | Select-Object -First 1
if ($null -eq $root -or [string]$root.Name -notin @('neutralino-win_x64.exe', 'AI-Office-Dollhouse.exe')) {
    [pscustomobject]@{ ok = $false; changed = 0 } | ConvertTo-Json -Compress
    exit 0
}

$ids = @($ProcessId)
$changedTree = $true
while ($changedTree) {
    $changedTree = $false
    foreach ($row in $all) {
        if ($ids -contains [int]$row.ParentProcessId -and $ids -notcontains [int]$row.ProcessId) {
            $ids += [int]$row.ProcessId
            $changedTree = $true
        }
    }
}

$changed = 0
foreach ($id in $ids) {
    try {
        $process = Get-Process -Id $id -ErrorAction Stop
        $process.PriorityClass = 'BelowNormal'
        $changed += 1
    } catch {}
}
[pscustomobject]@{ ok = $true; changed = $changed } | ConvertTo-Json -Compress
