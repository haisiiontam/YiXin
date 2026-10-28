# 通道协议实施约定（设计基线 v1）

状态：待实现和安全测试。实现者应回报任何必要变更，更新本约定。

## 游戏及积分
15×15自由五子棋，黑先、轮流空点落子、横竖斜连续≥5获胜，无禁手；满盘无胜为和。位置编码 row*15+col (0..224)，bytes记录有序落子。链上积分为无现实价值的演示记账：每地址可自行注册领取1000分，存在女巫攻击，仅用于教学；每局锁定双方各stake积分，胜者获2*stake，和棋各返stake。注册不属于每局事务，但统计必须另列；积分总量守恒应相对注册发行量计算。积分不是ETH，测试gas用本地测试币。

## 合约接口约定
合约名 GomokuChannel，构造参数 challengePeriod（秒）, invitePeriod（秒）；EIP712 domain name='GomokuChannel',version='1',chainId,verifyingContract。
注册 register()；points(address)；registered(address)。
openChannel(address white,uint256 stake,bytes32 salt) returns(bytes32 id)，黑方为msg.sender，拒绝零/自身白方与重复id，扣黑方积分，记录邀请截止。channel id = keccak256(abi.encode(black,white,salt))（单合约内唯一，签名另含合约和chainId）。
joinChannel(bytes32 id)：仅white、截止前邀请、足额积分，扣white积分转Active。
cancelUnjoined(bytes32 id)：仅black、邀请截止后、未加入，退黑方积分。
State 枚举顺序：None=0, Invited=1, Active=2, Dispute=3, Settled=4, Cancelled=5。
getChannel(bytes32 id) 返回 struct：black,white,stake,status,deadline,moves(bytes),winner(uint8:0未定/和,1黑,2白),reason(uint8:0未定,1五连,2满盘,3超时), 可另有字段。
settle(bytes32 id,bytes moves,bytes sigBlack,bytes sigWhite)：验证两人签名与全谱合法性，必须终局；不允许重复结算。在Dispute时不得接受比已上链状态更旧或不相容的历史。
challenge(bytes32 id,bytes moves,bytes sigBlack,bytes sigWhite)：双方成员可提交合法双签快照。仅空谱允许省略签名（开局共同约定）。Active首次挑战可提交任何合法快照；Dispute内更新必须更长、现有moves为其前缀、截止前。终局快照可立即结算；非终局快照存储、deadline=now+challengePeriod。
forceMove(bytes32 id,uint8 position)：仅Dispute、deadline前、按当前moves长度确定轮到的本人交易；合法落子后更新谱和deadline，若终局即时结算。此路径可处理最后一手胜棋遭拒签：提交上一步双签快照，再本人链上落子。
claimTimeout(bytes32 id)：Dispute且now>=deadline，成员可调用，当前应落子者判负，对方获积分。
stateDigest(bytes32 id,bytes moves) view returns(bytes32)：EIP712 State(bytes32 channelId,bytes32 movesHash) where movesHash=keccak256(moves)。
evaluate(bytes moves) pure returns(uint8 winner,bool terminal)：全谱回放判合法，拒绝越界、占位、终局后继续落子、长度>225；空谱合法非终局。和局 terminal=true,winner=0。
事件建议 ChannelOpened(id,black,white,stake),ChannelJoined(id),CheckpointChallenged(id,movesCount,deadline),ForcedMove(id,position),ChannelSettled(id,winner,reason,blackPoints,whitePoints),ChannelCancelled(id)。可按实际补充。

## 链下协议
每步双方独立校验扩展恰一手、轮次、坐标、旧谱前缀和终局；提案者签名完整新谱，接收者验证后签相同新谱确认；只有双签才成为committed checkpoint，落子全谱及双签需落地/导出。浏览器端保管个人测试私钥；中继只转发，不能代签。演示模式可在同浏览器交替执黑/白但必须明确说明；优先支持双标签/双浏览器房间与各自测试钱包。
签名不得仅签坐标/胜负。EIP712隔离chainId和合约地址，channelId隔离对局，完整movesHash绑定顺序、棋子与结果。校验非法状态必须同时在链下和链上完成。
中继拒绝服务不改变链上积分，玩家可通过本地保存快照与RPC直接争议/结算。诚实方必须在挑战窗口内上线观察并提交更新（课程演示可短窗口，生产需更长窗口与监控）。不声称永久离线安全。

## 测试底线
正常黑白胜/和、注册与余额守恒、签名伪造/错域/错局、非法谱/终局后落子、未加入邀请超时退款、重复结算、旧状态/非前缀更新、无签名空谱挑战、更新后拒绝抢先超时、deadline边界、强制落子轮次与最后一手拒签、超时败方、非成员拒绝、stake余额不足。实测记录交易receipt gasUsed及hash。

## 事务口径
已注册玩家正常每局open+join+settle=3笔；逐步上链基线必须使用同样open+join并每步forceMove/专用基线合约落子，若最后一步即结算为m+2笔，若另结算必须明确。部署与注册作为初始化独立列出，失败交易若发送也应统计。争议流程实测单列，不承诺恒定3笔。
