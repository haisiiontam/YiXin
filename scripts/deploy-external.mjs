// Manual preparation only. Signing and broadcast stay in the operator's external wallet.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, getAddress, keccak256 } from 'ethers';
import { compile } from './compile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--prepare-authorized')) {
  console.error('已退出：必须显式指定 --prepare-authorized。该脚本仅准备部署数据，不读取私钥、不签名、不广播。参阅 docs/external-chain.md。');
  process.exitCode = 1;
} else {
  let provider;
  try {
    const integer = (value, name, fallback) => {
      const text = value ?? fallback;
      if (!/^(0x[0-9a-f]+|[0-9]+)$/i.test(String(text ?? '')) || !Number.isSafeInteger(Number(text)) || Number(text) < 1) throw new Error(`${name} 必须为明确的正整数`);
      return Number(text);
    };
    const chainId = integer(process.env.EXPECTED_CHAIN_ID, 'EXPECTED_CHAIN_ID');
    const challengePeriod = integer(process.env.CHALLENGE_PERIOD, 'CHALLENGE_PERIOD', '60');
    const invitePeriod = integer(process.env.INVITE_PERIOD, 'INVITE_PERIOD', '300');
    const endpoint = new URL(process.env.RPC_URL);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('RPC_URL 仅支持 HTTP / HTTPS');
    const deployer = getAddress(process.env.DEPLOYER_ADDRESS);
    provider = new JsonRpcProvider(process.env.RPC_URL, chainId, { staticNetwork: true, batchMaxCount: 1, cacheTimeout: -1 });
    if (Number(BigInt(await provider.send('eth_chainId', []))) !== chainId) throw new Error('RPC chainId 与 EXPECTED_CHAIN_ID 不符');
    const artifact = compile();
    const transaction = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(challengePeriod, invitePeriod);
    const gasEstimate = await provider.estimateGas({ ...transaction, from: deployer });
    const output = {
      format: 'gomoku-unsigned-deployment/v1', createdAt: new Date().toISOString(),
      chainId, from: deployer, to: null, value: '0x0', data: transaction.data,
      gasEstimate: gasEstimate.toString(), challengePeriod, invitePeriod,
      creationArtifactHash: keccak256(artifact.bytecode), abi: artifact.abi,
      warning: 'Unsigned preparation only. Review and sign/broadcast using an independently controlled wallet. Gas estimate is not a fee quote. No source certification is implied.',
    };
    const directory = path.join(root, 'artifacts/deployment-preparations');
    await fs.mkdir(directory, { recursive: true });
    const target = path.join(directory, `unsigned-${chainId}-${Date.now()}.json`);
    await fs.writeFile(target, JSON.stringify(output, null, 2) + '\n', { flag: 'wx' });
    console.log(`已准备未签名部署数据：${target}\n未签名、未广播。请由外部钱包持有人检查网络、构造参数和费用后自行操作。`);
  } catch {
    // Provider errors may embed credential-bearing URLs; do not print them.
    console.error('部署数据准备失败：检查 RPC_URL、EXPECTED_CHAIN_ID、DEPLOYER_ADDRESS、周期参数与账户余额。端点及凭据详情已隐藏。');
    process.exitCode = 1;
  } finally { provider?.destroy(); }
}
