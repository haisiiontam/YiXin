"""Edit the retained V3 template, preserving native charts, theme and slide order.

Product results are read, never invented or rerun by this artifact builder.
Use the bundled Python runtime and render-defense.ps1 for native Office QA.
"""
from copy import deepcopy
from pathlib import Path
import hashlib
import json
from PIL import Image
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from docx import Document
from docx.shared import Cm, Pt as WPt, RGBColor as WColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

R=Path(__file__).resolve().parents[1]
OUT=R/'reports'; AS=R/'docs/assets/defense-v4'; AS.mkdir(parents=True,exist_ok=True)
D=json.loads((R/'docs/defense-v4-content.json').read_text(encoding='utf8'))
Q=json.loads((R/'artifacts/test-results/recovery-2026-11-05/review-summary.json').read_text(encoding='utf8'))
assert Q['unitAndIntegration']=={'passed':163,'failed':0}
assert Q['browserScenarios']=={'passed':20,'failed':0}
assert sum(d['seconds'] for d in D['mainSlides'])==480
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
for path,digest in Q['sourceSha256'].items(): assert sha(R/path)==digest,path
for suite in Q['finalSuites']: assert sha(R/suite['file'])==suite['sha256'],suite['file']

FONT='Microsoft YaHei'; BG='F6F8F3'; INK='20332B'; GREEN='28533D'; MUTED='617166'; LINE='D5DDD2'; PALE='E7EEE3'
P=Presentation(R/'reports/弈信-8分钟课程答辩-V3.pptx')
assert len(P.slides)==19
P.core_properties.title='弈信软件工程课程答辩 V4 可靠恢复与人本设计'
P.core_properties.author='谭海翔、赵国豪；AI辅助实施与材料同步'
P.core_properties.subject='接口契约、故障恢复、幂等确认、可解释助手与授权前错误预防'

def replace_text(shape,text,size=None):
    tf=shape.text_frame
    first=tf.paragraphs[0]
    properties=deepcopy(first._p.pPr) if first._p.pPr is not None else None
    runprops=deepcopy(first.runs[0]._r.rPr) if first.runs and first.runs[0]._r.rPr is not None else None
    tf.clear()
    for i,line in enumerate(text.split('\n')):
        para=tf.paragraphs[0] if i==0 else tf.add_paragraph()
        if properties is not None:
            if para._p.pPr is not None:para._p.remove(para._p.pPr)
            para._p.insert(0,deepcopy(properties))
        run=para.add_run();run.text=line
        if runprops is not None:run._r.insert(0,deepcopy(runprops))
        if size:run.font.size=Pt(size)

for slide in P.slides:
    for shape in slide.shapes:
        if shape.has_text_frame and shape.text:
            new=shape.text.replace('V3 · 可信核验增强','V4 · 可靠恢复与人本设计')
            if new!=shape.text:replace_text(shape,new)

for i,item in enumerate(D['mainSlides']):
    slide=P.slides[i]
    replace_text(slide.shapes[1],item['title'],27 if len(item['title'])>26 else 29)
    replace_text(slide.shapes[2],item['subtitle'],15)
    slide.notes_slide.notes_text_frame.text=(f"第{i+1}页｜{item['seconds']}秒\n核心：{item['key']}\n\n【讲稿】{item['speech']}\n\n【动作与提醒】{item['cue']}\n【证据】{item['evidence']}")

edits={
1:{5:'汇报：赵国豪 · 本轮新增代码与模块设计：谭海翔 · 2026.11.05'},
4:{1:'按风险迭代 先闭环再检验失败',5:'课程增量与真实反例；不把计划工时或旧建议分工当成履历'},
5:{5:'FR-32 / AT-13；GameRepository / retryCheckpointSave；真实Edge配额故障',9:'保存失败也能备份\n禁止继续扩大授权',13:'内存双签留存\n保存状态显式建模',17:'GameRepository\n暂停签名 / 重试保存',21:'磁盘0手，内存1手\n导出验签后继续结算',22:'故障闭环：写失败 → 导出双签 → 恢复保存 → 九手结算',24:'把异常后的状态写成契约，再用真实故障验证承诺。'},
6:{5:'新增存储仓库与纯策略；既有规则、签名域及合约ABI保持兼容',8:'呈现与防误触',9:'键盘单一入口\n坐标确认 / 可取消',11:'会话与连接',12:'验证后再完成连接\n过期回调隔离\n原房续接 / 幂等确认',14:'存储与恢复策略',15:'仓库隐藏存储表示\n纯策略只读建议',17:'规则与权威结算',18:'合法棋谱 / EIP-712\n节点核验 / 合约守恒',24:'存储表示、恢复建议和授权副作用分开，控制器仍有进一步拆分空间。'},
11:{5:'2026-11-05最终重跑；原始失败与结果摘要保留，自动验收不替代真人测试',8:'144',9:'既有自动回归',10:'规则 / 合约 / 接入\nAI / 证书 / 恢复计量',12:'19',13:'新增故障与策略',14:'配额 / 损坏 / 会话\nACK幂等 / 期限边界',16:'14',17:'既有浏览器场景',18:'本地双人8组\n独立RPC与钱包6组',20:'6',21:'新增恢复场景',22:'配额导出 / 续接结算\n键盘 / 触屏 / 确认',23:'163项自动测试通过 + 20组浏览器场景通过',25:'同一规格要约束正常返回，也要约束失败后系统留下的状态。'},
12:{5:'2026-11-05全套重跑的真实receipt；等输入；部署注册另列，限本地样本'},
13:{5:'before-fix / before-ack-fix / 外部首次失败均保留；对应回归最终5/5通过',8:'发现：授权之后，恢复条件可能失效',9:'配额写满：报错后仍能继续签名\n认证前断线：连接等待不结束\n迟到签名 / 重复广播：旧发送与多弹窗',11:'修复：保存契约与连接生命周期',12:'内存可导出，保存失败暂停授权\n取消、关闭和超时都有明确终态\n会话身份约束；重复ACK复用授权',14:'先复现能推翻设计的情况，再验证修复后的浏览器操作路径。'},
14:{5:'本轮新增归属按用户明确指定；AI辅助如实说明，不倒填旧提交或人工验收',8:'谭海翔',9:'存储仓库 / 恢复策略\n重连生命周期 / ACK幂等\n键盘棋盘 / 坐标确认',11:'对应工程产物',12:'ADR / FR-32至35追踪\n故障回归 / 浏览器验收\n原始失败 / 哈希摘要',14:'赵国豪',15:'课程答辩主讲\n使用同步PPT与讲稿\n现场演示与技术问答',16:'AI辅助实现、审查与材料；成员需能解释和复核，历史贡献仍按实际核对。',18:'新增工作指向具体模块、设计决策和验收证据。'},
15:{5:'现场使用新运行目录；15秒未就绪切备用17；恢复装置画面见备用20/21',13:'先看安心助手，再核对回执',14:'保存、签名与结算分开显示',17:'备份本局证据',18:'导出双签，再看实验室三笔交易',20:'右图：2026-11-04独立RPC历史验收',22:'现场演示正常结算；故障恢复与误触取消见备用20、21页。'},
16:{8:'体验可恢复',9:'原房续接 / 备份重试 / 误触确认',15:'163项回归 / 20组浏览器',16:'下一步：真人与读屏器验收、钱包插件联调、课程公开获取页。',18:'用故障检验契约，让设计原则延伸到用户操作。'},
19:{1:'备用19 大学课程原则如何落到本项目',2:'资料是设计依据；项目结论来自代码与实际运行',5:'MIT 6.102规格/测试；MIT HCI；Stanford CS147作业7；完整链接在备注及讲稿',14:'MIT 接口契约',16:'保存失败仍可导出，后续签名暂停',18:'FR-32 / 配额故障回归',20:'抽象与信息隐藏',22:'存储表示、建议策略与授权副作用分离',24:'Repository / 纯策略 / ADR',26:'MIT 分区与边界',28:'写失败/损坏/拒绝；期限等号两侧',30:'19项新增故障与策略',32:'HCI 预防与恢复',34:'状态解释、原房续接、签名前取消',36:'6组真实浏览器恢复',38:'Stanford 评审范围',40:'针对已实现交互，区分自动与真人验证',42:'逐项批判 / 真人验收待补',44:'概念必须能指到一项可观察行为，以及一份可检查的结果。'},
}
for page,mapping in edits.items():
    for index,value in mapping.items():replace_text(P.slides[page-1].shapes[index],value)
# The iteration slide retains three columns but groups the first two old rounds.
s=P.slides[3]
for shape in s.shapes:
    if not shape.has_text_frame:continue
    mapping={'先验证核心闭环':'核心闭环与体验','再扩展产品体验':'检验可信假设','用对抗验证强化可信':'完善可靠恢复',
    '双人开局 · EIP-712双签\n棋谱重放 · 积分结算\n异常与恢复入口':'全谱双签 / 真实结算\nAI / 复盘 / 证书\n核心与体验两轮',
    '三档AI · 复盘 · 提示\nSVG证书 · 日夜主题\n共享规则与分析器':'旧快照攻击回归\n两阶段争议 / 节点核验\n独立RPC / 外部钱包',
    '旧快照攻击回归\n两阶段争议 · 证据重建\n独立RPC · 外部钱包':'配额失败 / 迟到回调\n原房续接 / ACK幂等\n安心助手 / 键盘确认'}
    if shape.text in mapping:replace_text(shape,mapping[shape.text])
for i in (16,17,18):
    notes=P.slides[i].notes_slide.notes_text_frame.text
    P.slides[i].notes_slide.notes_text_frame.text=notes.replace('本轮','2026-11-04历史验收')
replace_text(P.slides[16].shapes[2],'2026-11-04保存的浏览器截图；正常与拒签均为已记录本地验收，非现场画面')
replace_text(P.slides[16].shapes[1],'备用17 正常结算与末手拒签的真实回执',28)
P.slides[18].notes_slide.notes_text_frame.text='本轮工程方法资料与事实来源。\n'+'\n'.join(f'{cap}：{desc}\n{url}' for cap,desc,url in D['references'])+'\n对应：docs/engineering-review-2026-11-05.md。'
for page in (4,5,6,11,13):
    P.slides[page-1].notes_slide.notes_text_frame.text+='\n大学资料：\n'+'\n'.join(x[2] for x in D['references'][:4])

shots=R/'artifacts/test-results/recovery-2026-11-05/final-after-ack/recovery-screenshots'
crops=[('storage-assistant.png','02-storage-protection.png',(1124,750,1510,1250)),('coordinate-confirmation.png','01-coordinate-confirmation.png',(530,818,1010,1080)),('touch-board.png','05-touch-390.png',(0,280,390,865))]
provenance=[]
for name,source,box in crops:
    with Image.open(shots/source) as im: im.crop(box).save(AS/name)
    provenance.append({'output':name,'source':str((shots/source).relative_to(R)).replace('\\','/'),'crop':box,'sourceSha256':sha(shots/source)})
(AS/'provenance.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2),encoding='utf8')

def textbox(slide,x,y,w,h,text,size=20,bold=False,color=INK):
    q=slide.shapes.add_textbox(Inches(x),Inches(y),Inches(w),Inches(h));tf=q.text_frame;tf.word_wrap=True
    tf.margin_left=0;tf.margin_right=0;tf.margin_top=0;tf.margin_bottom=0
    for i,line in enumerate(text.split('\n')):
        para=tf.paragraphs[0] if i==0 else tf.add_paragraph();para.space_after=Pt(10)
        run=para.add_run();run.text=line;run.font.name=FONT;run.font.size=Pt(size);run.font.bold=bold;run.font.color.rgb=RGBColor.from_string(color)
        ea=OxmlElement('a:ea');ea.set('typeface',FONT);run._r.get_or_add_rPr().append(ea)
    return q
def picture(slide,path,x,y,w,h):
    with Image.open(path) as im: iw,ih=im.size
    ratio=min(w/iw,h/ih);return slide.shapes.add_picture(str(path),Inches(x+(w-iw*ratio)/2),Inches(y+(h-ih*ratio)/2),width=Inches(iw*ratio),height=Inches(ih*ratio))
def backup(title,sub,notes):
    slide=P.slides.add_slide(P.slide_layouts[6]);slide.background.fill.solid();slide.background.fill.fore_color.rgb=RGBColor.from_string(BG)
    textbox(slide,.57,.22,11,.3,'弈·信 / V4 可靠恢复与人本设计',11,True,MUTED)
    textbox(slide,.58,.70,12,.55,title,29,True)
    textbox(slide,.60,1.37,12,.5,sub,15,False,MUTED)
    textbox(slide,.60,7.03,11,.25,'本轮自动Edge验收保存画面；非真人试用；未公网部署',10,False,MUTED)
    textbox(slide,12.1,7.03,.6,.25,str(len(P.slides)),11,True,GREEN)
    slide.notes_slide.notes_text_frame.text=notes
    return slide
s=backup('备用20 先保住最新双签再继续对局','真实浏览器故障注入；旧磁盘0手，当前内存已有1手双签','对应FR-32/33；e2e-recovery-results.json。截图为2026-11-05自动Edge本地EVM验收。下载JSON验签有效，不含私钥；重试保存本身不签下一手。保存失败时关闭页面而未导出，仍可能丢失最新内存证据。')
textbox(s,.85,2.20,6.9,.6,'01  配额写满，停止继续授权',23,True,GREEN)
textbox(s,.85,2.95,6.7,.8,'当前页面保留最新双签；旧证据仍在磁盘。\n助手提示保持页面打开，先下载备份。',19)
textbox(s,.85,4.05,6.9,.6,'02  导出验签，恢复保存',23,True,GREEN)
textbox(s,.85,4.80,6.7,.8,'真实文件包含1手合法双签，独立验签通过。\n存储恢复后显式重试，不额外请求授权。',19)
textbox(s,.85,5.88,6.7,.65,'之后两手断线 → 原房续接 → 九手三笔结算',19,True,GREEN)
picture(s,AS/'storage-assistant.png',8.8,2.1,3.6,4.55)
s=backup('备用21 把误触取消放在签名之前','键盘与触屏共享同一授权规则；已双签棋谱保持不可变','对应FR-35。左图是真实本地对局的坐标确认框；按Escape后没有propose消息、没有确认棋谱变化，焦点回到网格。触屏默认确认、强制上链始终确认。键盘只占一个Tab，方向键、Home/End和只读描述可用；读屏器与真人体验尚未人工验收。')
textbox(s,.85,2.15,7.0,.5,'先看坐标，再决定是否授权',24,True,GREEN)
picture(s,AS/'coordinate-confirmation.png',.85,2.95,7.0,2.8)
textbox(s,.85,6.0,7.0,.65,'Escape取消无提案；方向键检查棋点，Enter确认。',18,True,GREEN)
picture(s,AS/'touch-board.png',9.0,2.1,3.1,4.8)

ppt=OUT/'弈信-8分钟课程答辩-V4.pptx';P.save(ppt)

# Reuse the retained print template's styles, section geometry, header and footer.
doc=Document(R/'reports/弈信-赵国豪答辩讲稿-打印版.docx')
body=doc._element.body
for element in list(body):
    if element.tag!=qn('w:sectPr'):body.remove(element)
sec=doc.sections[0]
sec.top_margin=Cm(1.55);sec.bottom_margin=Cm(1.5);sec.left_margin=Cm(1.75);sec.right_margin=Cm(1.75)
for name in ['Normal','Title','Heading 1','Heading 2']:
    st=doc.styles[name];st.font.name=FONT;st._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),FONT)
doc.styles['Normal'].font.size=WPt(12)
doc.styles['Normal'].paragraph_format.line_spacing=1.22
doc.styles['Normal'].paragraph_format.space_after=WPt(7)
doc.styles['Title'].font.size=WPt(24);doc.styles['Title'].font.color.rgb=WColor(0,0,0)
for border in list(doc.styles.element.xpath('.//w:pBdr')):border.getparent().remove(border)
doc.styles['Heading 1'].font.size=WPt(19);doc.styles['Heading 2'].font.size=WPt(14)
sec.header.paragraphs[0].text='弈信课程答辩 V4  赵国豪主讲  2026-11-05'
for run in sec.header.paragraphs[0].runs:run.font.size=WPt(9)
footer=sec.footer.paragraphs[0];footer.clear();footer.alignment=WD_ALIGN_PARAGRAPH.RIGHT
footer.add_run('第 ');field=OxmlElement('w:fldSimple');field.set(qn('w:instr'),'PAGE');footer._p.append(field);footer.add_run(' 页')
doc.core_properties.title='弈信课程答辩讲稿 V4'
doc.core_properties.author='谭海翔、赵国豪；AI辅助同步材料'
def para(text,bold=False,size=None):
    p=doc.add_paragraph();run=p.add_run(text);run.bold=bold
    if size:run.font.size=WPt(size)
    return p
def page(title):
    p=doc.add_paragraph(style='Heading 1');p.paragraph_format.page_break_before=bool(len(doc.paragraphs)>1);p.add_run(title)
def table(headers,rows,widths):
    t=doc.add_table(rows=1,cols=len(headers));t.style='Table Grid';t.autofit=False
    for col,width in zip(t.columns,widths):col.width=Cm(width)
    for cell,caption in zip(t.rows[0].cells,headers):cell.text=caption
    for values in rows:
        for cell,value in zip(t.add_row().cells,values):cell.text=str(value)
    for ri,row in enumerate(t.rows):
        for cell,width in zip(row.cells,widths):
            cell.width=Cm(width)
            for p in cell.paragraphs:
                p.paragraph_format.space_after=WPt(4);p.paragraph_format.line_spacing=1.12
                for run in p.runs:run.font.size=WPt(10.5);run.bold=ri==0
    return t

doc.add_paragraph('弈信课程答辩讲稿 V4',style='Title')
para('赵国豪主讲。16页主讲共8分钟，包含45秒演示；5页备用材料用于故障画面、依据和问答。新增代码及模块设计按本轮指定归入谭海翔，AI辅助如实说明。')
para('讲述重点：保存失败仍能备份，原房重连保留进度，建议与授权分离，误触在签名前取消。',True)
table(['时段','主讲页','重点'],[['0:00至1:20','1至3','定位、课程交付与NABCD'],['1:20至3:30','4至7','风险评审、保存契约、模块化、双签'],['3:30至4:50','8至10','争议、证据和独立钱包'],['4:50至6:25','11至13','分层验证、对照、故障反例'],['6:25至8:00','14至16','分工、45秒演示与收束']],[3.1,2.3,11.8])
para('关键数字：163项自动测试，20组浏览器场景；新增19项故障与策略、6组恢复浏览器。原始失败保留。正常9手3笔交易；本地Gas对照不外推公网。',True)
para('本次材料不宣称真人试用完成、真实钱包插件验收或公网部署；仓库当前为私有，公众课程获取页仍需落实。')
cum=0
for group,title in [((1,2,3),'主讲一 项目定位与复杂度取舍'),((4,5,6),'主讲二 从严格评审到模块设计'),((7,8,9),'主讲三 协议与可信核验'),((10,11,12),'主讲四 接入与分层验证'),((13,14),'主讲五 故障闭环与工作分工'),((15,16),'主讲六 现场演示与项目价值')]:
    page(title)
    for number in group:
        item=D['mainSlides'][number-1];begin=cum;cum+=item['seconds']
        doc.add_heading(f"P{number:02d} {item['title']}  {item['seconds']}秒",level=2)
        para(f'{begin//60}:{begin%60:02d} 至 {cum//60}:{cum%60:02d}  '+item['key'],True,11)
        para(item['speech'])
        para('提醒：'+item.get('printCue',item['cue']),size=10.5)
page('现场演示操作卡')
para('上台前使用新RUNTIME_DIR启动构建后的服务。原Docker4180未按本轮重新构建，不作为当前入口。固定9手演示明确属于两个本地脚本钱包。')
table(['时间','操作','说明'],[['0至5秒','大厅点击运行完整自动演示','真实合约与双签，钱包由脚本控制。'],['5至20秒','等待结算，查看安心助手','区分本地保存、双方签名和节点清单。'],['20至35秒','进入通道实验室','核对open、join、settle三笔成功回执。'],['35至45秒','备份本局证据','下载JSON，指向备用20/21的故障验证画面。']],[2.3,6.2,8.7])
doc.add_heading('演示未就绪时的转场',level=2)
para('“现场服务目前没有就绪，我切换到已保存的真实测试画面，继续说明结算与恢复行为。”',True)
para('15秒未就绪即切备用17。故障恢复用备用20/21，不现场修改存储或等待争议期。截图为已记录自动验收，不称实时或真人结果。')
para('核对电源、投影、PPT全屏、浏览器无敏感页及备用页顺序。讲稿目标8分钟是排练预算，未经真人完整计时排练。')
for start in range(0,12,4):
    page(f'备用问答 {start//4+1}')
    for index,(question,answer,cue) in enumerate(D['printQuestions'][start:start+4],start+1):
        doc.add_heading(f'问题{index} {question}',level=2);para(answer);para('抓手：'+cue,True,10.5)
page('新增工作分工与原则对应')
para('本轮新增代码及模块设计计入谭海翔的工作部分；这是2026-11-05明确指定的归属。既往贡献不在此倒填，多人会议、访谈、人工验收仍不得编造。')
table(['人员','本轮职责','可检查的产物'],D['roles'],[2.5,4.3,10.4])
doc.add_heading('答辩时把原则讲成具体行为',level=2)
for text in ['接口契约：写失败之后，最新内存双签仍可导出；后续签名被暂停。','信息隐藏：存储格式归仓库模块；恢复建议是纯函数，没有钱包和RPC。','状态与幂等：连接成功有明确兑现点；重复ACK不重复弹钱包，显式重发复用签名。','人本设计：状态可见、下一步可识别、误触可在授权前取消、键盘不必Tab两百多次。','验证与确认：自动测试覆盖列明行为；真人任务、读屏器和插件钱包尚待独立验收。']:para(text)
page('大学资料与设计依据')
para('以下为原始教学资料或原项目文献的中文概括，用于解释本轮判断，不是大学对项目的背书。')
for caption,description,url in D['references']:
    doc.add_heading(caption,level=2);para(description,size=10.5);para(url,size=9.5)
page('工程证据与复现入口')
para('最终汇总由原始结果重算，包含24份产品与测试源文件SHA-256及15份最终套件摘要。')
for text in ['评审：docs/engineering-review-2026-11-05.md','决策：docs/adr-recovery-2026-11-05.md；追踪：FR-32至FR-35、AT-13至AT-16。','汇总：artifacts/test-results/recovery-2026-11-05/review-summary.json','最终结果：同目录final-after-ack/；163项自动＋20组浏览器。','失败：before-fix/、before-ack-fix/与final/e2e-external-results.json。','故障闭环：磁盘0手→内存双签1手→导出验签→保存重试→两手断线→原房续接→九手三笔结算。','复验：node scripts/verify.mjs；node scripts/e2e.mjs；node scripts/e2e-external.mjs；node scripts/e2e-recovery.mjs。','给每轮指定新的TEST_RESULTS_DIR；本地浏览器设TEST_URL；缓存、profile和链运行目录均在Gomoku内。','源码：https://github.com/haisiiontam/YiXin。仓库当前private；不代表已满足课程公开获取与保留期。','边界：保存失败后若关闭页面且未导出，内存新证据仍可能丢失。外部钱包装置不等于真人插件测试；无公网或真实资产费用。']:para(text,size=11)
docfile=OUT/'弈信-赵国豪答辩讲稿-V4.docx';doc.save(docfile)

check=Presentation(ppt);text='\n'.join(p.text for p in Document(docfile).paragraphs)
assert len(check.slides)==21
assert sum(q.has_chart for s in check.slides for q in s.shapes)==2
for i,item in enumerate(D['mainSlides']):
    assert item['speech'] in check.slides[i].notes_slide.notes_text_frame.text
    assert item['speech'] in text
bounds=[]
for i,s in enumerate(check.slides,1):
    for q in s.shapes:
        if q.left<0 or q.top<0 or q.left+q.width>check.slide_width+9144 or q.top+q.height>check.slide_height+9144:bounds.append([i,q.name])
        if q.has_text_frame:
            for para_ in q.text_frame.paragraphs:assert len(para_._p.findall(qn('a:pPr')))<=1
assert not bounds,bounds
validation={'version':D['version'],'generatedAt':D['date'],'slides':21,'mainSlides':16,'backupSlides':5,'targetSeconds':480,'notes':'21/21','nativeCharts':2,'speakerDocx':str(docfile),'powerpoint':str(ppt),'automaticTests':163,'browserScenarios':20,'shapeBounds':'passed','newWorkAssignedTo':'谭海翔','aiAssistanceDisclosed':True,'templateSha256':sha(R/'reports/弈信-8分钟课程答辩-V3.pptx'),'productSourceHashesVerified':24,'finalResultHashesVerified':15,'visualReview':'pending'}
(OUT/'defense-v4-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps(validation,ensure_ascii=False,indent=2))
