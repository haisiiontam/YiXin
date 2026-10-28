import fs from 'node:fs/promises';
const sources = [
 ['openzeppelin','https://raw.githubusercontent.com/OpenZeppelin/openzeppelin-contracts/v5.4.0/README.md'],
 ['statechannels','https://raw.githubusercontent.com/statechannels/statechannels/master/README.md'],
 ['nitro','https://raw.githubusercontent.com/statechannels/go-nitro/main/README.md'],
 ['perun','https://raw.githubusercontent.com/hyperledger-labs/go-perun/main/README.md'],
 ['mud','https://raw.githubusercontent.com/latticexyz/mud/main/README.md'],
 ['ethers','https://raw.githubusercontent.com/ethers-io/ethers.js/main/README.md'],
 ['eip712','https://raw.githubusercontent.com/ethereum/EIPs/master/EIPS/eip-712.md'],
];
await fs.mkdir('docs/research/snapshots',{recursive:true});
const results=await Promise.all(sources.map(async ([name,url])=>{
 try { const r=await fetch(url); const text=await r.text(); if(!r.ok)throw Error(String(r.status)); await fs.writeFile(`docs/research/snapshots/${name}.md`,text); return {name,url,status:r.status,bytes:Buffer.byteLength(text),retrievedAt:new Date().toISOString()}; }
 catch(e){return {name,url,error:e.message};}
}));
await fs.writeFile('docs/research/source-manifest.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results,null,2));
