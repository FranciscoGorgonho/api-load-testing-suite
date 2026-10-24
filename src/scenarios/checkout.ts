// Jornada de compra (15% do tráfego): login → carrinho → pedido idempotente.
// Cada etapa alimenta o funil e, se o pedido falhar, a "receita em risco".

import { check, group } from 'k6';
import exec from 'k6/execution';
import { type ApiClient, json } from '../lib/http.ts';
import { getToken } from '../lib/auth.ts';
import { checkoutJourney, funnel, revenueAtRisk, revenueConfirmed } from '../lib/metrics.ts';
import { thinkTime } from '../lib/think-time.ts';

const PRODUCT_COUNT = 120;

export function checkoutJourneyScenario(api: ApiClient): void {
  const startedAt = Date.now();
  funnel.sessions.add(1);

  const token = getToken(api);
  if (!token) return;

  let cartId: string | undefined;
  let cartTotal = 0;

  group('carrinho', () => {
    const res = api.request('createCart', '/cart', { token });
    cartId = json<{ cartId: string }>(res)?.cartId;
    check(res, { 'carrinho: criado (201)': (r) => r.status === 201 });
    if (!cartId) return;

    const items = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < items; i++) {
      const add = api.request('addItem', `/cart/${cartId}/items`, {
        token,
        body: { productId: 1 + Math.floor(Math.random() * PRODUCT_COUNT), quantity: 1 + Math.floor(Math.random() * 2) },
      });
      const body = json<{ total: number }>(add);
      check(add, { 'carrinho: item adicionado': (r) => r.status === 200 && typeof body?.total === 'number' });
      if (body) cartTotal = body.total;
    }
  });
  if (!cartId || cartTotal === 0) return;
  funnel.addedToCart.add(1);
  thinkTime(0.5, 1.5);

  group('pedido', () => {
    funnel.checkoutStarted.add(1);
    // Chave de idempotência única por iteração: retry seguro, sem pedido duplicado.
    const idempotencyKey = `k6-${exec.vu.idInTest}-${exec.vu.iterationInScenario}-${startedAt}`;
    const res = api.request('createOrder', '/orders', {
      token,
      body: { cartId },
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    const order = json<{ status: string; total: number }>(res);
    const ok = check(res, {
      'pedido: criado (201)': (r) => r.status === 201,
      'pedido: CONFIRMED': () => order?.status === 'CONFIRMED',
      'pedido: total = carrinho': () => order?.total === cartTotal,
    });

    if (ok) {
      funnel.ordersConfirmed.add(1);
      revenueConfirmed.add(cartTotal);
      checkoutJourney.add(Date.now() - startedAt);
    } else {
      revenueAtRisk.add(cartTotal);
    }
  });
}
