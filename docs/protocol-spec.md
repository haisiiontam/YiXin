# 通道协议实施约定（2026-11-04 修订）

本修订对应当前实现及[可信核验专项记录](trust-audit-2026-11-04.md)。新增两阶段争议期，改变 Channel ABI，须部署新合约并使用新运行目录；EIP-712 的 name/version 仍为 GomokuChannel/1，由 chainId 与新合约地址隔离签名。旧版协议及答辩材料仅代表当时快照。

## 游戏及积分

15×15自由五子棋，黑先、轮流空点落子、横竖斜连续≥5获胜，无禁手；满盘无胜为和。位置编码 row*15+col（0..224），bytes 记录有序落子。每地址可注册一次领取1000无资产价值的演示积分，存在女巫攻击；每局锁定双方各 stake，胜者获 2×stake，和棋各返 stake。可用积分与托管额之和相对注册发行量守恒。积分不是 ETH 或 ERC20；外部网络交易仍需该网络原生 gas 资产。

## 合约接口

合约名 GomokuChannel，构造参数 challengePeriod（秒）、invitePeriod（秒）。EIP-712 domain 严格为 name='GomokuChannel', version='1', chainId, verifyingContract 四字段。

- register()、points(address)、registered(address)：发行和读取演示积分。
- openChannel(white, stake, salt)：黑方为 msg.sender，拒绝零/自身白方与重复 id，扣黑方积分；id=keccak256(abi.encode(black,white,salt))。
- joinChannel(id)：仅 white、邀请截止前、已注册且积分足额，扣白方积分并转 Active。
- cancelUnjoined(id)：仅 black、邀请截止后且未加入，退黑方积分。
- State 数值保持 None=0, Invited=1, Active=2, Dispute=3, Settled=4, Cancelled=5。
- getChannel(id) 返回 black, white, stake, status, deadline, **proofDeadline**, moves, winner, reason。winner 为0和/未定、1黑、2白；reason 为0未定、1五连、2满盘、3超时。
- stateDigest(id,moves)：EIP-712 State(bytes32 channelId,bytes32 movesHash)，movesHash=keccak256(moves)。
- evaluate(moves)：全谱回放；拒绝越界、占位、终局后继续落子和长度>225。空谱合法非终局。

## 两阶段争议

旧版允许旧快照 challenge 后立即 forceMove，可能在诚实方来得及提交最新双签前形成分叉。新协议先收集双签证据，再开放链上续走。

| 操作/时间 | 条件与效果 |
| --- | --- |
| Active.challenge | 仅成员；非空谱必须双签，空谱可以无签。终局立即结算；非终局保存 moves，proofDeadline=now+challengePeriod，deadline=proofDeadline+challengePeriod，转 Dispute |
| Dispute.challenge | 必须 now<proofDeadline；严格更长且以现有链上 moves 为前缀。非终局更新重置两期限；终局立即结算 |
| forceMove | 必须 proofDeadline≤now<deadline；仅当前应落子方。合法落子更新链上谱，非终局只令 deadline=now+challengePeriod，**不重新开放证据期**；终局立即结算 |
| claimTimeout | 必须 now≥deadline、Dispute、成员调用；当前应落子者判负 |
| settle | 合法双签完整终局；Active 或 Dispute 可调用。必须不回退、不分叉于已上链 moves；仍可在证据期、响应期和响应到期但尚未 timeout 时提交兼容终局 |

proofDeadline 恰等时不再接收 challenge，可以 forceMove；deadline 恰等时不能 forceMove，可以 claimTimeout。邀请到期和响应超时均以链上 block.timestamp 为准。前端倒计时仅供展示，发送前读取链时间，合约最终判定。

末手胜棋遭拒签的路径为：提交上一步双签快照 → 等待完整证据期 → 当前方链上补胜棋 → 自动结算。演示默认 challengePeriod=60，因此首次非终局挑战的超时期限为约120秒；专项浏览器 fixture 使用6秒，两阶段语义相同。逐手基线合约 playMove 直接应用合法落子，不等待证据期。

诚实方仍须在每次证据窗口内上线并及时提交更新；没有永久离线安全保证。RPC/底层链持续可用、交易及时上链和密钥安全均为运行假设。

## 链下签名与存储

每步双方独立验证恰一手扩展、轮次、坐标、旧谱前缀及终局。双方签相同完整新谱，只有双签才成为 checkpoint。中继不能替玩家生成签名；本地 AI/双钱包自动演示由同一程序控制，不能算两个独立主体。外部模式由注入钱包保管密钥，用户确认签名和交易，本地模式私钥只适合测试。

证据校验只接受合约兼容的65字节签名及 v=27/28，拒绝额外 EIP-712 domain.salt、compact64 等与当前 bytes 签名入口不一致的表示。无签空谱返回 signed:false，不作为双方授权证明。导入前防止同通道短谱/分叉回退及覆盖另一活动局；旧持久化证据在失败时保留。

## 节点核验和计量

[共享 RPC 核验器](../shared/evidence-chain.mjs)固定最新区块高度，核对实际 chainId、代码/可选可信 hash、合约摘要、参与者、stake、真实链上谱及区块 hash；从可信部署块（缺省0）分页扫描六类 indexed 通道事件，重建全部成功交易并从 receipt 取 gas。文件省略交易清单不影响实际统计，伪造或别局 hash 被拒绝。代码 hash 匹配代表与配置锚一致，单 RPC 的真实性仍是信任依赖。

checkpoint 与 onchain 分开导出；onchain 来自实际 getChannel 及区块，不能用界面棋盘冒充。离线核验只证明签名/棋谱，不证明链上状态、receipt 或合约实现身份。

已注册玩家正常 open+join+settle=3笔；逐手同口径为 m+2笔。部署和注册单列，争议交易另计。事件重建统计成功生命周期交易；失败交易没有成功事件，不能声称该口径包含所有失败尝试。已发送的预期 revert 在合约测试报告单列 hash、gas、status=0。

## 测试依据

[合约结果](../artifacts/test-results/trust-audit-2026-11-04/contract-results.json)覆盖14组真实本地 EVM 断言，包括旧快照攻击实际回滚、最新终局恢复、精确两期限边界、拒签、更新期限和基线即时落子。[独立安全回归](../artifacts/test-results/trust-audit-2026-11-04/dispute-security-results.json)另保留3组。其余浏览器、证据及外部节点实测见[专项记录](trust-audit-2026-11-04.md)，不代表第三方审计或公网部署。
