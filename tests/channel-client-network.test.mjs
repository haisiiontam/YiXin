import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, Wallet, keccak256, id, verifyTypedData } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { ChannelClient } from '../web/src/channel-client.js';
import { STATE_TYPES, BLACK_WIN, movesHex } from '../shared/gomoku.mjs';
import { channelId } from './helpers.mjs';

let raw, provider, contract, wallets, config;
const results = [], clients = new Set();
const out = process.env.TEST_RESULTS_DIR || 'artifacts/test-results/trust-audit-2026-11-04';
before(async () => {
  raw = ganache.provider({ logging: { quiet: true }, chain: { chainId: 31337, hardfork: 'shanghai' }, wallet: { deterministic: true, totalAccounts: 3 } });
  provider = new BrowserProvider(raw, undefined, { cacheTimeout: -1 }); provider.pollingInterval = 10;
  wallets = Object.values(raw.getInitialAccounts()).map(account => new Wallet(account.secretKey));
  const artifact = compile();
  contract = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0)).deploy(2, 300);
  await contract.waitForDeployment();
  const receipt = await contract.deploymentTransaction().wait();
  config = { mode: 'external', walletMode: 'injected', chainId: 31337, address: await contract.getAddress(), abi: artifact.abi,
    runtimeCodeHash: keccak256(await provider.getCode(await contract.getAddress())), deploymentBlock: receipt.blockNumber,
    challengePeriod: 2, networkName: 'Independent localhost EVM fixture (not public testnet)' };
});
after(async () => {
  for (const client of clients) client.destroy();
  await provider?.destroy(); await raw?.disconnect();
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'channel-client-network-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), environment: 'Real local Ganache EVM + EIP-1193 test wallet; not a live browser extension or public network', tests: results, summary: { passed: results.filter(x => x.status === 'passed').length, failed: results.filter(x => x.status === 'failed').length } }, null, 2) + '\n');
});
function check(name, fn) { test(name, async () => { try { await fn(); results.push({ name, status: 'passed' }); } catch (e) { results.push({ name, status: 'failed', error: e.message }); throw e; } }); }
function fixture(overrides = {}) {
  const storage = new Map(), requests = [], handlers = new Map();
  globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
  const injected = {
    request: async ({ method, params = [] }) => {
      requests.push(method);
      if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [wallets[0].address];
      if (method === 'eth_signTypedData_v4') {
        const typed = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
        const types = { ...typed.types }; delete types.EIP712Domain;
        return wallets[0].signTypedData(typed.domain, types, typed.message);
      }
      return raw.request({ method, params });
    },
    on: (event, fn) => handlers.set(event, fn),
    removeListener: (event, fn) => { if (handlers.get(event) === fn) handlers.delete(event); },
  };
  const client = new ChannelClient(); clients.add(client);
  client._api = async url => { assert.equal(url, '/api/config', 'external mode must not call the faucet'); return { ...config, ...overrides }; };
  return { client, storage, requests, injected, handlers };
}
check('external page load creates no private key, requests no wallet approval and sends no transaction', async () => {
  const f = fixture(); await f.client.init();
  assert.equal(f.storage.size, 0); assert.equal(f.requests.length, 0);
  assert.equal(f.client.wallet, undefined); assert.equal(f.client.state.ready, false);
  assert.equal(f.client.state.networkMode, 'external');
});
check('external wallet connect is read-only until separate registration approval, using real EVM receipts', async () => {
  const f = fixture(); await f.client.init(); await f.client.connectExternalWallet(f.injected);
  assert.equal(f.client.state.walletConnected, true); assert.equal(f.client.state.ready, false);
  assert.equal(f.requests.filter(x => x === 'eth_sendTransaction').length, 0);
  await f.client.registerExternalWallet();
  assert.equal(f.client.state.ready, true); assert.equal(f.client.state.points, 1000);
  assert.equal(f.requests.filter(x => x === 'eth_sendTransaction').length, 1);
  const receipt = await provider.getTransactionReceipt(f.client.state.initialization[0].hash);
  assert.equal(receipt.status, 1); assert.equal(receipt.to, config.address);
  assert.equal(f.storage.has('gomoku-channel-v1:local-test-key'), false);
});
check('external typed signatures come from EIP-1193 wallet and bind the canonical contract domain', async () => {
  const f = fixture(); await f.client.init(); await f.client.connectExternalWallet(f.injected);
  const value = { channelId: id('external-wallet-signature'), movesHash: keccak256(movesHex([0])) };
  const signature = await f.client.wallet.signTypedData(f.client.domain, STATE_TYPES, value);
  assert.equal(verifyTypedData(f.client.domain, STATE_TYPES, value, signature), wallets[0].address);
  assert.ok(f.requests.includes('eth_signTypedData_v4'));
  assert.equal(f.storage.has('gomoku-channel-v1:local-test-key'), false);
});
check('wrong chain or code fingerprint fails before wallet registration or transactions', async () => {
  for (const override of [{ chainId: 1 }, { runtimeCodeHash: id('wrong-code') }]) {
    const f = fixture(override); await f.client.init();
    await assert.rejects(f.client.connectExternalWallet(f.injected), /网络不符|代码.*指纹/);
    assert.equal(f.client.state.ready, false);
    assert.equal(f.requests.filter(x => x === 'eth_sendTransaction').length, 0);
  }
});
check('external mode refuses AI key generation, local funding and dual-wallet scripted demo', async () => {
  const f = fixture(); await f.client.init(); await f.client.connectExternalWallet(f.injected);
  await assert.rejects(f.client.startAiGame(), /外部钱包模式/);
  await assert.rejects(f.client.runDemo(), /外部钱包模式/);
  await assert.rejects(f.client._prepareWallet(wallets[1]), /外部模式/);
  assert.equal(f.requests.filter(x => x === 'eth_sendTransaction').length, 0);
  assert.equal([...f.storage.keys()].some(key => key.includes('local-test-key') || key.includes('ai-session')), false);
});
check('account or chain change stops the signer without deleting saved evidence', async () => {
  for (const event of ['accountsChanged', 'chainChanged']) {
    const f = fixture(); await f.client.init(); await f.client.connectExternalWallet(f.injected);
    f.storage.set('saved-evidence', 'preserve'); f.handlers.get(event)();
    assert.equal(f.client.state.ready, false); assert.equal(f.client.state.walletConnected, false);
    assert.equal(f.client.wallet, null); assert.equal(f.client.contract, null);
    assert.equal(f.storage.get('saved-evidence'), 'preserve');
  }
});
check('export separates signed offchain history from actual chain storage; import reconstructs all successful game transactions', async () => {
  const f = fixture(); await f.client.init(); await f.client.connectExternalWallet(f.injected);
  const white = await provider.getSigner(1);
  await (await contract.connect(white).register()).wait();
  const salt = id('external-export-fixture'), game = channelId(wallets[0].address, wallets[1].address, salt);
  await (await contract.openChannel(wallets[1].address, 10, salt)).wait();
  await (await contract.connect(white).joinChannel(game)).wait();
  const value = { channelId: game, movesHash: keccak256(movesHex(BLACK_WIN)) };
  const cp = { moves: BLACK_WIN, sigBlack: await wallets[0].signTypedData(f.client.domain, STATE_TYPES, value), sigWhite: await wallets[1].signTypedData(f.client.domain, STATE_TYPES, value) };
  f.client._demoId = game; f.client._checkpoint = cp;
  f.client._emit({ channelId: game, black: wallets[0].address, white: wallets[1].address, stake: 10, role: 1 });
  f.client._applyCheckpoint(); await f.client.refresh();
  const active = f.client.exportEvidence();
  assert.equal(active.checkpoint.moves.length, 9); assert.deepEqual(active.onchain.moves, []);
  assert.equal(active.onchain.status, 'active'); assert.equal(active.onchain.winner, 0);
  assert.ok(Number.isInteger(active.onchain.blockNumber));
  const settled = await (await contract.settle(game, movesHex(BLACK_WIN), cp.sigBlack, cp.sigWhite)).wait();
  const result = await f.client.importEvidence({ ...active, transactions: [] });
  assert.equal(result.transactions.length, 3); assert.equal(result.chain.status, 4);
  assert.ok(result.transactions.some(tx => tx.hash === settled.hash));
  assert.equal(f.client.state.metrics.onchainTransactions, 3);
  assert.equal(f.client.state.points, 1010);
  assert.equal(f.client.exportEvidence().onchain.moves.length, 9);
});
