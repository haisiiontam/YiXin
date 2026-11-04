import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Wallet, keccak256, id } from 'ethers';
import { evaluate, movesHex, requireExtension, fromHex, metrics, BLACK_WIN, STATE_TYPES } from '../shared/gomoku.mjs';
import { verifyEvidence } from '../shared/evidence.mjs';
const results=[];
function check(name,fn){test(name,async()=>{try{await fn();results.push({name,status:'passed'});}catch(e){results.push({name,status:'failed',error:e.message});throw e;}});}
const outputDir = process.env.TEST_RESULTS_DIR || 'artifacts/test-results';
process.on('exit',()=>{fs.mkdirSync(outputDir,{recursive:true});fs.writeFileSync(`${outputDir}/protocol-results.json`,JSON.stringify({generatedAt:new Date().toISOString(),tests:results,summary:{passed:results.filter(t=>t.status==='passed').length,failed:results.filter(t=>t.status==='failed').length}},null,2));});
check('JS规则拒绝非法类型、越界、占位、分叉和终局后落子',()=>{
  for(const moves of [null,Array(226).fill(0),[225],[-1],[1.5],[0,0],[...BLACK_WIN,1]]) assert.throws(()=>evaluate(moves));
  assert.throws(()=>requireExtension([0,15],[0,16,1]));assert.throws(()=>requireExtension([0],[0,15,1]));
  assert.deepEqual(fromHex(movesHex(BLACK_WIN)),BLACK_WIN);assert.equal(evaluate(BLACK_WIN).winner,1);
});
check('合法长连、4方向及边缘不能跨行连接',()=>{
  const white=[0,15,1,16,2,17,3,18,30,19];assert.equal(evaluate(white).winner,2);
  for(const line of [[0,1,2,3,4],[0,15,30,45,60],[0,16,32,48,64],[14,28,42,56,70]]){
    const moves=[];for(let i=0;i<5;i++){moves.push(line[i]);if(i<4)moves.push(150+i);}
    assert.equal(evaluate(moves).winner,1);
  }
  assert.equal(evaluate([13,150,14,151,15,152,16,153,17]).terminal,false);
  const overline=[0,150,1,151,2,152,4,153,5,170,3];assert.equal(evaluate(overline).winner,1);
});
check('事务指标对0手、正常局、争议额外事务和gas进行精确计量',()=>{
  assert.equal(metrics([],[]).savedPercent,0);
  const tx=Array.from({length:3},()=>({gasUsed:'10000000000000000000'}));
  const m=metrics(BLACK_WIN,tx);assert.equal(m.baselineTransactions,11);assert.equal(m.onchainTransactions,3);assert.equal(m.totalGas,'30000000000000000000');assert.equal(m.savedPercent,72.7);
  assert.equal(metrics([0],Array(5).fill({gasUsed:'1'})).savedPercent,-66.7);
});
check('证据双签可独立核验，篡改棋谱、身份、签名域与积分格式被拒绝',async()=>{
  const black=Wallet.createRandom(),white=Wallet.createRandom();
  const domain={name:'GomokuChannel',version:'1',chainId:31337,verifyingContract:'0x0000000000000000000000000000000000000001'};
  const channelId=id('test-evidence'),value={channelId,movesHash:keccak256(movesHex(BLACK_WIN))};
  const e={format:'gomoku-channel-evidence/v1',domain,channelId,participants:{black:black.address,white:white.address},stake:10,checkpoint:{moves:BLACK_WIN,sigBlack:await black.signTypedData(domain,STATE_TYPES,value),sigWhite:await white.signTypedData(domain,STATE_TYPES,value)},onchain:{moves:BLACK_WIN}};
  assert.equal(verifyEvidence(e).valid,true);
  for(const mutate of [x=>x.checkpoint.moves[0]=111,x=>x.domain.chainId++,x=>x.domain.verifyingContract='0x0000000000000000000000000000000000000002',x=>x.channelId=id('another'),x=>x.participants.black=white.address,x=>x.checkpoint.sigWhite=x.checkpoint.sigBlack,x=>x.stake=-1,x=>x.onchain.moves=[1,2]]){
    const copy=structuredClone(e);mutate(copy);assert.throws(()=>verifyEvidence(copy));
  }
  assert.throws(()=>verifyEvidence(e,{chainId:1}));
  assert.throws(()=>verifyEvidence(e,{verifyingContract:'0x0000000000000000000000000000000000000002'}));
});
