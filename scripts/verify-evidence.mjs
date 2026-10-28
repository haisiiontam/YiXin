import fs from 'node:fs/promises';
import { JsonRpcProvider, Contract } from 'ethers';
import { verifyEvidence } from '../shared/evidence.mjs';
const file = process.argv[2];
if (!file) { console.error('用法: node scripts/verify-evidence.mjs <evidence.json> [--rpc http://127.0.0.1:4173/rpc]'); process.exitCode = 1; }
else {
  let provider;
  try {
    const evidence = JSON.parse(await fs.readFile(file, 'utf8'));
    const result = verifyEvidence(evidence);
    const index = process.argv.indexOf('--rpc');
    if (index >= 0) {
      provider = new JsonRpcProvider(process.argv[index + 1], undefined, { cacheTimeout: -1 });
      const network = await provider.getNetwork();
      if (network.chainId !== BigInt(evidence.domain.chainId)) throw Error('RPC链ID与证据不符');
      const abi = JSON.parse(await fs.readFile(new URL('../artifacts/contracts/GomokuChannel.json', import.meta.url), 'utf8')).abi;
      const c = new Contract(evidence.domain.verifyingContract, abi, provider);
      const channel = await c.getChannel(evidence.channelId);
      if (channel.black !== result.black || channel.white !== result.white || channel.stake !== BigInt(evidence.stake)) throw Error('链上通道参与者或积分与证据不符');
      let verifiedTransactions = 0;
      for (const tx of evidence.transactions || []) {
        const receipt = await provider.getTransactionReceipt(tx.hash);
        if (!receipt || receipt.status !== 1 || receipt.to.toLowerCase() !== evidence.domain.verifyingContract.toLowerCase()) throw Error('交易receipt无效：'+tx.hash);
        if (!receipt.logs.some(log => { try { return log.address.toLowerCase() === evidence.domain.verifyingContract.toLowerCase() && c.interface.parseLog(log)?.args.id === evidence.channelId; } catch { return false; } })) throw Error('交易不属于该通道');
        verifiedTransactions++;
      }
      result.chain = { verified: true, status: Number(channel.status), winner: Number(channel.winner), reason: Number(channel.reason), transactions: verifiedTransactions };
      result.cryptographicOnly = false;
    }
    console.log(JSON.stringify(result, null, 2));
  } catch (e) { console.error('证据核验失败:', e.shortMessage || e.message); process.exitCode = 1; }
  finally { provider?.destroy(); }
}
