# 弈·信 — Gomoku Channel Lab

一款可运行的软件工程课程设计：15×15中文五子棋，每步通过EIP-712签名在链下确认，游戏结束由真实Solidity合约重放棋谱并结算积分。对手拒签或离线时，可提交双签快照、链上强制落子或超时结算。

**工作区规则：严禁修改 Gomoku 工作区以外的任何内容。** 本机固定工作区为 `E:\Gomoku`；课程源材料只读。

## 现在运行（迭代 2）

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

在“签名与异常实验”关闭自动确认即可模拟拒签；当前方可以“提交最新快照挑战”。争议中开启“棋盘使用链上强制落子”，本人轮次直接在链上走棋；非终局有效推进重置响应期。期限到后“领取超时结算”让当前应落子而未行动的一方判负。本地交互演示挑战期60秒，邀请期300秒；合约单元测试用30/60秒并明确推进本地链时间。

可导出证据JSON，另一钱包可“导入证据 JSON”核验双签与链上回执；非参与者仅可查看。证据包含棋谱、签名、域和真实交易，不含私钥。中继断开时只要RPC仍可用，已保存证据可独立恢复并进行链上操作。RPC和中继在本地共用同一服务；整个服务停机时无法发送交易，不能宣称此时仍在线结算。

离线核验（仅验证棋谱与签名，不证明当前链状态）：

```powershell
node scripts/verify-evidence.mjs artifacts/test-results/browser-exported-evidence.json
```

加上 `--rpc http://127.0.0.1:4173/rpc` 可核对链上参与者、积分和每笔回执；先运行 `node scripts/compile.mjs` 生成ABI。

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

2026-11-01 新答辩资料：[软件工程重点PPT V3](reports/弈信-8分钟课程答辩-V3.pptx)（16页主讲＋3页备用、8分钟含45秒演示）；V2原件保留为 `reports/弈信-8分钟课程答辩.pptx`。赵国豪讲稿：[打印PDF](reports/弈信-赵国豪答辩讲稿-打印版.pdf)与[可编辑DOCX](reports/弈信-赵国豪答辩讲稿-打印版.docx)。讲稿13页，含逐页台词、计时、重点句、演示卡和12问。两人岗位细分为建议安排，须按实际贡献核实；本次仅更新答辩材料，软件测试引用2026-10-28原始结果。

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

本地RPC包含开发链管理能力、测试币faucet与进程内解锁测试账户，仅绑定127.0.0.1，不应直接暴露到公网。要做公开双人服务，需要独立节点、钱包授权、限制RPC、身份/反滥用、备份与更长挑战期，不能只把当前端口公开。

源码已于2026-11-01公开发布至 [GitHub](https://github.com/haisiiontam/YiXin)。当前没有公网在线对战服务或真人反馈，也不把GitHub等同于已完成教案的Gitee/Wiki与公开页保留期要求。已有源码、启动流程、测试、报告与试用记录表，真人反馈需实际参与者完成。课程资料提取文本含他人报告内容，仅供本地参考，公开时排除 `docs/reference-extracts`。答辩V3与新讲稿为本次本地交付，尚未另行推送远程。
