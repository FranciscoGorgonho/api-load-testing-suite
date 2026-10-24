// Formatadores próprios: o runtime JS do k6 não implementa Intl/toLocaleString com opções.

export const round = (n: number, d = 2) => Math.round((n || 0) * 10 ** d) / 10 ** d;

export const pct = (n: number, d = 2) => `${(n * 100).toFixed(d)}%`;

export function brl(n: number): string {
  const [int, dec] = Math.abs(n || 0).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}
