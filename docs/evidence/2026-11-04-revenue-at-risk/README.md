# Evidência: `revenue_at_risk` recebia `undefined` sob sobrecarga

**Data:** 04/11/2026 · **Ambiente:** local (Windows, k6 v2.2.0, Node 22) · **Arquivo:** `src/scenarios/checkout.ts`

## Bug

```ts
const body = json<{ total: number }>(add);
if (body) cartTotal = body.total;
```

Sob sobrecarga, `POST /cart/{id}/items` responde **503 com JSON de erro** (`{"error":"overloaded"}`). O corpo existe, mas não tem `total`, e `cartTotal` vira `undefined`. A tipagem `json<{ total: number }>` escondia o problema, porque prometia um formato que a API não garante sob carga.

## Efeitos

1. **Receita em risco subestimada.** `revenueAtRisk.add(undefined)` é descartado pelo k6, que emite o aviso `'undefined' is an invalid value for metric 'revenue_at_risk'`.
2. **Pedido confirmado contado como falha.** Se o último item falhava e o pedido era criado com sucesso, o check `'pedido: total = carrinho'` comparava `order.total === undefined`. O pedido saía de `revenueConfirmed` e da conversão.

## Correção

Só uma resposta `200` com `total` numérico atualiza o carrinho. Em qualquer outro caso, vale o último total conhecido.

## Reprodução

Mesmo cenário nas duas execuções: perfil `stress` com `TIME_SCALE=0.15`, contra o mock com **3 workers e fila de 10**. A capacidade foi reduzida para forçar 503 no `addItem`.

| | Antes | Depois |
|---|--:|--:|
| Avisos `invalid value for metric 'revenue_at_risk'` | **222** | **0** |
| Erro HTTP no fluxo `cart` | 61,61% | 58,94% |
| Erro HTTP no fluxo `checkout` | 75,71% | 67,24% |
| Pedidos confirmados | 149 | 208 |
| Receita em risco | R$ 401.423,00 | R$ 515.652,30 |

**A prova da correção é a contagem de avisos**, de 222 para 0. As diferenças em pedidos e receita misturam o efeito da correção com a variação natural entre execuções em sobrecarga. A taxa de erro HTTP do checkout, que o bug não afeta, também variou (76% e 67%). Por isso, esses números não devem ser lidos como o tamanho exato do impacto.

## Arquivos

- [k6-antes.txt](k6-antes.txt) · [summary-antes.json](summary-antes.json)
- [k6-depois.txt](k6-depois.txt) · [summary-depois.json](summary-depois.json)
