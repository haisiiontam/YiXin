// Real local EVM integration. Reports contain receipts and assertions, never keys.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, Contract, ContractFactory, Wallet, Signature, AbiCoder, id, keccak256 } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { verifyEvidence } from '../shared/evidence.mjs';
import { verifyEvidenceOnchain } from '../shared/evidence-chain.mjs';
import { BLACK_WIN, STATE_TYPES, movesHex } from '../shared/gomoku.mjs';

const auditDir = process.env.TEST_RESULTS_DIR ? path.resolve(process.env.TEST_RESULTS_DIR) : fileURLToPath(new URL('../artifacts/test-results/evidence-audit/', import.meta.url));
const report = { generatedAt: null, environment: { chainId: 31337, transport: 'Ganache in-memory EIP1193', realAssets: false }, tests: [], transactions: [] };
let chain, provider, contract, artifact, signers, wallets, domain, counter = 0;
function check(name, fn) {
  test(name, async () => {
    try { await fn(); report.tests.push({ name, status: 'passed' }); }
    catch (error) { report.tests.push({ name, status: 'failed', error: error.message }); throw error; }
  });
}
async function confirmed(pending, label) {
  const tx = await pending;
  const receipt = await tx.wait();
  report.transactions.push({ label, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), status: receipt.status });
  return receipt;
}
before(async () => {
  fs.mkdirSync(path.join(auditDir, 'tmp'), { recursive: true });
  process.env.TEMP = path.join(auditDir, 'tmp'); process.env.TMP = process.env.TEMP;
  chain = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, miner: { blockGasLimit: 30000000 }, wallet: { deterministic: true, totalAccounts: 3 } });
  provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  signers = await Promise.all([0, 1].map(n => provider.getSigner(n)));
  wallets = Object.values(chain.getInitialAccounts()).slice(0, 2).map(account => new Wallet(account.secretKey));
  artifact = compile();
  contract = await new ContractFactory(artifact.abi, artifact.bytecode, signers[0]).deploy(30, 60);
  await confirmed(Promise.resolve(contract.deploymentTransaction()), 'deploy GomokuChannel');
  for (const signer of signers) await confirmed(contract.connect(signer).register(), 'register');
  domain = { name: 'GomokuChannel', version: '1', chainId: 31337, verifyingContract: await contract.getAddress() };
});
after(async () => {
  report.generatedAt = new Date().toISOString();
  report.summary = { passed: report.tests.filter(t => t.status === 'passed').length, failed: report.tests.filter(t => t.status === 'failed').length };
  fs.mkdirSync(auditDir, { recursive: true });
  fs.writeFileSync(path.join(auditDir, 'evidence-chain-results.json'), JSON.stringify(report, null, 2) + '\n');
  provider?.destroy(); await chain?.disconnect();
});
async function signedEvidence(channelId, moves, signingDomain = domain) {
  const value = { channelId, movesHash: keccak256(movesHex(moves)) };
  return { format: 'gomoku-channel-evidence/v1', domain: signingDomain, channelId, participants: { black: wallets[0].address, white: wallets[1].address }, stake: 10,
    checkpoint: { moves, sigBlack: await wallets[0].signTypedData(signingDomain, STATE_TYPES, value), sigWhite: await wallets[1].signTypedData(signingDomain, STATE_TYPES, value) }, transactions: [] };
}
async function opened() {
  const salt = id('evidence-audit-' + ++counter);
  const channelId = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [wallets[0].address, wallets[1].address, salt]));
  const open = await confirmed(contract.openChannel(wallets[1].address, 10, salt), 'open');
  const join = await confirmed(contract.connect(signers[1]).joinChannel(channelId), 'join');
  return { channelId, open, join };
}
const verify = (evidence, expected = {}) => verifyEvidenceOnchain(evidence, { provider, contract, expected });

check('离线校验拒绝带salt/额外字段域、compact64以及v=0/1签名', async () => {
  const channelId = id('offline-domain-audit');
  const salted = await signedEvidence(channelId, [112, 113], { ...domain, salt: id('salt') });
  assert.throws(() => verifyEvidence(salted), /签名域/);
  const extra = await signedEvidence(channelId, [112, 113]); extra.domain = { ...domain, arbitrary: 'ignored?' };
  assert.throws(() => verifyEvidence(extra), /签名域/);
  const compact = await signedEvidence(channelId, [112, 113]);
  compact.checkpoint.sigBlack = Signature.from(compact.checkpoint.sigBlack).compactSerialized;
  assert.throws(() => verifyEvidence(compact), /65字节/);
  const noncanonical = await signedEvidence(channelId, [112, 113]);
  const signature = Signature.from(noncanonical.checkpoint.sigBlack);
  noncanonical.checkpoint.sigBlack = signature.serialized.slice(0, -2) + (signature.v - 27).toString(16).padStart(2, '0');
  assert.throws(() => verifyEvidence(noncanonical), /65字节/);
});
check('空谱免签明确signed=false；真实空谱双签可验；垃圾签名被拒绝', async () => {
  const evidence = await signedEvidence(id('unsigned-empty-audit'), []);
  assert.equal(verifyEvidence(evidence).signed, true);
  evidence.checkpoint.sigBlack = ''; evidence.checkpoint.sigWhite = '0x';
  assert.equal(verifyEvidence(evidence).signed, false);
  evidence.checkpoint.sigBlack = 'not-a-signature';
  assert.throws(() => verifyEvidence(evidence), /65字节/);
});
check('真实结算从RPC返回胜负并重建完整三笔交易，空清单不能制造0交易', async () => {
  const f = await opened(), evidence = await signedEvidence(f.channelId, BLACK_WIN);
  await confirmed(contract.settle(f.channelId, movesHex(BLACK_WIN), evidence.checkpoint.sigBlack, evidence.checkpoint.sigWhite), 'settle');
  evidence.onchain = { status: 'cancelled', moves: BLACK_WIN, winner: 2, reason: 'forged', deadline: 123 };
  const result = await verify(evidence, { chainId: 31337, verifyingContract: domain.verifyingContract });
  assert.equal(result.cryptographicOnly, false); assert.equal(result.signed, true);
  assert.equal(result.chain.status, 4); assert.equal(result.chain.winner, 1); assert.equal(result.chain.reason, 1); assert.equal(result.chain.deadline, 0);
  assert.deepEqual(result.chain.moves, BLACK_WIN); assert.equal(result.transactions.length, 3); assert.equal(result.transactionListComplete, true);
  assert.equal(result.chain.source, 'trusted-rpc'); assert.equal(result.chain.codeIdentityVerified, false);
  assert.ok(result.transactions.every(tx => tx.timestamp > 0 && BigInt(tx.gasUsed) > 0n));
});
check('遗漏、重复回执和伪造gas/区块/时间/标签不能改变RPC重建计量', async () => {
  const f = await opened(), evidence = await signedEvidence(f.channelId, [112, 113]);
  evidence.transactions = Array(4).fill({ hash: f.open.hash, gasUsed: '-9999999', blockNumber: -1, timestamp: 1, label: '伪造结算' });
  const result = await verify(evidence);
  assert.equal(result.transactions.length, 2); assert.equal(result.chain.transactions, 2);
  assert.deepEqual(result.transactions.map(tx => tx.hash), [f.open.hash, f.join.hash]);
  assert.equal(result.transactions[0].gasUsed, f.open.gasUsed.toString()); assert.equal(result.transactions[0].blockNumber, f.open.blockNumber);
  assert.equal(result.transactions[0].label, '锁定黑方积分'); assert.ok(result.transactions[0].timestamp > 1);
});
check('不存在、其他通道和实际执行失败的交易hash被拒绝', async () => {
  const a = await opened(), b = await opened();
  const evidence = await signedEvidence(a.channelId, [112, 113]);
  for (const hash of [id('does-not-exist'), b.open.hash]) {
    evidence.transactions = [{ hash }]; await assert.rejects(verify(evidence), /不属于该通道/);
  }
  const failed = await contract.claimTimeout(a.channelId, { gasLimit: 200000 });
  await assert.rejects(failed.wait());
  const receipt = await provider.getTransactionReceipt(failed.hash); assert.equal(receipt.status, 0);
  report.transactions.push({ label: 'failed timeout', hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), status: receipt.status });
  evidence.transactions = [{ hash: failed.hash }]; await assert.rejects(verify(evidence), /未成功/);
});
check('RPC实际分叉棋谱不能被文件自述的兼容链谱掩盖', async () => {
  const f = await opened(), branch = await signedEvidence(f.channelId, [0, 15]);
  await confirmed(contract.challenge(f.channelId, movesHex(branch.checkpoint.moves), branch.checkpoint.sigBlack, branch.checkpoint.sigWhite), 'challenge fork');
  const evidence = await signedEvidence(f.channelId, [112, 113]); evidence.onchain = { moves: [112, 113] };
  await assert.rejects(verify(evidence), /RPC链上棋谱.*分叉/);
});
check('forceMove后的链上扩展允许原双签前缀，末手双事件只计一笔交易', async () => {
  const f = await opened(), evidence = await signedEvidence(f.channelId, BLACK_WIN.slice(0, 8));
  await confirmed(contract.challenge(f.channelId, movesHex(evidence.checkpoint.moves), evidence.checkpoint.sigBlack, evidence.checkpoint.sigWhite), 'challenge');
  const challenged = await contract.getChannel(f.channelId);
  const proofDeadline = Number(challenged.proofDeadline ?? 0);
  if (proofDeadline) {
    await chain.request({ method: 'evm_setTime', params: [proofDeadline * 1000] });
    await chain.request({ method: 'evm_mine', params: [] });
    assert.equal((await verify(evidence)).chain.proofDeadline, proofDeadline);
  }
  await confirmed(contract.forceMove(f.channelId, BLACK_WIN.at(-1)), 'force winning move');
  const result = await verify(evidence);
  assert.deepEqual(result.chain.moves, BLACK_WIN); assert.equal(result.movesCount, 8); assert.equal(result.chain.winner, 1);
  assert.equal(result.transactions.length, 4); assert.equal(result.transactions.at(-1).label, '结算积分');
});
check('验证链ID/部署地址/可选可信代码hash，并拒绝无代码地址', async () => {
  const f = await opened(), evidence = await signedEvidence(f.channelId, [112, 113]);
  await assert.rejects(verify(evidence, { chainId: 1 }), /其他链/);
  await assert.rejects(verify(evidence, { verifyingContract: wallets[0].address }), /其他合约/);
  const wrongChain = await signedEvidence(f.channelId, [112, 113], { ...domain, chainId: 1 });
  await assert.rejects(verify(wrongChain), /RPC链ID/);
  await assert.rejects(verify(evidence, { runtimeCodeHash: id('wrong-code') }), /代码与可信部署/);
  const hash = keccak256(await provider.getCode(domain.verifyingContract));
  assert.equal((await verify(evidence, { runtimeCodeHash: hash })).chain.codeIdentityVerified, true);
  const eoaEvidence = await signedEvidence(f.channelId, [112, 113], { ...domain, verifyingContract: wallets[0].address });
  await assert.rejects(verifyEvidenceOnchain(eoaEvidence, { provider, contract: new Contract(wallets[0].address, artifact.abi, provider) }), /没有合约代码/);
});
check('实际部署的伪实现虽返回相同参与者和积分，错误stateDigest仍被拒绝', async () => {
  const source = 'pragma solidity ^0.8.30; contract Spoof { struct C { address black; address white; uint256 stake; uint8 status; uint256 deadline; bytes moves; uint8 winner; uint8 reason; } address b; address w; constructor(address b_,address w_){b=b_;w=w_;} function getChannel(bytes32) external view returns(C memory){return C(b,w,10,2,0,hex"",0,0);} function stateDigest(bytes32,bytes calldata) external pure returns(bytes32){return bytes32(0);} }';
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Spoof.sol': { content: source } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const compiled = output.contracts['Spoof.sol'].Spoof;
  const spoof = await new ContractFactory(compiled.abi, '0x' + compiled.evm.bytecode.object, signers[0]).deploy(wallets[0].address, wallets[1].address);
  await confirmed(Promise.resolve(spoof.deploymentTransaction()), 'deploy spoof');
  const evidence = await signedEvidence(id('spoof-channel'), [112, 113], { ...domain, verifyingContract: await spoof.getAddress() });
  await assert.rejects(verifyEvidenceOnchain(evidence, { provider, contract: spoof }), /合约状态摘要/);
});
