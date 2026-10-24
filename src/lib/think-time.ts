import { sleep } from 'k6';

const THINK_SCALE = Number(__ENV.THINK_TIME_SCALE ?? 1);

/** Pausa humana aleatória (0,3–1,0s), escalável via THINK_TIME_SCALE (0 desliga). */
export function thinkTime(min = 0.3, max = 1.0): void {
  if (THINK_SCALE > 0) sleep((min + Math.random() * (max - min)) * THINK_SCALE);
}
