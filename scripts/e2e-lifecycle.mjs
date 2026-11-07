import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd(), out=path.resolve(process.env.TEST_RESULTS_DIR||'artifacts/test-results/lifecycle-20261107');
await fs.mkdir(out,{recursive:true});
const report={generatedAt:new Date().toISOString(),tests:[]};
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,env:{...process.env,TEMP:root+'/.tmp',TMP:root+'/.tmp',LOCALAPPDATA:root+'/.tmp/lifecycle-browser',APPDATA:root+'/.tmp/lifecycle-app'},args:['--no-first-run','--disable-sync']});
const base=process.env.TEST_URL||'http://127.0.0.1:4187';
async function check(name,fn){try{await fn();report.tests.push({name,status:'passed'});}catch(e){report.tests.push({name,status:'failed',error:e.stack});throw e;}}
try{
const a=await browser.newContext(), b=await browser.newContext();const p=await a.newPage(),q=await b.newPage();
await Promise.all([p.goto(base),q.goto(base)]);
await Promise.all([p.getByText('本地链已连接',{exact:false}).waitFor(),q.getByText('本地链已连接',{exact:false}).waitFor()]);
let cancelled;
await check('unmatched creator cancels and can create again',async()=>{
 await p.getByRole('button',{name:'创建对局',exact:true}).click(); await p.locator('.room-info > code').waitFor();cancelled=await p.locator('.room-info > code').textContent();
 await p.getByRole('button',{name:'取消房间 / 邀请',exact:true}).click();await p.getByRole('button',{name:'创建对局',exact:true}).waitFor();
 assert(await p.getByRole('button',{name:'运行完整自动演示',exact:true}).isEnabled());
});
await check('cancelled invite cannot be reused',async()=>{
 await q.getByRole('textbox',{name:'邀请码',exact:true}).fill(cancelled);await q.getByRole('button',{name:'加入对局',exact:true}).click();
 await q.getByText('房间不存在或已取消',{exact:false}).first().waitFor();
});
await check('concession has a reversible confirmation then settles both players',async()=>{
 await p.getByRole('button',{name:'创建对局',exact:true}).click();await p.locator('.room-info > code').waitFor();const id=await p.locator('.room-info > code').textContent();
 await q.getByRole('textbox',{name:'邀请码',exact:true}).fill(id);await q.getByRole('button',{name:'加入对局',exact:true}).click();
 await p.getByText('对局进行中',{exact:true}).waitFor({timeout:30000});await q.getByText('对局进行中',{exact:true}).waitFor({timeout:30000});
 await p.getByRole('button',{name:'认输并结束本局',exact:true}).click();await p.getByRole('button',{name:'继续对局',exact:true}).click();
 assert(await p.getByText('对局进行中',{exact:true}).isVisible());
 await p.getByRole('button',{name:'认输并结束本局',exact:true}).click();await p.getByRole('button',{name:'确认认输并结算',exact:true}).click();
 await p.locator('.settled-note').waitFor({timeout:30000});await q.locator('.settled-note').waitFor({timeout:30000});
 assert.match(await p.locator('.settled-note').textContent(),/主动认输/);
 await p.screenshot({path:path.join(out,'concession.png'),fullPage:true});
});
await check('return to lobby clears invitation and permits next game',async()=>{
 await p.getByRole('button',{name:'返回大厅',exact:true}).click();assert(await p.getByRole('button',{name:'创建对局',exact:true}).isVisible());
 await p.reload();await p.getByText('本地链已连接',{exact:false}).waitFor();assert(await p.getByRole('button',{name:'创建对局',exact:true}).isVisible());
});
}catch(e){console.error(e);process.exitCode=1;}finally{await browser.close();report.summary={passed:report.tests.filter(t=>t.status==='passed').length,failed:report.tests.filter(t=>t.status==='failed').length};await fs.writeFile(path.join(out,'lifecycle-browser-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
