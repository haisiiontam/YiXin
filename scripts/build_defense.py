from pathlib import Path
import json
from pptx import Presentation
from pptx.util import Inches,Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE
R=Path(r'E:\Gomoku');O=R/'reports';O.mkdir(exist_ok=True)
C=json.loads((R/'artifacts/test-results/contract-results.json').read_text())
prs=Presentation();prs.slide_width=Inches(13.333);prs.slide_height=Inches(7.5)
INK=RGBColor.from_string('20332B');GREEN=RGBColor.from_string('28533D');MUTED=RGBColor.from_string('68796C');BG=RGBColor.from_string('F6F8F3')
def tb(slide,x,y,w,h,text,size=22,bold=False,color=INK):
 shape=slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h));tf=shape.text_frame;tf.word_wrap=True
 for i,line in enumerate(text.split('\n')):
  p=tf.paragraphs[0] if i==0 else tf.add_paragraph();p.text=line;p.font.name='Microsoft YaHei';p.font.size=Pt(size);p.font.bold=bold;p.font.color.rgb=color;p.space_after=Pt(12)
 return shape

def slide(title,subtitle='',notes=''):
 s=prs.slides.add_slide(prs.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=BG
 tb(s,.55,.35,12.2,.6,title,30,True)
 if subtitle:tb(s,.58,1.02,12.0,.55,subtitle,15,False,MUTED)
 tb(s,.58,7.08,11.6,.25,'弈·信  /  GOMOKU CHANNEL LAB  /  软件工程课程设计',10,False,MUTED);tb(s,12.3,7.03,.5,.3,str(len(prs.slides)),11)
 s.notes_slide.notes_text_frame.text=notes;return s

def pic(s,name,x=.6,y=1.65,w=12.0,h=5.1):
 from PIL import Image
 f=R/'docs/assets'/name
 with Image.open(f) as im:iw,ih=im.size
 dw=min(w,h*iw/ih);dh=dw*ih/iw;s.shapes.add_picture(str(f),Inches(x+(w-dw)/2),Inches(y),width=Inches(dw),height=Inches(dh))

s=slide('弈·信：基于状态通道的五子棋','链下每一步，链上有凭据。','建议35秒：说明课程两个目标：结算正确与低事务。个人信息由本人补填；AI是工具，不是组员。')
tb(s,.8,2.0,11.7,1.7,'可信结算 × 流畅对弈\n真实 EVM · 完整谱双签 · 可执行争议',32,True,GREEN)
tb(s,.82,4.5,10.8,1.5,'作者 / 学号 / 班级 / 教师：由本人填写\n2026年10月27日 · 本地教学演示积分，无现实价值',18,False,MUTED)
s=slide('01 / 问题与 NABCD','先明确“为什么做”，再证明“确实做成”。','建议40秒：N是假设而非访谈结论；D是待本人公开发布/真实试用。')
for i,(h,t) in enumerate([('N 需求','顺畅对弈，同时能自行解释积分的来源'),('A 方法','固定双方通道，完整棋谱EIP-712双签'),('B 收益','正常每局3笔交易，保留不合作退出'),('C 比较','中心化记分 / 每步上链 / 双签状态通道'),('D 交付','本地启动包、源码、报告；真实反馈待采集')]):
 tb(s,.75,1.85+i*.82,2,.5,h,23,True,GREEN);tb(s,2.6,1.85+i*.82,9.7,.6,t,22)
s=slide('02 / 软件工程过程与留痕','NABCD → 编号需求 → 设计 → 自动验证 → 报告与交付','建议35秒：44WBS、26FR+15NFR、3ADR，计划116h不是实际耗时；展示真实Git和失败修复。')
tb(s,.8,1.8,5.9,3.9,'26 项功能需求 / 15 项非功能需求\n44 项 WBS，计划估算116小时\n3 项关键设计决策 ADR\n真实 Git 提交、失败修复与原始JSON\n严禁修改 Gomoku 工作区以外内容',24)
pic(s,'git-history.png',6.8,1.9,5.8,4.6)
s=slide('03 / 系统架构与信任边界','中继转发消息，合约决定积分；浏览器独立保管测试签名密钥。','建议40秒：指出Node/Express/Ganache单进程部署是教学复现环境，不等于公开多验证者共识。');pic(s,'diagram-architecture.png')
s=slide('04 / 每一步为什么不需要链上交易','每个已提交状态都绑定完整有序棋谱，并拥有双方签名。','建议40秒：提案者签→接收者验规则验签→接收者签→双签持久化。最后未被签的胜手走forceMove救济。');pic(s,'diagram-sequence.png')
s=slide('05 / 合作与争议都能结束','旧状态不能覆盖新前缀；有效推进为下一方保留完整响应期。','建议45秒：解释t<deadline响应与t>=deadline超时，当前应行动者判负，settle可在timeout执行前提交兼容双签终局。');pic(s,'diagram-state.png')
s=slide('06 / 真实产品演示','桌面 / 中文操作 / 独立钱包 / 真实交易 / 证据导出','建议70秒现场演示：访问4173，运行9手自动演示，切实验室看3笔回执。若时间允许两浏览器加入；自动演示不是真人反馈。');pic(s,'03-settled-game.png',.6,1.55,12,5.35)
s=slide('07 / 实测：事务数量与 Gas 分开比较','相同规则、stake、棋谱、编译环境；部署与注册独立统计。','建议45秒：9手11→3降低72.73%，gas1231480→436143降低64.58%；10手12→3，gas降低68.14%。不推导TPS或公网费用。')
data=CategoryChartData();data.categories=['9手黑胜','10手白胜'];data.add_series('逐步上链',[11,12]);data.add_series('双签通道',[3,3])
chart=s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,Inches(.7),Inches(1.8),Inches(6),Inches(4.8),data).chart
chart.has_legend=True;chart.legend.font.size=Pt(14);chart.category_axis.tick_labels.font.size=Pt(15);chart.value_axis.tick_labels.font.size=Pt(14)
tb(s,7.1,2.05,5.4,3.8,'9 手：11 → 3 笔\nGas：1,231,480 → 436,143\n10 手：12 → 3 笔\nGas：1,406,433 → 448,105\n225手合法和棋结算：3,550,645 gas',23,True,GREEN)
s=slide('08 / 验证：正确性、攻击面与完整交互','合约 11/11 · 共享协议 4/4 · Edge系统 8/8','建议45秒：举错域/错局/伪造签名/已签非法谱/旧谱/超时边界/末手拒签/守恒。23是测试组数量，不冒称23个用户或完整形式化证明。')
tb(s,.8,1.85,6.2,4.8,'签名：错链 / 错合约 / 错局 / 高s\n规则：占位 / 越界 / 终局后落子\n积分：锁定与发行守恒 / 只结算一次\n争议：严格更长前缀 / 最后时刻响应\n长局：225手合法和棋真实结算',23)
tb(s,7.4,1.85,5.2,4.8,'浏览器关键路径\n独立钱包双人9手 → 3笔结算\n末手拒签 → 8手快照 + 强制胜棋\n观察钱包导入 → 双签/回执核验\n篡改证据拒绝 / 390px无溢出',22,True,GREEN)
s=slide('09 / 特色：把证据带走，把异常做完','拒签最后一手：正常2笔开通 + challenge + forceMove = 4笔。','建议35秒：展示真实拒签截图与导出包。证据导入不含私钥，观察钱包不能拿到成员权限。');pic(s,'07-refusal-recovery.png',.6,1.6,6.0,5.2);pic(s,'08-evidence-import.png',6.8,1.6,5.9,5.2)
s=slide('10 / 局限、真实反馈与下一步','界定已有证据，也界定尚未做到的事情。','建议35秒：诚实方需监控；积分有女巫风险；本地RPC仅回环；未真实发布/试用。报告留空比编造更符合软件工程。')
tb(s,.8,1.85,11.7,4.8,'已交付：可运行程序、真实链测试、中文启动、完整报告与工程记录\n边界：单节点教学链；争议期必须响应；无watchtower；无独立部署纪元\n未完成：真实用户反馈、公开获取页保留1个月、教师确认与个人信息\n下一步：网络故障与恢复、更多浏览器、链上实例隔离、公开服务安全化',24)
s=slide('现场演示与答辩问题','一条证据链：需求 → 规则 → 签名 → 合约 → 回执 → 报告','建议15秒结束；总建议时长约480秒。可回答：为什么3笔、为什么验签还验规则、最后胜手拒签如何处理、为什么数据不证明TPS。')
tb(s,.9,2.0,11.8,3.7,'打开 http://127.0.0.1:4173\n运行完整自动演示 → 通道实验室 → 导出证据\n解释：为什么3笔？拒签怎么办？信任边界在哪里？',29,True,GREEN)
file=O/'弈信-8分钟课程答辩.pptx';prs.save(file)
assert len(Presentation(file).slides)==12
print('Created',file,'slides',len(prs.slides))
