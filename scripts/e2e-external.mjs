// Self-contained external-mode browser acceptance on a fresh loopback EVM.
// Run from app with the bundled Node executable. No public chain or real assets.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKSPACE = path.resolve(ROOT, '..');
const OUT = path.resolve(ROOT, process.env.TEST_RESULTS_DIR || 'artifacts/test-results/trust-audit-2026-11-04');
const SHOTS = path.join(OUT, 'external-screenshots');
const RESULTS = path.join(OUT, 'e2e-external-results.json');
const LOG = path.join(OUT, 'e2e-external.log');
const CHAIN_ID = 43124;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const inside = target => { const rel = path.relative(WORKSPACE, path.resolve(target)); return rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
assert.equal(path.resolve(process.cwd()), ROOT, 'Run this script from the app workspace');
assert.ok(inside(OUT), 'TEST_RESULTS_DIR must stay inside the workspace');
await fs.mkdir(path.join(ROOT, '.tmp'), { recursive: true });
await fs.mkdir(SHOTS, { recursive: true });
const runDir = await fs.mkdtemp(path.join(ROOT, '.tmp/e2e-external-'));
const runtimeDir = await fs.mkdtemp(path.join(runDir, 'runtime-'));
const browserTemp = path.join(runDir, 'browser-temp');
const homeDir = path.join(runDir, 'browser-home');
for (const dir of [browserTemp, homeDir, path.join(homeDir, 'Local'), path.join(homeDir, 'Roaming'), path.join(runDir, 'downloads')]) await fs.mkdir(dir, { recursive: true });
// Set these before importing Ganache/Playwright or starting any child process.
Object.assign(process.env, { TEMP: browserTemp, TMP: browserTemp, TMPDIR: browserTemp, npm_config_cache: path.join(runDir, 'npm-cache'), PLAYWRIGHT_BROWSERS_PATH: path.join(runDir, 'playwright-browsers'), PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' });
assert.ok(inside(os.tmpdir()), 'Node temporary directory must stay inside the workspace');
const secrets = [];
function safe(value) {
  let text = String(value?.shortMessage || value?.message || value);
  for (const secret of secrets) for (const variant of [secret, secret.slice(2)]) text = text.split(variant).join('[redacted]');
  return text;
}
await fs.writeFile(LOG, '', 'utf8');
let logQueue = Promise.resolve();
function log(message) {
  const line = `${new Date().toISOString()} ${safe(message)}`;
  console.log(line);
  logQueue = logQueue.then(() => fs.appendFile(LOG, line + '\n', 'utf8'));
  return logQueue;
}
const results = {
  generatedAt: new Date().toISOString(),
  command: 'Set TEMP/TMP to app/.tmp; run bundled node scripts/e2e-external.mjs from app',
  environment: {
    chain: 'Fresh Ganache server on loopback; real EVM execution, HTTP RPC and application CHAIN_MODE=external',
    wallet: 'Two independent EIP-1193 test emulators bridged with page.exposeBinding; offline Node Wallet signs personal messages and EIP-712; eth_sendTransaction forwards to each assigned Ganache unlocked account and returns only its transaction hash',
    limitation: 'This EIP-1193 test fixture is not MetaMask extension acceptance or a real user wallet approval test. Fixture approvals are scripted. No public-network connectivity, asset fees, or server-custodied application wallet mode is exercised.',
    browser: 'Microsoft Edge via Playwright', chainId: CHAIN_ID, challengePeriod: 6, invitePeriod: 300,
    writesConfinedToWorkspace: true, runDirectory: path.relative(ROOT, runDir),
  },
  tests: [], errors: [], blockedNetworkRequests: [], screenshots: [], cleanup: {},
};
let browser, application, ganacheServer, provider, contract, config, base;
let black, white, wallets = [], finalEvidence;
const pageNames = new Map();
const publicWallets = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 45000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(100); }
  throw Error(message);
}
async function check(name, fn) {
  const start = Date.now();
  await log(`START ${name}`);
  try { await fn(); results.tests.push({ name, status: 'passed', durationMs: Date.now() - start }); await log(`PASS ${name}`); }
  catch (error) { results.tests.push({ name, status: 'failed', error: safe(error), durationMs: Date.now() - start }); await log(`FAIL ${name}: ${safe(error)}`); throw error; }
}
async function screenshot(page, name) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  results.screenshots.push(path.relative(ROOT, path.join(SHOTS, name)));
}
async function availablePort() {
  for (let port = 4192; port <= 4209; port++) {
    const probe = net.createServer();
    try {
      await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(port, '127.0.0.1', resolve); });
      await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
      return port;
    } catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  }
  throw Error('No independent application port available in 4192..4209');
}
async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
}
async function storedEvidence(page) {
  const storage = await storageSnapshot(page);
  const key = Object.keys(storage).find(key => key.startsWith('gomoku-channel-v1:active-channel:'));
  const id = key && storage[key];
  return id && storage[`gomoku-channel-v1:evidence:${id}`] ? JSON.parse(storage[`gomoku-channel-v1:evidence:${id}`]) : null;
}
function checkNoSecrets(text, label) {
  for (const secret of secrets) for (const variant of [secret, secret.slice(2)]) assert.ok(!text.toLowerCase().includes(variant.toLowerCase()), `${label} contains an in-memory wallet secret`);
  // Signatures, addresses and hashes are public; dedicated key fields are forbidden.
  assert.ok(!/"(?:privateKey|secretKey|mnemonic)"\s*:/i.test(text), `${label} contains a wallet secret field`);
  assert.ok(!text.includes('gomoku-channel-v1:local-test-key'), `${label} contains a local test key entry`);
}
async function assertExternalUi(page, connected = false) {
  assert.match((await page.locator('.network-pill').innerText()).replace(/\s+/g, ' '), connected ? /外部钱包已连接.*43124/ : /等待外部钱包.*43124/);
  assert.match(await page.locator('.local-tag').innerText(), /独立节点 · 外部钱包/);
  assert.match(await page.locator('.sidebar-bottom').innerText(), /EXTERNAL RPC/);
  assert.equal(await page.getByRole('button', { name: '开始人机对弈', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '运行完整自动演示', exact: true }).count(), 0);
  assert.equal(await page.getByRole('radiogroup', { name: 'AI 难度' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^落子 / }).count(), 225);
  checkNoSecrets(JSON.stringify(await storageSnapshot(page)), 'browser localStorage');
}
async function makeWalletPage(wallet, name, deps) {
  const { getAddress, getBytes, verifyMessage, verifyTypedData, TypedDataEncoder, keccak256 } = deps;
  const context = await browser.newContext({ viewport: { width: 1536, height: 1100 }, acceptDownloads: true, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === base || ['data:', 'blob:', 'about:'].includes(url.protocol)) return route.continue();
    results.blockedNetworkRequests.push({ wallet: name, origin: url.origin });
    await route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  pageNames.set(page, name);
  page.on('pageerror', error => results.errors.push({ wallet: name, error: safe(error) }));
  const record = { name, address: wallet.address, requests: {}, transactions: [], personalSignatures: [], typedSignatures: [], events: [], rejectedAfterInvalidation: 0 };
  publicWallets.push(record);
  const fixture = { page, context, wallet, record, autoApprove: true, pending: [], invalidated: false };
  const reads = new Set(['eth_chainId', 'net_version', 'eth_blockNumber', 'eth_getCode', 'eth_call', 'eth_getBalance', 'eth_getLogs', 'eth_getStorageAt', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory']);
  await page.exposeBinding('walletRequest', async (source, request) => {
    assert.ok(source.page === page && source.frame === page.mainFrame(), 'Wallet bridge is main-frame only');
    assert.equal(new URL(source.frame.url()).origin, base);
    const { method, params = [] } = request || {};
    assert.equal(typeof method, 'string'); assert.ok(Array.isArray(params));
    record.requests[method] = (record.requests[method] || 0) + 1;
    if (['eth_requestAccounts', 'eth_accounts', 'wallet_accounts'].includes(method)) return [wallet.address];
    if (fixture.invalidated && ['personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction'].includes(method)) {
      record.rejectedAfterInvalidation++;
      throw Error('Test wallet account/network changed: signer disabled');
    }
    if (method === 'personal_sign') {
      assert.equal(getAddress(params[1]), wallet.address);
      const bytes = getBytes(params[0]), signature = await wallet.signMessage(bytes);
      assert.equal(verifyMessage(bytes, signature), wallet.address);
      record.personalSignatures.push({ recovered: wallet.address, messageBytes: bytes.length, signature });
      return signature;
    }
    if (method === 'eth_signTypedData_v4') {
      assert.equal(getAddress(params[0]), wallet.address);
      const typed = typeof params[1] === 'string' ? JSON.parse(params[1]) : params[1];
      assert.equal(BigInt(typed.domain.chainId), BigInt(CHAIN_ID));
      assert.equal(getAddress(typed.domain.verifyingContract), config.address);
      assert.equal(typed.domain.name, 'GomokuChannel'); assert.equal(typed.domain.version, '1');
      assert.equal(typed.primaryType, 'State');
      const types = { ...typed.types }; delete types.EIP712Domain;
      const signature = await wallet.signTypedData(typed.domain, types, typed.message);
      assert.equal(verifyTypedData(typed.domain, types, typed.message, signature), wallet.address);
      record.typedSignatures.push({ channelId: typed.message.channelId, movesHash: typed.message.movesHash, digest: TypedDataEncoder.hash(typed.domain, types, typed.message), recovered: wallet.address, signature });
      return signature;
    }
    if (method === 'eth_sendTransaction') {
      assert.equal(params.length, 1);
      const tx = { ...params[0] };
      assert.equal(getAddress(tx.from), wallet.address);
      assert.equal(getAddress(tx.to), config.address);
      assert.equal(BigInt(tx.value || 0), 0n);
      const decoded = contract.interface.parseTransaction({ data: tx.data, value: tx.value || 0 });
      assert.ok(['register', 'openChannel', 'joinChannel', 'settle'].includes(decoded?.name), 'Fixture only permits the acceptance flow');
      if (!fixture.autoApprove) await new Promise((resolve, reject) => fixture.pending.push({ resolve, reject, function: decoded.name }));
      const hash = await provider.send('eth_sendTransaction', [tx]);
      assert.match(hash, /^0x[0-9a-f]{64}$/i);
      record.transactions.push({ function: decoded.name, hash, from: wallet.address, to: tx.to });
      await log(`WALLET ${name}: ${decoded.name} submitted ${hash}`);
      return hash;
    }
    if (reads.has(method)) return provider.send(method, params);
    throw Error(`EIP-1193 fixture does not support ${method}`);
  });
  await page.addInitScript(() => {
    const handlers = new Map();
    const ethereum = {
      isExternalE2ETestEmulator: true,
      request: request => window.walletRequest(request),
      on(event, fn) { if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(fn); return ethereum; },
      removeListener(event, fn) { handlers.get(event)?.delete(fn); return ethereum; },
    };
    Object.defineProperty(window, 'ethereum', { value: ethereum, configurable: false });
    Object.defineProperty(window, '__externalWalletTest', { value: {
      emit(event, data) { for (const fn of [...(handlers.get(event) || [])]) fn(data); },
      listenerCount(event) { return handlers.get(event)?.size || 0; },
    } });
  });
  return fixture;
}
async function scanFiles(directory) {
  let count = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    assert.ok(inside(filename));
    if (entry.isSymbolicLink()) {
      // Edge may create Windows cache reparse points. Resolve only their metadata;
      // never follow a link outside the workspace while scanning test artifacts.
      const resolved = await fs.realpath(filename);
      assert.ok(inside(resolved), `Runtime link leaves workspace: ${path.relative(ROOT, filename)}`);
      results.privacy ||= {};
      results.privacy.skippedInternalRuntimeLinks ||= [];
      results.privacy.skippedInternalRuntimeLinks.push(path.relative(ROOT, filename));
      continue;
    }
    if (entry.isDirectory()) count += await scanFiles(filename);
    else if (entry.isFile()) {
      const bytes = await fs.readFile(filename);
      for (const secret of secrets) {
        for (const candidate of [Buffer.from(secret), Buffer.from(secret.slice(2)), Buffer.from(secret, 'utf16le'), Buffer.from(secret.slice(2), 'hex')]) assert.equal(bytes.includes(candidate), false, 'Generated file contains a wallet secret');
      }
      if (/\.(?:json|log)$/i.test(entry.name)) checkNoSecrets(bytes.toString('utf8'), 'generated JSON/log');
      count++;
    }
  }
  return count;
}
try {
  await log('Preparing independent external-mode fixture; existing app and chain are untouched');
  const [{ default: ganache }, { chromium }, ethers, { compile }, { createApplication }, { BLACK_WIN, movesHex, STATE_TYPES }, { verifyEvidence }, { verifyEvidenceOnchain }] = await Promise.all([
    import('ganache'), import('@playwright/test'), import('ethers'), import('./compile.mjs'), import('../server/index.mjs'), import('../shared/gomoku.mjs'), import('../shared/evidence.mjs'), import('../shared/evidence-chain.mjs'),
  ]);
  const { Wallet, JsonRpcProvider, ContractFactory, Contract, keccak256, verifyTypedData } = ethers;
  wallets = [Wallet.createRandom(), Wallet.createRandom(), Wallet.createRandom()];
  secrets.push(...wallets.map(wallet => wallet.privateKey));
  ganacheServer = ganache.server({
    logging: { quiet: true }, chain: { chainId: CHAIN_ID, networkId: CHAIN_ID, hardfork: 'shanghai' },
    wallet: { accounts: wallets.map(wallet => ({ secretKey: wallet.privateKey, balance: '0x3635c9adc5dea00000' })) },
    miner: { blockTime: 1, blockGasLimit: 30000000 },
  });
  await ganacheServer.listen(0, '127.0.0.1');
  const rpcUrl = `http://127.0.0.1:${ganacheServer.address().port}`;
  provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  provider.pollingInterval = 100;
  const artifact = compile();
  const deployment = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(wallets[0].address)).deploy(6, 300);
  await deployment.waitForDeployment();
  const deploymentReceipt = await deployment.deploymentTransaction().wait();
  const address = await deployment.getAddress();
  const runtimeHash = keccak256(await provider.getCode(address));
  contract = new Contract(address, artifact.abi, provider);
  const port = await availablePort();
  application = await createApplication({ env: {
    PORT: String(port), HOST: '127.0.0.1', CHAIN_MODE: 'external', RPC_URL: rpcUrl,
    EXPECTED_CHAIN_ID: String(CHAIN_ID), CONTRACT_ADDRESS: address, DEPLOYMENT_BLOCK: String(deploymentReceipt.blockNumber),
    EXPECTED_RUNTIME_CODE_HASH: runtimeHash, CHALLENGE_PERIOD: '6', INVITE_PERIOD: '300', RUNTIME_DIR: runtimeDir,
    NETWORK_NAME: 'Independent loopback EVM (external test)',
  }, artifact });
  await application.listen();
  base = `http://127.0.0.1:${port}`;
  config = await (await fetch(`${base}/api/config`)).json();
  results.environment.url = base; results.environment.rpcUrl = rpcUrl;
  results.deployment = { hash: deploymentReceipt.hash, address, blockNumber: deploymentReceipt.blockNumber, blockHash: deploymentReceipt.blockHash, runtimeCodeHash: runtimeHash, creationArtifactHash: keccak256(artifact.bytecode), compiler: artifact.compiler };
  await log(`Real contract deployed ${address}; independent external application ${base}; RPC ${rpcUrl}`);
  browser = await chromium.launch({
    executablePath: EDGE, headless: true, downloadsPath: path.join(runDir, 'downloads'),
    args: ['--disable-background-networking', '--disable-breakpad', '--disable-crash-reporter', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check', '--disable-domain-reliability', '--disable-extensions', '--disable-features=MediaRouter,OptimizationHints,AutofillServerCommunication,EdgeWallet', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'],
    env: { ...process.env, LOCALAPPDATA: path.join(homeDir, 'Local'), APPDATA: path.join(homeDir, 'Roaming') },
  });
  results.environment.browserVersion = browser.version();
  black = await makeWalletPage(wallets[1], 'black', ethers);
  white = await makeWalletPage(wallets[2], 'white', ethers);
  const expected = { chainId: CHAIN_ID, verifyingContract: address, deploymentBlock: deploymentReceipt.blockNumber, runtimeCodeHash: runtimeHash };

  await check('1. External landing: honest badge, no local key/AI/demo, no wallet request or transaction', async () => {
    assert.equal(config.mode, 'external'); assert.equal(config.walletMode, 'injected'); assert.equal(config.chainId, CHAIN_ID);
    assert.equal(config.runtimeCodeHash, runtimeHash);
    const health = await (await fetch(`${base}/api/health`)).json();
    assert.equal(health.mode, 'external');
    for (const fixture of [black, white]) {
      await fixture.page.goto(base);
      await fixture.page.getByRole('button', { name: '连接浏览器钱包', exact: true }).waitFor();
      await assertExternalUi(fixture.page);
      assert.deepEqual(fixture.record.requests, {});
      assert.equal(await fixture.page.getByRole('button', { name: '确认注册演示积分', exact: true }).count(), 0);
      assert.equal(await fixture.page.getByRole('button', { name: '创建对局', exact: true }).isEnabled(), false);
      assert.equal(await provider.getTransactionCount(fixture.wallet.address), 0);
    }
    await screenshot(black.page, '01-external-connect.png');
    results.initialUi = { noWalletRequests: true, noTransactions: true, noLocalKey: true, noAiOrDemoButtons: true, externalBadge: true };
  });

  await check('2. Read-only wallet connect; separate UI registration and test-wallet approval yield real receipts and 1000 points', async () => {
    for (const fixture of [black, white]) {
      await fixture.page.getByRole('button', { name: '连接浏览器钱包', exact: true }).click();
      await fixture.page.getByRole('button', { name: '确认注册演示积分', exact: true }).waitFor();
      assert.equal(fixture.record.transactions.length, 0);
      assert.equal(fixture.record.requests.eth_sendTransaction || 0, 0);
      assert.equal(await provider.getTransactionCount(fixture.wallet.address), 0);
      assert.equal(await contract.registered(fixture.wallet.address), false);
      fixture.autoApprove = false;
      await fixture.page.getByRole('button', { name: '确认注册演示积分', exact: true }).click();
      await until(() => fixture.pending.length === 1, 'Registration did not request wallet approval');
      assert.equal(fixture.pending[0].function, 'register');
      assert.equal(await contract.registered(fixture.wallet.address), false);
      assert.equal(await provider.getTransactionCount(fixture.wallet.address), 0);
      fixture.pending.shift().resolve(); fixture.autoApprove = true;
      await fixture.page.getByText('1000 演示积分', { exact: true }).waitFor({ timeout: 45000 });
      await assertExternalUi(fixture.page, true);
      assert.equal(fixture.record.transactions.length, 1);
      const tx = fixture.record.transactions[0], receipt = await provider.getTransactionReceipt(tx.hash);
      assert.equal(receipt.status, 1); assert.equal(receipt.to, address); assert.equal(receipt.from, fixture.wallet.address);
      assert.equal(Number(await contract.points(fixture.wallet.address)), 1000);
      const event = receipt.logs.map(log => { try { return contract.interface.parseLog(log); } catch { return null; } }).find(event => event?.name === 'Registered');
      assert.equal(event.args.player, fixture.wallet.address); assert.equal(Number(event.args.points), 1000);
      tx.receipt = { status: receipt.status, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, gasUsed: receipt.gasUsed.toString(), event: event.name, points: 1000 };
    }
    results.registration = { independentConnectAndRegister: true, walletApprovalHeldBeforeSubmission: true, black: black.record.transactions[0], white: white.record.transactions[0], countedOutsideGameTransactions: true };
  });

  await check('3. Two isolated contexts authenticate using personal_sign and open/join a real points channel', async () => {
    await black.page.getByRole('button', { name: '创建对局', exact: true }).click();
    const code = black.page.locator('.room-info > code'); await code.waitFor();
    const roomId = (await code.textContent()).trim();
    assert.match(roomId, /^0x[0-9a-f]{64}$/i);
    assert.equal(black.record.transactions.length, 1, 'Creating an invite alone should not lock points');
    await white.page.getByRole('textbox', { name: '邀请码', exact: true }).fill(roomId);
    await white.page.getByRole('button', { name: '加入对局', exact: true }).click();
    await Promise.all([black, white].map(f => f.page.getByText('对局进行中', { exact: true }).waitFor({ timeout: 60000 })));
    await until(async () => (await storedEvidence(black.page))?.transactions.length === 2 && (await storedEvidence(white.page))?.transactions.length === 2, 'Open/join receipts not persisted');
    const evidence = await storedEvidence(black.page), channel = await contract.getChannel(evidence.channelId);
    assert.equal(Number(channel.status), 2); assert.equal(channel.black, black.wallet.address); assert.equal(channel.white, white.wallet.address); assert.equal(Number(channel.stake), 10);
    assert.equal(Number(await contract.totalLocked()), 20);
    assert.equal(Number(await contract.points(channel.black)), 990); assert.equal(Number(await contract.points(channel.white)), 990);
    assert.equal(black.record.personalSignatures.length, 1); assert.equal(white.record.personalSignatures.length, 1);
    assert.equal(black.record.transactions.filter(tx => tx.function === 'openChannel').length, 1);
    assert.equal(white.record.transactions.filter(tx => tx.function === 'joinChannel').length, 1);
    const verification = await verifyEvidenceOnchain(evidence, { provider, contract, expected });
    assert.equal(verification.transactions.length, 2); assert.equal(verification.chain.status, 2);
    results.room = { roomId, channelId: evidence.channelId, black: channel.black, white: channel.white, stake: 10, openJoinVerification: verification };
  });

  await check('4. Nine alternating UI moves auto-ACK with both EIP-712 signatures; independent RPC still finds only open+join', async () => {
    const checkpoints = [];
    for (let i = 0; i < BLACK_WIN.length; i++) {
      const fixture = i % 2 ? white : black, p = BLACK_WIN[i];
      await fixture.page.getByRole('button', { name: `落子 ${Math.floor(p / 15) + 1},${p % 15 + 1}`, exact: true }).click({ timeout: 20000 });
      await Promise.all([black, white].map(f => f.page.getByText(`第 ${i + 1} 手已确认`, { exact: true }).waitFor({ timeout: 20000 })));
      const [b, w] = await Promise.all([storedEvidence(black.page), storedEvidence(white.page)]);
      assert.deepEqual(b.checkpoint.moves, BLACK_WIN.slice(0, i + 1));
      assert.deepEqual(b.checkpoint, w.checkpoint);
      const verified = verifyEvidence(b, expected); assert.equal(verified.signed, true);
      const value = { channelId: b.channelId, movesHash: keccak256(movesHex(b.checkpoint.moves)) };
      assert.equal(verifyTypedData(b.domain, STATE_TYPES, value, b.checkpoint.sigBlack), black.wallet.address);
      assert.equal(verifyTypedData(b.domain, STATE_TYPES, value, b.checkpoint.sigWhite), white.wallet.address);
      assert.equal(b.transactions.length, 2); assert.deepEqual(b.onchain.moves, []); assert.equal(b.onchain.status, 'active');
      checkpoints.push({ moveCount: i + 1, checkpoint: b.checkpoint, digest: verified.digest });
      await log(`MOVE ${i + 1}: both EIP-712 signatures verified; no move transaction`);
    }
    assert.equal(black.record.typedSignatures.length, 9); assert.equal(white.record.typedSignatures.length, 9);
    assert.equal(black.record.transactions.length + white.record.transactions.length, 4, 'Only two registrations plus open/join before settlement');
    finalEvidence = await storedEvidence(black.page);
    const active = await verifyEvidenceOnchain(finalEvidence, { provider, contract, expected });
    assert.equal(active.transactions.length, 2); assert.equal(active.chain.moves.length, 0);
    results.moves = { moveCount: 9, blackTypedSignatures: 9, whiteTypedSignatures: 9, checkpoints, beforeSettlement: finalEvidence, independentRpc: active };
    await screenshot(black.page, '02-external-dual-signed-win.png');
  });

  await check('5. Real settlement: three game receipts, 1010/990 points, signed checkpoint and complete independent RPC event inventory', async () => {
    await black.page.getByRole('button', { name: '链上结算本局', exact: true }).click();
    await Promise.all([black, white].map(f => f.page.getByText('已完成结算', { exact: true }).waitFor({ timeout: 60000 })));
    // Receipt broadcasts and the asynchronous full RPC inventory can update
    // localStorage before refresh saves the final onchain snapshot. Wait for the
    // complete persistent state on both contexts; retain all strict assertions.
    await until(async () => {
      const saved = await Promise.all([storedEvidence(black.page), storedEvidence(white.page)]);
      return saved.every(evidence => evidence?.transactions.length === 3 && evidence.onchain?.status === 'settled'
        && JSON.stringify(evidence.onchain.moves) === JSON.stringify(BLACK_WIN));
    }, 'Settled evidence has not persisted all receipts and the final chain snapshot');
    finalEvidence = await storedEvidence(black.page);
    const independent = await verifyEvidenceOnchain(finalEvidence, { provider, contract, expected });
    assert.equal(independent.valid, true); assert.equal(independent.signed, true); assert.equal(independent.transactionListComplete, true);
    assert.equal(independent.chain.codeIdentityVerified, true); assert.equal(independent.chain.status, 4); assert.equal(independent.chain.winner, 1);
    assert.deepEqual(independent.chain.moves, BLACK_WIN); assert.equal(independent.transactions.length, 3);
    assert.equal(finalEvidence.transactions.length, 3); assert.deepEqual(finalEvidence.onchain.moves, BLACK_WIN); assert.equal(finalEvidence.onchain.status, 'settled');
    const blackPoints = Number(await contract.points(black.wallet.address)), whitePoints = Number(await contract.points(white.wallet.address));
    assert.equal(blackPoints, 1010); assert.equal(whitePoints, 990); assert.equal(Number(await contract.totalLocked()), 0); assert.equal(Number(await contract.totalIssued()), 2000);
    const allLogs = await provider.getLogs({ address, fromBlock: deploymentReceipt.blockNumber, toBlock: 'latest' });
    const events = allLogs.map(item => { const event = contract.interface.parseLog(item); return { name: event.name, transactionHash: item.transactionHash, blockNumber: item.blockNumber, channelId: event.args.id || null }; });
    assert.deepEqual(events.map(event => event.name), ['Registered', 'Registered', 'ChannelOpened', 'ChannelJoined', 'ChannelSettled']);
    assert.equal(black.record.transactions.length + white.record.transactions.length, 5, 'Two registrations plus three game transactions');
    await black.page.locator('details.experiment-panel > summary').click();
    const downloadPromise = black.page.waitForEvent('download');
    await black.page.getByRole('button', { name: '导出证据 JSON', exact: true }).click();
    const download = await downloadPromise;
    const exportPath = path.join(OUT, 'external-browser-exported-evidence.json');
    await download.saveAs(exportPath);
    const exported = JSON.parse(await fs.readFile(exportPath, 'utf8'));
    checkNoSecrets(JSON.stringify(exported), 'browser-exported evidence');
    const exportedVerification = await verifyEvidenceOnchain(exported, { provider, contract, expected });
    assert.equal(exportedVerification.transactions.length, 3); assert.equal(exportedVerification.chain.winner, 1);
    for (const fixture of [black, white]) await assertExternalUi(fixture.page, true);
    await screenshot(black.page, '03-external-settled.png');
    results.settlement = { blackPoints, whitePoints, totalLocked: 0, totalIssued: 2000, gameTransactions: 3, registrationTransactions: 2, totalUserTransactions: 5, events, independentRpc: independent, exportedEvidence: path.relative(ROOT, exportPath), evidence: finalEvidence };
  });

  await check('6. Account/network changes invalidate UI and preserve evidence; persisted artifacts contain no wallet secrets', async () => {
    const cases = [{ fixture: black, event: 'accountsChanged', data: [white.wallet.address] }, { fixture: white, event: 'chainChanged', data: '0x1' }];
    results.walletChanges = [];
    for (const { fixture, event, data } of cases) {
      const beforeStorage = await storageSnapshot(fixture.page);
      const countsBefore = { sends: fixture.record.requests.eth_sendTransaction || 0, typed: fixture.record.requests.eth_signTypedData_v4 || 0, personal: fixture.record.requests.personal_sign || 0 };
      assert.equal(await fixture.page.evaluate(event => window.__externalWalletTest.listenerCount(event), event), 1);
      // Keep the fixture capable of signing until after checking the app: an inert
      // stale signer must be established by the product, not imposed by this bridge.
      await fixture.page.evaluate(({ event, data }) => window.__externalWalletTest.emit(event, data), { event, data });
      await fixture.page.getByRole('alert').filter({ hasText: '钱包账户或网络已变化' }).waitFor();
      await fixture.page.getByRole('button', { name: '连接浏览器钱包', exact: true }).waitFor();
      await assertExternalUi(fixture.page);
      const create = fixture.page.getByRole('button', { name: '创建对局', exact: true });
      assert.equal(await create.isEnabled(), false);
      await fixture.page.getByRole('textbox', { name: '邀请码', exact: true }).fill(results.room.roomId);
      assert.equal(await fixture.page.getByRole('button', { name: '加入对局', exact: true }).isEnabled(), false);
      assert.equal(await fixture.page.locator('.intersection:not(:disabled)').count(), 0);
      // A DOM click on disabled controls must not reach a stale wallet either.
      await create.evaluate(button => button.click());
      await fixture.page.getByRole('button', { name: '加入对局', exact: true }).evaluate(button => button.click());
      const afterStorage = await storageSnapshot(fixture.page);
      for (const [key, value] of Object.entries(beforeStorage).filter(([key]) => key.includes(':evidence:'))) assert.equal(afterStorage[key], value);
      assert.deepEqual({ sends: fixture.record.requests.eth_sendTransaction || 0, typed: fixture.record.requests.eth_signTypedData_v4 || 0, personal: fixture.record.requests.personal_sign || 0 }, countsBefore);
      assert.equal(fixture.record.rejectedAfterInvalidation, 0);
      fixture.invalidated = true;
      fixture.record.events.push(event);
      results.walletChanges.push({ wallet: fixture.record.name, event, invalidationNotice: true, createJoinAndBoardDisabled: true, noStaleSignerRequest: true, evidencePreserved: true });
    }
    const snapshots = { black: await storageSnapshot(black.page), white: await storageSnapshot(white.page) };
    checkNoSecrets(JSON.stringify(snapshots), 'persisted external browser state');
    await fs.writeFile(path.join(OUT, 'external-browser-storage.json'), JSON.stringify(snapshots, null, 2) + '\n', 'utf8');
    results.privacy = { browserLocalKeyAbsent: true, browserSecretFieldsAbsent: true, inMemoryWalletSecretsAbsentFromEvidence: true, browserStorage: 'artifacts/test-results/trust-audit-2026-11-04/external-browser-storage.json' };
    assert.deepEqual(results.errors, [], 'Browser must have no uncaught exceptions');
    assert.deepEqual(results.blockedNetworkRequests, [], 'App must not attempt public HTTP resources');
    await screenshot(black.page, '04-external-account-invalidated.png');
  });
} catch (error) {
  results.failure = safe(error); process.exitCode = 1;
  await log(`ERROR ${safe(error)}`);
  for (const [index, fixture] of [black, white].entries()) if (fixture?.page && !fixture.page.isClosed()) {
    try { await screenshot(fixture.page, `failure-${index ? 'white' : 'black'}.png`); } catch (error) { await log(`Failure screenshot unavailable: ${safe(error)}`); }
    try { results.failureUi ||= {}; results.failureUi[index ? 'white' : 'black'] = safe(await fixture.page.locator('body').innerText()); } catch {}
  }
} finally {
  for (const fixture of [black, white]) for (const pending of fixture?.pending || []) pending.reject(Error('Test fixture shutting down'));
  for (const [name, close] of [
    ['browser', async () => { if (browser) await browser.close(); }],
    ['applicationHttpAndRuntimeProvider', async () => { if (application) await application.close(); }],
    ['independentRpcProvider', async () => { if (provider) provider.destroy(); }],
    ['ganacheHttpAndEvm', async () => { if (ganacheServer) await ganacheServer.close(); }],
  ]) {
    try { await close(); results.cleanup[name] = 'closed'; await log(`CLEANUP ${name}: closed`); }
    catch (error) { results.cleanup[name] = safe(error); process.exitCode = 1; await log(`CLEANUP ${name}: ${safe(error)}`); }
  }
  results.wallets = publicWallets;
  results.finishedAt = new Date().toISOString();
  results.summary = { passed: results.tests.filter(test => test.status === 'passed').length, failed: results.tests.filter(test => test.status === 'failed').length };
  try {
    await logQueue;
    const scanned = await scanFiles(runDir);
    for (const filename of [LOG, path.join(OUT, 'external-browser-exported-evidence.json'), path.join(OUT, 'external-browser-storage.json')]) {
      try { checkNoSecrets(await fs.readFile(filename, 'utf8'), 'saved artifact'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    results.privacy ||= {};
    results.privacy.scannedRunFiles = scanned;
    results.privacy.generatedFilesScannedAfterBrowserClosed = true;
    results.privacy.walletSecretMatches = 0;
    checkNoSecrets(JSON.stringify(results), 'result JSON');
  } catch (error) { results.privacyFailure = safe(error); process.exitCode = 1; await log(`PRIVACY FAILURE: ${safe(error)}`); }
  await fs.writeFile(RESULTS, JSON.stringify(results, null, 2) + '\n', 'utf8');
  await log(`RESULT ${results.summary.passed} passed, ${results.summary.failed} failed; ${path.relative(ROOT, RESULTS)}`);
  await logQueue;
}
