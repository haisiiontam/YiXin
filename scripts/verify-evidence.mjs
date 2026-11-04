import fs from 'node:fs/promises';
import { JsonRpcProvider, Contract } from 'ethers';
import { verifyEvidence } from '../shared/evidence.mjs';
import { verifyEvidenceOnchain } from '../shared/evidence-chain.mjs';
const file = process.argv[2];
if (!file) { console.error('用法: node scripts/verify-evidence.mjs <evidence.json> [--rpc <可信RPC URL>] [--contract <可信部署地址>] [--code-hash <可信运行时代码hash>] [--from-block <部署区块，默认0>]'); process.exitCode = 1; }
else {
  let provider;
  try {
    const option = name => {
      const index = process.argv.indexOf(name);
      if (index < 0) return undefined;
      const value = process.argv[index + 1];
      if (!value || value.startsWith('--')) throw Error(name + '缺少参数');
      return value;
    };
    const evidence = JSON.parse(await fs.readFile(file, 'utf8'));
    const fromBlock = option('--from-block');
    if (fromBlock !== undefined && (!/^\d+$/.test(fromBlock) || !Number.isSafeInteger(Number(fromBlock)))) throw Error('--from-block须为非负安全整数');
    // On a long-lived chain, supply the trusted deployment block to avoid scanning from genesis.
    const expected = { verifyingContract: option('--contract'), runtimeCodeHash: option('--code-hash'), deploymentBlock: fromBlock === undefined ? undefined : Number(fromBlock) };
    let result = verifyEvidence(evidence, expected);
    const rpc = option('--rpc');
    if (rpc) {
      provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
      const abi = JSON.parse(await fs.readFile(new URL('../artifacts/contracts/GomokuChannel.json', import.meta.url), 'utf8')).abi;
      const contract = new Contract(evidence.domain.verifyingContract, abi, provider);
      result = await verifyEvidenceOnchain(evidence, { provider, contract, expected });
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error('证据核验失败:', e.shortMessage || e.message); process.exitCode = 1; }
  finally { provider?.destroy(); }
}
