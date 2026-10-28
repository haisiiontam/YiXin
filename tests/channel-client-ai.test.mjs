// Regression tests use real EIP-712 signatures and controlled chain/RPC fixtures.
// The existing browser E2E covers live RPC and transactions; these tests exercise hostile local storage.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Wallet, id, keccak256 } from 'ethers';
import { ChannelClient } from '../web/src/channel-client.js';
import { movesHex, STATE_TYPES } from '../shared/gomoku.mjs';

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
  fs.mkdirSync('artifacts/test-results', { recursive: true });
  fs.writeFileSync('artifacts/test-results/channel-client-ai-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), tests: results, summary: { passed: results.filter(t => t.status === 'passed').length, failed: results.filter(t => t.status === 'failed').length } }, null, 2));
});

async function fixture({ moves = [112, 113], humanRole = 1 } = {}) {
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
  const black = humanRole === 1 ? human : ai, white = humanRole === 1 ? ai : human;
  const value = { channelId, movesHash: keccak256(movesHex(moves)) };
  const evidence = { format: 'gomoku-channel-evidence/v1', domain, channelId, participants: { black: black.address, white: white.address }, stake: 10,
    checkpoint: { moves, sigBlack: await black.signTypedData(domain, STATE_TYPES, value), sigWhite: await white.signTypedData(domain, STATE_TYPES, value) }, transactions: [] };
  const session = { key: ai.privateKey, channelId, level: 'adept', humanRole };
  const chain = { status: 2n, black: black.address, white: white.address, stake: 10n };
  const client = new ChannelClient();
  client.config = config; client.domain = domain; client.wallet = human;
  client.contract = { getChannel: async () => chain, interface: { parseLog: log => ({ args: { id: log.id } }) } };
  client.provider = { getTransactionReceipt: async () => null };
  client.refresh = async () => {};
  let replies = 0;
  client._aiReply = async () => { assert.equal(client.state.busy, true, 'resume must hold the operation lock while AI is responding'); replies++; };
  function save() {
    localStorage.setItem(sessionKey, JSON.stringify(session));
    localStorage.setItem(evidenceKey, JSON.stringify(evidence));
    localStorage.setItem(`${STORE}:active-channel:${config.address}`, channelId);
  }
  save();
  return { client, session, chain, evidence, storage, save, replies: () => replies };
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
  f.evidence.transactions = [{ hash: id('tx'), gasUsed: '1', blockNumber: -1 }]; f.save();
  assert.equal(await f.client._resumeAi(), false);
  assert.equal(f.client.state.mode, 'player');
  f.save();
  f.client.provider.getTransactionReceipt = async () => ({ status: 1, to: config.address, gasUsed: 123n, blockNumber: 5, logs: [{ address: config.address, id: channelId }] });
  assert.equal(await f.client._resumeAi(), true);
  assert.equal(f.client.state.transactions[0].gasUsed, '123');
  assert.equal(f.client.state.transactions[0].blockNumber, 5);
});

check('其他对局的回执不能被恢复成当前局的交易', async () => {
  const f = await fixture();
  f.evidence.transactions = [{ hash: id('other-tx') }]; f.save();
  f.client.provider.getTransactionReceipt = async () => ({ status: 1, to: config.address, gasUsed: 123n, blockNumber: 5, logs: [{ address: config.address, id: id('other-game') }] });
  assert.equal(await f.client._resumeAi(), false);
});

check('恢复等待 RPC 时也持有操作锁，不能并发开始新局', async () => {
  const f = await fixture();
  let release;
  f.client.contract.getChannel = () => new Promise(resolve => { release = () => resolve(f.chain); });
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
