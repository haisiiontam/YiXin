import { getAddress, isHexString, keccak256 } from 'ethers';
import { verifyEvidence } from './evidence.mjs';
import { evaluate, fromHex, isPrefix, movesHex } from './gomoku.mjs';

const EVENTS = {
  ChannelOpened: '锁定黑方积分', ChannelJoined: '锁定白方积分',
  CheckpointChallenged: '提交争议快照', ForcedMove: '链上强制落子',
  ChannelSettled: '结算积分', ChannelCancelled: '退回邀请积分',
};
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/**
 * Read-only verification against the caller's trusted RPC. All chain facts and
 * transaction metrics come from that RPC, at one captured block. Code presence
 * and stateDigest agreement do not prove implementation identity: callers may
 * additionally pin expected.runtimeCodeHash from their trusted deployment.
 */
export async function verifyEvidenceOnchain(evidence, { provider, contract, expected = {} } = {}) {
  if (!provider || !contract) throw Error('链上核验需要可信RPC和合约实例');
  const verified = verifyEvidence(evidence, expected);
  const address = getAddress(await contract.getAddress());
  if (!same(address, evidence.domain.verifyingContract)) throw Error('核验合约与证据签名域不符');
  const network = await provider.getNetwork();
  if (network.chainId !== BigInt(evidence.domain.chainId)) throw Error('RPC链ID与证据不符');
  const head = await provider.getBlock('latest');
  if (!head || !Number.isSafeInteger(head.number)) throw Error('无法读取RPC最新区块');
  const blockTag = head.number;
  const deploymentBlock = expected.deploymentBlock === undefined ? 0 : expected.deploymentBlock;
  if (!Number.isSafeInteger(deploymentBlock) || deploymentBlock < 0 || deploymentBlock > blockTag) throw Error('部署区块须为不超过当前链高度的非负安全整数');
  const code = await provider.getCode(address, blockTag);
  if (!isHexString(code) || code === '0x') throw Error('证据目标地址没有合约代码');
  const runtimeCodeHash = keccak256(code);
  if (expected.runtimeCodeHash && !same(runtimeCodeHash, expected.runtimeCodeHash)) throw Error('链上合约代码与可信部署不符');
  const [channel, digest] = await Promise.all([
    contract.getChannel(evidence.channelId, { blockTag }),
    contract.stateDigest(evidence.channelId, movesHex(evidence.checkpoint.moves), { blockTag }),
  ]);
  if (!same(digest, verified.digest)) throw Error('合约状态摘要与证据签名域不符');
  const status = Number(channel.status);
  if (!Number.isInteger(status) || status < 1 || status > 5) throw Error('链上通道不存在或状态无效');
  if (!same(channel.black, verified.black) || !same(channel.white, verified.white) || BigInt(channel.stake) !== BigInt(evidence.stake)) throw Error('链上通道参与者或积分与证据不符');
  const chainMoves = fromHex(channel.moves);
  evaluate(chainMoves);
  if (!isPrefix(evidence.checkpoint.moves, chainMoves) && !isPrefix(chainMoves, evidence.checkpoint.moves)) throw Error('RPC链上棋谱与双签快照分叉');

  // Scan every lifecycle event for this indexed channel id. A supplied receipt
  // list can be incomplete; it never determines the resulting count or gas.
  const topics = Object.keys(EVENTS).map(name => contract.interface.getEvent(name).topicHash);
  // The deployment block is a caller-supplied trust anchor, never evidence metadata.
  // Keep each request within common RPC range limits. All pages use the same head.
  const logs = [];
  for (let fromBlock = deploymentBlock; fromBlock <= blockTag; fromBlock += 2000) {
    logs.push(...await provider.getLogs({ address, fromBlock, toBlock: Math.min(fromBlock + 1999, blockTag), topics: [topics, evidence.channelId] }));
  }
  function channelEvent(log) {
    if (!same(log.address, address)) return null;
    try {
      const parsed = contract.interface.parseLog(log);
      return parsed && Object.hasOwn(EVENTS, parsed.name) && same(parsed.args.id, evidence.channelId) ? parsed : null;
    } catch { return null; }
  }
  const discovered = new Map(), eventNames = new Set();
  for (const log of logs) {
    const event = channelEvent(log);
    if (log.removed || !event) throw Error('RPC返回了不属于本通道的事件');
    eventNames.add(event.name);
    discovered.set(log.transactionHash.toLowerCase(), log.transactionHash);
  }
  if (!discovered.size) throw Error('链上通道缺少可核验的生命周期事件');
  if (!eventNames.has('ChannelOpened') || ([2, 3, 4].includes(status) && !eventNames.has('ChannelJoined'))) throw Error('扫描范围缺少通道开通或加入事件，无法核验完整交易清单');
  if (evidence.transactions !== undefined && !Array.isArray(evidence.transactions)) throw Error('证据交易清单格式无效');
  for (const tx of evidence.transactions || []) {
    if (!isHexString(tx?.hash, 32)) throw Error('证据交易hash格式无效');
    if (!discovered.has(tx.hash.toLowerCase())) throw Error('证据交易不存在、未成功或不属于该通道：' + tx.hash);
  }
  const blocks = new Map([[head.number, head]]);
  const transactions = [];
  for (const hash of discovered.values()) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (!receipt || receipt.status !== 1 || !same(receipt.to, address) || receipt.blockNumber > blockTag) throw Error('RPC通道交易receipt无效：' + hash);
    const events = receipt.logs.map(channelEvent).filter(Boolean);
    if (!events.length) throw Error('RPC交易不属于该通道：' + hash);
    let block = blocks.get(receipt.blockNumber);
    if (!block) { block = await provider.getBlock(receipt.blockNumber); blocks.set(receipt.blockNumber, block); }
    if (!block || !same(block.hash, receipt.blockHash)) throw Error('RPC交易区块与回执不一致，请重试');
    const event = events.find(item => item.name === 'ChannelSettled') || events.at(-1);
    transactions.push({ label: EVENTS[event.name], hash: receipt.hash, gasUsed: receipt.gasUsed.toString(), blockNumber: receipt.blockNumber, timestamp: block.timestamp, transactionIndex: receipt.index });
  }
  transactions.sort((a, b) => a.blockNumber - b.blockNumber || a.transactionIndex - b.transactionIndex);
  // Catch a reorganization of the captured block before reporting a snapshot.
  const confirmedHead = await provider.getBlock(blockTag);
  if (!confirmedHead || !same(confirmedHead.hash, head.hash)) throw Error('RPC核验期间发生区块变化，请重试');
  return {
    ...verified, cryptographicOnly: false, transactions, transactionListComplete: true,
    chain: {
      verified: true, source: 'trusted-rpc', chainId: Number(network.chainId), contractAddress: address,
      blockNumber: blockTag, blockHash: head.hash, deploymentBlock, runtimeCodeHash, codeIdentityVerified: Boolean(expected.runtimeCodeHash),
      status, winner: Number(channel.winner), reason: Number(channel.reason), deadline: Number(channel.deadline), proofDeadline: Number(channel.proofDeadline ?? 0),
      moves: chainMoves, transactions: transactions.length,
    },
  };
}
