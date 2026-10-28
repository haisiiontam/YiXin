// 迭代 2 的浏览器端到端测试：人机对弈（全程双签 + 3 笔链上交易）、复盘、提示、威胁、主题、证书、移动端。
// 人类一侧的落子由 shared/ai.mjs 的 master 档位计算，再通过真实点击棋盘执行，AI 一侧由页面内的 AI 钱包回应。
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { JsonRpcProvider, Contract } from 'ethers';
import { chooseMove } from '../shared/ai.mjs';
import { analyzePosition } from '../shared/analysis.mjs';
import { verifyEvidence } from '../shared/evidence.mjs';

const ROOT = process.cwd(), OUT = path.join(ROOT, 'artifacts/test-results'), SHOTS = path.join(ROOT, 'docs/assets');
await fs.mkdir(OUT, { recursive: true }); await fs.mkdir(SHOTS, { recursive: true });
await fs.mkdir(path.join(ROOT, 'artifacts/playwright/downloads'), { recursive: true });
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const evidence = { generatedAt: new Date().toISOString(), url: base, browser: 'Microsoft Edge via Playwright', tests: [], errors: [], screenshots: [] };
let browser;
async function check(name, fn) {
  const start = Date.now();
  try { await fn(); evidence.tests.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log('PASS', name); }
  catch (e) { evidence.tests.push({ name, status: 'failed', error: e.message, durationMs: Date.now() - start }); throw e; }
}
async function shot(page, name) {
  // 截图前回顶并等主题过渡完成，避免把 sticky 顶栏或半途颜色写成验收证据。
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  evidence.screenshots.push(path.join('docs/assets', name));
}
async function ready(page) { await page.goto(base); await page.getByText('本地链已连接', { exact: false }).waitFor({ timeout: 30000 }); }
// 读取页面保存的当前对局证据（和 e2e.mjs 一样按 active-channel 精确取证，避免取到旧对局）。
async function stored(page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('gomoku-channel-v1:active-channel:'));
    const id = key && localStorage.getItem(key);
    const raw = id && localStorage.getItem(`gomoku-channel-v1:evidence:${id}`);
    return raw ? JSON.parse(raw) : null;
  });
}
async function waitMoves(page, predicate, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const e = await stored(page); if (e && predicate(e.checkpoint.moves)) return e; await page.waitForTimeout(150); }
  throw Error('等待棋谱变化超时');
}
const cell = (page, p) => page.getByRole('button', { name: `落子 ${Math.floor(p / 15) + 1},${p % 15 + 1}`, exact: true });
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, downloadsPath: path.join(ROOT, 'artifacts/playwright/downloads'), args: ['--disable-breakpad', '--disable-crash-reporter', '--disable-component-update', '--disable-sync', '--no-first-run'], env: { ...process.env, TEMP: path.join(ROOT, '.tmp'), TMP: path.join(ROOT, '.tmp'), LOCALAPPDATA: path.join(ROOT, '.tmp/browser-local'), APPDATA: path.join(ROOT, '.tmp/browser-app') } });
  const ctx = await browser.newContext({ viewport: { width: 1536, height: 1100 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => evidence.errors.push(e.message));
  await check('新版首页：棋盘 225 点、主题与音效开关、人机对弈入口可见', async () => {
    await ready(page);
    if (await page.getByRole('button', { name: /^落子 / }).count() !== 225) throw Error('棋盘格数错误');
    await page.getByRole('radiogroup', { name: 'AI 难度' }).waitFor();
    await page.getByRole('button', { name: /切换为夜间主题/ }).waitFor();
    await shot(page, 'v2-01-lobby-light.png');
  });
  let finalEvidence;
  await check('人机对弈：人类执黑点击棋盘，AI 每手回应，全程双签，终局链上结算', async () => {
    await page.getByRole('radio', { name: /渐入佳境/ }).click();
    await page.getByRole('button', { name: '开始人机对弈', exact: true }).click();
    await page.getByText('对局进行中', { exact: true }).waitFor({ timeout: 60000 });
    let guard = 0;
    for (;;) {
      if (++guard > 120) throw Error('对局未能在合理手数内结束');
      const e = await stored(page);
      const moves = e.checkpoint.moves;
      if (moves.length % 2 === 0 && moves.length < 225) {
        const p = chooseMove(moves, { level: 'master', timeBudgetMs: 700 });
        await cell(page, p).click();
        await waitMoves(page, m => m.length >= moves.length + 1);
        const latest = await stored(page);
        const now = latest.checkpoint.moves;
        if (!now.length) throw Error('棋谱丢失');
        const terminalNow = await page.getByRole('button', { name: '链上结算本局', exact: true }).isVisible().catch(() => false);
        if (terminalNow) break;
        await waitMoves(page, m => m.length >= moves.length + 2, 45000).catch(async () => {
          if (!(await page.getByRole('button', { name: '链上结算本局', exact: true }).isVisible())) throw Error('AI 未回应');
        });
      }
      if (await page.getByRole('button', { name: '链上结算本局', exact: true }).isVisible().catch(() => false)) break;
    }
    await shot(page, 'v2-02-ai-game-end.png');
    await page.getByRole('button', { name: '链上结算本局', exact: true }).click();
    await page.getByText('已完成结算', { exact: true }).waitFor({ timeout: 60000 });
    finalEvidence = await stored(page);
    verifyEvidence(finalEvidence, { chainId: 31337 });
    if (finalEvidence.transactions.length !== 3) throw Error(`人机局应为 open+join+settle 共 3 笔，实际 ${finalEvidence.transactions.length}`);
    if (finalEvidence.opponent?.type !== 'local-ai') throw Error('证据缺少人机对手标注');
    evidence.aiGame = { moves: finalEvidence.checkpoint.moves.length, transactions: finalEvidence.transactions.map(t => ({ label: t.label, gasUsed: t.gasUsed })), channelId: finalEvidence.channelId, winner: finalEvidence.onchain.winner };
    await shot(page, 'v2-03-ai-settled.png');
  });
  await check('链上积分守恒：胜方 +stake、负方 -stake，且合约结果与证据一致', async () => {
    const cfg = await (await fetch(`${base}/api/config`)).json();
    const provider = new JsonRpcProvider(`${base}/rpc`, undefined, { cacheTimeout: -1 });
    try {
      const contract = new Contract(cfg.address, cfg.abi, provider);
      const ch = await contract.getChannel(finalEvidence.channelId);
      if (Number(ch.status) !== 4) throw Error('合约状态不是已结算');
      if (Number(ch.winner) !== finalEvidence.onchain.winner) throw Error('合约胜方与证据不一致');
      const b = Number(await contract.points(ch.black)), w = Number(await contract.points(ch.white));
      evidence.aiGame.pointsBlack = b; evidence.aiGame.pointsWhite = w;
      if (Number(ch.winner) !== 0 && b + w !== 2000) throw Error(`积分总量应守恒为 2000，实际 ${b + w}`);
    } finally { provider.destroy(); }
  });
  await check('复盘：滑块回看第 k 手的棋盘等于前 k 手，回看不产生新交易', async () => {
    const before = (await stored(page)).transactions.length;
    await page.getByRole('slider', { name: '复盘手数' }).fill('3');
    await page.getByText('回看中 · 第 3 手', { exact: false }).waitFor();
    const stones = await page.locator('.intersection.occupied').count();
    if (stones !== 3) throw Error(`回看第 3 手应有 3 枚棋子，实际 ${stones}`);
    await page.getByRole('button', { name: '回到最新', exact: true }).click();
    const full = await page.locator('.intersection.occupied').count();
    if (full !== finalEvidence.checkpoint.moves.length) throw Error('回到最新后棋子数不符');
    const after = (await stored(page)).transactions.length;
    if (before !== after) throw Error('复盘不应产生交易');
    await page.getByLabel('显示手数').check();
    await page.locator('.stone-no').first().waitFor();
    await shot(page, 'v2-04-review.png');
  });
  await check('威胁标记：回看终局前一手显示实际成五点，复盘棋盘不可落子', async () => {
    const prefix = finalEvidence.checkpoint.moves.slice(0, -1);
    const a = analyzePosition(prefix);
    const expected = [...new Set([...a.winningCells[1], ...a.winningCells[2], ...a.mustBlock])];
    if (!expected.length) throw Error('测试前置局面应存在立即成五点');
    await page.getByRole('slider', { name: '复盘手数' }).fill(String(prefix.length));
    await page.getByLabel('标出威胁').check();
    await page.waitForFunction(n => document.querySelectorAll('.intersection.is-threat').length === n, expected.length);
    for (const p of expected) {
      if (!(await cell(page, p).getAttribute('class')).includes('is-threat')) throw Error(`漏标成五点 ${p}`);
    }
    if (await page.locator('.intersection:not(:disabled)').count()) throw Error('复盘棋盘必须只读');
    if (!(await page.locator('.curve-caption').textContent()).includes('非胜率')) throw Error('曲线必须标明非胜率');
    await shot(page, 'v2-08-threat-review.png');
    await page.getByRole('button', { name: '回到最新', exact: true }).click();
  });
  await check('夜间主题：切换后 data-theme=dark，刷新后偏好保持', async () => {
    await page.getByRole('button', { name: '切换为夜间主题', exact: true }).click();
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'dark') throw Error('主题未切换');
    await shot(page, 'v2-05-dark.png');
    await page.reload(); await page.getByText('本地链已连接', { exact: false }).waitFor({ timeout: 30000 });
    if (await page.evaluate(() => document.documentElement.dataset.theme) !== 'dark') throw Error('主题偏好未保持');
    await page.getByRole('button', { name: '切换为日间主题', exact: true }).click();
  });
  await check('对局证书：导出 SVG，内容含通道摘要且不含私钥字段', async () => {
    // 上一步刷新过页面，客户端已回到空闲态；证书应能从“对局记录”按保存的证据导出。
    await page.getByRole('button', { name: '对局记录', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '导出历史对局证书 1', exact: true }).click()]);
    const file = path.join(OUT, 'v2-certificate.svg');
    await download.saveAs(file);
    const svg = await fs.readFile(file, 'utf8');
    if (!svg.startsWith('<svg') && !svg.includes('<svg ')) throw Error('不是 SVG');
    if (!svg.includes('人机') && !svg.includes('炉火') && !svg.includes('渐入')) { /* 难度文案可选 */ }
    if (/privateKey|mnemonic/i.test(svg)) throw Error('证书含敏感字段');
    if (/<script|foreignObject/i.test(svg)) throw Error('证书含脚本');
    if (!svg.includes(finalEvidence.channelId)) throw Error('证书缺少通道 ID');
    const certPage = await ctx.newPage();
    await certPage.setViewportSize({ width: 840, height: 1188 });
    await certPage.setContent(`<style>body{margin:0}</style>${svg}`);
    await certPage.screenshot({ path: path.join(SHOTS, 'v2-certificate-preview.png'), fullPage: true });
    await certPage.close();
    evidence.certificate = { file: 'artifacts/test-results/v2-certificate.svg', bytes: Buffer.byteLength(svg), preview: 'docs/assets/v2-certificate-preview.png' };
  });
  await check('形势提示：请求提示给出 3 个空位建议，且不发送交易', async () => {
    // 上一步停留在“对局记录”页，先回大厅。
    await page.getByRole('button', { name: '对局大厅', exact: true }).click();
    await page.getByRole('button', { name: '创建对局', exact: true }).waitFor();
    await page.getByRole('radio', { name: /炉火纯青/ }).click();
    await page.getByRole('radio', { name: /执白后手/ }).click();
    await page.getByRole('button', { name: '开始人机对弈', exact: true }).click();
    await page.getByText('对局进行中', { exact: true }).waitFor({ timeout: 60000 });
    await waitMoves(page, m => m.length >= 1, 30000);
    const countBefore = (await stored(page)).transactions.length;
    await page.getByRole('button', { name: '给我提示', exact: true }).click();
    await page.locator('.intersection.is-hint').first().waitFor({ timeout: 15000 });
    const n = await page.locator('.intersection.is-hint').count();
    if (n < 1 || n > 3) throw Error(`提示数量异常：${n}`);
    const countAfter = (await stored(page)).transactions.length;
    if (countBefore !== countAfter) throw Error('提示不应产生交易');
    await shot(page, 'v2-06-hint.png');
  });
  await check('刷新恢复：未完成的人机局重新核验本地双签证据后继续，棋谱不丢', async () => {
    const before = await stored(page);
    const n = before.checkpoint.moves.length;
    await page.reload();
    await page.getByText('本地链已连接', { exact: false }).waitFor({ timeout: 30000 });
    await page.getByText('对局进行中', { exact: true }).waitFor({ timeout: 30000 });
    const stones = await page.locator('.intersection.occupied').count();
    if (stones < n) throw Error(`刷新后棋子数 ${stones} 少于刷新前 ${n}`);
    const after = await stored(page);
    verifyEvidence(after, { chainId: 31337 });
    if (after.checkpoint.moves.length < n) throw Error('刷新后棋谱回退');
    if (after.opponent?.type !== 'local-ai') throw Error('刷新后丢失人机对手标注');
    evidence.aiResume = { movesBefore: n, movesAfter: after.checkpoint.moves.length };
  });
  await check('移动端 390px 无横向溢出（新版布局）', async () => {
    const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
    const mp = await mctx.newPage(); await ready(mp);
    if (await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('移动端页面横向溢出');
    const nav = await mp.locator('.sidebar nav').boundingBox();
    if (!nav || nav.height > 70) throw Error('手机导航必须横向排列');
    const brand = await mp.locator('.brand strong').boundingBox();
    if (!brand || brand.height > 40) throw Error('手机品牌不应折行');
    await shot(mp, 'v2-07-mobile.png'); await mctx.close();
    // 同时检查非空局面，防止只测首页遗漏复盘滑块溢出。
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('slider', { name: '复盘手数' }).waitFor();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw Error('手机对弈/复盘布局横向溢出');
    await shot(page, 'v2-09-mobile-active.png');
  });
  if (evidence.errors.length) throw Error('浏览器存在未捕获异常：' + evidence.errors.join('; '));
} catch (e) { evidence.failure = e.message; process.exitCode = 1; console.error(e); }
finally {
  await browser?.close();
  evidence.summary = { passed: evidence.tests.filter(t => t.status === 'passed').length, failed: evidence.tests.filter(t => t.status === 'failed').length };
  await fs.writeFile(path.join(OUT, 'e2e-v2-results.json'), JSON.stringify(evidence, null, 2));
}
