// 界面可访问性与排版的程序化审计，与截图目测互补；不等同于完整 WCAG 认证。
// 检查：可见文字 >= 12px（棋盘坐标/手数除外）、关键文字对比度 >= 4.5:1、四个页面均无横向溢出、
// 所有按钮/输入都有可访问名称、棋盘 225 个按钮均有“落子 行,列”名称。
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = process.cwd(), OUT = path.join(ROOT, 'artifacts/test-results');
const base = process.env.TEST_URL || 'http://127.0.0.1:4173';
const report = { generatedAt: new Date().toISOString(), url: base, checks: [] };

// 在浏览器里计算 WCAG 相对亮度与对比度。
const pageFns = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const [r, g, b, a = 1] = m[1].split(',').map(Number); return { r, g, b, a }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  // 向上找第一个不透明背景色；找不到就用 body 背景。
  const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0.95) return c; } return parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; };
  return { parse, ratio, bgOf };
};

async function audit(page, label) {
  return page.evaluate(({ label, src }) => {
    const { parse, ratio, bgOf } = new Function(`return (${src})`)()();
    const out = { label, smallText: [], lowContrast: [], unnamed: [] };
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own || !el.offsetParent) continue;
      const cs = getComputedStyle(el);
      const size = parseFloat(cs.fontSize);
      const text = el.textContent.trim().slice(0, 20);
      if (size < 12 && !el.closest('.board-coordinates, .stone-no')) out.smallText.push(`${text}:${size}px`);
      const fg = parse(cs.color), bg = bgOf(el);
      if (fg) {
        const r = ratio(fg, bg), large = size >= 24 || (size >= 18.667 && Number(cs.fontWeight) >= 700);
        const key = `${cs.color}|${bg.r},${bg.g},${bg.b}`;
        if (r < (large ? 3 : 4.5) && !seen.has(key)) { seen.add(key); out.lowContrast.push({ text, ratio: Math.round(r * 100) / 100, size, color: cs.color }); }
      }
    }
    for (const el of document.querySelectorAll('button, input, select')) {
      if (!el.offsetParent) continue;
      const name = el.getAttribute('aria-label') || el.labels?.[0]?.textContent?.trim() || el.textContent.trim() || el.getAttribute('title');
      if (!name) out.unnamed.push(el.outerHTML.slice(0, 80));
    }
    return out;
  }, { label, src: pageFns.toString() });
}

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: true, args: ['--no-first-run', '--disable-sync'], env: { ...process.env, TEMP: path.join(ROOT, '.tmp'), TMP: path.join(ROOT, '.tmp') } });
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(base); await page.getByText('本地链已连接', { exact: false }).waitFor({ timeout: 30000 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    for (const tab of ['对局大厅', '通道实验室', '对局记录', '项目说明']) {
      await page.getByRole('button', { name: tab, exact: true }).click();
      await page.waitForTimeout(250);
      const r = await audit(page, `${theme}/${tab}`);
      r.overflowX = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      report.checks.push(r);
    }
  }
  const board = await page.getByRole('button', { name: '对局大厅', exact: true }).click().then(() => page.getByRole('button', { name: /^落子 \d+,\d+$/ }).count());
  report.boardButtons = board;
} finally { await browser.close(); }
const failures = report.checks.flatMap((c) => [
  ...c.lowContrast.map((x) => `${c.label} 对比度 ${x.ratio} < 阈值: "${x.text}" ${x.color}`),
  ...c.unnamed.map((x) => `${c.label} 无可访问名称: ${x}`),
  ...c.smallText.map((x) => `${c.label} 小于12px: ${x}`),
  ...(c.overflowX ? [`${c.label} 横向溢出`] : []),
]);
if (report.boardButtons !== 225) failures.push(`棋盘按钮数 ${report.boardButtons} != 225`);
report.failures = failures;
report.summary = { pages: report.checks.length, failures: failures.length, smallTextPages: report.checks.filter((c) => c.smallText.length).length };
await fs.writeFile(path.join(OUT, 'ui-audit.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.summary), failures.slice(0, 20).join('\n'));
process.exitCode = failures.length ? 1 : 0;
