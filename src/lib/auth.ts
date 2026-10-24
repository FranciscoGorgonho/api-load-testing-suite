// Token por VU com cache e renovação antes de expirar — como um cliente real,
// sem martelar /auth/login a cada iteração.

import { check } from 'k6';
import { type ApiClient, json } from './http.ts';
import { userForVu } from './data.ts';

const REFRESH_MARGIN_MS = 30_000;
let session: { token: string; expiresAt: number } | undefined;

export function getToken(api: ApiClient): string | undefined {
  if (session && Date.now() < session.expiresAt - REFRESH_MARGIN_MS) return session.token;

  const user = userForVu();
  const res = api.request('login', '/auth/login', { body: user });
  const body = json<{ accessToken: string; expiresIn: number }>(res);
  const ok = check(res, {
    'login: status 200': (r) => r.status === 200,
    'login: retorna accessToken': () => typeof body?.accessToken === 'string',
  });

  session = ok && body ? { token: body.accessToken, expiresAt: Date.now() + body.expiresIn * 1000 } : undefined;
  return session?.token;
}
