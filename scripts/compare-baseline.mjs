#!/usr/bin/env node
// Gate de regressão: compara o resultado atual com a baseline versionada.
//
//   node scripts/compare-baseline.mjs <profile>            → compara (exit 1 se regrediu)
//   node scripts/compare-baseline.mjs <profile> --update   → promove o resultado atual a baseline
//
// Thresholds absolutos (SLO) pegam "está ruim"; este gate pega "ficou pior" —
// a regressão de 40% que ainda cabe no SLO e passaria despercebida.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';

const [profile = 'load', flag] = process.argv.slice(2);
const TOLERANCE = Number(process.env.REGRESSION_TOLERANCE ?? 0.15); // +15% de latência
const NOISE_FLOOR_MS = Number(process.env.REGRESSION_NOISE_FLOOR_MS ?? 15); // ignora variações minúsculas
const ERROR_DELTA = Number(process.env.REGRESSION_ERROR_DELTA ?? 0.005); // +0,5 p.p. de erro

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
const byFlow = (s) => Object.fromEntries(s.flows.map((f) => [f.flow, f]));
const base = byFlow(baseline);

const fmtDelta = (now, before) => {
  if (!before) return 'n/a';
  const d = (now - before) / before;
  return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%`;
};

const regressions = [];
const rows = current.flows.map((f) => {
  const b = base[f.flow];
  if (!b) return `| ${f.flow} | ${f.p95} | — | novo | ${f.p99} | — | ${(f.errorRate * 100).toFixed(2)}% | — | 🆕 |`;

  const issues = [];
  for (const stat of ['p95', 'p99']) {
    if (f[stat] - b[stat] > NOISE_FLOOR_MS && f[stat] > b[stat] * (1 + TOLERANCE)) issues.push(`${stat} ${fmtDelta(f[stat], b[stat])}`);
  }
  if (f.errorRate - b.errorRate > ERROR_DELTA) issues.push(`erros +${((f.errorRate - b.errorRate) * 100).toFixed(2)}pp`);
  if (issues.length) regressions.push(`${f.flow}: ${issues.join(', ')}`);

  return `| ${f.flow} | ${f.p95} | ${b.p95} | ${fmtDelta(f.p95, b.p95)} | ${f.p99} | ${b.p99} | ${(f.errorRate * 100).toFixed(2)}% | ${(b.errorRate * 100).toFixed(2)}% | ${issues.length ? '🔴' : '🟢'} |`;
});

report(
  [
    `### Regressão vs baseline — \`${profile}\``,
    `Baseline: \`${baseline.meta.testId}\` · tolerância +${TOLERANCE * 100}% (piso ${NOISE_FLOOR_MS}ms) · erros +${ERROR_DELTA * 100}pp`,
    '',
    '| Fluxo | p95 atual | p95 base | Δ | p99 atual | p99 base | erros atual | erros base | |',
    '|---|--:|--:|--:|--:|--:|--:|--:|:-:|',
    ...rows,
    '',
    regressions.length ? `**❌ Regressão detectada:** ${regressions.join(' · ')}` : '**✅ Sem regressão de performance.**',
  ].join('\n'),
);

process.exit(regressions.length ? 1 : 0);
