import { Counter, Trend } from 'k6/metrics';

// Métricas de negócio: traduzem latência em impacto para o produto.
export const funnel = {
  sessions: new Counter('funnel_sessions'),
  addedToCart: new Counter('funnel_added_to_cart'),
  checkoutStarted: new Counter('funnel_checkout_started'),
  ordersConfirmed: new Counter('funnel_orders_confirmed'),
};

/** Valor (R$) de pedidos confirmados durante o teste. */
export const revenueConfirmed = new Counter('revenue_confirmed');

/** Valor (R$) de carrinhos cujo checkout falhou — "dinheiro deixado na mesa". */
export const revenueAtRisk = new Counter('revenue_at_risk');

/** Tempo ponta a ponta da jornada de compra, do login ao pedido confirmado. */
export const checkoutJourney = new Trend('checkout_journey_duration', true);
