"""Read original course files without modifying them; write all extracts in workspace."""
from pathlib import Path
import os, json, hashlib, importlib.util
from docx import Document
from pptx import Presentation
ROOT = Path(r'E:\Gomoku')
OUT = ROOT / 'docs' / 'reference-extracts'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE = Path(r'C:\Users\lenovo\Downloads')
NAMES = ['《软件工程》项目报告参考范文-基于Android端的图书馆应用系统.pdf','Ch1-什么是软件工程.pptx','《软件工程》项目报告参考范文-基于识谱演奏一体化的音乐教学播放应用.pdf','Ch2-过去我们是如何开发软件的.pptx','软件工程实践课程教案.docx','《软件工程》项目报告撰写内容及规范化参考样本.docx','Ch2-2 结构化方法.pptx','Ch2-1 软件与软件工程.pptx']
manifest=[]
for name in NAMES:
    path=SOURCE/name
    data=path.read_bytes()
    entry={'name':name,'source':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
    lines=[f'# {name}',f'只读源文件：{path}','']
    if path.suffix=='.docx':
        doc=Document(str(path))
        for child in doc.element.body:
            if child.tag.endswith('}p'):
                from docx.text.paragraph import Paragraph
                p=Paragraph(child,doc)
                if p.text.strip(): lines.append(f'[{p.style.name}] {p.text}')
            elif child.tag.endswith('}tbl'):
                from docx.table import Table
                for row in Table(child,doc).rows: lines.append(' | '.join(c.text.replace('\n',' / ') for c in row.cells))
    elif path.suffix=='.pptx':
        prs=Presentation(str(path));entry['slides']=len(prs.slides)
        for i,s in enumerate(prs.slides,1):
            lines.append(f'\n## 幻灯片 {i}')
            for shape in s.shapes:
                if shape.has_text_frame: lines.append(shape.text)
                if shape.has_table:
                    for row in shape.table.rows: lines.append(' | '.join(c.text for c in row.cells))
            if s.has_notes_slide:
                notes=s.notes_slide.notes_text_frame.text
                if notes.strip():lines.append('讲者备注：'+notes)
    else:
        import sys
        sys.path.insert(0,str(ROOT/'.vendor'/'python'))
        from pypdf import PdfReader
        pdf=PdfReader(path);entry['pages']=len(pdf.pages);entry['pdf_extraction']='pypdf 6.1.1, extracted successfully'
        for i,page in enumerate(pdf.pages,1):lines.extend([f'\n## 第{i}页',page.extract_text() or ''])
    target=OUT/(path.stem+'.md')
    target.write_text('\n'.join(lines),encoding='utf-8');entry['extract']=str(target.relative_to(ROOT))
    manifest.append(entry)
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'materials':len(manifest),'output':str(OUT),'pdf_modules':{m:bool(importlib.util.find_spec(m)) for m in ['pypdf','fitz','pdfplumber']}},ensure_ascii=False))
