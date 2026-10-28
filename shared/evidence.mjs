import { getAddress, isHexString, keccak256, verifyTypedData, TypedDataEncoder } from 'ethers';
import { evaluate, movesHex, STATE_TYPES, isPrefix } from './gomoku.mjs';
export function verifyEvidence(evidence, expected = {}) {
  if (evidence?.format !== 'gomoku-channel-evidence/v1') throw Error('不支持的证据格式');
  const { domain, channelId, participants, checkpoint } = evidence;
  if (domain?.name !== 'GomokuChannel' || domain?.version !== '1' || !Number.isSafeInteger(Number(domain.chainId)) || Number(domain.chainId) <= 0) throw Error('证据签名域不合法');
  if (!isHexString(channelId, 32)) throw Error('证据通道编号不合法');
  getAddress(domain.verifyingContract);
  if (expected.chainId && Number(domain.chainId) !== Number(expected.chainId)) throw Error('证据来自其他链');
  if (expected.verifyingContract && domain.verifyingContract.toLowerCase() !== expected.verifyingContract.toLowerCase()) throw Error('证据来自其他合约实例');
  const black = getAddress(participants.black), white = getAddress(participants.white);
  if (black === white) throw Error('双方地址不能相同');
  if (!Number.isSafeInteger(evidence.stake) || evidence.stake <= 0) throw Error('证据积分无效');
  const result = evaluate(checkpoint.moves), movesHash = keccak256(movesHex(checkpoint.moves));
  const value = { channelId, movesHash };
  if (checkpoint.moves.length) {
    if (verifyTypedData(domain, STATE_TYPES, value, checkpoint.sigBlack) !== black || verifyTypedData(domain, STATE_TYPES, value, checkpoint.sigWhite) !== white) throw Error('证据双签核验失败');
  }
  if (evidence.onchain?.moves?.length) {
    evaluate(evidence.onchain.moves);
    if (!isPrefix(checkpoint.moves, evidence.onchain.moves) && !isPrefix(evidence.onchain.moves, checkpoint.moves)) throw Error('链上谱与双签快照分叉');
  }
  return { valid: true, cryptographicOnly: true, channelId, movesCount: checkpoint.moves.length, winner: result.winner, terminal: result.terminal, digest: TypedDataEncoder.hash(domain, STATE_TYPES, value), black, white };
}
