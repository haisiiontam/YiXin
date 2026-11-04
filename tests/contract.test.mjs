import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, id as hashId, TypedDataEncoder, keccak256, Signature, concat, toBeHex } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { blackWin, whiteWin, movesHex, channelId, signatures, offlineWallets, drawMoves, evaluateJS, stateTypes } from './helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = { schemaVersion: 1, generatedAt: null, environment: { node: process.version, chainId: 31337, hardfork: 'shanghai', transport: 'in-memory EIP1193 + ethers BrowserProvider', challengePeriod: 30, invitePeriod: 60 }, tests: [], transactions: [], comparisons: [], limitations: ['Local deterministic chain only; no real assets or public-chain deployment.', 'Demonstration registration has no Sybil resistance.', 'Honest players must monitor during the dispute window.'] };
let eip1193, provider, signers, wallets, scenario = '', saltCounter = 0;
const started = Date.now();

before(async () => {
  fs.mkdirSync(path.join(root, '.tmp'), { recursive: true });
  eip1193 = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, miner: { blockGasLimit: 30000000, timestampIncrement: 0 }, wallet: { deterministic: true, totalAccounts: 5 } });
  provider = new BrowserProvider(eip1193);
  provider.pollingInterval = 10;
  signers = await Promise.all([0, 1, 2, 3].map(i => provider.getSigner(i)));
  wallets = offlineWallets(eip1193);
  evidence.environment.solc = compile().compiler;
  evidence.environment.optimizer = compile().settings.optimizer;
});
after(async () => {
  evidence.generatedAt = new Date().toISOString();
  evidence.durationMs = Date.now() - started;
  evidence.summary = { passed: evidence.tests.filter(t => t.status === 'passed').length, failed: evidence.tests.filter(t => t.status === 'failed').length, successfulTransactions: evidence.transactions.filter(t => t.status === 1).length, revertedTransactions: evidence.transactions.filter(t => t.status === 0).length };
  const destination = path.resolve(root, process.env.TEST_RESULTS_DIR || 'artifacts/test-results');
  fs.mkdirSync(destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'contract-results.json'), JSON.stringify(evidence, null, 2) + '\n');
  await provider?.destroy();
  await eip1193?.disconnect();
});
function check(name, fn) {
  test(name, async () => {
    scenario = name;
    const start = Date.now();
    try { await fn(); evidence.tests.push({ name, status: 'passed', durationMs: Date.now() - start }); }
    catch (error) { evidence.tests.push({ name, status: 'failed', durationMs: Date.now() - start, error: error.message }); throw error; }
  });
}
async function receipt(action, pending, category = 'game') {
  const tx = await pending;
  let mined;
  try { mined = await tx.wait(); }
  catch (error) { if (!error.receipt) throw error; mined = error.receipt; }
  evidence.transactions.push({ scenario, category, action, hash: mined.hash, blockNumber: mined.blockNumber, gasUsed: mined.gasUsed.toString(), status: mined.status });
  return mined;
}
async function fixture(name = 'GomokuChannel') {
  const artifact = compile(name);
  const c = await new ContractFactory(artifact.abi, artifact.bytecode, signers[0]).deploy(30, 60);
  await receipt(`deploy ${name}`, Promise.resolve(c.deploymentTransaction()), 'deployment');
  for (let i = 0; i < 3; i++) await receipt(`register ${i}`, c.connect(signers[i]).register(), 'registration');
  return c;
}
async function open(c, stake = 100n, join = true) {
  const salt = hashId(`test-channel-${++saltCounter}`);
  const id = channelId(wallets[0].address, wallets[1].address, salt);
  await receipt('open', c.openChannel(wallets[1].address, stake, salt));
  if (join) await receipt('join', c.connect(signers[1]).joinChannel(id));
  return id;
}
async function signed(c, id, moves, overrides = {}) {
  const hex = Array.isArray(moves) ? movesHex(moves) : moves;
  return [id, hex, ...await signatures(c, id, hex, wallets, overrides)];
}
async function conservation(c) {
  const balances = await Promise.all(wallets.map(w => c.points(w.address)));
  assert.equal(balances.reduce((a, b) => a + b, 0n) + await c.totalLocked(), await c.totalIssued());
}
const rejects = async pending => assert.rejects(pending);
async function at(timestamp) {
  await eip1193.request({ method: 'evm_setTime', params: [Number(timestamp) * 1000] });
  await eip1193.request({ method: 'evm_mine', params: [] });
  const block = await eip1193.request({ method: 'eth_getBlockByNumber', params: ['latest', false] });
  assert.equal(BigInt(block.timestamp), BigInt(timestamp));
}

check('compile exposes immutable references that account for deployed runtime substitutions', async () => {
  const artifact = compile();
  assert.ok(artifact.settings.outputSelection['*']['*'].includes('evm.deployedBytecode.immutableReferences'));
  const references = Object.values(artifact.immutableReferences).flat();
  assert.ok(references.length > 0);
  const c = await fixture();
  const runtime = await provider.getCode(await c.getAddress());
  assert.notEqual(runtime, artifact.deployedBytecode);
  const normalize = code => {
    const bytes = Buffer.from(code.slice(2), 'hex');
    for (const { start, length } of references) {
      assert.ok(Number.isSafeInteger(start) && start >= 0 && length > 0 && start + length <= bytes.length);
      bytes.fill(0, start, start + length);
    }
    return bytes.toString('hex');
  };
  assert.equal(normalize(runtime), normalize(artifact.deployedBytecode));
});

check('registration, escrow, access control and invitation deadline refund conserve issuance', async () => {
  const c = await fixture();
  const artifact = compile();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signers[0]);
  await rejects(factory.deploy(0, 60));
  await rejects(factory.deploy(30, 0));
  const missing = hashId('nonexistent');
  assert.equal((await c.getChannel(missing)).status, 0n);
  await rejects(c.joinChannel.staticCall(missing));
  await rejects(c.cancelUnjoined.staticCall(missing));
  await rejects(c.claimTimeout.staticCall(missing));
  await rejects(c.forceMove.staticCall(missing, 0));
  assert.equal((await c.getChannel(missing)).proofDeadline, 0n);
  assert.equal(await c.totalIssued(), 3000n);
  await rejects(c.register.staticCall());
  await rejects(c.openChannel.staticCall(ZeroAddress, 1, hashId('zero')));
  await rejects(c.openChannel.staticCall(wallets[0].address, 1, hashId('self')));
  await rejects(c.openChannel.staticCall(wallets[1].address, 0, hashId('stake0')));
  await rejects(c.openChannel.staticCall(wallets[1].address, 1001, hashId('stake1001')));
  await rejects(c.connect(signers[3]).openChannel.staticCall(wallets[1].address, 1, hashId('unregistered')));
  const id = await open(c, 100n, false);
  assert.equal(await c.points(wallets[0].address), 900n);
  assert.equal(await c.totalLocked(), 100n);
  await conservation(c);
  const salt = hashId(`test-channel-${saltCounter}`);
  await rejects(c.openChannel.staticCall(wallets[1].address, 1, salt));
  await rejects(c.connect(signers[2]).joinChannel.staticCall(id));
  await rejects(c.cancelUnjoined.staticCall(id));
  const deadline = (await c.getChannel(id)).deadline;
  await at(deadline - 1n);
  await c.connect(signers[1]).joinChannel.staticCall(id);
  await rejects(c.cancelUnjoined.staticCall(id));
  await at(deadline);
  await rejects(c.connect(signers[1]).joinChannel.staticCall(id));
  await rejects(c.connect(signers[1]).cancelUnjoined.staticCall(id));
  await receipt('cancel at exact deadline', c.cancelUnjoined(id));
  assert.equal((await c.getChannel(id)).status, 5n);
  assert.equal(await c.points(wallets[0].address), 1000n);
  await rejects(c.openChannel.staticCall(wallets[1].address, 100, salt));
  await rejects(c.cancelUnjoined.staticCall(id));
  await conservation(c);
});

check('join requires registered white and enough liquid points; locks across channels remain conserved', async () => {
  const c = await fixture();
  const full = await open(c, 1000n);
  assert.equal(await c.totalLocked(), 2000n);
  await rejects(c.openChannel.staticCall(wallets[1].address, 1, hashId('exhausted')));
  // Third party black still has funds, but the invited white has all points locked.
  const salt = hashId('white-exhausted');
  const id = channelId(wallets[2].address, wallets[1].address, salt);
  await receipt('second black opens', c.connect(signers[2]).openChannel(wallets[1].address, 10, salt));
  await rejects(c.connect(signers[1]).joinChannel.staticCall(id));
  const unknown = channelId(wallets[2].address, wallets[3].address, hashId('unknown-white'));
  await receipt('invite unregistered white', c.connect(signers[2]).openChannel(wallets[3].address, 10, hashId('unknown-white')));
  await rejects(c.connect(signers[3]).joinChannel.staticCall(unknown));
  await rejects(c.settle.staticCall(...await signed(c, id, blackWin)));
  await rejects(c.claimTimeout.staticCall(full));
  await conservation(c);
});

check('full replay validates black and white wins, all directions, edge wrap, illegal histories and legal draw', async () => {
  const c = await fixture();
  for (const moves of [[], blackWin, whiteWin, drawMoves(), [0, 1, 15, 2, 30, 3, 45, 4, 60], [0, 1, 16, 2, 32, 3, 48, 4, 64], [4, 0, 18, 1, 32, 2, 46, 3, 60], [0, 15, 1, 16, 2, 17, 4, 18, 5, 30, 3], [13, 100, 14, 101, 15, 102, 16, 103, 17]]) {
    const expected = evaluateJS(moves);
    const result = await c.evaluate(movesHex(moves));
    assert.equal(result.winner, BigInt(expected.winner));
    assert.equal(result.terminal, expected.terminal);
  }
  assert.equal(drawMoves().length, 225);
  assert.deepEqual(evaluateJS(drawMoves()), { winner: 0, terminal: true });
  for (const illegal of [[225], [255], [0, 0], [...blackWin, 50], [...whiteWin, 50], [...drawMoves(), 0]]) {
    await rejects(c.evaluate(movesHex(illegal)));
  }
  for (let length = 0; length <= blackWin.length; length++) {
    assert.equal((await c.evaluate(movesHex(blackWin.slice(0, length)))).terminal, length === blackWin.length);
  }
});

check('EIP712 domain, contract, channel, move order, signer identity and malformed signatures are isolated', async () => {
  const c = await fixture(), id = await open(c);
  const moves = movesHex(blackWin);
  const network = await provider.getNetwork();
  const domain = { name: 'GomokuChannel', version: '1', chainId: network.chainId, verifyingContract: await c.getAddress() };
  assert.equal(await c.stateDigest(id, moves), TypedDataEncoder.hash(domain, stateTypes, { channelId: id, movesHash: keccak256(moves) }));
  for (const override of [{ chainId: 1 }, { verifyingContract: wallets[2].address }, { name: 'Other' }, { version: '2' }]) {
    await rejects(c.settle.staticCall(...await signed(c, id, blackWin, override)));
  }
  const args = await signed(c, id, blackWin);
  const signature = Signature.from(args[2]);
  const curveOrder = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
  const highS = concat([signature.r, toBeHex(curveOrder - BigInt(signature.s), 32), toBeHex(signature.v === 27 ? 28 : 27, 1)]);
  await rejects(c.settle.staticCall(id, moves, highS, args[3]));
  await rejects(c.settle.staticCall(id, moves, args[3], args[2]));
  const forged = await signatures(c, id, moves, [wallets[2], wallets[1]]);
  await rejects(c.settle.staticCall(id, moves, ...forged));
  await rejects(c.settle.staticCall(id, moves, '0x', args[3]));
  await rejects(c.settle.staticCall(id, moves, '0x1234', args[3]));
  await rejects(c.settle.staticCall(id, movesHex([1, 15, 0, 16, 2, 17, 3, 18, 4]), args[2], args[3]));
  const otherId = await open(c);
  await rejects(c.settle.staticCall(otherId, moves, args[2], args[3]));
  const otherContract = await fixture();
  // The same participant/salt channel id can exist in a second contract; the domain prevents reuse.
  const salt = hashId(`test-channel-${saltCounter - 1}`);
  await receipt('same id on another contract open', otherContract.openChannel(wallets[1].address, 100, salt));
  await receipt('same id on another contract join', otherContract.connect(signers[1]).joinChannel(id));
  await rejects(otherContract.settle.staticCall(...args));
  await rejects(c.settle.staticCall(...await signed(c, id, blackWin.slice(0, 8))));
  await rejects(c.settle.staticCall(...await signed(c, id, [...blackWin, 50])));
  await rejects(c.challenge.staticCall(id, movesHex([0, 0]), ...await signatures(c, id, movesHex([0, 0]), wallets)));
  await receipt('valid black settlement', c.settle(...args));
  assert.equal(await c.points(wallets[0].address), 1000n); // 2 open stakes, 1 win
  assert.equal((await c.getChannel(id)).winner, 1n);
  await rejects(c.settle.staticCall(...args));
  await rejects(c.challenge.staticCall(id, '0x', '0x', '0x'));
  await rejects(c.joinChannel.staticCall(id));
  await conservation(c);
});

check('white victory and full-board draw settle actual locked points exactly once', async () => {
  const c = await fixture();
  for (const [moves, expectedWinner, expectedReason] of [[whiteWin, 2n, 1n], [drawMoves(), 0n, 2n]]) {
    const before = await Promise.all(wallets.slice(0, 2).map(w => c.points(w.address)));
    const id = await open(c, 75n);
    const args = await signed(c, id, moves);
    await receipt(expectedWinner === 0n ? 'draw settlement 225 moves' : 'white settlement', c.settle(...args, { gasLimit: 20000000 }));
    const state = await c.getChannel(id);
    assert.equal(state.status, 4n);
    assert.equal(state.winner, expectedWinner);
    assert.equal(state.reason, expectedReason);
    assert.equal(state.moves, movesHex(moves));
    assert.equal(await c.points(wallets[0].address), before[0] + (expectedWinner === 0n ? 0n : -75n));
    assert.equal(await c.points(wallets[1].address), before[1] + (expectedWinner === 0n ? 0n : 75n));
    await rejects(c.settle.staticCall(...args));
    await conservation(c);
  }
});

check('unsigned empty challenge protects proof collection; forced continuations renew only response deadlines', async () => {
  const c = await fixture(), id = await open(c);
  assert.equal((await c.getChannel(id)).proofDeadline, 0n);
  await rejects(c.connect(signers[2]).challenge.staticCall(id, '0x', '0x', '0x'));
  await rejects(c.challenge.staticCall(id, movesHex([0]), '0x', '0x'));
  await rejects(c.forceMove.staticCall(id, 0));
  const challenged = await receipt('empty unsigned challenge', c.challenge(id, '0x', '0x', '0x'));
  const initial = await c.getChannel(id);
  const block = await provider.getBlock(challenged.blockNumber);
  assert.equal(initial.status, 3n);
  assert.equal(initial.proofDeadline, BigInt(block.timestamp) + 30n);
  assert.equal(initial.deadline, initial.proofDeadline + 30n);
  await rejects(c.forceMove.staticCall(id, 0));
  await at(initial.proofDeadline - 1n);
  await rejects(c.forceMove.staticCall(id, 0));
  await rejects(c.claimTimeout.staticCall(id));
  await at(initial.proofDeadline);
  await rejects(c.challenge.staticCall(...await signed(c, id, [0])));
  await rejects(c.connect(signers[1]).forceMove.staticCall(id, 0));
  await rejects(c.connect(signers[2]).forceMove.staticCall(id, 0));
  await rejects(c.forceMove.staticCall(id, 225));
  await receipt('black forced first move at exact proof deadline', c.forceMove(id, 0));
  assert.equal((await c.getChannel(id)).proofDeadline, initial.proofDeadline);
  assert.equal((await c.getChannel(id)).deadline, initial.deadline);
  await rejects(c.forceMove.staticCall(id, 1));
  await rejects(c.connect(signers[1]).forceMove.staticCall(id, 0));
  await at(initial.deadline - 1n);
  await receipt('white forced response before response deadline', c.connect(signers[1]).forceMove(id, 15));
  const continued = await c.getChannel(id);
  assert.equal(continued.deadline, initial.deadline + 29n);
  assert.equal(continued.proofDeadline, initial.proofDeadline);
  assert.equal(continued.moves, movesHex([0, 15]));
  await at(initial.deadline);
  await rejects(c.claimTimeout.staticCall(id));
  await c.forceMove.staticCall(id, 1);
  await rejects(c.challenge.staticCall(...await signed(c, id, blackWin.slice(0, 8))));
  await receipt('compatible signed settlement during forced continuation', c.settle(...await signed(c, id, blackWin)));
  await conservation(c);
});

check('refused ninth signature recovers from an eight-move checkpoint only after the proof window', async () => {
  const c = await fixture(), id = await open(c);
  await receipt('eight-move signed refusal checkpoint', c.challenge(...await signed(c, id, blackWin.slice(0, 8))));
  const initial = await c.getChannel(id);
  await rejects(c.forceMove.staticCall(id, 4));
  await at(initial.proofDeadline - 1n);
  await rejects(c.forceMove.staticCall(id, 4));
  await rejects(c.claimTimeout.staticCall(id));
  await at(initial.proofDeadline);
  await rejects(c.challenge.staticCall(...await signed(c, id, blackWin)));
  await rejects(c.connect(signers[1]).forceMove.staticCall(id, 4));
  await receipt('black wins despite refused last signature at exact proof deadline', c.forceMove(id, 4));
  const state = await c.getChannel(id);
  assert.equal(state.status, 4n);
  assert.equal(state.proofDeadline, initial.proofDeadline);
  assert.equal(state.winner, 1n);
  assert.equal(state.reason, 1n);
  assert.equal(state.moves, movesHex(blackWin));
  assert.equal(await c.points(wallets[0].address), 1100n);
  await rejects(c.forceMove.staticCall(id, 5));
  await rejects(c.claimTimeout.staticCall(id));
  await conservation(c);
});

check('stale one-move challenge cannot force an immediate fork that excludes an already dual-signed nine-move win', async () => {
  const c = await fixture(), id = await open(c);
  // Both signatures exist before the loser challenges an older, genuine checkpoint.
  const latestWin = await signed(c, id, blackWin);
  const oldCheckpoint = await signed(c, id, [0]);
  await receipt('loser challenges stale one-move checkpoint', c.connect(signers[1]).challenge(...oldCheckpoint));
  const before = await c.getChannel(id);
  await rejects(c.connect(signers[1]).forceMove.staticCall(id, 100));
  const attack = await receipt('loser immediate fork rejected on chain', c.connect(signers[1]).forceMove(id, 100, { gasLimit: 500000 }), 'reverted');
  assert.equal(attack.status, 0);
  assert.deepEqual(Array.from(await c.getChannel(id)), Array.from(before));
  assert.equal(before.moves, movesHex([0]));
  await receipt('latest already-signed nine-move win remains settleable', c.settle(...latestWin));
  const settled = await c.getChannel(id);
  assert.equal(settled.status, 4n);
  assert.equal(settled.moves, movesHex(blackWin));
  assert.equal(settled.winner, 1n);
  assert.equal(settled.reason, 1n);
  assert.equal(await c.points(wallets[0].address), 1100n);
  assert.equal(await c.points(wallets[1].address), 900n);
  await conservation(c);
});

check('dispute escalation rejects equal, stale and divergent checkpoints and stale terminal settlements', async () => {
  const c = await fixture(), id = await open(c);
  const prefix = [0, 15, 1, 16];
  await receipt('initial signed dispute', c.challenge(...await signed(c, id, prefix)));
  for (const moves of [[], [0, 15], prefix, [0, 15, 2, 16, 3]]) {
    await rejects(c.challenge.staticCall(...await signed(c, id, moves)));
  }
  const oldState = await c.getChannel(id);
  await at(oldState.proofDeadline - 1n);
  await receipt('escalate before proof deadline', c.connect(signers[1]).challenge(...await signed(c, id, blackWin.slice(0, 8))));
  const updated = await c.getChannel(id);
  assert.equal(updated.proofDeadline, oldState.proofDeadline + 29n);
  assert.equal(updated.deadline, oldState.deadline + 29n);
  assert.equal(updated.deadline, updated.proofDeadline + 30n);
  await at(oldState.proofDeadline);
  await rejects(c.forceMove.staticCall(id, 4));
  await rejects(c.claimTimeout.staticCall(id));
  // Valid terminal history from a different branch cannot displace the committed prefix.
  await rejects(c.settle.staticCall(...await signed(c, id, [30, 15, 31, 16, 32, 17, 33, 18, 34])));
  await rejects(c.settle.staticCall(...await signed(c, id, prefix)));
  await rejects(c.challenge.staticCall(id, '0x', '0x', '0x'));
  await at(updated.proofDeadline);
  await rejects(c.challenge.staticCall(...await signed(c, id, whiteWin)));
  await receipt('compatible white terminal settlement at proof deadline', c.settle(...await signed(c, id, whiteWin)));
  assert.equal((await c.getChannel(id)).winner, 2n);
  const longer = await open(c);
  await receipt('longer nonterminal checkpoint', c.challenge(...await signed(c, longer, drawMoves().slice(0, 10))));
  await rejects(c.settle.staticCall(...await signed(c, longer, blackWin)));
  await rejects(c.challenge.staticCall(...await signed(c, longer, blackWin)));
  await conservation(c);
});

check('deadline equality rejects moves and challenges and awards timeout to the waiting player', async () => {
  const c = await fixture();
  for (const initial of [[], [0]]) {
    const id = await open(c, 50n);
    await receipt('start deadline dispute', c.challenge(...await signed(c, id, initial)));
    const { proofDeadline, deadline } = await c.getChannel(id);
    const current = initial.length % 2;
    await at(proofDeadline - 1n);
    await rejects(c.connect(signers[current]).forceMove.staticCall(id, initial.length ? 15 : 0));
    await at(proofDeadline);
    await rejects(c.claimTimeout.staticCall(id));
    await rejects(c.challenge.staticCall(...await signed(c, id, initial.length ? [0, 15] : [0])));
    await c.connect(signers[current]).forceMove.staticCall(id, initial.length ? 15 : 0);
    await at(deadline - 1n);
    await rejects(c.claimTimeout.staticCall(id));
    await c.connect(signers[current]).forceMove.staticCall(id, initial.length ? 15 : 0);
    await at(deadline);
    await rejects(c.connect(signers[current]).forceMove.staticCall(id, initial.length ? 15 : 0));
    await rejects(c.challenge.staticCall(...await signed(c, id, initial.length ? [0, 15] : [0])));
    await rejects(c.connect(signers[2]).claimTimeout.staticCall(id));
    await receipt('timeout at exact deadline', c.connect(signers[1 - current]).claimTimeout(id));
    const state = await c.getChannel(id);
    assert.equal(state.winner, initial.length === 0 ? 2n : 1n);
    assert.equal(state.reason, 3n);
    await rejects(c.claimTimeout.staticCall(id));
    await conservation(c);
  }
});

check('terminal signed challenge immediately settles; compatible signed terminal can settle after dispute expiry', async () => {
  const c = await fixture();
  const immediate = await open(c);
  await receipt('terminal white challenge', c.connect(signers[1]).challenge(...await signed(c, immediate, whiteWin)));
  assert.equal((await c.getChannel(immediate)).winner, 2n);
  const id = await open(c);
  await receipt('signed checkpoint', c.challenge(...await signed(c, id, blackWin.slice(0, 8))));
  await at((await c.getChannel(id)).deadline);
  // Settlement has no deadline gate: both players have already authorized this compatible terminal state.
  await receipt('compatible terminal settlement after expiry', c.connect(signers[2]).settle(...await signed(c, id, blackWin)));
  assert.equal((await c.getChannel(id)).winner, 1n);
  await rejects(c.claimTimeout.staticCall(id));
  await conservation(c);
});

check('failed on-chain transaction is recorded and preserves balances and game state', async () => {
  const c = await fixture(), id = await open(c);
  const before = await c.getChannel(id);
  const failed = await receipt('invalid timeout transaction', c.claimTimeout(id, { gasLimit: 200000 }), 'reverted');
  assert.equal(failed.status, 0);
  const after = await c.getChannel(id);
  assert.deepEqual(Array.from(after), Array.from(before));
  assert.equal(await c.totalLocked(), 200n);
  await conservation(c);
});

check('normal channel versus every-move on-chain baseline uses equal escrow and actual receipt gas', async () => {
  const c = await fixture(), baseline = await fixture('GomokuOnchainBaseline');
  for (const [label, moves] of [['black-win-9', blackWin], ['white-win-10', whiteWin]]) {
    const startChannel = evidence.transactions.length;
    const id = await open(c, 10n);
    await receipt(`channel ${label} settle`, c.settle(...await signed(c, id, moves), { gasLimit: 20000000 }));
    const channelTx = evidence.transactions.slice(startChannel);
    const startBaseline = evidence.transactions.length;
    const baseId = await open(baseline, 10n);
    for (let i = 0; i < moves.length; i++) {
      await receipt(`baseline ${label} move ${i + 1}`, baseline.connect(signers[i % 2]).playMove(baseId, moves[i], { gasLimit: 20000000 }));
      assert.equal((await baseline.getChannel(baseId)).proofDeadline, 0n);
      if (i === 0 && label === 'black-win-9') {
        await rejects(baseline.challenge.staticCall(baseId, '0x', '0x', '0x'));
        await rejects(baseline.settle.staticCall(...await signed(baseline, baseId, [30, 15, 31, 16, 32, 17, 33, 18, 34])));
        await rejects(baseline.playMove.staticCall(baseId, 1));
      }
    }
    const baselineTx = evidence.transactions.slice(startBaseline);
    const sum = transactions => transactions.reduce((total, tx) => total + BigInt(tx.gasUsed), 0n);
    assert.equal(channelTx.length, 3);
    assert.equal(baselineTx.length, moves.length + 2);
    assert.equal((await c.getChannel(id)).winner, (await baseline.getChannel(baseId)).winner);
    assert.equal((await c.getChannel(id)).moves, (await baseline.getChannel(baseId)).moves);
    await conservation(c); await conservation(baseline);
    const channelGas = sum(channelTx), baselineGas = sum(baselineTx);
    evidence.comparisons.push({ label, moveCount: moves.length, channel: { transactions: channelTx.length, gasUsed: channelGas.toString(), hashes: channelTx.map(tx => tx.hash) }, baseline: { transactions: baselineTx.length, gasUsed: baselineGas.toString(), hashes: baselineTx.map(tx => tx.hash) }, transactionReductionPercent: (1 - channelTx.length / baselineTx.length) * 100, gasReductionPercent: (1 - Number(channelGas) / Number(baselineGas)) * 100, excludes: 'Deployments and registration are recorded separately; both games use open+join and automatic final-move settlement.' });
  }
});
