// 五子棋局面分析:棋型识别、优势评估、落子形状分类(纯函数,无 DOM)。
// 核心思路:把棋盘拆成所有长度>=5 的"线"(行/列/两种对角线),
// 把每条线转成相对某一方的数组(1=己方,0=空,2=对方或棋盘外),再在一维数组上识别棋型。
import { SIZE, evaluate } from './gomoku.mjs';

export const PATTERN_NAMES = {
  five: '连五', openFour: '活四', four: '冲四', openThree: '活三', three: '眠三', openTwo: '活二',
};

// 棋型强弱顺序(从强到弱)与评分权重
const ORDER = ['five', 'openFour', 'four', 'openThree', 'three', 'openTwo'];
const WEIGHT = { five: 100000, openFour: 5000, four: 500, openThree: 400, three: 60, openTwo: 10 };
const RANK = Object.fromEntries(ORDER.map((t, i) => [t, ORDER.length - i]));
const COLS = 'ABCDEFGHIJKLMNO';

// 预先生成全部线:每条线是按顺序排列的棋盘位置数组
function buildLines() {
  const lines = [];
  const walk = (r, c, dr, dc) => {
    const line = [];
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE) { line.push(r * SIZE + c); r += dr; c += dc; }
    if (line.length >= 5) lines.push(line);
  };
  for (let i = 0; i < SIZE; i++) { walk(i, 0, 0, 1); walk(0, i, 1, 0); }
  for (let c = 0; c < SIZE; c++) walk(0, c, 1, 1);
  for (let r = 1; r < SIZE; r++) walk(r, 0, 1, 1);
  for (let c = 0; c < SIZE; c++) walk(0, c, 1, -1);
  for (let r = 1; r < SIZE; r++) walk(r, SIZE - 1, 1, -1);
  return lines;
}
export const LINES = buildLines();

export function emptyCounts() {
  return { five: 0, openFour: 0, four: 0, openThree: 0, three: 0, openTwo: 0 };
}

// 位置标签:列 A..O,行号从上往下 1..15,例如 112 -> 'H8'
export function positionLabel(p) {
  return COLS[p % SIZE] + (Math.floor(p / SIZE) + 1);
}
export function describeMove(p) {
  return `第${Math.floor(p / SIZE) + 1}行 ${COLS[p % SIZE]}列`;
}

// 空棋盘返回天元,否则返回距任意棋子切比雪夫距离<=radius 的空位(升序)
export function candidateMoves(board, radius = 2) {
  const mark = new Uint8Array(SIZE * SIZE);
  let any = false;
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (!board[p]) continue;
    any = true;
    const r0 = Math.floor(p / SIZE), c0 = p % SIZE;
    for (let r = Math.max(0, r0 - radius); r <= Math.min(SIZE - 1, r0 + radius); r++) {
      for (let c = Math.max(0, c0 - radius); c <= Math.min(SIZE - 1, c0 + radius); c++) mark[r * SIZE + c] = 1;
    }
  }
  if (!any) return [112];
  const out = [];
  for (let p = 0; p < SIZE * SIZE; p++) if (mark[p] && !board[p]) out.push(p);
  return out;
}

// 每个棋盘位置所在的线(及在线内的下标),用于只重算落子影响到的 4 条线
export const LINES_OF = Array.from({ length: SIZE * SIZE }, () => []);
LINES.forEach((line, li) => line.forEach((p, idx) => LINES_OF[p].push({ line: li, idx })));

// ---------- 一维线上的棋型识别 ----------
// 线数组取值:1=己方,0=空,2=对方。线的两端天然就是"堵住"(窗口不会越界),
// 所以不会出现跨行连接。

// 扫描所有长度为 5 的窗口:没有对方子的窗口里,己方 5 子=连五;己方 4 子+1 空=可一步成五。
function scan(arr) {
  const out = { five: false, fiveStones: new Set(), fourCompl: new Set(), fourStones: new Set() };
  for (let s = 0; s + 5 <= arr.length; s++) {
    let mine = 0, blocked = false, empty = -1;
    for (let k = s; k < s + 5; k++) {
      if (arr[k] === 2) { blocked = true; break; }
      if (arr[k] === 1) mine++; else empty = k;
    }
    if (blocked) continue;
    if (mine === 5) {
      out.five = true;
      for (let k = s; k < s + 5; k++) out.fiveStones.add(k);
    } else if (mine === 4) {
      out.fourCompl.add(empty);
      for (let k = s; k < s + 5; k++) if (arr[k] === 1) out.fourStones.add(k);
    }
  }
  return out;
}

// 试着在每个空位落一子,看能否形成四:
// 形成"两处可成五"=活四 => 原棋型是活三;只有一处 => 眠三。
function threeCandidates(arr) {
  const open = [], closed = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== 0) continue;
    arr[i] = 1;
    const s = scan(arr);
    arr[i] = 0;
    if (s.fourCompl.size === 0) continue;
    const stones = [...s.fourStones].filter(k => k !== i);
    (s.fourCompl.size >= 2 ? open : closed).push({ i, stones });
  }
  return { open, closed };
}

// 空位 i 附近(同一段无对方子的范围内、距离<=4)的己方棋子
function nearbyStones(arr, i) {
  const out = [];
  for (const dir of [-1, 1]) {
    for (let k = i + dir, d = 1; k >= 0 && k < arr.length && d <= 4 && arr[k] !== 2; k += dir, d++) {
      if (arr[k] === 1) out.push(k);
    }
  }
  return out;
}

const lineCache = new Map();

// 一条线上"最强"的棋型:返回 { type, stones, completing }(下标都是线内下标),没有则 null。
// 结果按线内容缓存(同样的局部形状在对局中反复出现)。
export function classifyLine(arr) {
  const key = arr.join('');
  if (lineCache.has(key)) return lineCache.get(key);
  const result = classifyUncached(arr.slice());
  if (lineCache.size > 200000) lineCache.clear();
  lineCache.set(key, result);
  return result;
}

function classifyUncached(arr) {
  let mine = 0;
  for (const v of arr) if (v === 1) mine++;
  if (mine === 0) return null;

  const s = scan(arr);
  if (s.five) return { type: 'five', stones: [...s.fiveStones], completing: [] };
  if (s.fourCompl.size >= 2) return { type: 'openFour', stones: [...s.fourStones], completing: [...s.fourCompl] };
  if (s.fourCompl.size === 1) return { type: 'four', stones: [...s.fourStones], completing: [...s.fourCompl] };
  if (mine < 2) return null;

  const { open, closed } = threeCandidates(arr);
  const pack = (type, list) => ({
    type,
    stones: [...new Set(list.flatMap(c => c.stones))].sort((a, b) => a - b),
    completing: list.map(c => c.i),
  });
  if (open.length) return pack('openThree', open);
  if (closed.length) return pack('three', closed);

  // 活二:再落一子就能变成活三的空位
  const twoFill = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== 0) continue;
    arr[i] = 1;
    const isOpenThree = threeCandidates(arr).open.length > 0;
    arr[i] = 0;
    if (isOpenThree) twoFill.push(i);
  }
  if (twoFill.length === 0) return null;
  const stones = new Set(twoFill.flatMap(i => nearbyStones(arr, i)));
  return { type: 'openTwo', stones: [...stones].sort((a, b) => a - b), completing: twoFill };
}

// 把棋盘上第 li 条线转成"相对 player"的一维数组
function lineArray(board, li, player) {
  return LINES[li].map(p => (board[p] === 0 ? 0 : board[p] === player ? 1 : 2));
}

// 一条线对某方的评分(只取该线上最强棋型的权重)
export function lineScore(board, li, player) {
  const c = classifyLine(lineArray(board, li, player));
  return c ? WEIGHT[c.type] : 0;
}

// 把分差压缩到 (-1,1):tanh 平滑,700 是尺度常数。
// 活四(5000)约 ±1;单个冲四(500)约 ±0.6;早期零散活二(10)几乎为 0。
function squash(diff) {
  return Math.tanh(diff / 700);
}

// ---------- 对外:classifyMove ----------
// 统计"在 position 落 player 一子会新形成"的棋型数。
// 方法:对经过该点的 4 条线,比较落子前后线上最强棋型,只有等级上升才计数。
export function classifyMove(board, position, player) {
  if (board[position]) throw new Error('classifyMove: 位置必须为空');
  const counts = emptyCounts();
  for (const { line, idx } of LINES_OF[position]) {
    const arr = lineArray(board, line, player);
    const before = classifyLine(arr);
    arr[idx] = 1;
    const after = classifyLine(arr);
    if (after && (!before || RANK[after.type] > RANK[before.type])) counts[after.type]++;
  }
  return counts;
}

// ---------- 对外:analyzePosition ----------
function toBoard(moves) {
  const info = evaluate(moves);
  return info;
}

// 收集某方在棋盘上的所有棋型(每条线取最强的一个)
function collectThreats(board, player, out) {
  for (let li = 0; li < LINES.length; li++) {
    const c = classifyLine(lineArray(board, li, player));
    if (!c || c.type === 'openTwo') continue;
    const line = LINES[li];
    out.push({
      player,
      type: c.type,
      name: PATTERN_NAMES[c.type],
      cells: c.stones.map(i => line[i]),
      completing: c.completing.map(i => line[i]),
    });
  }
}

// 某方"落一子即形成冲四/活四"的空位集合(供 VCF 连续冲四搜索使用)。
// 做法:扫描所有长度 5 的窗口,窗口内没有对方子、恰有己方 3 子 + 2 空位时,
// 这两个空位中任意一个落子都会形成"四"。比对每个空位调用 classifyMove 快得多。
export function fourMakingCells(board, player) {
  const cells = new Set();
  for (const line of LINES) {
    for (let s = 0; s + 5 <= line.length; s++) {
      let mine = 0, blocked = false;
      for (let k = s; k < s + 5; k++) {
        const v = board[line[k]];
        if (v === 0) continue;
        if (v === player) mine++; else { blocked = true; break; }
      }
      if (blocked || mine !== 3) continue;
      for (let k = s; k < s + 5; k++) if (board[line[k]] === 0) cells.add(line[k]);
    }
  }
  return [...cells];
}

// 某方下一手能成五的空位
export function findWinningCells(board, player) {
  const cells = new Set();
  for (let li = 0; li < LINES.length; li++) {
    const s = scan(lineArray(board, li, player));
    for (const i of s.fourCompl) cells.add(LINES[li][i]);
  }
  return [...cells].sort((a, b) => a - b);
}

// 最后一手形成了什么:比较落子前后经过该点的各线最强棋型
function describeShape(board, position, player) {
  const patterns = [];
  const copy = board.slice();
  copy[position] = 0;
  const counts = classifyMove(copy, position, player);
  for (const t of ORDER) for (let k = 0; k < counts[t]; k++) patterns.push(t);
  return { player, position, patterns, label: shapeLabel(counts) };
}

// 把棋型计数翻译成简短中文
function shapeLabel(c) {
  if (c.five) return '连五';
  if (c.openFour) return '活四';
  if (c.four >= 2) return '双冲四';
  if (c.four && c.openThree) return '四三';
  if (c.four) return '冲四';
  if (c.openThree >= 2) return '双活三';
  if (c.openThree) return '活三';
  if (c.three >= 2) return '双眠三';
  if (c.three) return '眠三';
  if (c.openTwo) return '活二';
  return '';
}

export function analyzePosition(moves) {
  const info = toBoard(moves);
  const board = info.board;
  const threats = [];
  collectThreats(board, 1, threats);
  collectThreats(board, 2, threats);
  threats.sort((a, b) => RANK[b.type] - RANK[a.type]);

  let diff = 0;
  for (let li = 0; li < LINES.length; li++) diff += lineScore(board, li, 1) - lineScore(board, li, 2);
  let advantage = squash(diff);
  if (info.winner) advantage = info.winner === 1 ? 1 : -1;

  const winningCells = { 1: findWinningCells(board, 1), 2: findWinningCells(board, 2) };
  // 终局后无需再防守
  const mustBlock = info.terminal ? [] : winningCells[3 - info.nextPlayer].slice();

  let shape = { player: 0, position: -1, patterns: [], label: '' };
  if (moves.length) {
    const last = moves[moves.length - 1];
    shape = describeShape(board, last, board[last]);
  }
  return { board, advantage, threats, winningCells, mustBlock, shape };
}

// ---------- 对外:evaluationCurve ----------
// 增量计算:每落一子只重算经过该点的 4 条线的得分,总共 O(n) 次线评分。
export function evaluationCurve(moves) {
  evaluate(moves); // 校验合法性
  const board = Array(SIZE * SIZE).fill(0);
  const sb = new Array(LINES.length).fill(0);
  const sw = new Array(LINES.length).fill(0);
  let total = 0; // 黑总分 - 白总分
  const curve = [];
  moves.forEach((p, i) => {
    board[p] = (i % 2) + 1;
    let five = 0;
    for (const { line } of LINES_OF[p]) {
      const nb = lineScore(board, line, 1), nw = lineScore(board, line, 2);
      total += nb - sb[line] - (nw - sw[line]);
      sb[line] = nb; sw[line] = nw;
      if (nb >= WEIGHT.five) five = 1;
      if (nw >= WEIGHT.five) five = 2;
    }
    curve.push(five ? (five === 1 ? 1 : -1) : squash(total));
  });
  return curve;
}
