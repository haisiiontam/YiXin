from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import json
R=Path(r'E:\Gomoku');O=R/'docs/assets';O.mkdir(parents=True,exist_ok=True)
FONT=r'C:\Windows\Fonts\msyh.ttc';BOLD=r'C:\Windows\Fonts\msyhbd.ttc'
GREEN='#28533d';INK='#20332b';MUTED='#68796c';BG='#ffffff';LIGHT='#edf3ed';GOLD='#b29b62'
def font(size=28,bold=False):return ImageFont.truetype(BOLD if bold else FONT,size)
def canvas(title,w=1500,h=900):
 im=Image.new('RGB',(w,h),BG);d=ImageDraw.Draw(im);d.text((60,35),title,font=font(36,True),fill=INK);return im,d
def center(d,xy,text,size=26,fill=INK,bold=False):
 x,y=xy;f=font(size,bold);box=d.multiline_textbbox((0,0),text,font=f,spacing=12,align='center');d.multiline_text((x-(box[2]-box[0])/2,y-(box[3]-box[1])/2),text,font=f,fill=fill,spacing=12,align='center')
def box(d,rect,text,size=25):
 d.rounded_rectangle(rect,radius=18,fill=LIGHT,outline=GREEN,width=3);center(d,((rect[0]+rect[2])/2,(rect[1]+rect[3])/2),text,size)
def arrow(d,a,b,label=''):
 d.line([a,b],fill=GREEN,width=4);import math
 ang=math.atan2(b[1]-a[1],b[0]-a[0]);p=[b,(b[0]-16*math.cos(ang-.5),b[1]-16*math.sin(ang-.5)),(b[0]-16*math.cos(ang+.5),b[1]-16*math.sin(ang+.5))];d.polygon(p,fill=GREEN)
 if label:center(d,((a[0]+b[0])/2,(a[1]+b[1])/2-22),label,21,MUTED)
im,d=canvas('系统架构与信任边界',1500,930)
box(d,(70,140,600,340),'浏览器 A / 黑方\nReact + ChannelClient\n本地测试私钥 / 双签快照')
box(d,(880,140,1410,340),'浏览器 B / 白方\n独立浏览器存储上下文\n独立私钥 / 独立验签')
box(d,(520,430,980,565),'WebSocket 中继\n只转发提案与签名，不代签')
arrow(d,(400,340),(580,430),'签名提案');arrow(d,(1110,340),(920,430),'确认签名')
box(d,(70,680,620,835),'Express /rpc → Ganache\nchainId 31337 / Shanghai')
box(d,(870,680,1420,835),'GomokuChannel 智能合约\n完整棋谱重放 / 积分 / 争议')
arrow(d,(240,340),(240,680),'签名交易 / 读取');arrow(d,(620,755),(870,755),'真实 EVM 执行')
arrow(d,(1230,340),(1230,680),'结算 / 挑战')
d.text((60,875),'教学单节点可复现 EVM，不等同于公开多验证者共识网络；所有服务仅绑定 127.0.0.1。',font=font(23),fill=MUTED)
im.save(O/'diagram-architecture.png')
im,d=canvas('通道生命周期与争议响应',1500,820)
box(d,(50,150,335,285),'Invited\n黑方已锁定 stake');box(d,(600,150,900,285),'Active\n双方已锁定积分');box(d,(1110,480,1430,625),'Settled\n释放锁分 / 仅结算一次')
box(d,(560,480,925,625),'Dispute\n已验证快照 + deadline');box(d,(50,480,335,625),'Cancelled\n邀请超时退回黑方')
arrow(d,(335,215),(600,215),'白方 join，t < 截止');arrow(d,(190,285),(190,480),'邀请到期 cancel');arrow(d,(750,285),(750,480),'双签快照 / 初始空谱');arrow(d,(900,215),(1260,480),'双签合法终局');arrow(d,(925,550),(1110,550),'强制终局 / 超时')
d.rounded_rectangle((445,670,1035,765),radius=16,outline=GREEN,width=3);center(d,(740,715),'更长前缀双签 / 本人强制落子\n有效非终局推进：deadline = t + Δ',23)
arrow(d,(735,625),(735,670));d.text((60,85),'更新：t < deadline；超时：t ≥ deadline。当前应落子却未响应的一方超时负。',font=font(25),fill=MUTED)
im.save(O/'diagram-state.png')
im,d=canvas('每一步链下双签：提交与确认',1500,950)
xs=[240,750,1260];labels=['当前方浏览器','不可信消息中继','对方浏览器']
for x,label in zip(xs,labels):box(d,(x-190,120,x+190,205),label);d.line((x,205,x,865),fill='#bcc8bc',width=3)
steps=[(0,1,290,'校验扩展一手，签完整棋谱'),(1,2,395,'转发 moves + 当前方签名'),(2,1,535,'独立验规则/验签，签同一棋谱'),(1,0,655,'返回对方签名，形成双签快照')]
for a,b,y,label in steps:arrow(d,(xs[a],y),(xs[b],y),label)
for x in [240,1260]:box(d,(x-200,760,x+200,850),'保存已确认快照\n每步无需链上交易',24)
d.text((60,890),'若对方拒签：保留旧双签快照 → challenge → 当前方 forceMove，不能伪造确认。',font=font(24),fill=MUTED)
im.save(O/'diagram-sequence.png')
im,d=canvas('领域结构与数据关系',1500,880)
box(d,(60,150,475,360),'ChannelClient\n签名 / 订阅 / RPC\n导出与导入 / 恢复')
box(d,(580,150,960,360),'Room\nroomId / black / white\nsalt / stake / channelId')
box(d,(1060,150,1450,360),'Checkpoint\nmoves / sigBlack\nsigWhite')
arrow(d,(475,255),(580,255),'管理');arrow(d,(960,255),(1060,255),'保存')
box(d,(60,570,475,780),'EIP712 / ECDSA\n通用域编码与签名恢复\nOpenZeppelin 5.4.0')
box(d,(580,530,960,810),'GomokuChannel\npoints / totalLocked\n_channel struct / deadline\nsettle / challenge / timeout')
box(d,(1060,570,1450,780),'ReceiptRecord\nhash / gasUsed\nblockNumber / status')
arrow(d,(780,360),(780,530),'对应链上状态');arrow(d,(475,675),(580,675),'继承 / 调用');arrow(d,(960,675),(1060,675),'事件与回执')
im.save(O/'diagram-domain.png')
im,d=canvas('需求用例与系统边界',1500,850)
box(d,(40,290,290,480),'黑方 / 白方\n独立测试钱包')
box(d,(1200,290,1460,480),'评估者\n观察钱包')
d.rounded_rectangle((365,130,1135,750),radius=25,outline=GREEN,width=3)
for y,text in [(220,'创建 / 加入通道'),(350,'合法落子 / 双方签名'),(480,'合作结算 / 争议响应'),(610,'导出导入 / 负载核验')]:
 d.ellipse((475,y-50,1030,y+50),fill=LIGHT,outline=GREEN,width=2);center(d,(750,y),text,28)
arrow(d,(290,350),(475,220));arrow(d,(290,385),(475,350));arrow(d,(290,420),(475,480));arrow(d,(1200,420),(1030,610))
d.text((60,790),'积分权威来自合约；中继不拥有签名权；非成员观察钱包不能执行成员操作。',font=font(24),fill=MUTED)
im.save(O/'diagram-usecase.png')
im,d=canvas('项目相对甘特计划（规划值，不是实际耗时）',1500,820)
rows=['I0 需求 / 原型 / 协议','I1 规则 / 签名 / UI','I2 真实链合作闭环','I3 争议与安全验证','I4 证据 / 反馈 / 交付','I5 报告与展示'];ranges=[(1,5),(6,11),(12,16),(17,21),(22,28),(29,30)]
start=445;unit=31
for day in range(1,31):
 x=start+(day-1)*unit;d.line((x,130,x,690),fill='#dfe6df',width=1)
 if day==1 or day%5==0:d.text((x-10,100),str(day),font=font(20),fill=MUTED)
for i,(label,(a,b)) in enumerate(zip(rows,ranges)):
 y=175+i*80;d.text((60,y-15),label,font=font(27),fill=INK);d.rounded_rectangle((start+(a-1)*unit,y-15,start+b*unit-5,y+25),radius=8,fill=GREEN)
d.text((60,725),'44 项 WBS，估算 116 小时；实际采用单会话增量执行并保留真实日志，不回填30天工作记录。',font=font(23),fill=MUTED)
im.save(O/'diagram-gantt.png')
result=json.loads((R/'artifacts/test-results/contract-results.json').read_text())
im,d=canvas('同口径实测：每局链上事务数',1500,780)
for i,c in enumerate(result['comparisons']):
 y=190+i*235;d.text((70,y),f"{c['moveCount']}手合法胜局",font=font(30,True),fill=INK)
 for j,(key,label,color) in enumerate([('baseline','逐步上链',GOLD),('channel','状态通道',GREEN)]):
  yy=y+55+j*70;d.text((70,yy),label,font=font(25),fill=INK);x=340;width=c[key]['transactions']*65;d.rounded_rectangle((x,yy,x+width,yy+43),radius=8,fill=color);d.text((x+width+20,yy),f"{c[key]['transactions']} 笔",font=font(29,True),fill=INK)
d.text((60,700),'不含部署和注册；相同锁分与规则，基线最后一手自动结算。数据来自真实 receipt。',font=font(24),fill=MUTED)
im.save(O/'chart-transactions.png')
im,d=canvas('同口径实测：每局 gasUsed 合计',1500,780)
for i,c in enumerate(result['comparisons']):
 y=180+i*235;d.text((70,y),f"{c['moveCount']}手合法胜局",font=font(30,True),fill=INK)
 for j,(key,label,color) in enumerate([('baseline','逐步上链',GOLD),('channel','状态通道',GREEN)]):
  yy=y+55+j*70;d.text((70,yy),label,font=font(25),fill=INK);x=340;width=int(c[key]['gasUsed'])/1600;d.rounded_rectangle((x,yy,x+width,yy+43),radius=8,fill=color);d.text((x+width+16,yy),f"{int(c[key]['gasUsed']):,}",font=font(26,True),fill=INK)
d.text((60,700),'Gas 与事务数量分别测量；本地合约执行结果不代表公网 TPS、实际币价或真实资产费用。',font=font(24),fill=MUTED)
im.save(O/'chart-gas.png')
print('Generated 8 diagrams/charts')
