// Relatório HTML autocontido (sem CDN): abre offline e serve como artefato de CI.

import type { CompactSummary, StageResult } from './summary.ts';
import { KNEE_CRITERIA } from '../config/slos.ts';
import { brl, pct } from './format.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function kneeChart(stages: StageResult[], kneeStage?: number): string {
  const W = 760, H = 260, pad = { l: 48, r: 48, t: 16, b: 32 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const maxP95 = Math.max(KNEE_CRITERIA.p95 * 1.5, ...stages.map((s) => s.p95));
  const maxRps = Math.max(1, ...stages.map((s) => s.achievedReqPerS));
  const bw = iw / stages.length;
  const y = (v: number, max: number) => pad.t + ih - (v / max) * ih;

  const bars = stages
    .map((s, i) => {
      const x = pad.l + i * bw + bw * 0.15;
      const cls = kneeStage && s.index >= kneeStage ? 'bar bad' : 'bar';
      return `<rect class="${cls}" x="${x}" y="${y(s.p95, maxP95)}" width="${bw * 0.7}" height="${pad.t + ih - y(s.p95, maxP95)}"><title>Estágio ${s.index}: p95 ${s.p95}ms</title></rect>`;
    })
    .join('');
  const line = stages.map((s, i) => `${pad.l + i * bw + bw / 2},${y(s.achievedReqPerS, maxRps)}`).join(' ');
  const sloY = y(KNEE_CRITERIA.p95, maxP95);
  const labels = stages.map((s, i) => `<text class="tick" x="${pad.l + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle">${s.index}</text>`).join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="p95 e throughput por estágio">
    ${bars}
    <line class="slo" x1="${pad.l}" x2="${W - pad.r}" y1="${sloY}" y2="${sloY}"/>
    <text class="tick" x="${pad.l + 4}" y="${sloY - 4}">critério p95 ${KNEE_CRITERIA.p95}ms</text>
    <polyline class="rps" points="${line}"/>
    <text class="tick" x="${pad.l - 6}" y="${pad.t + 10}" text-anchor="end">${Math.round(maxP95)}ms</text>
    <text class="tick" x="${W - pad.r + 6}" y="${pad.t + 10}">${Math.round(maxRps)} req/s</text>
    ${labels}
  </svg>
  <p class="legend"><span class="sw bar"></span>p95 por estágio <span class="sw bad"></span>após a ruptura <span class="sw rps"></span>req/s atingido</p>`;
}

export function renderHtml(s: CompactSummary): string {
  const verdict = { PASS: ['ok', 'Aprovado'], FAIL: ['bad', 'Reprovado'], EXPLORATORY: ['info', 'Exploratório'] }[s.verdict];

  const flowRows = s.flows
    .map((f) => {
      const budget = Number.isFinite(f.budgetConsumed) ? Math.min(f.budgetConsumed, 1) : 1;
      const budgetCls = budget >= 1 ? 'bad' : budget >= 0.5 ? 'warn' : 'ok';
      return `<tr>
        <td><span class="dot ${f.pass ? 'ok' : 'bad'}"></span>${f.flow}</td>
        <td class="num">${f.requests}${f.lowSample ? ' <span class="chip" title="Poucas amostras: p95/p99 pouco confiáveis">amostra baixa</span>' : ''}</td>
        <td class="num ${f.p95 >= f.slo.p95 ? 'bad-t' : ''}">${f.p95} <small>/ ${f.slo.p95}</small></td>
        <td class="num ${f.p99 >= f.slo.p99 ? 'bad-t' : ''}">${f.p99} <small>/ ${f.slo.p99}</small></td>
        <td class="num ${f.errorRate >= f.slo.maxErrorRate ? 'bad-t' : ''}">${pct(f.errorRate, 3)} <small>/ ${pct(f.slo.maxErrorRate, 1)}</small></td>
        <td><div class="meter"><div class="${budgetCls}" style="width:${(budget * 100).toFixed(1)}%"></div></div>
            <small>${Number.isFinite(f.budgetConsumed) ? pct(f.budgetConsumed, 0) : '∞'}</small></td>
      </tr>`;
    })
    .join('');

  const endpointRows = s.endpoints
    .map((e) => `<tr><td><code>${esc(e.name)}</code></td><td class="num">${e.count}</td><td class="num">${e.avg}</td><td class="num">${e.p95}</td><td class="num">${e.p99}</td></tr>`)
    .join('');

  const knee = s.knee
    ? `<section><h2>Ponto de ruptura</h2>
        <p class="lead">${
          s.knee.kneeStage
            ? `O sistema rompeu no <strong>estágio ${s.knee.kneeStage}</strong>. Capacidade saudável estimada: <strong>≈ ${s.knee.maxHealthyJourneysPerS ?? 0} jornadas/s</strong> (p95 ≤ ${KNEE_CRITERIA.p95}ms e erros ≤ ${pct(KNEE_CRITERIA.errorRate, 0)}).`
            : 'O critério de ruptura não foi atingido — o sistema suportou toda a rampa. Aumente a carga para encontrar o limite.'
        }</p>
        ${kneeChart(s.knee.stages, s.knee.kneeStage)}
        <table><thead><tr><th>Estágio</th><th class="num">Duração</th><th class="num">Alvo (jornadas/s)</th><th class="num">Atingido (req/s)</th><th class="num">p95 (ms)</th><th class="num">Erros</th></tr></thead>
        <tbody>${s.knee.stages
          .map((st) => `<tr class="${st.healthy ? '' : 'row-bad'}"><td>${st.index}</td><td class="num">${st.durationS}s</td><td class="num">${st.targetJourneysPerS}</td><td class="num">${st.achievedReqPerS}</td><td class="num">${st.p95}</td><td class="num">${pct(st.errorRate)}</td></tr>`)
          .join('')}</tbody></table>
      </section>`
    : '';

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Performance · ${esc(s.meta.profile)}</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--ok:#1f8a5b;--warn:#c58a00;--bad:#c4372f;--info:#2f62c4;--accent:#5b5bd6}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--fg:#ecebe6;--muted:#9c9b95;--line:#33322f;--ok:#3fbf86;--warn:#e0a826;--bad:#ef6a60;--info:#6f98ef;--accent:#8f8ff0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:32px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:24px}
h1{font-size:22px;margin:0}h2{font-size:16px;margin:0 0 12px}.sub{color:var(--muted);font-size:13px}
.badge{padding:6px 14px;border-radius:999px;font-weight:600;color:#fff}.badge.ok{background:var(--ok)}.badge.bad{background:var(--bad)}.badge.info{background:var(--info)}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:16px;overflow-x:auto}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.kpi{border:1px solid var(--line);border-radius:10px;padding:12px}.kpi b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.kpi span{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:8px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted);font-weight:500;font-size:12px}
.num{text-align:right;font-variant-numeric:tabular-nums}small{color:var(--muted)}.bad-t{color:var(--bad);font-weight:600}.row-bad td{color:var(--bad)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px}.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}
.meter{display:inline-block;width:90px;height:8px;background:var(--line);border-radius:4px;vertical-align:middle;margin-right:6px;overflow:hidden}
.meter div{height:100%}.meter .ok{background:var(--ok)}.meter .warn{background:var(--warn)}.meter .bad{background:var(--bad)}
.lead{margin:0 0 12px}svg{width:100%;height:auto}.bar{fill:var(--accent);opacity:.75}.bar.bad,.sw.bad{fill:var(--bad);background:var(--bad)}
.slo{stroke:var(--bad);stroke-dasharray:4 4}.rps{fill:none;stroke:var(--ok);stroke-width:2.5}.tick{fill:var(--muted);font-size:11px}
.legend{color:var(--muted);font-size:12px}.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin:0 4px 0 12px;vertical-align:middle}.sw.bar{background:var(--accent)}.sw.rps{background:var(--ok)}
.chip{display:inline-block;padding:1px 8px;border-radius:999px;border:1px solid var(--warn);color:var(--warn);font-size:11px;margin-left:6px;white-space:nowrap}
.fails{color:var(--bad);font-family:ui-monospace,monospace;font-size:13px}
</style></head><body><main>
<header><div><h1>Relatório de Performance — ${esc(s.meta.profile)}</h1>
<div class="sub">${esc(s.meta.description)} · ${esc(s.meta.env)} (${esc(s.meta.baseUrl)}) · ${s.meta.durationS}s · ${esc(s.meta.testId)}</div></div>
<span class="badge ${verdict[0]}">${verdict[1]}</span></header>

<section><div class="kpis">
  <div class="kpi"><b>${s.throughput.reqPerS}</b><span>req/s médio</span></div>
  <div class="kpi"><b>${pct(s.throughput.checksRate)}</b><span>checks funcionais</span></div>
  <div class="kpi"><b>${s.business.ordersConfirmed}</b><span>pedidos confirmados</span></div>
  <div class="kpi"><b>${pct(s.business.conversionRate)}</b><span>conversão sessão → pedido</span></div>
  <div class="kpi"><b>${brl(s.business.revenueConfirmed)}</b><span>receita confirmada</span></div>
  <div class="kpi"><b style="color:${s.business.revenueAtRisk > 0 ? 'var(--bad)' : 'inherit'}">${brl(s.business.revenueAtRisk)}</b><span>receita em risco</span></div>
</div>
${s.throughput.droppedIterations ? `<p class="fails">⚠ ${s.throughput.droppedIterations} iterações descartadas: o gerador de carga não acompanhou a taxa alvo.</p>` : ''}
${s.failedThresholds.length ? `<p class="fails">Thresholds violados:<br>${s.failedThresholds.map(esc).join('<br>')}</p>` : ''}
</section>

<section><h2>SLOs por fluxo</h2>
<table><thead><tr><th>Fluxo</th><th class="num">Reqs</th><th class="num">p95 / SLO (ms)</th><th class="num">p99 / SLO (ms)</th><th class="num">Erros / SLO</th><th>Error budget</th></tr></thead>
<tbody>${flowRows}</tbody></table></section>

${knee}

<section><h2>Endpoints (ordenados por p95)</h2>
<table><thead><tr><th>Endpoint</th><th class="num">Reqs</th><th class="num">média</th><th class="num">p95</th><th class="num">p99</th></tr></thead>
<tbody>${endpointRows}</tbody></table></section>

<p class="sub">Gerado em ${esc(s.meta.generatedAt)} · jornada de compra p95 ${s.business.journeyP95}ms</p>
</main></body></html>`;
}
