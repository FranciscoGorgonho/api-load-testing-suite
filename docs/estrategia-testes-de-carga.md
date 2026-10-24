# Estratégia de Testes de Carga — E-commerce (k6)

| Campo | Valor |
|---|---|
| **Status** | Rascunho para revisão |
| **Responsável** | QA / Engenharia de Performance |
| **Ferramenta principal** | Grafana k6 |
| **Última atualização** | 24/10/2026 |

---

## 1. Resumo executivo

Vamos adotar o **k6** como padrão para testes de carga das APIs do e-commerce. A suíte começa **básica**: um fluxo crítico, execução local e thresholds como critério de aprovação. Ela foi pensada para evoluir até o nível **sênior**: métricas centralizadas, execução no CI/CD e testes distribuídos. Isso é possível sem reescrever nada, porque a estrutura do projeto separa **cenários**, **perfis de carga**, **configuração de ambiente** e **bibliotecas compartilhadas** desde o primeiro dia.

**Decisões já tomadas:**

1. Os **SLAs viram thresholds do k6**. Se um threshold estourar, o teste falha e bloqueia o pipeline.
2. O **perfil de carga é um parâmetro** (`PROFILE=load|spike|stress`), nunca uma cópia do script.
3. **Prometheus e Grafana** formam a stack de métricas, e o k6 envia os dados via remote write.
4. **Nunca rodamos testes em produção** sem aprovação formal e janela combinada.

---

## 2. Objetivos do teste de performance

| # | Objetivo | Pergunta que responde |
|---|---|---|
| O1 | Validar SLAs sob carga normal | O sistema atende o usuário no dia a dia dentro do SLA? |
| O2 | Validar resiliência em pico | O sistema aguenta uma Black Friday ou campanha sem degradar o checkout? |
| O3 | Encontrar o ponto de ruptura | A partir de quantos usuários ou RPS o sistema quebra, e **como** ele quebra? |
| O4 | Detectar regressões | Esta release ficou mais lenta que a anterior? |
| O5 | Embasar capacity planning | Quanta infraestrutura precisamos para a meta de negócio? |

**Fora de escopo (por enquanto):** testes de front-end/browser (Web Vitals), caos de infraestrutura e testes em produção.

---

## 3. Fluxos críticos e SLAs sugeridos

Os fluxos são priorizados pelo **impacto na receita**. Os valores abaixo são um ponto de partida de mercado e precisam ser **calibrados com uma baseline real** (ver §7).

| Fluxo | Endpoint (exemplo) | Peso no tráfego | p95 | p99 | Taxa de erro |
|---|---|---|---|---|---|
| Listagem / busca de produtos | `GET /products`, `GET /search` | 60% | < 400 ms | < 800 ms | < 1% |
| Detalhe do produto | `GET /products/{id}` | 20% | < 300 ms | < 600 ms | < 1% |
| Carrinho | `POST /cart/items` | 12% | < 500 ms | < 1 s | < 0,5% |
| Login / autenticação | `POST /auth/login` | 5% | < 600 ms | < 1,2 s | < 0,5% |
| **Checkout / pagamento** | `POST /orders` | 3% | **< 800 ms** | **< 1,5 s** | **< 0,1%** |

**SLAs globais:**

- **Disponibilidade durante o teste:** ≥ 99,9% das requisições com sucesso.
- **Checks funcionais:** ≥ 99% de sucesso (status, corpo e contrato da resposta).
- **Throughput mínimo:** definido pela meta de negócio (ex.: 50 pedidos/min no pico).

**Como fica no k6:**

```javascript
export const thresholds = {
  http_req_failed: ['rate<0.01'],
  checks: ['rate>0.99'],
  'http_req_duration{flow:browse}': ['p(95)<400', 'p(99)<800'],
  'http_req_duration{flow:checkout}': ['p(95)<800', 'p(99)<1500'],
  'http_req_failed{flow:checkout}': [{ threshold: 'rate<0.001', abortOnFail: true }],
};
```

> As tags por fluxo (`flow:checkout`) são obrigatórias. Sem elas, o checkout fica "diluído" na média das leituras, e uma lentidão grave passa despercebida.

---

## 4. Perfis de carga

Usamos o executor **`ramping-arrival-rate`** (modelo aberto) nos perfis de produção. Ele controla **requisições por segundo** em vez de usuários virtuais (VUs), o que reflete o tráfego real: usuários continuam chegando mesmo quando o sistema fica lento.

| Perfil | Objetivo | Carga | Duração | Quando rodar |
|---|---|---|---|---|
| **Smoke** | Verificar se o script e o ambiente funcionam | 1–2 VUs | 1 min | A cada PR |
| **Normal (Load)** | Validar SLAs no tráfego típico | 100% da média diária (ex.: 50 RPS) | 15–30 min | Diário / a cada release |
| **Pico (Spike)** | Simular campanha ou Black Friday | Salto súbito para 3–5× a média | 10 min | Antes de campanhas e releases grandes |
| **Estresse** | Encontrar o ponto de ruptura | Rampa progressiva até falhar (ex.: 50 → 500 RPS) | 30–45 min | Mensal / mudanças de arquitetura |
| *Soak* (fase pleno+) | Detectar memory leak e degradação | 80% da média | 2–8 h | Mensal |

**Formato das rampas:**

```
Normal     ──╱‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾╲──      rampa 5 min → platô 20 min → descida 5 min
Pico       ──────╱‾‾╲──────          estável → salto em 30 s → platô curto → volta
Estresse   ──╱‾╱‾╱‾╱‾╱‾╱‾ ✕          degraus de +20% a cada 5 min até o SLA ou o sistema romper
```

**Critérios de saída:**

- **Normal:** todos os thresholds passam. Se algum falhar, a release fica bloqueada.
- **Pico:** o checkout mantém o SLA, e as leituras podem degradar até 2× o p95. O sistema precisa se recuperar em menos de 2 minutos após o pico.
- **Estresse:** não há "passa ou falha". O entregável é um **relatório** com o ponto de ruptura, o recurso gargalo (CPU, DB, pool de conexões…) e o modo de falha (erros 5xx, timeout, fila).

---

## 5. Ferramentas e arquitetura de métricas

### 5.1 Ferramentas

| Camada | Ferramenta | Por quê |
|---|---|---|
| Geração de carga | **k6** (OSS) | Scripts em JavaScript versionados no Git, thresholds nativos, baixo consumo de recursos, integração com CI |
| Armazenamento de métricas | **Prometheus** (remote write) | Padrão de mercado, provavelmente já usado pelo time de infra para as métricas da aplicação |
| Visualização | **Grafana** | Dashboard oficial do k6 e correlação com as métricas da aplicação no mesmo painel |
| CI/CD | **GitHub Actions** (ou o CI do time) | Smoke a cada PR e carga normal agendada |
| Escala distribuída (sênior) | **k6 Operator** (Kubernetes) ou **Grafana Cloud k6** | Gerar carga além do limite de uma máquina |
| Observabilidade do SUT | APM existente (Datadog / New Relic / OpenTelemetry) | Explicar o *porquê* da lentidão, e não só o *quanto* |

### 5.2 Arquitetura

```
┌──────────────┐   HTTP    ┌────────────────────┐
│  k6 runner   │ ────────▶ │  API e-commerce    │
│ (local / CI /│           │  (staging)         │
│  k8s pods)   │           └─────────┬──────────┘
└──────┬───────┘                     │ métricas da app (CPU, DB, latência interna)
       │ remote write                ▼
       │                     ┌───────────────┐
       └───────────────────▶ │  Prometheus   │
                             └───────┬───────┘
                                     ▼
                             ┌───────────────┐
                             │    Grafana    │  ← dashboard k6 + dashboard da app lado a lado
                             └───────────────┘
       + handleSummary() → relatório HTML/JSON salvo como artefato do CI
```

### 5.3 Métricas acompanhadas

| Tipo | Métricas |
|---|---|
| **Cliente (k6)** | `http_req_duration` (p50/p95/p99), `http_req_failed`, `http_reqs` (RPS), `checks`, `iterations`, `vus`, `dropped_iterations` |
| **Negócio (custom)** | `orders_created` (Counter), `checkout_duration` (Trend), `cart_errors` (Rate) |
| **Servidor (APM)** | CPU, memória, conexões de DB, tempo de query, tamanho de fila e GC |

> `dropped_iterations > 0` no modelo de arrival rate indica que **o gerador de carga** é o gargalo, e não o sistema. Nesse caso, aumente `preAllocatedVUs` ou distribua a carga antes de concluir qualquer coisa.

---

## 6. Estrutura do projeto e evolução por maturidade

### 6.1 Estrutura (pensada para escalar)

```
api-load-testing-suite/
├── src/                    # k6 + TypeScript (nativo, sem bundler)
│   ├── config/             # environments · profiles · slos (SLOs como código)
│   ├── lib/                # cliente HTTP, auth, massa de dados, métricas, detector de ruptura
│   ├── scenarios/          # jornadas: browse.ts · checkout.ts
│   ├── report/             # handleSummary → veredito, error budget, HTML
│   └── tests/
│       └── ecommerce.test.ts   # entrypoint: compõe ENV + PROFILE + cenários
├── mock-api/               # API simulada com capacidade finita e injeção de falhas
├── data/                   # massa de teste (CSV/JSON via SharedArray)
├── baselines/              # baseline versionada para o gate de regressão
├── scripts/                # compare-baseline.mjs
├── infra/                  # Prometheus + Grafana (dashboard provisionado)
├── .github/workflows/      # typecheck · smoke por PR · carga agendada
└── docs/                   # esta estratégia + ADRs
```

**Execução:** `k6 run -e ENV=staging -e PROFILE=load src/tests/ecommerce.test.ts`

### 6.2 Roadmap de maturidade

| Nível | Entregas | Critério de "pronto" |
|---|---|---|
| **Básico** | Estrutura acima, cenário de navegação, perfis smoke/load, thresholds, relatório HTML | Roda localmente com um único comando e falha quando o SLA é violado |
| **Pleno** | Jornada de checkout com auth e massa de dados, métricas de negócio, Prometheus + Grafana via Docker, smoke no CI a cada PR | Dashboard em tempo real e PRs bloqueados por regressão |
| **Sênior** | Perfis spike/stress/soak, carga normal agendada no CI, comparação com a baseline entre releases, execução distribuída (k6 Operator), correlação com APM, relatório de capacity planning | O time de produto consulta os resultados para decidir sobre capacidade e releases |

---

## 7. Governança e riscos

| Risco | Mitigação |
|---|---|
| SLAs "chutados" sem base real | Rodar uma **baseline** no perfil normal e calibrar os thresholds depois de 3 execuções estáveis |
| Ambiente de staging menor que produção | Documentar a proporção (ex.: staging = 1/4 de prod) e escalar as metas na mesma proporção |
| Dependências externas (gateway de pagamento, frete) | Usar **mocks/stubs** no staging. Nunca gerar carga contra terceiros sem acordo |
| Gerador de carga como gargalo | Monitorar `dropped_iterations` e o CPU do runner, e distribuir a carga quando necessário |
| Massa de dados se esgota ou gera conflito | Dados únicos por VU (`SharedArray` + `__VU`/`__ITER`) e reset do ambiente antes de cada teste |
| Teste derruba ambiente compartilhado | Agendar a janela de teste e avisar os times dependentes |

---

## 8. Próximos passos

1. **Validar os SLAs** desta proposta com produto e engenharia.
2. **Definir a meta de tráfego** (RPS médio e de pico) com base nos dados de analytics.
3. **Implementar o nível Básico** da suíte.
4. **Rodar a baseline** e ajustar os thresholds.
5. **Subir a stack Prometheus + Grafana** e o pipeline de smoke (nível Pleno).
