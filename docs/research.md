# 通道五子棋研究依据、方案比较与复用边界

版本：0.1；性质：基于成功抓取并实际阅读的公开文本与本地源码的研究记录，不是性能试验、第三方代码审计或用户调研。本文作者未执行抓取脚本或软件测试；抓取元数据来自主代理生成的[来源清单](research/source-manifest.json)，正文已实际读取五份成功快照。失败URL仅记录缺口，不用于产品能力或安全结论。

## 1. 已读来源与可追溯性

所有抓取时间均为来源清单中的UTC时间，保留原值；成功HTTP状态证明抓取到文本，不证明来源所有主张经过本项目独立验证。main/master分支会变更；快照固定本次读取内容但未记录提交SHA，不能冒称对应精确发布版本。

| 编号 | 来源与本地快照 | 抓取记录/版本范围 | 本文使用内容 |
| --- | --- | --- | --- |
| R-S1 | [OpenZeppelin v5.4.0 README](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.4.0/README.md)；[本地快照](research/snapshots/openzeppelin.md) | HTTP200；8047 bytes；2026-10-27T00:52:13.606Z；明确tag v5.4.0 | 可复用Solidity组件、版本/正式发布建议、MIT、使用组件不能替代审计 |
| R-S2 | [go-perun README](https://raw.githubusercontent.com/hyperledger-labs/go-perun/main/README.md)；[本地快照](research/snapshots/perun.md) | HTTP200；10157 bytes；2026-10-27T00:52:13.634Z；main快照，非本项目安装版本 | 通用双方状态通道、链后端、持久化、watchtower、开发中免责声明、Apache2.0 |
| R-S3 | [MUD README](https://raw.githubusercontent.com/latticexyz/mud/main/README.md)；[本地快照](research/snapshots/mud.md) | HTTP200；1774 bytes；2026-10-27T00:52:13.622Z；main快照 | EVM应用框架、存储/升级/委托/前端同步、MIT |
| R-S4 | [ethers README](https://raw.githubusercontent.com/ethers-io/ethers.js/main/README.md)；[本地快照](research/snapshots/ethers.md) | HTTP200；6067 bytes；2026-10-27T00:52:13.600Z；main快照 | 客户端钱包、ABI合约、JSON-RPC、MIT；不以README体积广告数当本项目实测 |
| R-S5 | [EIP-712标准](https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-712.md)；[本地快照](research/snapshots/eip712.md) | HTTP200；22637 bytes；2026-10-27T00:52:13.588Z；标准文本Final，master快照 | typed-data、域隔离、动态bytes hash、应用自行处理重放/抢先提交；CC0 |

[抓取脚本](../scripts/fetch_research.mjs)记录了请求URL和失败处理。清单中statechannels/statechannels的master README和statechannels/go-nitro的main README均返回404；本项目没有成功阅读这两份内容，因此不引用其功能、许可、活跃度、部署参数或安全保证。404只说明本次请求该路径失败，不能推断项目不存在或技术不可用。

本文未访问README中继续链接的论文、文档站、审计报告、示例项目或产品页面；只把它们当来源文本中的链接，不作为已阅读文献。没有测试具体商业五子棋产品，不编造市场份额、用户评价或竞品缺陷。

## 2. 课程问题与方案比较

课程原始选题要求正确使用区块链结算五子棋积分，同时尽量降低事务负担，见[课程合规](course-compliance.md)。核心工程问题是：链下高速更新与可验证链上结算之间如何分工；不能通过把积分保存在浏览器里回避真实合约，也不能用最终签名代替完整规则校验。

| 方案 | 适合的目标 | 本项目判断与证据边界 |
| --- | --- | --- |
| 中心化服务记分 | 便捷同步、账户管理 | 架构简单，但积分最终依赖服务方；不满足本项目真实合约结算要求。属于架构推理，未进行商业竞品实测 |
| 每步上链 | 所有落子由合约直接验证 | 本项目自主基线GomokuOnchainBaseline采用相同规则/积分；每局open+join+每步playMove，最后手自动结算时m+2笔；真实gas结果待测试证据 |
| 应用专用双签通道（当前） | 低正常事务量、清晰规则、可解释争议 | 每步双方对完整新谱签名，合作终局3笔；争议转链上推进/超时，代价是保存证据/在线监控，正常少交易不代表异常恒定少交易 |
| 通用状态通道框架go-perun | 泛化双方通道、注入链后端、持久化和watchtower | README列出相关能力，但接入Go及对应后端会扩大本课设范围；作为方案参考，未导入或移植其源码/协议证明 |
| EVM应用框架MUD | 存储、升级、委托与前端同步等通用基础 | README支持这些能力陈述，但不据此称MUD是签名通道或自带低事务五子棋；本项目不引入整套框架 |

没有以代码行数最大化作为选择标准。课程关注自主工作量，因此在成熟密码/ABI库上实现可追踪的棋局规则、双签协调、争议、教学积分、证据和负载可视化；不为“原创”自制ECDSA或随意改密码库。

## 3. 从来源提炼到本项目的具体要求

### 3.1 EIP-712：有类型的签名，不是业务重放保护

[R-S5](https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-712.md)说明typed-data编码、结构hash和域隔离，并明确“It does not include replay protection”。其安全部分要求重复签名消息被拒绝或执行幂等；抢先提交时也须产生预期效果或拒绝。

本项目采取：domain name=GomokuChannel、version=1、chainId、verifyingContract；State(channelId,movesHash)；棋谱用位置bytes规范编码并keccak256。channelId派生自双方和salt，快照序号由完整谱长度体现；Dispute内严格更长且保留原前缀，生命周期防重复支付。合约仍须完整重放规则，签名只能证明地址授权，不能证明该状态合法或两方独立。

当前签名域没有独立部署纪元。若人为重建相同链ID、同合约地址、同channelId，旧域可能复现；需要按运行实例保存证据、新salt并明确限制。若产品要求密码学跨重建隔离，升级域salt或被签消息，不能借EIP-712的名称宣称问题自动解决。

[R-S5](https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-712.md)旧示例提及已过时测试网络和接口形式，本文不照搬为当前部署方案；本项目实际采用ethers v6本地Wallet.signTypedData与合约OpenZeppelin EIP712。

### 3.2 go-perun：状态持久化与争议监控属于通道的一部分

[R-S2](https://raw.githubusercontent.com/hyperledger-labs/go-perun/main/README.md)介绍双方通道、区块链后端、可注入通信总线、状态/签名持久化与watchtower；也声明软件仍在开发、使用者承担风险。README关于其协议UC安全证明的陈述属于Perun自身主张，本文未读证明论文，也不能把它转移为本项目协议的证明。

本项目借鉴的是职责划分与问题意识：通信服务不等于裁决者；玩家应独立验证并持久保存签名；有挑战期就需要监控链。当前采用应用专用JSON快照和本地中继，没有复用Perun代码、Go库、watchtower或通用资金网络。需要如实标注无永久离线安全，也不声称Perun的多账本/虚拟通道能力在本项目存在。

### 3.3 MUD：框架范围需与课程目标匹配

[R-S3](https://raw.githubusercontent.com/latticexyz/mud/main/README.md)称其提供EVM应用可组合基础，处理存储、升级、委托和前端同步。这说明链上应用可以采用成熟框架，但该短README没有证明其解决本项目的每步链下签名/争议机制。

本项目选本地单合约+少量Node/浏览器模块，便于解释权威数据、规则和调用关系；不声称“基于MUD”或使用其代码，也不将未实测的框架能力和本项目性能作量化比较。框架适合性为范围/复杂度判断，不是MUD性能不足的实验结论。

### 3.4 OpenZeppelin与ethers：复用通用基础，自行验证应用规则

[R-S1](https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.4.0/README.md)建议用正式版本、直接导入已安装组件，并明确使用OpenZeppelin不能替代安全审计。[R-S4](https://raw.githubusercontent.com/ethers-io/ethers.js/main/README.md)列出客户端钱包、ABI合约对象与JSON-RPC能力。

当前[合约](../contracts/GomokuChannel.sol)直接导入OpenZeppelin EIP712/ECDSA；[客户端](../web/src/channel-client.js)与[服务](../server/index.mjs)使用ethers构造钱包、签名/验签、ABI、读取与交易。应用规则、积分、前缀、争议期与权限仍由本项目代码负责。成功使用库API不证明应用无漏洞；测试必须覆盖“签名有效但棋谱非法”、旧状态与重复记分等应用错误。

## 4. 实际依赖与自主实现边界

下列版本来自[依赖声明](../package.json)，锁定清单存在于[pnpm锁文件](../pnpm-lock.yaml)；外部README的分支版本与安装版本分开列。这里只对已读成功来源支持的许可证下确定结论，其他依赖的LICENSE需最终依赖审查补齐，不能因常见就自动认证。

| 模块 | 声明版本/用途 | 来源/许可证据 | 复用边界 |
| --- | --- | --- | --- |
| @openzeppelin/contracts | 5.4.0；EIP712/ECDSA | R-S1 v5.4.0 README明确MIT；实际安装许可证文件最终应归档 | 复用typed-data域编码与ECDSA恢复，不将库写作本人实现 |
| ethers | 6.17.0；Wallet/typed-data/ABI/RPC/receipt | R-S4 main README明确MIT，非v6.17.0逐文件许可审计 | 复用密码与链交互，不将钱包算法写作自主研发 |
| express | 5.1.0；同源服务/API | 本文已读声明，未读其许可证原文 | 通用Web服务，最终许可证清单待核验 |
| ganache | 7.9.2；真实本地EVM执行 | 本文已读声明/使用处，未读其许可证原文 | 复用开发链，不称自主实现区块链/共识 |
| react/react-dom | 19.1.1；中文前端 | 本文已读声明，未读许可证原文 | 通用UI框架，视觉/业务交互由项目完成 |
| ws | 8.18.3；WebSocket | 本文已读声明，未读许可证原文 | 消息传输组件，不将其视为可信裁决 |
| solc | 0.8.30；编译器 | 本文已读声明/编译脚本，未读许可证原文 | 使用编译器，不称自主实现Solidity工具链 |
| vite / @playwright/test | 7.1.12 / 1.56.1；构建/浏览器测试工具 | 本文已读声明，未读许可证原文 | 工具复用；执行与通过结论以原始日志为准 |
| go-perun / MUD | 未作为项目依赖 | R-S2 Apache2.0；R-S3 MIT为来源自述 | 仅研究比较，不复制/移植，不宣称接入 |
| EIP-712标准 | 协议参考，非软件依赖包 | R-S5声明CC0 | 引用标准与规范，不将标准写作本人发明 |

自主实现清单：15×15规则与编码、合法谱前缀/恰一手扩展、应用通道快照格式、签名提案/确认与回执关联、教学积分锁定/释放、邀请/争议/强制落子/超时生命周期、中文UI与实验室、证据schema/核验、与同规则逐步上链基线的测量组织。具体实现、AI辅助、原作者和实际提交以工程记录为准，不能把AI贡献写成虚构同学，也不能以“自主”声称未受标准/库启发。

## 5. 负载与可信性的研究方法

研究问题RQ-01：正常合作通道与逐步上链，完成同一合法棋谱需要多少每局交易？方法：相同参与方准备与stake、同规则、同局m手，通道统计open+join+settle；基线open+join+m次playMove且最终手自动结算。初始化部署/每地址注册独立列示。预期结构上为3与m+2，但真实完成情况以成功/失败原始回执核验，公式不自动等于实验结果。

RQ-02：总gas与单笔执行上限如何变化？方法：同EVM/编译设置、同棋谱分别收集gasUsed并求和；长局验证真实交易能入块；部署与注册另列；不能把(1-3/(m+2))称为gas节省。gas、交易数、链下签名数量、交互耗时分别报告。

RQ-03：不合作时是否仍可正确结束？方法：对手拒签最后胜棋、提交旧快照、临近期限更新、当前方超时、重复结算、非前缀状态；记录真实预期/实得与积分守恒。正常路径3笔不代表争议恒定3笔，不将攻击成本隐藏。

RQ-04：用户是否理解可信与低负载？方法：真实自愿试用、任务观察与匿名原话，参考[课程合规反馈计划](course-compliance.md)。自动双钱包演示不算用户访谈；小样本不推出市场需求或普遍满意率。

本项目创新应陈述为组合和工程落地：中文可理解交互+完整快照签名+可执行本地合约+争议救济+证据+同口径对照。现有来源不能证明这是首创、唯一、领先所有竞品；不使用此类无证据措辞。

## 6. 研究局限与后续补证

- 只实际读取五份公开文本快照，未逐文件分析Perun/MUD或审计其安全性；未安装运行它们，不能给出实测速度/成本排序。
- 除OpenZeppelin为tag v5.4.0，其余抓取大多来自变化分支；最终报告可保留快照内容/抓取时间，若需精确复现应再记录来源commit与内容hash。
- 来源清单的字节数和时间是抓取程序记录，本文未独立重新测量；不可当作本项目运行性能。
- 依赖已精确声明并有锁文件，但全量第三方/传递依赖许可证、漏洞和素材授权仍需实际审查。
- 课程范文与标准/README不是本项目已测试、已公开发布或已收集用户反馈的证据；实测结果必须另外引用原始日志、回执和真实反馈。

本次仅新增本文与[架构文档](architecture.md)，并完善课程/需求文档；未变更程序、依赖、网络服务或区外文件。工程日志请主代理统一关联实际提交。
