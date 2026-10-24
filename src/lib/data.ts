// Massa de teste carregada uma única vez e compartilhada entre VUs (SharedArray).

import { SharedArray } from 'k6/data';
import exec from 'k6/execution';

export interface User {
  email: string;
  password: string;
}

export const users = new SharedArray<User>('users', () =>
  open('../../data/users.csv')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => {
      const [email, password] = line.split(',');
      return { email, password };
    }),
);

export const searchTerms = new SharedArray<string>('search-terms', () => JSON.parse(open('../../data/search-terms.json')));

/** Usuário fixo por VU: evita sessões concorrentes do mesmo usuário. */
export function userForVu(): User {
  return users[(exec.vu.idInTest - 1) % users.length];
}

export const pick = <T>(items: ArrayLike<T>): T => items[Math.floor(Math.random() * items.length)];
