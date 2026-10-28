export const SIZE = 15;
export const STATE_TYPES = { State: [{ name: 'channelId', type: 'bytes32' }, { name: 'movesHash', type: 'bytes32' }] };
export const BLACK_WIN = [112, 97, 113, 98, 114, 99, 115, 100, 116];
export function evaluate(moves) {
  if (!Array.isArray(moves) || moves.length > 225) throw new Error('棋谱长度不合法');
  const board = Array(225).fill(0);
  let winner = 0, terminal = false, winningLine = [];
  for (let i = 0; i < moves.length; i++) {
    if (terminal) throw new Error('终局后不能继续落子');
    const p = moves[i];
    if (!Number.isInteger(p) || p < 0 || p >= 225) throw new Error('落子坐标越界');
    if (board[p]) throw new Error('该交叉点已有棋子');
    const player = i % 2 + 1, row = Math.floor(p / 15), col = p % 15;
    board[p] = player;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const line = [p];
      for (const sign of [-1, 1]) for (let step = 1; step < 15; step++) {
        const r = row + dr * sign * step, c = col + dc * sign * step;
        if (r < 0 || r >= 15 || c < 0 || c >= 15 || board[r * 15 + c] !== player) break;
        line.push(r * 15 + c);
      }
      if (line.length >= 5) { winner = player; terminal = true; winningLine = line; break; }
    }
    if (i === 224) terminal = true;
  }
  return { board, winner, terminal, winningLine, nextPlayer: moves.length % 2 + 1 };
}
export function isPrefix(previous, next) { return previous.length <= next.length && previous.every((p, i) => next[i] === p); }
export function requireExtension(previous, next) {
  if (next.length !== previous.length + 1 || !isPrefix(previous, next)) throw new Error('提案必须恰好扩展一手已确认棋谱');
  return evaluate(next);
}
export function movesHex(moves) { evaluate(moves); return '0x' + moves.map(p => p.toString(16).padStart(2, '0')).join(''); }
export function fromHex(hex) { return Array.from(new Uint8Array((hex.match(/[a-fA-F0-9]{2}/g) || []).map(v => parseInt(v, 16)))); }
export function relayAuthText(nonce, roomId, chainId, contractAddress) {
  return `GomokuChannel relay\n${chainId}\n${contractAddress.toLowerCase()}\n${roomId.toLowerCase()}\n${nonce}`;
}
export function metrics(moves, transactions) {
  const baselineTransactions = moves.length ? moves.length + 2 : 0;
  return { onchainTransactions: transactions.length, offchainMoves: moves.length, baselineTransactions,
    savedPercent: baselineTransactions ? Math.round((1 - transactions.length / baselineTransactions) * 1000) / 10 : 0,
    totalGas: transactions.reduce((sum, tx) => sum + BigInt(tx.gasUsed || 0), 0n).toString() };
}
