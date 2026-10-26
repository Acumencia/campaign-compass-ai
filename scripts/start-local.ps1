param([int]$Port = 4184)
$ErrorActionPreference = 'Stop'
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Use a port from 1024 through 65535.' }
$projectDirectory = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDirectory = Join-Path $projectDirectory '.tmp'
New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
$existingListener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($existingListener) { throw "Port $Port already has a listener. Inspect it before starting another server." }
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$env:PORT = [string]$Port
$serverProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('--env-file-if-exists=.env','server.mjs') -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDirectory "local-server-$Port.stdout.log") -RedirectStandardError (Join-Path $runtimeDirectory "local-server-$Port.stderr.log") -PassThru
@{pid=$serverProcess.Id;port=$Port;project=$projectDirectory;startedAt=(Get-Date -Format o)} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeDirectory "local-server-$Port.json") -Encoding utf8
Write-Output "Started process $($serverProcess.Id). Open http://127.0.0.1:$Port/campaign.html"
Write-Output 'This is a detached local process, not a startup task or Windows service. It ends on shutdown or when explicitly stopped.'
