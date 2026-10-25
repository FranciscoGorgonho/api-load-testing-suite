import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareFlows, formatDelta } from './regression.mjs';

const flow = (name, overrides = {}) => ({ flow: name, p95: 100, p99: 120, errorRate: 0, requests: 1000, ...overrides });
const summary = (...flows) => ({ flows });

describe('compareFlows', () => {
  it('não acusa regressão quando o resultado é igual à baseline', () => {
    const [r] = compareFlows(summary(flow('browse')), summary(flow('browse')));
    assert.equal(r.status, 'ok');
    assert.deepEqual(r.issues, []);
  });

  it('acusa regressão de p95 acima da tolerância', () => {
    const [r] = compareFlows(summary(flow('browse', { p95: 130 })), summary(flow('browse')));
    assert.equal(r.status, 'regression');
    assert.deepEqual(r.issues, ['p95 +30.0%']);
  });

  it('tolera variação dentro de +15%', () => {
    const [r] = compareFlows(summary(flow('browse', { p95: 114, p99: 137 })), summary(flow('browse')));
    assert.equal(r.status, 'ok');
  });

  it('ignora variação percentual alta abaixo do piso de ruído (ms)', () => {
    // 10ms → 20ms é +100%, mas só 10ms absolutos: ruído, não regressão.
    const [r] = compareFlows(summary(flow('cart', { p95: 20, p99: 22 })), summary(flow('cart', { p95: 10, p99: 12 })));
    assert.equal(r.status, 'ok');
  });

  it('acusa aumento de taxa de erro acima do delta permitido', () => {
    const [r] = compareFlows(summary(flow('checkout', { errorRate: 0.01 })), summary(flow('checkout')));
    assert.equal(r.status, 'regression');
    assert.deepEqual(r.issues, ['erros +1.00pp']);
  });

  it('marca como novo o fluxo ausente na baseline, sem reprovar', () => {
    const [r] = compareFlows(summary(flow('search')), summary(flow('browse')));
    assert.equal(r.status, 'new');
  });

  it('não reprova fluxo com amostra atual insuficiente, mesmo com piora grande', () => {
    const [r] = compareFlows(summary(flow('auth', { p95: 300, requests: 8 })), summary(flow('auth')));
    assert.equal(r.status, 'insufficient');
    assert.deepEqual(r.issues, ['n=8 < 100']);
  });

  it('não reprova quando a baseline tem amostra insuficiente', () => {
    const [r] = compareFlows(summary(flow('auth', { p95: 300 })), summary(flow('auth', { requests: 12 })));
    assert.equal(r.status, 'insufficient');
    assert.deepEqual(r.issues, ['n=12 < 100']);
  });

  it('considera suficiente quando requests atinge o mínimo exato', () => {
    const [r] = compareFlows(summary(flow('auth', { requests: 100 })), summary(flow('auth', { requests: 100 })));
    assert.equal(r.status, 'ok');
  });

  it('trata resumos antigos sem requests como amostra suficiente', () => {
    const { requests: _, ...legacy } = flow('browse', { p95: 200 });
    const [r] = compareFlows(summary(legacy), summary(flow('browse')));
    assert.equal(r.status, 'regression');
  });

  it('respeita opções customizadas', () => {
    const [r] = compareFlows(summary(flow('browse', { p95: 130 })), summary(flow('browse')), { tolerance: 0.5 });
    assert.equal(r.status, 'ok');
  });
});

describe('formatDelta', () => {
  it('formata com sinal e uma casa decimal', () => {
    assert.equal(formatDelta(110, 100), '+10.0%');
    assert.equal(formatDelta(90, 100), '-10.0%');
  });

  it('retorna n/a sem valor de base', () => {
    assert.equal(formatDelta(10, 0), 'n/a');
  });
});
