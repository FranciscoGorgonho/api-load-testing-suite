export interface Environment {
  baseUrl: string;
  /** Escala as metas de RPS — staging costuma ser uma fração de produção. */
  capacityFactor: number;
}

const ENVIRONMENTS: Record<string, Environment> = {
  local: { baseUrl: 'http://localhost:3333', capacityFactor: 1 },
  staging: { baseUrl: 'https://staging-api.example.com', capacityFactor: 0.25 },
};

export function resolveEnvironment(): Environment & { name: string } {
  const name = __ENV.ENV || 'local';
  const env = ENVIRONMENTS[name];
  if (!env) throw new Error(`ENV desconhecido: "${name}". Use: ${Object.keys(ENVIRONMENTS).join(', ')}`);
  return { name, ...env, baseUrl: __ENV.BASE_URL || env.baseUrl };
}
