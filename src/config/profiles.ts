// Perfis de carga como dados. O script nunca muda — só o PROFILE.
// Modelo aberto (ramping-arrival-rate): controlamos chegadas/s, como o tráfego real.

export interface Stage {
  /** Duração em segundos (antes do TIME_SCALE). */
  duration: number;
  /** Iterações (jornadas) por segundo ao final do estágio. */
  target: number;
}

export interface Profile {
  name: string;
  description: string;
  /** Falha o teste quando um SLO é violado. Perfis exploratórios só reportam. */
  enforceSlos: boolean;
  /** Ativa o detector de ponto de ruptura por estágio. */
  kneeDetection: boolean;
  startRate: number;
  stages: Stage[];
}

// Degraus de +20 it/s: rampa curta de 30s e platô de 90s para estabilizar a medição.
const stressSteps = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200].flatMap((target) => [
  { duration: 30, target },
  { duration: 90, target },
]);

export const PROFILES: Record<string, Profile> = {
  smoke: {
    name: 'smoke',
    description: 'Sanidade do script e do ambiente — roda a cada PR',
    enforceSlos: true,
    kneeDetection: false,
    startRate: 1,
    stages: [{ duration: 30, target: 2 }],
  },
  load: {
    name: 'load',
    description: 'Tráfego típico (100% da média) — valida SLAs',
    enforceSlos: true,
    kneeDetection: false,
    startRate: 1,
    stages: [
      { duration: 60, target: 20 },
      { duration: 300, target: 20 },
      { duration: 30, target: 0 },
    ],
  },
  spike: {
    name: 'spike',
    description: 'Campanha / Black Friday — salto de 6× e recuperação',
    enforceSlos: false,
    kneeDetection: true,
    startRate: 10,
    stages: [
      { duration: 60, target: 10 },
      { duration: 20, target: 60 },
      { duration: 120, target: 60 },
      { duration: 20, target: 10 },
      { duration: 120, target: 10 },
    ],
  },
  stress: {
    name: 'stress',
    description: 'Rampa em degraus até romper — encontra a capacidade máxima',
    enforceSlos: false,
    kneeDetection: true,
    startRate: 5,
    stages: stressSteps,
  },
  soak: {
    name: 'soak',
    description: 'Resistência — 80% da média por horas (memory leak, pool de conexões)',
    enforceSlos: true,
    kneeDetection: false,
    startRate: 1,
    stages: [
      { duration: 120, target: 16 },
      { duration: 3600, target: 16 },
      { duration: 60, target: 0 },
    ],
  },
};

/** Mix de tráfego: fração das jornadas por cenário. */
export const TRAFFIC_MIX = { browse: 0.85, checkout: 0.15 };

export function resolveProfile(): Profile {
  const name = __ENV.PROFILE || 'smoke';
  const profile = PROFILES[name];
  if (!profile) throw new Error(`PROFILE desconhecido: "${name}". Use: ${Object.keys(PROFILES).join(', ')}`);

  // TIME_SCALE=0.2 comprime o perfil (demo/CI) mantendo o formato da curva.
  const timeScale = Number(__ENV.TIME_SCALE || 1);
  return {
    ...profile,
    stages: profile.stages.map((s) => ({ ...s, duration: Math.max(1, Math.round(s.duration * timeScale)) })),
  };
}
