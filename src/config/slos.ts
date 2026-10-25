// SLOs como código: fonte única para thresholds do k6, error budget e relatório.
// Mudou o SLA? Mude aqui — teste, gate de CI e relatório acompanham.

export type Flow = 'browse' | 'auth' | 'cart' | 'checkout';

export interface Slo {
  /** Latência p95 máxima (ms). */
  p95: number;
  /** Latência p99 máxima (ms). */
  p99: number;
  /** Taxa máxima de requisições com falha (0..1). Também define o error budget. */
  maxErrorRate: number;
  /** Interrompe o teste se o SLO de erro estourar — reservado para fluxos de receita. */
  abortOnFail?: boolean;
}

export const SLOS: Record<Flow, Slo> = {
  browse: { p95: 400, p99: 800, maxErrorRate: 0.01 },
  auth: { p95: 600, p99: 1200, maxErrorRate: 0.005 },
  cart: { p95: 500, p99: 1000, maxErrorRate: 0.005 },
  checkout: { p95: 800, p99: 1500, maxErrorRate: 0.001, abortOnFail: true },
};

export const FLOWS = Object.keys(SLOS) as Flow[];

/** Critério para declarar o "joelho" da curva no teste de estresse. */
export const KNEE_CRITERIA = { p95: 500, errorRate: 0.01 };

/** Checks funcionais mínimos (status + contrato). */
export const MIN_CHECK_RATE = 0.99;

/**
 * Abaixo disso, p95/p99 não são estatisticamente confiáveis e o fluxo é sinalizado.
 * Mesmo valor padrão de REGRESSION_MIN_SAMPLES em scripts/lib/regression.mjs.
 */
export const MIN_SAMPLES_FOR_PERCENTILES = 100;

type Thresholds = Record<string, Array<string | { threshold: string; abortOnFail?: boolean; delayAbortEval?: string }>>;

/**
 * Gera os thresholds do k6 a partir dos SLOs.
 * Em perfis exploratórios (stress) os submétricos continuam registrados — para o
 * relatório — mas com expressões que sempre passam: queremos ver o sistema quebrar.
 */
export function buildThresholds(enforce: boolean): Thresholds {
  const thresholds: Thresholds = {
    checks: [enforce ? `rate>=${MIN_CHECK_RATE}` : 'rate>=0'],
  };

  for (const flow of FLOWS) {
    const slo = SLOS[flow];
    thresholds[`http_req_duration{flow:${flow}}`] = enforce
      ? [`p(95)<${slo.p95}`, `p(99)<${slo.p99}`]
      : ['max>=0'];
    thresholds[`http_req_failed{flow:${flow}}`] = enforce
      ? [{ threshold: `rate<${slo.maxErrorRate}`, abortOnFail: !!slo.abortOnFail, delayAbortEval: '30s' }]
      : ['rate>=0'];
  }
  return thresholds;
}
