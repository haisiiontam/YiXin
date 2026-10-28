# Web 实施接口 v1

## 技术
React 19 + Vite 7，纯JS JSX，中文UI。主代理实现 server/、shared/、web/src/channel-client.js；前端实现者仅 web/index.html、web/src/App.jsx、web/src/styles.css、web/src/main.jsx 和 vite.config.js。构建 web/dist（Vite root web）。使用相对同源 /api 和 /rpc，正式本地演示由Express同端口提供。

## 客户端模块（主代理提供）
`import { ChannelClient } from './channel-client.js'`。
`const client = new ChannelClient(); client.subscribe(snapshot => setState(snapshot)); await client.init();`
方法：`createRoom(stake=10)`、`joinRoom(channelId)`、`move(position)`、`settle()`、`challenge()`、`forceMove(position)`、`claimTimeout()`、`cancelUnjoined()`、`refresh()`、`exportEvidence()`（返回JSON对象，界面下载）、`disconnect()`；`setAutoAck(boolean)`（断线/拒签实验用，默认true）；`acknowledge()`（手动确认待处理提案）；`runDemo()`（新建独立演示局，双本地钱包脚本9步黑胜、结算，过程中推送快照及真实交易信息，不伪装双真人）。所有异步方法失败抛Error，UI以toast/error展示，不吞错误。
`client.subscribe()`返回unsubscribe函数。无服务时init抛错但仍可显示页面。
快照结构：
```
{
 ready:false,busy:false,error:'', mode:'player'|'demo',
 address:'0x..', points:1000, chainId:31337,contractAddress:'0x..',
 channelId:'', inviteUrl:'', role:0|1|2,
 black:'',white:'', stake:10,status:'idle'|'invited'|'active'|'dispute'|'settled'|'cancelled',
 moves:[], // 已双签确认或已链上确认的position数组
 pending:null|{position,by:1|2,moves:[]},
 winner:0|1|2,terminal:false,reason:'', nextPlayer:1|2,
 deadline:0,challengePeriod:60, now:UNIX秒,
 connected:false,peerConnected:false,autoAck:true,
 signatures:{black:'',white:''},digest:'',
 transactions:[{label,hash,gasUsed,blockNumber,timestamp}], // 当前局真实交易，含open/join/settle/dispute，不含注册/部署
 events:[{time,text,kind:'info'|'success'|'warning'}],
 history:[{id,winner,movesCount,transactions,settledAt}],
 demoProgress:'', metrics:{onchainTransactions:0,offchainMoves:0,baselineTransactions:0,savedPercent:0,totalGas:'0'},
 networkName:'Gomoku Local EVM',
}
```
空房间邀请：createRoom先创建未上链的房间，另一浏览器joinRoom后双方绑定地址，再由host open链上邀请、white join（主代理自动处理）；UI文案用“创建对局”“输入邀请码加入”。channelId可提前确定。客户端内部可在relay准备后自动提交open和join，UIbusy明确显示等待。
恢复：URL `?room=<channelId>`可供复制；用户仍需点击加入，持有钱包的页面刷新自动恢复同房间。自动保存钱包与证据在浏览器localStorage（仅本地测试密钥，界面应轻量标记“本地测试链 · 演示积分”）。

## 体验要求
产品名建议“弈·信 / GOMOKU CHANNEL LAB”。精致桌面优先、适配手机；浅暖白/墨黑/翡翠绿配色，大棋盘15×15（SVG或CSS，坐标/星位/最近一步/获胜线可选），可点击+键盘焦点，不使用外部CDN或字体。
顶部品牌+本地链状态+钱包积分；主要区左棋盘、右控制/双方/链下签名/结算状态；可切换“对局大厅 / 通道实验室 / 对局记录 / 项目说明”或同等布局。实验室给基于真实当前局数据的m+2 vs实际交易的对照（未结束需标“当前快照”，m=0防除零），说明初始化不计每局、异常更多交易。双人房间、自动演示明显入口；异常操作区折叠展示挑战/超时/关闭自动确认，用户不用读源码才能操作。
完整空态/等待/落子/结束/错误状态；邀请地址复制、证据JSON导出、txhash完整可复制（本地无公网浏览器不能造外链）。报告可用真实截图。不要声称实测结果尚不存在，不伪造交易/对手/联网状态。
