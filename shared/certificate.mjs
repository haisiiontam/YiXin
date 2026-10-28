// 对局证书生成器：把通道证据 JSON 渲染为独立 SVG（无外链、无脚本），纯 JavaScript、无额外依赖。
import { verifyEvidence } from './evidence.mjs';
import { evaluate, SIZE } from './gomoku.mjs';

// ---------- 版面常量（画布 840 x 1188） ----------
const WIDTH = 840, HEIGHT = 1188;
const CELL = 34;                          // 棋盘格距
const BOARD_SPAN = CELL * (SIZE - 1);     // 476：首末线距离
const BOARD_X = (WIDTH - BOARD_SPAN) / 2; // 棋盘左上角 x（居中）
const BOARD_Y = 290;                      // 棋盘左上角 y
const STONE_R = 15;                       // 棋子半径
const STAR_POINTS = [[3, 3], [3, 11], [7, 7], [11, 3], [11, 11]]; // 五个星位（行,列）
const SERIF = '"Songti SC","Noto Serif SC","STSong","SimSun",serif';
const VERMILION = '#b23a2e';              // 朱砂红
const FOOTER_LINES = ['本证书仅用于本地教学演示，积分无现实价值；', '真实性以双方 EIP-712 签名与链上回执为准，证书本身不含私钥。'];

// ---------- 主题：浅色宣纸 / 深色墨纸 ----------
const THEMES = {
  light: { paper: '#f4efe6', gold: '#b89b5e', frame: '#2a241c', text: '#2a241c', muted: '#6b5f4d', boardFill: '#ead9b5', grid: '#2a241c', sealText: '#f4efe6' },
  dark: { paper: '#16130f', gold: '#b89b5e', frame: '#d9c08a', text: '#efe6d2', muted: '#a89a80', boardFill: '#2a2318', grid: '#b89b5e', sealText: '#16130f' },
};

// ---------- 文本工具 ----------

/** 转义 XML 特殊字符，并去掉 XML 不允许的控制字符，防止证据内容注入标记。 */
export function escapeXml(text) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 把长十六进制串缩写成 前缀…后缀（短串原样返回）。 */
function shortHex(value, head = 6, tail = 4) {
  const s = String(value ?? '');
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`;
}

/** 地址缩写：0x1234…abcd。 */
const shortAddress = (address) => shortHex(address, 6, 4);

/** 摘要缩写：保留前 18 位与后 8 位。 */
const shortDigest = (digest) => shortHex(digest, 18, 8);

/** 截断过长的标签文字，避免撑破版面。按显示宽度计：汉字等宽字符计 1，ASCII 计 0.55；max 以汉字宽度为单位。 */
function clip(text, max) {
  const chars = Array.from(String(text ?? ''));
  let width = 0, out = '';
  for (const ch of chars) {
    width += ch.charCodeAt(0) < 128 ? 0.55 : 1;
    if (width > max) return `${out}…`;
    out += ch;
  }
  return out;
}

/** 生成时间：能解析则显示为 UTC 的 “YYYY-MM-DD HH:mm:ss”，否则显示原文。 */
function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso) : `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}

/** 棋盘交叉点的像素坐标。 */
const pointX = (col) => BOARD_X + col * CELL;
const pointY = (row) => BOARD_Y + row * CELL;

// ---------- 通用 SVG 片段 ----------

/** 生成 <text> 元素；content 必须是已转义文本。 */
function textEl(x, y, content, attrs = '') {
  return `<text x="${x}" y="${y}" ${attrs}>${content}</text>`;
}

/** 带悬浮全文的文本：显示缩写，<title> 子元素放完整原文（均已转义）。 */
function textWithTitle(x, y, shown, full, attrs = '') {
  return `<text x="${x}" y="${y}" ${attrs}><title>${escapeXml(full)}</title>${escapeXml(shown)}</text>`;
}

/** 渐变定义：黑白棋子的径向渐变（棋子颜色不随主题改变）。 */
function buildDefs() {
  return [
    '<defs>',
    '<radialGradient id="stoneBlack" cx="35%" cy="32%" r="75%"><stop offset="0" stop-color="#6a6a6a"/><stop offset="0.45" stop-color="#262626"/><stop offset="1" stop-color="#050505"/></radialGradient>',
    '<radialGradient id="stoneWhite" cx="35%" cy="32%" r="80%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="#ece8df"/><stop offset="1" stop-color="#b9b2a2"/></radialGradient>',
    '<linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#b89b5e" stop-opacity="0"/><stop offset="0.5" stop-color="#b89b5e"/><stop offset="1" stop-color="#b89b5e" stop-opacity="0"/></linearGradient>',
    '</defs>',
  ].join('');
}

// ---------- 边框与角饰 ----------

/** 双层边框：外层细金线，内层粗墨线。 */
function buildFrame(t) {
  return [
    `<rect x="20" y="20" width="${WIDTH - 40}" height="${HEIGHT - 40}" fill="none" stroke="${t.gold}" stroke-width="1"/>`,
    `<rect x="34" y="34" width="${WIDTH - 68}" height="${HEIGHT - 68}" fill="none" stroke="${t.frame}" stroke-width="3"/>`,
  ].join('');
}

/** 四角装饰：先画左上角的折线+圆点，其余三角用镜像变换复用同一路径。 */
function buildCorners(t) {
  const shape = `<path d="M0 46 V0 H46 M10 34 V10 H34" fill="none" stroke="${t.gold}" stroke-width="1.5"/><circle cx="18" cy="18" r="3" fill="${t.gold}"/>`;
  const corner = (tx, ty, sx, sy) => `<g transform="translate(${tx} ${ty}) scale(${sx} ${sy})">${shape}</g>`;
  return [
    corner(44, 44, 1, 1),
    corner(WIDTH - 44, 44, -1, 1),
    corner(44, HEIGHT - 44, 1, -1),
    corner(WIDTH - 44, HEIGHT - 44, -1, -1),
  ].join('');
}

// ---------- 标题与结果行 ----------

/** 顶部标题区：小标题、大号“对弈证书”、英文副标题与金色分隔线。 */
function buildHeader(t, title) {
  return [
    textEl(WIDTH / 2, 84, escapeXml(title), `text-anchor="middle" font-size="16" letter-spacing="6" fill="${t.muted}" font-family='${SERIF}'`),
    textEl(WIDTH / 2, 150, '对弈证书', `text-anchor="middle" font-size="60" font-weight="700" letter-spacing="14" fill="${t.text}" font-family='${SERIF}'`),
    textEl(WIDTH / 2, 184, 'CERTIFICATE OF PLAY · GOMOKU CHANNEL', `text-anchor="middle" font-size="13" letter-spacing="4" fill="${t.gold}" font-family='${SERIF}'`),
    `<rect x="170" y="198" width="500" height="1.5" fill="url(#goldLine)"/>`,
  ].join('');
}

/** 结果文案：依据核验得到的 winner / 手数 / 终局状态生成。 */
function resultText(verified) {
  const n = verified.movesCount;
  if (verified.winner === 1) return `黑方执胜 · 共 ${n} 手`;
  if (verified.winner === 2) return `白方执胜 · 共 ${n} 手`;
  if (verified.terminal) return `和棋 · 共 ${n} 手`;
  return `对局进行中/未终局 · 共 ${n} 手`;
}

/** 结果行；若传入 levelName（如 AI 难度）则在下方追加一行小字。 */
function buildResult(t, verified, levelName) {
  const parts = [textEl(WIDTH / 2, 232, escapeXml(resultText(verified)), `text-anchor="middle" font-size="26" font-weight="700" letter-spacing="3" fill="${VERMILION}" font-family='${SERIF}'`)];
  if (levelName) parts.push(textEl(WIDTH / 2, 254, escapeXml(clip(levelName, 40)), `text-anchor="middle" font-size="13" fill="${t.muted}" font-family='${SERIF}'`));
  return parts.join('');
}

// ---------- 棋盘绘制 ----------

/** 棋盘底板、网格（单条 path）、星位与坐标标注（列 A..O、行 1..15，第 0 行在顶部）。 */
function buildBoardBase(t) {
  const pad = 22;
  let grid = '';
  for (let i = 0; i < SIZE; i++) {
    grid += `M${pointX(0)} ${pointY(i)}H${pointX(SIZE - 1)}M${pointX(i)} ${pointY(0)}V${pointY(SIZE - 1)}`;
  }
  const parts = [
    `<rect x="${BOARD_X - pad}" y="${BOARD_Y - pad}" width="${BOARD_SPAN + pad * 2}" height="${BOARD_SPAN + pad * 2}" fill="${t.boardFill}" stroke="${t.frame}" stroke-width="2"/>`,
    `<path d="${grid}" fill="none" stroke="${t.grid}" stroke-width="0.8"/>`,
  ];
  for (const [row, col] of STAR_POINTS) {
    parts.push(`<circle cx="${pointX(col)}" cy="${pointY(row)}" r="3.2" fill="${t.grid}"/>`);
  }
  const labels = [];
  for (let i = 0; i < SIZE; i++) {
    labels.push(textEl(pointX(i), BOARD_Y - 30, String.fromCharCode(65 + i), 'text-anchor="middle"'));
    labels.push(textEl(BOARD_X - 34, pointY(i) + 3.5, String(i + 1), 'text-anchor="middle"'));
  }
  parts.push(`<g font-size="10" fill="${t.muted}" font-family="${SERIF.replace(/"/g, '&quot;')}">${labels.join('')}</g>`);
  return parts.join('');
}

/** 取得获胜连线的两个端点（按坐标最小/最大的落点），不足两点则返回 null。 */
function winningSegment(winningLine) {
  if (!winningLine || winningLine.length < 2) return null;
  const sorted = [...winningLine].sort((a, b) => a - b);
  const first = sorted[0], last = sorted[sorted.length - 1];
  return { x1: pointX(first % SIZE), y1: pointY(Math.floor(first / SIZE)), x2: pointX(last % SIZE), y2: pointY(Math.floor(last / SIZE)) };
}

/** 画全部棋子：先画圆，再画朱砂获胜线与末手圈，最后叠加手数编号。 */
function buildStones(moves, result) {
  const circles = [], blackNumbers = [], whiteNumbers = [];
  moves.forEach((p, i) => {
    const cx = pointX(p % SIZE), cy = pointY(Math.floor(p / SIZE));
    const black = i % 2 === 0; // 第 i 手：偶数下标为黑
    circles.push(`<circle cx="${cx}" cy="${cy}" r="${STONE_R}" fill="url(#${black ? 'stoneBlack' : 'stoneWhite'})"/>`);
    (black ? blackNumbers : whiteNumbers).push(textEl(cx, +(cy + 3.2).toFixed(1), String(i + 1)));
  });
  const parts = [`<g stroke="#00000033" stroke-width="0.6">${circles.join('')}</g>`];
  const seg = result.winner ? winningSegment(result.winningLine) : null;
  if (seg) {
    parts.push(`<line x1="${seg.x1}" y1="${seg.y1}" x2="${seg.x2}" y2="${seg.y2}" stroke="${VERMILION}" stroke-width="4" stroke-linecap="round" stroke-opacity="0.75"/>`);
  }
  if (moves.length) {
    const last = moves[moves.length - 1];
    parts.push(`<circle cx="${pointX(last % SIZE)}" cy="${pointY(Math.floor(last / SIZE))}" r="${STONE_R + 3}" fill="none" stroke="${VERMILION}" stroke-width="2.2"/>`);
  }
  const numberAttrs = `text-anchor="middle" font-size="9" font-weight="700" font-family="Arial,Helvetica,sans-serif"`;
  parts.push(`<g ${numberAttrs} fill="#ffffff">${blackNumbers.join('')}</g>`);
  parts.push(`<g ${numberAttrs} fill="#1a1a1a">${whiteNumbers.join('')}</g>`);
  return parts.join('');
}

// ---------- 信息表（左右两栏） ----------

const TABLE_TOP = 842;   // 第一行基线 y
const ROW_STEP = 34;     // 行距
const LEFT_X = 92, LEFT_VALUE_X = 212;    // 左栏：标签 x / 内容 x
const RIGHT_X = 468, RIGHT_VALUE_X = 468; // 右栏：交易列表整体从 468 起

/** 一行“标签 + 内容”；mono 表示内容用等宽字体（地址、哈希）。 */
function tableRow(t, x, valueX, y, label, shown, full, mono = false) {
  const valueFont = mono ? `font-family="Consolas,Menlo,monospace" font-size="13"` : `font-family='${SERIF}' font-size="14"`;
  return [
    textEl(x, y, escapeXml(label), `font-size="13" fill="${t.muted}" font-family='${SERIF}'`),
    textWithTitle(valueX, y, shown, full ?? shown, `${valueFont} fill="${t.text}"`),
    `<line x1="${x}" y1="${y + 10}" x2="${valueX + 230}" y2="${y + 10}" stroke="${t.gold}" stroke-opacity="0.35" stroke-width="0.6"/>`,
  ].join('');
}

/** 左栏：双方地址、积分、通道 ID、状态摘要、生成时间。数据来自核验结果，而非直接信任文件字段。 */
function buildLeftColumn(t, evidence, verified, generatedAt) {
  const rows = [
    ['黑方 地址', shortAddress(verified.black), verified.black, true],
    ['白方 地址', shortAddress(verified.white), verified.white, true],
    ['每人投入积分', `${evidence.stake} 分`, `${evidence.stake}`, false],
    ['通道 ID', shortHex(verified.channelId, 10, 8), verified.channelId, true],
    ['状态摘要 digest', shortDigest(verified.digest), verified.digest, true],
    ['生成时间', formatTime(generatedAt), String(generatedAt), false],
  ];
  return rows.map(([label, shown, full, mono], i) => tableRow(t, LEFT_X, LEFT_VALUE_X, TABLE_TOP + i * ROW_STEP, label, shown, full, mono)).join('');
}

/** 右栏：链上交易（最多列 4 笔，标签与哈希均转义）与相对基线的节省比例。 */
function buildRightColumn(t, evidence, verified) {
  const txs = Array.isArray(evidence.transactions) ? evidence.transactions : [];
  const parts = [textEl(RIGHT_X, TABLE_TOP, escapeXml(`链上交易 ${txs.length} 笔`), `font-size="13" fill="${t.muted}" font-family='${SERIF}'`)];
  txs.slice(0, 4).forEach((tx, i) => {
    const y = TABLE_TOP + 26 + i * 24;
    const label = escapeXml(clip(tx?.label ?? '', 14));
    const hash = String(tx?.hash ?? '');
    parts.push(`<text x="${RIGHT_X}" y="${y}" font-size="13" fill="${t.text}" font-family='${SERIF}'><title>${escapeXml(hash)}</title>${label} <tspan font-family="Consolas,Menlo,monospace" font-size="12" fill="${t.muted}">${escapeXml(shortHex(hash, 6, 4))}</tspan></text>`);
  });
  if (txs.length > 4) {
    parts.push(textEl(RIGHT_X, TABLE_TOP + 26 + 4 * 24, escapeXml(`另有 ${txs.length - 4} 笔未列出`), `font-size="12" fill="${t.muted}" font-family='${SERIF}'`));
  }
  // 节省比例：仅当 metrics 提供数值且已有落子时显示
  const saved = evidence.metrics?.savedPercent;
  if (typeof saved === 'number' && Number.isFinite(saved) && verified.movesCount > 0) {
    const text = saved >= 0 ? `较逐步上链减少 ${saved}%` : `较逐步上链增加 ${Math.abs(saved)}%`;
    parts.push(textEl(RIGHT_X, TABLE_TOP + 5 * ROW_STEP, escapeXml(text), `font-size="15" font-weight="700" fill="${VERMILION}" font-family='${SERIF}'`));
  }
  return parts.join('');
}

// ---------- 印章与页脚 ----------

/** 右下角朱砂方印：略微旋转（-6°），“弈信”上下排布，白文印风格。 */
function buildSeal(t) {
  const cx = 716, cy = 1040;
  return [
    `<g transform="rotate(-6 ${cx} ${cy})">`,
    `<rect x="${cx - 42}" y="${cy - 42}" width="84" height="84" rx="4" fill="${VERMILION}" fill-opacity="0.92"/>`,
    `<rect x="${cx - 36}" y="${cy - 36}" width="72" height="72" fill="none" stroke="${t.sealText}" stroke-width="1.5"/>`,
    textEl(cx, cy - 4, '弈', `text-anchor="middle" font-size="32" font-weight="700" fill="${t.sealText}" font-family='${SERIF}'`),
    textEl(cx, cy + 28, '信', `text-anchor="middle" font-size="32" font-weight="700" fill="${t.sealText}" font-family='${SERIF}'`),
    '</g>',
  ].join('');
}

/** 页脚：免责声明分两行显示。 */
function buildFooter(t) {
  const lines = FOOTER_LINES.map((line, i) => textEl(LEFT_X, 1108 + i * 22, escapeXml(line), `font-size="12.5" fill="${t.muted}" font-family='${SERIF}'`));
  return `<rect x="${LEFT_X}" y="1082" width="520" height="1" fill="${t.gold}" fill-opacity="0.5"/>${lines.join('')}`;
}

// ---------- 对外 API ----------

/**
 * 生成对局证书 SVG。
 * 先调用 verifyEvidence 核验双签；篡改/非法证据会直接抛错，不生成证书。
 * 棋谱、胜负、地址、摘要均取自核验结果。
 */
export function buildCertificateSvg(evidence, options = {}) {
  const verified = verifyEvidence(evidence); // 核验失败则异常向外传播
  const t = THEMES[options.theme === 'dark' ? 'dark' : 'light'];
  const generatedAt = options.generatedAt || evidence.exportedAt || new Date().toISOString();
  const title = options.title || '弈·信 对局证书';
  const moves = evidence.checkpoint.moves;
  const result = evaluate(moves);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" role="img">`,
    `<title>${escapeXml(title)}</title>`,
    buildDefs(),
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${t.paper}"/>`,
    buildFrame(t),
    buildCorners(t),
    buildHeader(t, title),
    buildResult(t, verified, options.levelName),
    buildBoardBase(t),
    buildStones(moves, result),
    buildLeftColumn(t, evidence, verified, generatedAt),
    buildRightColumn(t, evidence, verified),
    buildSeal(t),
    buildFooter(t),
    '</svg>',
  ].join('\n');
}

/** 证书文件名：gomoku-certificate-<channelId 前 10 位十六进制>.svg */
export function certificateFileName(evidence) {
  const hex = String(evidence?.channelId ?? '').replace(/^0x/i, '').slice(0, 10).toLowerCase();
  return `gomoku-certificate-${hex}.svg`;
}
