import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const directory = 'artifacts/test-results/recovery-2026-11-05';
const finalDirectory = `${directory}/final-after-ack`;
const hash = data => createHash('sha256').update(data).digest('hex');
const unitFiles = ['ai', 'certificate', 'chain-runtime', 'channel-client-ai', 'channel-client-connect-race', 'channel-client-network', 'contract', 'dispute-security', 'evidence-chain', 'protocol', 'recovery-policy', 'recovery-regression'].map(x => `${x}-results.json`);
const browserFiles = ['e2e-results.json', 'e2e-external-results.json', 'e2e-recovery-results.json'];
async function collect(files) {
  const suites = [];
  for (const file of files) {
    const bytes = await fs.readFile(path.join(root, finalDirectory, file));
    const value = JSON.parse(bytes);
    if (value.summary.failed !== 0 || value.failure || value.errors?.length) throw Error(`Final suite is not clean: ${file}`);
    suites.push({ file: `${finalDirectory}/${file}`, passed: value.summary.passed, failed: value.summary.failed, sha256: hash(bytes), generatedAt: value.generatedAt });
  }
  return { passed: suites.reduce((sum, x) => sum + x.passed, 0), failed: 0, suites };
}
const units = await collect(unitFiles), browsers = await collect(browserFiles);
const sourceFiles = [
  'contracts/GomokuChannel.sol', 'server/index.mjs', 'server/chain-runtime.mjs', 'shared/gomoku.mjs', 'shared/evidence.mjs', 'shared/evidence-chain.mjs', 'shared/recovery-guide.mjs',
  'web/src/channel-client.js', 'web/src/game-repository.js', 'web/src/App.jsx', 'web/src/components/Board.jsx', 'web/src/components/MatchPanel.jsx', 'web/src/components/ExperimentPanel.jsx', 'web/src/components/RecoveryPanel.jsx', 'web/src/components/MoveConfirmation.jsx', 'web/src/styles/recovery.css', 'web/src/styles/index.css',
  'tests/recovery-policy.test.mjs', 'tests/recovery-regression.test.mjs', 'scripts/e2e.mjs', 'scripts/e2e-recovery.mjs', 'scripts/e2e-external.mjs', 'package.json', 'pnpm-lock.yaml',
];
const sourceSha256 = {};
for (const file of sourceFiles) sourceSha256[file] = hash(await fs.readFile(path.join(root, file)));
const summary = {
  generatedAt: new Date().toISOString(), node: process.version, timezone: 'Asia/Shanghai',
  unitAndIntegration: { passed: units.passed, failed: 0 }, browserScenarios: { passed: browsers.passed, failed: 0 },
  finalSuites: [...units.suites, ...browsers.suites], sourceSha256,
  originalRegressions: 144, newFaultAndPolicyTests: units.passed - 144,
  beforeFix: [
    { file: `${directory}/before-fix/recovery-regression-results.json`, expectedFailures: 4 },
    { file: `${directory}/before-ack-fix/recovery-regression-results.json`, expectedFailures: 1 },
  ],
  retainedIntermediateFailure: `${directory}/final/e2e-external-results.json`,
  commands: ['node scripts/verify.mjs', 'node scripts/e2e.mjs', 'node scripts/e2e-external.mjs', 'node scripts/e2e-recovery.mjs'],
  limitations: ['Automated controlled fixtures and real local EVM; no real user usability acceptance.', 'External wallet emulator is not a real browser extension acceptance.', 'No public deployment, real assets, distributed consensus or third-party security audit.', 'Web Storage is a single-browser recovery aid; failed unexported in-memory evidence cannot survive closing the page.'],
};
for (const red of summary.beforeFix) {
  const data = JSON.parse(await fs.readFile(path.join(root, red.file), 'utf8'));
  if (data.summary.failed !== red.expectedFailures) throw Error(`Missing red regression evidence: ${red.file}`);
}
await fs.writeFile(path.join(root, directory, 'review-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ automatic: summary.unitAndIntegration, browser: summary.browserScenarios, sourceHashes: sourceFiles.length }));
