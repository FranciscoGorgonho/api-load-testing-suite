// Jornada de navegação (85% do tráfego): vitrine → detalhe → busca.

import { check, group } from 'k6';
import { type ApiClient, json } from '../lib/http.ts';
import { pick, searchTerms } from '../lib/data.ts';
import { funnel } from '../lib/metrics.ts';
import { thinkTime } from '../lib/think-time.ts';

interface ProductPage {
  items?: Array<{ id: number; price: number }>;
}

export function browseJourney(api: ApiClient): void {
  funnel.sessions.add(1);
  let productIds: number[] = [];

  group('vitrine', () => {
    const page = 1 + Math.floor(Math.random() * 3);
    const res = api.request('listProducts', `/products?page=${page}&size=20`);
    const body = json<ProductPage>(res);
    check(res, {
      'vitrine: status 200': (r) => r.status === 200,
      'vitrine: lista não vazia': () => (body?.items?.length ?? 0) > 0,
    });
    productIds = body?.items?.map((p) => p.id) ?? [];
  });
  thinkTime();

  if (productIds.length > 0) {
    group('detalhe do produto', () => {
      const id = pick(productIds);
      const res = api.request('productDetail', `/products/${id}`);
      check(res, {
        'detalhe: status 200': (r) => r.status === 200,
        'detalhe: id correlacionado': () => json<{ id: number }>(res)?.id === id,
      });
    });
    thinkTime();
  }

  group('busca', () => {
    const res = api.request('search', `/search?q=${encodeURIComponent(pick(searchTerms))}`);
    check(res, { 'busca: status 200': (r) => r.status === 200 });
  });
}
