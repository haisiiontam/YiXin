# 弈信 YiXin

中文 15×15 自由五子棋软件工程课程作品。双方逐手对完整棋谱进行 EIP-712 签名，终局由真实 Solidity 合约验证和结算演示积分；拒签时可通过两阶段争议、强制落子和超时退出。

## 作品介绍

唯一演示材料为 [离线 HTML 介绍页](site/index.html)，含需求分析、系统设计、实现与测试、模块分工和交互式协议说明。图形为内嵌开源 SVG，断网可读。旧 PPT、讲稿及生成脚本已移除；新课程报告单独保存在本地工作区的 local-report，不提交仓库。

## 安装与启动

在解压或克隆得到的项目根目录执行（路径可包含空格）。安装 Node.js LTS 后，双击 `启动游戏.cmd`，或运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

启动会检查 Node 版本、自动按锁文件补齐缺失依赖并构建缺失的前端。Node 未安装时会给出 [官方下载地址](https://nodejs.org/)。支持 Node 20.19.x 或 22.12 及以上版本；可选 `NODE_BINARY` 指定可执行文件。pnpm 固定版本由 npm exec 下载至项目缓存，不全局安装。依赖、缓存和运行数据保存在项目内；首次安装需要网络。仅检查环境、不安装依赖可运行 `scripts/bootstrap.ps1 -CheckOnly`。

手动运行或协议版本升级时：

```powershell
$projectPath=(Get-Location).Path
$env:TEMP=Join-Path $projectPath '.tmp'
$env:TMP=$env:TEMP
$env:npm_config_cache=Join-Path $projectPath '.cache\npm'
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
# 缺少依赖时先运行 scripts/bootstrap.ps1
node scripts/compile.mjs
node node_modules/vite/bin/vite.js build
$env:RUNTIME_DIR=Join-Path $projectPath 'artifacts\runtime-lifecycle-20261107'
node server/index.mjs
```

默认地址 http://127.0.0.1:4173 。两个玩家使用独立浏览器配置或普通与无痕窗口，不能用同配置普通标签页充当两人。

本轮新增 cancelInvitation 与 resign，合约字节码已变化。旧运行目录保留，不能直接复用旧部署；为当前版本选择新 RUNTIME_DIR。不要同时打开同一链数据库。

## 取消与退出

- 未匹配房间：房主点击“取消房间 / 邀请”，服务器确认后旧邀请失效，没有锁分交易。
- 未接受链上邀请：黑方可立即取消，合约返还其锁定积分。
- 已开局或争议中：点击“认输并结束本局”，确认后对方获胜并结算；“继续对局”撤回确认。
- 结算或取消后：“返回大厅”清除活动房间与邀请参数，保留历史证据。关闭页面或断开中继不会自动结算。

已有三档本地 AI、回放、坐标确认、键盘棋盘、证据导入导出与存储恢复。保存失败后先备份当前证据再重试，不要直接关闭页面。详见 [用户说明](docs/user-manual.md)、[协议](docs/protocol-spec.md)、[架构](docs/architecture.md)、[生命周期决策](docs/adr-lifecycle-20261107.md)。

## 验证

```powershell
node scripts/verify.mjs
$env:TEST_URL='http://127.0.0.1:4187'
node scripts/e2e-lifecycle.mjs
```

当前迭代原始记录位于 artifacts/test-results/lifecycle-20261107，final 为修正回执等待后的全套结果，browser-regression 为八组既有浏览器回归，lifecycle-browser-results.json 为四组新增退出场景。历史通过与本轮重跑分开记录，失败证据不删除。

当前浏览器脚本默认使用 Windows Edge。其他安装位置请设置 `BROWSER_PATH` 为实际 Chromium/Chrome/Edge 可执行文件；仅运行 `playwright install chromium` 不会自动改变这些脚本的默认路径。未安装浏览器的新机器不能直接宣称 E2E 已通过。

开发过程的缺陷、失败与遗留风险见 [缺陷复盘](docs/bug-retrospective.md) 及 [本轮逐项核查](docs/bug-review-20261110.md)。Git 历史保留实际提交；导出的源码 ZIP 通常不含 `.git`，不通过补造旧提交冒充历史。

## 分工与边界

谭海翔承担需求、架构设计、核心代码、功能扩展、测试、工程整合、材料及课堂讲解；赵国豪发现 Docker 部署中存在的问题，提高程序部署的方便性和鲁棒性。开发辅助工具参与实施与文档整理。

默认 Ganache 是本地单节点教学链，积分无现实价值，不等于公网共识。外部 RPC/用户钱包接入见 [外部指南](docs/external-chain.md)。尚未实现 Watchtower；自动化浏览器和钱包接口装置不能代替真人任务、读屏器及真实插件钱包验收。GitHub 推送也不自动等于公众可访问或满足课程发布期限。
