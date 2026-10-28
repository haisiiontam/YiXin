# 测试计划与实测报告

本报告区分合约验证、浏览器系统验证与尚未执行的验收。合约最终数据来自 [合约原始结果](../artifacts/test-results/contract-results.json)，生成时间为 2026-10-27T00:58:25.014Z（北京时间08:58:25），11组通过、0组失败，总耗时91571ms。该次运行记录131笔成功交易与1笔预期revert交易，不代表131个独立用户或131局游戏。

最终 [浏览器原始结果](../artifacts/test-results/e2e-results.json) 生成于2026-10-27T01:05:31.385Z（北京时间09:05:31），8组通过、0组失败，errors为空；环境为Microsoft Edge via Playwright，访问http://127.0.0.1:4173。另已复核 [协议与证据原始结果](../artifacts/test-results/protocol-results.json)，生成于2026-10-27T01:01:16.484Z，4组通过、0组失败。三层测试分别保留原始证据，早期浏览器失败及取证/定位器修复保留于D-05，不以最终通过覆盖失败过程。

## 1. 计划、环境与复现

验证顺序为确定性规则向量与独立JS oracle→EIP-712签名与真实本地EVM交易→两个浏览器上下文系统验证→真实用户任务。脚本账户和本人双账户均属于测试设施，当前报告没有真实用户访谈、满意率或公开链结果。

| 项目 | 本次合约实测配置 |
| --- | --- |
| 工作区 | E:\Gomoku；源码、依赖、缓存、临时文件和产物均在工作区 |
| Node | v24.21.0；使用用户指定绝对路径 |
| Solidity | 0.8.30+commit.73712a01.Emscripten.clang，本地solc |
| 编译 | evmVersion=shanghai；optimizer enabled=true，runs=200 |
| EVM | Ganache 7.9.2 内存EIP1193 provider，chainId=31337，Shanghai |
| 客户端 | ethers 6.17.0 BrowserProvider；交易由本地测试账户发送，签名在内存完成 |
| 安全库 | OpenZeppelin Contracts 5.4.0 EIP712/ECDSA |
| 时限 | challengePeriod=30秒，invitePeriod=60秒；通过测试RPC明确推进链时间 |
| 上限 | 本地区块gasLimit=30000000；长局发送gasLimit=20000000 |
| 传输 | 合约测试不启动HTTP/RPC外部服务器；无公网部署、无真实资产 |
| 性能说明 | Node24下Ganache uWS原生模块不匹配，自动回退Node.js实现；运行耗时不代表公网性能 |

核心实现和测试入口为 [合约](../contracts/GomokuChannel.sol)、[编译脚本](../scripts/compile.mjs)、[合约测试](../tests/contract.test.mjs)、[测试助手与JS oracle](../tests/helpers.mjs)。直接执行测试文件避免额外测试子进程捕获管道；所有命令工作目录须为E:\Gomoku。

```powershell
$env:TEMP='E:\Gomoku\.tmp'; $env:TMP='E:\Gomoku\.tmp'
& 'C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' scripts/compile.mjs
& 'C:\Users\lenovo\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe' tests/contract.test.mjs
```

[编译脚本](../scripts/compile.mjs)导出compile(contractName='GomokuChannel')，返回ABI、bytecode、deployedBytecode、编译版本和设置；直接执行时保存 [通道合约产物](../artifacts/contracts/GomokuChannel.json) 与 [逐步上链基线产物](../artifacts/contracts/GomokuOnchainBaseline.json)。导入回调仅从工作区本地node_modules读取，不联网下载Solidity依赖。

## 2. 编号案例与需求追踪

需求编号与AT编号取自 [需求规格](requirements.md)，协议接口取自 [协议约定](protocol-spec.md)。下表C-01至C-11与原始JSON的tests数组顺序一致。每组包含多项断言，“11组”不能写成只有11个安全条件。

| 案例 | 场景、预期与实际 | 需求/验收映射 | 实测 |
| --- | --- | --- | --- |
| C-01 | 注册仅一次、每地址1000分；构造零时限/非法白方/零额及超余额拒绝；黑方锁分；邀请deadline-1可加入、deadline不可加入且仅黑可取消退款；取消后ID不可复用；守恒成立 | FR-04/05/12，NFR-02，AT-01/05 | 通过，1485ms |
| C-02 | 白方须注册且有足够可用积分；多局锁定不能透支；未加入不能结算；Active不能直接领超时；全局可用积分+托管=发行量 | FR-04/05/12，NFR-02 | 通过，926ms |
| C-03 | 黑白胜、横竖两斜、长连≥5、行边界不缠绕；非法坐标、占位、终局后续走、>225手拒绝；独立JS oracle与合约一致；225步满盘无胜合法 | FR-06/09，NFR-02/11，AT-01/02/11 | 通过，29234ms |
| C-04 | digest与ethers typed-data一致；错chainId/合约/name/version/局、冒名/交换签名、高s/畸形/空签名、改顺序均失败；另一合约同channelId不能重放；正确终局结算且重复无效；已签非法谱仍拒绝 | FR-07/09/11/12，NFR-01/02，AT-02/03 | 通过，4961ms |
| C-05 | 白胜与225步合法满盘和棋真实settle；胜负/原因/棋谱正确；胜者获双方stake，和棋各返stake；重复结算拒绝，实际余额守恒 | FR-11/12，NFR-02/07，AT-01/11 | 通过，21353ms |
| C-06 | 非成员挑战、非空无签名、错误轮次/占位/越界拒绝；无签空谱可挑战；deadline-1强制落子为下一方留完整30秒，旧deadline不能抢先超时；提交8手双签后本人链上补胜棋无需对手末手签名 | FR-13/14，NFR-01/02，AT-06/07 | 通过，4234ms |
| C-07 | 同序/旧/非前缀挑战均拒绝；有效更高前缀重置期限，旧deadline不能抢先超时；settle同样拒绝回退/分叉；短终局不能覆盖更长已上链状态；兼容终局仍可结算 | FR-11/13/14，NFR-01/02，AT-04/06 | 通过，6540ms |
| C-08 | deadline-1不能claimTimeout且当前方可落子；deadline恰等时forceMove/challenge拒绝、仅成员可timeout；分别验证轮到黑/白者超时负，积分仅结算一次 | FR-14/15，NFR-01/02，AT-05 | 通过，1893ms |
| C-09 | 双签终局challenge立即结算；非终局争议到期后、timeout尚未执行时，兼容的双签终局仍可由第三人代提交settle；之后timeout无效 | FR-11/13/15，NFR-01/02 | 通过，5632ms |
| C-10 | 真实发送Active状态下非法timeout，receipt.status=0且记录gas/hash；前后8字段、棋谱、积分和托管额不变 | FR-12/17/22，NFR-02/13，AT-10 | 通过，595ms |
| C-11 | 同样参与方、stake与完整谱，正常通道open+join+settle，基线open+join+逐手playMove，末手自动结算；比较真实receipt gas与笔数，部署/注册另列；基线已上链前缀不能被旧双签覆盖 | FR-05/21/22，NFR-06/13，AT-10 | 通过，11233ms |

余额不变量在邀请、加入、取消、胜负、和棋、争议、超时及失败交易后分别验证：sum(points[address])+totalLocked=totalIssued。统计涵盖本次测试设施全部账户，不把注册发行当作对局收益。

### 协议与证据验证

以下P-01至P-04对应 [协议测试结果](../artifacts/test-results/protocol-results.json) 的4组全部通过记录。它们验证JS规则、计量和证据校验，不把纯JS校验写成额外链上交易。

| 案例 | 实测内容 | 需求映射 | 结果 |
| --- | --- | --- | --- |
| P-01 | JS规则拒绝非法类型、越界、占位、分叉和终局后落子 | FR-06/08/09，NFR-02/11 | 通过 |
| P-02 | 合法长连、四方向及边缘不能跨行连接 | FR-06/09，NFR-02/11 | 通过 |
| P-03 | 0手、正常局、争议额外事务与gas的精确计量 | FR-21/22，NFR-06/13，AT-10 | 通过 |
| P-04 | 独立核验双签证据，篡改棋谱、身份、签名域、积分格式被拒绝 | FR-07/19/20，NFR-01/13，AT-03/09 | 通过 |

### 浏览器系统验证

以下B-01至B-08对应 [浏览器测试结果](../artifacts/test-results/e2e-results.json) 的8组全部通过记录。两个独立浏览器上下文分别持有各自测试钱包，不计为两名真实试用者。

| 案例 | 实测内容 | 需求映射 | 实测 |
| --- | --- | --- | --- |
| B-01 | 两个独立上下文注册各自钱包，分别加载225点棋盘 | FR-01/03/04/06 | 通过，606ms |
| B-02 | 双人邀请并开通真实链上通道 | FR-04/05，AT-01 | 通过，948ms |
| B-03 | 9手双签对局仅有2笔开通交易，错误轮次受限 | FR-06/07/08/21，NFR-06 | 通过，1770ms |
| B-04 | 真实终局结算后共3笔交易，链上积分1010:990，总量2000；导出证据并刷新恢复 | FR-10/11/12/18/19，AT-01/08/10 | 通过，1722ms |
| B-05 | 输家拒签第9手后保存8手双签快照，challenge+forceMove完成结算；该局共4笔交易 | FR-13/14，AT-06/07 | 通过，4350ms |
| B-06 | 明确标记的自动演示独立完成9手、3笔交易结算 | FR-05/11/26，NFR-06 | 通过，4171ms |
| B-07 | 独立观察钱包导入证据，核验双方签名和3笔回执；观察者操作禁用，篡改证据被拒绝 | FR-19/20，NFR-01/13，AT-09 | 通过，1108ms |
| B-08 | 390像素移动视口无横向溢出 | NFR-09（该视口的部分覆盖） | 通过，688ms |

浏览器正常9手局真实gas合计431699，与合约C-11不同实例的436143分别报告，不混用。拒签恢复局保存的checkpoint只有8手，链上最终moves为9手，winner=1，交易为open、join、challenge、forceMove，合计619199gas；未伪造输家对第9手的签名。证据观察导入记录validPackageAccepted=true、observerActionsDisabled=true、tamperedPackageRejected=true。浏览器界面中的基线11笔为m+2口径，不是该浏览器场景另外运行的一局逐步上链实测；真实逐步上链gas对照仍使用下一节C-11。

## 3. 真实交易与gas对照

以下仅为C-11两局的同环境实测，不含部署和注册。通道双方各锁10分；基线使用同样开通与锁分逻辑、同样完整棋谱和最终自动结算。基线首手交易在同一笔内进入Dispute，之后每步受轮次、棋谱、期限和前缀保护，不额外增加challenge交易。

| 实测局 | 步数 | 通道成功交易 | 基线成功交易 | 通道gasUsed合计 | 基线gasUsed合计 | 交易数降低 | gas降低 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 黑胜 | 9 | 3 | 11 | 436143 | 1231480 | 72.73% | 64.58% |
| 白胜 | 10 | 3 | 12 | 448105 | 1406433 | 75.00% | 68.14% |

笔数公式为通道3与基线m+2：双方开通2笔，基线每手1笔且最后一手即结算。gas降低单独由sum(receipt.gasUsed)计算，不从笔数比例推导。所有对照交易hash见 [原始对照数组](../artifacts/test-results/contract-results.json#L1264)，对应逐笔receipt列表含blockNumber、status、gasUsed。部署、注册、争议和发送失败交易均另行分类记录；本次总131笔成功与1笔预期失败包含所有场景初始化，不能作为某一局的成本。

225步和棋已真实结算：gasUsed=3550645，为配置30000000区块上限的约11.84%，低于80%余量目标；receipt.status=1，双方stake各自返还。交易hash为0xd70b542ffe86704719d6b2afa51d0b7e45b8bb38c125b55608de769f7f2fbb64，见 [长局receipt](../artifacts/test-results/contract-results.json#L453)。本次未单独发送225步terminal challenge或224步非终局challenge，NFR-07的长局settle已有实测，长局challenge尚不能标为单独实测通过。

拒签末手恢复的最终forceMove：gasUsed=198919，status=1，见 [强制胜棋receipt](../artifacts/test-results/contract-results.json#L543)。预期失败交易gasUsed=26376、status=0、hash=0x438e0668c2a5856e809a8c1bf6c8efce8b0f6ac5542807f06b4dc6333af038d9，见 [失败receipt](../artifacts/test-results/contract-results.json#L921)。其gas记为失败成本，未混入正常3笔对照。

未运行225笔逐步上链和棋基线；其累计回放25425步，包含满盘回放的规则测试组已耗约29秒，重复长局回放会明显延长本地JS EVM测试。保留225步真实规则和结算验证、以9/10步完整胜局比较交易与gas。不能将公式227笔写成已实测227笔，也不能报告和棋基线gas、TPS或公网费用降低。

## 4. 签名、期限与权限安全边界

签名域为name=GomokuChannel、version=1、chainId、verifyingContract；类型为State(bytes32 channelId,bytes32 movesHash)，movesHash=keccak256(完整有序bytes棋谱)。channelId=keccak256(abi.encode(black,white,salt))，单合约生命周期内不可复用。签名既不只绑定某一坐标，也不接受客户端提供的winner；合约回放所有落子自行判定。

| 操作 | 授权与时间 | 被测试的边界 |
| --- | --- | --- |
| join | 仅邀请白方，已注册足额，now<invite deadline | deadline-1允许，deadline拒绝；错人/不够分拒绝 |
| cancelUnjoined | 仅黑方且仍Invited，now>=invite deadline | deadline-1拒绝，deadline成功，重复/ID复用拒绝 |
| challenge | 成员、Active/Dispute；非空必须双签；仅初始空谱可完全免签 | Dispute必须now<deadline且严格更长/原谱为前缀；空谱不能反复延时 |
| forceMove | Dispute、轮到的本人，now<deadline | 错轮/非成员/占位/越界失败；有效非终局deadline=now+30；胜棋即时结算 |
| claimTimeout | Dispute、成员，now>=deadline | deadline-1拒绝、deadline成功；当前应落子方负，重复不再加分 |
| settle | 合法双签终局；可由任意地址代提交；Dispute须与已上链前缀兼容且不更旧 | 拒绝非终局、非法谱、错域、错人、重放、旧/分叉；截止后仍可提交兼容双签终局，先执行的有效结算决定结果 |

deadline采用链时间半开区间，浏览器改时钟不改变授权。测试RPC推进的是本地链时间，不能写成等待了现实30/60秒。覆盖了deadline-1与deadline恰等点；未独立增加deadline+1调用向量，不把需求AT-05所有离散点均写成已执行。终局settle不受challenge期限门限约束，因为双方已授权该兼容终局；与timeout的先后以链上有效交易顺序为准。

## 5. 失败、修复与复测记录

| 编号 | 真实问题 | 处理与验证 |
| --- | --- | --- |
| D-01 | 首次本地solc导入报Cannot find module memorystream；依赖实际在pnpm布局中 | 主会话修复工作区本地依赖junction/布局；没有自行安装全局依赖；后续编译和完整测试成功 |
| D-02 | 子会话mkdir产物目录遭workspace-write EPERM；子会话不继承父会话动态完全权限 | 未绕过或申请升级；读取Windows沙箱诊断技能后按审批不可用规则停止修复；父会话在其授权环境运行，产物仍限定工作区 |
| D-03 | 失败交易前后getChannel的ethers Result Proxy结构相同，直接assert.deepEqual仍报包装对象不等 | 将两边转Array.from后深比较8字段，不放宽失败交易不改状态的预期；C-10完整复测通过，真实revert gas与status保留 |
| D-04 | 默认计划含225笔逐步上链和棋基线，累计25425步回放存在明显重复执行开销；属于计划调整，不是合约断言失败 | 删除默认比较中的225笔基线；保留225步和棋evaluate、真实settle与守恒，比较保留9/10手完整胜局；明确报告覆盖变化 |
| D-05 | 浏览器早期回归报“链下落子产生额外链上交易”；后续新增路径还遇到争议标签匹配两个元素、校验/验证文案不一致 | 原因为测试沿用旧roomId读取空证据、定位器不唯一及预期文字未与实际文案对齐。取证改为active-channel精确读取当前证据；争议标签定位明确使用first；断言使用实际文案。修复仅涉及测试取证与定位器，不把这些问题归为产品签名/交易安全缺陷，也没有放宽9手仅2笔、结算3笔和拒签恢复4笔的预期。最终8组全部通过，0失败，errors为空 |

原始合约结果由最终完整运行覆盖，早期失败并未伪装为成功；D-03错误和修复另在 [合约工作日志](contract-worklog.md)保留。因进程权限迁移而中止过一个子会话测试副本，停止前四组通过不作为最终11组证据；最终11组以新的完整JSON为准。

## 6. 局限与待验证

- 本地单节点可被控制者重置，签名证明地址授权而非现实身份。任意新地址可注册1000分，不能防女巫或双方串谋，不代表竞技信誉，也不涉及真实资产。
- v1域没有独立部署纪元。若人为重建完全相同chainId、合约地址、双方和salt，不能宣称密码学上阻止全部旧授权复用；新salt和UI实例隔离只是运行管理措施。
- 诚实方必须在争议期内保存证据、上线观察并提交新快照；当前没有watchtower、永久离线安全或公网可用性保证。对方强制上链会增加交易，正常3笔不涵盖争议成本。
- 本次是确定性案例集，不是形式化证明、随机模糊测试或第三方安全审计；只说明列明环境/输入下断言通过。
- 长局settle已真实执行，长局challenge未独立实测；deadline+1未单独采样。浏览器拒签末手、刷新恢复、观察钱包导入与篡改拒绝已通过列明场景；中继/RPC断连、完全相同实例链重建等更广恢复场景仍须另测。
- 浏览器只实测Microsoft Edge与390像素移动视口，不能推出两种浏览器兼容或360×800、768×1024、1440×900全部通过。响应时间P95、完整可访问性、真实用户≥3人、外部发布与保留1个月没有在此声称完成。
