# ADR 0001 — Modelo de carga aberto (`ramping-arrival-rate`)

**Status:** Aceito · **Data:** 24/10/2026

## Contexto

Os executores baseados em VUs (`ramping-vus`) são um **modelo fechado**: cada VU só começa uma nova iteração quando a anterior termina. Quando o sistema fica lento, a taxa de chegada cai sozinha. Na prática, o teste "alivia" exatamente no momento em que deveria pressionar, e isso esconde o problema (*coordinated omission*).

Em um e-commerce, os usuários chegam de forma independente da latência. Ninguém deixa de abrir a vitrine porque o checkout de outra pessoa está lento.

## Decisão

Todos os perfis, exceto o smoke, usam **`ramping-arrival-rate`**, com metas expressas em **jornadas por minuto**. Os VUs passam a ser recurso do gerador (`preAllocatedVUs` / `maxVUs`), e não parâmetro de negócio.

## Consequências

- As metas são definidas em RPS e jornadas/s, a mesma linguagem do analytics e do capacity planning.
- A latência medida não é mascarada pela queda de throughput.
- É preciso monitorar `dropped_iterations`: quando ele aparece, o **gerador** saturou, e o resultado não é conclusivo.
- O smoke continua com `constant-vus` (1 VU), porque o objetivo dele é sanidade, não carga.
