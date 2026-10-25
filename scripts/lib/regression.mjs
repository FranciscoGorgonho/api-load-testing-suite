// Regra de regressão: função pura, sem I/O — testável isoladamente.

export const DEFAULTS = {
  tolerance: 0.15, // +15% de latência
  noiseFloorMs: 15, // ignora variações minúsculas
  errorDelta: 0.005, // +0,5 p.p. de erro
};

/**
 * Compara os fluxos do resultado atual com a baseline.
 * @returns {Array<{ flow: string, current: object, baseline?: object, status: 'new'|'ok'|'regression', issues: string[] }>}
 */
export function compareFlows(current, baseline, opts = {}) {
  const { tolerance, noiseFloorMs, errorDelta } = { ...DEFAULTS, ...opts };
  const base = Object.fromEntries(baseline.flows.map((f) => [f.flow, f]));

  return current.flows.map((f) => {
    const b = base[f.flow];
    if (!b) return { flow: f.flow, current: f, status: 'new', issues: [] };

    const issues = [];
    for (const stat of ['p95', 'p99']) {
      if (f[stat] - b[stat] > noiseFloorMs && f[stat] > b[stat] * (1 + tolerance)) {
        issues.push(`${stat} ${formatDelta(f[stat], b[stat])}`);
      }
    }
    if (f.errorRate - b.errorRate > errorDelta) {
      issues.push(`erros +${((f.errorRate - b.errorRate) * 100).toFixed(2)}pp`);
    }
    return { flow: f.flow, current: f, baseline: b, status: issues.length ? 'regression' : 'ok', issues };
  });
}

export function formatDelta(now, before) {
  if (!before) return 'n/a';
  const d = (now - before) / before;
  return `${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%`;
}
