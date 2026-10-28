// 五子棋 AI:三档难度。
// 思路:先用"战术优先级"(赢 > 堵五 > 造活四/双威胁 > 堵对方威胁)筛出必走的棋,
// 其余用"进攻分 + 防守分"的启发式打分;高级再叠加带剪枝的 Alpha-Beta 搜索。
import { evaluate, SIZE } from './gomoku.mjs';
import {
  LINES, LINES_OF, lineScore, classifyMove, candidateMoves, analyzePosition,
  findWinningCells, fourMakingCells,
} from './analysis.mjs';

export const LEVELS = {
  // blockFive: 能堵五时真正去堵的概率;blunder: 无视防守的概率;topK: 在前几名里随机挑
  novice: { name: '初窥门径', topK: 6, blunder: 0.25, blockFive: 0.9, depth: 0 },
  adept: { name: '渐入佳境', noise: 0.5, depth: 0 },
  master: { name: '炉火纯青', depth: 3, width: 10, timeBudgetMs: 1000 },
};

// 带种子的伪随机数生成器 mulberry32:同一种子给出同一序列,便于复现对局
export function seededRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 启发式打分 ----------
// 战术层级:数值越大越优先,加在普通分数之上
const TIER = { WIN: 1e9, BLOCK_FIVE: 1e8, UNSTOPPABLE: 1e7, DOUBLE_THREE: 5e6, BLOCK_THREAT: 1e6, NORMAL: 0 };

// 一个落点形成的棋型计数 -> 价值(含组合加成)
function threatValue(c) {
  let v = c.five * 100000 + c.openFour * 10000 + c.four * 1000
    + c.openThree * 800 + c.three * 100 + c.openTwo * 30;
  if (c.four >= 2) v += 9000;
  if (c.four && c.openThree) v += 8000;
  if (c.openThree >= 2) v += 4000;
  if (c.four && c.three) v += 500;
  return v;
}

// 越靠近天元越大,仅用于同分时的取舍
function centreBonus(p) {
  const r = Math.floor(p / SIZE), c = p % SIZE;
  return (7 - Math.max(Math.abs(r - 7), Math.abs(c - 7))) * 0.3;
}

// 对 player 在 board 上所有候选点评分,按分数从高到低返回。
// 每项: { position, score, tier, reason, my, op }
// defense=false 时忽略对方威胁(新手"走神"用)。
function rankMoves(board, player, { defense = true, radius = 2, noise = 0, rng = null } = {}) {
  const opp = 3 - player;
  const entries = candidateMoves(board, radius).map(position => ({
    position,
    my: classifyMove(board, position, player),
    op: classifyMove(board, position, opp),
  }));
  // 对方只要有一个点能下出活四(即已有活三),抢先做双活三就太慢了
  const oppUrgent = defense && entries.some(e => e.op.openFour > 0);

  for (const e of entries) {
    const { my, op } = e;
    const { tier, reason } = classifyReason(my, op, defense, oppUrgent);
    const defScore = defense ? 0.9 * threatValue(op) : 0;
    e.tier = tier;
    e.reason = reason;
    e.score = tier + threatValue(my) + defScore + centreBonus(e.position) + (rng ? rng() * noise : 0);
  }
  entries.sort((a, b) => b.score - a.score || a.position - b.position);
  return entries;
}

// 由"我方落点棋型 my / 对方在同一点的棋型 op"判定战术层级与中文理由。
// op.openFour>0 表示:对方若下在这里会成活四(即对方现有活三),此处是必堵点。
function classifyReason(my, op, defense = true, oppUrgent = false) {
  if (my.five) return { tier: TIER.WIN, reason: '立即连五' };
  if (defense && op.five) return { tier: TIER.BLOCK_FIVE, reason: '封堵对方连五' };
  if (my.openFour) return { tier: TIER.UNSTOPPABLE, reason: '形成活四' };
  if (my.four >= 2) return { tier: TIER.UNSTOPPABLE, reason: '形成双冲四' };
  if (my.four && my.openThree) return { tier: TIER.UNSTOPPABLE, reason: '形成四三' };
  if (my.openThree >= 2 && !oppUrgent) return { tier: TIER.DOUBLE_THREE, reason: '形成双活三' };
  if (defense && (op.openFour || op.four >= 2 || (op.four && op.openThree) || op.openThree >= 2)) {
    return { tier: TIER.BLOCK_THREAT, reason: op.openFour ? '封堵活三' : '封堵对方双重威胁' };
  }
  return { tier: TIER.NORMAL, reason: describeNormal(my, op, defense) };
}

// 没有战术层级时,用一句话说明这手棋的主要作用
function describeNormal(my, op, defense) {
  if (my.four) return '形成冲四';
  if (my.openThree) return '形成活三';
  if (defense && op.openThree) return '封堵活三';
  if (defense && op.four) return '封堵冲四';
  if (my.three) return '形成眠三';
  if (my.openTwo) return '发展活二';
  return '稳固中盘';
}

// 白方第一手:天元黑子的四个斜相邻点之一
const DIAGONALS = [96, 98, 126, 128];

// ---------- 搜索层(炉火纯青) ----------
// 搜索时在一份棋盘副本上落子/撤子,并增量维护每条线的得分,
// 这样叶子节点的静态评估只需扫描约 70 条线,不必重新分类。
const WINV = 1000000;
const TIMEOUT = { timeout: true };

function createState(board) {
  const b = board.slice();
  const sc = [null, new Int32Array(LINES.length), new Int32Array(LINES.length)];
  const tot = [0, 0, 0];
  for (let li = 0; li < LINES.length; li++) {
    for (const pl of [1, 2]) {
      sc[pl][li] = lineScore(b, li, pl);
      tot[pl] += sc[pl][li];
    }
  }
  return { board: b, sc, tot };
}

// 落子:只重算经过该点的 4 条线,返回撤销信息
function makeMove(st, p, player) {
  st.board[p] = player;
  const undo = [];
  for (const { line } of LINES_OF[p]) {
    undo.push(line, st.sc[1][line], st.sc[2][line]);
    for (const pl of [1, 2]) {
      const v = lineScore(st.board, line, pl);
      st.tot[pl] += v - st.sc[pl][line];
      st.sc[pl][line] = v;
    }
  }
  return undo;
}

function undoMove(st, p, undo) {
  st.board[p] = 0;
  for (let i = 0; i < undo.length; i += 3) {
    const line = undo[i];
    st.tot[1] += undo[i + 1] - st.sc[1][line];
    st.tot[2] += undo[i + 2] - st.sc[2][line];
    st.sc[1][line] = undo[i + 1];
    st.sc[2][line] = undo[i + 2];
  }
}

// 叶子静态评估(站在"轮到走棋的一方 stm"的角度):
// 己方已有四 => 下一手直接连五;己方有活三且对方没有四 => 有先手,加分。
function leafEval(st, stm) {
  const opp = 3 - stm;
  let myFour = false, oppFour = false, myThree = false;
  for (let li = 0; li < LINES.length; li++) {
    const a = st.sc[stm][li], o = st.sc[opp][li];
    if (a >= 500 && a < 100000) myFour = true;
    if (a === 400) myThree = true;
    if (o >= 500 && o < 100000) oppFour = true;
  }
  if (myFour) return 900000;
  let v = st.tot[stm] - st.tot[opp];
  if (myThree && !oppFour) v += 2500;
  return v;
}

// 带 alpha-beta 的负极大搜索;每个节点用启发式排序并只保留前 width 个候选
function negamax(ctx, player, depth, alpha, beta, ply) {
  if (ctx.deadline && ++ctx.nodes % 16 === 0 && Date.now() > ctx.deadline) throw TIMEOUT;
  if (depth === 0) return leafEval(ctx.st, player);
  const ranked = rankMoves(ctx.st.board, player);
  if (!ranked.length) return 0;
  const top = ranked[0];
  if (top.tier === TIER.WIN) return WINV - ply;
  // 对方有两个以上连五点而我方不能立即获胜:必败
  if (ranked.filter(e => e.op.five > 0).length >= 2) return -(WINV - ply - 1);
  if (top.tier === TIER.UNSTOPPABLE) return 200000 - ply;
  const moves = top.tier === TIER.BLOCK_FIVE ? [top] : ranked.slice(0, ctx.width);
  let best = -Infinity;
  for (const m of moves) {
    const undo = makeMove(ctx.st, m.position, player);
    let v;
    try { v = -negamax(ctx, 3 - player, depth - 1, -beta, -alpha, ply + 1); }
    finally { undoMove(ctx.st, m.position, undo); }
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// 根节点:迭代加深(深度 1..depth)。某一层超时则沿用上一层完整结果。
// 返回按搜索值从高到低排序的 [{ entry, value }]
function searchRoot(board, player, ranked, { depth, width, timeBudgetMs, exact = false }) {
  const roots = ranked.slice(0, width);
  const ctx = { st: createState(board), width, nodes: 0, deadline: timeBudgetMs ? Date.now() + timeBudgetMs : 0 };
  let result = roots.map(entry => ({ entry, value: 0 }));
  for (let d = 1; d <= depth; d++) {
    const current = [];
    try {
      let alpha = -Infinity;
      for (const entry of roots) {
        const undo = makeMove(ctx.st, entry.position, player);
        let v;
        try { v = -negamax(ctx, 3 - player, d - 1, -Infinity, -alpha, 1); }
        finally { undoMove(ctx.st, entry.position, undo); }
        current.push({ entry, value: v });
        // 只用严格更优的值抬高 alpha,保证并列时保持启发式顺序;
        // exact 模式不剪枝根节点,每个走法都得到精确值(suggestMoves 需要准确排序)
        if (!exact && v > alpha) alpha = v;
      }
    } catch (e) {
      if (e !== TIMEOUT) throw e;
      break;
    }
    // alpha-beta 根节点后续走法的值是上界(<=alpha),稳定排序后最佳仍在最前
    current.sort((a, b) => b.value - a.value);
    result = current;
  }
  return result;
}

// ---------- VCF:连续冲四取胜搜索 ----------
// 进攻方每一步都必须下出"四"(逼对方只能在唯一的成五点上防守),
// 如果某一步形成两个成五点(活四/双四),或最终能直接连五,则必胜。
// 比普通搜索窄得多,所以可以搜得很深。返回必胜序列的第一手,没有则返回 -1。
// ctx: { nodes, maxNodes, deadline },超限时放弃(返回 -1)。
function vcfSearch(b, atk, depth, ctx) {
  const def = 3 - atk;
  const wins = findWinningCells(b, atk);
  if (wins.length) return wins[0];                       // 现在就能连五
  if (depth === 0) return -1;
  if (findWinningCells(b, def).length) return -1;        // 对方有四在手,冲四逼不住
  if (++ctx.nodes > ctx.maxNodes || (ctx.deadline && Date.now() > ctx.deadline)) return -1;

  for (const p of fourMakingCells(b, atk)) {
    b[p] = atk;
    const w = findWinningCells(b, atk);
    let found = false;
    if (w.length >= 2) {
      found = true;                                      // 两个成五点,对方堵不住
    } else if (w.length === 1) {
      b[w[0]] = def;                                     // 对方被迫堵在唯一成五点
      found = vcfSearch(b, atk, depth - 1, ctx) >= 0;
      b[w[0]] = 0;
    }
    b[p] = 0;
    if (found) return p;
  }
  return -1;
}

const VCF_DEPTH = 8;

// player 在 board 上是否存在 VCF(不修改入参)
function hasVcf(board, player, depth, ctx) {
  return vcfSearch(board.slice(), player, depth, ctx) >= 0;
}

// ---------- 对外接口 ----------
function prepare(moves) {
  const info = evaluate(moves);
  if (info.terminal) throw new Error('对局已结束,无法选择落子');
  return { board: info.board, player: info.nextPlayer };
}

// 开局规则:黑走天元;白走天元的斜角(由 rng 在 4 个里选一个)。返回 -1 表示不适用。
function openingMove(board, moves, rng) {
  if (moves.length === 0) return 112;
  if (moves.length === 1 && moves[0] === 112) return DIAGONALS[Math.floor(rng() * DIAGONALS.length) % 4];
  return -1;
}

// 新手:按偏向前排的随机下标,在前 topK 名里挑一个
function pickWeak(list, topK, rng) {
  const k = Math.min(topK, list.length);
  const r = rng();
  return list[Math.floor(r * r * k)].position;
}

function chooseNovice(board, player, rng, params) {
  let ranked = rankMoves(board, player, { rng, noise: 3 });
  const top = ranked[0];
  if (top.tier === TIER.WIN) return top.position;                   // 能赢一定赢
  if (top.tier === TIER.BLOCK_FIVE && rng() < params.blockFive) return top.position;
  // 有一定概率"走神":完全不考虑防守,只看自己的进攻
  if (top.tier === TIER.BLOCK_FIVE || rng() < params.blunder) {
    ranked = rankMoves(board, player, { defense: false, rng, noise: 3 });
    if (ranked[0].tier === TIER.WIN) return ranked[0].position;
  }
  return pickWeak(ranked, params.topK, rng);
}

function chooseAdept(board, player, rng, params) {
  return rankMoves(board, player, { rng, noise: params.noise })[0].position;
}

function chooseMaster(board, player, params, timeBudgetMs) {
  const ranked = rankMoves(board, player);
  // 必胜/必堵直接走,不需要搜索
  if (ranked[0].tier >= TIER.UNSTOPPABLE) return ranked[0].position;
  const budget = timeBudgetMs ?? params.timeBudgetMs;
  const start = Date.now();
  const vcfCtx = () => ({ nodes: 0, maxNodes: 4000, deadline: start + budget * 0.5 });

  // 1) 自己有连续冲四的必胜序列:直接走
  const win = vcfSearch(board.slice(), player, VCF_DEPTH, vcfCtx());
  if (win >= 0) return win;

  // 2) 对方有必胜的连续冲四:只在"走完之后对方不再有 VCF"的着法里选
  let pool = ranked;
  if (hasVcf(board, 3 - player, VCF_DEPTH, vcfCtx())) {
    const b = board.slice();
    const safe = ranked.slice(0, 30).filter(e => {
      b[e.position] = player;
      const stillLoses = hasVcf(b, 3 - player, VCF_DEPTH, vcfCtx());
      b[e.position] = 0;
      return !stillLoses;
    });
    if (safe.length) pool = safe;
  }
  const left = Math.max(50, budget - (Date.now() - start));
  const res = searchRoot(board, player, pool, { depth: params.depth, width: params.width, timeBudgetMs: left });
  return res[0].entry.position;
}

export function chooseMove(moves, { level = 'adept', rng = Math.random, timeBudgetMs } = {}) {
  const params = LEVELS[level];
  if (!params) throw new Error(`未知难度: ${level}`);
  const { board, player } = prepare(moves);
  const opening = openingMove(board, moves, rng);
  if (opening >= 0) return opening;
  if (level === 'novice') return chooseNovice(board, player, rng, params);
  if (level === 'master') return chooseMaster(board, player, params, timeBudgetMs);
  return chooseAdept(board, player, rng, params);
}

// 推荐走法:返回最多 count 个 { position, score, reason },最好的在前。
export function suggestMoves(moves, count = 3, { level = 'master', rng = Math.random, timeBudgetMs } = {}) {
  const info = evaluate(moves);
  if (info.terminal) return [];
  const { board, nextPlayer: player } = info;
  if (moves.length === 0) return [{ position: 112, score: 1, reason: '占据天元' }];
  const ranked = rankMoves(board, player);
  const params = LEVELS[level] || LEVELS.master;
  if (level === 'master' && ranked[0].tier < TIER.UNSTOPPABLE) {
    const budget = timeBudgetMs ?? params.timeBudgetMs;
    const res = searchRoot(board, player, ranked, {
      depth: params.depth, width: Math.max(params.width, count), timeBudgetMs: budget, exact: true,
    });
    return res.slice(0, count).map(r => ({ position: r.entry.position, score: Math.round(r.value), reason: r.entry.reason }));
  }
  return ranked.slice(0, count).map(e => ({ position: e.position, score: Math.round(e.score), reason: e.reason }));
}

// 解释"刚下的这一手":position 须是 moves 中已下的一手(通常是最后一手)。
export function explainMove(moves, position) {
  const idx = moves.indexOf(position);
  if (idx < 0) throw new Error('该位置不在棋谱中');
  if (idx === 0) return position === 112 ? '占据天元' : '开局落子';
  const before = evaluate(moves.slice(0, idx));
  const player = before.nextPlayer;
  const my = classifyMove(before.board, position, player);
  const op = classifyMove(before.board, position, 3 - player);
  const { tier, reason } = classifyReason(my, op);
  if (tier !== TIER.NORMAL) return reason;
  const label = analyzePosition(moves.slice(0, idx + 1)).shape.label;
  return label ? `形成${label}` : reason;
}
