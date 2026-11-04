import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, id as hashId } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { blackWin, movesHex, channelId, signatures, offlineWallets } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const destination = path.resolve(root, process.env.TEST_RESULTS_DIR || 'artifacts/test-results');
const results = { generatedAt: null, environment: { node: process.version, chainId: 31337, challengePeriod: 30, transport: 'in-memory Ganache only; no external chain' }, tests: [], transactions: [], attacks: [] };
let chain, provider, signers, wallets, saltCounter = 0;
before(async () => {
  chain = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, miner: { blockGasLimit: 30000000, timestampIncrement: 0 }, wallet: { deterministic: true, totalAccounts: 3 } });
  provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
  provider.pollingInterval = 10;
  signers = await Promise.all([0, 1, 2].map(i => provider.getSigner(i)));
  wallets = offlineWallets(chain);
  results.environment.solc = compile().compiler;
  results.environment.sourceSha256 = createHash('sha256').update(fs.readFileSync(path.join(root, 'contracts/GomokuChannel.sol'))).digest('hex');
});
after(async () => {
  results.generatedAt = new Date().toISOString();
  results.summary = { passed: results.tests.filter(t => t.status === 'passed').length, failed: results.tests.filter(t => t.status === 'failed').length };
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'dispute-security-results.json'), JSON.stringify(results, null, 2) + '\n');
  await provider?.destroy();
  await chain?.disconnect();
});
function check(name, fn) {
  test(name, async () => {
    try { await fn(); results.tests.push({ name, status: 'passed' }); }
    catch (error) { results.tests.push({ name, status: 'failed', error: error.message }); throw error; }
  });
}
async function mined(label, pending) {
  const tx = await pending, receipt = await tx.wait();
  assert.equal(receipt.status, 1);
  results.transactions.push({ label, hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), status: receipt.status });
  return receipt;
}
async function fixture(name = 'GomokuChannel') {
  const artifact = compile(name);
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, signers[0]).deploy(30, 60);
  await mined('deploy ' + name, contract.deploymentTransaction());
  for (const signer of signers.slice(0, 2)) await mined('register', contract.connect(signer).register());
  const salt = hashId('dispute-security-' + ++saltCounter), id = channelId(wallets[0].address, wallets[1].address, salt);
  await mined('open', contract.openChannel(wallets[1].address, 100, salt));
  await mined('join', contract.connect(signers[1]).joinChannel(id));
  return { contract, id };
}
async function signed(contract, id, moves) {
  const hex = movesHex(moves);
  return [id, hex, ...await signatures(contract, id, hex, wallets)];
}
async function at(timestamp) {
  await chain.request({ method: 'evm_setTime', params: [Number(timestamp) * 1000] });
  await chain.request({ method: 'evm_mine', params: [] });
  const latest = await chain.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
  assert.equal(BigInt(latest.timestamp), BigInt(timestamp));
}

check('old one-move challenge cannot fork away a newer jointly signed nine-move terminal state', async () => {
  const { contract, id } = await fixture();
  const terminal = await signed(contract, id, blackWin);
  await mined('losing white challenges old one-move checkpoint', contract.connect(signers[1]).challenge(...await signed(contract, id, [0])));
  let accepted = false;
  try {
    await mined('attempt immediate divergent white forced move', contract.connect(signers[1]).forceMove(id, 100));
    accepted = true;
  } catch (error) {
    assert.match(`${error.reason || error.shortMessage || error.message} ${error.info?.error?.message || ''}`, /proof window pending/);
  }
  if (accepted) {
    await assert.rejects(contract.settle.staticCall(...terminal), /incompatible checkpoint/);
    results.attacks.push({ immediateForkAccepted: true, latestSignedTerminalRejected: true });
    assert.fail('Old checkpoint plus immediate divergent forceMove suppresses the latest jointly signed terminal state');
  }
  results.attacks.push({ immediateForkAccepted: false });
  assert.equal((await contract.getChannel(id)).moves, movesHex([0]));
  await mined('latest nine-move double-signed result settles during proof window', contract.settle(...terminal));
  const settled = await contract.getChannel(id);
  assert.equal(settled.status, 4n);
  assert.equal(settled.winner, 1n);
  assert.equal(settled.moves, movesHex(blackWin));
  assert.equal(await contract.points(wallets[0].address), 1100n);
  assert.equal(await contract.points(wallets[1].address), 900n);
});

check('proof boundary admits forced play, freezes checkpoint updates and preserves the response deadline', async () => {
  const { contract, id } = await fixture();
  await mined('empty checkpoint starts proof phase', contract.challenge(id, '0x', '0x', '0x'));
  const initial = await contract.getChannel(id);
  assert.equal(initial.deadline, initial.proofDeadline + 30n);
  await at(initial.proofDeadline - 1n);
  await assert.rejects(contract.forceMove.staticCall(id, 0), /proof window pending/);
  await assert.rejects(contract.claimTimeout.staticCall(id), /timeout unavailable/);
  await mined('new one-move checkpoint before proof deadline', contract.challenge(...await signed(contract, id, [0])));
  const updated = await contract.getChannel(id);
  assert.equal(updated.proofDeadline, initial.proofDeadline + 29n);
  assert.equal(updated.deadline, updated.proofDeadline + 30n);
  await at(updated.proofDeadline);
  await assert.rejects(contract.challenge.staticCall(...await signed(contract, id, [0, 15])), /proof window expired/);
  await assert.rejects(contract.claimTimeout.staticCall(id), /timeout unavailable/);
  await mined('white forced move at exact proof deadline', contract.connect(signers[1]).forceMove(id, 15));
  const continued = await contract.getChannel(id);
  assert.equal(continued.proofDeadline, updated.proofDeadline);
  assert.equal(continued.deadline, updated.deadline);
  await at(continued.deadline - 1n);
  await mined('black forced move extends only response deadline', contract.forceMove(id, 1));
  const next = await contract.getChannel(id);
  assert.equal(next.proofDeadline, updated.proofDeadline);
  assert.equal(next.deadline, continued.deadline + 29n);
  await assert.rejects(contract.challenge.staticCall(...await signed(contract, id, [0, 15, 1, 16])), /proof window expired/);
  await at(next.deadline);
  await assert.rejects(contract.connect(signers[1]).forceMove.staticCall(id, 16), /challenge expired/);
  await mined('white response timeout at exact response deadline', contract.claimTimeout(id));
  assert.equal((await contract.getChannel(id)).winner, 1n);
});

check('refused winning signature recovers after the full proof window and baseline moves remain immediate', async () => {
  const { contract, id } = await fixture();
  await mined('eight-move checkpoint', contract.challenge(...await signed(contract, id, blackWin.slice(0, 8))));
  const state = await contract.getChannel(id);
  await assert.rejects(contract.forceMove.staticCall(id, 4), /proof window pending/);
  await at(state.proofDeadline);
  await mined('black forces refused winning move', contract.forceMove(id, 4));
  assert.equal((await contract.getChannel(id)).winner, 1n);
  const baseline = await fixture('GomokuOnchainBaseline');
  await mined('baseline immediate first move', baseline.contract.playMove(baseline.id, 0));
  await mined('baseline immediate second move', baseline.contract.connect(signers[1]).playMove(baseline.id, 15));
  assert.equal((await baseline.contract.getChannel(baseline.id)).moves, movesHex([0, 15]));
});
