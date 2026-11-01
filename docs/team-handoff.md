# 队友交接说明

此 ZIP 是弈·信五子棋软件工程课程设计的可编辑源码和工程证据快照。

## 先读

1. `README.md`：运行方式和本地链边界。
2. `docs/iteration-2-review.md`：本轮验收数据、答辩演示顺序和已知局限。
3. `docs/worklog.md`：按真实执行阶段写的过程日志。
4. `docs/bug-retrospective.md`：测试/开发中遇到的缺陷、原因、修复和证据。
5. `docs/adr-iteration-2.md` 与 `docs/requirements.md`：技术决策与需求追踪。
6. `artifacts/test-results/`：单元测试原始日志、浏览器用例结果、界面审计、部署核对。

`reports/` 中已有的 DOCX/PDF/PPT 是上一版课程材料。迭代 2 的数据和补充写在 `docs/iteration-2-review.md`，不要将旧报告中的版本数据误认为本轮结果。

## 运行

推荐 Node.js 20.19 以上、pnpm 12。安装依赖：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm run compile
pnpm run build
pnpm start
```

访问 `http://127.0.0.1:4173`。Windows 使用 Docker 时，在项目目录执行：

```powershell
docker compose -p gomoku-iter2 -f compose.test.yml up -d --build
```

Docker 端口为 `127.0.0.1:4180`。不要同时用 Node 和 Docker 打开同一份 `artifacts/runtime` 链数据库。ZIP 不含依赖、Docker Desktop 安装包及本地链数据库；队友需在自己的机器上安装依赖/引擎并创建新本地链。

## 测试

```sh
node scripts/verify.mjs
TEST_URL=http://127.0.0.1:4173 node scripts/e2e.mjs
TEST_URL=http://127.0.0.1:4173 node scripts/e2e-v2.mjs
TEST_URL=http://127.0.0.1:4173 node scripts/audit-ui.mjs
```

`verify.mjs` 运行编译、前端构建和 5 组测试文件。浏览器脚本需要本机 Microsoft Edge；可用 `BROWSER_PATH` 指定浏览器位置。Windows PowerShell 的环境变量语法为 `$env:TEST_URL='http://127.0.0.1:4173'`。

## 交付内容与排除项

ZIP 含源码、锁文件、课程报告文件、文档/截图、测试证据、Docker Compose 配置。为避免泄漏本机状态或无关课程材料，排除 `node_modules`、`.git`、临时/缓存目录、`artifacts/runtime`、Playwright 临时目录和 `docs/reference-extracts`。证据是本次机器上的测试快照，不是队友机器上的运行结果；私钥和助记词不随包提供。
