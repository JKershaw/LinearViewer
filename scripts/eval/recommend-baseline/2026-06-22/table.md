# Recommendation baseline — 2026-06-22

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

## Scored summary (LIN-596)

Deterministic grader (no LLM judge): terminal action ∈ `expect`; descent terminal id === `descentExpect`.

| metric | value |
|---|---|
| terminal-action accuracy | 63/66 (95%) |
| descent-correct rate | 66/66 (100%) |
| distinct expected next-actions | 5 |

### Per expected-action recall

| expect | descentExpect | accuracy |
|---|---|---|
| implement | HAR-616 | 42/42 (100%) |
| plan|research | LIN-385 | 5/6 (83%) |
| breakdown | LIN-385 | 4/6 (67%) |
| review | LIN-428 | 12/12 (100%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| HAR-149 | epic (descent → HAR-616) | 1 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3039 |  |
| HAR-149 | epic (descent → HAR-616) | 2 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2975 |  |
| HAR-149 | epic (descent → HAR-616) | 3 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2894 |  |
| HAR-149 | epic (descent → HAR-616) | 4 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3154 |  |
| HAR-149 | epic (descent → HAR-616) | 5 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2693 |  |
| HAR-149 | epic (descent → HAR-616) | 6 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2097 |  |
| HAR-545 | mid (descent → HAR-616) | 1 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2644 |  |
| HAR-545 | mid (descent → HAR-616) | 2 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2193 |  |
| HAR-545 | mid (descent → HAR-616) | 3 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2749 |  |
| HAR-545 | mid (descent → HAR-616) | 4 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2433 |  |
| HAR-545 | mid (descent → HAR-616) | 5 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2557 |  |
| HAR-545 | mid (descent → HAR-616) | 6 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2804 |  |
| HAR-616 | leaf (descent → HAR-616) | 1 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2828 |  |
| HAR-616 | leaf (descent → HAR-616) | 2 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2958 |  |
| HAR-616 | leaf (descent → HAR-616) | 3 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2650 |  |
| HAR-616 | leaf (descent → HAR-616) | 4 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2308 |  |
| HAR-616 | leaf (descent → HAR-616) | 5 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2312 |  |
| HAR-616 | leaf (descent → HAR-616) | 6 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2526 |  |
| LIN-385 | epic (descent → LIN-428) | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3119 |  |
| LIN-385 | epic (descent → LIN-428) | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3421 |  |
| LIN-385 | epic (descent → LIN-428) | 3 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2801 |  |
| LIN-385 | epic (descent → LIN-428) | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3173 |  |
| LIN-385 | epic (descent → LIN-428) | 5 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2924 |  |
| LIN-385 | epic (descent → LIN-428) | 6 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2972 |  |
| LIN-389 | mid (descent → LIN-428) | 1 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2948 |  |
| LIN-389 | mid (descent → LIN-428) | 2 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2421 |  |
| LIN-389 | mid (descent → LIN-428) | 3 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3667 |  |
| LIN-389 | mid (descent → LIN-428) | 4 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2572 |  |
| LIN-389 | mid (descent → LIN-428) | 5 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2964 |  |
| LIN-389 | mid (descent → LIN-428) | 6 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2890 |  |
| LIN-428 | leaf (descent → LIN-428) | 1 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2997 |  |
| LIN-428 | leaf (descent → LIN-428) | 2 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3340 |  |
| LIN-428 | leaf (descent → LIN-428) | 3 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3180 |  |
| LIN-428 | leaf (descent → LIN-428) | 4 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3001 |  |
| LIN-428 | leaf (descent → LIN-428) | 5 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2709 |  |
| LIN-428 | leaf (descent → LIN-428) | 6 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2187 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 1 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3214 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 2 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3150 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 3 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 2921 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 4 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3145 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 5 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3422 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 6 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3528 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 1 | LIN-385@breakdown | LIN-385 | plan | breakdown | ✗ | ✓ | 2975 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 2 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2113 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 3 | LIN-385@breakdown | LIN-385 | implement | breakdown | ✗ | ✓ | 3519 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 4 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2026 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 5 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2145 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 6 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 1999 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 1 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2813 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 2 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 3475 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 3 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 3722 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 4 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2238 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 5 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2081 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 6 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 3072 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 1 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2972 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 2 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 3084 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 3 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2911 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 4 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2913 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 5 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2449 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 6 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2559 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 1 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 1854 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 2 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 1915 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 3 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2116 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 4 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2284 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 5 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2078 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 6 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 1811 |  |
