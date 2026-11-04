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
AUDIT=R/'artifacts/test-results/trust-audit-2026-11-04'
RESULT=json.loads((AUDIT/'contract-results.json').read_text(encoding='utf8'))
AUDIT_SUMMARY=json.loads((AUDIT/'audit-summary.json').read_text(encoding='utf8'))
E2E=json.loads((AUDIT/'e2e-external-results.json').read_text(encoding='utf8'))
assert sum(x['seconds'] for x in D['mainSlides']) == 480
AS=R/'docs/assets/defense-v3'; AS.mkdir(exist_ok=True)
for name, original, box in [
    ('external-board.png','external-screenshots/03-external-settled.png',(378,451,1033,1105)),
    ('external-proof.png','external-screenshots/03-external-settled.png',(1137,1050,1495,1284)),
    ('external-header.png','external-screenshots/03-external-settled.png',(990,10,1495,80)),
    ('refusal-board-current.png','screenshots/07-refusal-recovery.png',(378,451,1033,1105)),
    ('refusal-proof-current.png','screenshots/07-refusal-recovery.png',(1110,1710,1502,1960)),
]:
    with Image.open(AUDIT/original) as im: im.crop(box).save(AS/name)

BG='F6F8F3'; WHITE='FFFFFF'; INK='20332B'; GREEN='28533D'; MUTED='617166'; LINE='D5DDD2'; PALE='E7EEE3'; GOLD='98753C'; RED='A63E32'
FONT='Microsoft YaHei'
prs=Presentation(); prs.slide_width=Inches(13.333); prs.slide_height=Inches(7.5)
prs.core_properties.title='弈·信｜软件工程重点答辩 V3 · 可信核验增强版'
prs.core_properties.author='谭海翔、赵国豪（建议职责安排，待成员核实）'
prs.core_properties.subject='两阶段争议、节点事实重建、独立钱包接入与可复核工程证据'

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
    txt(s,.55,.20,10,.22,'弈·信   /   可验证协作   /   V3 · 可信核验增强',10.5,True,MUTED)
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

# 01 / Product thesis, native and editable.
s=main(1,'汇报：赵国豪 · 项目：谭海翔 / 赵国豪 · 2026.11.04 · 本地实测')
txt(s,.76,2.20,8.7,1.30,'把信任写进协议，\n把结论交给证据。',35,True,GREEN)
for i,(a,b) in enumerate([('可交互产品','双人 / AI / 复盘'),('可执行协议','双签 / 争议 / 结算'),('可复核证据','节点 / 回执 / 回归')]):
    x=.79+i*3.08;txt(s,x,4.35,2.9,.5,a,24,True);txt(s,x,5.03,2.9,.5,b,17,False,MUTED)
rect(s,10.10,2.25,2.52,3.35,'EADBB9',None,True)
for i in range(7):
    a=10.39+i*.32
    q=s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(a),Inches(2.66), Inches(a),Inches(4.65));q.line.color.rgb=rgb('A89166')
    q=s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(10.39),Inches(2.66+i*.32), Inches(12.31),Inches(2.66+i*.32));q.line.color.rgb=rgb('A89166')
for i in range(5):
    q=s.shapes.add_shape(MSO_SHAPE.OVAL,Inches(10.55+i*.32),Inches(3.63),Inches(.26),Inches(.26));q.fill.solid();q.fill.fore_color.rgb=rgb(INK);q.line.fill.background()
txt(s,10.28,4.97,2.18,.4,'每一步信任，都有迹可循',10.5,True,GREEN,PP_ALIGN.CENTER)
band(s,'从可玩的应用，走向有约束、有验证、有交付依据的软件系统。')

# 02 / Course deliverable, tangible artifacts.
s=main(2,'课程教案：需求、设计、编码测试、创新、反馈；程序／数据／文档共同交付')
for i,(a,b,c) in enumerate([('程序','真实对弈与可执行退出','双人 / AI / 合约 / 外部钱包'),('数据','可核验的过程与结果','棋谱 / 双签\n节点事件 / 回执'),('文档','可追踪的工程决策','NABCD / FR-NFR\nADR / 日志')]):
    card(s,.72+i*4.05,2.14,3.84,2.62,a,b+'\n'+c,body_size=18)
weights=[('需求',20),('设计',35),('实现测试',30),('创新',10),('反馈',5)];x=.8
for label,w in weights:
    rect(s,x,5.10,w*.115,.42,GREEN if label in ('设计','实现测试') else GOLD)
    txt(s,x,5.63,max(1.08,w*.115+.12),.38,f'{label} {w}%',13,True);x+=w*.115
band(s,'把课程要求变成可检查的产物，再把产物连成证据链。')

# 03 / NABCD, local course definition.
s=main(3,'教案NABCD：D = Delivery／推广；真实用户需求确认仍待补充')
items=[('N','需求','顺畅下棋，结算时能核验积分来源'),('A','做法','完整谱双签＋合约重放＋两阶段争议'),('B','收益','正常3笔交易；证据可带走，异常有退出路径'),('C','替代','中心化记分 / 每步上链 / 状态通道'),('D','推广','GitHub源码＋启动说明＋课堂演示')]
for i,(letter,cap,body) in enumerate(items):
    y=2.07+i*.73;rect(s,.73,y,.51,.48,GREEN,None,True);txt(s,.73,y+.04,.51,.40,letter,20,True,WHITE,PP_ALIGN.CENTER)
    txt(s,1.48,y+.02,1.6,.48,cap,21,True,GREEN);txt(s,3.15,y+.01,9.2,.55,body,20)
band(s,'选型服务于可核验结算，同时承担存证与争议监控成本。')

# 04 / Risk driven increments, current third iteration.
s=main(4,'44项WBS是任务计划；不把计划工时或建议分工当作真实执行历史')
for i,(n,title,body) in enumerate([('01','先验证核心闭环','双人开局 · EIP-712双签\n棋谱重放 · 积分结算\n异常与恢复入口'),('02','再扩展产品体验','三档AI · 复盘 · 提示\nSVG证书 · 日夜主题\n共享规则与分析器'),('03','用对抗验证强化可信','旧快照攻击回归\n两阶段争议 · 证据重建\n独立RPC · 外部钱包')]):
    x=.73+i*4.05;txt(s,x,2.12,3.7,.5,n,30,True,GOLD);card(s,x,2.9,3.83,2.85,title,body,body_size=19)
band(s,'风险驱动增量：先能运行，再改善体验，再用反例审视可信假设。')

# 05 / Requirement traceability.
s=main(5,'FR-14 / AT-06；contracts/GomokuChannel.sol；本轮Edge拒签恢复实测')
for i,(a,b) in enumerate([('需求','对手拒签末手\n仍能完成合法结算'),('设计','先举证，再响应\n显式状态与期限'),('实现','challenge\nproofDeadline / forceMove'),('验收','8手双签快照\n链上第9手成胜局')]):
    card(s,.73+i*3.07,2.25,2.82,3.0,a,b,body_size=19)
    if i<3:arrow(s,3.59+i*3.07,3.60,.17)
txt(s,.91,5.57,11.6,.43,'四笔成功交易：open + join + challenge + forceMove',20,True,GREEN)
band(s,'一条需求贯穿模型、代码与可复现验收，而非停留在功能清单。')

# 06 / Information hiding with explicit dual mode seam.
s=main(6,'Parnas信息隐藏；共享规则／控制器／合约独立；新争议ABI需新部署')
for i,(a,b) in enumerate([('展示与体验','React界面\n复盘 / 提示 / 证书'),('会话与恢复','签名 / 快照保护\n重连 / 钱包会话失效'),('规则与核验','全谱合法性 / EIP-712\n节点状态 / 回执重建'),('权威结算','Solidity + OpenZeppelin\n锁分 / 争议 / 守恒')]):
    x=.73+i*3.07;card(s,x,2.18,2.82,2.92,a,b,body_size=18)
rect(s,.81,5.39,5.70,.54,PALE,None,True);txt(s,1.02,5.50,5.3,.36,'本地模式：Ganache + 测试钱包',18,True,GREEN)
rect(s,6.79,5.39,5.72,.54,PALE,None,True);txt(s,6.98,5.50,5.33,.36,'外部模式：独立RPC + 用户钱包',18,True,GREEN)
band(s,'按职责与易变决策划分边界，让接入方式和体验升级有清晰落点。')

# 07 / Happy path and trust binding.
s=main(7,'已注册玩家正常路径；部署、注册与争议另计；签名不等于上链交易')
for i,(n,a,b) in enumerate([('1','OPEN','黑方锁定积分'),('2','JOIN','白方锁定积分'),('3','SETTLE','合约验签、重放、结算')]):
    x=.88+i*4.03;rect(s,x,2.18,.6,.6,GREEN,None,True);txt(s,x,2.27,.6,.4,n,22,True,WHITE,PP_ALIGN.CENTER)
    txt(s,x+.82,2.23,2.94,.5,a,24,True,GREEN);txt(s,x,3.00,3.68,.58,b,20)
    if i<2:arrow(s,x+3.5,2.35,.25)
rect(s,.86,4.03,11.6,1.42,PALE,None,True)
txt(s,1.08,4.24,11.2,.45,'链下每手：提案 → 双方独立校验 → 签同一份完整有序棋谱',22,True,GREEN)
txt(s,1.08,4.90,11.2,.35,'绑定 chainId + 合约 + channelId + movesHash，结算不信任前端自报赢家。',16.5,False,MUTED)
band(s,'即时交互留在链下，授权与规则由签名和合约共同约束。')

# 08 / Critical two-phase timeline, native editable shapes.
s=main(8,'当前协议：proofDeadline = now + Δ；deadline = now + 2Δ；默认Δ=60秒')
for x,cap in [(.94,'挑战开始 t₀'),(6.12,'proofDeadline'),(10.88,'deadline')]:txt(s,x,2.08,2.0,.45,cap,17,True,GREEN)
rect(s,.88,2.77,5.60,1.05,PALE,None,True);rect(s,6.61,2.77,5.77,1.05,GREEN,None,True)
txt(s,1.12,3.02,5.1,.5,'证据提交期｜接纳更新双签',23,True,GREEN)
txt(s,6.87,3.02,5.2,.5,'链上响应期｜当前方强制落子',22,True,WHITE)
txt(s,1.00,4.10,5.35,1.21,'严格更长且兼容旧前缀\n成功更新会重置两期限\n期间禁止 forceMove',19)
txt(s,6.80,4.10,5.2,1.21,'proofDeadline ≤ 链时间 < deadline\n非终局续手只延响应期\n到期当前应落子者判负',18.5)
band(s,'先给诚实方完整举证机会，再允许链上续走；兼容双签终局仍可结算。')

# 09 / Three proof layers, no file-self-report metrics.
s=main(9,'共享核验：evidence.mjs + evidence-chain.mjs；固定区块分页扫描成功通道事件')
for i,(a,b) in enumerate([('授权可验','严格4字段签名域\n65字节标准双签\n棋谱顺序与身份绑定'),('状态可验','实际链ID与合约摘要\n真实链上谱与参与者\n代码符合配置的指纹'),('计量可验','从事件重建成功交易\n从receipt读取Gas\n核对区块与回执一致')]):
    card(s,.73+i*4.05,2.18,3.83,3.15,a,b,body_size=20)
txt(s,.93,5.60,11.6,.36,'导入与中继恢复共同保护最新双签；未完整核对时只显示已观测交易。',17,True,GREEN)
band(s,'把文件中的声明，逐层对应到授权证明、链状态和可复核回执。')

# 10 / Independent ingress and user's wallet boundary.
s=main(10,'已实测：独立本机HTTP节点 + EIP-1193钱包装置；未公网部署／真人插件验收')
for i,(a,b) in enumerate([('用户钱包','私钥由钱包保管\n连接不发交易\n注册单独确认'),('应用会话','固定预期链与账户\n账户或网络变更即失效\n异步读数不复活旧会话'),('独立节点','核验链ID／代码指纹\n域／周期／9字段布局\n只代理明确允许的方法')]):
    x=.73+i*4.05;card(s,x,2.15,3.83,3.20,a,b,body_size=19)
    if i<2:arrow(s,x+3.87,3.62,.15)
txt(s,.92,5.62,11.5,.36,'external关闭本地注资、自动部署与AI代签；旧ABI在开局付Gas前拒绝。',17,True,GREEN)
band(s,'接入可替换，密钥不托管，部署身份有锚，信任依赖可说明。')

# 11 / Reconciled current test groups, no historical counts mixed in.
s=main(11,'2026-11-04分批实跑；测试组数不是用户数、游戏数或安全认证')
for i,(n,a,b) in enumerate([('21','协议与合约','合约14 / 争议3\n规则4'),('37','接入与核验','部署HTTP 13 / 证据9\n钱包7 / 连接竞态8'),('47','恢复与计量','回退与故障恢复\n完整回执、缓存与重试'),('39','体验与输出','30 AI + 9证书')]):
    x=.74+i*3.07;rect(s,x,2.16,2.82,3.28,WHITE,LINE,True);txt(s,x+.2,2.40,2.42,.7,n,39,True,GREEN);txt(s,x+.2,3.35,2.42,.5,a,21,True);txt(s,x+.2,4.13,2.42,1.0,b,15.5,False,MUTED)
txt(s,.96,5.70,11.5,.36,'144项自动测试通过  +  14组浏览器场景通过（本地8 / 外部6）',21,True,GREEN)
band(s,'成功路径与拒绝路径共同覆盖：先找能推翻设计的反例，再证明修复有效。')

# 12 / Same-input native editable charts, current artifact.
comps=RESULT['comparisons']
s=main(12,'同参与方、stake、棋谱、编译环境；部署和注册另列；数据来自本轮真实receipt')
for x,title,kind,div in [(.75,'成功交易数 / 笔','transactions',1),(6.90,'Gas / 千单位','gasUsed',1000)]:
    txt(s,x+.08,2.07,5.5,.4,title,21,True,GREEN)
    data=CategoryChartData();data.categories=[f"{c['moveCount']}手" for c in comps]
    data.add_series('逐手上链',[int(c['baseline'][kind])/div for c in comps]);data.add_series('双签通道',[int(c['channel'][kind])/div for c in comps])
    chart=s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED,Inches(x),Inches(2.58),Inches(5.58),Inches(2.77),data).chart
    chart.has_legend=True;chart.legend.position=XL_LEGEND_POSITION.BOTTOM;chart.legend.font.name=FONT;chart.legend.font.size=Pt(12)
    chart.category_axis.tick_labels.font.size=Pt(12);chart.value_axis.tick_labels.font.size=Pt(11);chart.value_axis.minimum_scale=0;chart.chart_style=10
    for ser,color in zip(chart.series,[GOLD,GREEN]):ser.format.fill.solid();ser.format.fill.fore_color.rgb=rgb(color);ser.format.line.fill.background()
    chart.plots[0].has_data_labels=True;labs=chart.plots[0].data_labels;labs.font.size=Pt(11);labs.position=XL_LABEL_POSITION.OUTSIDE_END;labs.number_format='0.0' if div>1 else '0'
txt(s,.90,5.55,5.6,.48,'9手：11 → 3，笔数减少72.73%',20,True,GREEN)
txt(s,7.03,5.55,5.5,.48,'9手：1,231,600 → 436,155',19,True,GREEN)
band(s,'Gas降幅：9手64.59%，10手68.14%；仅限本地样本，不外推公网TPS与费用。')

# 13 / Actual adversarial defect and red-green closure.
s=main(13,'真实回滚与结算hash见contract-results.json；修复前反例和失败过程完整保留')
card(s,.74,2.14,5.78,3.63,'发现：旧快照可以抢先形成分叉','已有：双方签过的9手胜局\n攻击：旧1手挑战 → 立即强制分叉\n后果：最新终局被前缀检查挡住',body_size=20)
card(s,6.79,2.14,5.78,3.63,'修复：先举证，再允许改变链上谱','设计：完整proof窗口 + response窗口\n实测：恶意force交易 status = 0\n恢复：已有9手双签 settle成功',fill=PALE,body_size=20)
band(s,'从可复现反例，到协议调整，再到真实交易回归：工程质量来自可验证的改进。')

# 14 / Configuration and deployment provenance.
s=main(14,'Git／锁文件／manifest／audit-summary；hash匹配配置锚，不等于RPC绝对可信')
for i,(a,b) in enumerate([('版本可追','源码与锁文件\nADR与工程日志\n主讲稿与生成源一致'),('部署可辨','artifact / runtime指纹\n构造参数与链指纹\n旧部署拒绝静默复用'),('结果可复核','原始成功与失败记录\n截图与实际回执\n源文件与结果SHA-256')]):
    card(s,.74+i*4.05,2.18,3.83,3.15,a,b,body_size=20)
txt(s,.94,5.62,11.5,.36,'升级使用独立新运行目录，保留旧链；交付过程不靠清空状态掩盖差异。',17,True,GREEN)
band(s,'交付的不只是一个文件，而是能够定位版本、部署与证据的可检查成果。')

# 15 / Forty-five-second live normal-path demo; actual screenshot as evidence.
s=main(15,'现场用新运行目录启动Node4173；旧Docker4180本轮未重建；15秒未就绪切备用17')
for i,(n,a,b) in enumerate([('01','运行9手自动演示','脚本双钱包，真实双签与合约结算'),('02','核对实验室记录','本局3笔成功回执，积分变化可读'),('03','导出证据JSON','棋谱、签名和交易可以再次核验')]):
    y=2.18+i*1.12;rect(s,.84,y,.62,.62,GREEN,None,True);txt(s,.86,y+.12,.58,.4,n,21,True,WHITE,PP_ALIGN.CENTER)
    txt(s,1.72,y+.01,5.35,.45,a,23,True,GREEN);txt(s,1.72,y+.58,5.35,.43,b,17)
picture(s,AS/'external-board.png',8.01,2.15,3.64,3.64)
txt(s,7.45,5.80,4.9,.35,'右图：本轮独立RPC验收的终局局部',13,False,MUTED,PP_ALIGN.CENTER)
band(s,'现场演示正常路径；拒签需要等待证据期，使用已保存真实记录解释。')

# 16 / Bounded but strong outcome.
s=main(16,'源码与材料：https://github.com/haisiiontam/YiXin · 无资产价值积分 · 非第三方审计')
for i,(k,v) in enumerate([('产品能体验','双人 / AI / 复盘 / 可带走证据'),('协议有约束','双签授权 / 两阶段争议 / 守恒'),('结论有依据','144项回归 / 14组浏览器 / 原始回执')]):
    x=.76+i*4.05;rect(s,x,2.25,3.82,2.42,GREEN,None,True);txt(s,x+.22,2.62,3.38,.5,k,25,True,WHITE);txt(s,x+.22,3.48,3.38,.8,v,17,False,WHITE)
txt(s,.92,5.05,11.5,.88,'下一步：真实用户任务观察、本人钱包插件联调、经授权选择实际目标网络。',21,True,GREEN)
band(s,'让设计可解释，让异常可执行，让结果可复核。')

# 17 / Actual current evidence, both from Nov 4 browser tests.
s=base('备用17｜正常结算与拒签恢复，均有真实回执','本轮保存的浏览器截图；左为独立RPC正常局，右为本地拒签恢复，非现场画面','来源：trust-audit-2026-11-04 的 external-screenshots/03 与 screenshots/07',notes='演示失败即切本页。左正常3笔、双签9手、1010/990；右为8手双签后challenge，完整证据期后链上第9手成胜局，共4笔。两局不同实例，Gas和余额不能混写。截图为2026-11-04保存，不声称实时公网或真人MetaMask。')
txt(s,.83,2.07,5.6,.42,'正常结算｜9手双签 · 3笔成功交易',20,True,GREEN)
txt(s,6.94,2.07,5.5,.42,'末手拒签｜8手双签 → 链上第9手',20,True,GREEN)
picture(s,AS/'external-board.png',.77,2.76,3.10,3.10);picture(s,AS/'external-proof.png',4.04,3.19,2.51,2.08)
picture(s,AS/'refusal-board-current.png',6.93,2.76,3.10,3.10);picture(s,AS/'refusal-proof-current.png',10.17,3.19,2.44,2.08)
band(s,'记录含棋谱、双签、交易与状态；场景不同，按各自实例独立复核。')

# 18 / Truth scope, concise and unambiguous.
s=base('备用18｜信任边界清楚，接入条件明确','真实执行、独立接入能力与公网验收是不同层次，按已完成范围回答','依据：trust-audit-2026-11-04.md / external-chain.md / e2e-external-results.json',notes='回答“到底真实还是模拟”。Solidity、EIP712和结算是真实执行；默认教学单节点、AI双钱包是装置；external已接独立本机HTTP并用EIP1193钱包装置联调。公网、真人插件、第三方审计均未冒称。hash是运营者信任锚，RPC可能说谎；失败交易不在成功事件计量中，合约报告另列预期revert。')
row(s,2.07,['层次','本轮已完成','进一步验收条件'],[2.0,5.2,4.8],16,True)
for i,vals in enumerate([
    ['合约／签名','真实EVM、规则重放、双签结算','列明场景的内部验证，非安全认证'],
    ['节点／钱包','独立HTTP RPC + EIP-1193装置','本人浏览器钱包插件实际联调'],
    ['网络／共识','本地Ganache及独立本机节点','授权选择公网或其他目标网络'],
    ['资产／身份','无资产价值的积分；每地址注册','不当成现实资产或防女巫信誉'],
    ['用户／运营','自动浏览器场景、证据交付','真人任务反馈、持续运行与监控'],
]):row(s,2.85+i*.60,vals,[2.0,5.2,4.8],14.3)
band(s,'边界可说明，结论有依据；接入能力已交付，目标网络由实际授权配置。')

# 19 / Methods and references, mapped to actual engineering work.
s=base('备用19｜经典工程方法，在实现与验证中落地','理论用于解释决策；数据来自项目实测，不以术语替代证据','课程NABCD（D=Delivery）；Parnas 1972；SWEBOK；具体书目与链接见打印稿',notes='方法映射为概括，不是原文引语或标准认证。Parnas DOI10.1145/361598.361623；SWEBOK为知识域组织，不是固定阶段。建议职责与AI辅助按实际说明，不编造既往分工或会议。')
row(s,2.07,['工程原则','项目落点','可检查的产物'],[2.6,5.2,4.2],16,True)
for i,vals in enumerate([
    ['需求与确认','NABCD、FR/NFR、验收行为','需求追踪／真人反馈待补'],
    ['抽象与信息隐藏','UI、会话、规则、节点、合约分责','模块接口／ADR'],
    ['状态与不变量','先举证后响应、前缀、守恒、一次结算','修订协议／合约反例'],
    ['分层验证与回归','授权、链状态、节点计量各自核验','144项／14组／原始失败'],
    ['配置管理与交付','部署身份、版本与结果指纹','manifest／Git／SHA-256'],
]):row(s,2.85+i*.60,vals,[2.6,5.2,4.2],14.5)
band(s,'软件工程价值：将抽象原则转化为具体约束、可执行行为和可复核证据。')

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
f.add_run('2026.11.04  ·  第 ')
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
    has_content=len(doc.paragraphs)>2
    heading=doc.add_heading(title,level=1)
    heading.paragraph_format.page_break_before=has_content
    if sub:para(sub,size=10.5)

def table(headers,rows,widths=None):
    t=doc.add_table(rows=1,cols=len(headers));t.style='Table Grid';t.autofit=False
    if widths:
        for column,width in zip(t.columns,widths):column.width=Cm(width)
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
para('把信任写进协议，把结论交给证据。',True,17)
label('三个优势','可交互产品；可执行的两阶段争议；从节点重建的可复核证据。')
label('三个动作','讲清FR-14追踪；讲透旧快照攻击与两阶段修复；展示真实结算与证据出口。')
table(['时段','页码','该讲什么'],[
    ['0:00–1:20','1–3','定位、课程交付、NABCD'],
    ['1:20–3:30','4–7','迭代、追踪、模块化、三笔机制'],
    ['3:30–4:50','8–10','两阶段争议、节点核验、独立钱包'],
    ['4:50–6:25','11–13','分层验证、实测对照、真实Bug'],
    ['6:25–8:00','14–16','版本与交付、45秒演示、总结'],
], [3,2,12.2])
label('最关键的数','正常3笔；拒签示例4笔；144项自动测试＋14组浏览器；9手11→3笔、Gas降低64.59%。')
label('三个口径','D=Delivery推广；数据为2026-11-04本地实测；external已验证独立HTTP节点与钱包装置，未公网或真人插件验收。')
label('控时底线','第15页演示15秒未就绪即切备用17；若超时压缩第2、3、14页，保留第8、9、10、13页核心贡献。')

# p2-p6 speaker grouped, use same speech as PPT notes.
cum=0
meta=[]
for i,d in enumerate(D['mainSlides'],1):
    begin=cum;cum+=d['seconds']
    meta.append((i,d,f'{begin//60}:{begin%60:02d}–{cum//60}:{cum%60:02d}'))
for group,title in [((1,2,3),'主讲①｜先立住价值与课程对应'),((4,5,6),'主讲②｜用工程产物解释设计'),((7,8,9),'主讲③｜协议与证据的核心设计'),((10,11,12),'主讲④｜独立接入与量化验证'),((13,14),'主讲⑤｜对抗性改进与可信交付'),((15,16),'主讲⑥｜现场演示与收束')]:
    page(title,'粗体句为本页重点；“提醒”不必读出。可用自己的语言改写，保持数字与边界一致。')
    for idx in group:
        i,d,span=meta[idx-1]
        doc.add_heading(f"P{i:02d}  {d['title']}｜{d['seconds']}秒｜{span}",level=2)
        para(d['key'],True)
        para(d['speech'])
        label('提醒',d.get('printCue',d['cue']))

# p7 demo checklist.
page('演示操作卡｜别在现场修环境','这一页用于上台前与第15页。现场演示占45秒，问答时间另计。')
table(['顺序','动作','台词／检查'],[
    ['上台前','用新RUNTIME_DIR启动Node4173','旧Docker4180未按本轮新协议重建，勿直接用旧ABI/旧运行目录；确认新服务就绪且无活动局。'],
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
    for j,(q,a,cue) in enumerate(D.get('printQuestions',D['questions'])[qidx*4:(qidx+1)*4],qidx*4+1):
        doc.add_heading(f'Q{j:02d}  {q}',level=2)
        para(a)
        label('抓手',cue)

# p11 theory and proposed contributions check.
page('理论映射与分工核实卡','用于答辩准备，不作为虚构团队履历。概括理论时要能指出实际代码、文档或测试。')
table(['经典要求','项目中的具体体现'],[
    ['需求工程／追踪','NABCD→FR/NFR→验收；FR-14对应挑战与强制落子测试。'],
    ['抽象／信息隐藏','UI、控制器、共享规则、合约分离；AI和复盘复用协议与分析。'],
    ['状态建模／对抗性验证','完整举证期在响应期之前；更新严格兼容；等号边界、旧快照攻击、一次结算与守恒。'],
    ['验证与确认','144项自动测试＋14组浏览器验证列明行为；真人任务与钱包插件验收仍待开展。'],
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
    '本轮根目录：artifacts/test-results/trust-audit-2026-11-04/；audit-summary.json汇总144＋14及SHA-256。',
    '公平对照：本轮contract-results.json的comparisons；9手3/11、436155/1231600；10手3/12、448093/1406433。',
    '真实反例：before-fix/dispute-security-results.json；修复：contract-results.json、dispute-security-results.json。',
    '接入与边界：docs/external-chain.md、docs/trust-audit-2026-11-04.md；源码：https://github.com/haisiiontam/YiXin。',
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
    'auditSummary':str(AUDIT/'audit-summary.json'),'automaticTests':144,'browserScenarios':14,
    'publicDeployment':False,'liveWalletExtensionAcceptance':False,
    'v2Sha256':hashlib.sha256((O/'弈信-8分钟课程答辩.pptx').read_bytes()).hexdigest(),
    'comparisons':[{'moves':c['moveCount'],'channelTransactions':c['channel']['transactions'],'baselineTransactions':c['baseline']['transactions'],'channelGas':c['channel']['gasUsed'],'baselineGas':c['baseline']['gasUsed']} for c in comps],
    'proposedRolesNotHistorical':True,'actualSoftwareRetestedToday':True,
}
(R/'reports/defense-v3-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(validation,ensure_ascii=False,indent=2))
