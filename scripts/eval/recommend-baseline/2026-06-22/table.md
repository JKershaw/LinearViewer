# Recommendation baseline — 2026-06-22

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

| target | role | run | descent path | terminal | action | prompt len | stop |
|---|---|---|---|---|---|---|---|
| HAR-149 | epic | 1 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | review | 3105 |  |
| HAR-149 | epic | 2 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | review | 3276 |  |
| HAR-149 | epic | 3 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | 2818 |  |
| HAR-149 | epic | 4 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | review | 2728 |  |
| HAR-149 | epic | 5 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | review | 2757 |  |
| HAR-149 | epic | 6 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | review | 2808 |  |
| HAR-545 | mid | 1 | HAR-545 → HAR-616 | HAR-616 | review | 2564 |  |
| HAR-545 | mid | 2 | HAR-545 → HAR-616 | HAR-616 | implement | 3859 |  |
| HAR-545 | mid | 3 | HAR-545 → HAR-616 | HAR-616 | review | 2554 |  |
| HAR-545 | mid | 4 | HAR-545 → HAR-616 | HAR-616 | review | 2777 |  |
| HAR-545 | mid | 5 | HAR-545 → HAR-616 | HAR-616 | review | 2688 |  |
| HAR-545 | mid | 6 | HAR-545 → HAR-616 | HAR-616 | review | 2707 |  |
| HAR-616 | leaf | 1 | HAR-616 | HAR-616 | review | 2711 |  |
| HAR-616 | leaf | 2 | HAR-616 | HAR-616 | review | 3000 |  |
| HAR-616 | leaf | 3 | HAR-616 | HAR-616 | review | 2566 |  |
| HAR-616 | leaf | 4 | HAR-616 | HAR-616 | review | 2039 |  |
| HAR-616 | leaf | 5 | HAR-616 | HAR-616 | review | 2386 |  |
| HAR-616 | leaf | 6 | HAR-616 | HAR-616 | review | 3130 |  |
| LIN-385 | epic | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | review | 2649 |  |
| LIN-385 | epic | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | review | 2960 |  |
| LIN-385 | epic | 3 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | review | 2580 |  |
| LIN-385 | epic | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | review | 3135 |  |
| LIN-385 | epic | 5 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | review | 2982 |  |
| LIN-385 | epic | 6 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | review | 3236 |  |
| LIN-389 | mid | 1 | LIN-389 → LIN-428 | LIN-428 | review | 3413 |  |
| LIN-389 | mid | 2 | LIN-389 → LIN-428 | LIN-428 | review | 2910 |  |
| LIN-389 | mid | 3 | LIN-389 → LIN-428 | LIN-428 | review | 3322 |  |
| LIN-389 | mid | 4 | LIN-389 → LIN-428 | LIN-428 | review | 2325 |  |
| LIN-389 | mid | 5 | LIN-389 → LIN-428 | LIN-428 | review | 3017 |  |
| LIN-389 | mid | 6 | LIN-389 → LIN-428 | LIN-428 | review | 2981 |  |
| LIN-428 | leaf (direct cross-check) | 1 | LIN-428 | LIN-428 | review | 2778 |  |
| LIN-428 | leaf (direct cross-check) | 2 | LIN-428 | LIN-428 | review | 2199 |  |
| LIN-428 | leaf (direct cross-check) | 3 | LIN-428 | LIN-428 | review | 2269 |  |
| LIN-428 | leaf (direct cross-check) | 4 | LIN-428 | LIN-428 | review | 3048 |  |
| LIN-428 | leaf (direct cross-check) | 5 | LIN-428 | LIN-428 | review | 2654 |  |
| LIN-428 | leaf (direct cross-check) | 6 | LIN-428 | LIN-428 | review | 3100 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 1 | FIX-448-leaf | FIX-448-leaf | review | 1833 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 2 | FIX-448-leaf | FIX-448-leaf | review | 2197 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 3 | FIX-448-leaf | FIX-448-leaf | review | 2482 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 4 | FIX-448-leaf | FIX-448-leaf | review | 2167 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 5 | FIX-448-leaf | FIX-448-leaf | review | 1929 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 6 | FIX-448-leaf | FIX-448-leaf | review | 2109 |  |
