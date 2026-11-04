// Regression tests use real EIP-712 signatures and controlled chain/RPC fixtures.
// The existing browser E2E covers live RPC and transactions; these tests exercise hostile local storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Wallet, Interface, TypedDataEncoder, AbiCoder, id, keccak256 } from 'ethers';
import { ChannelClient } from '../web/src/channel-client.js';
import { verifyEvidenceOnchain } from '../shared/evidence-chain.mjs';
import { movesHex, STATE_TYPES, BLACK_WIN } from '../shared/gomoku.mjs';

const STORE = 'gomoku-channel-v1';
const config = { address: '0x0000000000000000000000000000000000000001', chainId: 31337 };
const domain = { name: 'GomokuChannel', version: '1', chainId: config.chainId, verifyingContract: config.address };
const human = Wallet.createRandom(), ai = Wallet.createRandom(), stranger = Wallet.createRandom();
const channelId = id('ai-resume-regression');
const sessionKey = `${STORE}:ai-session:${config.address}`;
const evidenceKey = `${STORE}:evidence:${channelId}`;
const results = [];
function check(name, fn) {
  test(name, async () => {
    try { await fn(); results.push({ name, status: 'passed' }); }
    catch (e) { results.push({ name, status: 'failed', error: e.message }); throw e; }
  });
}
process.on('exit', () => {
  const outputDir = process.env.TEST_RESULTS_DIR || 'artifacts/test-results';
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = process.env.TEST_RESULTS_FILE || 'channel-client-ai-results.json';
  fs.writeFileSync(path.join(outputDir, outputFile), JSON.stringify({ generatedAt: new Date().toISOString(), tests: results, summary: { passed: results.filter(t => t.status === 'passed').length, failed: results.filter(t => t.status === 'failed').length } }, null, 2));
});

const channelInterface = new Interface([
  'event ChannelOpened(bytes32 indexed id,address indexed black,address indexed white,uint256 stake)',
  'event ChannelJoined(bytes32 indexed id)',
  'event CheckpointChallenged(bytes32 indexed id,uint256 movesCount,uint256 deadline)',
  'event ForcedMove(bytes32 indexed id,uint8 position)',
  'event ChannelSettled(bytes32 indexed id,uint8 winner,uint8 reason,uint256 blackPoints,uint256 whitePoints)',
  'event ChannelCancelled(bytes32 indexed id)',
]);
async function fixture({ moves = [112, 113], humanRole = 1 } = {}) {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
  const black = humanRole === 1 ? human : ai, white = humanRole === 1 ? ai : human;
  async function signed(nextMoves, target = channelId) {
    const value = { channelId: target, movesHash: keccak256(movesHex(nextMoves)) };
    return { format: 'gomoku-channel-evidence/v1', domain, channelId: target, participants: { black: black.address, white: white.address }, stake: 10,
      checkpoint: { moves: nextMoves, sigBlack: await black.signTypedData(domain, STATE_TYPES, value), sigWhite: await white.signTypedData(domain, STATE_TYPES, value) }, transactions: [] };
  }
  const evidence = await signed(moves);
  const session = { key: ai.privateKey, channelId, level: 'adept', humanRole };
  const chain = { status: 2n, black: black.address, white: white.address, stake: 10n, moves: '0x', winner: 0n, reason: 0n, deadline: 0n, proofDeadline: 0n };
  const channels = new Map([[channelId, chain]]), receipts = new Map(), logs = [], queries = [];
  const rpc = { headNumber: 10 };
  const block = number => ({ number, hash: id('fixture-block-' + number), timestamp: 1700000000 + number });
  function addReceipt(name, target, hash, blockNumber, gasUsed, args) {
    const encoded = channelInterface.encodeEventLog(channelInterface.getEvent(name), args);
    const log = { address: config.address, ...encoded, blockNumber, blockHash: block(blockNumber).hash, transactionHash: hash, transactionIndex: 0, index: 0, removed: false };
    const receipt = { hash, status: 1, to: config.address, gasUsed, blockNumber, blockHash: log.blockHash, index: 0, logs: [log] };
    logs.push(log); receipts.set(hash.toLowerCase(), receipt); return receipt;
  }
  function addChannel(target, state = { ...chain }) {
    channels.set(target, state);
    const openHash = target === channelId ? id('tx') : id('open-' + target);
    const open = addReceipt('ChannelOpened', target, openHash, 5, 123n, [target, state.black, state.white, state.stake]);
    const join = addReceipt('ChannelJoined', target, id('join-' + target), 6, 456n, [target]);
    return { state, open, join };
  }
  const initial = addChannel(channelId, chain);
  const client = new ChannelClient();
  client.config = { ...config, deploymentBlock: 1, runtimeCodeHash: keccak256('0x6000') }; client.domain = domain; client.wallet = human;
  client.contract = {
    getAddress: async () => config.address,
    points: async () => 1000n,
    getChannel: async target => { const found = channels.get(target); if (!found) throw Error('unknown fixture channel'); return found; },
    stateDigest: async (target, hex) => TypedDataEncoder.hash(domain, STATE_TYPES, { channelId: target, movesHash: keccak256(hex) }),
    interface: channelInterface,
  };
  client.provider = {
    getNetwork: async () => ({ chainId: 31337n }),
    getCode: async () => '0x6000',
    getBlock: async tag => block(tag === 'latest' ? rpc.headNumber : tag),
    getTransactionReceipt: async hash => receipts.get(hash.toLowerCase()) || null,
    getLogs: async filter => {
      queries.push(filter);
      return logs.filter(log => {
        const state = channels.get(log.topics[1]);
        const hideJoin = Number(state?.status) === 1 && log.topics[0] === channelInterface.getEvent('ChannelJoined').topicHash;
        return !hideJoin && log.address === filter.address && log.blockNumber >= filter.fromBlock && log.blockNumber <= filter.toBlock && filter.topics[0].includes(log.topics[0]) && log.topics[1].toLowerCase() === filter.topics[1].toLowerCase();
      });
    },
  };
  client.refresh = async () => {};
  let replies = 0;
  client._aiReply = async () => { assert.equal(client.state.busy, true, 'resume must hold the operation lock while AI is responding'); replies++; };
  function save() {
    localStorage.setItem(sessionKey, JSON.stringify(session));
    localStorage.setItem(evidenceKey, JSON.stringify(evidence));
    localStorage.setItem(`${STORE}:active-channel:${config.address}`, channelId);
  }
  save();
  return { client, session, chain, evidence, storage, save, signed, channels, receipts, logs, queries, rpc, block, addReceipt, addChannel, open: initial.open, join: initial.join, replies: () => replies };
}

check('有效双签和双方钱包对应链上参与者时恢复人机局', async () => {
  const f = await fixture();
  assert.equal(await f.client._resumeAi(), true);
  assert.equal(f.client.state.mode, 'ai');
  assert.equal(f.client.state.role, 1);
  assert.deepEqual(f.client.state.moves, [112, 113]);
  assert.equal(f.client.state.busy, false);
  assert.equal(f.replies(), 0);
});

check('执白恢复后以 busy 锁保护 AI 待回复期间，防止并发落子', async () => {
  const f = await fixture({ humanRole: 2, moves: [112, 113] });
  assert.equal(await f.client._resumeAi(), true);
  assert.equal(f.client.state.role, 2);
  assert.equal(f.replies(), 1);
});

check('旧 active-room 不能抢占更新的人机会话', async () => {
  const f = await fixture();
  localStorage.setItem(`${STORE}:active-room:${config.address}`, 'stale-room');
  f.client.joinRoom = async () => { throw Error('must not join the stale room'); };
  await f.client._restoreSavedGame();
  assert.equal(f.client.state.mode, 'ai');
  assert.equal(f.client.state.channelId, channelId);
});

check('没有有效人机会话时保留原先的房间恢复路径', async () => {
  const f = await fixture();
  localStorage.removeItem(sessionKey);
  localStorage.setItem(`${STORE}:active-room:${config.address}`, 'current-room');
  let joined;
  f.client.joinRoom = async room => { joined = room; };
  await f.client._restoreSavedGame();
  assert.equal(joined, 'current-room');
});

for (const [name, mutate] of [
  ['AI 私钥与链上对手不符', f => { f.session.key = stranger.privateKey; }],
  ['当前人类钱包不是链上对应执子方', f => { f.client.wallet = stranger; }],
  ['执子方被交换', f => { f.session.humanRole = 2; }],
  ['非法执子方', f => { f.session.humanRole = 0; }],
  ['原型属性不能当成难度', f => { f.session.level = 'constructor'; }],
  ['证据通道与会话通道不同', f => { f.evidence.channelId = id('different-channel'); f.evidence.checkpoint = { moves: [], sigBlack: '', sigWhite: '' }; }],
  ['证据参与者与链上不同', f => { f.chain.black = stranger.address; }],
  ['证据积分与链上不同', f => { f.evidence.stake = 20; }],
  ['证据来自另一条链', f => { f.evidence.domain = { ...domain, chainId: 1 }; f.evidence.checkpoint = { moves: [], sigBlack: '', sigWhite: '' }; }],
  ['证据来自另一合约', f => { f.evidence.domain = { ...domain, verifyingContract: stranger.address }; f.evidence.checkpoint = { moves: [], sigBlack: '', sigWhite: '' }; }],
]) {
  check(`拒绝恢复：${name}，不覆盖证据或签署下一手`, async () => {
    const f = await fixture(); mutate(f); f.save();
    const before = localStorage.getItem(evidenceKey);
    assert.equal(await f.client._resumeAi(), false);
    assert.equal(f.client.state.mode, 'player');
    assert.equal(f.client.state.channelId, '');
    assert.equal(localStorage.getItem(evidenceKey), before);
    assert.ok(localStorage.getItem(sessionKey), '拒绝不可信数据不能删除唯一的本地 AI 钱包');
    assert.equal(f.replies(), 0);
  });
}

check('旧人机会话不能替换 active-channel 指向的新局', async () => {
  const f = await fixture();
  localStorage.setItem(`${STORE}:active-channel:${config.address}`, id('new-game'));
  assert.equal(await f.client._resumeAi(), false);
  assert.equal(f.client.state.mode, 'player');
});

check('恢复拒绝伪造回执，成功回执以 RPC gas 和区块数据替换文件自述', async () => {
  const f = await fixture();
  f.evidence.transactions = [{ hash: f.open.hash, gasUsed: '1', blockNumber: -1 }]; f.save();
  const getReceipt = f.client.provider.getTransactionReceipt;
  f.client.provider.getTransactionReceipt = async () => null;
  assert.equal(await f.client._resumeAi(), false);
  assert.equal(f.client.state.mode, 'player');
  f.save();
  f.client.provider.getTransactionReceipt = getReceipt;
  assert.equal(await f.client._resumeAi(), true);
  assert.equal(f.client.state.transactions[0].gasUsed, '123');
  assert.equal(f.client.state.transactions[0].blockNumber, 5);
  assert.equal(f.client.state.transactions[0].timestamp, f.block(5).timestamp);
  assert.equal(f.client.state.transactions.length, 2, 'the omitted join receipt must be reconstructed');
});

check('其他对局的回执不能被恢复成当前局的交易', async () => {
  const f = await fixture();
  f.evidence.transactions = [{ hash: id('other-tx') }]; f.save();
  f.addReceipt('ChannelJoined', id('other-game'), id('other-tx'), 5, 123n, [id('other-game')]);
  assert.equal(await f.client._resumeAi(), false);
});

check('恢复等待 RPC 时也持有操作锁，不能并发开始新局', async () => {
  const f = await fixture();
  let release, waiting = true;
  const getChannel = f.client.contract.getChannel;
  f.client.contract.getChannel = (...args) => {
    if (!waiting) return getChannel(...args);
    waiting = false;
    return new Promise(resolve => { release = () => resolve(f.chain); });
  };
  const resuming = f.client._resumeAi();
  assert.equal(f.client.state.busy, true);
  await assert.rejects(f.client.startAiGame('adept', 1, 10), /上一项操作/);
  release();
  assert.equal(await resuming, true);
  assert.equal(f.client.state.busy, false);
});

check('临时 RPC 失败不删除 AI 密钥，网络恢复后可重试恢复', async () => {
  const f = await fixture();
  const getChannel = f.client.contract.getChannel;
  f.client.contract.getChannel = async () => { throw Error('RPC unavailable'); };
  const saved = localStorage.getItem(sessionKey);
  assert.equal(await f.client._resumeAi(), false);
  assert.equal(localStorage.getItem(sessionKey), saved);
  f.client.contract.getChannel = getChannel;
  assert.equal(await f.client._resumeAi(), true);
});

check('争议期间保留本地 AI 钱包但不自动签字；终结通道可清理会话', async () => {
  const f = await fixture();
  f.chain.status = 3n;
  assert.equal(await f.client._resumeAi(), false);
  assert.ok(localStorage.getItem(sessionKey));
  assert.equal(f.replies(), 0);
  f.chain.status = 4n;
  assert.equal(await f.client._resumeAi(), false);
  assert.equal(localStorage.getItem(sessionKey), null);
});

check('startAiGame 拒绝非法执子方、不安全整数与伪难度，且不触碰链上', async () => {
  const f = await fixture();
  for (const args of [['constructor', 1, 10], ['adept', 3, 10], ['adept', 1, Number.MAX_SAFE_INTEGER + 1]]) {
    await assert.rejects(f.client.startAiGame(...args));
  }
  assert.equal(f.client.state.channelId, '');
});

check('开通第一笔交易前持久化密钥与证据；join 失败保留恢复资料及已确认回执', async () => {
  const f = await fixture();
  f.client._prepareWallet = async () => {};
  let opened = false, openedId;
  f.client.contract.connect = () => ({
    openChannel: async () => {
      const session = JSON.parse(localStorage.getItem(sessionKey));
      openedId = session.channelId;
      assert.equal(session.key, f.client._ai.wallet.privateKey);
      assert.equal(JSON.parse(localStorage.getItem(`${STORE}:evidence:${openedId}`)).channelId, openedId);
      assert.equal(localStorage.getItem(`${STORE}:active-channel:${config.address}`), openedId);
      opened = true;
    },
    joinChannel: async () => { assert.ok(opened); throw Error('join failed'); },
  });
  f.client._transaction = async (promise, label) => {
    await promise;
    f.client.state.transactions.push({ hash: id('confirmed-open'), label });
  };
  await assert.rejects(f.client.startAiGame('adept', 1, 10), /join failed/);
  assert.ok(localStorage.getItem(sessionKey));
  const saved = JSON.parse(localStorage.getItem(`${STORE}:evidence:${openedId}`));
  assert.equal(saved.transactions.length, 1);
  assert.equal(saved.transactions[0].hash, id('confirmed-open'));
  assert.ok(f.client.state.events.some(e => e.text.includes('不会自动重试交易') && e.text.includes(openedId)));
});

check('待加入通道恢复人类身份与到期退款入口状态，不自动加入或签字', async () => {
  const f = await fixture({ moves: [] });
  f.chain.status = 1n; f.chain.deadline = 1234n;
  assert.equal(await f.client._resumeAi(), true);
  assert.equal(f.client.state.status, 'invited');
  assert.equal(f.client.state.role, 1);
  assert.equal(f.client.state.channelId, channelId);
  assert.equal(f.client.state.deadline, 1234);
  assert.equal(f.replies(), 0);
  assert.ok(localStorage.getItem(sessionKey));
  assert.ok(f.client.state.events.some(e => e.text.includes('到期取消未加入邀请')));
  let cancelled;
  f.client.contract.cancelUnjoined = async id => { cancelled = id; };
  f.client._transaction = async promise => { await promise; };
  await f.client.cancelUnjoined();
  assert.equal(cancelled, channelId);
});

check('待加入时人类执白也保留开通方 AI 密钥，不自动签字', async () => {
  const f = await fixture({ moves: [], humanRole: 2 });
  f.chain.status = 1n;
  assert.equal(await f.client._resumeAi(), true);
  assert.equal(f.client.state.role, 2);
  assert.equal(f.client.state.status, 'invited');
  assert.equal(f.replies(), 0);
  assert.ok(localStorage.getItem(sessionKey));
});

check('人类执白的待加入通道到期后由经过链上身份核验的 AI 黑方退款', async () => {
  const f = await fixture({ moves: [], humanRole: 2 });
  f.chain.status = 1n; f.chain.deadline = 1000n;
  await f.client._resumeAi();
  f.client.provider.getBlock = async block => { assert.equal(block, 'latest'); return { timestamp: 1000 }; };
  let signer, cancelled;
  f.client.contract.connect = wallet => {
    signer = wallet.address;
    return { cancelUnjoined: async id => { cancelled = id; } };
  };
  f.client._transaction = async promise => { await promise; };
  await f.client.cancelUnjoined();
  assert.equal(signer, ai.address);
  assert.equal(cancelled, channelId);
});

check('AI 开通退款不得在期限前、错误密钥或通道已加入后发送交易', async () => {
  for (const scenario of ['premature', 'wrong-ai', 'wrong-human', 'active']) {
    const f = await fixture({ moves: [], humanRole: 2 });
    f.chain.status = 1n; f.chain.deadline = 1000n;
    await f.client._resumeAi();
    f.client.provider.getBlock = async () => ({ timestamp: scenario === 'premature' ? 999 : 1000 });
    if (scenario === 'wrong-ai') f.client._ai.wallet = stranger;
    if (scenario === 'wrong-human') f.client.wallet = stranger;
    if (scenario === 'active') f.chain.status = 2n;
    f.client.contract.connect = () => { throw Error('must not select any signer'); };
    await assert.rejects(f.client.cancelUnjoined(), /邀请尚未到期|钱包与链上参与者不匹配|不是待加入/);
  }
});

check('开始人机局时移除旧 active-room，下一次刷新不会回到旧房间', async () => {
  const f = await fixture();
  localStorage.setItem(`${STORE}:active-room:${config.address}`, 'stale-room');
  f.client._prepareWallet = async () => {};
  f.client._transaction = async () => {};
  f.client.contract.connect = () => ({ openChannel: async () => {}, joinChannel: async () => {} });
  await f.client.startAiGame('adept', 1, 10);
  assert.equal(localStorage.getItem(`${STORE}:active-room:${config.address}`), null);
  assert.equal(f.client.state.mode, 'ai');
});

check('导入同通道旧双签或无签空谱不能覆盖较新内存和持久化快照', async () => {
  const f = await fixture(), latest = await f.signed([112, 113, 114, 115]);
  await f.client.importEvidence(latest);
  const saved = localStorage.getItem(evidenceKey), checkpoint = structuredClone(f.client._checkpoint);
  const empty = { ...f.evidence, checkpoint: { moves: [], sigBlack: '', sigWhite: '' } };
  for (const older of [f.evidence, empty]) {
    await assert.rejects(f.client.importEvidence(older), /回退或分叉/);
    assert.equal(localStorage.getItem(evidenceKey), saved);
    assert.deepEqual(f.client._checkpoint, checkpoint);
    assert.deepEqual(f.client.state.moves, latest.checkpoint.moves);
    assert.equal(f.client.state.channelId, channelId);
  }
});
check('尚未恢复的本地已保存双签也能阻止同通道回退及分叉导入', async () => {
  const f = await fixture(), saved = localStorage.getItem(evidenceKey);
  for (const candidate of [await f.signed([112]), await f.signed([112, 114])]) {
    await assert.rejects(f.client.importEvidence(candidate), /回退或分叉/);
    assert.equal(localStorage.getItem(evidenceKey), saved);
    assert.equal(f.client.state.channelId, '');
    assert.deepEqual(f.client._checkpoint.moves, []);
  }
});
check('即使持久化证据缺失，当前内存快照仍阻止分叉证据替换', async () => {
  const f = await fixture(); await f.client.importEvidence(f.evidence);
  const checkpoint = structuredClone(f.client._checkpoint);
  localStorage.removeItem(evidenceKey);
  await assert.rejects(f.client.importEvidence(await f.signed([112, 114, 115])), /回退或分叉/);
  assert.deepEqual(f.client._checkpoint, checkpoint);
  assert.equal(localStorage.getItem(evidenceKey), null);
});
check('其他对局的有效证据不能覆盖invited/active/dispute当前活动局', async () => {
  for (const status of ['invited', 'active', 'dispute']) {
    const f = await fixture(); await f.client.importEvidence(f.evidence);
    f.client._emit({ status });
    const otherId = id('other-active-channel'); f.addChannel(otherId);
    const saved = localStorage.getItem(evidenceKey), checkpoint = structuredClone(f.client._checkpoint);
    const activeId = localStorage.getItem(`${STORE}:active-channel:${config.address}`);
    await assert.rejects(f.client.importEvidence(await f.signed([112, 113], otherId)), /其他局证据替换活动状态/);
    assert.equal(f.client.state.channelId, channelId); assert.equal(f.client.state.status, status);
    assert.deepEqual(f.client._checkpoint, checkpoint); assert.equal(localStorage.getItem(evidenceKey), saved);
    assert.equal(localStorage.getItem(`${STORE}:active-channel:${config.address}`), activeId);
    assert.equal(localStorage.getItem(`${STORE}:evidence:${otherId}`), null);
  }
});
check('同通道兼容的更新快照可导入，空交易清单从RPC补齐两笔真实交易', async () => {
  const f = await fixture(); await f.client.importEvidence(f.evidence);
  const extension = await f.signed([112, 113, 114, 115]);
  const result = await f.client.importEvidence(extension);
  assert.equal(result.valid, true); assert.equal(result.signed, true); assert.equal(result.cryptographicOnly, false);
  assert.deepEqual(f.client.state.moves, extension.checkpoint.moves); assert.equal(f.client.state.transactions.length, 2);
  assert.deepEqual(JSON.parse(localStorage.getItem(evidenceKey)).checkpoint, extension.checkpoint);
});
check('首次导入无签空谱明确报告未双签并仍重建真实交易', async () => {
  const f = await fixture({ moves: [] }); f.evidence.checkpoint.sigBlack = ''; f.evidence.checkpoint.sigWhite = ''; f.save();
  const result = await f.client.importEvidence(f.evidence);
  assert.equal(result.signed, false); assert.equal(f.client.state.transactions.length, 2);
  assert.ok(f.client.state.events.some(event => event.text.includes('空棋谱无双签')));
});
check('链上核验期间等待日志RPC仍持有busy锁，完成前不签署AI回复', async () => {
  const f = await fixture({ humanRole: 2 });
  let release, entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const getLogs = f.client.provider.getLogs;
  f.client.provider.getLogs = filter => { entered(); return new Promise(resolve => { release = async () => resolve(await getLogs(filter)); }); };
  const resuming = f.client._resumeAi(); await waiting;
  assert.equal(f.client.state.busy, true); assert.equal(f.replies(), 0);
  await assert.rejects(f.client.startAiGame('adept', 1, 10), /上一项操作/);
  await release(); assert.equal(await resuming, true);
  assert.equal(f.client.state.busy, false); assert.equal(f.replies(), 1);
});
check('恢复拒绝错误合约摘要且保留原始凭据，不签署下一手', async () => {
  const f = await fixture({ humanRole: 2 }), saved = localStorage.getItem(evidenceKey), credentials = localStorage.getItem(sessionKey);
  f.client.contract.stateDigest = async () => id('wrong-state-digest');
  assert.equal(await f.client._resumeAi(), false); assert.equal(f.replies(), 0);
  assert.equal(localStorage.getItem(evidenceKey), saved); assert.equal(localStorage.getItem(sessionKey), credentials);
});
check('事件扫描按可信部署区块起始并每页最多2000块，返回真实proofDeadline', async () => {
  const f = await fixture(); f.rpc.headNumber = 6505; f.chain.proofDeadline = 1700009999n;
  const result = await verifyEvidenceOnchain(f.evidence, { provider: f.client.provider, contract: f.client.contract, expected: { deploymentBlock: 1 } });
  assert.deepEqual(f.queries.map(query => [query.fromBlock, query.toBlock]), [[1, 2000], [2001, 4000], [4001, 6000], [6001, 6505]]);
  assert.equal(result.chain.blockNumber, 6505); assert.equal(result.chain.deploymentBlock, 1);
  assert.equal(result.chain.proofDeadline, 1700009999); assert.equal(result.transactions.length, 2);
});
check('非法部署区块或截掉开通事件的扫描起点不能被报告为完整交易核验', async () => {
  const f = await fixture();
  for (const deploymentBlock of [-1, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1, 11, NaN, Infinity]) {
    await assert.rejects(verifyEvidenceOnchain(f.evidence, { provider: f.client.provider, contract: f.client.contract, expected: { deploymentBlock } }), /部署区块/);
  }
  assert.equal(f.queries.length, 0);
  await assert.rejects(verifyEvidenceOnchain(f.evidence, { provider: f.client.provider, contract: f.client.contract, expected: { deploymentBlock: 6 } }), /缺少通道开通或加入事件/);
});

async function relayRecoveryFixture() {
  const f = await fixture({ moves: [] });
  const salt = id('relay-recovery-real-salt');
  const target = keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [human.address, ai.address, salt]));
  const latest = await f.signed(BLACK_WIN, target);
  const key = `${STORE}:evidence:${target}`;
  localStorage.setItem(key, JSON.stringify(latest));
  localStorage.setItem(`${STORE}:active-channel:${config.address}`, target);
  // joinRoom clears memory before the relay supplies its checkpoint.
  f.client._resetGame(); f.client._lifecycle = async () => {};
  globalThis.location = { href: 'http://127.0.0.1:4173/?room=old-room' };
  const room = (checkpoint = latest.checkpoint, overrides = {}) => ({ roomId: salt, channelId: target, salt, black: human.address, white: ai.address, stake: 10, checkpoint: structuredClone(checkpoint), transactions: [], proposal: null, ...overrides });
  return { ...f, latest, target, key, room };
}
for (const [name, candidate] of [
  ['旧一手', async f => (await f.signed([BLACK_WIN[0]], f.target)).checkpoint],
  ['真实双签分叉谱', async f => (await f.signed([0, 15], f.target)).checkpoint],
  ['无签空谱', async () => ({ moves: [], sigBlack: '', sigWhite: '' })],
]) {
  check(`重连中继的${name}不能覆盖持久化九手双签，即使内存刚被清空`, async () => {
    const f = await relayRecoveryFixture(), saved = localStorage.getItem(f.key);
    await assert.rejects(f.client._onRoom({ room: f.room(await candidate(f)), peers: [human.address, ai.address] }), /回退或分叉/);
    assert.equal(localStorage.getItem(f.key), saved);
    assert.deepEqual(f.client._checkpoint.moves, []); assert.equal(f.client._room, null);
    assert.equal(f.client.state.channelId, '');
    assert.equal(localStorage.getItem(`${STORE}:active-channel:${config.address}`), f.target);
  });
}
check('重连中继提供相同九手最新双签时正常恢复', async () => {
  const f = await relayRecoveryFixture();
  await f.client._onRoom({ room: f.room(), peers: [human.address, ai.address] });
  assert.deepEqual(f.client._checkpoint, f.latest.checkpoint);
  assert.deepEqual(f.client.state.moves, BLACK_WIN); assert.equal(f.client.state.channelId, f.target);
  assert.deepEqual(JSON.parse(localStorage.getItem(f.key)).checkpoint, f.latest.checkpoint);
});
check('同一等待房间首次配对可从roomId转换到正确的链上channelId', async () => {
  const f = await relayRecoveryFixture(), incoming = f.room({ moves: [], sigBlack: '', sigWhite: '' });
  localStorage.removeItem(f.key);
  f.client._room = { roomId: incoming.roomId, channelId: '', black: human.address, white: '', stake: 10 };
  f.client._emit({ status: 'invited', channelId: incoming.roomId, black: human.address, white: '', role: 1 });
  await f.client._onRoom({ room: incoming, peers: [human.address, ai.address] });
  assert.equal(f.client.state.channelId, f.target); assert.equal(f.client._room.channelId, f.target);
  assert.deepEqual(f.client._checkpoint.moves, []);
  assert.deepEqual(JSON.parse(localStorage.getItem(f.key)).participants, { black: human.address, white: ai.address });
});
check('等待房间转换例外不能允许其他房间替换当前活动邀请', async () => {
  const f = await relayRecoveryFixture(), incoming = f.room({ moves: [], sigBlack: '', sigWhite: '' });
  localStorage.removeItem(f.key);
  const waitingId = id('different-waiting-room');
  f.client._room = { roomId: waitingId, channelId: '', black: human.address, white: '', stake: 10 };
  f.client._emit({ status: 'invited', channelId: waitingId, black: human.address, white: '', role: 1 });
  localStorage.setItem(`${STORE}:active-channel:${config.address}`, waitingId);
  await assert.rejects(f.client._onRoom({ room: incoming, peers: [human.address, ai.address] }), /其他局证据替换活动状态/);
  assert.equal(f.client.state.channelId, waitingId); assert.equal(f.client._room.roomId, waitingId);
  assert.equal(localStorage.getItem(f.key), null);
  assert.equal(localStorage.getItem(`${STORE}:active-channel:${config.address}`), waitingId);
});
check('同通道保护不能允许中继改积分，或用空谱替换已保存的参与者身份', async () => {
  const f = await relayRecoveryFixture(), saved = localStorage.getItem(f.key);
  await assert.rejects(f.client._onRoom({ room: f.room(f.latest.checkpoint, { stake: 20 }), peers: [human.address, ai.address] }), /积分|参与者|身份|约定/);
  assert.equal(localStorage.getItem(f.key), saved); assert.equal(f.client._room, null);
  // Empty signatures cannot authenticate a change of participants. Exercise the
  // shared guard directly because _onRoom also validates the participant/salt id.
  const empty = await fixture({ moves: [] }), before = localStorage.getItem(evidenceKey);
  const unsigned = { ...empty.evidence, checkpoint: { moves: [], sigBlack: '', sigWhite: '' } };
  for (const candidate of [
    { ...unsigned, participants: { ...unsigned.participants, black: stranger.address } },
    { ...unsigned, participants: { ...unsigned.participants, white: stranger.address } },
    { ...unsigned, stake: 20 },
  ]) assert.throws(() => empty.client._protectCheckpoint(candidate), /积分|参与者|身份|约定/);
  assert.equal(localStorage.getItem(evidenceKey), before);
});

async function liveRefreshFixture(moves) {
  const f = await fixture({ moves });
  f.client._demoId = channelId; f.client._checkpoint = structuredClone(f.evidence.checkpoint);
  f.client._emit({ mode: 'player', channelId, role: 1, black: human.address, white: ai.address, stake: 10, status: 'active', transactions: [] });
  f.client._applyCheckpoint();
  // Use the production implementation, including its real shared RPC scanner.
  f.client.refresh = ChannelClient.prototype.refresh.bind(f.client);
  return f;
}
check('外部结算后refresh先从RPC补全三笔及真实gas，再保存history和完整证据', async () => {
  const f = await liveRefreshFixture(BLACK_WIN);
  Object.assign(f.chain, { status: 4n, moves: movesHex(BLACK_WIN), winner: 1n, reason: 1n });
  f.addReceipt('ChannelSettled', channelId, id('external-settlement'), 9, 789n, [channelId, 1, 1, 1010, 990]);
  const savedSnapshots = [], saveHistory = f.client._saveHistory.bind(f.client);
  f.client._saveHistory = () => {
    savedSnapshots.push({ transactions: f.client.state.transactions.length, gas: f.client.state.metrics.totalGas, complete: f.client.exportEvidence().transactionListComplete });
    saveHistory();
  };
  await f.client.refresh();
  assert.deepEqual(savedSnapshots, [{ transactions: 3, gas: '1368', complete: true }]);
  assert.equal(f.client.state.status, 'settled'); assert.equal(f.client.state.transactions.length, 3);
  assert.equal(f.client.state.metrics.totalGas, '1368'); assert.equal(f.client.state.metrics.savedPercent, 72.7);
  assert.equal(f.client.state.history[0].transactions, 3); assert.equal(f.client.state.history[0].gas, '1368');
  const saved = JSON.parse(localStorage.getItem(evidenceKey));
  assert.equal(saved.transactionListComplete, true); assert.equal(saved.transactions.length, 3); assert.equal(saved.metrics.totalGas, '1368');
  const scans = f.queries.length; assert.ok(scans > 0);
  await f.client.refresh(); await f.client.refresh();
  f.rpc.headNumber = 11; await f.client.refresh();
  assert.equal(f.queries.length, scans, 'unchanged settled state must not scan every polling tick or unrelated block');
  f.client._emit({ transactions: [], transactionListComplete: false });
  await f.client.refresh();
  assert.ok(f.queries.length > scans, 'an explicitly incomplete list must be rebuilt even when the channel state is unchanged');
  assert.equal(f.client.state.transactions.length, 3); assert.equal(f.client.state.metrics.totalGas, '1368');
});
check('争议refresh补全遗漏交易，后续链上棋谱变化再扫描并补入强制落子', async () => {
  const f = await liveRefreshFixture([112, 113]);
  Object.assign(f.chain, { status: 3n, moves: movesHex([112, 113]), deadline: 1700001000n, proofDeadline: 1700000900n });
  f.addReceipt('CheckpointChallenged', channelId, id('external-challenge'), 7, 200n, [channelId, 2, f.chain.deadline]);
  f.client._emit({ transactions: [{ hash: f.open.hash, label: 'open only', gasUsed: '1', blockNumber: -1 }] });
  await f.client.refresh();
  assert.equal(f.client.state.status, 'dispute'); assert.equal(f.client.state.transactions.length, 3);
  assert.equal(f.client.state.metrics.totalGas, '779'); assert.equal(f.client.exportEvidence().transactionListComplete, true);
  assert.equal(f.client.state.history.length, 0);
  const scans = f.queries.length; await f.client.refresh(); assert.equal(f.queries.length, scans);
  f.rpc.headNumber = 12; f.chain.moves = movesHex([112, 113, 114]); f.chain.deadline = 1700001200n;
  f.addReceipt('ForcedMove', channelId, id('external-forced-move'), 11, 333n, [channelId, 114]);
  await f.client.refresh();
  assert.ok(f.queries.length > scans); assert.deepEqual(f.client.state.moves, [112, 113, 114]);
  assert.equal(f.client.state.transactions.length, 4); assert.equal(f.client.state.metrics.totalGas, '1112');
  assert.equal(f.client.exportEvidence().transactionListComplete, true);
});
check('结算refresh的RPC扫描失败时不保存虚假零交易history，恢复后可重试', async () => {
  const f = await liveRefreshFixture(BLACK_WIN);
  Object.assign(f.chain, { status: 4n, moves: movesHex(BLACK_WIN), winner: 1n, reason: 1n });
  f.addReceipt('ChannelSettled', channelId, id('settlement-after-rpc-retry'), 9, 789n, [channelId, 1, 1, 1010, 990]);
  const getLogs = f.client.provider.getLogs;
  f.client.provider.getLogs = async () => { throw Error('RPC logs unavailable'); };
  await assert.rejects(f.client.refresh(), /RPC logs unavailable/);
  assert.equal(f.client.state.history.length, 0); assert.equal(localStorage.getItem(`${STORE}:history`), null);
  assert.equal(f.client._refreshing, false);
  f.client.provider.getLogs = getLogs; await f.client.refresh();
  assert.equal(f.client.state.history[0].transactions, 3); assert.equal(f.client.state.history[0].gas, '1368');
});
