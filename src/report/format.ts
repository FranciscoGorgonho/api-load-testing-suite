// Formatadores próprios: o runtime JS do k6 não implementa Intl/toLocaleString com opções.

export const round = (n: number, d = 2) => Math.round((n || 0) * 10 ** d) / 10 ** d;

export const pct = (n: number, d = 2) => `${(n * 100).toFixed(d)}%`;

/** Versão curta para cards de KPI: "R$ 5,66 mi", "R$ 429,2 mil". */
export function brlCompact(n: number): string {
  const abs = Math.abs(n || 0);
  const sign = n < 0 ? '-' : '';
  const dec = (v: number, d: number) => v.toFixed(d).replace('.', ',');
  if (abs >= 1e6) return `${sign}R$ ${dec(abs / 1e6, 2)} mi`;
  if (abs >= 1e4) return `${sign}R$ ${dec(abs / 1e3, 1)} mil`;
  return brl(n);
}

export function brl(n: number): string {
  const [int, dec] = Math.abs(n || 0).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}R$ ${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
}
