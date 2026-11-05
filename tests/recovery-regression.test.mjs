import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Wallet, id } from 'ethers';
import { ChannelClient } from '../web/src/channel-client.js';

const results = [];
function check(name, run) {
  test(name, async () => {
    const result = { name, status: 'running' }; results.push(result);
    try { await run(); result.status = 'passed'; }
    catch (error) { result.status = 'failed'; result.error = error.message; throw error; }
  });
}
after(() => {
  const out = process.env.TEST_RESULTS_DIR || 'artifacts/test-results/recovery-2026-11-05';
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'recovery-regression-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), tests: results, summary: { passed: results.filter(x => x.status === 'passed').length, failed: results.filter(x => x.status === 'failed').length } }, null, 2));
});

function fixture() {
  const data = new Map(); let fail = false;
  globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem(k, v) { if (fail) throw Error('QuotaExceededError'); data.set(k, String(v)); }, removeItem: k => data.delete(k) };
  const client = new ChannelClient();
  client.config = { address: '0x0000000000000000000000000000000000000001', chainId: 31337 };
  client.domain = { name: 'GomokuChannel', version: '1', chainId: 31337, verifyingContract: client.config.address };
  client.wallet = Wallet.createRandom();
  client.state.channelId = id('storage-failure');
  client.state.black = client.wallet.address; client.state.white = Wallet.createRandom().address;
  client._demoId = client.state.channelId;
  return { client, data, fail(value) { fail = value; } };
}

check('quota failure preserves the latest in-memory checkpoint and exposes a recoverable save failure', () => {
  const f = fixture(); f.client._applyCheckpoint();
  const key = `gomoku-channel-v1:evidence:${f.client.state.channelId}`, before = f.data.get(key);
  f.client._checkpoint = { moves: [112], sigBlack: 'signed-black', sigWhite: 'signed-white' };
  f.fail(true);
  assert.doesNotThrow(() => f.client._applyCheckpoint());
  assert.deepEqual(f.client.exportEvidence().checkpoint.moves, [112]);
  assert.equal(f.data.get(key), before, 'the previous durable evidence must survive');
  assert.equal(f.client.state.persistence.status, 'failed');
});
check('failed checkpoint storage prevents another signature until an explicit successful retry', async () => {
  const f = fixture(); f.fail(true); try { f.client._applyCheckpoint(); } catch { /* legacy implementation */ }
  f.client.state.status = 'active'; f.client.state.role = 1; f.client.state.nextPlayer = 1;
  f.client._room = { channelId: f.client.state.channelId };
  let signatures = 0; f.client.wallet = { signTypedData: async () => { signatures++; return 'signed'; } };
  f.client._send = () => {};
  await assert.rejects(() => f.client.move(112), /保存|存储/);
  assert.equal(signatures, 0);
  f.fail(false); await f.client.retryCheckpointSave();
  assert.equal(f.client.state.persistence.status, 'saved');
  assert.equal(signatures, 0, 'retrying persistence itself must not sign a new move');
  await f.client.move(112); assert.equal(signatures, 1);
});
check('connection closed before authentication rejects immediately and retains checkpoint', async () => {
  const f = fixture();
  const oldLocation = globalThis.location, oldWs = globalThis.WebSocket;
  globalThis.location = { protocol: 'http:', host: 'localhost:4173' };
  class Socket { static OPEN = 1; constructor() { this.readyState = 0; Socket.last = this; } close() { this.readyState = 3; this.onclose?.(); } }
  globalThis.WebSocket = Socket;
  try {
    const checkpoint = f.client._checkpoint;
    const connected = f.client._connect('room');
    Socket.last.close();
    const outcome = await Promise.race([connected.then(() => 'resolved', e => e.message), new Promise(resolve => setTimeout(() => resolve('still pending'), 30))]);
    assert.notEqual(outcome, 'still pending'); assert.notEqual(outcome, 'resolved');
    assert.equal(f.client._checkpoint, checkpoint);
  } finally { f.client._closeSocket(); globalThis.location = oldLocation; globalThis.WebSocket = oldWs; }
});
check('late authentication signature from a replaced connection cannot be sent', async () => {
  const f = fixture();
  const oldLocation = globalThis.location, oldWs = globalThis.WebSocket;
  globalThis.location = { protocol: 'http:', host: 'localhost:4173' };
  class Socket { static OPEN = 1; constructor() { this.readyState = 1; this.sent = []; Socket.all.push(this); } send(s) { this.sent.push(s); } close() { this.readyState = 3; this.onclose?.(); } static all = []; }
  globalThis.WebSocket = Socket;
  let release;
  f.client.wallet = { address: f.client.state.black, signMessage: () => new Promise(resolve => { release = resolve; }) };
  try {
    const connection = f.client._connect('room').catch(e => e.message), socket = Socket.all[0];
    socket.onmessage({ data: JSON.stringify({ type: 'hello', nonce: 'nonce' }) });
    f.client._closeSocket();
    release('late-signature'); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(socket.sent.length, 0, 'closed sockets must never send stale wallet signatures');
    await connection;
  } finally { f.client._closeSocket(); globalThis.location = oldLocation; globalThis.WebSocket = oldWs; }
});
check('duplicate pending broadcasts sign once, with an explicit resend reusing the same signature', async () => {
  const f = fixture(); let signs = 0, sent = [];
  const signer = f.client.wallet;
  f.client.wallet = { address: signer.address, signTypedData: async (...args) => { signs++; return signer.signTypedData(...args); } };
  f.client._checkpoint = { moves: [112], sigBlack: '', sigWhite: '' };
  f.client._room = { channelId: f.client.state.channelId, proposal: { by: f.client.state.white, moves: [112, 97] } };
  f.client._send = message => sent.push(message);
  await f.client.acknowledge(); await f.client.acknowledge();
  assert.equal(signs, 1, 'duplicate auto-ACK must not repeat the wallet prompt');
  assert.equal(sent.length, 1);
  await f.client.acknowledge({ resend: true });
  assert.equal(signs, 1); assert.equal(sent.length, 2); assert.equal(sent[0].signature, sent[1].signature);
});
