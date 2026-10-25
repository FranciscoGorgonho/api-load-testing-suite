// handleSummary: transforma as métricas brutas do k6 em decisão.
// Saídas: console enxuto, JSON compacto (gate de baseline) e relatório HTML.

import type { Profile } from '../config/profiles.ts';
import type { Environment } from '../config/environments.ts';
import { FLOWS, KNEE_CRITERIA, MIN_SAMPLES_FOR_PERCENTILES, SLOS, type Flow } from '../config/slos.ts';
import { ENDPOINTS } from '../lib/http.ts';
import { stageErrorsMetric, stageLatencyMetric } from '../lib/stages.ts';
import { renderHtml } from './html.ts';
import { brl, pct, round } from './format.ts';

interface MetricData {
  type: string;
  values: Record<string, number>;
  thresholds?: Record<string, { ok: boolean }>;
}
export interface SummaryData {
  metrics: Record<string, MetricData | undefined>;
  state: { testRunDurationMs: number };
}
interface Context {
  profile: Profile;
  env: Environment & { name: string };
  testId: string;
}

export interface FlowResult {
  flow: Flow;
  requests: number;
  failed: number;
  p95: number;
  p99: number;
  errorRate: number;
  slo: (typeof SLOS)[Flow];
  pass: boolean;
  /** Fração do error budget consumida (1 = 100%). */
  budgetConsumed: number;
  /** Poucas requisições para percentis confiáveis (< MIN_SAMPLES_FOR_PERCENTILES). */
  lowSample: boolean;
}

export interface StageResult {
  index: number;
  durationS: number;
  targetJourneysPerS: number;
  achievedReqPerS: number;
  p95: number;
  errorRate: number;
  healthy: boolean;
}

export interface CompactSummary {
  meta: { testId: string; profile: string; description: string; env: string; baseUrl: string; durationS: number; generatedAt: string };
  verdict: 'PASS' | 'FAIL' | 'EXPLORATORY';
  failedThresholds: string[];
  throughput: { reqPerS: number; requests: number; iterations: number; droppedIterations: number; checksRate: number };
  flows: FlowResult[];
  endpoints: Array<{ name: string; avg: number; p95: number; p99: number; count: number }>;
  business: {
    sessions: number;
    ordersConfirmed: number;
    conversionRate: number;
    checkoutSuccessRate: number;
    revenueConfirmed: number;
    revenueAtRisk: number;
    journeyP95: number;
  };
  knee?: { stages: StageResult[]; kneeStage?: number; maxHealthyJourneysPerS?: number };
}

export function buildSummary(data: SummaryData, ctx: Context): Record<string, string> {
  const m = (name: string) => data.metrics[name]?.values ?? {};
  const durationS = data.state.testRunDurationMs / 1000;

  const failedThresholds = Object.entries(data.metrics).flatMap(([name, metric]) =>
    Object.entries(metric?.thresholds ?? {})
      .filter(([, t]) => !t.ok)
      .map(([expr]) => `${name}: ${expr}`),
  );

  const flows: FlowResult[] = FLOWS.map((flow) => {
    const duration = m(`http_req_duration{flow:${flow}}`);
    const failedRate = m(`http_req_failed{flow:${flow}}`);
    const requests = (failedRate.passes ?? 0) + (failedRate.fails ?? 0);
    const failed = failedRate.passes ?? 0; // em http_req_failed, "pass" = requisição falhou
    const slo = SLOS[flow];
    const errorRate = requests ? failed / requests : 0;
    const allowed = slo.maxErrorRate * requests;
    return {
      flow,
      requests,
      failed,
      p95: round(duration['p(95)']),
      p99: round(duration['p(99)']),
      errorRate: round(errorRate, 5),
      slo,
      pass: requests > 0 && duration['p(95)'] < slo.p95 && duration['p(99)'] < slo.p99 && errorRate < slo.maxErrorRate,
      budgetConsumed: round(allowed > 0 ? failed / allowed : failed > 0 ? Infinity : 0, 3),
      lowSample: requests < MIN_SAMPLES_FOR_PERCENTILES,
    };
  });

  const endpoints = Object.values(ENDPOINTS)
    .map(({ name }) => {
      const v = m(`http_req_duration{name:${name}}`);
      return { name, avg: round(v.avg), p95: round(v['p(95)']), p99: round(v['p(99)']), count: v.count ?? 0 };
    })
    .filter((e) => e.count > 0)
    .sort((a, b) => b.p95 - a.p95);

  const sessions = m('funnel_sessions').count ?? 0;
  const ordersConfirmed = m('funnel_orders_confirmed').count ?? 0;
  const checkoutStarted = m('funnel_checkout_started').count ?? 0;

  const summary: CompactSummary = {
    meta: {
      testId: ctx.testId,
      profile: ctx.profile.name,
      description: ctx.profile.description,
      env: ctx.env.name,
      baseUrl: ctx.env.baseUrl,
      durationS: round(durationS, 1),
      generatedAt: new Date().toISOString(),
    },
    verdict: !ctx.profile.enforceSlos ? 'EXPLORATORY' : failedThresholds.length ? 'FAIL' : 'PASS',
    failedThresholds,
    throughput: {
      reqPerS: round(m('http_reqs').rate),
      requests: m('http_reqs').count ?? 0,
      iterations: m('iterations').count ?? 0,
      droppedIterations: m('dropped_iterations').count ?? 0,
      checksRate: round(m('checks').rate, 4),
    },
    flows,
    endpoints,
    business: {
      sessions,
      ordersConfirmed,
      conversionRate: round(sessions ? ordersConfirmed / sessions : 0, 4),
      checkoutSuccessRate: round(checkoutStarted ? ordersConfirmed / checkoutStarted : 0, 4),
      revenueConfirmed: round(m('revenue_confirmed').count),
      revenueAtRisk: round(m('revenue_at_risk').count),
      journeyP95: round(m('checkout_journey_duration')['p(95)']),
    },
  };

  if (ctx.profile.kneeDetection) summary.knee = detectKnee(ctx.profile, ctx.env.capacityFactor, m);

  const dir = __ENV.RESULTS_DIR || 'results';
  return {
    stdout: renderConsole(summary),
    [`${dir}/${ctx.profile.name}-summary.json`]: JSON.stringify(summary, null, 2),
    [`${dir}/${ctx.profile.name}-report.html`]: renderHtml(summary),
  };
}

function detectKnee(
  profile: Profile,
  capacityFactor: number,
  m: (name: string) => Record<string, number>,
): NonNullable<CompactSummary['knee']> {
  const stages: StageResult[] = profile.stages.map((stage, i) => {
    const latency = m(stageLatencyMetric(i));
    const errors = m(stageErrorsMetric(i));
    const p95 = latency['p(95)'] ?? 0;
    const errorRate = errors.rate ?? 0;
    return {
      index: i + 1,
      durationS: stage.duration,
      targetJourneysPerS: round(stage.target * capacityFactor),
      achievedReqPerS: round((latency.count ?? 0) / stage.duration),
      p95: round(p95),
      errorRate: round(errorRate, 4),
      healthy: (latency.count ?? 0) > 0 && p95 <= KNEE_CRITERIA.p95 && errorRate <= KNEE_CRITERIA.errorRate,
    };
  });

  const knee = stages.find((s) => s.achievedReqPerS > 0 && !s.healthy);
  // Capacidade só é afirmada em platôs (alvo constante): rampas misturam cargas diferentes.
  const isPlateau = (i: number) => (i === 0 ? profile.startRate : profile.stages[i - 1].target) === profile.stages[i].target;
  const healthyPlateaus = stages.filter((s, i) => s.healthy && isPlateau(i) && (!knee || s.index < knee.index));
  return {
    stages,
    kneeStage: knee?.index,
    maxHealthyJourneysPerS: healthyPlateaus.length ? Math.max(...healthyPlateaus.map((s) => s.targetJourneysPerS)) : undefined,
  };
}

function renderConsole(s: CompactSummary): string {
  const icon = { PASS: '✅ PASS', FAIL: '❌ FAIL', EXPLORATORY: '🔎 EXPLORATÓRIO' }[s.verdict];

  const lines = [
    '',
    `═══ ${s.meta.profile.toUpperCase()} · ${s.meta.env} · ${s.meta.durationS}s ═══  ${icon}`,
    `Throughput: ${s.throughput.reqPerS} req/s · ${s.throughput.requests} reqs · checks ${pct(s.throughput.checksRate)}` +
      (s.throughput.droppedIterations ? ` · ⚠ ${s.throughput.droppedIterations} iterações descartadas (gerador saturado)` : ''),
    '',
    'Fluxo       p95 (SLO)         p99 (SLO)          erros (SLO)       budget',
    ...s.flows.map(
      (f) =>
        `${f.pass ? '✓' : '✗'} ${f.flow.padEnd(9)} ${`${f.p95}ms (<${f.slo.p95})`.padEnd(17)} ${`${f.p99}ms (<${f.slo.p99})`.padEnd(18)} ` +
        `${`${pct(f.errorRate)} (<${pct(f.slo.maxErrorRate)})`.padEnd(17)} ${(Number.isFinite(f.budgetConsumed) ? pct(f.budgetConsumed) : '∞').padEnd(8)}` +
        (f.lowSample ? ` ⚠ n=${f.requests}: percentis pouco confiáveis` : ''),
    ),
    '',
    `Negócio: ${s.business.ordersConfirmed} pedidos · conversão ${pct(s.business.conversionRate)} · ` +
      `confirmado ${brl(s.business.revenueConfirmed)} · em risco ${brl(s.business.revenueAtRisk)}`,
  ];

  if (s.knee) {
    lines.push(
      '',
      s.knee.kneeStage
        ? `Ponto de ruptura: estágio ${s.knee.kneeStage} · capacidade saudável ≈ ${s.knee.maxHealthyJourneysPerS ?? 0} jornadas/s`
        : 'Ponto de ruptura: não atingido neste perfil — aumente a carga',
    );
  }
  if (s.failedThresholds.length) lines.push('', 'Thresholds violados:', ...s.failedThresholds.map((t) => `  - ${t}`));
  lines.push('', `Relatório: results/${s.meta.profile}-report.html`, '');
  return lines.join('\n');
}
