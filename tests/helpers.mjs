import { Wallet, AbiCoder, keccak256, hexlify } from 'ethers';

export const blackWin = [0, 15, 1, 16, 2, 17, 3, 18, 4];
export const whiteWin = [0, 15, 1, 16, 2, 17, 3, 18, 30, 19];
export const movesHex = moves => hexlify(Uint8Array.from(moves));
export const stateTypes = { State: [{ name: 'channelId', type: 'bytes32' }, { name: 'movesHash', type: 'bytes32' }] };
export function channelId(black, white, salt) { return keccak256(AbiCoder.defaultAbiCoder().encode(['address', 'address', 'bytes32'], [black, white, salt])); }
export async function signatures(contract, id, moves, wallets, overrides = {}) {
  const network = await contract.runner.provider.getNetwork();
  const domain = { name: 'GomokuChannel', version: '1', chainId: network.chainId, verifyingContract: await contract.getAddress(), ...overrides };
  const value = { channelId: id, movesHash: keccak256(moves) };
  return Promise.all(wallets.slice(0, 2).map(wallet => wallet.signTypedData(domain, stateTypes, value)));
}
export function offlineWallets(provider) { return Object.values(provider.getInitialAccounts()).map(account => new Wallet(account.secretKey)); }
export function drawMoves() {
  const black = [], white = [];
  for (let row = 0; row < 15; row++) for (let col = 0; col < 15; col++) {
    ((Math.floor(row / 2) + col) % 2 === 0 ? black : white).push(row * 15 + col);
  }
  return black.flatMap((position, i) => i < white.length ? [position, white[i]] : [position]);
}

// Independent JS oracle used to check generated draws and every prefix in rule tests.
export function evaluateJS(moves) {
  if (moves.length > 225) throw new Error('too many moves');
  const board = Array(225).fill(0);
  let winner = 0, terminal = false;
  for (let i = 0; i < moves.length; i++) {
    const position = moves[i];
    if (terminal || position < 0 || position >= 225 || board[position]) throw new Error('illegal move');
    const player = i % 2 + 1, row = Math.floor(position / 15), col = position % 15;
    board[position] = player;
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      let count = 1;
      for (const sign of [-1, 1]) for (let step = 1; step <= 14; step++) {
        const r = row + dr * sign * step, c = col + dc * sign * step;
        if (r < 0 || r >= 15 || c < 0 || c >= 15 || board[r * 15 + c] !== player) break;
        count++;
      }
      if (count >= 5) { winner = player; terminal = true; }
    }
    if (i === 224) terminal = true;
  }
  return { winner, terminal };
}
