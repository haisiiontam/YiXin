# 弈信 YiXin

中文 15×15 自由五子棋软件工程课程作品。双方逐手对完整棋谱进行 EIP-712 签名，终局由真实 Solidity 合约验证和结算演示积分；拒签时可通过两阶段争议、强制落子和超时退出。

## 作品介绍

唯一演示材料为 [离线 HTML 介绍页](site/index.html)，含需求分析、系统设计、实现与测试、模块分工和交互式协议说明。图形为内嵌开源 SVG，断网可读。旧 PPT、讲稿及生成脚本已移除；新课程报告单独保存在本地工作区的 local-report，不提交仓库。

## 安装与启动

所有依赖、缓存和运行数据限制在 E:\Gomoku 工作区内。安装已锁定的依赖后执行：

```powershell
$env:TEMP='E:\Gomoku\app\.tmp'
$env:TMP=$env:TEMP
node scripts/compile.mjs
node node_modules/vite/bin/vite.js build
$env:RUNTIME_DIR='E:\Gomoku\app\artifacts\runtime-lifecycle-20261107'
node server/index.mjs
```

默认地址 http://127.0.0.1:4173 。首次安装可用 pnpm install --frozen-lockfile --ignore-scripts，同时将 pnpm 缓存设置在工作区。两个玩家使用独立浏览器配置或普通与无痕窗口，不能用同配置普通标签页充当两人。

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

## 分工与边界

谭海翔承担主要架构设计、核心代码、功能扩展、可靠性验证与工程整合；赵国豪承担辅助说明核对与展示讲解，不据此虚构核心代码贡献。开发辅助工具参与实施与文档整理。

默认 Ganache 是本地单节点教学链，积分无现实价值，不等于公网共识。外部 RPC/用户钱包接入见 [外部指南](docs/external-chain.md)。尚未实现 Watchtower；自动化浏览器和钱包接口装置不能代替真人任务、读屏器及真实插件钱包验收。GitHub 推送也不自动等于公众可访问或满足课程发布期限。
