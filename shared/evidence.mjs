import { getAddress, isHexString, keccak256, verifyTypedData, TypedDataEncoder } from 'ethers';
import { evaluate, movesHex, STATE_TYPES, isPrefix } from './gomoku.mjs';

const DOMAIN_FIELDS = ['name', 'version', 'chainId', 'verifyingContract'];
const emptySignature = value => value === undefined || value === '' || value === '0x';

// Match the contract's EIP712 domain and ECDSA.recover(bytes) input, rather than
// accepting every optional domain field / signature representation ethers supports.
function requireContractSignature(signature) {
  if (!isHexString(signature, 65) || !['1b', '1c'].includes(signature.slice(-2).toLowerCase())) throw Error('证据签名须为合约支持的65字节标准签名（v=27/28）');
}

export function verifyEvidence(evidence, expected = {}) {
  if (evidence?.format !== 'gomoku-channel-evidence/v1') throw Error('不支持的证据格式');
  const { domain, channelId, participants, checkpoint } = evidence;
  if (!domain || Object.keys(domain).length !== DOMAIN_FIELDS.length || DOMAIN_FIELDS.some(key => !Object.hasOwn(domain, key)) || domain.name !== 'GomokuChannel' || domain.version !== '1' || !Number.isSafeInteger(Number(domain.chainId)) || Number(domain.chainId) <= 0) throw Error('证据签名域不合法，仅允许name/version/chainId/verifyingContract');
  if (!isHexString(channelId, 32)) throw Error('证据通道编号不合法');
  getAddress(domain.verifyingContract);
  if (expected.chainId !== undefined && BigInt(domain.chainId) !== BigInt(expected.chainId)) throw Error('证据来自其他链');
  if (expected.verifyingContract && getAddress(domain.verifyingContract) !== getAddress(expected.verifyingContract)) throw Error('证据来自其他合约实例');
  const black = getAddress(participants?.black), white = getAddress(participants?.white);
  if (black === white) throw Error('双方地址不能相同');
  if (!Number.isSafeInteger(evidence.stake) || evidence.stake <= 0) throw Error('证据积分无效');
  const result = evaluate(checkpoint?.moves), movesHash = keccak256(movesHex(checkpoint.moves));
  const value = { channelId, movesHash };
  const signed = checkpoint.moves.length > 0 || !emptySignature(checkpoint.sigBlack) || !emptySignature(checkpoint.sigWhite);
  if (signed) {
    requireContractSignature(checkpoint.sigBlack); requireContractSignature(checkpoint.sigWhite);
    if (verifyTypedData(domain, STATE_TYPES, value, checkpoint.sigBlack) !== black || verifyTypedData(domain, STATE_TYPES, value, checkpoint.sigWhite) !== white) throw Error('证据双签核验失败');
  }
  if (evidence.onchain?.moves?.length) {
    evaluate(evidence.onchain.moves);
    if (!isPrefix(checkpoint.moves, evidence.onchain.moves) && !isPrefix(evidence.onchain.moves, checkpoint.moves)) throw Error('文件自述链上谱与双签快照分叉');
  }
  return { valid: true, signed, cryptographicOnly: true, channelId, movesCount: checkpoint.moves.length, winner: result.winner, terminal: result.terminal, digest: TypedDataEncoder.hash(domain, STATE_TYPES, value), black, white };
}
