from pathlib import Path
import json,re,sys
sys.path.insert(0,str(Path(r'E:\Gomoku\.vendor\python')))
from pypdf import PdfReader
R=Path(r'E:\Gomoku');f=R/'reports/《软件工程》项目报告-弈信状态通道五子棋.pdf';data=f.read_bytes();assert data.startswith(b'%PDF-') and len(data)>10000
reader=PdfReader(f);labels=['任务书','摘要','1 问题定义','2 需求分析','3 概要设计和详细设计','4 实现与测试','5 总结','6 体会','附录A WBS、交付矩阵与复现入口','附录B 关键实现摘录与不变量','附录C 参考资料、开源模块与AI使用说明'];found={}
for i,page in enumerate(reader.pages,1):
 text=page.extract_text() or '';flat=re.sub(r'\s+','',text)
 for label in labels:
  key=re.sub(r'\s+','',label)
  if key in flat and label not in found:
   # Exclude table of contents and prose cross-references by checking the beginning of page text.
   content=[re.sub(r'\s+','',line) for line in text.splitlines() if line.strip()]
   content=[line for line in content if line!='华中科技大学计算机科学与技术学院软工项目报告' and line!=str(i)]
   if content and content[0].startswith(key):found[label]=i
(R/'reports/report-page-map.json').write_text(json.dumps({'pageCount':len(reader.pages),'toc':found},ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'pageCount':len(reader.pages),'toc':found},ensure_ascii=False))
