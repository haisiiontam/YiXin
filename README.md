# 弈·信 — Gomoku Channel Lab

一款可运行的软件工程课程设计：15×15中文五子棋，每步通过EIP-712签名在链下确认，游戏结束由真实Solidity合约重放棋谱并结算积分。对手拒签或离线时，可提交双签快照、链上强制落子或超时结算。

**工作区规则：严禁修改 Gomoku 工作区以外的任何内容。** 本机固定工作区为 `E:\Gomoku`；课程源材料只读。

## 当前协议与可信核验修订（2026-11-04）

本项目执行真实 Solidity/EVM 交易、签名验证和积分结算；默认 Ganache 为本机控制的单节点教学链，双钱包自动演示与 AI 由程序控制，不代表公网共识或两位独立真人。现已实现独立 RPC 与浏览器钱包模式，接入方法见[外部节点指南](docs/external-chain.md)。本次外部验收使用独立本机 HTTP 节点及 EIP-1193 测试装置，未部署公网，也未代替真实钱包插件的人工作业验收。

本轮修复旧快照立即分叉攻击，争议先进入证据提交期、再进入链上落子响应期。证据导入及房间恢复保护本地最新双签；统计从节点事件补齐，文件删掉回执不能伪造节省。完整发现、回归与边界见[专项记录](docs/trust-audit-2026-11-04.md)和[当前协议](docs/protocol-spec.md)。

新合约新增 proofDeadline，旧 ABI/旧部署 manifest 不兼容。请保留旧链，为新版指定独立目录，构建后启动：

```powershell
Set-Location E:\Gomoku\app
$env:RUNTIME_DIR='E:\Gomoku\app\artifacts\runtime-trust-v2'
node scripts/compile.mjs
node node_modules/vite/bin/vite.js build
node server/index.mjs
```

此命令在全新目录部署本地教学合约，默认页面为 http://127.0.0.1:4173。已有 schema2 目录只允许相同代码、构造参数和链指纹复用；不要把旧链删除后冒称迁移成功。默认证据期60秒，后续响应期60秒，首次非终局 challenge 的超时总等待约120秒。公网/其他独立网络必须显式配置 RPC、链 ID、已有新协议合约和可信 runtime hash，并由用户钱包确认交易。

`node scripts/verify.mjs` 自动发现全部测试，未指定 TEST_RESULTS_DIR 时创建独立时间戳目录，避免覆盖历史结果。浏览器验收入口为[本地双人验收](scripts/e2e.mjs)及[自包含外部接入验收](scripts/e2e-external.mjs)。本次没有重建旧 Docker 容器；下述迭代2端口与镜像是历史记录。

## 历史运行记录（迭代 2）

本机 Docker 版入口：**http://127.0.0.1:4180**。容器名 `gomoku-iter2`，镜像 `gomoku-channel-lab:iter2`；程序源码位于 `E:\Gomoku\app`。本轮经用户授权恢复 Docker Desktop，其他项目改动仍限定于 Gomoku 工作区。

Docker 引擎运行时，从项目目录构建或恢复：

```powershell
Set-Location E:\Gomoku\app
docker compose -p gomoku-iter2 -f compose.test.yml up -d --build
```

本机若普通终端访问 Docker 命名管道提示拒绝访问，使用管理员终端执行同一命令。停止服务：`docker compose -p gomoku-iter2 -f compose.test.yml stop`。

不使用 Docker 时，从项目目录执行 `node server/index.mjs`，默认地址 **http://127.0.0.1:4173**。保持前台运行，Ctrl+C 停止。两种方式共用 `artifacts/runtime` 持久化目录，**不要同时启动并打开同一份链数据库**。

新增体验：三档 AI 独立钱包对弈、时间轴复盘、形势曲线、威胁点与落子建议、SVG 对局证书、宣纸/墨色双主题、合成落子音效。已结算局可从“对局记录”导出证书；保存的证据 JSON 可导入恢复棋盘后复盘。形势评分是启发式指标，不是胜率；证书核验签名，不证明链上回执。

- 快速体验：点击“运行完整自动演示”。两个本地测试钱包实际完成9手黑胜与链上结算，明确标为脚本演示。
- 真实双人：玩家A创建对局，复制邀请链接；玩家B在**不同浏览器或独立浏览器配置/无痕上下文**中打开并加入。相同浏览器配置的普通标签页共享钱包，不能充当两位棋手。
- 每地址第一次注册领取1000演示分；双方各锁定10分时，胜方最终1010、负方990，和棋各返锁分。
- 每手已双签后才确认棋子；赢棋后点击“链上结算本局”。实验室可看到真实交易hash、gas和m+2假设对照。

## 换一台机器 / 用容器跑

新环境先跑一次自检脚本，它会检查 Node ≥20.19、pnpm，缺依赖就装、缺构建就构建：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\bootstrap.ps1
```

不想配环境就直接用容器（Node + pnpm + 依赖全部固化在镜像里）：

```bash
docker compose up --build
```

细节见 [docs/docker.md](docs/docker.md)。

## 拒签、断线与证据

在“签名与异常实验”关闭自动确认即可模拟拒签；当前方可以“提交最新快照挑战”。先等待证据提交期结束，期间可提交更新且兼容的双签快照；随后开启“棋盘使用链上强制落子”，本人轮次直接在链上走棋。非终局有效落子只重置响应期，不重新开放证据期。响应期限到后“领取超时结算”让当前应落子而未行动的一方判负。本地默认证据期及后续响应期各60秒，邀请期300秒；合约专项使用30/60秒构造参数并通过私有测试装置推进链时间，浏览器验收使用6秒及持续出块。

可导出证据JSON，另一钱包可“导入证据 JSON”核验双签与链上回执；非参与者仅可查看。证据包含棋谱、签名、域和真实交易，不含私钥。中继断开时只要RPC仍可用，已保存证据可独立恢复并进行链上操作。RPC和中继在本地共用同一服务；整个服务停机时无法发送交易，不能宣称此时仍在线结算。

离线核验（仅验证棋谱与签名，不证明当前链状态）：

```powershell
node scripts/verify-evidence.mjs artifacts/test-results/browser-exported-evidence.json
```

加上 `--rpc http://127.0.0.1:4173/rpc` 可从节点核对身份、锁分、棋谱和完整成功交易清单；先运行 `node scripts/compile.mjs` 生成 ABI。可再配置 `--contract <可信地址> --code-hash <可信runtime hash> --from-block <可信部署块>`；不钉代码 hash 时，结果明确 codeIdentityVerified:false。固定区块和分页扫描避免依赖文件自述交易数；RPC 本身仍需可信。

## 安装、构建与验证

环境：Node.js ≥20.19（本机实测24.21.0）、pnpm（本机11.28.5），Windows PowerShell。项目依赖使用工作区缓存；Docker Desktop 是用户单独授权的系统安装例外。

本机托管运行时路径为：

```powershell
$nodeExe='C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpmScript='C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$env:TEMP='E:\Gomoku\.tmp'
$env:TMP=$env:TEMP
$env:XDG_CACHE_HOME='E:\Gomoku\.cache'
$env:XDG_DATA_HOME='E:\Gomoku\.cache\data'
$env:XDG_CONFIG_HOME='E:\Gomoku\.cache\config'
$env:npm_config_cache='E:\Gomoku\.cache\npm'
& $nodeExe $pnpmScript install --frozen-lockfile --ignore-scripts --store-dir E:\Gomoku\.cache\pnpm-store
& $nodeExe scripts/compile.mjs
& $nodeExe node_modules/vite/bin/vite.js build
& $nodeExe --test --test-concurrency=1 tests/*.test.mjs
$env:TEST_URL='http://127.0.0.1:4180'
& $nodeExe scripts/e2e.mjs
& $nodeExe scripts/e2e-v2.mjs
& $nodeExe scripts/audit-ui.mjs
```

普通已配置Node/pnpm环境可使用 `pnpm install --frozen-lockfile --ignore-scripts`、`pnpm run compile`、`pnpm run build`、`pnpm test`，同时仍设置上述工作区缓存与临时目录。`pnpm run verify`顺序运行编译、构建和自动测试；浏览器测试需游戏服务已启动，再运行 `pnpm run test:e2e`。浏览器脚本默认读取本机已有Microsoft Edge，可通过BROWSER_PATH指定已安装浏览器，测试配置与下载写在工作区。无需下载浏览器。

Ganache在Node24下可能提示uWS原生二进制缺失并回退到JavaScript实现；这影响本地性能，真实合约执行和测试仍可运行。不要把本地耗时推断为公网吞吐率。

## 工程与报告索引

迭代 2 优先阅读 `docs/iteration-2-review.md`（最终81项测试、Docker验收、演示顺序）、`docs/bug-retrospective.md`（真实Bug与修复）和 `docs/adr-iteration-2.md`（取舍与边界）。原正式报告正文仍对应v1，以该补充文档更新结果。

2026-11-04 更新答辩资料：[可信协作与工程证据PPT V3](reports/弈信-8分钟课程答辩-V3.pptx)（16页主讲＋3页备用、8分钟含45秒演示）；[V2原件](reports/弈信-8分钟课程答辩.pptx)保留不动。赵国豪讲稿：[打印PDF](reports/弈信-赵国豪答辩讲稿-打印版.pdf)与[可编辑DOCX](reports/弈信-赵国豪答辩讲稿-打印版.docx)。讲稿13页，含逐页台词、计时、重点句、操作卡和12问。新版重点为两阶段争议、节点事实重建、独立RPC/用户钱包、真实攻击修复闭环；数据采用本轮144项自动测试＋14组浏览器及新合约Gas实测。建议分工仍须按实际贡献核实，公网和真人钱包插件验收未冒称完成。详见[队友交接](docs/答辩V3-队友交接.md)。

- `AGENTS.md`：范围与真实性规则。
- `docs/course-compliance.md`：8份参考材料的要求映射、格式、评分冲突与真实反馈边界。
- `docs/requirements.md`：NABCD、角色用例、FR/NFR、44项WBS、相对甘特与风险。
- `docs/architecture.md`、`docs/protocol-spec.md`：架构、数据字典、接口、状态通道安全与算法。
- `docs/research.md`、`THIRD_PARTY_NOTICES.md`：研究来源、模块选择与许可证。
- `docs/testing.md`、`artifacts/test-results/*.json`：测试计划与实测证据。
- `docs/worklog.md`、专项worklog、Git历史：真实过程留痕与失败修复。
- `reports/`：按用户模板生成的完整报告和设计/需求文档；封面个人信息需本人填写。
- `docs/user-feedback.md`：真实试用表与未完成反馈项；没有虚构采访/照片。

## 信任与范围

本项目是**真实EVM合约的本地课程验证系统**。演示积分不可兑现，每地址自注册存在女巫攻击；不提供反作弊竞技排名。诚实玩家须在争议窗口内观察和响应，首版没有watchtower。签名隔离链、合约与通道，但人为把本地链重建为完全相同chainId/合约地址/channelId时，v1没有独立部署纪元阻止所有旧授权复用，必须使用新随机salt并隔离旧证据。

本地进程内Ganache仍是开发链，faucet内部设置测试余额；应用公开RPC代理现已按白名单限制，不开放账户解锁、服务端代签或evm/admin/debug。external关闭faucet与测试钱包，使用独立节点和用户授权；仍不能只公开开发端口便称公网服务，还需要实际目标网部署、钱包插件联调、身份/反滥用、备份与争议监控。

源码已于2026-11-01公开发布至 [GitHub](https://github.com/haisiiontam/YiXin)。当前没有公网在线对战服务或真人反馈，也不把GitHub等同于已完成教案的Gitee/Wiki与公开页保留期要求。已有源码、启动流程、测试、报告与试用记录表，真人反馈需实际参与者完成。课程资料提取文本含他人报告内容，仅供本地参考，公开时排除 `docs/reference-extracts`。本轮交付将安全修复、原始验收证据、V3与打印讲稿一并纳入版本，实际发布状态以仓库main提交历史为准。
