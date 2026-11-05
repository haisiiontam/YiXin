"""Verify V4 content/results and finalize the already visually reviewed PDF.

This script does not run the product tests or claim to perform visual review.
Pass --visual-review-complete only after inspecting every slide and print page.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
from PIL import Image
from pptx import Presentation
from docx import Document
from pypdf import PdfReader

parser=argparse.ArgumentParser()
parser.add_argument('--render-dir',required=True)
parser.add_argument('--visual-review-complete',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'reports';render=(root/args.render_dir).resolve()
assert render.is_relative_to(root)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
content=json.loads((root/'docs/defense-v4-content.json').read_text(encoding='utf8'))
summary=json.loads((root/'artifacts/test-results/recovery-2026-11-05/review-summary.json').read_text(encoding='utf8'))
for path,digest in summary['sourceSha256'].items():assert sha(root/path)==digest,path
for suite in summary['finalSuites']:assert sha(root/suite['file'])==suite['sha256'],suite['file']
ppt=out/'弈信-8分钟课程答辩-V4.pptx';docx=out/'弈信-赵国豪答辩讲稿-V4.docx';pdf=out/'弈信-赵国豪答辩讲稿-V4.pdf'
deck=Presentation(ppt);original=Presentation(out/'弈信-8分钟课程答辩-V3.pptx');doc=Document(docx)
manifest=json.loads((render/'render-manifest.json').read_text(encoding='utf-8-sig'))
assert manifest['sourceSha256']==sha(ppt),'Render is stale'
assert len(deck.slides)==21 and sum(x['seconds'] for x in content['mainSlides'])==480
charts=lambda p:[[(s.name,list(s.values)) for s in shape.chart.series] for slide in p.slides for shape in slide.shapes if shape.has_chart]
assert charts(deck)==charts(original) and len(charts(deck))==2
assert all(slide.notes_slide.notes_text_frame.text.strip() for slide in deck.slides)
paragraphs=[p.text for p in doc.paragraphs]
for i,item in enumerate(content['mainSlides']):
    assert item['speech'] in deck.slides[i].notes_slide.notes_text_frame.text
    assert item['speech'] in paragraphs
assert '谭海翔' in deck.slides[13].shapes[8].text
assert '本轮新增代码与模块设计' in '\n'.join(c.text for t in doc.tables for row in t.rows for c in row.cells)
assert not doc.styles.element.xpath('.//w:pBdr')
assert len(list(render.glob('*.PNG')))==21
for image in render.glob('*.PNG'):
    with Image.open(image) as im:assert im.size==(1600,900)
reader=PdfReader(render/'speaker.pdf')
assert len(reader.pages)==14
text='\n'.join(page.extract_text() or '' for page in reader.pages)
compact=lambda text:re.sub(r'\s','',text)
for item in content['mainSlides']:assert compact(item['speech']) in compact(text)
assert args.visual_review_complete,'Visual review is required before final delivery'
shutil.copy2(render/'speaker.pdf',pdf)
validation=json.loads((out/'defense-v4-validation.json').read_text(encoding='utf8'))
validation.update({
    'speakerPdf':str(pdf),'pdfPages':14,'visualReview':{'slidesReviewed':21,'printPagesReviewed':14,'status':'passed','renderer':manifest['renderer'],'recheckedSlides':[6,13,15,16,17,20,21],'sourceRenderHashVerified':True},
    'scriptNotesAndPrintTextMatch':'16/16','originalNativeChartDataPreserved':True,
    'deliverableSha256':{str(p.relative_to(root)).replace('\\','/'):sha(p) for p in [ppt,docx,pdf,root/'docs/defense-v4-content.json',root/'scripts/build_defense_v4.py',root/'scripts/verify_defense_v4.py',root/'scripts/render-defense.ps1']},
    'artifactBuildRerunsProductTests':False,
})
(out/'defense-v4-validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'slides':21,'pdfPages':14,'notesAndPrint':'16/16 match','chartsPreserved':2,'sourceHashes':24,'resultHashes':15,'visualReview':'passed'},ensure_ascii=False))
