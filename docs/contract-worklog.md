# 合约实施与验证日志

## 2026-10-27：接口确认与实现

已阅读工作区 AGENTS.md、docs/protocol-spec.md、package.json。严格在 E:\Gomoku 内实现，不修改 server、frontend、shared 源码，不安装全局依赖，不部署公网。

已实现：

- contracts/GomokuChannel.sol：Solidity 0.8.30；复用 OpenZeppelin Contracts 5.4.0 的 MIT 授权 EIP712/ECDSA；自主实现棋谱回放、积分账本、邀请与状态通道争议状态机。
- 原协议所有函数、State 枚举与 Channel struct 前八项顺序保持一致；补充 totalIssued、totalLocked 与 Registered 事件，用于验证发行量与可用积分/托管积分守恒。
- 回放所有落子，15×15 自由规则；拒绝越界、重复占位、225手以上及终局后续走。四方向均检查，坐标不会跨行缠绕。
- 双签完整 movesHash 的 EIP-712 State，域绑定 name/version/chainId/合约，channelId 绑定双方和 salt。ECDSA 复用库拒绝非法恢复值和高 s 等非规范签名。
- 邀请 join、争议升级、forceMove 均要求 now < deadline；cancel 和 timeout 要求 now >= deadline。Dispute 的双签更新必须更长且保持全前缀，不能重复空谱重开窗口。
- settle 在 Dispute 时也要求不短于已上链前缀且兼容；允许截止后、超时交易前提交兼容双签终局。双方既有授权终局与 timeout 按链上交易顺序生效，此选择已通知主代理。
- 无签名例外仅限双方签名皆空的空谱 challenge；交易本人必须是成员。forceMove 只能轮到的玩家发交易。
- 实际扣除每方 stake，结算返回本金/奖励，全部原子完成；没有外部回调和真实资产。
- 同文件 GomokuOnchainBaseline 继承相同托管与游戏规则，playMove 每手一笔，最终落子即结算，用于 m+2 笔公平基线。
- scripts/compile.mjs 导出 compile(contractName='GomokuChannel') 返回 ABI/bytecode 等，使用本地 solc import callback，仅解析工作区 node_modules；Shanghai、optimizer enabled/runs=200。直接执行写 artifacts/contracts 下两个合约产物。
- tests/helpers.mjs 提供签名、channelId、独立 JS 规则 oracle 与确定性225手合法和棋谱。棋盘着色 (floor(row/2)+col)%2，无任一方向五连，按113黑/112白交替排列。
- tests/contract.test.mjs 使用 node:test、Ganache EIP1193 内存链、ethers BrowserProvider。11组实测场景拟覆盖注册/权限/积分锁定、多局余额耗尽、黑白胜/和棋、签名域/错局/伪造/格式、非法棋谱、旧谱/分叉/争议升级、强制末手、精确deadline、超时胜负、重复结算、真实失败交易receipt，以及9手黑胜/10手白胜的基线对比。成功与失败 receipt 的 hash、gasUsed、blockNumber 均写入实测JSON；部署/注册另列。最初计划额外运行225步和棋的逐步上链基线；实测包含满盘回放的规则测试组约28秒，逐步上链需累计回放25425个落子，会显著延长本地JS EVM执行，因此不将该冗余性能场景列入默认比较。225步和棋仍执行真实 evaluate 与 settle，包含积分返还及守恒验证；报告不得声称有225步逐步上链实测比较。

已执行但尚未成功的首次编译：

```powershell
$env:TEMP='E:\Gomoku\.tmp'; $env:TMP='E:\Gomoku\.tmp'
& 'C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' scripts/compile.mjs
```

首次失败原因为 node_modules/solc/wrapper.js 无法解析 memorystream。主代理确认是沙箱 junction 解析问题，依赖实际存在，随后统一修复。子会话重新执行编译时，mkdir E:\Gomoku\artifacts\contracts 被 workspace-write 沙箱 EPERM 拒绝，未绕过或请求升级。根据 diagnose-windows-sandbox-acl 技能，审批不可用时停止权限修复，未作任何 ACL 修改。主会话切换完全权限后负责运行最终编译和完整测试。

子会话曾启动内存链测试，前四组实测通过：注册/邀请精确deadline/退款守恒（3771ms）；白方足额与跨局锁定（786ms）；完整棋谱、四方向、越界/重复/终局后续走及225步和棋评估（28513ms）；签名域/错局/错合约/高s/伪造/顺序与重放（4859ms）。随后按主代理要求停止此副本，避免与父会话完整运行竞争同一结果文件。此部分运行未输出完整JSON，不作为最终11组全部通过的证据。Node 24 下 Ganache 的 uWS 本地二进制不匹配，自动回退 Node.js 实现，这是性能提示而非断言失败。

父会话运行定位并修复测试断言兼容问题：失败交易前后 getChannel 返回 ethers v6 Result Proxy，直接 assert.deepEqual 比较代理对象会因包装对象差异而误判。改为 Array.from 后逐项深比较，仍完整核验8个状态字段、棋谱与余额/锁定额不变；这是测试表示层问题，不是合约状态被失败交易修改。修复后的完整运行已通过，见下方最终实测记录。

复现测试命令（直接执行测试文件使用 node:test TAP，无子进程捕获管道）：

```powershell
$env:TEMP='E:\Gomoku\.tmp'; $env:TMP='E:\Gomoku\.tmp'
& 'C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' tests/contract.test.mjs
```

## 最终合约实测（2026-10-27 北京时间08:58）

父会话在其已获授权的运行环境执行上面的本地编译与完整测试命令，结果文件生成于2026-10-27T00:58:25.014Z。已复核 [原始合约结果](../artifacts/test-results/contract-results.json)：11组通过、0组失败，91571ms；记录131笔成功交易与1笔预期失败交易。Node v24.21.0，solc 0.8.30，Shanghai，optimizer 200，chainId 31337。

| 同口径实测 | 通道笔数 | 逐步上链笔数 | 通道gas | 基线gas | 笔数降低 | gas降低 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 9手黑胜 | 3 | 11 | 436143 | 1231480 | 72.73% | 64.58% |
| 10手白胜 | 3 | 12 | 448105 | 1406433 | 75.00% | 68.14% |

两路径每方同锁10分，均含open+join，逐步基线末手即结算（m+2笔）。部署、注册、争议和失败交易另列；表中每项来自真实receipt.gasUsed，非公式估计。225步合法和棋真实settle的gas为3550645，约占30000000区块上限11.84%，status=1，双方stake分别退回。强制最后一手胜棋gas为198919；真实非法timeout交易status=0、gas=26376，前后状态8字段及积分/托管均不变。

新增 [测试报告](testing.md)，逐项映射C-01至C-11到需求FR/NFR与AT，记录测试计划、时限与签名边界、失败/修复与覆盖局限。没有声称225手逐步上链比较、长局challenge、deadline+1单独向量或第三方审计已完成。

## 最终协议与浏览器实测（2026-10-27 北京时间09:05后复核）

已读取 [协议测试原始结果](../artifacts/test-results/protocol-results.json)：生成于2026-10-27T01:01:16.484Z，4组通过、0失败，覆盖JS规则非法输入/分叉/终局后续走、合法长连与四方向、事务/gas精确计量、证据双签独立核验和篡改拒绝。

已读取 [浏览器测试原始结果](../artifacts/test-results/e2e-results.json)：生成于2026-10-27T01:05:31.385Z，Microsoft Edge via Playwright，8组通过、0失败、errors为空。实测独立上下文各持钱包注册、双人开通、9手双签仅2笔开通交易、终局3笔交易与链上积分1010:990、导出和刷新恢复；另验证输家末手拒签时保留8手双签快照，challenge+forceMove以4笔交易完成结算；独立自动演示9手3笔、观察钱包导入并核验双签/3笔回执且拒绝篡改、390像素无横向溢出均通过。正常浏览器局gas合计431699，拒签恢复局619199，与合约测试另一实例的数值分开报告。

保留浏览器初次失败：曾记录2通过1失败，提示“链下落子产生额外链上交易”。定位原因为测试使用旧roomId读取空证据；改为依据active-channel精确取当前证据。新增路径另遇到争议标签严格定位匹配两个元素和校验/验证文字预期不一致，分别明确使用first和实际文案。以上修复在测试取证与定位器层，未改变产品签名/交易安全逻辑，未放宽正常2/3笔及拒签恢复4笔断言；最终8组完整复测通过。测试报告已同步P-01至P-04与B-01至B-08需求追踪，不把脚本双账户当真实独立用户。

信任边界：积分无现实价值，任意新地址注册可领取1000分，不能防女巫；本地链性能/gas 数据不代表公网延迟或费用；诚实方必须在挑战窗口内观察并提交更新；中继不能代签，持有本地双签快照者可直接与合约交互。v1签名域没有独立部署纪元，人为重建完全相同chainId/合约/局时不能保证隔离旧授权。未进行公网部署、第三方审计或真实资产实验。
