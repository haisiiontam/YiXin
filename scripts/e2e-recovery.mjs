// Real dual-browser/RPC acceptance; faults are injected only into browser storage.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { BLACK_WIN } from '../shared/gomoku.mjs';
import { verifyEvidence } from '../shared/evidence.mjs';

const ROOT = process.cwd(), OUT = path.resolve(ROOT, process.env.TEST_RESULTS_DIR || 'artifacts/test-results/recovery-2026-11-05/final');
const SHOTS = path.join(OUT, 'recovery-screenshots');
const base = process.env.TEST_URL || 'http://127.0.0.1:4191';
await fs.mkdir(SHOTS, { recursive: true });
const results = { generatedAt: new Date().toISOString(), environment: 'Microsoft Edge + real loopback Ganache/HTTP RPC + independent local test wallets; no real user or extension acceptance', tests: [], errors: [], observations: {} };
let browser;
const frameTypes = { black: [], white: [] };
async function check(name, fn) {
  const start = Date.now();
  try { await fn(); results.tests.push({ name, status: 'passed', durationMs: Date.now() - start }); console.log('PASS', name); }
  catch (error) { results.tests.push({ name, status: 'failed', error: error.message }); throw error; }
}
async function saved(page) { return page.evaluate(() => {
  const key = Object.keys(localStorage).find(k => k.startsWith('gomoku-channel-v1:active-channel:'));
  return key ? JSON.parse(localStorage.getItem(`gomoku-channel-v1:evidence:${localStorage.getItem(key)}`)) : null;
}); }
async function confirmed(page, count) { await page.getByText(`第 ${count} 手已确认`, { exact: true }).waitFor({ timeout: 20000 }); }
const cell = (page, position) => page.getByRole('button', { name: `落子 ${Math.floor(position / 15) + 1},${position % 15 + 1}`, exact: true });
async function ready(page) { await page.goto(base); await page.getByText('本地链已连接', { exact: false }).waitFor({ timeout: 30000 }); }
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, name), fullPage: true }); }
try {
  browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, downloadsPath: path.join(ROOT, 'artifacts/playwright/downloads'), args: ['--disable-breakpad', '--disable-crash-reporter', '--disable-component-update', '--disable-sync', '--no-first-run'], env: { ...process.env, TEMP: path.join(ROOT, '.tmp'), TMP: path.join(ROOT, '.tmp'), LOCALAPPDATA: path.join(ROOT, '.tmp/recovery-browser-local'), APPDATA: path.join(ROOT, '.tmp/recovery-browser-app') } });
  const contexts = await Promise.all([browser.newContext({ viewport: { width: 1536, height: 1100 }, acceptDownloads: true }), browser.newContext({ viewport: { width: 1440, height: 1050 } })]);
  const [black, white] = await Promise.all(contexts.map(c => c.newPage()));
  for (const [name, page] of [['black', black], ['white', white]]) {
    page.on('pageerror', e => results.errors.push(e.message));
    page.on('websocket', ws => ws.on('framesent', event => { try { frameTypes[name].push(JSON.parse(String(event.payload)).type); } catch { /* only types, never authentication signatures */ } }));
  }
  await Promise.all([ready(black), ready(white)]);
  await check('keyboard grid has one tab stop, clamps edges and allows read-only cell inspection', async () => {
    const grid = black.getByRole('grid'); await grid.focus();
    await grid.press('Control+Home'); await grid.press('ArrowLeft'); await grid.press('ArrowUp');
    let active = await grid.getAttribute('aria-activedescendant');
    assert.match(await black.locator(`[id="${active}"]`).getAttribute('aria-label'), /^A1，空位/);
    await grid.press('Control+End'); await grid.press('ArrowRight'); await grid.press('ArrowDown');
    active = await grid.getAttribute('aria-activedescendant');
    assert.match(await black.locator(`[id="${active}"]`).getAttribute('aria-label'), /^O15，空位/);
    await grid.press('Enter'); assert.equal(await black.getByRole('dialog').count(), 0);
    assert.equal(await black.locator('.intersection[tabindex="0"]').count(), 0);
    await grid.press('Control+Home'); for (let i = 0; i < 7; i++) { await grid.press('ArrowDown'); await grid.press('ArrowRight'); }
  });
  await black.getByRole('button', { name: '创建对局', exact: true }).click();
  const room = black.locator('.room-info > code'); await room.waitFor();
  await white.getByRole('textbox', { name: '邀请码', exact: true }).fill(await room.textContent());
  await white.getByRole('button', { name: '加入对局', exact: true }).click();
  await Promise.all([black.getByText('对局进行中', { exact: true }).waitFor({ timeout: 30000 }), white.getByText('对局进行中', { exact: true }).waitFor({ timeout: 30000 })]);
  await check('coordinate preview is cancellable before any move proposal or signature is sent', async () => {
    await black.getByRole('checkbox', { name: '落子前确认坐标', exact: true }).check();
    const before = frameTypes.black.filter(x => x === 'propose').length;
    const grid = black.getByRole('grid'); await grid.focus(); await grid.press('Enter');
    await black.getByRole('dialog', { name: '确认落在 H8？', exact: true }).waitFor();
    assert.equal((await saved(black)).checkpoint.moves.length, 0);
    await shot(black, '01-coordinate-confirmation.png');
    await black.getByRole('dialog').press('Escape');
    assert.equal(frameTypes.black.filter(x => x === 'propose').length, before);
    assert.equal((await saved(black)).checkpoint.moves.length, 0);
    assert.equal(await grid.evaluate(node => node === document.activeElement), true);
  });
  await check('quota fault preserves newest real double signatures for download and blocks further play until save retry', async () => {
    await black.evaluate(() => {
      window.recoveryOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('gomoku-channel-v1:evidence:') && JSON.parse(value).checkpoint.moves.length) throw new DOMException('Injected full storage', 'QuotaExceededError');
        return window.recoveryOriginalSetItem.call(this, key, value);
      };
    });
    await cell(black, 112).click(); await black.getByRole('button', { name: '确认落子 H8', exact: true }).click();
    await Promise.all([confirmed(black, 1), confirmed(white, 1)]);
    await black.locator('[data-guide-stage="storage"]').waitFor();
    assert.equal((await saved(black)).checkpoint.moves.length, 0, 'disk still contains the older checkpoint');
    assert.equal(await black.locator('.intersection:not(:disabled)').count(), 0);
    const download = black.waitForEvent('download'); await black.getByRole('button', { name: '备份本局证据', exact: true }).click();
    const file = await download; const dest = path.join(OUT, 'quota-recovered-evidence.json'); await file.saveAs(dest);
    const evidence = JSON.parse(await fs.readFile(dest, 'utf8'));
    assert.equal(verifyEvidence(evidence).signed, true); assert.deepEqual(evidence.checkpoint.moves, [112]);
    assert.doesNotMatch(JSON.stringify(evidence), /privateKey|mnemonic|local-test-key|ai-session/);
    await shot(black, '02-storage-protection.png');
    const before = frameTypes.black.filter(x => x === 'propose' || x === 'ack').length;
    await black.evaluate(() => { Storage.prototype.setItem = window.recoveryOriginalSetItem; delete window.recoveryOriginalSetItem; });
    await black.getByRole('button', { name: '重试本地保存', exact: true }).click();
    await black.getByText('本地保存已核对', { exact: true }).waitFor();
    assert.deepEqual((await saved(black)).checkpoint.moves, [112]);
    assert.equal(frameTypes.black.filter(x => x === 'propose' || x === 'ack').length, before);
    results.observations.storageFault = { oldDiskMoves: 0, exportedSignedMoves: 1, retrySignedNewMove: false };
  });
  await check('same-room reconnect preserves signed progress, sends no chain transaction and requires manual proposal approval', async () => {
    await cell(white, 97).click(); await Promise.all([confirmed(black, 2), confirmed(white, 2)]);
    const before = await saved(black);
    await black.getByText('签名与异常实验', { exact: true }).click(); await black.getByRole('button', { name: '断开中继', exact: true }).click();
    await black.locator('[data-guide-stage="relay"]').waitFor();
    await black.getByRole('button', { name: '重连原房间', exact: true }).click();
    await black.getByText('中继在线', { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await black.getByRole('checkbox', { name: '自动确认对手提案', exact: true }).isChecked(), false);
    const after = await saved(black); assert.deepEqual(after.checkpoint, before.checkpoint); assert.equal(after.transactions.length, 2);
    await cell(black, 113).click(); await black.getByRole('button', { name: '确认落子 I8', exact: true }).click();
    await Promise.all([confirmed(black, 3), confirmed(white, 3)]);
    await cell(white, 98).click(); await black.locator('[data-guide-stage="pending"]').waitFor();
    assert.equal((await saved(black)).checkpoint.moves.length, 3);
    await shot(black, '03-reconnected-manual-approval.png');
    await black.getByRole('button', { name: '签名确认落子', exact: true }).click();
    await Promise.all([confirmed(black, 4), confirmed(white, 4)]);
    await black.getByRole('checkbox', { name: '自动确认对手提案', exact: true }).check();
    results.observations.reconnection = { beforeMoves: 2, restoredMoves: 2, successfulChainTransactions: after.transactions.length, automaticApprovalDisabled: true };
  });
  await check('recovered match completes a legal nine-move settlement and read-only keyboard review', async () => {
    for (let i = 4; i < BLACK_WIN.length; i++) {
      const page = i % 2 ? white : black, p = BLACK_WIN[i]; await cell(page, p).click();
      if (page === black) await black.getByRole('button', { name: `确认落子 ${String.fromCharCode(65 + p % 15)}${Math.floor(p / 15) + 1}`, exact: true }).click();
      await Promise.all([confirmed(black, i + 1), confirmed(white, i + 1)]);
    }
    await black.getByRole('button', { name: '链上结算本局', exact: true }).click();
    await black.getByText('已完成结算', { exact: true }).waitFor({ timeout: 30000 });
    await black.waitForFunction(() => Object.keys(localStorage).some(key => key.startsWith('gomoku-channel-v1:evidence:') && JSON.parse(localStorage.getItem(key)).onchain?.status === 'settled'));
    const evidence = await saved(black); assert.equal(evidence.transactions.length, 3); assert.equal(verifyEvidence(evidence).signed, true);
    await black.emulateMedia({ reducedMotion: 'reduce' });
    const animation = await black.locator('.stone').first().evaluate(el => getComputedStyle(el).animationDuration);
    assert.ok(parseFloat(animation) <= .001);
    await black.getByRole('button', { name: '切换为夜间主题', exact: true }).click(); await shot(black, '04-keyboard-dark-settled.png');
    await fs.writeFile(path.join(OUT, 'recovery-settled-evidence.json'), JSON.stringify(evidence, null, 2));
    results.observations.finalMatch = { signedMoves: 9, successfulTransactions: 3, status: evidence.onchain.status };
  });
  await check('touch layout defaults to confirmation and fits at 390 pixels with accessible keyboard grid', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage(); page.on('pageerror', e => results.errors.push(e.message)); await ready(page);
    assert.equal(await page.getByRole('checkbox', { name: '落子前确认坐标', exact: true }).isChecked(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.getByRole('grid').count(), 1); await shot(page, '05-touch-390.png'); await context.close();
  });
  assert.deepEqual(results.errors, []);
} catch (error) { results.failure = error.message; process.exitCode = 1; console.error(error); }
finally {
  await browser?.close();
  results.summary = { passed: results.tests.filter(t => t.status === 'passed').length, failed: results.tests.filter(t => t.status === 'failed').length };
  await fs.writeFile(path.join(OUT, 'e2e-recovery-results.json'), JSON.stringify(results, null, 2));
}
