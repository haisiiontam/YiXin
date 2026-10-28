# 弈·信 环境自检与一键准备：缺什么补什么，补不了就告诉你装什么。
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

function Get-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $fallback = 'C:\Users\66487\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
    if (Test-Path -LiteralPath $fallback) { return $fallback }
    return $null
}

$nodeExe = Get-NodeExe
if (-not $nodeExe) {
    Write-Host '缺少 Node.js（需要 20.19 或更高）。' -ForegroundColor Red
    Write-Host '安装方式二选一：'
    Write-Host '  1) winget install OpenJS.NodeJS.LTS'
    Write-Host '  2) 下载 https://npmmirror.com/mirrors/node/ 的 win-x64 zip，解压后把目录加入 PATH'
    Write-Host '装好后重新运行本脚本。'
    exit 1
}

$version = & $nodeExe -v
$major = [int]($version.TrimStart('v').Split('.')[0])
$minor = [int]($version.TrimStart('v').Split('.')[1])
Write-Host "Node.js $version ($nodeExe)" -ForegroundColor Green
if ($major -lt 20 -or ($major -eq 20 -and $minor -lt 19)) {
    Write-Host '版本过低：需要 20.19 或更高。' -ForegroundColor Red
    exit 1
}

$pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $pnpmCmd) {
    Write-Host '缺少 pnpm，正在用 npm 安装…' -ForegroundColor Yellow
    & (Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd') install -g pnpm@latest --registry=https://registry.npmmirror.com
    $pnpmCmd = Get-Command pnpm -ErrorAction SilentlyContinue
    if (-not $pnpmCmd) { Write-Host 'pnpm 安装失败，请手动执行 npm i -g pnpm' -ForegroundColor Red; exit 1 }
}

$env:TEMP = Join-Path $projectRoot '.tmp'
$env:TMP = $env:TEMP
$env:XDG_CACHE_HOME = Join-Path $projectRoot '.cache'
$env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
New-Item -ItemType Directory -Force -Path $env:TEMP, $env:XDG_CACHE_HOME | Out-Null

if (-not (Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) {
    Write-Host '安装项目依赖…' -ForegroundColor Cyan
    & pnpm install --frozen-lockfile --ignore-scripts
    if ($LASTEXITCODE -ne 0) { Write-Host '依赖安装失败。' -ForegroundColor Red; exit 1 }
}

if (-not (Test-Path -LiteralPath 'web\dist\index.html')) {
    Write-Host '构建前端…' -ForegroundColor Cyan
    & $nodeExe 'node_modules\vite\bin\vite.js' build
    if ($LASTEXITCODE -ne 0) { Write-Host '构建失败。' -ForegroundColor Red; exit 1 }
}

Write-Host ''
Write-Host '准备完成。双击 启动游戏.cmd 开玩；要跑浏览器端到端测试就先执行：' -ForegroundColor Green
Write-Host '  pnpm exec playwright install chromium'