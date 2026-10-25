# Passo 3 — gate de regressão vs baseline do CI (2026-10-25 06:19:05)
### Regressão vs baseline — `load`
Baseline: `gh-40177713549` · tolerância +15% (piso 15ms) · erros +0.5pp · amostra mínima 100

| Fluxo | n | p95 atual | p95 base | Δ | p99 atual | p99 base | erros atual | erros base | |
|---|--:|--:|--:|--:|--:|--:|--:|--:|:-:|
| browse | 1245 | 360.3 | 73.03 | +393.4% | 386.76 | 77.11 | 1.61% | 0.00% | 🔴 |
| auth | 9 | 375.02 | 111.2 | +237.2% | 378.1 | 112.06 | 0.00% | 0.00% | ⚪ |
| cart | 225 | 334.07 | 50.3 | +564.2% | 375.23 | 51.6 | 1.33% | 0.00% | 🔴 |
| checkout | 67 | 471.29 | 176.48 | +167.1% | 496.86 | 180.54 | 4.48% | 0.00% | ⚪ |

> ⚪ **Amostra insuficiente** — fora do gate relativo (ainda protegidos pelo SLO absoluto): auth (n=8 < 100), checkout (n=67 < 100)

**❌ Regressão detectada:** browse: p95 +393.4%, p99 +401.6%, erros +1.61pp · cart: p95 +564.2%, p99 +627.2%, erros +1.33pp
compare exit code: 1
