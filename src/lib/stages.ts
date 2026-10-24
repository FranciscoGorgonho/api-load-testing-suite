// Detector de ponto de ruptura (knee detection).
//
// Cada resposta é atribuída ao estágio do perfil em que ocorreu. No fim, o relatório
// compara RPS alvo × RPS atingido × p95 × erros por estágio e aponta onde o sistema
// deixou de escalar — sem precisar olhar o gráfico manualmente.

import exec from 'k6/execution';
import { Rate, Trend } from 'k6/metrics';
import type { RefinedResponse, ResponseType } from 'k6/http';
import type { Stage } from '../config/profiles.ts';

const pad = (i: number) => String(i + 1).padStart(2, '0');
export const stageLatencyMetric = (i: number) => `knee_stage_${pad(i)}_latency`;
export const stageErrorsMetric = (i: number) => `knee_stage_${pad(i)}_errors`;

export class StageRecorder {
  private readonly ends: number[];
  private readonly latency: Trend[];
  private readonly errors: Rate[];

  constructor(stages: Stage[]) {
    let acc = 0;
    this.ends = stages.map((s) => (acc += s.duration * 1000));
    this.latency = stages.map((_, i) => new Trend(stageLatencyMetric(i), true));
    this.errors = stages.map((_, i) => new Rate(stageErrorsMetric(i)));
  }

  record(res: RefinedResponse<ResponseType | undefined>): void {
    const elapsed = Date.now() - exec.scenario.startTime;
    const idx = this.ends.findIndex((end) => elapsed < end);
    const i = idx === -1 ? this.ends.length - 1 : idx;
    this.latency[i].add(res.timings.duration);
    this.errors[i].add(res.status === 0 || res.status >= 400);
  }
}
