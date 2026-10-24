// Cliente HTTP da suíte: base URL, headers, tags e agrupamento de URLs num só lugar.

import http, { type RefinedParams, type RefinedResponse, type ResponseType } from 'k6/http';
import type { Flow } from '../config/slos.ts';
import type { StageRecorder } from './stages.ts';

/**
 * Catálogo de endpoints. O `name` agrupa URLs dinâmicas (/products/42 → /products/{id})
 * e evita explosão de cardinalidade nas métricas e no Prometheus.
 */
export const ENDPOINTS = {
  login: { method: 'POST', name: 'POST /auth/login', flow: 'auth' },
  listProducts: { method: 'GET', name: 'GET /products', flow: 'browse' },
  productDetail: { method: 'GET', name: 'GET /products/{id}', flow: 'browse' },
  search: { method: 'GET', name: 'GET /search', flow: 'browse' },
  createCart: { method: 'POST', name: 'POST /cart', flow: 'cart' },
  addItem: { method: 'POST', name: 'POST /cart/{id}/items', flow: 'cart' },
  createOrder: { method: 'POST', name: 'POST /orders', flow: 'checkout' },
} as const satisfies Record<string, { method: string; name: string; flow: Flow }>;

export type EndpointKey = keyof typeof ENDPOINTS;

interface RequestOptions {
  body?: unknown;
  token?: string;
  headers?: Record<string, string>;
}

export class ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly recorder?: StageRecorder,
  ) {}

  request(endpoint: EndpointKey, path: string, opts: RequestOptions = {}): RefinedResponse<'text'> {
    const { method, name, flow } = ENDPOINTS[endpoint];
    const params: RefinedParams<ResponseType> = {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      tags: { name, flow, endpoint },
    };
    const body = opts.body === undefined ? null : JSON.stringify(opts.body);
    const res = http.request(method, `${this.baseUrl}${path}`, body, params) as RefinedResponse<'text'>;
    this.recorder?.record(res);
    return res;
  }
}

/** Lê JSON sem derrubar a VU quando o servidor devolve HTML/erro sob carga. */
export function json<T>(res: RefinedResponse<ResponseType | undefined>): T | undefined {
  try {
    return res.json() as T;
  } catch {
    return undefined;
  }
}
