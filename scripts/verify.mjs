import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(fileURLToPath(new URL('..', import.meta.url)));
if(path.resolve(process.cwd()).toLowerCase()!==root.toLowerCase())throw Error('验证须从项目目录运行：'+root);
await fs.mkdir(path.join(root,'.tmp'),{recursive:true});
const env={...process.env,TEMP:path.join(root,'.tmp'),TMP:path.join(root,'.tmp')};
for(const args of [['scripts/compile.mjs'],['node_modules/vite/bin/vite.js','build'],['--test','--test-concurrency=1','tests/contract.test.mjs','tests/protocol.test.mjs','tests/ai.test.mjs','tests/certificate.test.mjs','tests/channel-client-ai.test.mjs']]){
  console.log('RUN',process.execPath,...args);
  const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{cwd:root,env,stdio:'inherit'});child.on('error',reject);child.on('exit',resolve);});
  if(code!==0){process.exitCode=code||1;break;}
}
