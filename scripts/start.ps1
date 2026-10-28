$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:TEMP = Join-Path $projectRoot '.tmp'
$env:TMP = $env:TEMP
$env:XDG_CACHE_HOME = Join-Path $projectRoot '.cache'
$env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
New-Item -ItemType Directory -Force -Path $env:TEMP,$env:XDG_CACHE_HOME | Out-Null

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) {
    $bundledNode = 'C:\Users\66487\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $bundledNode) { $nodeExe = $bundledNode }
}
if (-not $nodeExe) { throw '找不到 Node.js，请先安装 Node 20.19+ 或把它加入 PATH。' }

if (!(Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) { throw '缺少项目依赖，请先运行 scripts\bootstrap.ps1（会自动检测 Node/pnpm 并安装依赖）。' }
if (!(Test-Path -LiteralPath 'web\dist\index.html')) {
    & $nodeExe 'node_modules\vite\bin\vite.js' build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败。' }
}
Write-Host '弈·信：启动本地链和游戏，浏览器打开 http://127.0.0.1:4173' -ForegroundColor Green
& $nodeExe 'server\index.mjs'
exit $LASTEXITCODE