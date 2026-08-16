param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$compilerCandidates = @(
    'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe',
    'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe'
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) { throw 'The Windows .NET Framework C# compiler was not found.' }
$source = Join-Path $PSScriptRoot 'click-through\AIOfficeClickThrough.cs'
$output = Join-Path $PSScriptRoot 'click-through\AIOfficeClickThrough.exe'

& $compiler /nologo /optimize+ /target:winexe /platform:anycpu "/out:$output" $source
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $output)) { throw 'Click-through guard compilation failed.' }
[pscustomobject]@{ ok = $true; output = $output; bytes = (Get-Item -LiteralPath $output).Length } | ConvertTo-Json -Compress
