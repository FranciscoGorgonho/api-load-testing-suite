// Entrypoint único. Compõe ambiente + perfil + cenários; nada aqui muda por tipo de teste.
//
//   k6 run -e PROFILE=load -e ENV=local src/tests/ecommerce.test.ts

import http from 'k6/http';
import exec from 'k6/execution';
import type { Options, Scenario } from 'k6/options';
import { resolveEnvironment } from '../config/environments.ts';
import { resolveProfile, TRAFFIC_MIX } from '../config/profiles.ts';
import { buildThresholds } from '../config/slos.ts';
import { ApiClient, ENDPOINTS } from '../lib/http.ts';
import { StageRecorder } from '../lib/stages.ts';
import { browseJourney } from '../scenarios/browse.ts';
import { checkoutJourneyScenario } from '../scenarios/checkout.ts';
import { buildSummary } from '../report/summary.ts';

const env = resolveEnvironment();
const profile = resolveProfile();
const recorder = profile.kneeDetection ? new StageRecorder(profile.stages) : undefined;
const api = new ApiClient(env.baseUrl, recorder);
const testId = __ENV.TEST_ID || `${profile.name}-${new Date().toISOString().replace(/[:.]/g, '-')}`;

function scenario(execFn: string, share: number): Scenario {
  if (profile.name === 'smoke') {
    return { executor: 'constant-vus', exec: execFn, vus: 1, duration: `${profile.stages[0].duration}s` };
  }
  // Metas em jornadas/minuto: preserva precisão quando a fração do mix é pequena.
  const perMinute = (perSecond: number) => Math.round(perSecond * share * env.capacityFactor * 60);
  const peak = Math.max(...profile.stages.map((s) => s.target)) * share * env.capacityFactor;
  return {
    executor: 'ramping-arrival-rate',
    exec: execFn,
    timeUnit: '1m',
    startRate: perMinute(profile.startRate),
    preAllocatedVUs: Math.ceil(peak * 2) + 2,
    maxVUs: Math.ceil(peak * 10) + 10,
    stages: profile.stages.map((s) => ({ duration: `${s.duration}s`, target: perMinute(s.target) })),
  };
}

// Submétricas por endpoint: sempre passam, existem para alimentar o relatório.
const endpointThresholds = Object.fromEntries(
  Object.values(ENDPOINTS).map((e) => [`http_req_duration{name:${e.name}}`, ['max>=0']]),
);

export const options: Options = {
  scenarios: {
    browse: scenario('browse', TRAFFIC_MIX.browse),
    checkout: scenario('checkout', TRAFFIC_MIX.checkout),
  },
  thresholds: { ...buildThresholds(profile.enforceSlos), ...endpointThresholds },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  tags: { testid: testId, profile: profile.name, env: env.name },
  discardResponseBodies: false,
};

export function setup() {
  const res = http.get(`${env.baseUrl}/health`, { tags: { name: 'setup /health' } });
  if (res.status !== 200) {
    exec.test.abort(`Ambiente indisponível: GET ${env.baseUrl}/health → ${res.status}`);
  }
}

export function browse() {
  browseJourney(api);
}

export function checkout() {
  checkoutJourneyScenario(api);
}

export function handleSummary(data: Parameters<typeof buildSummary>[0]) {
  return buildSummary(data, { profile, env, testId });
}
