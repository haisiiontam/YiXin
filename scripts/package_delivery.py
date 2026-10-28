from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED
import json,hashlib,re
R=Path(r'E:\Gomoku');O=R/'deliverables';O.mkdir(exist_ok=True)
roots=['contracts','server','shared','scripts','tests','web','docs','reports','site','artifacts/test-results']
files=[R/p for p in ['AGENTS.md','.gitignore','.npmrc','README.md','THIRD_PARTY_NOTICES.md','package.json','pnpm-lock.yaml','vite.config.js','启动游戏.cmd']]
for folder in roots:
 files.extend(p for p in (R/folder).rglob('*') if p.is_file())
exclude=('docs/reference-extracts/','artifacts/runtime/','.cache/','.tmp/','.vendor/','node_modules/')
files=sorted({p for p in files if not any(p.relative_to(R).as_posix().startswith(x) for x in exclude) and '__pycache__' not in p.parts and p.suffix not in ['.pyc','.log'] and p.name not in ['pdf-opening-lines.txt']})
records=[]
for p in files:
 data=p.read_bytes();name=p.relative_to(R).as_posix()
 if p.suffix in ['.json','.js','.mjs','.jsx','.md','.html','.txt']:
  text=data.decode('utf-8',errors='ignore')
  # Actual private keys must never appear in exported evidence or distributable data.
  if p.parent.name=='test-results' and re.search(r'"(?:privateKey|mnemonic|secretKey)"\s*:',text):raise RuntimeError('Sensitive field in '+name)
 records.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
manifest={'format':'gomoku-course-delivery/v1','files':records,'excludes':['course original/extracted references','local chain DB and test keys','dependency/cache/temp folders','permissions recovery backups'], 'note':'Evidence contains the captured original local-chain instance; a fresh chain requires rerunning tests. All source and runtime writes remain under E:\\Gomoku.'}
manifestfile=O/'交付清单与SHA256.json';manifestfile.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
zipfile=O/'弈信-源码与工程交付包.zip'
with ZipFile(zipfile,'w',ZIP_DEFLATED,compresslevel=6) as z:
 for p in files:z.write(p,'Gomoku/'+p.relative_to(R).as_posix())
 z.write(manifestfile,'Gomoku/交付清单与SHA256.json')
with ZipFile(zipfile) as z:assert z.testzip() is None
print(json.dumps({'archive':str(zipfile),'files':len(files),'bytes':zipfile.stat().st_size,'sha256':hashlib.sha256(zipfile.read_bytes()).hexdigest()},ensure_ascii=False))
