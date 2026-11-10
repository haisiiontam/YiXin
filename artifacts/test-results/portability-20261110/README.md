# 2026-11-10 启动与运行时验证

- `bootstrap-check-first-failure.txt`：第一次 Windows PowerShell 自检失败，两份 Node 路径被合成命令。保留失败，不覆盖。
- `bootstrap-check-final.txt`：修正选择首个 Application 后，自检成功，Node 24.19.0。
- `missing-node.txt`：子进程清空 PATH 与 NODE_BINARY 后实际返回安装说明及官方地址，预期退出码 1。
- `fresh-installer.txt`：复制真实 bootstrap 至独立项目夹具，在缺 node_modules 情形下通过 npm exec 下载 pnpm 10.11.0、安装 picocolors 1.1.1；冻结锁文件 SHA 前后相同。夹具内前端文件预置，**不代表全产品首次安装或构建验收**。npm 对已有配置的 warning 保留，安装退出码 0。
- `portable-*.txt/json`：复制 server/shared/contracts/scripts、package/锁文件和已构建前端到含中文与空格的新目录，node_modules 通过工作区内 junction 共享；真实调用 start.ps1 后 HTTP 健康检查、页面响应及新目录内 deployment.json 检查通过。随后仅终止本次创建的进程。不是第二台机器或浏览器 E2E 验收。
- `smoke-results.json`：以上缺 Node、小型全新安装、产品迁移三个场景的机器可读结果。
- `runtime-test.txt`、`runtime/chain-runtime-results.json`：本轮运行时回归 13 通过、0 失败；命令及实际观测在结果中。

可重跑的基础命令（在仓库根目录执行，选择新的输出目录，保留旧结果）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap.ps1 -CheckOnly
$env:TEMP=Join-Path (Get-Location).Path '.tmp'
$env:TMP=$env:TEMP
$env:TEST_RESULTS_DIR=Join-Path (Get-Location).Path 'artifacts/test-results/portability-rerun'
node --test --test-concurrency=1 tests/chain-runtime.test.mjs
```

迁移及安装夹具的本地执行脚本保存在 `.tmp/verify-portability-20261110.ps1`；它不是正式产品入口。11 月 7 日的 166 项及 12 组浏览器结果仍是历史批次，本轮未重跑或加总。
