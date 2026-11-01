"""Build the evidence-led V3 defense and the printable speaker source.

Reads real result JSON; no software tests are rerun by this document generator.
The named two-person split is a proposal and is never attributed to past commits.
"""
from pathlib import Path
import hashlib
import json
import re
import shutil
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION, XL_LABEL_POSITION
from docx import Document
from docx.shared import Cm, Pt as WPt, RGBColor as WColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

R=Path(__file__).resolve().parents[1]
O=R/'reports'; O.mkdir(exist_ok=True)
D=json.loads((R/'docs/defense-v3-content.json').read_text(encoding='utf8'))
RESULT=json.loads((R/'artifacts/test-results/contract-results.json').read_text(encoding='utf8'))
E2E=json.loads((R/'artifacts/test-results/e2e-v2-results.json').read_text(encoding='utf8'))
assert sum(x['seconds'] for x in D['mainSlides']) == 480
AS=R/'docs/assets/defense-v3'; AS.mkdir(exist_ok=True)
for name, original, rect in [
    ('day-board.png','v2-04-review.png',(300,350,1090,1160)),
    ('dark-board.png','v2-05-dark.png',(300,350,1090,1160)),
    ('threat-detail.png','v2-08-threat-review.png',(375,755,1035,1080)),
    ('review-detail.png','v2-08-threat-review.png',(275,1185,1115,1540)),
    ('normal-receipts.png','04-channel-lab.png',(285,350,1120,958)),
    ('refusal-board.png','07-refusal-recovery.png',(300,350,1090,1155)),
    ('refusal-controls.png','07-refusal-recovery.png',(1150,1615,1485,1975)),
]:
    with Image.open(R/'docs/assets'/original) as im: im.crop(rect).save(AS/name)

BG='F6F8F3'; WHITE='FFFFFF'; INK='20332B'; GREEN='28533D'; MUTED='617166'; LINE='D5DDD2'; PALE='E7EEE3'; GOLD='98753C'; RED='A63E32'
FONT='Microsoft YaHei'
prs=Presentation(); prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
prs.core_properties.title='弈·信｜软件工程重点答辩 V3'
prs.core_properties.author='谭海翔、赵国豪（建议职责安排，待成员核实）'
prs.core_properties.subject='NABCD、需求追踪、模块化、状态机、分层验证与工程证据'

def rgb(s): return RGBColor.from_string(s)
def rect(s,x,y,w,h,fill=WHITE,line=None,round=False):
    q=s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE if round else MSO_SHAPE.RECTANGLE, Inches(x),Inches(y),Inches(w),Inches(h))
    q.fill.solid();q.fill.fore_color.rgb=rgb(fill)
    if line:q.line.color.rgb=rgb(line);q.line.width=Pt(.7)
    else:q.line.fill.background()
    if round:
        try:q.adjustments[0]=.12
        except Exception:pass
    return q

def txt(s,x,y,w,h,text,size=20,bold=False,color=INK,align=PP_ALIGN.LEFT):
    q=s.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h));tf=q.text_frame
    tf.clear();tf.word_wrap=True
    tf.margin_left=Inches(.015);tf.margin_right=Inches(.015);tf.margin_top=Inches(.01);tf.margin_bottom=0
    for i,line in enumerate(text.split('\n')):
        p=tf.paragraphs[0] if i==0 else tf.add_paragraph();p.alignment=align;p.space_after=Pt(8);p.line_spacing=1.12
        run=p.add_run();run.text=line;run.font.name=FONT;run.font.size=Pt(size);run.font.bold=bold;run.font.color.rgb=rgb(color)
        rp=run._r.get_or_add_rPr(); ea=OxmlElement('a:ea');ea.set('typeface',FONT);rp.append(ea)
    return q

def rule(s,x,y,w,color=LINE):
    q=s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT,Inches(x),Inches(y),Inches(x+w),Inches(y));q.line.color.rgb=rgb(color);q.line.width=Pt(1)

def arrow(s,x,y,w=.35):
    q=s.shapes.add_shape(MSO_SHAPE.CHEVRON,Inches(x),Inches(y),Inches(w),Inches(.28));q.fill.solid();q.fill.fore_color.rgb=rgb(GREEN);q.line.fill.background()

def base(title,sub,source='',notes='',main=None):
    s=prs.slides.add_slide(prs.slide_layouts[6]);s.background.fill.solid();s.background.fill.fore_color.rgb=rgb(BG)
    idx=len(prs.slides)
    txt(s,.55,.20,10,.22,'弈·信   /   软件工程重点答辩   /   V3',10.5,True,MUTED)
    txt(s,.55,.65,12.25,.58,title,29,True)
    txt(s,.58,1.31,12.1,.43,sub,15.5,False,MUTED)
    rule(s,.58,1.83,12.1)
    rule(s,.58,6.94,12.1)
    txt(s,.58,7.02,11.2,.30,source or '本地教学链 · 演示积分 · 源码与原始证据可复核',9.7,False,MUTED)
    txt(s,12,7.00,.75,.29,f'{idx:02d}',11,True,GREEN,PP_ALIGN.RIGHT)
    if main:
        n=f"第{idx}页｜{main['seconds']}秒\n核心：{main['key']}\n\n【讲稿】{main['speech']}\n\n【动作／提醒】{main['cue']}\n【证据】{main['evidence']}"
    else:n=notes
    s.notes_slide.notes_text_frame.text=n
    return s

def main(i,source=''):
    d=D['mainSlides'][i-1]; return base(d['title'],d['subtitle'],source,main=d)

def card(s,x,y,w,h,kicker,body,fill=WHITE,body_size=20):
    rect(s,x,y,w,h,fill,LINE,True)
    txt(s,x+.18,y+.17,w-.36,.40,kicker,21,True,GREEN)
    txt(s,x+.18,y+.78,w-.36,h-.88,body,body_size)

def band(s,text,y=6.19,h=.53):
    rect(s,.62,y,12.05,h,PALE,None,True);txt(s,.82,y+.08,11.65,h-.10,text,18,True,GREEN)

def picture(s,path,x,y,w,h):
    with Image.open(path) as im: iw,ih=im.size
    z=min(w/iw,h/ih);dw=iw*z;dh=ih*z
    return s.shapes.add_picture(str(path),Inches(x+(w-dw)/2),Inches(y+(h-dh)/2),width=Inches(dw),height=Inches(dh))

def row(s,y,cols,widths,font=18,head=False):
    x=.7
    for text,w in zip(cols,widths):
        rect(s,x,y,w-.03,.67,GREEN if head else WHITE,LINE)
        txt(s,x+.12,y+.13,w-.24,.5,text,font,head,WHITE if head else INK)
        x+=w

# 01: statement-led cover, native board motif.
s=main(1,'汇报：赵国豪   ·   项目：谭海翔 / 赵国豪   ·   2026.11.01')
txt(s,.75,2.25,8.5,1.35,'把需求、设计、异常与验证\n连成一个完整系统。',33,True,GREEN)
for i,(a,b) in enumerate([('可玩','中文双人 / 三档AI'),('可信','完整谱双签 / 合约重放'),('可查','回执 / 测试 / 工程日志')]):
    x=.8+i*3.05;txt(s,x,4.35,2.8,.55,a,27,True);txt(s,x,5.02,2.85,.7,b,17,False,MUTED)
rect(s,10.08,2.24,2.55,3.35,'EADBB9',None,True)
for i in range(7):
    a=10.38+i*.32
    q=s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(a),Inches(2.65), Inches(a),Inches(4.65));q.line.color.rgb=rgb('A89166')
    q=s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(10.38),Inches(2.65+i*.32), Inches(12.3),Inches(2.65+i*.32));q.line.color.rgb=rgb('A89166')
for i in range(5):
    q=s.shapes.add_shape(MSO_SHAPE.OVAL,Inches(10.54+i*.32),Inches(3.62),Inches(.26),Inches(.26));q.fill.solid();q.fill.fore_color.rgb=rgb(INK);q.line.fill.background()
txt(s,10.32,4.95,2.1,.35,'每一步信任，都有迹可循',11,True,GREEN,PP_ALIGN.CENTER)
band(s,'需求说得清，设计讲得通，结果查得到。',6.15)

# 02: rubric/product artifact correspondence.
s=main(2,'依据：课程教案评价指标、Ch2-1；此处为项目内部评分口径')
for i,(a,b,c) in enumerate([('程序','能运行、能恢复、能交付','双人 / AI / 争议 / Docker'),('数据','可核验、可回放、可比较','棋谱 / 双签 / 回执 / 测试'),('文档','有约束、有决策、有追踪','FR/NFR / UML / ADR / 日志')]):
    card(s,.7+i*4.04,2.10,3.85,2.45,a,b+'\n'+c,body_size=18)
weights=[('需求',20),('设计',35),('实现测试',30),('创新',10),('反馈',5)]
x=.8
for label,w in weights:
    rect(s,x,5.0,w*.115,.48,GREEN if label in ('设计','实现测试') else GOLD)
    txt(s,x,5.6,max(1.08,w*.115+.12),.42,f'{label} {w}%',13,True);x+=w*.115
band(s,'需求、设计、实现与验证相互支撑，形成可追踪、可复现的课程工程成果。')

# 03: NABCD correct to local course definition.
s=main(3,'依据：教案NABCD附录；D按课程定义为Delivery／推广')
items=[('N','需求','顺畅下棋，并能核验积分来源'),('A','做法','链下完整谱双签＋合约结算＋争议退出'),('B','收益','正常每局3笔；结算可核验，异常有路径'),('C','替代方案','中心化记分 / 每步上链 / 状态通道'),('D','推广与获取','GitHub源码＋Docker说明＋课堂演示；真人试用待补')]
for i,(letter,cap,body) in enumerate(items):
    y=2.06+i*.73;rect(s,.73,y,.51,.48,GREEN,None,True);txt(s,.73,y+.04,.51,.40,letter,20,True,WHITE,PP_ALIGN.CENTER)
    txt(s,1.48,y+.02,2.1,.48,cap,21,True,GREEN);txt(s,3.6,y+.01,8.9,.55,body,19.5)
band(s,'收益与成本一起解释：少上链，也需要保存证据、监控争议期。')

# 04: lifecycle and two increments.
s=main(4,'依据：44项WBS、ADR-001～007、真实Git记录；116h仅为计划估算')
steps=['需求／验收','设计／ADR','实现／集成','测试／修复','版本／交付']
for i,t in enumerate(steps):
    x=.72+i*2.45;rect(s,x,2.12,2.12,.76,GREEN,None,True);txt(s,x+.09,2.31,1.94,.4,t,18,True,WHITE,PP_ALIGN.CENTER)
    if i<4:arrow(s,x+2.18,2.36,.2)
card(s,.73,3.24,5.82,2.36,'迭代1｜先消除核心风险','双人开通 → 双签 → 结算\n拒签 / 旧状态 / 超时 / 守恒',body_size=22)
card(s,6.79,3.24,5.82,2.36,'迭代2｜再扩展体验价值','AI → 复盘 / 提示 → 证书\n视觉令牌 / 手机适配 / 旧流程回归',body_size=22)
band(s,'借鉴迭代与风险驱动思想；以验收证据定义“完成”。')

# 05: traceability example.
s=main(5,'依据：FR-14 / AT-06 → GomokuChannel → 浏览器拒签回归')
trace=[('01 需求','FR-14 / AT-06','末手被拒签\n仍可完成合法退出'),('02 设计','状态机＋接口','challenge\nforceMove'),('03 实现','合约＋客户端','校验身份、轮次\n重放完整棋谱'),('04 验证','真实EVM＋浏览器','8手双签快照\n第9手链上胜棋')]
for i,(k,t,b) in enumerate(trace):
    x=.7+i*3.08;rect(s,x,2.3,2.86,3.2,WHITE,LINE,True);txt(s,x+.18,2.5,2.48,.42,k,21,True,GREEN);txt(s,x+.18,3.16,2.48,.54,t,18,True);txt(s,x+.18,4.05,2.48,1.25,b,20)
    if i<3:arrow(s,x+2.9,3.7,.18)
band(s,'可追踪的验收：需求不只存在于报告里，也存在于能失败、能复测的用例里。')

# 06: native architecture diagram.
s=main(6,'理论映射：Parnas信息隐藏 / 课程“高内聚、低耦合”；证据：ADR-004／005')
card(s,.73,2.2,3.52,1.38,'体验层 UI','棋盘 / 主题 / 复盘 / AI',body_size=15.5)
card(s,4.86,2.2,3.52,1.38,'会话层 ChannelClient','身份 / 签名 / RPC / 恢复',body_size=17)
card(s,9,2.2,3.52,1.38,'合约层 EVM','规则重放 / 争议 / 权威积分',body_size=17)
arrow(s,4.38,2.77,.28);arrow(s,8.52,2.77,.28)
card(s,.73,4.0,7.65,1.59,'共享领域模块','gomoku规则 → analysis棋型 → AI / 提示 / 复盘',body_size=20)
card(s,9,4.0,3.52,1.59,'中继只转发消息','不持有棋手私钥\n不决定积分',body_size=18)
band(s,'第二轮接入AI、重做界面，合约与签名协议保持兼容：变化被限制在边界内。')

# 07: normal flow.
s=main(7,'口径：已注册玩家正常对局；部署、注册、失败与争议另外统计')
for x,title,desc in [(1,'① open','黑方锁分'),(5.3,'② join','白方锁分'),(9.55,'③ settle','合约重放并结算')]:
    rect(s,x,2.25,2.75,1.14,GREEN,None,True);txt(s,x+.15,2.42,2.45,.46,title,25,True,WHITE,PP_ALIGN.CENTER);txt(s,x,3.6,2.75,.50,desc,19,True,INK,PP_ALIGN.CENTER)
arrow(s,4.24,2.68,.45);arrow(s,8.52,2.68,.45)
rect(s,.83,4.58,11.65,1.02,WHITE,LINE,True)
txt(s,1.05,4.78,11.22,.63,'中间落子：提案签名 → 验规则与签名 → 对方确认 → 双签保存',21,True,GREEN,PP_ALIGN.CENTER)
band(s,'State(channelId, movesHash) ＋ 链与合约签名域；签名有效仍需棋谱合法。')

# 08: lifecycle + invariants.
s=main(8,'证据：合约测试与浏览器末手拒签路径；玩家须保存状态并监控争议期')
for x,y,w,t in [(.8,2.2,2.25,'Invited'),(4.1,2.2,2.25,'Active'),(9.6,2.2,2.7,'Settled'),(4.1,4.03,2.25,'Dispute')]:
    rect(s,x,y,w,.74,GREEN if t!='Dispute' else RED,None,True);txt(s,x+.1,y+.18,w-.2,.43,t,23,True,WHITE,PP_ALIGN.CENTER)
arrow(s,3.38,2.43,.34);arrow(s,7.9,2.43,.40);txt(s,6.63,2.12,2.7,.35,'合法双签终局',13,True,MUTED)
txt(s,4.22,3.14,4.8,.6,'↓ challenge：提交有效快照',18,True,RED)
txt(s,6.77,4.0,5.6,1.06,'forceMove → 成五即结算\n到期 → claimTimeout',22,True,GREEN)
txt(s,.8,4.18,2.8,1.2,'邀请到期\n取消并返还锁分',18,False,MUTED)
rule(s,.8,5.48,11.65)
txt(s,.85,5.67,11.6,.49,'不变量：争议快照只能兼容前进 / 只结算一次 / 可用积分＋锁分＝发行量',18,True)
band(s,'已测末手拒签：open＋join＋challenge＋forceMove，共4笔，完成真实胜局。')

# 09: enlarged real UI detail, instead of unreadable full-page screenshot.
s=main(9,'实图：2026-10-28浏览器运行截图；审计是基础检查，非完整可访问性认证')
picture(s,AS/'day-board.png',.72,2.04,4.04,3.86);picture(s,AS/'dark-board.png',4.95,2.04,4.04,3.86)
txt(s,9.36,2.3,3.08,.6,'美感服务于理解',23,True,GREEN)
txt(s,9.36,3.08,3.08,2.6,'统一设计令牌\n待签／双签／结算\n日夜主题与音效\n手机布局回归',20)
band(s,'4页×2主题：基本字号、对比度、控件名称与溢出检查均通过。')

# 10: explanation/retention.
s=main(10,'真实截图裁取复盘区域；评分为启发式，证书不替代RPC回执核验')
picture(s,AS/'threat-detail.png',.74,2.06,6.05,2.25)
picture(s,AS/'review-detail.png',.74,4.30,6.05,1.77)
picture(s,R/'docs/assets/v2-certificate-preview.png',7.05,2.08,2.91,4.12)
txt(s,10.25,2.45,2.32,.8,'三档AI\n单人可体验',20,True,GREEN)
txt(s,10.25,3.65,2.32,1.0,'复盘与提示\n只读、无交易',20,True,GREEN)
txt(s,10.25,4.9,2.32,1.1,'SVG证书\n可带走的棋谱',20,True,GREEN)
band(s,'交互价值来自“可体验、可解释、可留存”，技术价值来自共享规则与协议复用。')

# 11: layered validation not certification.
s=main(11,'测试快照：2026-10-28；81项测试＋18组浏览器回归，均有原始记录')
for i,(cap,a,b) in enumerate([('模块正确性','AI 30＋证书9','规则／分析／转义／拒绝篡改'),('协议与本地EVM','合约11＋协议4','签名域／棋谱／争议／守恒'),('客户端恢复','专项27','身份／回执／失败保存／退款')]):
    x=.72+i*4.05;card(s,x,2.08,3.85,2.85,cap,a+'\n'+b,body_size=18)
rect(s,.74,5.19,7.8,.63,GREEN,None,True);txt(s,.91,5.34,7.45,.4,'系统验收：原8组＋新增10组浏览器回归通过',19,True,WHITE)
rect(s,8.79,5.19,3.76,.63,PALE,None,True);txt(s,8.95,5.34,3.4,.4,'界面审计：8组页面／主题',16.5,True,GREEN)
band(s,'V模型式对应：验收对需求，集成对设计，单元对模块；反例与成功路径同样重要。')

# 12: native editable charts.
s=main(12,'本地EVM／Shanghai／solc0.8.30；2026-10-28；排除部署与注册；原始comparisons可查')
comps=RESULT['comparisons']
for x,kind,title in [(.8,'transactions','成功交易数（笔）'),(6.92,'gasUsed','执行Gas（万）')]:
    txt(s,x,2.03,5.6,.4,title,20,True,GREEN)
    data=CategoryChartData();data.categories=['9手黑胜','10手白胜']
    div=10000 if kind=='gasUsed' else 1
    data.add_series('逐步上链',[int(c['baseline'][kind])/div for c in comps]);data.add_series('双签通道',[int(c['channel'][kind])/div for c in comps])
    chart=s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,Inches(x),Inches(2.55),Inches(5.58),Inches(2.76),data).chart
    chart.has_legend=True;chart.legend.position=XL_LEGEND_POSITION.BOTTOM;chart.legend.font.name=FONT;chart.legend.font.size=Pt(12)
    chart.category_axis.tick_labels.font.size=Pt(12);chart.value_axis.tick_labels.font.size=Pt(11);chart.value_axis.minimum_scale=0
    chart.chart_style=10
    for ser,color in zip(chart.series,[GOLD,GREEN]):
        ser.format.fill.solid();ser.format.fill.fore_color.rgb=rgb(color);ser.format.line.fill.background()
    chart.plots[0].has_data_labels=True
    labs=chart.plots[0].data_labels;labs.font.size=Pt(11);labs.position=XL_LABEL_POSITION.OUTSIDE_END;labs.number_format='0.0' if div>1 else '0'
txt(s,.89,5.48,5.6,.55,'9手：11 → 3，减少72.73%',21,True,GREEN)
txt(s,7.03,5.48,5.5,.55,'9手：1,231,480 → 436,143',20,True,GREEN)
band(s,'Gas降低：9手64.58%，10手68.14%；结论仅限本地样本，不推导公网TPS或费用。')

# 13: real fault closure.
s=main(13,'复盘R5：不是假设案例；27项是客户端整套专项测试，不是该单一缺陷数量')
for i,(a,b) in enumerate([('发现风险','open已成功\njoin失败\n钱包尚未保存'),('定位根因','持久化放在\n两笔交易之后\n恢复材料滞后'),('实施修复','先存钱包与证据\n再发open\n保存回执后join'),('回归验收','待加入可恢复\n核身份与回执\n到期可取消退款')]):
    card(s,.72+i*3.07,2.32,2.83,3.27,a,b,body_size=20)
    if i<3:arrow(s,3.59+i*3.07,3.67,.17)
band(s,'工程启示：持久化顺序也是设计；异常恢复要有可执行的验收条件。')

# 14: proposals visibly not invented history.
s=main(14,'建议岗位分工；需成员按实际贡献确认，不用于倒填既往提交、会议或工时')
card(s,.73,2.12,5.79,2.77,'赵国豪｜规划与验收方向','NABCD / 需求与验收标准\nWBS / 风险与文档组织\n讲稿 / 答辩 / 用户反馈计划',body_size=21)
card(s,6.8,2.12,5.79,2.77,'谭海翔｜实现与集成方向','规则 / 协议 / 合约 / 前端\n自动测试 / 缺陷修复 / 部署\n技术核验 / 演示操作支持',body_size=21)
txt(s,.95,5.27,11.4,.55,'共同交接：需求与接口评审 → 用例核验 → 版本检查 → 答辩彩排',20,True,GREEN)
band(s,'配置管理实物：Git提交、锁文件、Docker配置、工程日志、交接说明。')

# 15: actual demonstration with local URL and fallback.
s=main(15,'演示机：Docker http://127.0.0.1:4180；Node直启4173；现场先确认服务就绪')
for i,(n,a,b) in enumerate([('01','运行固定9手演示','双本地钱包 → 双签 → 真实结算'),('02','进入通道实验室','看3笔回执 / Gas / 本局积分变化'),('03','导出证据','棋谱＋签名＋交易参考 → 可重新核验')]):
    y=2.12+i*1.07;rect(s,.86,y,.7,.62,GREEN,None,True);txt(s,.88,y+.13,.66,.4,n,22,True,WHITE,PP_ALIGN.CENTER)
    txt(s,1.88,y+.03,4.18,.55,a,25,True,GREEN);txt(s,6.35,y+.09,5.75,.6,b,20)
band(s,'同一局的操作、签名、交易与导出证据相互对应，结算结果可以复核。')

# 16: strong but bounded conclusion.
s=main(16,'源码与材料：https://github.com/haisiiontam/YiXin；演示积分，无现实价值')
for i,(k,v) in enumerate([('完整产品','双人 / AI / 复盘 / 证据'),('完整机制','合作结算 / 拒签 / 超时'),('完整证据链','需求 / ADR / 测试 / Git')]):
    x=.76+i*4.05;rect(s,x,2.22,3.82,2.36,GREEN,None,True);txt(s,x+.22,2.57,3.38,.5,k,27,True,WHITE);txt(s,x+.22,3.4,3.38,.75,v,18,False,WHITE)
txt(s,.88,4.99,11.7,.98,'下一步：真实用户任务观察、更多浏览器与网络故障回归、AI移入Web Worker。',22,True,GREEN)
band(s,'以可检查的活动对齐经典工程要求；本地教学链与已验证范围说明清楚。')

# Appendices: not part of the eight-minute script.
s=base('备用17｜正常结算与拒签救济的真实记录','保存的浏览器测试截图：正常3笔结算；末手拒签4笔完成真实胜局','截图裁取：04-channel-lab.png / 07-refusal-recovery.png；正常局与拒签局为不同样本',notes='仅在演示失败或老师追问拒签时使用。左图是已有正常结算实验室回执，右图是拒签后胜局和4笔记录。说明环境与测试快照日期，不声称刚刚执行。截图显示的431687gas是该浏览器局，不与第12页合约样本436143混写。')
txt(s,.8,2.02,5.7,.4,'正常结算｜3笔回执',19,True,GREEN)
picture(s,AS/'normal-receipts.png',.72,2.55,5.93,3.35)
txt(s,6.97,2.02,5.5,.4,'末手拒签｜恢复胜局＋4笔记录',19,True,GREEN)
picture(s,AS/'refusal-board.png',6.9,2.55,3.35,3.35)
picture(s,AS/'refusal-controls.png',10.5,2.55,1.95,3.35)
band(s,'正常：3笔；末手拒签：8手双签快照＋challenge＋forceMove，共4笔。')

s=base('备用18｜课程与经典方法，逐项有落点','方法用于解释工程活动；不构成标准认证或全过程审计结论','对应证据：requirements / architecture / ADR / tests / worklog',notes='只在追问理论与规范时使用。SWEBOK知识域不是固定阶段；V模型为验证对应思想，不声称项目严格执行纯V模型或Scrum。')
row(s,2.05,['工程要求／原则','项目落点','检查产物'],[3.0,5.0,4.0],16,True)
for i,vals in enumerate([
    ['需求与验收','NABCD、FR/NFR、明确边界','requirements / 验收场景'],
    ['抽象与信息隐藏','UI、会话、规则、合约分责','架构 / ADR-004～007'],
    ['状态建模与不变量','前缀、期限、一次性结算、守恒','状态机 / 合约反例测试'],
    ['分层验证与回归','模块＋EVM＋浏览器＋恢复','81项 / 18组 / 原始结果'],
    ['配置管理与交付','锁版本、Git、Docker、日志','提交 / 锁文件 / 交接说明'],
]):row(s,2.8+i*.65,vals,[3.0,5.0,4.0],15.5)
band(s,'真实用户反馈、更多浏览器、公开页保留期与Gitee口径仍需补充或确认。')

s=base('备用19｜理论与课程依据','课程定义优先；下列为中文概括与书目定位，不作未经核验的原文引语','核心数据均来自项目原始结果；外部理论是解释框架，不替代项目证据',notes='按需展示。未声称读完全部教材或通过IEEE/ISO认证。SRI原NABC与本课程扩展D不混淆；本页引用本课程NABCD和经典SE书目。')
refs=[
    ('课程教案与Ch2-2','NABCD：D=Delivery推广；WBS≥30；8分钟；信息隐藏、模块独立。'),
    ('SWEBOK｜IEEE Computer Society','需求、设计、构造、测试、配置管理等知识域。computer.org/education/bodies-of-knowledge/software-engineering'),
    ('经典教材｜Pressman & Maxim','Software Engineering: A Practitioner’s Approach. 版本与年份未独立核实。'),
    ('Parnas｜1972，CACM 15(12)','On the Criteria To Be Used in Decomposing Systems into Modules. DOI: 10.1145/361598.361623'),
    ('Brooks｜1987，Computer 20(4)','No Silver Bullet—Essence and Accidents of Software Engineering. DOI: 10.1109/MC.1987.1663532'),
]
for i,(a,b) in enumerate(refs):
    y=2.07+i*.83;txt(s,.82,y,11.9,.3,a,17.5,True,GREEN);txt(s,.82,y+.34,11.8,.48,b,13.5)

ppt=O/'弈信-8分钟课程答辩-V3.pptx';prs.save(ppt)

# Printable source, deliberate page breaks and low ink use.
doc=Document();sec=doc.sections[0]
sec.page_width=Cm(21);sec.page_height=Cm(29.7)
sec.top_margin=Cm(1.55);sec.bottom_margin=Cm(1.5);sec.left_margin=Cm(1.75);sec.right_margin=Cm(1.75)
sec.header_distance=Cm(.7);sec.footer_distance=Cm(.65)
styles=doc.styles
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
    st=styles[name];st.font.name=FONT;st._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),FONT)
styles['Normal'].font.size=WPt(12.5);styles['Normal'].paragraph_format.line_spacing=1.23;styles['Normal'].paragraph_format.space_after=WPt(7)
for name,size in [('Title',25),('Heading 1',19),('Heading 2',14.5),('Heading 3',13)]:
    styles[name].font.size=WPt(size);styles[name].font.color.rgb=WColor.from_string(INK)
    styles[name].paragraph_format.space_before=WPt(7);styles[name].paragraph_format.space_after=WPt(8)
    styles[name].paragraph_format.keep_with_next=True
hp=sec.header.paragraphs[0];hp.text='弈·信 V3｜赵国豪答辩随身稿｜8分钟主讲＋备用问答';hp.runs[0].font.size=WPt(9);hp.runs[0].font.color.rgb=WColor.from_string('555555')
f=sec.footer.paragraphs[0];f.alignment=WD_ALIGN_PARAGRAPH.RIGHT
f.add_run('2026.11.01  ·  第 ')
fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');f._p.append(fld);f.add_run(' 页')
for r in f.runs:r.font.size=WPt(9)
doc.core_properties.title='弈信答辩讲稿｜赵国豪打印版 V3'
doc.core_properties.subject='逐页讲稿、时间控制、操作提示、重点问答与证据口径'

def para(text,bold=False,size=None):
    p=doc.add_paragraph();r=p.add_run(text);r.bold=bold
    if size:r.font.size=WPt(size)
    return p

def label(label,text):
    p=doc.add_paragraph();p.add_run(label+' ').bold=True;p.add_run(text);return p

def page(title,sub=''):
    if len(doc.paragraphs)>2:doc.add_page_break()
    doc.add_heading(title,level=1)
    if sub:para(sub,size=10.5)

def table(headers,rows,widths=None):
    t=doc.add_table(rows=1,cols=len(headers));t.style='Table Grid'
    for c,h in zip(t.rows[0].cells,headers):c.text=h
    for vals in rows:
        cells=t.add_row().cells
        for c,v in zip(cells,vals):c.text=str(v)
    for ri,row_ in enumerate(t.rows):
        for ci,c in enumerate(row_.cells):
            if widths:c.width=Cm(widths[ci])
            for p in c.paragraphs:
                p.paragraph_format.space_after=WPt(3);p.paragraph_format.space_before=WPt(3);p.paragraph_format.line_spacing=1.10
                for r in p.runs:r.font.size=WPt(10.5);r.bold=(ri==0)
    return t

# p1
page('先记住这一页','不逐字朗读全部资料。A4纵向，建议100%大小、双面长边翻转、黑白打印；PDF页码与此文一致。')
para('我们的项目，把流畅对弈、可核验结算和可执行退出做成了一个完整闭环。',True,17)
label('三个优势','完整可玩的产品；把不合作也做完的设计；可查到原始结果的工程证据。')
label('三个动作','讲清一个需求追踪例子；讲透一个恢复Bug；演示一次真实结算和证据出口。')
table(['时段','页码','该讲什么'],[
    ['0:00–1:20','1–3','定位、课程交付、NABCD'],
    ['1:20–3:30','4–7','迭代、追踪、模块化、三笔机制'],
    ['3:30–4:50','8–10','异常、交互、AI复盘证书'],
    ['4:50–6:25','11–13','分层验证、实测对照、真实Bug'],
    ['6:25–8:00','14–16','建议分工、45秒演示、总结'],
], [3,2,12.2])
label('最关键的数','正常3笔；拒签示例4笔；81项测试＋18组浏览器回归；9手11→3笔，Gas降低64.58%。')
label('三个口径','D按教案写Delivery推广；测试数据为2026-10-28快照；建议分工待双方按实际贡献核实。')
label('控时底线','第15页演示15秒未就绪即切备用17；若超时，压缩第9、10、14页，保留需求、设计、验证和总结。')

# p2-p6 speaker grouped, use same speech as PPT notes.
cum=0
meta=[]
for i,d in enumerate(D['mainSlides'],1):
    begin=cum;cum+=d['seconds']
    meta.append((i,d,f'{begin//60}:{begin%60:02d}–{cum//60}:{cum%60:02d}'))
for group,title in [((1,2,3),'主讲①｜先立住价值与课程对应'),((4,5,6),'主讲②｜用工程产物解释设计'),((7,8,9),'主讲③｜正常与异常都讲得通'),((10,11,12),'主讲④｜用证据支持亮点'),((13,14),'主讲⑤｜用改进与交接说明工程能力'),((15,16),'主讲⑥｜现场演示与收束')]:
    page(title,'粗体句为本页重点；“提醒”不必读出。可用自己的语言改写，保持数字与边界一致。')
    for idx in group:
        i,d,span=meta[idx-1]
        doc.add_heading(f"P{i:02d}  {d['title']}｜{d['seconds']}秒｜{span}",level=2)
        para(d['key'],True)
        para(d['speech'])
        label('提醒',d['cue'])

# p7 demo checklist.
page('演示操作卡｜别在现场修环境','这一页用于上台前与第15页。现场演示占45秒，问答时间另计。')
table(['顺序','动作','台词／检查'],[
    ['上台前','打开Docker版127.0.0.1:4180','Node直启4173。独立浏览器上下文；确认页面加载且无进行中对局。'],
    ['0–5秒','对局大厅，点击“运行完整自动演示”','“这是固定9手、双本地钱包的脚本演示。”'],
    ['5–20秒','等结算状态，指黑白积分','“合约实际结算，本局黑方净增10分、白方净减10分；最终余额以链上读取为准。”'],
    ['20–35秒','点击“通道实验室”，指3笔交易','“open、join、settle；交易可追到回执。”'],
    ['35–45秒','点击导出证据，再回PPT','“棋谱、签名与交易参考可以带走复核。”'],
], [2,5.9,9.3])
doc.add_heading('如果失败，用一句话转场',level=2)
para('“现场服务目前没有就绪。我切换到已保存的真实浏览器测试截图，继续说明同一条结算与验证链。”',True)
para('立即跳到备用17，指正常结算与末手拒签两张截图。截图属于已记录测试，不称实时结果。不刷新多次、不重装、不打开终端长时间排障。')
doc.add_heading('演示前10分钟核对',level=2)
para('① 电源、投影、分辨率、PPT全屏；② 服务与页面就绪；③ 知道演示按钮和实验室位置；④ 浏览器无账号/私钥等敏感页；⑤ 备用截图在PPT中可直接跳转；⑥ PDF打印页码齐全。')
label('可选职责','赵国豪主讲，谭海翔支持现场操作与技术问答；这是本次建议安排，按实际在场情况调整。')

# p8-p10 questions, 4 per page to preserve large print.
for qidx in range(3):
    page(f'备用问答 {qidx+1}/3｜先回答结论，再补依据','不把这些内容全部塞进8分钟主讲。每个回答控制在20–30秒，可指向对应PPT。')
    for j,(q,a,cue) in enumerate(D['questions'][qidx*4:(qidx+1)*4],qidx*4+1):
        doc.add_heading(f'Q{j:02d}  {q}',level=2)
        para(a)
        label('抓手',cue)

# p11 theory and proposed contributions check.
page('理论映射与分工核实卡','用于答辩准备，不作为虚构团队履历。概括理论时要能指出实际代码、文档或测试。')
table(['经典要求','项目中的具体体现'],[
    ['需求工程／追踪','NABCD→FR/NFR→验收；FR-14对应挑战与强制落子测试。'],
    ['抽象／信息隐藏','UI、控制器、共享规则、合约分离；AI和复盘复用协议与分析。'],
    ['状态建模／防御式验证','显式生命周期、争议更新严格更长且兼容原谱、时间边界、一次结算与守恒。'],
    ['验证与确认','81项＋18组验证列明行为；真人任务试用属于有效性确认，尚待开展。'],
    ['配置管理／增量改进','真实Git、锁文件、Docker、ADR、故障修复与回归日志。'],
], [4.1,13.1])
doc.add_heading('建议分工确认（请两人自己核实）',level=2)
para('谭海翔：代码实现、协议与合约、前后端集成、自动测试、缺陷修复与部署。\n赵国豪：选题与NABCD、需求验收、WBS和风险、文档与讲稿、用户试用组织。\n共同：接口与架构评审、结果核对、交付检查与彩排。')
para('核实前使用“职责建议／答辩安排”，不要声称历史提交、会议、工时或已有多人评审。项目历史含AI辅助，按实说明；能够解释和复核比声称全部手写更有说服力。',True)
label('评分缺口','真实反馈5%尚无记录；教案Gitee／Wiki口径、公开获取页保留1个月与独立试用仍需补充或确认。若来得及，邀请真实试用者完成任务，保存原话、问题与实际改进，不能填造评价。')

# p12 bibliography and evidence index.
page('依据与数据速查','主要课程依据已重读原始DOCX/PPTX；原课程文件只读，不随新材料复制。外文均为书目参考和中文概括。')
for cap,desc,url in D['references']:
    p=doc.add_paragraph();p.add_run(cap+'：').bold=True;p.add_run(desc+'\n'+url)
    p.paragraph_format.line_spacing=1.08;p.paragraph_format.space_after=WPt(8)
    for run in p.runs:run.font.size=WPt(10.5)
doc.add_heading('项目证据（相对源码根目录）',level=2)
for line in [
    '需求：docs/requirements.md；设计：docs/architecture.md、docs/adr-iteration-2.md。',
    '通过日志：artifacts/test-results/verify-final-iter2.log；浏览器：e2e-results.json、e2e-v2-results.json。',
    '公平对照：artifacts/test-results/contract-results.json 的 comparisons；9手3/11、436143/1231480；10手3/12、448105/1406433。',
    '真实问题：docs/bug-retrospective.md 的R5；tests/channel-client-ai.test.mjs。',
    '源码：https://github.com/haisiiontam/YiXin；截至本稿的在线代码与PPT可能处于不同提交，请按最新交付版使用。',
]:para(line,size=10.5)

docfile=O/'弈信-赵国豪答辩讲稿-打印版.docx';doc.save(docfile)
# Reopen and verify content, notes, native charts and shape boundaries.
check=Presentation(ppt)
assert len(check.slides)==19
assert len([sh for s in check.slides for sh in s.shapes if sh.has_chart])==2
assert all(s.has_notes_slide and s.notes_slide.notes_text_frame.text.strip() for s in check.slides)
assert len(Document(docfile).tables)==3
bounds=[]
for i,s in enumerate(check.slides,1):
    for sh in s.shapes:
        if min(sh.left,sh.top)<0 or sh.left+sh.width>check.slide_width+9144 or sh.top+sh.height>check.slide_height+9144:bounds.append([i,sh.name])
assert not bounds,bounds
spchars=sum(len(re.sub(r'\s','',d['speech'])) for d in D['mainSlides'])
validation={
    'version':D['version'],'generatedAt':D['date'],'mainSlides':16,'backupSlides':3,'slideCount':19,
    'targetSeconds':480,'speechCharacters':spchars,'speakerNotes':'19/19','nativeEditableCharts':2,
    'powerpoint':str(ppt),'speakerDocx':str(docfile),'shapeBounds':'passed',
    'comparisonSourceGeneratedAt':RESULT['generatedAt'],
    'comparisons':[{'moves':c['moveCount'],'channelTransactions':c['channel']['transactions'],'baselineTransactions':c['baseline']['transactions'],'channelGas':c['channel']['gasUsed'],'baselineGas':c['baseline']['gasUsed']} for c in comps],
    'proposedRolesNotHistorical':True,'actualSoftwareRetestedToday':False,
}
(R/'reports/defense-v3-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(validation,ensure_ascii=False,indent=2))
