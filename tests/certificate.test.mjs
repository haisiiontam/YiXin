// 对局证书测试：用真实 EIP-712 双签证据验证 SVG 生成、篡改拒绝、转义与体积。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Wallet, keccak256, id } from 'ethers';
import { evaluate, movesHex, BLACK_WIN, STATE_TYPES } from '../shared/gomoku.mjs';
import { verifyEvidence } from '../shared/evidence.mjs';
import { buildCertificateSvg, certificateFileName, escapeXml } from '../shared/certificate.mjs';

const results = [];
function check(name, fn) { test(name, async () => { try { await fn(); results.push({ name, status: 'passed' }); } catch (e) { results.push({ name, status: 'failed', error: e.message }); throw e; } }); }
process.on('exit', () => {
  fs.mkdirSync('artifacts/test-results', { recursive: true });
  fs.writeFileSync('artifacts/test-results/certificate-results.json', JSON.stringify({ generatedAt: new Date().toISOString(), tests: results, summary: { passed: results.filter(t => t.status === 'passed').length, failed: results.filter(t => t.status === 'failed').length } }, null, 2));
});

const domain = { name: 'GomokuChannel', version: '1', chainId: 31337, verifyingContract: '0x0000000000000000000000000000000000000001' };
const black = Wallet.createRandom(), white = Wallet.createRandom();
const channelId = id('certificate-test');
const TX_HASHES = [id('tx-1'), id('tx-2'), id('tx-3')];
const short = (s, h, t) => `${s.slice(0, h)}…${s.slice(-t)}`;

/** 构造带双签的真实证据。 */
async function makeEvidence(moves, extra = {}) {
  const value = { channelId, movesHash: keccak256(movesHex(moves)) };
  return {
    format: 'gomoku-channel-evidence/v1', exportedAt: '2026-01-02T03:04:05.000Z', domain, channelId,
    participants: { black: black.address, white: white.address }, stake: 10,
    checkpoint: { moves, sigBlack: await black.signTypedData(domain, STATE_TYPES, value), sigWhite: await white.signTypedData(domain, STATE_TYPES, value) },
    onchain: { status: 'Settled', moves, winner: evaluate(moves).winner, reason: 'test', deadline: 0 },
    transactions: [
      { label: '锁定黑方积分', hash: TX_HASHES[0], gasUsed: '100', blockNumber: 1 },
      { label: '锁定白方积分', hash: TX_HASHES[1], gasUsed: '100', blockNumber: 2 },
      { label: '提交终局', hash: TX_HASHES[2], gasUsed: '100', blockNumber: 3 },
    ],
    metrics: { onchainTransactions: 3, offchainMoves: moves.length, baselineTransactions: moves.length + 2, savedPercent: 72.7, totalGas: '300' },
    ...extra,
  };
}

/** 极简 XML 标签配对检查：栈匹配，忽略序言、注释和自闭合标签。 */
function assertBalancedTags(xml) {
  const stack = [];
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const tagRe = /<(\/?)([A-Za-z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let m;
  while ((m = tagRe.exec(body))) {
    const [, closing, name, , selfClose] = m;
    if (selfClose) continue;
    if (!closing) stack.push(name);
    else assert.equal(stack.pop(), name, `标签不匹配: </${name}>`);
  }
  assert.equal(stack.length, 0, `未闭合标签: ${stack.join(',')}`);
  assert.equal(body.replace(tagRe, '').includes('<'), false, '存在未转义的 <');
}

/** 225 手和棋：黑占 (⌊col/2⌋+row) 为偶数的点（共 113 个），白占其余 112 个，双方都无五连；交替落子得到合法棋谱。 */
function drawnGame() {
  const B = [], W = [];
  for (let p = 0; p < 225; p++) (((Math.floor((p % 15) / 2) + Math.floor(p / 15)) % 2) === 0 ? B : W).push(p);
  const moves = [];
  for (let i = 0; i < 225; i++) moves.push(i % 2 ? W[(i - 1) / 2] : B[i / 2]);
  return moves;
}

check('(a) 黑胜证书：结构、关键文字、无脚本/外链，且只透传预期的十六进制字段', async () => {
  const evidence = await makeEvidence(BLACK_WIN);
  const svg = buildCertificateSvg(evidence);
  assert.ok(svg.startsWith('<svg '));
  assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(svg.includes('viewBox="0 0 840 1188"'));
  assert.ok(svg.includes(channelId.slice(0, 10)));
  assert.ok(svg.includes(short(black.address, 6, 4)) && svg.includes(short(white.address, 6, 4)));
  assert.ok(svg.includes(black.address) && svg.includes(white.address), '完整地址应放在 <title> 中');
  assert.ok(svg.includes('黑方') && svg.includes('9 手') && svg.includes('黑方执胜 · 共 9 手'));
  assert.ok(svg.includes('交易参考 3 条（未核验回执）'));
  assert.ok(svg.includes('不核验链上结算或回执'));
  assert.ok(!svg.includes('较逐步上链减少'));
  assert.ok(svg.includes('锁定黑方积分'));
  assert.ok(!svg.includes('<script') && !svg.includes('foreignObject') && !svg.includes('<image') && !/href=/.test(svg));
  assert.equal(svg.split('http://').length - 1, 1, '只允许 xmlns 中的一处 http://');
  assert.equal(svg.split('https://').length - 1, 0);
  // 所有 64 位十六进制串必须来自我们明确传入的 channelId / digest / 交易哈希
  const verified = verifyEvidence(evidence);
  const allowed = new Set([channelId, verified.digest, ...TX_HASHES].map(s => s.toLowerCase()));
  for (const hit of svg.match(/0x[0-9a-fA-F]{64}/g) || []) assert.ok(allowed.has(hit.toLowerCase()), `出现未预期的 64 位十六进制串 ${hit}`);
  assert.equal(/(?<![0-9a-fA-F])[0-9a-fA-F]{64}(?![0-9a-fA-F])/.test(svg.replace(/0x[0-9a-fA-F]{64}/g, '')), false);
  assert.ok(!svg.includes(evidence.checkpoint.sigBlack) && !svg.includes(evidence.checkpoint.sigWhite), '签名不应写入证书');
  assertBalancedTags(svg);
});

check('(b) 篡改棋谱或交换签名时 buildCertificateSvg 抛错', async () => {
  const evidence = await makeEvidence(BLACK_WIN);
  const moved = structuredClone(evidence); moved.checkpoint.moves[0] = 0;
  assert.throws(() => buildCertificateSvg(moved));
  const swapped = structuredClone(evidence); swapped.checkpoint.sigWhite = swapped.checkpoint.sigBlack;
  assert.throws(() => buildCertificateSvg(swapped));
  const wrongFormat = structuredClone(evidence); wrongFormat.format = 'other';
  assert.throws(() => buildCertificateSvg(wrongFormat));
});

check('(c) 交易标签中的 HTML/XML 特殊字符被转义，不以原文出现', async () => {
  const evil = '<img src=x onerror=1>&"';
  const evidence = await makeEvidence(BLACK_WIN);
  evidence.transactions[0].label = evil;
  const svg = buildCertificateSvg(evidence, { levelName: '<b>难度</b>', title: 'a<b>' });
  assert.ok(!svg.includes(evil));
  assert.ok(!svg.includes('<img'));
  assert.ok(svg.includes(escapeXml(evil)));
  assert.ok(!svg.includes('<b>'));
  assert.equal(escapeXml(`a&<>"'\u0001\u0007b`), 'a&amp;&lt;&gt;&quot;&apos;b');
  assertBalancedTags(svg);
});

check('(d) 225 手和棋证书体积小于 60000 字符，且显示和棋', async () => {
  const moves = drawnGame();
  const e = evaluate(moves);
  assert.equal(moves.length, 225);
  assert.ok(e.terminal && e.winner === 0);
  const svg = buildCertificateSvg(await makeEvidence(moves));
  assert.ok(svg.length < 60000, `实际长度 ${svg.length}`);
  assert.ok(svg.includes('和棋 · 共 225 手'));
  assertBalancedTags(svg);
});

check('(d2) 未终局对局显示“对局进行中/未终局”', async () => {
  const svg = buildCertificateSvg(await makeEvidence(BLACK_WIN.slice(0, 6)));
  assert.ok(svg.includes('对局进行中/未终局'));
  assertBalancedTags(svg);
});

check('(e) 深色主题与浅色主题不同，且包含 #16130f', async () => {
  const evidence = await makeEvidence(BLACK_WIN);
  const light = buildCertificateSvg(evidence), dark = buildCertificateSvg(evidence, { theme: 'dark' });
  assert.notEqual(light, dark);
  assert.ok(dark.includes('#16130f') && !light.includes('#16130f'));
  assert.ok(light.includes('#f4efe6'));
  assertBalancedTags(dark);
});

check('篡改未签名的链上元数据不能伪装为证书已核验的结算或节省', async () => {
  const evidence = await makeEvidence(BLACK_WIN);
  const forged = structuredClone(evidence);
  forged.metrics.savedPercent = 123456789;
  forged.onchain.status = 'settled';
  forged.onchain.winner = 2;
  forged.stake = 999;
  const svg = buildCertificateSvg(forged);
  assert.ok(svg.includes('黑方执胜 · 共 9 手'), '胜负来自签名棋谱而非自述 winner');
  assert.ok(svg.includes('积分（文件自述）') && svg.includes('未核验链上值'));
  assert.ok(svg.includes('交易参考 3 条（未核验回执）'));
  assert.ok(!svg.includes('123456789') && !svg.includes('较逐步上链'));
  assert.equal(buildCertificateSvg({ ...forged, metrics: { savedPercent: -87654321 } }), svg, '未签名指标不影响证书');
});

check('(f) 证书文件名格式', async () => {
  const evidence = await makeEvidence(BLACK_WIN);
  assert.equal(certificateFileName(evidence), `gomoku-certificate-${channelId.slice(2, 12)}.svg`);
  assert.match(certificateFileName(evidence), /^gomoku-certificate-[0-9a-f]{10}\.svg$/);
});

check('示例证书写入 artifacts/samples（浅色与深色）', async () => {
  const evidence = await makeEvidence(BLACK_WIN);
  fs.mkdirSync('artifacts/samples', { recursive: true });
  fs.writeFileSync('artifacts/samples/certificate-sample-light.svg', buildCertificateSvg(evidence, { levelName: '示例 · 九手速胜' }));
  fs.writeFileSync('artifacts/samples/certificate-sample-dark.svg', buildCertificateSvg(evidence, { theme: 'dark', levelName: '示例 · 九手速胜' }));
});
