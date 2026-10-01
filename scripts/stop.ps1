$ErrorActionPreference = 'Stop'
$fairRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$recordPath = Join-Path $fairRoot 'runtime\processes.json'
if (-not (Test-Path -LiteralPath $recordPath)) { Write-Output 'FairFlow has no recorded running process.'; exit 0 }
$record = Get-Content -LiteralPath $recordPath -Raw | ConvertFrom-Json
if ([System.IO.Path]::GetFullPath($record.root) -ne $fairRoot) { throw 'FairFlow process root mismatch; nothing stopped.' }
$serverProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$record.server)
$nodeProcess = if ($record.node) { Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$record.node) } else { $null }
$expectedNodeScript = Join-Path $fairRoot 'node_modules\hardhat\dist\src\cli.js'
if ($nodeProcess) {
 if (-not $nodeProcess.CommandLine.Contains($expectedNodeScript) -or $nodeProcess.ParentProcessId -ne [int]$record.server) { throw 'Recorded local node identity mismatch; nothing stopped.' }
}
if ($serverProcess) {
 if (-not ($serverProcess.CommandLine.Contains('scripts/start.mjs') -or $serverProcess.CommandLine.Contains('scripts\start.mjs'))) { throw 'Recorded server identity mismatch; nothing stopped.' }
 if (-not $nodeProcess) { throw 'Server identity requires its project-owned child; stop from its console instead.' }
}
if ($serverProcess) { Stop-Process -Id ([int]$record.server) }
if ($nodeProcess) { Stop-Process -Id ([int]$record.node) }
Write-Output 'FairFlow local processes stopped. Ledger and data retained for verified replay.'
