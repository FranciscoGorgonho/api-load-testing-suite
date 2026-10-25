#!/usr/bin/env node
// Gate de regressão: compara o resultado atual com a baseline versionada.
//
//   node scripts/compare-baseline.mjs <profile>            → compara (exit 1 se regrediu)
//   node scripts/compare-baseline.mjs <profile> --update   → promove o resultado atual a baseline
//
// Thresholds absolutos (SLO) pegam "está ruim"; este gate pega "ficou pior" —
// a regressão de 40% que ainda cabe no SLO e passaria despercebida.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { compareFlows, DEFAULTS, formatDelta } from './lib/regression.mjs';

const [profile = 'load', flag] = process.argv.slice(2);
const opts = {
  tolerance: Number(process.env.REGRESSION_TOLERANCE ?? DEFAULTS.tolerance),
  noiseFloorMs: Number(process.env.REGRESSION_NOISE_FLOOR_MS ?? DEFAULTS.noiseFloorMs),
  errorDelta: Number(process.env.REGRESSION_ERROR_DELTA ?? DEFAULTS.errorDelta),
};

const currentPath = `results/${profile}-summary.json`;
const baselinePath = `baselines/${profile}.json`;

if (!existsSync(currentPath)) {
  console.error(`Resultado não encontrado: ${currentPath}. Rode o perfil "${profile}" antes.`);
  process.exit(2);
}

if (flag === '--update') {
  mkdirSync('baselines', { recursive: true });
  copyFileSync(currentPath, baselinePath);
  console.log(`Baseline atualizada: ${baselinePath}`);
  process.exit(0);
}

const report = (md) => {
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${md}\n`);
};

if (!existsSync(baselinePath)) {
  report(`> ℹ️ Sem baseline para **${profile}**. Rode \`npm run baseline:update\` para criar uma.`);
  process.exit(0);
}

const current = JSON.parse(readFileSync(currentPath, 'utf8'));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const results = compareFlows(current, baseline, opts);
const regressions = results.filter((r) => r.status === 'regression');

const pctErr = (n) => `${(n * 100).toFixed(2)}%`;
const icon = { ok: '🟢', regression: '🔴', new: '🆕' };
const rows = results.map(({ flow, current: f, baseline: b, status }) =>
  b
    ? `| ${flow} | ${f.p95} | ${b.p95} | ${formatDelta(f.p95, b.p95)} | ${f.p99} | ${b.p99} | ${pctErr(f.errorRate)} | ${pctErr(b.errorRate)} | ${icon[status]} |`
    : `| ${flow} | ${f.p95} | — | novo | ${f.p99} | — | ${pctErr(f.errorRate)} | — | ${icon[status]} |`,
);

report(
  [
    `### Regressão vs baseline — \`${profile}\``,
    `Baseline: \`${baseline.meta.testId}\` · tolerância +${opts.tolerance * 100}% (piso ${opts.noiseFloorMs}ms) · erros +${opts.errorDelta * 100}pp`,
    '',
    '| Fluxo | p95 atual | p95 base | Δ | p99 atual | p99 base | erros atual | erros base | |',
    '|---|--:|--:|--:|--:|--:|--:|--:|:-:|',
    ...rows,
    '',
    regressions.length
      ? `**❌ Regressão detectada:** ${regressions.map((r) => `${r.flow}: ${r.issues.join(', ')}`).join(' · ')}`
      : '**✅ Sem regressão de performance.**',
  ].join('\n'),
);

process.exit(regressions.length ? 1 : 0);
