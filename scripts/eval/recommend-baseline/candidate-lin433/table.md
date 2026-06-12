# Recommendation baseline — 2026-06-12

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, NOT deployed proxy)

| target | role | run | descent path | terminal | action | prompt len | stop |
|---|---|---|---|---|---|---|---|
| LIN-385 | epic | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | research | 2624 |  |
| LIN-385 | epic | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | plan | 3793 |  |
| LIN-385 | epic | 3 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | plan | 4082 |  |
| LIN-385 | epic | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | plan | 3570 |  |
| LIN-385 | epic | 5 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | plan | 5142 |  |
| LIN-385 | epic | 6 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | plan | 4683 |  |
| LIN-389 | mid | 1 | LIN-389 → LIN-428 | LIN-428 | implement | 3215 |  |
| LIN-389 | mid | 2 | LIN-389 → LIN-428 | LIN-428 | research | 2905 |  |
| LIN-389 | mid | 3 | LIN-389 → LIN-428 | LIN-428 | plan | 2894 |  |
| LIN-389 | mid | 4 | LIN-389 → LIN-428 | LIN-428 | plan | 3876 |  |
| LIN-389 | mid | 5 | LIN-389 → LIN-428 | LIN-428 | plan | 3743 |  |
| LIN-389 | mid | 6 | LIN-389 → LIN-428 | LIN-428 | plan | 4055 |  |
| LIN-428 | leaf (direct cross-check) | 1 | LIN-428 | LIN-428 | plan | 3815 |  |
| LIN-428 | leaf (direct cross-check) | 2 | LIN-428 | LIN-428 | plan | 2992 |  |
| LIN-428 | leaf (direct cross-check) | 3 | LIN-428 | LIN-428 | research | 4056 |  |
| LIN-428 | leaf (direct cross-check) | 4 | LIN-428 | LIN-428 | plan | 3476 |  |
| LIN-428 | leaf (direct cross-check) | 5 | LIN-428 | LIN-428 | research | 3843 |  |
| LIN-428 | leaf (direct cross-check) | 6 | LIN-428 | LIN-428 | plan | 3941 |  |

## Deferred (config-blocked)

- **Harbour**: no proxy token (deferred — supply token+base via env) — HAR-149, HAR-545, HAR-616
