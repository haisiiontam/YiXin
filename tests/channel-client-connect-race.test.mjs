// Controlled EIP-1193 scheduling with the real BrowserProvider, Contract and compiled ABI.
// No private keys, EVM deployment, extension wallet or public network are used.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Interface, keccak256 } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { ChannelClient } from '../web/src/channel-client.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.resolve(root, process.env.TEST_RESULTS_DIR || 'artifacts/test-results/trust-audit-2026-11-04');
const relativeOutput = path.relative(path.resolve(root, '..'), outputDirectory);
if (relativeOutput === '..' || relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) throw Error('TEST_RESULTS_DIR must remain inside the Gomoku workspace');
const abi = compile().abi;
const contractInterface = new Interface(abi);
const address = '0x0000000000000000000000000000000000001234';
const accountA = '0x0000000000000000000000000000000000001111';
const accountB = '0x0000000000000000000000000000000000002222';
const expectedChainId = 31337;
const runtimeCode = '0x60006000f3';
const preservedKey = 'gomoku-channel-v1:evidence:connection-race-preserved';
const results = [];

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture({ change, phase, permissionAccountChange = false, permissionDenied = false } = {}) {
  const storage = new Map([[preservedKey, 'original signed evidence remains untouched']]);
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key),
  };
  const config = {
    mode: 'external', walletMode: 'injected', chainId: expectedChainId, address, abi,
    runtimeCodeHash: keccak256(runtimeCode), challengePeriod: 60, deploymentBlock: 1,
    networkName: 'Controlled EIP-1193 fixture; no public network',
  };
  const handlers = new Map(), requests = [], snapshots = [], events = [];
  const pointsEntered = deferred(), releasePoints = deferred();
  let chainId = '0x7a69', accounts = [accountA], codeChecked = false;
  let changed = false, pointsPaused = false, snapshotAtChange = 0;
  function emit(event, payload) {
    events.push({ event, payload, listeners: handlers.get(event)?.size || 0 });
    for (const listener of [...(handlers.get(event) || [])]) listener(payload);
  }
  function changeWallet(kind = change) {
    changed = true; snapshotAtChange = snapshots.length;
    if (kind === 'chain') { chainId = '0x1'; emit('chainChanged', chainId); }
    else { accounts = [accountB]; emit('accountsChanged', [...accounts]); }
  }
  const injected = {
    on(event, listener) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(listener); return this;
    },
    removeListener(event, listener) { handlers.get(event)?.delete(listener); return this; },
    async request({ method, params = [] }) {
      requests.push({ method, params });
      if (method === 'eth_chainId') return chainId;
      if (method === 'eth_requestAccounts') {
        if (permissionDenied) { const error = Error('User rejected wallet permission'); error.code = 4001; throw error; }
        if (permissionAccountChange) changeWallet('account');
        return [...accounts];
      }
      if (method === 'eth_accounts') {
        // Reproduce the gap after code verification but before signer acquisition finishes.
        if (phase === 'after-code' && codeChecked && !changed) changeWallet();
        return [...accounts];
      }
      if (method === 'eth_getCode') { codeChecked = true; return runtimeCode; }
      if (method === 'eth_call') {
        assert.equal(params[0].to.toLowerCase(), address.toLowerCase());
        const call = contractInterface.parseTransaction({ data: params[0].data });
        if (call.name === 'registered') return contractInterface.encodeFunctionResult('registered', [true]);
        if (call.name === 'points') {
          // Capture the old account's successful result before suspending its RPC response.
          const response = contractInterface.encodeFunctionResult('points', [call.args[0].toLowerCase() === accountB.toLowerCase() ? 650 : 1000]);
          if (phase === 'points-await' && !pointsPaused) {
            pointsPaused = true; pointsEntered.resolve(); await releasePoints.promise;
          }
          return response;
        }
        throw Error(`Unexpected contract read: ${call.name}`);
      }
      throw Error(`Unexpected EIP-1193 method: ${method}`);
    },
  };
  const client = new ChannelClient();
  client._api = async url => { assert.equal(url, '/api/config', 'connection must not fund an account or access a room'); return config; };
  client.subscribe(snapshot => snapshots.push({ ready: snapshot.ready, walletConnected: snapshot.walletConnected, address: snapshot.address, points: snapshot.points }));
  return {
    client, injected, storage, requests, snapshots, events, pointsEntered, releasePoints, changeWallet,
    changed: () => changed,
    afterChange: () => snapshots.slice(snapshotAtChange),
    capture(outcome) {
      return {
        resolved: outcome.resolved, error: outcome.error?.shortMessage || outcome.error?.message || '',
        expectedChainId, actualChainId: Number(BigInt(chainId)), selectedAccount: accounts[0],
        ready: client.state.ready, walletConnected: client.state.walletConnected, address: client.state.address,
        signerPresent: Boolean(client.wallet), contractPresent: Boolean(client.contract),
        timerRunning: Boolean(client._timer && !client._timer._destroyed),
        events, snapshots, methods: requests.map(request => request.method),
      };
    },
  };
}
function connect(fixture) {
  return fixture.client.connectExternalWallet(fixture.injected).then(
    () => ({ resolved: true }), error => ({ resolved: false, error }),
  );
}
function assertReadOnly(fixture) {
  assert.ok(!fixture.requests.some(request => /^(eth_send|eth_sign|personal_|wallet_)/.test(request.method)), 'connecting must not sign or send any transaction');
  assert.equal(fixture.storage.get(preservedKey), 'original signed evidence remains untouched');
  assert.ok(![...fixture.storage.keys()].some(key => key.includes('local-test-key') || key.includes('ai-session')), 'connecting must not create private-key storage');
}
function assertInvalidated(fixture, outcome) {
  assert.equal(outcome.resolved, false, 'a connection changed after permission must be rejected');
  assert.equal(fixture.client.state.ready, false);
  assert.equal(fixture.client.state.walletConnected, false);
  assert.equal(Boolean(fixture.client.wallet), false, 'failed connection must clear the signer');
  assert.equal(Boolean(fixture.client.contract), false, 'failed connection must clear the contract');
  assert.ok(!fixture.client._timer || fixture.client._timer._destroyed, 'failed connection must stop its refresh timer');
  assert.equal(fixture.client.state.busy, false);
  assertReadOnly(fixture);
}
function check(name, run) {
  test(name, { timeout: 10000 }, async () => {
    const record = { name, status: 'running' }; results.push(record);
    try { await run(record); record.status = 'passed'; }
    catch (error) { record.status = 'failed'; record.error = error.message; throw error; }
  });
}
after(() => {
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, 'channel-client-connect-race-results.json'), JSON.stringify({
    generatedAt: new Date().toISOString(),
    command: process.env.TEST_COMMAND || 'node --test --test-concurrency=1 tests/channel-client-connect-race.test.mjs',
    implementation: process.env.TEST_IMPLEMENTATION || 'working-tree client implementation',
    environment: 'Controlled fake EIP-1193 with real ethers BrowserProvider/Contract and compiled contract ABI; not a live extension or public-chain test',
    tests: results,
    summary: { passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status === 'failed').length },
  }, null, 2) + '\n');
});

check('stable external connection installs the selected registered account without signing or sending', async record => {
  const f = fixture();
  try {
    await f.client.init(); const outcome = await connect(f); record.observation = f.capture(outcome);
    assert.equal(outcome.resolved, true, outcome.error?.message);
    assert.equal(f.client.state.ready, true); assert.equal(f.client.state.walletConnected, true);
    assert.equal(f.client.state.address, accountA); assert.equal(f.client.state.points, 1000);
    assert.equal(Number((await f.client.provider.getNetwork()).chainId), expectedChainId);
    assertReadOnly(f);
  } finally { f.client.destroy(); }
});
check('initial permission accountsChanged is accepted when the final selected account is consistent', async record => {
  const f = fixture({ permissionAccountChange: true });
  try {
    await f.client.init(); const outcome = await connect(f); record.observation = f.capture(outcome);
    assert.ok(f.changed()); assert.equal(outcome.resolved, true, outcome.error?.message);
    assert.equal(f.client.state.ready, true); assert.equal(f.client.state.walletConnected, true);
    assert.equal(f.client.state.address, accountB); assert.equal(f.client.wallet.address, accountB);
    assert.equal(f.client.state.points, 650); assertReadOnly(f);
  } finally { f.client.destroy(); }
});
for (const change of ['chain', 'account']) {
  check(`${change} change after getCode during signer acquisition rejects and clears the connection`, async record => {
    const f = fixture({ change, phase: 'after-code' });
    try {
      await f.client.init(); const outcome = await connect(f); record.observation = f.capture(outcome);
      assert.ok(f.changed(), 'the fixture must switch after code verification');
      assertInvalidated(f, outcome);
      assert.ok(f.afterChange().every(snapshot => !snapshot.ready && !snapshot.walletConnected), 'stale work must never publish a ready session after the change');
    } finally { f.client.destroy(); }
  });
  check(`${change} change while session points RPC awaits cannot resurrect a ready session`, async record => {
    const f = fixture({ change, phase: 'points-await' });
    try {
      await f.client.init(); const connecting = connect(f);
      await Promise.race([
        f.pointsEntered.promise,
        connecting.then(outcome => { throw Error(`connection finished before points RPC was paused: ${outcome.error?.message || 'resolved'}`); }),
      ]);
      f.changeWallet(); f.releasePoints.resolve();
      const outcome = await connecting; record.observation = f.capture(outcome);
      assertInvalidated(f, outcome);
      assert.ok(f.afterChange().every(snapshot => !snapshot.ready && !snapshot.walletConnected), 'late points RPC must not publish stale ready/account state');
    } finally { f.releasePoints.resolve(); f.client.destroy(); }
  });
}
check('rejected permission leaves no signer, contract, active timer or transaction', async record => {
  const f = fixture({ permissionDenied: true });
  try {
    await f.client.init(); const outcome = await connect(f); record.observation = f.capture(outcome);
    assertInvalidated(f, outcome);
  } finally { f.client.destroy(); }
});
check('failed reconnection retires the previously connected signer and ready state', async record => {
  const f = fixture();
  try {
    await f.client.init(); const initial = await connect(f);
    assert.equal(initial.resolved, true, initial.error?.message); assert.equal(f.client.state.ready, true);
    f.client.config.runtimeCodeHash = keccak256('0x60016000f3');
    const outcome = await connect(f); record.observation = f.capture(outcome);
    assertInvalidated(f, outcome);
  } finally { f.client.destroy(); }
});
