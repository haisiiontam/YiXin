# 队友交接说明

此 ZIP 是弈·信五子棋软件工程课程设计的可编辑源码和工程证据快照。

## 先读

1. `README.md`：运行方式和本地链边界。
2. `docs/iteration-2-review.md`：本轮验收数据、答辩演示顺序和已知局限。
3. `docs/worklog.md`：按真实执行阶段写的过程日志。
4. `docs/bug-retrospective.md`：测试/开发中遇到的缺陷、原因、修复和证据。
5. `docs/adr-iteration-2.md` 与 `docs/requirements.md`：技术决策与需求追踪。
6. `artifacts/test-results/`：单元测试原始日志、浏览器用例结果、界面审计、部署核对。

原正式课程报告DOCX/PDF仍对应早期版本，旧ZIP未重新打包。2026-11-04已更新[答辩PPT V3](../reports/弈信-8分钟课程答辩-V3.pptx)、[赵国豪打印讲稿PDF](../reports/弈信-赵国豪答辩讲稿-打印版.pdf)和[可编辑DOCX](../reports/弈信-赵国豪答辩讲稿-打印版.docx)，保留[V2](../reports/弈信-8分钟课程答辩.pptx)不动。新版突出两阶段争议、独立RPC/钱包、节点证据重建与对抗回归；144项自动测试＋14组浏览器及Gas以[本轮专项](trust-audit-2026-11-04.md)为准。请使用当前Git版本，并先读[新版演示交接](答辩V3-队友交接.md)。

新PPT共19页（16主讲＋3备用），目标8分钟含45秒演示；讲稿13页，前8页用于台上提示与演示操作，后5页为问答、理论和依据。建议A4原尺寸、黑白、双面长边翻转打印。两人岗位细分为建议职责和答辩安排，须双方按实际贡献核实，不倒填历史。

## 运行

推荐 Node.js 20.19 以上、pnpm 12。安装依赖：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run compile
pnpm run build
# 新协议不可复用旧manifest/ABI；启动前设置独立目录
# PowerShell: $env:RUNTIME_DIR='artifacts/runtime-trust-v2'
# Bash: export RUNTIME_DIR=artifacts/runtime-trust-v2
pnpm start
```

访问 `http://127.0.0.1:4173`。Windows 使用 Docker 时，在项目目录执行：

```powershell
docker compose -p gomoku-iter2 -f compose.test.yml up -d --build
```

4180及上述Docker命令属旧迭代运行记录，本轮未重建镜像，不作为当前演示入口。新版优先Node4173与独立RUNTIME_DIR，不复用旧链；不要并行打开相同数据库。旧ZIP不含本轮完整更新，依赖、数据库及浏览器profile不随Git交付。

## 测试

```sh
node scripts/verify.mjs
TEST_URL=http://127.0.0.1:4173 node scripts/e2e.mjs
node scripts/e2e-external.mjs
# e2e-v2/audit-ui为10月历史脚本，不计入本轮14组
```

`verify.mjs` 自动发现全部测试文件并运行编译/构建，默认新建时间戳结果目录；本轮144项为分批实际执行，浏览器另本地8组＋外部6组。浏览器需Microsoft Edge；外部脚本自建独立HTTP节点和EIP-1193钱包装置，结束后关闭。复验请设全新TEST_RESULTS_DIR；PowerShell变量例为 `$env:TEST_URL='http://127.0.0.1:4173'`。

## 交付内容与排除项

ZIP 含源码、锁文件、课程报告文件、文档/截图、测试证据、Docker Compose 配置。为避免泄漏本机状态或无关课程材料，排除 `node_modules`、`.git`、临时/缓存目录、`artifacts/runtime`、Playwright 临时目录和 `docs/reference-extracts`。证据是本次机器上的测试快照，不是队友机器上的运行结果；私钥和助记词不随包提供。
