# Web 前端工作日志

## 2026-10-27 · 首版交付

已读取 `AGENTS.md`、`docs/app-interface.md`、`docs/protocol-spec.md` 与根 `package.json`。前端修改范围仅为 `web/index.html`、`web/src/main.jsx`、`web/src/App.jsx`、`web/src/styles.css`、`vite.config.js` 和本日志；不写 server、共享规则或 ChannelClient。

### 已实现

- React 19 纯 JS/JSX 页面，Vite root 为 `web`，build.outDir 为 `dist`（产物 `web/dist`）。未启动服务器，未新增图片/字体/CDN依赖。
- “弈·信 / GOMOKU CHANNEL LAB”品牌，暖白、墨黑与绿配色。桌面左侧导航、主棋盘、右侧控制；平板压缩导航，手机纵向布局。
- 15×15 SVG 网格/CSS 棋子，每个位置是原生按钮，accessible name 为“落子 r,c”（1 起算）。已确认谱驱动棋子、最后一步标记，待签提案半透明，终局胜线从已确认快照计算。
- 订阅 ChannelClient 快照并调用 init；无服务 init 失败仍展示页面并显示错误。操作错误不会吞掉；busy、等待邀请、等待落子、待双签、获胜和结算有对应展示。
- 双人房间创建、投入积分校验、邀请码/链接加入、复制邀请、测试钱包与双方信息。URL 的 room 只预填输入框，仍需用户点击加入。
- 独立完整自动演示入口只调用 client.runDemo，明确为双本地钱包脚本，不模拟真人或伪造交易。
- 手动确认、自动确认开关、断中继、挑战、链上强制落子开关、到期取消邀请、超时结算、终局结算、刷新和 JSON 证据导出。
- 实验室展示当前实际交易数、已确认 m、m+2 基线、相对比较与本局交易 receipt 字段；未结算标记“当前快照”，无棋谱不计算百分比，初始化单列且不填造初始化数据。
- 本地历史与交易、项目规则/签名域/争议窗口/测试积分边界说明，钱包/邀请码/邀请链接/状态摘要/合约地址/交易 hash 可复制。

### 首版验证状态

- 首版已通知主代理可集成。交付时 ChannelClient 与 node_modules 尚在主代理实现/准备阶段，尚未宣称构建或浏览器通过。
- 后续检查将记录实际命令与结果；真实链交易、截图与端到端验证以主代理运行产物为准。

## 2026-10-27 · 交互自审与集成细节

- 异常实验区增加完整双签/摘要与真实交易子折叠面板，可在大厅核验；交易 hash 只有复制操作，不伪造公网区块浏览器链接。
- 未 ready 时刷新按钮改为“重新连接”，调用 `init()` 重试；自动确认、签名确认仍遵循客户端接口。访客不显示手动确认按钮。
- 修复“最后一手遭拒签”流程的 UI 阻塞：链上强制落子模式不受旧 pending 影响，也不会把未确认幽灵棋子当作已占位置。正常链下落子仍禁止 pending 并发。
- 创建的离链房间尚无 deadline 时，取消链上未加入邀请按钮禁用；到期功能仅在真实链上邀请窗口已存在时可用。
- 所有事件均使用 React 原生按钮/输入控件。棋盘坐标 accessible name 与要求一致，输入具有关联标签；复制按钮含明确名称；错误采用 alert，进度和提示采用 status。移动端控件按断点重排，支持 reduced-motion。
- 主代理明确由其执行构建（子会话当时不可见依赖目录）；本日志不把源码自审称为浏览器实测。待主代理合入 ChannelClient 后，预期构建命令为：

```powershell
$env:TEMP='E:\Gomoku\.tmp'
$env:TMP='E:\Gomoku\.tmp'
& 'C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' 'E:\Gomoku\node_modules\vite\bin\vite.js' build
```

工作目录必须为 `E:\Gomoku`。前端未启动额外服务器，未 git commit。

## 2026-10-27 · 客户端实装校对与构建

- 主代理报告首版 Vite 构建已通过，同时提示 566 KB 单包警告。已调整 `manualChunks`，把 React/React DOM/scheduler 归为 react，将 ethers 与相关密码学模块归为 evm；最新分包结果待主代理重新构建确认。
- 已实际阅读完整 ChannelClient 实现。邀请码现在从 `inviteUrl` 的 `room` 参数取得，不把开通后的链上 channelId 当作 relay 房间邀请码；历史复制按钮也明确为通道 ID。
- 客户端扩展提供 `initialization`，实验室据此单列真实注册 receipt。未提供的部署/其他账户初始化数据仍不估计。
- 错误展示改为捕获新的客户端错误到本地 error 状态；关闭提示仅关闭展示，不触发额外交易或 RPC，不会因原快照 error 未清而立即回显。卸载时取消订阅并调用 destroy 清理客户端资源。
- 演示进行中显示独立 DEMO SESSION，不显示无法加入的邀请入口；历史记录按真实 mode 标注自动演示。真实 active/dispute 局会禁用新演示，避免客户端拒绝后才提示。
- 双方已经连接而尚在 invited 时，进度说明为等待链上开通；只有黑方可取消到期邀请，争议窗口到期后禁用强制落子。
- 本子会话以以上显式 node/TEMP/TMP 命令实际尝试构建，退出码 1，错误为 esbuild 启动服务时 `spawn EPERM`，属于本沙箱的子进程管道边界；未以替代命令绕过、未请求提权。已把原始错误同步主代理，由具有现有构建权限的主代理执行最终验证。
- 本条仅确认源码校对与真实构建尝试，不声称浏览器截图、真实链演示或端到端流程已由前端子会话实测；这些集成结果由主代理留存。

## 2026-10-27 · 独立证据导入

- 主代理报告最新分包构建通过、第一轮 6 项 E2E 通过，并正在扩大拒签恢复验证；该结果为主代理实跑反馈，不计作本子会话单独执行。
- 根据新增 `client.importEvidence(evidenceObject)` 实装，异常实验区增加文件输入：`accept="application/json,.json"`，accessible name 为“导入证据 JSON”。读取文件、解析 JSON、调用客户端验证；任何解析/验证失败显示现有错误提示，不虚构成功状态。同一文件可重新选择重试。
- 仅在方法真实返回 `valid` 后展示验证通过、返回的合法棋谱手数、状态 digest、文件名与已核验 receipt 数；成功 toast 明确恢复已完成。
- 文案说明导出证据不含私钥，RPC 可用时不依赖中继即可核验恢复，非参与者钱包仅可查看。独立证据模式使用通道 ID 展示，不显示无效邀请码；非参与者禁用挑战、超时和结算操作。
- 本轮仅修改授权的 App、样式与日志，未修改 ChannelClient 或 shared 验证逻辑。构建与新增导入端到端验证继续由主代理运行。
