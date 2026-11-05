import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GameRepository } from '../web/src/game-repository.js';
import { recoveryGuide } from '../shared/recovery-guide.mjs';

const results = [];
function check(name, fn) { test(name, async () => { try { await fn(); results.push({ name, status: 'passed' }); } catch (error) { results.push({ name, status: 'failed', error: error.message }); throw error; } }); }
after(() => {
  const out = process.env.TEST_RESULTS_DIR || 'artifacts/test-results/recovery-2026-11-05'; fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'recovery-policy-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), tests: results, summary: { passed: results.filter(x => x.status === 'passed').length, failed: results.filter(x => x.status === 'failed').length } }, null, 2));
});
function repoFixture() {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, text) => data.set(key, text) };
  return { data, storage, repository: new GameRepository(() => storage) };
}
check('damaged JSON is reported and its original bytes remain untouched', () => {
  const f = repoFixture(); f.data.set('gomoku-channel-v1:evidence:id', '{broken');
  assert.throws(() => f.repository.readEvidence('id'), /损坏/);
  assert.equal(f.data.get('gomoku-channel-v1:evidence:id'), '{broken');
});
check('a non-array history cannot masquerade as a usable empty archive', () => {
  const f = repoFixture(); f.data.set('gomoku-channel-v1:history', '{}');
  assert.throws(() => f.repository.readHistory(), /格式损坏/);
  assert.equal(f.data.get('gomoku-channel-v1:history'), '{}');
});
check('bookmark failure leaves the independently saved evidence readable', () => {
  const f = repoFixture(); f.storage.setItem = (key, text) => { if (key.includes('active-channel:')) throw Error('full'); f.data.set(key, text); };
  assert.throws(() => f.repository.saveEvidence({ channelId: 'id', checkpoint: { moves: [112] } }, 'contract'), /保存失败/);
  assert.deepEqual(f.repository.readEvidence('id').checkpoint.moves, [112]);
});
check('silent storage write rejection is detected by readback', () => {
  const repository = new GameRepository(() => ({ getItem: () => null, setItem() {} }));
  assert.throws(() => repository.saveEvidence({ channelId: 'id' }, 'contract'), /保存失败/);
});
check('repository read denial remains distinct from an absent record', () => {
  const repository = new GameRepository(() => { throw Error('SecurityError'); });
  assert.throws(() => repository.readEvidence('id'), /禁止读取/);
});
check('evidence serialization never mutates the callers checkpoint', () => {
  const f = repoFixture(), evidence = { channelId: 'id', checkpoint: { moves: [112] } };
  f.repository.saveEvidence(evidence, 'contract'); const read = f.repository.readEvidence('id'); read.checkpoint.moves.push(113);
  assert.deepEqual(evidence.checkpoint.moves, [112]);
  assert.deepEqual(f.repository.readEvidence('id').checkpoint.moves, [112]);
});
const dispute = { ready: true, status: 'dispute', moves: [112], proofDeadline: 100, deadline: 120, role: 1, nextPlayer: 1 };
for (const [chainNow, expected] of [[99, 'proof'], [100, 'response'], [119, 'response'], [120, 'timeout']]) {
  check(`dispute boundary ${chainNow} maps to ${expected} using the node sample`, () => {
    const state = Object.freeze({ ...dispute, now: 99999999, chainNow });
    assert.equal(recoveryGuide(state).stage, expected);
  });
}
check('missing node sample or failed refresh does not imply a timeout', () => {
  assert.equal(recoveryGuide({ ...dispute, now: 99999999 }).stage, 'rpc');
  assert.equal(recoveryGuide({ ...dispute, chainNow: 121, chainError: 'RPC unavailable' }).stage, 'rpc');
});
check('storage protection outranks a normal pending or dispute action', () => {
  const guide = recoveryGuide({ ...dispute, chainNow: 100, persistence: { status: 'failed' } });
  assert.equal(guide.stage, 'storage'); assert.match(guide.detail, /暂停继续签名/);
});
check('timeout advice does not promise the caller a victory', () => {
  assert.match(recoveryGuide({ ...dispute, chainNow: 120 }).detail, /不代表领取者必胜/);
});
check('a signed terminal board is distinguished from settled points', () => {
  assert.equal(recoveryGuide({ ready: true, status: 'active', connected: true, terminal: true }).stage, 'terminal');
  assert.equal(recoveryGuide({ ready: true, status: 'settled', connected: true, terminal: true }).stage, 'finished');
});
