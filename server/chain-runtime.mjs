import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ganache from 'ganache';
import { BrowserProvider, JsonRpcProvider, Contract, ContractFactory, TypedDataEncoder, getAddress, keccak256, ZeroHash, ZeroAddress } from 'ethers';
import { compile } from '../scripts/compile.mjs';
import { STATE_TYPES } from '../shared/gomoku.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Windows confines writes to the parent workspace; containers use their actual app root.
const WORKSPACE = process.platform === 'win32' ? path.resolve(ROOT, '..') : ROOT;
const MANIFEST_VERSION = 2;
export const RPC_ALLOWLIST = new Set([
  'eth_chainId', 'net_version', 'eth_blockNumber', 'eth_call', 'eth_getLogs',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getTransactionByBlockHashAndIndex',
  'eth_getTransactionByBlockNumberAndIndex', 'eth_getTransactionCount', 'eth_getBlockByNumber',
  'eth_getBlockByHash', 'eth_getCode', 'eth_getBalance', 'eth_getStorageAt',
  'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_sendRawTransaction',
]);

export class ChainRuntimeError extends Error { constructor(message) { super(message); this.name = 'ChainRuntimeError'; } }
function fail(message) { throw new ChainRuntimeError(message); }
function integer(value, name, { positive = false } = {}) {
  if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(String(value ?? ''))) fail(`${name} 必须是明确配置的非负整数`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (positive ? 1 : 0)) fail(`${name} 超出支持范围`);
  return number;
}
function insideWorkspace(target) {
  const relative = path.relative(WORKSPACE, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export async function resolveRuntimeDirectory(value, fallback = path.join(ROOT, 'artifacts/runtime')) {
  const resolved = path.resolve(ROOT, value || fallback);
  if (!insideWorkspace(resolved) || path.relative(WORKSPACE, resolved) === '' || path.relative(ROOT, resolved) === '') fail(`RUNTIME_DIR 必须指向工作区 ${WORKSPACE} 内的专用运行目录`);
  let ancestor = resolved;
  for (;;) {
    try {
      if (!insideWorkspace(await fs.realpath(ancestor))) fail('RUNTIME_DIR 的符号链接目标位于工作区外');
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return resolved;
}
async function readManifest(directory) {
  // Do not let an existing child symlink redirect any runtime writes outside the workspace.
  await Promise.all(['deployment.json', 'rooms.json', 'chain'].map(name => resolveRuntimeDirectory(path.join(directory, name))));
  try { return JSON.parse(await fs.readFile(path.join(directory, 'deployment.json'), 'utf8')); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('deployment.json 无法解析；请保留旧数据并使用新的 RUNTIME_DIR');
  }
}
function refuseReuse(reason) { fail(`运行目录拒绝复用：${reason}。请保留旧链，设置工作区 ${WORKSPACE} 内全新的 RUNTIME_DIR；不会自动清理或迁移`); }
function checkManifest(manifest, mode, artifactHash, periods) {
  if (!manifest) return;
  if (manifest.schemaVersion !== MANIFEST_VERSION || !/^0x[0-9a-f]{64}$/i.test(manifest.creationArtifactHash || '') || !/^0x[0-9a-f]{64}$/i.test(manifest.runtimeCodeHash || '') || !manifest.chainFingerprint || !manifest.deploymentBlockHash || !Number.isSafeInteger(manifest.deploymentBlock) || !Number.isSafeInteger(manifest.chainId) || !manifest.address || (mode === 'local' && !manifest.deploymentHash)) refuseReuse('旧 manifest 缺少 creation artifact hash、实际 runtime hash 或链指纹');
  if (manifest.mode !== mode) refuseReuse('CHAIN_MODE 与 manifest 不一致');
  if (manifest.creationArtifactHash !== artifactHash) refuseReuse('creation artifact hash 与当前编译产物不一致');
  if (manifest.challengePeriod !== periods.challengePeriod || manifest.invitePeriod !== periods.invitePeriod) refuseReuse('构造周期参数发生漂移');
}
async function fingerprint(provider, chainId) {
  const [genesis, networkId] = await Promise.all([provider.getBlock(0), provider.send('net_version', [])]);
  if (!genesis?.hash || !/^\d+$/.test(String(networkId))) fail('RPC 未提供有效的创世区块或网络 ID');
  return { chainId, networkId: String(networkId), genesisHash: genesis.hash.toLowerCase() };
}
function equalFingerprint(left, right) {
  return left?.chainId === right.chainId && left?.networkId === right.networkId && left?.genesisHash === right.genesisHash;
}
export async function validateDeployment({ provider, artifact, address, chainId, deploymentBlock, expectedRuntimeCodeHash, challengePeriod, invitePeriod }) {
  const actualChainId = integer(await provider.send('eth_chainId', []), 'RPC chainId', { positive: true });
  if (actualChainId !== chainId) fail(`RPC chainId 不匹配：预期 ${chainId}，实际 ${actualChainId}`);
  const code = await provider.getCode(address);
  if (code === '0x') fail('目标合约地址没有运行时代码');
  const runtimeCodeHash = keccak256(code);
  if (runtimeCodeHash.toLowerCase() !== expectedRuntimeCodeHash.toLowerCase()) fail('目标合约 runtime code hash 不匹配');
  const [block, codeAtDeployment, priorCode] = await Promise.all([
    provider.getBlock(deploymentBlock), provider.getCode(address, deploymentBlock),
    deploymentBlock > 0 ? provider.getCode(address, deploymentBlock - 1) : Promise.resolve('0x'),
  ]);
  if (!block?.hash || codeAtDeployment === '0x' || keccak256(codeAtDeployment) !== runtimeCodeHash || priorCode !== '0x') fail('DEPLOYMENT_BLOCK 与合约代码首次出现的区块不一致（RPC 需支持历史代码查询）');
  const contract = new Contract(address, artifact.abi, provider);
  const domain = { name: 'GomokuChannel', version: '1', chainId, verifyingContract: address };
  let actualChallenge, actualInvite, domainInfo, digest;
  try {
    [actualChallenge, actualInvite, domainInfo, digest] = await Promise.all([
      contract.challengePeriod(), contract.invitePeriod(), contract.eip712Domain(), contract.stateDigest(ZeroHash, '0x'),
    ]);
  } catch { fail('合约 ABI、构造周期或 EIP-712 域接口不兼容'); }
  if (actualChallenge !== BigInt(challengePeriod) || actualInvite !== BigInt(invitePeriod)) fail('合约构造周期与 CHALLENGE_PERIOD / INVITE_PERIOD 不匹配');
  if (domainInfo.fields !== '0x0f' || domainInfo.name !== domain.name || domainInfo.version !== domain.version || domainInfo.chainId !== BigInt(chainId) || domainInfo.verifyingContract.toLowerCase() !== address.toLowerCase() || domainInfo.extensions.length !== 0) fail('合约 EIP-712 domain 不匹配');
  const expectedDigest = TypedDataEncoder.hash(domain, STATE_TYPES, { channelId: ZeroHash, movesHash: keccak256('0x') });
  if (digest !== expectedDigest) fail('合约 stateDigest 与预期 EIP-712 签名域不匹配');
  // The previous 8-field tuple can decode under the new ABI with its bytes offset
  // appearing as proofDeadline=256. Successful decoding alone is not compatibility.
  let emptyChannel;
  try { emptyChannel = await contract.getChannel(ZeroHash); }
  catch { fail('合约 getChannel ABI 不兼容：需要包含 proofDeadline 的九字段通道布局'); }
  if (emptyChannel.length !== 9 || emptyChannel.black !== ZeroAddress || emptyChannel.white !== ZeroAddress ||
      ['stake', 'status', 'deadline', 'proofDeadline', 'winner', 'reason'].some(field => emptyChannel[field] !== 0n) || emptyChannel.moves !== '0x') {
    fail('合约 getChannel 空通道布局不兼容：包括 proofDeadline 在内的所有字段必须为零');
  }
  return { contract, domain, runtimeCodeHash, deploymentBlockHash: block.hash.toLowerCase() };
}

export async function initializeChain({ env = process.env, artifact = compile() } = {}) {
  const mode = env.CHAIN_MODE || 'local';
  if (!['local', 'external'].includes(mode)) fail('CHAIN_MODE 只能为 local 或 external');
  const periods = {
    challengePeriod: integer(env.CHALLENGE_PERIOD || '60', 'CHALLENGE_PERIOD', { positive: true }),
    invitePeriod: integer(env.INVITE_PERIOD || '300', 'INVITE_PERIOD', { positive: true }),
  };
  const creationArtifactHash = keccak256(artifact.bytecode);
  let provider, chain, runtimeDir, manifest, chainId;
  try {
    if (mode === 'external') {
      chainId = integer(env.EXPECTED_CHAIN_ID, 'EXPECTED_CHAIN_ID', { positive: true });
      const deploymentBlock = integer(env.DEPLOYMENT_BLOCK, 'DEPLOYMENT_BLOCK');
      let address;
      try { address = getAddress(env.CONTRACT_ADDRESS); } catch { fail('CONTRACT_ADDRESS 必须为有效合约地址'); }
      if (!/^0x[0-9a-f]{64}$/i.test(env.EXPECTED_RUNTIME_CODE_HASH || '') || env.EXPECTED_RUNTIME_CODE_HASH.toLowerCase() === ZeroHash) fail('EXPECTED_RUNTIME_CODE_HASH 必须是非零 bytes32 operator trust anchor');
      let endpoint;
      try { endpoint = new URL(env.RPC_URL); } catch { fail('external 模式必须配置 RPC_URL'); }
      if (!['http:', 'https:'].includes(endpoint.protocol)) fail('RPC_URL 仅支持 HTTP / HTTPS');
      // Explicit eth_chainId validation below checks the remote chain; a fixed network prevents ethers logging endpoint details while retrying detection.
      provider = new JsonRpcProvider(env.RPC_URL, chainId, { staticNetwork: true, cacheTimeout: -1, batchMaxCount: 1 });
      provider.pollingInterval = 1000;
      const validated = await validateDeployment({ provider, artifact, address, chainId, deploymentBlock, expectedRuntimeCodeHash: env.EXPECTED_RUNTIME_CODE_HASH, ...periods });
      const chainFingerprint = await fingerprint(provider, chainId);
      runtimeDir = await resolveRuntimeDirectory(env.RUNTIME_DIR, path.join(ROOT, 'artifacts/runtime-external', `${chainId}-${address.toLowerCase()}`));
      manifest = await readManifest(runtimeDir);
      checkManifest(manifest, mode, creationArtifactHash, periods);
      if (manifest && (manifest.chainId !== chainId || manifest.address?.toLowerCase() !== address.toLowerCase() || manifest.runtimeCodeHash !== validated.runtimeCodeHash || manifest.deploymentBlock !== deploymentBlock || manifest.deploymentBlockHash !== validated.deploymentBlockHash || !equalFingerprint(manifest.chainFingerprint, chainFingerprint))) refuseReuse('外部链身份、运行时代码或部署区块发生漂移');
      const deployment = manifest || { schemaVersion: MANIFEST_VERSION, mode, address, chainId, deploymentBlock, deploymentBlockHash: validated.deploymentBlockHash, creationArtifactHash, runtimeCodeHash: validated.runtimeCodeHash, chainFingerprint, ...periods, createdAt: new Date().toISOString() };
      await persistNewManifest(runtimeDir, manifest, deployment);
      return makeRuntime({ mode, provider, artifact, runtimeDir, deployment, ...validated, networkName: env.NETWORK_NAME || `External EVM ${chainId}`, env });
    }
    chainId = 31337;
    runtimeDir = await resolveRuntimeDirectory(env.RUNTIME_DIR);
    manifest = await readManifest(runtimeDir);
    checkManifest(manifest, mode, creationArtifactHash, periods);
    if (!manifest) await requireEmptyDirectory(runtimeDir);
    await fs.mkdir(runtimeDir, { recursive: true });
    const blockTime = integer(env.LOCAL_BLOCK_TIME ?? '1', 'LOCAL_BLOCK_TIME');
    chain = ganache.provider({ database: { dbPath: path.join(runtimeDir, 'chain') }, chain: { chainId, networkId: chainId, hardfork: 'shanghai' }, wallet: { deterministic: true, totalAccounts: 2 }, miner: { blockGasLimit: 30000000, blockTime }, logging: { quiet: true } });
    provider = new BrowserProvider(chain, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 100;
    const chainFingerprint = await fingerprint(provider, chainId);
    if (manifest && !equalFingerprint(manifest.chainFingerprint, chainFingerprint)) refuseReuse('chain fingerprint 不一致');
    let deployment = manifest;
    if (!deployment) {
      const contract = await new ContractFactory(artifact.abi, artifact.bytecode, await provider.getSigner(0)).deploy(periods.challengePeriod, periods.invitePeriod);
      await contract.waitForDeployment();
      const receipt = await contract.deploymentTransaction().wait();
      const address = await contract.getAddress();
      const runtimeCodeHash = keccak256(await provider.getCode(address));
      deployment = { schemaVersion: MANIFEST_VERSION, mode, address, chainId, deploymentBlock: receipt.blockNumber, deploymentBlockHash: receipt.blockHash.toLowerCase(), deploymentHash: receipt.hash, deploymentGas: receipt.gasUsed.toString(), creationArtifactHash, runtimeCodeHash, chainFingerprint, ...periods, createdAt: new Date().toISOString() };
    }
    let validated;
    try {
      validated = await validateDeployment({ provider, artifact, address: deployment.address, chainId, deploymentBlock: deployment.deploymentBlock, expectedRuntimeCodeHash: deployment.runtimeCodeHash, ...periods });
      if (deployment.chainId !== chainId || validated.deploymentBlockHash !== deployment.deploymentBlockHash) refuseReuse('部署链 ID 或部署区块指纹发生漂移');
      if (deployment.deploymentHash) {
        const receipt = await provider.getTransactionReceipt(deployment.deploymentHash);
        if (!receipt || receipt.status !== 1 || receipt.contractAddress?.toLowerCase() !== deployment.address.toLowerCase() || receipt.blockHash.toLowerCase() !== deployment.deploymentBlockHash) refuseReuse('原部署交易与链状态不一致');
      }
    } catch (error) { if (manifest) refuseReuse(error.message); throw error; }
    await persistNewManifest(runtimeDir, manifest, deployment);
    return makeRuntime({ mode, chain, provider, artifact, runtimeDir, deployment, ...validated, networkName: 'Gomoku Local EVM', env });
  } catch (error) {
    if (provider) provider.destroy();
    if (chain) await chain.disconnect();
    if (mode === 'external' && !(error instanceof ChainRuntimeError)) fail('外部 RPC 初始化失败；请检查连接与节点历史查询能力（端点详情已隐藏）');
    throw error;
  }
}
async function requireEmptyDirectory(directory) {
  try { if ((await fs.readdir(directory)).length) refuseReuse('目录含有未绑定 manifest 的数据'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function persistNewManifest(directory, existing, deployment) {
  if (existing) return;
  // A local Ganache database already exists here after its first deployment.
  if (deployment.mode !== 'local') await requireEmptyDirectory(directory);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'deployment.json'), JSON.stringify(deployment, null, 2) + '\n', { flag: 'wx' });
}
function makeRuntime({ mode, chain, provider, artifact, runtimeDir, deployment, contract, domain, networkName, env }) {
  const publicError = error => {
    let message = String(error?.shortMessage || error?.message || '请求失败');
    if (env.RPC_URL) {
      message = message.split(env.RPC_URL).join('[RPC endpoint]');
      try {
        const url = new URL(env.RPC_URL);
        for (const value of [url.username, url.password]) if (value) for (const secret of new Set([value, decodeURIComponent(value)])) message = message.split(secret).join('[redacted]');
      } catch {}
    }
    return message.replace(/https?:\/\/[^\s"'<>]+/gi, '[RPC endpoint]');
  };
  return {
    mode, chain, provider, artifact, runtimeDir, deployment, contract, domain, chainId: deployment.chainId,
    config: { mode: mode === 'external' ? 'external' : 'local-teaching', walletMode: mode === 'external' ? 'injected' : 'local-test', chainId: deployment.chainId, address: deployment.address, abi: artifact.abi, networkName, challengePeriod: deployment.challengePeriod, invitePeriod: deployment.invitePeriod, deploymentBlock: deployment.deploymentBlock, runtimeCodeHash: deployment.runtimeCodeHash, deploymentHash: deployment.deploymentHash, domain, pointsInitial: 1000 },
    publicError,
    async rpcRequest(method, params = []) {
      if (!RPC_ALLOWLIST.has(method)) { const error = new Error('RPC 方法未在允许列表中'); error.code = -32601; throw error; }
      try { return mode === 'local' ? await chain.request({ method, params }) : await provider.send(method, params); }
      catch (error) { const safe = new Error(mode === 'external' ? '外部 RPC 请求失败' : publicError(error)); safe.code = typeof error.code === 'number' ? error.code : -32000; throw safe; }
    },
    async fundLocalAddress(address) {
      if (mode !== 'local') fail('external 模式不提供 faucet');
      if (await provider.getBalance(address) < 10n ** 18n) await chain.request({ method: 'evm_setAccountBalance', params: [address, '0x56bc75e2d63100000'] });
    },
    async close() { provider.destroy(); if (chain) await chain.disconnect(); },
  };
}
