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

1. **Mensagem ambígua no gate:** a nota diz `auth (n=8 < 100)`, mas a tabela mostra `n=9`. O n da mensagem vem da baseline (o menor dos dois), e a mensagem não informa de que lado veio.
2. **O abort reduz a amostra do fluxo mais crítico:** o `abortOnFail` encerrou o teste cedo, e o checkout ficou com n=67, saindo do gate relativo (⚪). Ele continua reprovado pelo SLO absoluto, então não há falso negativo. Mesmo assim, o comportamento precisa ser documentado.
3. **Layout:** no HTML, o selo "amostra baixa" desalinha a coluna Reqs.
