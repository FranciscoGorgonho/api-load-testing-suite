# Evidência: gates contra API degradada (chaos)

**Data:** 25/10/2026 · **Ambiente:** local (Windows, k6 v2.2.0, Node 22) · **Baseline:** `gh-40177713549` (CI, ubuntu-24.04)

## Objetivo

Comprovar que as duas camadas de gate **reprovam** uma API com degradação injetada:

- 2% de erro;
- +250 ms de latência em todas as rotas.

## Resultado

| Passo | Verificação | Resultado | Arquivo |
|---|---|---|---|
| 1 | Chaos ativo: `GET /products` em cerca de 300 ms (normal: cerca de 35 ms) | ✅ confirmado | [01-mock-chaos.txt](01-mock-chaos.txt) |
| 2 | Gate absoluto (SLO / thresholds do k6) | ❌ **FAIL**, exit 99, abortado aos 32 s pelo `abortOnFail` do checkout | [02-k6-load-chaos.txt](02-k6-load-chaos.txt) |
| 3 | Gate relativo (vs baseline) | ❌ **Regressão**, exit 1: browse com p95 +393%, cart com p95 +564% | [03-gate-baseline.md](03-gate-baseline.md) |
| 4 | Relatório HTML | Veredito "Reprovado" e R$ 2.754,90 em receita em risco | [04-relatorio-html.png](04-relatorio-html.png) · [load-report.html](load-report.html) |
| 5 | Baseline intacta após o teste | ✅ mesmo SHA-1 antes e depois | [05-limpeza.txt](05-limpeza.txt) |

**Conclusão:** as duas camadas de gate funcionam como projetado. Uma release com essa degradação seria bloqueada.

## Achados

| # | Achado | Tratamento |
|---|---|---|
| 1 | **Mensagem ambígua no gate:** a nota dizia `auth (n=8 < 100)`, mas a tabela mostrava `n=9`. O n vinha da baseline (o menor dos dois), sem dizer de que lado. | ✅ Corrigido: a mensagem passa a mostrar `n atual=9, base=8 (mín. 100)`, com teste de regressão |
| 2 | **O abort reduz a amostra do fluxo mais crítico:** o checkout ficou com n=67 após o `abortOnFail` e saiu do gate relativo. Não há falso negativo, porque o SLO absoluto já reprovou. | 📄 Documentado como consequência no [ADR 0002](../../adr/0002-slos-como-codigo.md) |
| 3 | **Layout:** o selo "amostra baixa" desalinhava a coluna Reqs no HTML. | ✅ Corrigido: o selo foi movido para a coluna Fluxo |
| 4 | **Observabilidade do mock:** o log de inicialização não indicava se o chaos estava ativo, e foi preciso medir a latência para confirmar. | ✅ Corrigido: o startup exibe `⚠ CHAOS ATIVO` |

Os arquivos desta pasta são o registro da execução original e **não foram regenerados** depois das correções.
