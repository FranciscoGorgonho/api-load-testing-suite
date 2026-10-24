# ADR 0002 — SLOs como código e gate em duas camadas

**Status:** Aceito · **Data:** 24/10/2026

## Contexto

Quando os SLAs vivem em uma página da wiki e os thresholds vivem copiados em cada script, os dois divergem com o tempo. Além disso, thresholds absolutos só pegam o que **já está ruim**. Uma regressão de 40% que ainda cabe no SLO passa sem ninguém perceber.

## Decisão

1. **Fonte única:** `src/config/slos.ts` define p95, p99 e taxa de erro máxima por fluxo. Os thresholds do k6, o cálculo de *error budget* e o relatório derivam todos dela.
2. **Camada 1, absoluta:** os thresholds do k6 reprovam a execução (exit code ≠ 0) quando um SLO é violado. No fluxo de checkout, a violação da taxa de erro usa `abortOnFail`.
3. **Camada 2, relativa:** `scripts/compare-baseline.mjs` compara a execução com uma baseline versionada em `baselines/` e reprova regressões acima de +15% de latência (com piso de ruído de 15 ms) ou acima de +0,5 p.p. de erro.
4. **Perfis exploratórios** (`spike` e `stress`) registram os mesmos submétricos, mas não reprovam a execução. O objetivo deles é ver o sistema quebrar.

## Consequências

- Alterar um SLA exige um PR, o que deixa revisão e histórico no Git.
- A baseline precisa ser atualizada conscientemente (`npm run baseline:update`) quando uma melhora ou uma mudança de arquitetura é aceita.
- Os resultados são comparáveis apenas no mesmo ambiente e com o mesmo perfil.
