$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeExe = & (Join-Path $PSScriptRoot 'bootstrap.ps1')
$listenPort = if ($env:PORT) { $env:PORT } else { '4173' }
Write-Host "弈·信：启动本地链和游戏，浏览器打开 http://127.0.0.1:$listenPort" -ForegroundColor Green
& $nodeExe 'server\index.mjs'
exit $LASTEXITCODE
