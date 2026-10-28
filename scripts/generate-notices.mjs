import fs from 'node:fs/promises';
import path from 'node:path';
const project=JSON.parse(await fs.readFile('package.json','utf8'));
const rows=[];
for(const [name,version] of Object.entries({...project.dependencies,...project.devDependencies})){
 const folder=path.join('node_modules',name),p=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));
 const repository=(typeof p.repository==='string'?p.repository:p.repository?.url||p.homepage||'').replace(/^git\+/,'').replace(/^git:\/\//,'https://').replace(/\.git$/,'');
 let licenseFile='';for(const candidate of ['LICENSE','LICENSE.md','LICENSE.txt','LICENCE','COPYING']){try{await fs.access(path.join(folder,candidate));licenseFile=path.join(folder,candidate).replaceAll('\\','/');break;}catch{}}
 rows.push({name,version,installedVersion:p.version,license:typeof p.license==='string'?p.license:JSON.stringify(p.license),repository,licenseFile});
}
await fs.mkdir('docs/research',{recursive:true});
await fs.writeFile('docs/research/dependency-manifest.json',JSON.stringify(rows,null,2));
const usage={'@openzeppelin/contracts':'合约EIP712域编码与ECDSA恢复，不复用游戏规则','ethers':'钱包/签名、ABI与JSON-RPC','express':'本地REST/静态页服务','ganache':'本地真实EVM测试与持久化','react':'组件状态与UI','react-dom':'浏览器渲染','ws':'链下消息中继','@playwright/test':'Edge浏览器端到端验证','solc':'本地Solidity编译器','vite':'前端构建与分包'};
const text='# 第三方来源、许可证与自主实现边界\n\n依赖版本由package.json及pnpm-lock.yaml锁定。下表从已安装模块的package.json实际读取；不声称外部框架代码属于本人。完整再分发时须保留对应许可证与间接依赖许可证。\n\n| 模块 | 实际版本 | 许可证 | GitHub来源 | 本项目用途 |\n| --- | --- | --- | --- | --- |\n'+rows.map(r=>`| ${r.name} | ${r.installedVersion} | ${r.license} | ${r.repository} | ${usage[r.name]||''} |`).join('\n')+'\n\n自主实现：15×15规则与合法全谱回放、应用专用通道生命周期/积分锁定/前缀争议/强制落子/超时、双签提案协议、证据导入导出核验、同口径逐步上链基线、中文界面与工程文档。Perun/MUD只用于方案研究，没有拷贝其核心通道代码，详见docs/research.md。\n\n文档工具：宿主只读Python运行时的python-docx/python-pptx/Pillow/lxml；PDF文本提取另在工作区.vendor/python安装pypdf6.1.1（BSD-3-Clause）。课程PPT、教案与两份参考报告仅内部参考，来源归原作者，公开源码包不包含这些材料及提取文本。\n';
await fs.writeFile('THIRD_PARTY_NOTICES.md',text);
console.log('Recorded',rows.length,'direct dependencies');
