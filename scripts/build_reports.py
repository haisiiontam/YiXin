"""Create course report from the supplied Word template and verified project evidence."""
from pathlib import Path
import re,json,copy,hashlib,subprocess,os
from datetime import datetime
from docx import Document
from docx.shared import Pt,Cm,RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from PIL import Image
R=Path(r'E:\Gomoku');OUT=R/'reports';OUT.mkdir(exist_ok=True)
TEMPLATE=Path(r'C:\Users\lenovo\Downloads\《软件工程》项目报告撰写内容及规范化参考样本.docx')
C=json.loads((R/'artifacts/test-results/contract-results.json').read_text());E=json.loads((R/'artifacts/test-results/e2e-results.json').read_text());P=json.loads((R/'artifacts/test-results/protocol-results.json').read_text())
def load(name):return (R/'docs'/name).read_text(encoding='utf-8')
def section(text,start,end=None):
 a=text.index(start);b=text.index(end,a+len(start)) if end else len(text);return text[a:b].strip()
def clean(text):
 text=re.sub(r'```mermaid[\s\S]*?```','（相应设计图见本章图示；可编辑Mermaid图源保存在工程设计文档中。）',text)
 text=re.sub(r'(?<!!)\[([^\]]+)\]\(<?([^\n]*?)>?\)',r'\1',text)
 return text
req=load('requirements.md');arch=load('architecture.md');testing=load('testing.md');research=load('research.md')
parts=[]
def add(text):parts.append(text.strip())
add('''# 任务书

一 总体要求

综合运用软件工程思想开发区块链（通道）五子棋，完成问题定义、NABCD、需求分析、原型、概要与详细设计、编码、测试、交付和报告。依据课程教案选题3，游戏结束时须使用区块链正确结算积分，并尽量避免游戏给底层链带来较大事务负担。

二 基本内容

本项目实现中文Web五子棋、真实本地EVM合约、链下EIP-712双签、积分锁定与结算、非合作争议救济、证据核验和同口径负载比较。按用户安排由一名学生一体化实施，AI辅助产出与验证，不虚构多人分工、会议、访谈或用户满意率。

三 成果与评价依据

需求分析20%、设计35%、编码测试30%、创新10%、真实反馈5%为模板和教案一致的项目内部指标；课程总评在不同课件中存在不同口径，最终以任课教师说明为准。报告提供实际程序、版本记录、测试与回执，公开发布和真实用户反馈暂未发生，单独列示。

四 范围规则

严禁修改 Gomoku 工作区以外的任何内容！工作区固定为E:\\Gomoku。外部课程材料只读；源码、依赖、缓存、日志、证据和报告均在工作区。个人信息由本人补填，不冒用参考报告作者信息。
''')
add('''# 摘要

针对区块链逐步处理游戏操作会增加事务负载的问题，本项目设计并实现“弈·信”状态通道五子棋。系统采用React中文交互界面、WebSocket消息中继、ethers签名与RPC适配、Ganache本地EVM及Solidity合约。双方在每一手之后对完整有序棋谱进行EIP-712双签，正常对局仅在开通、加入和终局结算时发送链上交易；合约重放棋谱并检查合法性后分配演示积分。对手拒签或离线时，参与者可提交双签快照进入限时争议，通过更高前缀更新、本人链上落子或超时结算继续完成对局。

工程过程采用NABCD、编号需求、44项WBS、可追踪设计与测试、关键决策记录及版本留痕。实测合约11组、共享协议4组、Edge浏览器8组均通过。9手黑胜的对局交易数由逐步上链基线11笔降为3笔，总gasUsed从1,231,480降为436,143；10手白胜由12笔降为3笔，总gasUsed从1,406,433降为448,105。225手合法和棋真实结算使用3,550,645 gas；浏览器验证拒签最后一手仍能经4笔对局交易正确结算。上述数据来自本地单节点真实EVM执行，不等同于公网上的TPS或真实资产费用。

关键词：五子棋；状态通道；EIP-712；智能合约；争议结算；软件工程
''')
add('# 目录\n\n[TOC]\n\n目录页码按随附PDF的实际分页自动核对。正文保留课程模板的六章结构；修改内容重新分页后须同步更新目录。个人身份、真实发布和反馈留待本人补充。')
add('''# 1 问题定义

## 1.1 项目背景及意义

课程题目同时要求“正确链上结算”和“减少链事务”，因此核心不是把棋盘显示在网页，而是设计规则与信任的分工。每步上链可以直接由合约裁决，但一局m手需处理大量事务；中心化记分虽便捷，却无法提供本题要求的合约结算证据。状态通道将频繁更新移到链下，仅在必要时提交可验证状态，适合参与者固定、规则确定、交替行动的五子棋。

本项目将积分限定为教学用途：地址注册获得1000分，双方各锁定stake，胜者获双方锁分、和棋各返锁分。该记账可以验证守恒和一次性支付，但自由地址注册存在女巫攻击，不能被解释为真实竞技信誉或资产价值。

## 1.2 NABCD分析
''')
add(section(req,'| 维度 |','需求来源编号：'))
add('''## 1.3 基本目标与范围

系统须支持不同浏览器上下文的独立钱包对局、合法棋谱双签、链上自然终局结算、不合作争议、邀请到期退款、证据导入导出与真实负载展示。规则为15×15自由五子棋，黑先，无禁手，连续至少五子获胜，满盘无胜为和棋。提前认输、约定和棋、公共匹配、AI棋手及可兑现代币不在v1实现范围。

设计创新集中在可解释可信流程：界面分别展示提案、双签确认与链上结算；合约同时校验签名与规则；拒签最后胜手有可执行救济；观察钱包可独立核验证据；负载比较公开初始化与异常成本。这里的创新是组合实现与课程工程价值，不宣称首创或安全证明。

## 1.4 可行性与方案选择

技术上，五子棋规则确定且最多225手，紧凑bytes棋谱能够在本地EVM完整回放；OpenZeppelin提供成熟typed-data和ECDSA基础，ethers处理钱包、ABI与RPC。资源上，已配置Windows、Node和Edge即可运行，无需公网钱包、真实代币或付费节点。经济上避免真实资产费用，但不把开发和维护人力成本记为零。工程上采用单应用进程和共享规则模块，降低部署复杂度，并以规则、安全、系统和证据测试控制风险。
''')
add(section(research,'| 方案 |','没有以代码行数'))
add('''## 1.5 人员与进度管理

项目按用户要求由本人统一承担产品、需求、设计、实现、验证和报告责任；AI作为工具辅助，不列作有学号的组员。参考图书馆范文明确存在单人实施示例，但这不能替代本项目向教师确认课程安排。本次实际采用一个会话连续增量实施，各阶段留有真实工具记录和Git提交；不把计划116小时写成已经工作116小时，也不伪造30天提交历史。

图1-1给出相对甘特规划。44项WBS涵盖从材料分析到交付展示，详细任务见附录A；实际已验证与待办矩阵见第5章。

![图1-1 相对迭代甘特规划，非实际日历工时](../docs/assets/diagram-gantt.png)
''')
add(section(req,'| 迭代 | 相对工作日/预算 |','迭代预算与WBS'))
add('''## 1.6 风险管理

优先处理签名未绑定业务状态、旧快照覆盖、更高状态不给下一方响应时间、最后一手拒签、最长局gas以及本地单链被误称生产可信等风险。具体缓解是完整谱与域绑定、前缀单调、有效推进重置期限、forceMove、真实长局结算、明确监控义务。公开反馈与外部发布为尚待本人完成的日历依赖，无法由自动化执行替代。
''')
add('''# 2 需求分析

## 2.1 需求获取与业务目标

需求主要来自课程选题、教案、PPT和用户直接指示。没有开展真人访谈，因此NABCD中的用户价值和推广判断作为待验证假设。需求分业务、用户、功能和非功能四层，使用SRC→BR→UC→FR/NFR→AT→原始证据建立追踪。需求基线共26项FR、15项NFR和12组验收场景，不把基线文本的存在等同于所有要求均已验证。
''')
add(section(req,'| 业务编号 |','P0必须交付：'))
add('''## 2.2 UML用例与用户流程

图2-1给出参与者与功能边界。两个玩家分别保管测试私钥；观察者可查看和核验证据，但不能执行成员挑战或落子。中继是通信基础，不是计分裁判。

![图2-1 系统用例与参与者边界](../docs/assets/diagram-usecase.png)
''')
add(section(req,'| 用例 |','## 4.'))
add('## 2.3 功能需求与验收标准')
add(section(req,'| 编号/优先级 |','## 6.'))
add('## 2.4 非功能需求与验收标准')
nfr=section(req,'## 6. 非功能需求与验收标准','## 7.')
add(nfr[nfr.index('| 编号'):])
add('''## 2.5 可交互原型与最终界面

原型通过可运行Web界面实现完整闭环，并逐步接入真实链。图2-2为真实浏览器截图而非设计占位图：左侧棋盘、右侧对局控制、独立钱包积分、提案确认与异常实验。普通标签同源共享localStorage钱包，双人必须使用不同浏览器配置或独立上下文。

![图2-2 完整中文对局界面与链上结算结果](../docs/assets/03-settled-game.png)

实验室展示当前真实交易和已确认手数，m+2为对照口径；未结算时标为当前快照，不能当最终降幅。图2-3展示完整数据解释。

![图2-3 通道实验室与真实交易回执](../docs/assets/04-channel-lab.png)

证据导入在另一观察钱包中执行双签、规则、链上参与者和每笔回执核验；篡改后显示错误。手机390像素视口通过无横向溢出检查，但未据此宣称所有设备或全部无障碍合规。
''')
add('# 3 概要设计和详细设计')
arch_body=arch[arch.index('## 1.'):]
arch_body=re.sub(r'### (\d+)\.(\d+) ',lambda m:f'### 3.{m[1]}.{m[2]} ',arch_body)
arch_body=re.sub(r'## (\d+)\. ',lambda m:f'## 3.{m[1]} ',arch_body)
# Exclude validation summary to avoid duplicate test chapter.
arch_body=arch_body.split('## 3.8 ')[0]
arch_body=arch_body.replace('## 3.2 领域对象','![图3-1 系统架构与信任边界](../docs/assets/diagram-architecture.png)\n\n## 3.2 领域对象')
arch_body=arch_body.replace('### 3.2.2 关键字段','![图3-2 领域对象与数据关系](../docs/assets/diagram-domain.png)\n\n### 3.2.2 关键字段')
arch_body=arch_body.replace('### 3.4.2 生命周期','![图3-3 每步链下双签的交互时序](../docs/assets/diagram-sequence.png)\n\n### 3.4.2 生命周期')
arch_body=arch_body.replace('## 3.5 争议','![图3-4 通道生命周期与争议响应](../docs/assets/diagram-state.png)\n\n## 3.5 争议')
add(arch_body)
add('''# 4 实现与测试

## 4.1 实现环境、编码与版本管理

实际运行环境为Windows、Node24.21.0、pnpm11.28.5、Solidity0.8.30、ethers6.17.0和Ganache7.9.2，浏览器为本机Microsoft Edge。合约采用Shanghai指令集、优化器200次；开发链区块gas上限30,000,000。前端分包构建成功，React、EVM依赖和业务包分离，避免首次566KB单包提示。

模块按职责隔离：规则只处理棋谱；控制器封装钱包、RPC与状态；React订阅快照；中继认证身份并校验消息；合约维护权威积分。使用有许可证的通用模块，锁定版本，关键函数语义与前置条件以协议说明和测试反例约束。大段程序放附录，正文侧重调用关系。

版本管理为真实本地Git仓库，尚未推送Gitee/GitHub；未将本地提交写成远程平台截图。下图是实际提交文本的可视化记录，完整历史可用git log复核。

![图4-1 本地Git真实提交记录](../docs/assets/git-history.png)

## 4.2 关键函数与调用关系

ChannelClient.move调用共享requireExtension验证恰扩一手，然后Wallet.signTypedData产生提案；接收者验证后acknowledge签同谱；中继提交checkpoint，双方再次验签并保存。ChannelClient.settle发送合约settle，合约先验证EIP-712双方身份再evaluate完整谱，_finish释放锁分。challenge与forceMove通过相同规则回放推动争议；claimTimeout由链上时间与下一方轮次决定胜负。verifyEvidence能离线核验签名和棋谱，importEvidence进一步核对RPC参与者、stake及每笔回执。
''')
testbody=testing[testing.index('## 1.'):]
testbody=re.sub(r'## (\d+)\. ',lambda m:f'## 4.{int(m[1])+2} ',testbody)
testbody=testbody.replace('## 4.6 签名','![图4-2 每局真实事务数对照](../docs/assets/chart-transactions.png)\n\n![图4-3 每局真实Gas用量对照](../docs/assets/chart-gas.png)\n\n## 4.6 签名')
add(testbody)
add('''# 5 总结

## 5.1 用户反馈与可用性确认

截至本报告生成时，独立真人试用人数为0，未进行公开发布或连续一个月公开可获取验证。浏览器8组系统测试证明列明路径在测试环境中可执行，不能替代用户反馈。已准备匿名试用任务与记录表，包含首次启动、双人开局、终局结算、理解负载、异常救济和证据核验。需由本人取得真实试用者同意后记录原话、观察、版本和复测，不能由AI生成满意率或照片。

课程要求的真实反馈5%和公开获取页仍存在交付缺口。个人班级、姓名学号、指导教师、课程截止、最终评分口径以及单人安排认可需本人填写/确认。上述事项不妨碍本地程序与工程证据使用，但报告不把它们记为已完成。

## 5.2 已实现成果与创新价值

已完成中文15×15双人五子棋、真实本地EVM合约、每步完整谱双签、邀请与积分锁定、自然终局结算、争议更新/强制落子/超时、证据导入导出核验、负载实验室、真实比较基线、中文启动流程与工程文档。已执行11组合约、4组共享协议和8组浏览器测试，保留真实原始JSON、截图、回执与修复记录。

正常3笔事务并未通过放弃异常安全换取：最后一手拒签时，可用前8手双签进入争议，再本人链上走第9手完成结算，实测4笔事务。合约不信浏览器传来的winner，而是重放合法棋谱。事务数与Gas分别统计；初始化、失败成本和覆盖局限明确列示，便于课程评估与后续复现。

## 5.3 局限与后续方向

本地开发链由单机控制，重置或停机会影响证据可用性，不提供生产共识保障；本地RPC含测试管理能力，仅绑定回环。自由注册存在女巫攻击，积分不可当真实资产或反作弊信誉。诚实方须在争议期限内监控，首版没有watchtower。签名域不含独立部署纪元，完全相同链ID/地址/通道ID的人为重建不能声称强抗重放。生产化还需外部钱包授权、RPC隔离、持久证据备份、监控、多浏览器/网络故障测试和独立安全审计。

未单独实测225笔逐步上链基线、长局challenge的独立向量、deadline+1所有组合、中继永久失联后自动fallback的完整故障路径，以及真实用户满意度。后续应先完善这些覆盖，再考虑棋谱回放、AI棋手或公开匹配。

# 6 体会

## 6.1 从可玩程序到可验证系统

本次工程记录显示，课程难点在规则、授权、数据和证据之间的一致性。界面显示胜利不等于积分已经结算，双方签名也不能替代棋谱合法性。把pending提案、双签快照和链上确认分开后，用户行为、持久数据与合约不变量可以建立清晰联系。

## 6.2 真实困难、取舍与修复

实施遇到工作区权限、Node依赖链接解析和本地EVM原生模块兼容问题。过程保留失败而非假装一次成功；用户切换执行权限后仍严格限制写入范围，依赖和缓存保存在工作区。测试曾因ethers Result代理的深比较、旧roomId取证、重复状态定位器以及校验文案差异失败，分别定位并修复，未放宽原来的积分与交易数量断言。

225手和棋回放体现安全完整性与执行成本的取舍。最终保留最长合法局规则与真实结算测试，同时用9/10手完整局做公平事务与Gas对照，明确没有实测227笔和棋基线。这样的减法减少重复等待，却没有删除关键安全校验。

## 6.3 AI协作与本人责任

AI辅助完成材料抽取、需求草稿、设计、源码、测试与文档，但自动生成内容通过实际编译、链上反例和浏览器验证后才可进入成果。多代理分别承担文档、合约和界面任务，是工具分工，不是课程中虚构的同学。本人仍需理解协议、独立复现演示、核对课程口径、补充真实反馈并对提交负责。本章依据真实工程记录整理，提交前应由本人补充亲自操作后的体会，不能把未经历的活动写成个人经历。

# 附录A WBS、交付矩阵与复现入口

WBS为计划基线，估算不是实际已用工时。当前实现和验证以第4章原始证据为准；真实反馈/公开发布等任务仍待完成。
''')
# Keep complete WBS but compress 7 columns to four readable columns.
rows=[]
for line in section(req,'| WBS |','估时校验：').splitlines()[2:]:
 cells=[c.strip() for c in line.strip().strip('|').split('|')]
 if len(cells)>=7:rows.append(f'| {cells[0]} | {cells[1]} | {cells[4]} / {cells[5]} | {cells[2]}；前置{cells[3]} |')
add('| WBS | 任务 | 估时h / 迭代 | 关联与依赖 |\n| --- | --- | --- | --- |\n'+'\n'.join(rows))
add('''## A.1 交付状态与证据

| 项目 | 当前结果 | 可复核入口 |
| --- | --- | --- |
| 核心链上积分与通道 | 已实现并验证 | 合约源码、contract-results.json |
| 中文完整双人/演示 | 已实现并验证 | e2e-results.json、真实截图 |
| 证据核验 | 已实现并验证 | protocol-results.json、观察钱包导入 |
| 本地版本留痕 | 已建立真实Git仓库 | git log与图4-1 |
| 报告与需求/设计文档 | 已生成 | reports目录与生成脚本 |
| 真人反馈/公开保留1个月 | 未完成 | user-feedback空表待实际填写 |
| 个人身份与教师确认 | 待本人填写 | 封面与课程确认 |

## A.2 启动与复现

在E:\\Gomoku双击启动游戏.cmd，浏览器访问http://127.0.0.1:4173。需要双人时使用不同浏览器配置；运行完整自动演示可直接体验9手3笔真实结算。脚本verify.mjs顺序编译、构建和测试；e2e.mjs需服务运行，调用本机Edge。所有命令、缓存和产物在工作区内。

完整源码见contracts、shared、server、web/src、scripts和tests；详细运行命令见根目录README。导出证据可用scripts/verify-evidence.mjs离线验签，加--rpc可核对真实回执。测试JSON不能改写为预期数据。

# 附录B 关键实现摘录与不变量

积分不变量为 sum(points[address]) + totalLocked = totalIssued。每局加入前只锁黑方stake，加入后锁2×stake；_finish仅从live状态到Settled一次性执行，取消邀请只返黑方已锁积分。签名State绑定channelId和movesHash，合约域另绑定链、合约和版本。
''')
source=(R/'contracts/GomokuChannel.sol').read_text()
add('```solidity\n'+source[source.index('    function forceMove'):source.index('    function _finish')]+'\n```')
add('# 附录C 参考资料、开源模块与AI使用说明')
add(section(research,'| 编号 |','[抓取脚本]'))
add((R/'THIRD_PARTY_NOTICES.md').read_text().replace('# 第三方来源、许可证与自主实现边界','## C.1 第三方来源、许可证与自主实现边界'))
add('''## C.2 课程来源

用户提供：Ch1《什么是软件工程》、Ch2《过去我们是如何开发软件的》、Ch2-1《软件与软件工程》、Ch2-2《结构化方法》、软件工程实践课程教案、项目报告撰写内容及规范化参考样本，以及图书馆应用/音乐教学播放两份报告范文。已通读4份课件和2份Word提取文本，选择性阅读两份PDF目录、测试、总结等片段；不声称逐页视觉检查全部源文件。模板优先于范文中的不一致写法，原材料未修改。

## C.3 AI与证据说明

本项目使用AI辅助材料理解、需求与设计、实现、审查、测试建议和报告组织；所有实测数字引用本地自动执行结果，不生成虚假教师讨论、团队合照、真实用户反馈、公开链接或课程工时。工作区规则与过程日志可追溯本轮限制、异常、决策和修复。本文不是独立安全审计或形式化证明。
''')
markdown='\n\n'.join(parts)+'\n';(OUT/'项目报告-正文源稿.md').write_text(markdown,encoding='utf-8')

def setfont(run,east='宋体',size=12,bold=None):
 run.font.name='Times New Roman';run._element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),east);run.font.size=Pt(size)
 if bold is not None:run.bold=bold

def styles(doc):
 if 'Table Grid' not in doc.styles:
  from docx.enum.style import WD_STYLE_TYPE
  grid=doc.styles.add_style('Table Grid',WD_STYLE_TYPE.TABLE)
  props=OxmlElement('w:tblPr');borders=OxmlElement('w:tblBorders')
  for edge in ['top','left','bottom','right','insideH','insideV']:
   el=OxmlElement('w:'+edge);el.set(qn('w:val'),'single');el.set(qn('w:sz'),'4');el.set(qn('w:color'),'8E9C91');borders.append(el)
  props.append(borders);grid.element.append(props)
 for name,east,size,bold in [('Normal','宋体',12,False),('Heading 1','黑体',18,True),('Heading 2','黑体',14,True),('Heading 3','黑体',12,True)]:
  st=doc.styles[name];st.font.name='Times New Roman';st.font.size=Pt(size);st.font.bold=bold;st.element.get_or_add_rPr().rFonts.set(qn('w:eastAsia'),east)
  pf=st.paragraph_format;pf.line_spacing=1.5;pf.space_after=Pt(6 if name=='Normal' else 10)
  if name=='Normal':pf.first_line_indent=Cm(.85)
  else:pf.keep_with_next=True
  if name=='Heading 1':pf.alignment=WD_ALIGN_PARAGRAPH.CENTER;pf.page_break_before=True
 if 'Caption' not in doc.styles:
  from docx.enum.style import WD_STYLE_TYPE
  doc.styles.add_style('Caption',WD_STYLE_TYPE.PARAGRAPH)
 doc.styles['Caption'].font.size=Pt(12)
 for sec in doc.sections:
  sec.page_width=Cm(21);sec.page_height=Cm(29.7);sec.top_margin=Cm(2.54);sec.bottom_margin=Cm(2.54);sec.left_margin=Cm(3.175);sec.right_margin=Cm(3.175)
 settings=doc.settings.element;upd=OxmlElement('w:updateFields');upd.set(qn('w:val'),'true');settings.append(upd)
 footerpart=doc.sections[-1].footer
 for child in list(footerpart._element):footerpart._element.remove(child)
 footer=footerpart.add_paragraph();footer.alignment=WD_ALIGN_PARAGRAPH.CENTER;footer.paragraph_format.first_line_indent=0
 run=footer.add_run();fld=OxmlElement('w:fldSimple');fld.set(qn('w:instr'),'PAGE');run._r.addnext(fld)

def inline(p,text,size=12,east='宋体'):
 text=re.sub(r'\[([^\]]+)\]\(<?.*?>?\)',r'\1',text)
 for token in re.split(r'(\*\*.*?\*\*|`[^`]+`)',text):
  if token.startswith('**') and token.endswith('**'):r=p.add_run(token[2:-2]);setfont(r,east,size,True)
  elif token.startswith('`') and token.endswith('`'):r=p.add_run(token[1:-1]);setfont(r,'等线',size-1)
  else:r=p.add_run(token);setfont(r,east,size)

def render_md(doc,text,origin=OUT):
 lines=clean(text).splitlines();i=0;chapter='';tableNo={};in_code=False;buf=[]
 while i<len(lines):
  line=lines[i].strip()
  if line.startswith('```'):
   if in_code:
    p=doc.add_paragraph();p.paragraph_format.first_line_indent=0;p.paragraph_format.line_spacing=1.0
    for j,l in enumerate(buf):r=p.add_run(l+('\n' if j<len(buf)-1 else ''));setfont(r,'等线',8.5)
    buf=[];in_code=False
   else:in_code=True
   i+=1;continue
  if in_code:buf.append(lines[i]);i+=1;continue
  if not line:i+=1;continue
  if line=='[TOC]':
   from docx.enum.text import WD_TAB_ALIGNMENT,WD_TAB_LEADER
   mapfile=OUT/'report-page-map.json'
   pagemap=json.loads(mapfile.read_text(encoding='utf-8')).get('toc',{}) if mapfile.exists() else {}
   labels=['任务书','摘要','1 问题定义','2 需求分析','3 概要设计和详细设计','4 实现与测试','5 总结','6 体会','附录A WBS、交付矩阵与复现入口','附录B 关键实现摘录与不变量','附录C 参考资料、开源模块与AI使用说明']
   for label in labels:
    p=doc.add_paragraph();p.paragraph_format.first_line_indent=0;p.paragraph_format.tab_stops.add_tab_stop(Cm(14.3),WD_TAB_ALIGNMENT.RIGHT,WD_TAB_LEADER.DOTS)
    inline(p,label+'\t'+str(pagemap.get(label,'待更新')),12)
   i+=1;continue
  image=re.match(r'!\[(.*?)\]\((.*?)\)',line)
  if image:
   caption,dest=image.groups();p=doc.add_paragraph();p.paragraph_format.first_line_indent=0;p.alignment=WD_ALIGN_PARAGRAPH.CENTER
   img=(origin/dest).resolve()
   with Image.open(img) as im:w,h=im.size
   maxw=14.5;maxh=18.0;display=min(maxw,maxh*w/h)
   p.add_run().add_picture(str(img),width=Cm(display));p.paragraph_format.keep_with_next=True
   cap=doc.add_paragraph();cap.alignment=WD_ALIGN_PARAGRAPH.CENTER;cap.paragraph_format.first_line_indent=0;inline(cap,caption,12,'黑体');i+=1;continue
  if line.startswith('|'):
   rows=[]
   while i<len(lines) and lines[i].strip().startswith('|'):
    vals=[v.strip() for v in lines[i].strip().strip('|').split('|')]
    if not all(re.fullmatch(r':?-+:?',v or ' ') for v in vals):rows.append(vals)
    i+=1
   if not rows:continue
   n=max(map(len,rows));key=chapter or 'A';tableNo[key]=tableNo.get(key,0)+1
   cap=doc.add_paragraph();cap.paragraph_format.first_line_indent=0;cap.paragraph_format.keep_with_next=True;inline(cap,f'表{key}-{tableNo[key]} '+ ' / '.join(rows[0][:3]),12,'黑体')
   t=doc.add_table(rows=1,cols=n);t.style='Table Grid';t.autofit=False
   for j,v in enumerate(rows[0]):inline(t.rows[0].cells[j].paragraphs[0],v,9.5,'黑体')
   repeat=OxmlElement('w:tblHeader');t.rows[0]._tr.get_or_add_trPr().append(repeat)
   for vals in rows[1:]:
    cells=t.add_row().cells
    for j,v in enumerate(vals[:n]):inline(cells[j].paragraphs[0],v,9.5)
   widths=[1/n]*n
   if n==3:widths=[.17,.30,.53] if '优先级' in rows[0][0] else [.18,.41,.41]
   if n==4:widths=[.10,.43,.20,.27] if rows[0][0]=='WBS' else [.12,.48,.25,.15]
   for row in t.rows:
    noSplit=OxmlElement('w:cantSplit');row._tr.get_or_add_trPr().append(noSplit)
    for ci,c in enumerate(row.cells):
     c.width=Cm(14.5*widths[ci])
     for p in c.paragraphs:p.alignment=WD_ALIGN_PARAGRAPH.LEFT;p.paragraph_format.first_line_indent=0;p.paragraph_format.line_spacing=1.15;p.paragraph_format.space_after=Pt(3);p.paragraph_format.keep_with_next=False
   doc.add_paragraph().paragraph_format.space_after=Pt(0);continue
  heading=re.match(r'^(#{1,4})\s+(.*)',line)
  if heading:
   depth,title=heading.groups();level=min(len(depth),3);p=doc.add_heading(title,level)
   if level==1:
    match=re.match(r'(\d+)',title);chapter=match[1] if match else ('A' if '附录' in title else '')
   i+=1;continue
  p=doc.add_paragraph()
  if re.match(r'^[-*]\s|^\d+[.)、]\s?',line):p.paragraph_format.first_line_indent=0
  inline(p,line);i+=1

def build_main():
 doc=Document(TEMPLATE)
 # Keep the original cover paragraph layout, trim the template body after its college line.
 college=next(p for p in doc.paragraphs if p.text.strip()=='计算机科学与技术学院')
 body=doc.element.body;found=False
 for child in list(body):
  if child is college._p:found=True;continue
  if found and child.tag!=qn('w:sectPr'):body.remove(child)
 for p in list(doc.paragraphs):
  text=p.text.strip()
  if text.startswith('题目：'):p.text='题目：弈·信——基于状态通道的\n五子棋可信积分结算系统'
  elif text.startswith('专业班级：'):p.text='专业班级：［由本人填写］'
  elif text.startswith('组    名：'):p.text='组    名：弈·信（个人一体化实施）'
  elif text.startswith('同组成员：'):p.text='项目作者：学号［待填写］　姓名［待填写］'
  elif text.startswith('学号：') or text.startswith('姓名：'):p._element.getparent().remove(p._element);continue
  elif text.startswith('指导教师：'):p.text='指导教师：［由本人填写］'
  elif text.startswith('报告日期：'):p.text='报告日期：2026年10月27日（生成日）'
 styles(doc)
 # Preserve the template logo and cover wording while fitting the cover on one page.
 for p in doc.paragraphs:
  pf=p.paragraph_format;pf.space_before=Pt(0);pf.space_after=Pt(8);pf.line_spacing=1.1;pf.first_line_indent=0
  if not p.text.strip() and not p._p.xpath('.//w:drawing'):
   pf.space_after=Pt(0);pf.line_spacing=Pt(5)
   for run in p.runs:run.font.size=Pt(5)
  elif p.text.strip()=='《软件工程》项目报告':
   pf.space_before=Pt(24);pf.space_after=Pt(32);pf.alignment=WD_ALIGN_PARAGRAPH.CENTER
   for run in p.runs:setfont(run,'黑体',28,True)
  elif p.text.strip().startswith('题目：'):
   pf.space_after=Pt(28)
   for run in p.runs:setfont(run,'宋体',16,True)
  elif p.text.strip()=='计算机科学与技术学院':
   pf.space_before=Pt(20);pf.alignment=WD_ALIGN_PARAGRAPH.CENTER
 render_md(doc,markdown)
 out=OUT/'《软件工程》项目报告-弈信状态通道五子棋.docx';doc.save(out)
 saved=Document(out);alltext='\n'.join(p.text for p in saved.paragraphs)
 assert all(s in alltext for s in ['1 问题定义','2 需求分析','3 概要设计和详细设计','4 实现与测试','5 总结','6 体会','NABCD'])
 assert len(saved.inline_shapes)>=10
 return {'path':str(out),'paragraphs':len(saved.paragraphs),'tables':len(saved.tables),'images':len(saved.inline_shapes),'bytes':out.stat().st_size}

if __name__=='__main__':
 # Git log is rendered separately by generate_git_history.py before this script.
 meta=build_main()
 for filename,title,target in [('requirements.md','弈·信需求分析报告','需求分析报告.docx'),('architecture.md','弈·信概要与详细设计报告','项目设计报告.docx')]:
  d=Document();styles(d);d.add_heading(title,0);d.add_paragraph('课程个人提交辅助材料；2026年10月27日。实际实现与测试范围见完整项目报告及原始结果；个人信息请本人填写。');render_md(d,load(filename),R/'docs');d.save(OUT/target)
 (OUT/'document-validation.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(meta,ensure_ascii=False))
