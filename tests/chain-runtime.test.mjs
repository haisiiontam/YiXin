import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import ganache from 'ganache';
import solc from 'solc';
import { JsonRpcProvider, Contract, ContractFactory, Wallet, keccak256, id, ZeroAddress, ZeroHash, TypedDataEncoder } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { initializeChain, resolveRuntimeDirectory } from '../server/chain-runtime.mjs';
import { createApplication } from '../server/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.resolve(root, process.env.TEST_RESULTS_DIR || 'artifacts/test-results/trust-audit-2026-11-04');
const records = [], observations = {};
let artifact, remote, remoteProvider, gateway, endpoint, externalEnv, runDirectory;
const rpcMethods = [];
async function fresh(name) { return fs.mkdtemp(path.join(runDirectory, `${name}-`)); }
async function writeManifest(directory, mutate) {
  const target = path.join(directory, 'deployment.json');
  const manifest = JSON.parse(await fs.readFile(target, 'utf8'));
  mutate(manifest);
  await fs.writeFile(target, JSON.stringify(manifest, null, 2));
}
function check(name, fn) {
  test(name, async () => {
    const start = Date.now();
    try { await fn(); records.push({ name, status: 'passed', durationMs: Date.now() - start }); }
    catch (error) { records.push({ name, status: 'failed', error: error.message, durationMs: Date.now() - start }); throw error; }
  });
}
before(async () => {
  await fs.mkdir(evidenceDir, { recursive: true });
  runDirectory = await fs.mkdtemp(path.join(evidenceDir, 'runtime-tests-'));
  artifact = compile();
  remote = ganache.server({ chain: { chainId: 43123, hardfork: 'shanghai' }, wallet: { deterministic: true, totalAccounts: 2 }, logging: { quiet: true } });
  await remote.listen(0, '127.0.0.1');
  const remoteUrl = `http://127.0.0.1:${remote.address().port}`;
  remoteProvider = new JsonRpcProvider(remoteUrl, 43123, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
  remoteProvider.pollingInterval = 50;
  const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, await remoteProvider.getSigner(0)).deploy(60, 300);
  const receipt = await deployed.deploymentTransaction().wait();
  const address = await deployed.getAddress();
  gateway = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    const payload = JSON.parse(body);
    for (const call of Array.isArray(payload) ? payload : [payload]) rpcMethods.push(call.method);
    const upstream = await fetch(remoteUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    response.setHeader('content-type', 'application/json');
    response.end(await upstream.text());
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${gateway.address().port}/?access_token=rpc-token-test-only`;
  externalEnv = { CHAIN_MODE: 'external', RPC_URL: endpoint, EXPECTED_CHAIN_ID: '43123', CONTRACT_ADDRESS: address, DEPLOYMENT_BLOCK: String(receipt.blockNumber), EXPECTED_RUNTIME_CODE_HASH: keccak256(await remoteProvider.getCode(address)), CHALLENGE_PERIOD: '60', INVITE_PERIOD: '300' };
  observations.remote = { chainId: 43123, address, deploymentHash: receipt.hash, deploymentBlock: receipt.blockNumber, runtimeCodeHash: externalEnv.EXPECTED_RUNTIME_CODE_HASH, transport: 'independent ganache.server over HTTP JSON-RPC on loopback', publicDeployment: false };
});
after(async () => {
  remoteProvider?.destroy();
  if (gateway) await new Promise(resolve => gateway.close(resolve));
  if (remote) await remote.close();
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(path.join(evidenceDir, 'chain-runtime-results.json'), JSON.stringify({ generatedAt: new Date().toISOString(), command: 'node --test --test-concurrency=1 tests/chain-runtime.test.mjs', observations, tests: records, summary: { passed: records.filter(r => r.status === 'passed').length, failed: records.filter(r => r.status === 'failed').length } }, null, 2) + '\n');
});

check('external connects to independent JSON-RPC without deployment, signing, account access or funding', async () => {
  const beforeBlock = await remoteProvider.getBlockNumber();
  const beforeBalance = await remoteProvider.getBalance(externalEnv.CONTRACT_ADDRESS);
  const start = rpcMethods.length;
  const runtime = await initializeChain({ env: { ...externalEnv, RUNTIME_DIR: await fresh('external-readonly') }, artifact });
  try {
    assert.ok(runtime.provider instanceof JsonRpcProvider);
    assert.equal(runtime.mode, 'external');
    assert.equal(runtime.config.walletMode, 'injected');
    assert.equal(runtime.config.domain.chainId, 43123);
    assert.equal(runtime.config.runtimeCodeHash, externalEnv.EXPECTED_RUNTIME_CODE_HASH);
    assert.equal(await remoteProvider.getBlockNumber(), beforeBlock);
    assert.equal(await remoteProvider.getBalance(externalEnv.CONTRACT_ADDRESS), beforeBalance);
    await assert.rejects(runtime.fundLocalAddress(ZeroAddress), /不提供 faucet/);
    const methods = rpcMethods.slice(start);
    assert.ok(methods.includes('eth_chainId') && methods.includes('eth_call') && methods.includes('eth_getCode'));
    assert.ok(!methods.some(method => /^(evm_|personal_|admin_|eth_send|eth_accounts|eth_sign)/.test(method)));
    observations.initializationMethods = [...new Set(methods)];
  } finally { await runtime.close(); }
});

check('external HTTP config, faucet, strict RPC allowlist and origin policy', async () => {
  const application = await createApplication({ env: { ...externalEnv, RUNTIME_DIR: await fresh('external-http') }, artifact });
  try {
    const address = await application.listen(0);
    const base = `http://127.0.0.1:${address.port}`;
    const configResponse = await fetch(`${base}/api/config`, { headers: { origin: base } });
    assert.equal(configResponse.status, 200);
    const config = await configResponse.json();
    assert.equal(config.mode, 'external');
    assert.equal(config.walletMode, 'injected');
    for (const field of ['chainId', 'address', 'abi', 'networkName', 'challengePeriod', 'invitePeriod', 'deploymentBlock', 'runtimeCodeHash', 'domain']) assert.ok(field in config, field);
    assert.ok(!JSON.stringify(config).includes('rpc-token-test-only'));
    assert.equal((await fetch(`${base}/api/faucet`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: ZeroAddress }) })).status, 403);
    const methods = ['eth_chainId', 'eth_getCode', 'admin_nodeInfo', 'personal_listAccounts', 'eth_accounts', 'eth_sendTransaction', 'eth_sign', 'evm_setAccountBalance', 'debug_traceTransaction', 'unknown_extension'];
    const start = rpcMethods.length;
    const responses = await (await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(methods.map((method, index) => ({ jsonrpc: '2.0', id: index, method, params: method === 'eth_getCode' ? [externalEnv.CONTRACT_ADDRESS, 'latest'] : [] }))) })).json();
    assert.equal(responses[0].result, '0xa873');
    assert.match(responses[1].result, /^0x[0-9a-f]+$/i);
    assert.ok(responses.slice(2).every(result => result.error.code === -32601));
    assert.ok(rpcMethods.slice(start).every(method => ['eth_chainId', 'eth_getCode'].includes(method)));
    assert.equal((await fetch(`${base}/rpc`, { method: 'POST', headers: { origin: 'https://untrusted.invalid', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    const malformed = await (await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    assert.equal(malformed.error.code, -32600);
    const emptyBatch = await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' });
    assert.equal(emptyBatch.status, 400);
    const safe = application.runtime.publicError(new Error(`failed ${endpoint} https://rpc-user:rpc-password@example.invalid/key`));
    assert.ok(!safe.includes('rpc-token-test-only') && !safe.includes('rpc-user') && !safe.includes('rpc-password'));
    observations.externalConfig = config;
  } finally { await application.close(); }
});

check('external RPC broadcasts client-signed raw transaction and exposes real receipt/log/block reads', async () => {
  const application = await createApplication({ env: { ...externalEnv, RUNTIME_DIR: await fresh('external-raw') }, artifact });
  try {
    const address = await application.listen(0);
    const base = `http://127.0.0.1:${address.port}`;
    const call = async (method, params) => (await (await fetch(`${base}/rpc`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json());
    // Only deterministic local test keys are used; no key or raw signed payload is written to results.
    const localAccount = Object.values(remote.provider.getInitialAccounts())[1];
    const wallet = new Wallet(localAccount.secretKey);
    const data = application.runtime.contract.interface.encodeFunctionData('register');
    const raw = await wallet.signTransaction({ chainId: 43123, nonce: await remoteProvider.getTransactionCount(wallet.address), to: externalEnv.CONTRACT_ADDRESS, data, gasLimit: 200000, gasPrice: 2000000000n, type: 0 });
    const sent = await call('eth_sendRawTransaction', [raw]);
    assert.match(sent.result, /^0x[0-9a-f]{64}$/i);
    const receipt = await call('eth_getTransactionReceipt', [sent.result]);
    assert.equal(receipt.result.status, '0x1');
    assert.equal(receipt.result.to.toLowerCase(), externalEnv.CONTRACT_ADDRESS.toLowerCase());
    assert.equal((await call('eth_getTransactionByHash', [sent.result])).result.hash, sent.result);
    assert.equal((await call('eth_getBlockByNumber', [receipt.result.blockNumber, false])).result.hash, receipt.result.blockHash);
    const logs = await call('eth_getLogs', [{ address: externalEnv.CONTRACT_ADDRESS, fromBlock: receipt.result.blockNumber, toBlock: receipt.result.blockNumber }]);
    assert.ok(logs.result.length > 0);
    observations.rawTransaction = { hash: sent.result, status: receipt.result.status, blockNumber: receipt.result.blockNumber, eventCount: logs.result.length, signerSource: 'deterministic local test account, key not recorded' };
  } finally { await application.close(); }
});

check('external rejects missing configuration, wrong chain, empty code, wrong runtime hash, periods and deployment block', async () => {
  const cases = [
    [{ EXPECTED_CHAIN_ID: '' }, /EXPECTED_CHAIN_ID/],
    [{ RPC_URL: '' }, /RPC_URL/],
    [{ EXPECTED_CHAIN_ID: '1' }, /chainId 不匹配/],
    [{ CONTRACT_ADDRESS: ZeroAddress }, /没有运行时代码/],
    [{ EXPECTED_RUNTIME_CODE_HASH: id('wrong-code') }, /code hash 不匹配/],
    [{ CHALLENGE_PERIOD: '61' }, /构造周期/],
    [{ INVITE_PERIOD: '301' }, /构造周期/],
    [{ DEPLOYMENT_BLOCK: '0' }, /DEPLOYMENT_BLOCK/],
    [{ DEPLOYMENT_BLOCK: String(Number(externalEnv.DEPLOYMENT_BLOCK) + 1) }, /DEPLOYMENT_BLOCK/],
  ];
  for (const [overrides, pattern] of cases) {
    const directory = await fresh('external-reject');
    await assert.rejects(initializeChain({ env: { ...externalEnv, RUNTIME_DIR: directory, ...overrides }, artifact }), pattern);
    assert.deepEqual(await fs.readdir(directory), []);
  }
});

check('external rejects correct code anchors with incompatible EIP-712 domain or stateDigest', async () => {
  const source = `pragma solidity ^0.8.30;
    contract WrongDigest {
      uint256 public constant challengePeriod = 60;
      uint256 public constant invitePeriod = 300;
      function eip712Domain() public view virtual returns(bytes1 fields,string memory name,string memory version,uint256 chainId,address verifyingContract,bytes32 salt,uint256[] memory extensions) {
        return (0x0f,"GomokuChannel","1",block.chainid,address(this),bytes32(0),new uint256[](0));
      }
      function stateDigest(bytes32,bytes memory) public pure returns(bytes32) { return bytes32(uint256(1)); }
    }
    contract WrongDomain is WrongDigest {
      function eip712Domain() public view override returns(bytes1,string memory,string memory,uint256,address,bytes32,uint256[] memory) {
        return (0x0f,"DifferentDomain","1",block.chainid,address(this),bytes32(0),new uint256[](0));
      }
    }`;
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Fixture.sol': { content: source } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  assert.ok(!(output.errors || []).some(error => error.severity === 'error'));
  for (const [name, pattern] of [['WrongDomain', /EIP-712 domain/], ['WrongDigest', /stateDigest/]]) {
    const fixture = output.contracts['Fixture.sol'][name];
    const contract = await new ContractFactory(fixture.abi, `0x${fixture.evm.bytecode.object}`, await remoteProvider.getSigner(0)).deploy();
    const receipt = await contract.deploymentTransaction().wait();
    const address = await contract.getAddress();
    await assert.rejects(initializeChain({ env: { ...externalEnv, CONTRACT_ADDRESS: address, EXPECTED_RUNTIME_CODE_HASH: keccak256(await remoteProvider.getCode(address)), DEPLOYMENT_BLOCK: String(receipt.blockNumber), RUNTIME_DIR: await fresh('external-domain-reject') }, artifact }), pattern);
  }
});

check('external rejects a real legacy eight-field channel before registration or opening despite correct hash/domain/digest', async () => {
  const source = `// SPDX-License-Identifier: MIT
    pragma solidity ^0.8.30;
    import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
    contract LegacyEightFieldChannel is EIP712 {
      enum State { None, Invited, Active, Dispute, Settled, Cancelled }
      struct Channel { address black; address white; uint256 stake; State status; uint256 deadline; bytes moves; uint8 winner; uint8 reason; }
      uint256 public immutable challengePeriod;
      uint256 public immutable invitePeriod;
      mapping(bytes32 => Channel) private channels;
      mapping(address => bool) public registered;
      uint256 public registrationCount;
      uint256 public openingCount;
      bytes32 private constant STATE_TYPEHASH = keccak256("State(bytes32 channelId,bytes32 movesHash)");
      constructor(uint256 challengePeriod_, uint256 invitePeriod_) EIP712("GomokuChannel", "1") { challengePeriod = challengePeriod_; invitePeriod = invitePeriod_; }
      function getChannel(bytes32 channelId) external view returns (Channel memory) { return channels[channelId]; }
      function stateDigest(bytes32 channelId, bytes calldata moves) external view returns (bytes32) { return _hashTypedDataV4(keccak256(abi.encode(STATE_TYPEHASH, channelId, keccak256(moves)))); }
      function register() external { require(!registered[msg.sender], "registered"); registered[msg.sender] = true; registrationCount++; }
      function openChannel(address white, uint256 stake, bytes32 salt) external returns (bytes32 channelId) {
        require(registered[msg.sender] && white != address(0) && white != msg.sender && stake > 0, "invalid");
        channelId = keccak256(abi.encode(msg.sender, white, salt));
        require(channels[channelId].status == State.None, "duplicate");
        channels[channelId] = Channel(msg.sender, white, stake, State.Invited, block.timestamp + invitePeriod, "", 0, 0);
        openingCount++;
      }
    }`;
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'Legacy.sol': { content: source } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } }), { import(importPath) {
    const resolved = path.resolve(root, 'node_modules', importPath);
    if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep)) return { error: 'Import outside local node_modules' };
    try { return { contents: readFileSync(resolved, 'utf8') }; }
    catch { return { error: `Local import not found: ${importPath}` }; }
  } }));
  assert.deepEqual((output.errors || []).filter(error => error.severity === 'error'), []);
  const fixture = output.contracts['Legacy.sol'].LegacyEightFieldChannel;
  const signer = await remoteProvider.getSigner(0);
  const legacy = await new ContractFactory(fixture.abi, `0x${fixture.evm.bytecode.object}`, signer).deploy(60, 300);
  const receipt = await legacy.deploymentTransaction().wait();
  const address = await legacy.getAddress();
  const runtimeCodeHash = keccak256(await remoteProvider.getCode(address));
  const domain = { name: 'GomokuChannel', version: '1', chainId: 43123, verifyingContract: address };
  const types = { State: [{ name: 'channelId', type: 'bytes32' }, { name: 'movesHash', type: 'bytes32' }] };
  assert.equal(await legacy.stateDigest(ZeroHash, '0x'), TypedDataEncoder.hash(domain, types, { channelId: ZeroHash, movesHash: keccak256('0x') }));
  assert.equal((await legacy.eip712Domain()).name, 'GomokuChannel');
  const misdecoded = await new Contract(address, artifact.abi, remoteProvider).getChannel(ZeroHash);
  assert.equal(misdecoded.proofDeadline, 256n, 'old bytes offset is misread as new proofDeadline');
  assert.equal(misdecoded.moves, '0x');
  const directory = await fresh('external-legacy-layout');
  const beforeBlock = await remoteProvider.getBlockNumber();
  const beforeNonce = await remoteProvider.getTransactionCount(signer.address);
  const start = rpcMethods.length;
  await assert.rejects(createApplication({ env: { ...externalEnv, CONTRACT_ADDRESS: address, DEPLOYMENT_BLOCK: String(receipt.blockNumber), EXPECTED_RUNTIME_CODE_HASH: runtimeCodeHash, RUNTIME_DIR: directory }, artifact }), /getChannel.*proofDeadline/);
  assert.equal(await remoteProvider.getBlockNumber(), beforeBlock);
  assert.equal(await remoteProvider.getTransactionCount(signer.address), beforeNonce);
  assert.equal(await legacy.registrationCount(), 0n);
  assert.equal(await legacy.openingCount(), 0n);
  assert.ok(!rpcMethods.slice(start).some(method => /^eth_send/.test(method)));
  assert.deepEqual(await fs.readdir(directory), []);
  observations.legacyLayoutRejection = { address, deploymentHash: receipt.hash, runtimeCodeHash, oldFieldCount: 8, misdecodedProofDeadline: misdecoded.proofDeadline.toString(), misdecodedMoves: misdecoded.moves, startupRejected: true, registrationCount: 0, openingCount: 0, initializationBroadcast: false };
});

check('external manifest reuses exact identity and refuses changed chain fingerprint', async () => {
  const directory = await fresh('external-reuse');
  const env = { ...externalEnv, RUNTIME_DIR: directory };
  const first = await initializeChain({ env, artifact });
  await first.close();
  const second = await initializeChain({ env, artifact });
  assert.equal(second.deployment.address, externalEnv.CONTRACT_ADDRESS);
  await second.close();
  await writeManifest(directory, manifest => { manifest.chainId = 1; });
  await assert.rejects(initializeChain({ env, artifact }), /拒绝复用.*漂移/);
  await writeManifest(directory, manifest => { manifest.chainId = 43123; manifest.chainFingerprint.genesisHash = id('unrelated-chain'); });
  await assert.rejects(initializeChain({ env, artifact }), /拒绝复用.*漂移/);
});

check('local persists creation artifact and actual immutable runtime hashes and reuses the same deployment', async () => {
  const directory = await fresh('local-reuse');
  const env = { CHAIN_MODE: 'local', RUNTIME_DIR: directory, LOCAL_BLOCK_TIME: '0' };
  const first = await initializeChain({ env, artifact });
  const originalAddress = first.deployment.address;
  const originalBlock = await first.provider.getBlockNumber();
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'deployment.json'), 'utf8'));
  assert.equal(manifest.creationArtifactHash, keccak256(artifact.bytecode));
  assert.equal(manifest.runtimeCodeHash, keccak256(await first.provider.getCode(originalAddress)));
  assert.notEqual(manifest.runtimeCodeHash, keccak256(artifact.deployedBytecode), 'immutable deployment code differs from template');
  assert.ok(manifest.chainFingerprint.genesisHash && manifest.deploymentBlockHash);
  assert.equal(first.config.mode, 'local-teaching');
  assert.equal(first.config.walletMode, 'local-test');
  await first.close();
  const second = await initializeChain({ env, artifact });
  try {
    assert.equal(second.deployment.address, originalAddress);
    assert.equal(await second.provider.getBlockNumber(), originalBlock);
    observations.localReuse = { address: originalAddress, creationArtifactHash: manifest.creationArtifactHash, runtimeCodeHash: manifest.runtimeCodeHash, deploymentBlock: manifest.deploymentBlock, reusedWithoutDeployment: true };
  } finally { await second.close(); }
  await assert.rejects(initializeChain({ env: { ...env, CHALLENGE_PERIOD: '61' }, artifact }), /拒绝复用.*周期参数/);
  await assert.rejects(initializeChain({ env, artifact: { ...artifact, bytecode: `${artifact.bytecode}00` } }), /拒绝复用.*artifact hash/);
});

check('local default mines periodic blocks so proof windows and timeouts progress without management RPC', async () => {
  const runtime = await initializeChain({ env: { CHAIN_MODE: 'local', RUNTIME_DIR: await fresh('local-periodic') }, artifact });
  try {
    const first = await runtime.provider.getBlock('latest');
    const deadline = Date.now() + 5000;
    let latest = first;
    while (latest.timestamp <= first.timestamp && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
      latest = await runtime.provider.getBlock('latest');
    }
    assert.ok(latest.number > first.number && latest.timestamp > first.timestamp);
    await assert.rejects(runtime.rpcRequest('evm_mine', []), /允许列表/);
    observations.periodicMining = { initialBlock: first.number, laterBlock: latest.number, initialTimestamp: first.timestamp, laterTimestamp: latest.timestamp, defaultBlockTime: 1 };
  } finally { await runtime.close(); }
});

check('local refuses actual on-chain runtime code drift instead of redeploying', async () => {
  const directory = await fresh('local-code-drift');
  const env = { CHAIN_MODE: 'local', RUNTIME_DIR: directory, LOCAL_BLOCK_TIME: '0' };
  const runtime = await initializeChain({ env, artifact });
  await runtime.chain.request({ method: 'evm_setAccountCode', params: [runtime.deployment.address, '0x60006000f3'] });
  await runtime.close();
  const beforeManifest = await fs.readFile(path.join(directory, 'deployment.json'), 'utf8');
  await assert.rejects(initializeChain({ env, artifact }), /拒绝复用.*code hash 不匹配/);
  assert.equal(await fs.readFile(path.join(directory, 'deployment.json'), 'utf8'), beforeManifest);
});

check('local refuses chain fingerprint drift, legacy manifest and untracked data without clearing directories', async () => {
  const directory = await fresh('local-fingerprint');
  const env = { CHAIN_MODE: 'local', RUNTIME_DIR: directory, LOCAL_BLOCK_TIME: '0' };
  const runtime = await initializeChain({ env, artifact });
  await runtime.close();
  await writeManifest(directory, manifest => { manifest.chainFingerprint.genesisHash = id('wrong-genesis'); });
  await assert.rejects(initializeChain({ env, artifact }), /拒绝复用.*chain fingerprint/);
  const legacy = await fresh('local-legacy');
  await fs.writeFile(path.join(legacy, 'deployment.json'), JSON.stringify({ address: externalEnv.CONTRACT_ADDRESS, chainId: 31337 }));
  await assert.rejects(initializeChain({ env: { RUNTIME_DIR: legacy }, artifact }), /旧 manifest.*全新的 RUNTIME_DIR/);
  assert.deepEqual(await fs.readdir(legacy), ['deployment.json']);
  const untracked = await fresh('local-untracked');
  await fs.writeFile(path.join(untracked, 'rooms.json'), '[]');
  await assert.rejects(initializeChain({ env: { RUNTIME_DIR: untracked }, artifact }), /未绑定 manifest/);
  assert.deepEqual(await fs.readdir(untracked), ['rooms.json']);
});

check('manual authorized preparation creates unsigned deployment data without a transaction or private key handling', async () => {
  const blockBefore = await remoteProvider.getBlockNumber();
  const signer = await remoteProvider.getSigner(0);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/deploy-external.mjs', '--prepare-authorized'], { cwd: root, env: { ...process.env, ...externalEnv, DEPLOYER_ADDRESS: signer.address, TEMP: path.join(evidenceDir, 'tmp'), TMP: path.join(evidenceDir, 'tmp') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  assert.equal(result.status, 0, result.stderr);
  const target = result.stdout.match(/已准备未签名部署数据：([^\r\n]+)/)?.[1];
  assert.ok(target);
  const prepared = JSON.parse(await fs.readFile(target, 'utf8'));
  assert.equal(prepared.chainId, 43123);
  assert.equal(prepared.from, signer.address);
  assert.equal(prepared.to, null);
  assert.equal(prepared.creationArtifactHash, keccak256(artifact.bytecode));
  assert.ok(prepared.data.startsWith(artifact.bytecode));
  assert.ok(BigInt(prepared.gasEstimate) > 0n);
  assert.equal(await remoteProvider.getBlockNumber(), blockBefore);
  assert.ok(!JSON.stringify(prepared).includes('rpc-token-test-only'));
  observations.manualPreparation = { path: path.relative(root, target), chainId: prepared.chainId, gasEstimate: prepared.gasEstimate, transactionBroadcast: false, privateKeysRead: false };
});

check('runtime directory must stay inside the workspace and deployment preparation requires explicit authorization', async () => {
  await assert.rejects(resolveRuntimeDirectory(process.platform === 'win32' ? 'E:\\OutsideGomoku\\forbidden' : '/outside-gomoku/forbidden'), /RUNTIME_DIR/);
  const result = spawnSync(process.execPath, ['scripts/deploy-external.mjs'], { cwd: root, encoding: 'utf8', env: { ...process.env, TEMP: path.join(evidenceDir, 'tmp'), TMP: path.join(evidenceDir, 'tmp') } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /prepare-authorized/);
  assert.ok(!result.stderr.includes('PRIVATE_KEY'));
  observations.manualPreparationGuard = { withoutFlagExitCode: result.status, signedOrBroadcast: false };
});
