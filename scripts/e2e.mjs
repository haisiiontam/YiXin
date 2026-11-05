import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { JsonRpcProvider, Contract } from 'ethers';
import { BLACK_WIN } from '../shared/gomoku.mjs';
const ROOT = process.cwd();
const OUT = path.resolve(ROOT, process.env.TEST_RESULTS_DIR || 'artifacts/test-results');
const SHOTS = path.resolve(ROOT, process.env.TEST_SCREENSHOTS_DIR || 'docs/assets');
await fs.mkdir(OUT, { recursive: true }); await fs.mkdir(SHOTS, { recursive: true });
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const evidence = { generatedAt: new Date().toISOString(), url: base, browser: 'Microsoft Edge via Playwright', tests: [], errors: [], screenshots: [] };
let browser;
async function check(name, fn) { const start = Date.now(); try { await fn(); evidence.tests.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log('PASS', name); } catch (e) { evidence.tests.push({ name, status: 'failed', error: e.message, durationMs: Date.now() - start }); throw e; } }
async function screenshot(page, name) { const dest = path.join(SHOTS, name); await page.screenshot({ path: dest, fullPage: true }); evidence.screenshots.push(path.relative(ROOT, dest)); }
async function ready(page) { await page.goto(base); await page.getByText('本地链已连接', { exact: false }).waitFor({ timeout: 30000 }); }
async function storedEvidence(page) { return page.evaluate(() => {
  const activeKey = Object.keys(localStorage).find(k => k.startsWith('gomoku-channel-v1:active-channel:'));
  const activeId = activeKey && localStorage.getItem(activeKey);
  if (activeId && localStorage.getItem(`gomoku-channel-v1:evidence:${activeId}`)) return JSON.parse(localStorage.getItem(`gomoku-channel-v1:evidence:${activeId}`));
  const values = Object.keys(localStorage).filter(k => k.startsWith('gomoku-channel-v1:evidence:')).map(k => JSON.parse(localStorage.getItem(k)));
  return values.sort((a, b) => b.checkpoint.moves.length - a.checkpoint.moves.length)[0] || null;
}); }
async function waitForStoredSettlement(page, count) {
  await page.waitForFunction(expected => {
    const key = Object.keys(localStorage).find(k => k.startsWith('gomoku-channel-v1:active-channel:'));
    const game = key && localStorage.getItem(key);
    const raw = game && localStorage.getItem(`gomoku-channel-v1:evidence:${game}`);
    if (!raw) return false;
    const value = JSON.parse(raw);
    return value.onchain?.status === 'settled' && value.transactionListComplete === true && value.transactions.length === expected;
  }, count, { timeout: 30000 });
}
async function waitForProofDeadline(channelId) {
  const config = await (await fetch(base + '/api/config')).json();
  const rpc = new JsonRpcProvider(base + '/rpc', undefined, { cacheTimeout: -1 });
  try {
    const contract = new Contract(config.address, config.abi, rpc);
    const channel = await contract.getChannel(channelId);
    const until = Date.now() + (Number(config.challengePeriod) + 30) * 1000;
    // Observe mined chain time through public read RPC; no test-only time mutation is exposed.
    while (Date.now() < until) {
      const latest = await rpc.send('eth_getBlockByNumber', ['latest', false]);
      if (BigInt(latest.timestamp) >= channel.proofDeadline) return;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw Error('等待链上举证期结束超时，请确认测试链持续出块');
  } finally { rpc.destroy(); }
}
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, downloadsPath: path.join(ROOT, 'artifacts/playwright/downloads'), args: ['--disable-breakpad', '--disable-crash-reporter', '--disable-component-update', '--disable-sync', '--no-first-run'], env: { ...process.env, TEMP: path.join(ROOT, '.tmp'), TMP: path.join(ROOT, '.tmp'), LOCALAPPDATA: path.join(ROOT, '.tmp/browser-local'), APPDATA: path.join(ROOT, '.tmp/browser-app') } });
  const a = await browser.newContext({ viewport: { width: 1536, height: 1100 }, acceptDownloads: true });
  const b = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  const black = await a.newPage(), white = await b.newPage();
  for (const page of [black, white]) page.on('pageerror', e => evidence.errors.push(e.message));
  await check('两个独立浏览器上下文注册各自钱包并加载225点棋盘', async () => {
    await Promise.all([ready(black), ready(white)]);
    if (await black.getByRole('button', { name: /^落子 / }).count() !== 225) throw Error('棋盘格数错误');
    const ak = await black.evaluate(() => localStorage.getItem('gomoku-channel-v1:local-test-key'));
    const bk = await white.evaluate(() => localStorage.getItem('gomoku-channel-v1:local-test-key'));
    if (ak === bk) throw Error('两个棋手钱包未隔离');
    await screenshot(black, '01-lobby.png');
  });
  await check('双人邀请开通真实链上通道', async () => {
    await black.getByRole('button', { name: '创建对局', exact: true }).click();
    const code = black.locator('.room-info > code'); await code.waitFor();
    const roomId = await code.textContent();
    await white.getByRole('textbox', { name: '邀请码', exact: true }).fill(roomId);
    await white.getByRole('button', { name: '加入对局', exact: true }).click();
    await black.getByText('对局进行中', { exact: true }).waitFor({ timeout: 30000 });
    await white.getByText('对局进行中', { exact: true }).waitFor({ timeout: 30000 });
    evidence.roomId = roomId;
  });
  await check('9手双签对局全程仅2笔开通交易，错误轮次受限', async () => {
    for (let i = 0; i < BLACK_WIN.length; i++) {
      const page = i % 2 ? white : black, other = i % 2 ? black : white, p = BLACK_WIN[i];
      const button = page.getByRole('button', { name: `落子 ${Math.floor(p / 15) + 1},${p % 15 + 1}`, exact: true });
      await button.waitFor(); await button.click({ timeout: 15000 });
      await black.getByText(`第 ${i + 1} 手已确认`, { exact: true }).waitFor({ timeout: 15000 });
      await white.getByText(`第 ${i + 1} 手已确认`, { exact: true }).waitFor({ timeout: 15000 });
      if (await other.getByRole('button', { name: '落子 1,1', exact: true }).isEnabled() && i === 8) throw Error('终局后仍可落子');
    }
    const before = await storedEvidence(black);
    if (before.checkpoint.moves.length !== 9 || before.transactions.length !== 2) throw Error('链下落子产生额外链上交易');
    if (!before.checkpoint.sigBlack || !before.checkpoint.sigWhite) throw Error('缺少双方签名');
    evidence.beforeSettlement = before; await screenshot(black, '02-dual-signed-win.png');
  });
  await check('终局链上结算、链上积分守恒、导出证据与刷新恢复', async () => {
    await black.getByRole('button', { name: '链上结算本局', exact: true }).click();
    await black.getByText('已完成结算', { exact: true }).waitFor({ timeout: 30000 });
    await white.getByText('已完成结算', { exact: true }).waitFor({ timeout: 15000 });
    await waitForStoredSettlement(black, 3);
    const after = await storedEvidence(black); evidence.afterSettlement = after;
    if (after.transactions.length !== 3) throw Error(`正常局事务不是3笔：${after.transactions.length}`);
    const config = await (await fetch(base + '/api/config')).json(); const rpc = new JsonRpcProvider(base + '/rpc', undefined, { cacheTimeout: -1 });
    const c = new Contract(config.address, config.abi, rpc), channel = await c.getChannel(after.channelId);
    const bp = Number(await c.points(channel.black)), wp = Number(await c.points(channel.white));
    if (bp !== 1010 || wp !== 990 || Number(channel.status) !== 4 || Number(channel.winner) !== 1) throw Error(`积分或结算错误 ${bp}/${wp}`);
    evidence.chainVerification = { blackPoints: bp, whitePoints: wp, status: Number(channel.status), winner: Number(channel.winner) }; rpc.destroy();
    await black.getByText('签名与异常实验', { exact: true }).click();
    const downloadWait = black.waitForEvent('download'); await black.getByRole('button', { name: '导出证据 JSON', exact: true }).click();
    const download = await downloadWait; await download.saveAs(path.join(OUT, 'browser-exported-evidence.json'));
    await screenshot(black, '03-settled-game.png');
    await black.reload(); await black.getByText('已完成结算', { exact: true }).waitFor({ timeout: 30000 });
    await black.getByRole('button', { name: '通道实验室', exact: true }).click(); await screenshot(black, '04-channel-lab.png');
  });
  await check('输家拒签最后胜手时，以8手双签快照挑战并强制落子完成结算', async () => {
    await black.getByRole('button', { name: '对局大厅', exact: true }).click();
    await black.getByRole('button', { name: '创建对局', exact: true }).click();
    const code = black.locator('.room-info > code'); await code.waitFor(); const roomId = await code.textContent();
    await white.getByRole('textbox', { name: '邀请码', exact: true }).fill(roomId);
    await white.getByRole('button', { name: '加入对局', exact: true }).click();
    await black.getByText('对局进行中', { exact: true }).waitFor({ timeout: 30000 });
    await white.getByText('对局进行中', { exact: true }).waitFor({ timeout: 30000 });
    for (let i = 0; i < 8; i++) {
      const page = i % 2 ? white : black, p = BLACK_WIN[i];
      await page.getByRole('button', { name: `落子 ${Math.floor(p / 15) + 1},${p % 15 + 1}`, exact: true }).click();
      await Promise.all([black.getByText(`第 ${i + 1} 手已确认`, { exact: true }).waitFor(), white.getByText(`第 ${i + 1} 手已确认`, { exact: true }).waitFor()]);
    }
    const whiteDetails = white.locator('details.experiment-panel'); if (!await whiteDetails.getAttribute('open')) await white.getByText('签名与异常实验', { exact: true }).click();
    await white.getByRole('checkbox', { name: '自动确认对手提案', exact: true }).uncheck();
    await black.getByRole('button', { name: '落子 8,12', exact: true }).click();
    await black.getByText('有一手等待共同确认', { exact: true }).waitFor();
    const details = black.locator('details.experiment-panel'); if (!await details.getAttribute('open')) await black.getByText('签名与异常实验', { exact: true }).click();
    await black.getByRole('button', { name: '提交最新快照挑战', exact: true }).click();
    await black.getByText('链上争议中', { exact: true }).first().waitFor({ timeout: 30000 });
    await waitForProofDeadline((await storedEvidence(black)).channelId);
    await black.getByRole('checkbox', { name: '棋盘使用链上强制落子', exact: true }).check();
    await black.getByRole('button', { name: '落子 8,12', exact: true }).click();
    await black.getByRole('button', { name: '确认落子 L8', exact: true }).click();
    await black.getByText('已完成结算', { exact: true }).waitFor({ timeout: 30000 });
    await waitForStoredSettlement(black, 4);
    const proof = await storedEvidence(black);
    if (proof.checkpoint.moves.length !== 8 || proof.onchain.moves.length !== 9 || proof.onchain.winner !== 1 || proof.transactions.length !== 4) throw Error('拒签争议证据或4笔事务结果不符');
    evidence.refusalRecovery = proof; await screenshot(black, '07-refusal-recovery.png');
  });
  await check('自动演示明确标记并实际完成独立9手3笔交易结算', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1536, height: 1100 } }); const page = await ctx.newPage(); await ready(page);
    await page.getByRole('button', { name: '运行完整自动演示', exact: true }).click();
    await page.getByText('已完成结算', { exact: true }).waitFor({ timeout: 60000 });
    await waitForStoredSettlement(page, 3);
    const demo = await storedEvidence(page); if (demo.transactions.length !== 3 || demo.checkpoint.moves.length !== 9) throw Error('自动演示交易/棋谱错误');
    evidence.demo = { channelId: demo.channelId, transactions: demo.transactions, metrics: demo.metrics };
    await screenshot(page, '05-auto-demo.png');
    await ctx.close();
  });
  await check('独立观察钱包导入证据可核验双签与3笔回执，篡改证据被拒绝', async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } }); const page = await ctx.newPage(); await ready(page);
    await page.getByText('签名与异常实验', { exact: true }).click();
    await page.getByLabel('导入证据 JSON', { exact: true }).setInputFiles(path.join(OUT, 'browser-exported-evidence.json'));
    await page.getByText('证据验证通过', { exact: false }).waitFor({ timeout: 30000 });
    if (await page.getByRole('button', { name: '提交最新快照挑战', exact: true }).isEnabled()) throw Error('观察者获得成员操作权限');
    const raw = JSON.parse(await fs.readFile(path.join(OUT, 'browser-exported-evidence.json'), 'utf8')); raw.checkpoint.moves[0] = 111;
    await page.getByLabel('导入证据 JSON', { exact: true }).setInputFiles({ name: 'tampered.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(raw)) });
    await page.getByRole('alert').waitFor({ timeout: 15000 });
    evidence.evidenceImport = { validPackageAccepted: true, observerActionsDisabled: true, tamperedPackageRejected: true }; await screenshot(page, '08-evidence-import.png'); await ctx.close();
  });
  await check('移动端390像素无横向溢出', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 }); const page = await ctx.newPage(); await ready(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    if (overflow) throw Error('移动端页面横向溢出'); await screenshot(page, '06-mobile.png'); await ctx.close();
  });
  if (evidence.errors.length) throw Error('浏览器存在未捕获异常：' + evidence.errors.join('; '));
} catch (e) { evidence.failure = e.message; process.exitCode = 1; console.error(e); }
finally { await browser?.close(); evidence.summary = { passed: evidence.tests.filter(t => t.status === 'passed').length, failed: evidence.tests.filter(t => t.status === 'failed').length }; await fs.writeFile(path.join(OUT, 'e2e-results.json'), JSON.stringify(evidence, null, 2)); }
