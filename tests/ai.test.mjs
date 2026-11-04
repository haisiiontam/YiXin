// 分析模块与 AI 的测试。结果写入 artifacts/test-results/ai-results.json(含实测耗时与胜率)。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { evaluate, BLACK_WIN } from '../shared/gomoku.mjs';
import {
  PATTERN_NAMES, analyzePosition, evaluationCurve, classifyMove, candidateMoves,
  positionLabel, describeMove,
} from '../shared/analysis.mjs';
import { LEVELS, chooseMove, suggestMoves, explainMove, seededRng } from '../shared/ai.mjs';

const results = [];
const measurements = {};
function check(name, fn) {
  test(name, async () => {
    try { await fn(); results.push({ name, status: 'passed' }); }
    catch (e) { results.push({ name, status: 'failed', error: e.message }); throw e; }
  });
}
process.on('exit', () => {
  const outputDir = process.env.TEST_RESULTS_DIR || 'artifacts/test-results';
  fs.mkdirSync(outputDir, { recursive: true });
  const passed = results.filter(t => t.status === 'passed').length;
  const failed = results.filter(t => t.status === 'failed').length;
  fs.writeFileSync(`${outputDir}/ai-results.json`, JSON.stringify({
    generatedAt: new Date().toISOString(), tests: results, measurements, summary: { passed, failed },
  }, null, 2));
});

// ---------- 辅助函数 ----------
const at = (row, col) => row * 15 + col;           // 行列(从 0 开始,行自上而下) -> 位置
const row = (r, cols) => cols.map(c => at(r, c));  // 一整行上的若干点

// 由黑/白棋子列表交替生成棋谱(黑先)。黑子数必须等于白子数或比白多 1。
// 注意:列表的顺序就是落子顺序,若有连五请把成五的那一子放在最后。
function mk(blacks, whites) {
  assert.ok(blacks.length === whites.length || blacks.length === whites.length + 1, '黑白子数不匹配');
  const moves = [];
  for (let i = 0; i < blacks.length; i++) {
    moves.push(blacks[i]);
    if (i < whites.length) moves.push(whites[i]);
  }
  evaluate(moves); // 确认棋谱合法
  return moves;
}
// 一些互不相连、远离战场的"填充"白子/黑子,用来凑手数
// (任意两子之间间隔>=5,同一条线上放不进同一个五格窗口,所以不会构成任何棋型)
const FAR_W = [at(0, 0), at(0, 5), at(0, 10), at(14, 14), at(14, 9)];
const FAR_B = [at(14, 0), at(14, 5), at(0, 14), at(12, 14)];

const has = (a, p) => a.includes(p);
const threatOf = (analysis, player, type) => analysis.threats.find(t => t.player === player && t.type === type);

// 在 board 上做一次 AI 对局:levels[0] 执黑,levels[1] 执白,返回 { winner, moves }
function selfPlay(blackLevel, whiteLevel, seed) {
  const rng = seededRng(seed);
  const moves = [];
  for (;;) {
    const info = evaluate(moves);
    if (info.terminal) return { winner: info.winner, moves };
    const level = moves.length % 2 === 0 ? blackLevel : whiteLevel;
    const p = chooseMove(moves, { level, rng });
    assert.equal(info.board[p], 0, `${level} 走在了已有棋子的位置 ${p}`);
    moves.push(p);
  }
}

// ================= 分析模块 =================
// 约定:下面的图中 X=黑 O=白 .=空,行列均从 0 开始;"远处白子"互相隔 5 格以上,不构成任何棋型。

check('PATTERN_NAMES 与坐标标签符合约定', () => {
  assert.deepEqual(PATTERN_NAMES, { five: '连五', openFour: '活四', four: '冲四', openThree: '活三', three: '眠三', openTwo: '活二' });
  assert.equal(positionLabel(0), 'A1');
  assert.equal(positionLabel(112), 'H8');
  assert.equal(positionLabel(224), 'O15');
  assert.equal(describeMove(112), '第8行 H列');
  assert.equal(describeMove(at(0, 14)), '第1行 O列');
});

check('识别连五:黑在第7行 d..h 连成五子', () => {
  // 第7行: . . . X X X X X . .   (列3..7)
  const moves = mk(row(7, [3, 4, 5, 6, 7]), FAR_W.slice(0, 4));
  const a = analyzePosition(moves);
  const t = threatOf(a, 1, 'five');
  assert.ok(t, '应报告连五');
  assert.equal(t.name, '连五');
  assert.deepEqual([...t.cells].sort((x, y) => x - y), row(7, [3, 4, 5, 6, 7]));
  assert.ok(a.advantage >= 0.99);
  assert.deepEqual(a.mustBlock, []);
});

check('识别活四:两端皆空,completing 为两端', () => {
  // 第7行: . . X X X X . .  (列5..8),列4与列9为空
  const moves = mk(row(7, [5, 6, 7, 8]), FAR_W.slice(0, 3)); // 轮到白
  const a = analyzePosition(moves);
  const t = threatOf(a, 1, 'openFour');
  assert.ok(t);
  assert.deepEqual([...t.completing].sort((x, y) => x - y), [at(7, 4), at(7, 9)]);
  assert.deepEqual(a.winningCells[1], [at(7, 4), at(7, 9)]);
  assert.deepEqual(a.winningCells[2], []);
  // 白棋走,必须堵的就是这两个点(无法同时堵住,但仍应列出)
  assert.deepEqual(a.mustBlock, [at(7, 4), at(7, 9)]);
  assert.ok(a.advantage > 0.8);
});

check('识别冲四:一端被白子封住,只剩一个成五点', () => {
  // 第7行: . O X X X X . .   白(7,3) 黑(7,4..7),只有(7,8)能成五
  const moves = mk(row(7, [4, 5, 6, 7]), [at(7, 3), FAR_W[0], FAR_W[1]]);
  const a = analyzePosition(moves);
  const t = threatOf(a, 1, 'four');
  assert.ok(t, '应报告冲四');
  assert.equal(threatOf(a, 1, 'openFour'), undefined);
  assert.deepEqual(t.completing, [at(7, 8)]);
  assert.deepEqual(a.mustBlock, [at(7, 8)]);
});

check('识别跳冲四 X X . X X', () => {
  const moves = mk(row(7, [4, 5, 7, 8]), FAR_W.slice(0, 3));
  const a = analyzePosition(moves);
  const t = threatOf(a, 1, 'four');
  assert.ok(t);
  assert.deepEqual(t.completing, [at(7, 6)]);
  assert.deepEqual(a.mustBlock, [at(7, 6)]);
});

check('识别活三:XXX 两端留空,completing 为能升级成活四的点', () => {
  // 第7行: . . . X X X . . .  (列6..8),列5、9为空且更外侧也空
  const moves = mk(row(7, [6, 7, 8]), FAR_W.slice(0, 3));
  const a = analyzePosition(moves);
  const t = threatOf(a, 1, 'openThree');
  assert.ok(t, '应报告活三');
  assert.deepEqual([...t.cells].sort((x, y) => x - y), row(7, [6, 7, 8]));
  assert.ok(has(t.completing, at(7, 5)) && has(t.completing, at(7, 9)));
  assert.deepEqual(a.winningCells[1], []);   // 活三还不能一步成五
  assert.deepEqual(a.mustBlock, []);
});

check('识别眠三:一端被白子封住的 XXX', () => {
  // 第7行: . O X X X . . .  白(7,5),黑(7,6..8)
  const moves = mk(row(7, [6, 7, 8]), [at(7, 5), FAR_W[0], FAR_W[1]]);
  const a = analyzePosition(moves);
  assert.ok(threatOf(a, 1, 'three'), '应报告眠三');
  assert.equal(threatOf(a, 1, 'openThree'), undefined);
  assert.equal(threatOf(a, 1, 'four'), undefined);
});

check('棋盘边缘不会把相邻行的棋子"跨行"连起来', () => {
  // 展开成一维时 (0,13)(0,14)(1,0)(1,1)(1,2) 是连续下标 13..17,但它们并不相连
  const wrapFive = mk([at(0, 13), at(0, 14), at(1, 0), at(1, 1), at(1, 2)],
    [at(14, 14), at(14, 9), at(14, 4), at(9, 9)]);
  const a = analyzePosition(wrapFive);
  assert.equal(evaluate(wrapFive).terminal, false);
  for (const t of ['five', 'openFour', 'four']) assert.equal(threatOf(a, 1, t), undefined, `不应有${t}`);
  // 四个"跨行"棋子:若误判会得到冲/活四,正确结果是没有任何成五点
  const wrapFour = mk([at(0, 12), at(0, 13), at(0, 14), at(1, 0)], [at(14, 14), at(14, 9), at(14, 4), at(9, 9)]);
  const b = analyzePosition(wrapFour);
  assert.deepEqual(b.winningCells[1], []);
  for (const t of ['five', 'openFour', 'four']) assert.equal(threatOf(b, 1, t), undefined);
  // 同理:右边缘(7,13)(7,14) 与下一行(8,0)(8,1)(8,2) 也不相连
  assert.deepEqual(analyzePosition(mk([at(7, 13), at(7, 14), at(8, 0), at(8, 1)],
    [at(14, 14), at(14, 9), at(14, 4), at(1, 7)])).winningCells[1], []);
});

check('优势值:空盘为0,方向正确,四越强越接近±1', () => {
  assert.equal(analyzePosition([]).advantage, 0);
  const three = analyzePosition(mk(row(7, [6, 7, 8]), FAR_W.slice(0, 3))).advantage;
  const four = analyzePosition(mk(row(7, [5, 6, 7, 8]), FAR_W.slice(0, 3))).advantage;
  const five = analyzePosition(mk(row(7, [4, 5, 6, 7, 8]), FAR_W.slice(0, 4))).advantage;
  assert.ok(three > 0 && three < four, `活三(${three}) < 活四(${four})`);
  assert.ok(four > 0.8 && four < 1);
  assert.ok(five >= 0.99);
  // 白方同样的形状 -> 负值;白先手需要黑多走一步(黑子散落远处)
  const wFour = analyzePosition(mk(FAR_B.slice(0, 4), row(7, [5, 6, 7, 8]))).advantage;
  assert.ok(wFour < -0.8, `白活四应 < -0.8,实际 ${wFour}`);
  const wFive = analyzePosition(mk([...FAR_B.slice(0, 4), at(8, 0)], row(7, [4, 5, 6, 7, 8]))).advantage;
  assert.ok(wFive <= -0.99);
  // 双方棋型对称时优势接近 0
  const sym = analyzePosition(mk([...row(7, [6, 7]), at(14, 0)], [...row(9, [6, 7]), at(14, 14)])).advantage;
  assert.ok(Math.abs(sym) < 0.2);
});

check('classifyMove:双活三与四三的棋型计数,且不改动棋盘', () => {
  // 双活三(黑下 H8=(7,7)):
  //   第5行 . . . . . . . X . .        竖向 (5,7)(6,7) + 落点 (7,7)
  //   第6行 . . . . . . . X . .
  //   第7行 . . . . . X X * . .        横向 (7,5)(7,6) + 落点 (7,7)
  const dt = mk([at(7, 5), at(7, 6), at(5, 7), at(6, 7)], FAR_W.slice(0, 4));
  const board = evaluate(dt).board;
  const snapshot = board.slice();
  const c = classifyMove(board, at(7, 7), 1);
  assert.equal(c.openThree, 2);
  assert.equal(c.four + c.openFour + c.five, 0);
  assert.deepEqual(board, snapshot);
  assert.throws(() => classifyMove(board, at(7, 5), 1), /为空/);
  // 四三:横向 O X X X * (白在(7,3)封住左端)=冲四;竖向 (5,7)(6,7)+(7,7)=活三
  const ft = mk([at(7, 4), at(7, 5), at(7, 6), at(5, 7), at(6, 7)], [at(7, 3), ...FAR_W.slice(0, 4)]);
  const f = classifyMove(evaluate(ft).board, at(7, 7), 1);
  assert.equal(f.four, 1);
  assert.equal(f.openThree, 1);
  assert.equal(f.openFour, 0);
  // 同一个点对白方没有任何棋型(白子散落)
  const w = classifyMove(evaluate(ft).board, at(7, 7), 2);
  assert.equal(w.openThree + w.four + w.openFour + w.five, 0);
  // 成五
  const win = mk(row(7, [3, 4, 5, 6]), FAR_W.slice(0, 4));
  assert.equal(classifyMove(evaluate(win).board, at(7, 7), 1).five, 1);
});

check('shape:最后一手形成的棋型与中文标签', () => {
  const dt = mk([at(7, 5), at(7, 6), at(5, 7), at(6, 7), at(7, 7)], FAR_W.slice(0, 4));
  const s = analyzePosition(dt).shape;
  assert.equal(s.player, 1);
  assert.equal(s.position, at(7, 7));
  assert.deepEqual(s.patterns, ['openThree', 'openThree']);
  assert.equal(s.label, '双活三');
  const ft = mk([at(7, 4), at(7, 5), at(7, 6), at(5, 7), at(6, 7), at(7, 7)], [at(7, 3), ...FAR_W.slice(0, 4)]);
  assert.equal(analyzePosition(ft).shape.label, '四三');
  assert.deepEqual(analyzePosition([]).shape, { player: 0, position: -1, patterns: [], label: '' });
});

check('candidateMoves:空盘为天元,否则为距棋子 <=radius 的空位', () => {
  assert.deepEqual(candidateMoves(Array(225).fill(0)), [112]);
  const corner = Array(225).fill(0); corner[0] = 1;
  assert.deepEqual(candidateMoves(corner, 1), [1, 15, 16]);
  assert.equal(candidateMoves(corner, 2).length, 8);          // 角上 3x3 去掉自己
  const mid = Array(225).fill(0); mid[112] = 1;
  const c2 = candidateMoves(mid, 2);
  assert.equal(c2.length, 24);
  assert.ok(!c2.includes(112));
  assert.ok(c2.includes(at(5, 5)) && c2.includes(at(9, 9)) && !c2.includes(at(4, 4)));
});

// 构造一个 225 手、双方都没有五连的满盘:颜色 = ((列>>1)+行)%2,横竖斜连续同色最多 2 个
function fullDrawMoves() {
  const blacks = [], whites = [];
  for (let r = 0; r < 15; r++) for (let c = 0; c < 15; c++) (((c >> 1) + r) % 2 === 0 ? blacks : whites).push(at(r, c));
  return mk(blacks, whites);
}

check('evaluationCurve:长度、与 analyzePosition 一致、225 手 <400ms', () => {
  const draw = fullDrawMoves();
  assert.equal(draw.length, 225);
  assert.equal(evaluate(draw).winner, 0);
  const t0 = performance.now();
  const curve = evaluationCurve(draw);
  const ms = performance.now() - t0;
  measurements.evaluationCurve225Ms = Math.round(ms * 10) / 10;
  assert.equal(curve.length, 225);
  assert.ok(ms < 400, `曲线耗时 ${ms}ms`);
  for (const i of [0, 1, 9, 50, 120, 224]) {
    assert.ok(Math.abs(curve[i] - analyzePosition(draw.slice(0, i + 1)).advantage) < 1e-9, `第 ${i} 手不一致`);
  }
  assert.ok(curve.every(v => v >= -1 && v <= 1));
  // 黑方连五的对局:最后一点为 +1
  const win = evaluationCurve(BLACK_WIN);
  assert.equal(win.length, BLACK_WIN.length);
  assert.equal(win[win.length - 1], 1);
  assert.deepEqual(evaluationCurve([]), []);
});

// ================= AI:基本战术 =================
const ALL_LEVELS = ['novice', 'adept', 'master'];

check('LEVELS 名称', () => {
  assert.equal(LEVELS.novice.name, '初窥门径');
  assert.equal(LEVELS.adept.name, '渐入佳境');
  assert.equal(LEVELS.master.name, '炉火纯青');
});

check('首手规则:黑走天元,白走天元的斜角(rng 决定)', () => {
  for (const level of ALL_LEVELS) {
    assert.equal(chooseMove([], { level, rng: seededRng(1) }), 112);
    const seen = new Set();
    for (let s = 1; s <= 40; s++) seen.add(chooseMove([112], { level, rng: seededRng(s) }));
    for (const p of seen) assert.ok([at(6, 6), at(6, 8), at(8, 6), at(8, 8)].includes(p), `${level} 白首手 ${p}`);
    assert.ok(seen.size >= 2, '40 个种子应覆盖多个斜角');
  }
});

check('终局或满盘时 chooseMove / suggestMoves 的行为', () => {
  for (const level of ALL_LEVELS) {
    assert.throws(() => chooseMove(BLACK_WIN, { level }));
    assert.throws(() => chooseMove(fullDrawMoves(), { level }));
  }
  assert.deepEqual(suggestMoves(BLACK_WIN, 3), []);
  assert.deepEqual(suggestMoves(fullDrawMoves(), 3), []);
  assert.throws(() => chooseMove([], { level: 'nonexistent' }));
});

// 局面 A:黑、白都有四,轮到黑。黑应直接连五而不是去堵白。
//   第7行  . . X X X X . .    黑 (7,3..6),成五点 (7,2) 或 (7,7)
//   第10行 . . O O O O . .    白 (10,3..6),成五点 (10,2) 或 (10,7)
const POS_WIN_OVER_BLOCK = mk(row(7, [3, 4, 5, 6]), row(10, [3, 4, 5, 6]));

check('能赢就赢:即使对方也有四,各难度都选择连五', () => {
  for (const level of ALL_LEVELS) {
    for (let s = 1; s <= 20; s++) {
      const p = chooseMove(POS_WIN_OVER_BLOCK, { level, rng: seededRng(s) });
      assert.ok([at(7, 2), at(7, 7)].includes(p), `${level} 选了 ${positionLabel(p)}`);
    }
  }
  const sug = suggestMoves(POS_WIN_OVER_BLOCK, 3);
  assert.equal(sug[0].reason, '立即连五');
});

// 局面 B:白到走,黑有冲四(白(7,3)封左端),白必须下 (7,8)。
//   第7行  . O X X X X . .    白 (7,3),黑 (7,4..7)
const POS_BLOCK_FIVE = mk([...row(7, [4, 5, 6, 7]), FAR_B[0]], [at(7, 3), ...FAR_W.slice(0, 3)]);

check('堵五:adept/master 必堵,novice 在 200 个种子中堵住的比例 >=85%', () => {
  assert.equal(evaluate(POS_BLOCK_FIVE).nextPlayer, 2);
  for (const level of ['adept', 'master']) {
    for (let s = 1; s <= 30; s++) assert.equal(chooseMove(POS_BLOCK_FIVE, { level, rng: seededRng(s) }), at(7, 8));
  }
  let blocked = 0;
  const N = 200;
  for (let s = 1; s <= N; s++) if (chooseMove(POS_BLOCK_FIVE, { level: 'novice', rng: seededRng(s) }) === at(7, 8)) blocked++;
  measurements.noviceBlockFiveRate = blocked / N;
  assert.ok(blocked / N >= 0.85, `novice 堵五比例 ${blocked / N}`);
  assert.equal(suggestMoves(POS_BLOCK_FIVE, 1)[0].reason, '封堵对方连五');
});

// 局面 C:黑有跳冲四 X X . X X(成五点唯一 (7,6)),白到走。
check('堵跳四:唯一成五点必须被封堵', () => {
  const pos = mk([...row(7, [4, 5, 7, 8]), FAR_B[0]], FAR_W.slice(0, 4));
  assert.equal(evaluate(pos).nextPlayer, 2);
  for (const level of ['adept', 'master']) assert.equal(chooseMove(pos, { level, rng: seededRng(3) }), at(7, 6));
});

// 局面 D:白有开放的活三 O O O,黑到走且自己没有威胁:应封堵端点(外延一格也算合理)。
//   第7行  . . . O O O . . .   白 (7,6..8)
const POS_BLOCK_OPEN3 = mk(FAR_B.slice(0, 3), row(7, [6, 7, 8]));

check('堵活三:adept/master 在活三的端点附近落子', () => {
  assert.equal(evaluate(POS_BLOCK_OPEN3).nextPlayer, 1);
  for (const level of ['adept', 'master']) {
    const p = chooseMove(POS_BLOCK_OPEN3, { level, rng: seededRng(5) });
    assert.ok([at(7, 5), at(7, 9), at(7, 4), at(7, 10)].includes(p), `${level} 选了 ${positionLabel(p)}`);
  }
  assert.equal(suggestMoves(POS_BLOCK_OPEN3, 1)[0].reason, '封堵活三');
});

// 局面 E:黑有活三,黑到走 -> 应做成活四((7,5) 或 (7,9));活四之后对方无法同时堵两端。
const POS_MAKE_OPEN4 = mk(row(7, [6, 7, 8]), FAR_W.slice(0, 3));

check('能做活四就做活四', () => {
  for (const level of ['adept', 'master']) {
    const p = chooseMove(POS_MAKE_OPEN4, { level, rng: seededRng(7) });
    assert.ok([at(7, 5), at(7, 9)].includes(p), `${level} 选了 ${positionLabel(p)}`);
  }
  const sug = suggestMoves(POS_MAKE_OPEN4, 2);
  assert.equal(sug[0].reason, '形成活四');
  assert.ok(sug[0].score >= sug[1].score);
});

// 局面 F:黑可一手形成双活三。
//   第5行 . . . . . . . X     (5,7)
//   第6行 . . . . . . . X     (6,7)
//   第7行 . . . . . X X * ... (7,5)(7,6) -> 落 (7,7)
check('双活三:suggestMoves 的理由为"形成双活三"', () => {
  const pos = mk([at(7, 5), at(7, 6), at(5, 7), at(6, 7)], FAR_W.slice(0, 4));
  const sug = suggestMoves(pos, 3, { level: 'adept' });
  assert.equal(sug[0].position, at(7, 7));
  assert.equal(sug[0].reason, '形成双活三');
});

// ================= AI:模糊测试、确定性、接口性质 =================
// 用带种子的随机合法对弈生成中盘局面(不允许随机走出终局)
function randomPosition(seed, length) {
  const rng = seededRng(seed);
  const moves = [];
  let guard = 0;
  while (moves.length < length && guard++ < 1000) {
    const info = evaluate(moves);
    const cand = candidateMoves(info.board, 2);
    const p = cand[Math.floor(rng() * cand.length)];
    // 如果这一手会直接终局,就换一个点重抽;若只剩这一个点则停止
    if (evaluate([...moves, p]).terminal) {
      if (cand.length === 1) break;
      continue;
    }
    moves.push(p);
  }
  return moves;
}

check('模糊测试:200 个随机中盘局面,三档难度都只走合法空位', () => {
  let n = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const moves = randomPosition(seed, 8 + (seed % 30));
    const info = evaluate(moves);
    if (info.terminal) continue;
    const level = ALL_LEVELS[seed % 3];
    const p = chooseMove(moves, { level, rng: seededRng(seed) });
    assert.ok(Number.isInteger(p) && p >= 0 && p < 225, `非法坐标 ${p}`);
    assert.equal(info.board[p], 0, `${level} 走在已有棋子处 (种子 ${seed})`);
    evaluate([...moves, p]);
    n++;
  }
  measurements.fuzzPositions = n;
  assert.ok(n >= 190);
});

check('确定性:相同 seededRng 得到相同走法;seededRng 本身可复现', () => {
  const a = seededRng(42), b = seededRng(42), c = seededRng(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  assert.ok(sa.every(v => v >= 0 && v < 1));
  for (const level of ALL_LEVELS) {
    for (const seed of [3, 9, 27]) {
      const moves = randomPosition(seed, 20);
      const p1 = chooseMove(moves, { level, rng: seededRng(7) });
      const p2 = chooseMove(moves, { level, rng: seededRng(7) });
      assert.equal(p1, p2, `${level} 不确定`);
    }
  }
  // 整局对弈完全相同
  assert.deepEqual(selfPlay('adept', 'novice', 5).moves, selfPlay('adept', 'novice', 5).moves);
});

check('suggestMoves:不修改入参,数量/排序/理由正确', () => {
  const moves = randomPosition(11, 24);
  const copy = [...moves];
  const sug = suggestMoves(moves, 3, { level: 'master' });
  assert.deepEqual(moves, copy);
  assert.ok(sug.length >= 1 && sug.length <= 3);
  const board = evaluate(moves).board;
  const seen = new Set();
  for (let i = 0; i < sug.length; i++) {
    assert.equal(board[sug[i].position], 0);
    assert.ok(!seen.has(sug[i].position)); seen.add(sug[i].position);
    assert.ok(typeof sug[i].reason === 'string' && sug[i].reason.length > 0);
    if (i) assert.ok(sug[i - 1].score >= sug[i].score, '应按分数从高到低');
  }
  assert.equal(suggestMoves(moves, 1, { level: 'adept' }).length, 1);
  assert.ok(suggestMoves(moves, 5, { level: 'adept' }).length <= 5);
  assert.deepEqual(moves, copy);
});

check('explainMove:能解释刚下的一手', () => {
  assert.equal(explainMove([112], 112), '占据天元');
  const dt = mk([at(7, 5), at(7, 6), at(5, 7), at(6, 7), at(7, 7)], FAR_W.slice(0, 4));
  assert.equal(explainMove(dt, at(7, 7)), '形成双活三');
  assert.equal(explainMove(BLACK_WIN, 116), '立即连五');
  const block = [...POS_BLOCK_FIVE, at(7, 8)];
  assert.equal(explainMove(block, at(7, 8)), '封堵对方连五');
  assert.throws(() => explainMove([112], 5));
});

// ================= 全局自博弈 =================
const GAMES = 12; // 每种配置、每种执子颜色各 12 局,共 4 组 = 48 局

// 让 strong 对 novice 各执黑白 GAMES 局;逐局重放校验合法;返回胜率
function matchVsNovice(strong) {
  let wins = 0, total = 0, longest = 0;
  for (const strongIsBlack of [true, false]) {
    for (let g = 1; g <= GAMES; g++) {
      const seed = 1000 * (strongIsBlack ? 1 : 2) + g;
      const { winner, moves } = strongIsBlack ? selfPlay(strong, 'novice', seed) : selfPlay('novice', strong, seed);
      const final = evaluate(moves);          // 重放:任何一步非法都会抛错
      assert.equal(final.terminal, true);
      const strongColour = strongIsBlack ? 1 : 2;
      if (winner === strongColour) wins++;
      total++;
      longest = Math.max(longest, moves.length);
    }
  }
  return { wins, total, rate: wins / total, longest };
}

check('自博弈:master 对 novice(黑白各 12 局)胜率 >= 90%,且全部合法收官', () => {
  const t0 = performance.now();
  const r = matchVsNovice('master');
  measurements.masterVsNovice = { ...r, ms: Math.round(performance.now() - t0) };
  assert.ok(r.rate >= 0.9, `master 胜率 ${r.rate}`);
});

check('自博弈:adept 对 novice(黑白各 12 局)胜率 >= 75%,且全部合法收官', () => {
  const t0 = performance.now();
  const r = matchVsNovice('adept');
  measurements.adeptVsNovice = { ...r, ms: Math.round(performance.now() - t0) };
  assert.ok(r.rate >= 0.75, `adept 胜率 ${r.rate}`);
});

// 说明:白方对 adept 常被拖入 225 手和棋(双方都守得住),所以这里不要求 master 执白必胜,
// 只要求:执黑全胜,且总体上 master 赢的局数多于 adept。实测数字写入 JSON。
check('自博弈:master 对 adept(各执黑白 8 局)执黑全胜,总胜局多于 adept', () => {
  const stat = { blackWins: 0, whiteWins: 0, adeptWins: 0, draws: 0, games: 16 };
  for (const masterBlack of [true, false]) {
    for (let g = 1; g <= 8; g++) {
      const { winner, moves } = masterBlack ? selfPlay('master', 'adept', 77 + g) : selfPlay('adept', 'master', 88 + g);
      assert.equal(evaluate(moves).terminal, true);
      if (winner === 0) stat.draws++;
      else if (winner === (masterBlack ? 1 : 2)) stat[masterBlack ? 'blackWins' : 'whiteWins']++;
      else stat.adeptWins++;
    }
  }
  measurements.masterVsAdept = stat;
  assert.equal(stat.blackWins, 8, `master 执黑应全胜,实际 ${stat.blackWins}/8`);
  assert.ok(stat.blackWins + stat.whiteWins > stat.adeptWins, JSON.stringify(stat));
});

// ================= 性能 =================
// 一个约 30 手的中盘:种子随机贴边对弈,再保证没有终局
check('性能:各难度在 30 手中盘的单步耗时,master < 1500ms,且 timeBudgetMs 生效', () => {
  const moves = randomPosition(2024, 30);
  assert.equal(moves.length, 30);
  const timing = {};
  for (const level of ALL_LEVELS) {
    chooseMove(moves, { level, rng: seededRng(1) }); // 预热
    const t0 = performance.now();
    chooseMove(moves, { level, rng: seededRng(1) });
    timing[level] = Math.round((performance.now() - t0) * 10) / 10;
  }
  measurements.chooseMoveMs30Stones = timing;
  assert.ok(timing.master < 1500, `master ${timing.master}ms`);
  // 极小预算:仍须返回合法着法,且耗时明显小于默认预算
  const t1 = performance.now();
  const p = chooseMove(moves, { level: 'master', timeBudgetMs: 5 });
  const ms = performance.now() - t1;
  measurements.masterTimeBudget5msActualMs = Math.round(ms * 10) / 10;
  assert.equal(evaluate(moves).board[p], 0);
  assert.ok(ms < 300, `预算 5ms 实际 ${ms}ms`);
});
