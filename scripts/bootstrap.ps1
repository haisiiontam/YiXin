# 所有下载、依赖及缓存均在项目内；不全局安装 Node 或 pnpm。
param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$env:TEMP = Join-Path $projectRoot '.tmp'
$env:TMP = $env:TEMP
$env:XDG_CACHE_HOME = Join-Path $projectRoot '.cache'
$env:npm_config_cache = Join-Path $projectRoot '.cache\npm'
$env:npm_config_prefix = Join-Path $projectRoot '.cache\npm-prefix'
$env:PNPM_HOME = Join-Path $projectRoot '.cache\pnpm-home'
New-Item -ItemType Directory -Force -Path $env:TEMP,$env:XDG_CACHE_HOME | Out-Null
if ($env:NODE_BINARY) {
    if (-not (Test-Path -LiteralPath $env:NODE_BINARY -PathType Leaf)) {
        throw 'NODE_BINARY 不是有效的 Node 可执行文件，请修正该环境变量或清空后使用 PATH。'
    }
    $nodeExe = (Resolve-Path -LiteralPath $env:NODE_BINARY).Path
} else {
    $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($nodeCommand) { $nodeExe = $nodeCommand.Source }
}
if (-not $nodeExe) {
    throw '未找到 Node.js。请从 https://nodejs.org/ 下载并安装 LTS，加入 PATH 后重试；也可设置 NODE_BINARY。需要 Node 20.19.x 或 22.12 及以上版本。'
}
$nodeVersionText = & $nodeExe -p 'process.versions.node'
if ($LASTEXITCODE -ne 0) { throw 'Node.js 无法执行，请检查 NODE_BINARY / PATH。' }
$nodeVersion = [Version]$nodeVersionText
if (-not (($nodeVersion.Major -eq 20 -and $nodeVersion.Minor -ge 19) -or $nodeVersion -ge [Version]'22.12.0')) {
    throw "Node $nodeVersionText 不满足 Vite 7 要求。请从 https://nodejs.org/ 安装 Node 20.19.x 或 22.12 及以上版本。"
}
# npm 通过 PATH 找 Node，确保使用同一个运行时。
$env:PATH = (Split-Path -Parent $nodeExe) + [IO.Path]::PathSeparator + $env:PATH
Write-Host "Node.js $nodeVersionText" -ForegroundColor Green
$manifest = Get-Content -LiteralPath 'package.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$requiredPackages = @($manifest.dependencies.PSObject.Properties.Name) + @($manifest.devDependencies.PSObject.Properties.Name)
$missingPackages = @($requiredPackages | Where-Object { -not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules\$_\package.json")) })
if ($missingPackages.Count -gt 0) {
    if ($CheckOnly) {
        Write-Host ('尚缺依赖：' + ($missingPackages -join ', ') + '；正常启动时会按锁文件安装。')
    } else {
        $npmExe = Join-Path (Split-Path -Parent $nodeExe) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npmExe)) {
            $npmCommand = Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($npmCommand) { $npmExe = $npmCommand.Source }
        }
        if (-not (Test-Path -LiteralPath $npmExe)) { throw '缺少 npm.cmd，请安装包含 npm 的 Node.js LTS：https://nodejs.org/' }
        $pnpmSpec = $manifest.packageManager
        if ($pnpmSpec -notmatch '^pnpm@\d+\.\d+\.\d+$') { throw 'package.json 必须固定 pnpm 完整版本。' }
        Write-Host "按锁文件安装依赖（$pnpmSpec，缓存位于项目 .cache）…" -ForegroundColor Cyan
        & $npmExe exec --yes "--package=$pnpmSpec" -- pnpm install --frozen-lockfile --ignore-scripts --store-dir (Join-Path $projectRoot '.cache\pnpm-store') | Out-Host
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败；请检查网络及上方错误，修复后重新启动。' }
    }
}
if (-not $CheckOnly -and -not (Test-Path -LiteralPath 'web\dist\index.html')) {
    Write-Host '构建前端…' -ForegroundColor Cyan
    & $nodeExe 'node_modules\vite\bin\vite.js' build | Out-Host
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败，请检查上方错误。' }
}
# 唯一成功流输出供 start.ps1 使用，提示信息使用 Host 流。
Write-Output $nodeExe
