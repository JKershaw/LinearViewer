# Recommendation baseline — 2026-06-29

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

## Scored summary (LIN-596)

Deterministic grader (no LLM judge): terminal action ∈ `expect`; descent terminal id === `descentExpect`.

| metric | value |
|---|---|
| terminal-action accuracy | 100/108 (93%) |
| descent-correct rate | 108/108 (100%) |
| distinct expected next-actions | 6 |

### Per expected-action recall

| expect | descentExpect | accuracy |
|---|---|---|
| close-out | FIX-812-approve-ledger | 12/12 (100%) |
| review | FIX-812-noreview | 17/18 (94%) |
| implement | HAR-616 | 47/48 (98%) |
| breakdown|plan|research | LIN-215 | 6/6 (100%) |
| plan|research | LIN-202 | 8/12 (67%) |
| breakdown|implement | LIN-489 | 6/6 (100%) |
| breakdown | LIN-385 | 4/6 (67%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| FIX-812-approve-ledger | landed leaf, review recorded Approve — conditional + non-empty ledger, still unmerged/In Progress (expect -> close-out; the LIN-804 under-fire headline shape) | 1 | FIX-812-approve-ledger | FIX-812-approve-ledger | close-out | close-out | ✓ | ✓ | 1888 |  |
| FIX-812-approve-ledger | landed leaf, review recorded Approve — conditional + non-empty ledger, still unmerged/In Progress (expect -> close-out; the LIN-804 under-fire headline shape) | 2 | FIX-812-approve-ledger | FIX-812-approve-ledger | close-out | close-out | ✓ | ✓ | 2053 |  |
| FIX-812-approve-ledger | landed leaf, review recorded Approve — conditional + non-empty ledger, still unmerged/In Progress (expect -> close-out; the LIN-804 under-fire headline shape) | 3 | FIX-812-approve-ledger | FIX-812-approve-ledger | close-out | close-out | ✓ | ✓ | 2126 |  |
| FIX-812-approve-ledger | landed leaf, review recorded Approve — conditional + non-empty ledger, still unmerged/In Progress (expect -> close-out; the LIN-804 under-fire headline shape) | 4 | FIX-812-approve-ledger | FIX-812-approve-ledger | close-out | close-out | ✓ | ✓ | 2232 |  |
| FIX-812-approve-ledger | landed leaf, review recorded Approve — conditional + non-empty ledger, still unmerged/In Progress (expect -> close-out; the LIN-804 under-fire headline shape) | 5 | FIX-812-approve-ledger | FIX-812-approve-ledger | close-out | close-out | ✓ | ✓ | 1925 |  |
| FIX-812-approve-ledger | landed leaf, review recorded Approve — conditional + non-empty ledger, still unmerged/In Progress (expect -> close-out; the LIN-804 under-fire headline shape) | 6 | FIX-812-approve-ledger | FIX-812-approve-ledger | close-out | close-out | ✓ | ✓ | 1874 |  |
| FIX-812-approve-empty | landed leaf, review recorded a plain Approve + empty ledger, still unmerged/In Progress (LIN-810 — gate on verdict, not heading; expect -> close-out as a cheap pass-through) | 1 | FIX-812-approve-empty | FIX-812-approve-empty | close-out | close-out | ✓ | ✓ | 1785 |  |
| FIX-812-approve-empty | landed leaf, review recorded a plain Approve + empty ledger, still unmerged/In Progress (LIN-810 — gate on verdict, not heading; expect -> close-out as a cheap pass-through) | 2 | FIX-812-approve-empty | FIX-812-approve-empty | close-out | close-out | ✓ | ✓ | 2246 |  |
| FIX-812-approve-empty | landed leaf, review recorded a plain Approve + empty ledger, still unmerged/In Progress (LIN-810 — gate on verdict, not heading; expect -> close-out as a cheap pass-through) | 3 | FIX-812-approve-empty | FIX-812-approve-empty | close-out | close-out | ✓ | ✓ | 1770 |  |
| FIX-812-approve-empty | landed leaf, review recorded a plain Approve + empty ledger, still unmerged/In Progress (LIN-810 — gate on verdict, not heading; expect -> close-out as a cheap pass-through) | 4 | FIX-812-approve-empty | FIX-812-approve-empty | close-out | close-out | ✓ | ✓ | 1953 |  |
| FIX-812-approve-empty | landed leaf, review recorded a plain Approve + empty ledger, still unmerged/In Progress (LIN-810 — gate on verdict, not heading; expect -> close-out as a cheap pass-through) | 5 | FIX-812-approve-empty | FIX-812-approve-empty | close-out | close-out | ✓ | ✓ | 1897 |  |
| FIX-812-approve-empty | landed leaf, review recorded a plain Approve + empty ledger, still unmerged/In Progress (LIN-810 — gate on verdict, not heading; expect -> close-out as a cheap pass-through) | 6 | FIX-812-approve-empty | FIX-812-approve-empty | close-out | close-out | ✓ | ✓ | 2218 |  |
| FIX-812-noreview | landed leaf that LOOKS done (PR merged comment) but has NO review-verdict comment on the trail (LIN-811 — positive review evidence required before close-out; expect -> review, NOT close-out) | 1 | FIX-812-noreview | FIX-812-noreview | review | review | ✓ | ✓ | 1909 |  |
| FIX-812-noreview | landed leaf that LOOKS done (PR merged comment) but has NO review-verdict comment on the trail (LIN-811 — positive review evidence required before close-out; expect -> review, NOT close-out) | 2 | FIX-812-noreview | FIX-812-noreview | review | review | ✓ | ✓ | 1886 |  |
| FIX-812-noreview | landed leaf that LOOKS done (PR merged comment) but has NO review-verdict comment on the trail (LIN-811 — positive review evidence required before close-out; expect -> review, NOT close-out) | 3 | FIX-812-noreview | FIX-812-noreview | review | review | ✓ | ✓ | 1854 |  |
| FIX-812-noreview | landed leaf that LOOKS done (PR merged comment) but has NO review-verdict comment on the trail (LIN-811 — positive review evidence required before close-out; expect -> review, NOT close-out) | 4 | FIX-812-noreview | FIX-812-noreview | review | review | ✓ | ✓ | 1749 |  |
| FIX-812-noreview | landed leaf that LOOKS done (PR merged comment) but has NO review-verdict comment on the trail (LIN-811 — positive review evidence required before close-out; expect -> review, NOT close-out) | 5 | FIX-812-noreview | FIX-812-noreview | review | review | ✓ | ✓ | 2279 |  |
| FIX-812-noreview | landed leaf that LOOKS done (PR merged comment) but has NO review-verdict comment on the trail (LIN-811 — positive review evidence required before close-out; expect -> review, NOT close-out) | 6 | FIX-812-noreview | FIX-812-noreview | review | review | ✓ | ✓ | 2067 |  |
| HAR-149 | epic (descent → HAR-616) | 1 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3174 |  |
| HAR-149 | epic (descent → HAR-616) | 2 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2879 |  |
| HAR-149 | epic (descent → HAR-616) | 3 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2902 |  |
| HAR-149 | epic (descent → HAR-616) | 4 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2835 |  |
| HAR-149 | epic (descent → HAR-616) | 5 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2898 |  |
| HAR-149 | epic (descent → HAR-616) | 6 | HAR-149 → HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3192 |  |
| HAR-545 | mid (descent → HAR-616) | 1 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2988 |  |
| HAR-545 | mid (descent → HAR-616) | 2 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2572 |  |
| HAR-545 | mid (descent → HAR-616) | 3 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2444 |  |
| HAR-545 | mid (descent → HAR-616) | 4 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3167 |  |
| HAR-545 | mid (descent → HAR-616) | 5 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2731 |  |
| HAR-545 | mid (descent → HAR-616) | 6 | HAR-545 → HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2807 |  |
| HAR-616 | leaf (descent → HAR-616) | 1 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3088 |  |
| HAR-616 | leaf (descent → HAR-616) | 2 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2853 |  |
| HAR-616 | leaf (descent → HAR-616) | 3 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2804 |  |
| HAR-616 | leaf (descent → HAR-616) | 4 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 3713 |  |
| HAR-616 | leaf (descent → HAR-616) | 5 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 2807 |  |
| HAR-616 | leaf (descent → HAR-616) | 6 | HAR-616 | HAR-616 | implement | implement | ✓ | ✓ | 4749 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 1 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 3249 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 2 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 2725 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 3 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 2676 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 4 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 2436 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 5 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 3364 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 6 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 2490 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 1 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2374 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 2 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2428 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 3 | LIN-202@research | LIN-202 | context | research/plan | ✗ | ✓ | 1660 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 4 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2259 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 5 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2723 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 6 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2391 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 1 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2522 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 2 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 3643 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 3 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2844 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 4 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2815 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 5 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2410 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 6 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2514 |  |
| LIN-385 | epic (descent → LIN-428) | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 4056 |  |
| LIN-385 | epic (descent → LIN-428) | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2935 |  |
| LIN-385 | epic (descent → LIN-428) | 3 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2620 |  |
| LIN-385 | epic (descent → LIN-428) | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3177 |  |
| LIN-385 | epic (descent → LIN-428) | 5 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3518 |  |
| LIN-385 | epic (descent → LIN-428) | 6 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3243 |  |
| LIN-389 | mid (descent → LIN-428) | 1 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3563 |  |
| LIN-389 | mid (descent → LIN-428) | 2 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3531 |  |
| LIN-389 | mid (descent → LIN-428) | 3 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3118 |  |
| LIN-389 | mid (descent → LIN-428) | 4 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2867 |  |
| LIN-389 | mid (descent → LIN-428) | 5 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3710 |  |
| LIN-389 | mid (descent → LIN-428) | 6 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2724 |  |
| LIN-428 | leaf (descent → LIN-428) | 1 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3228 |  |
| LIN-428 | leaf (descent → LIN-428) | 2 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2647 |  |
| LIN-428 | leaf (descent → LIN-428) | 3 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 4103 |  |
| LIN-428 | leaf (descent → LIN-428) | 4 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3438 |  |
| LIN-428 | leaf (descent → LIN-428) | 5 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3992 |  |
| LIN-428 | leaf (descent → LIN-428) | 6 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2902 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 1 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 3307 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 2 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 4240 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 3 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 3653 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 4 | LIN-385@plan | LIN-385 | plan | plan/research | ✓ | ✓ | 3858 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 5 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3932 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 6 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 3145 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 1 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2103 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 2 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2046 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 3 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 1857 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 4 | LIN-385@breakdown | LIN-385 | plan | breakdown | ✗ | ✓ | 3130 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 5 | LIN-385@breakdown | LIN-385 | implement | breakdown | ✗ | ✓ | 2188 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 6 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2209 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 1 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2532 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 2 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2183 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 3 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2432 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 4 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2816 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 5 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2613 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 6 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2669 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 1 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 3122 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 2 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 3041 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 3 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 3032 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 4 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 3162 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 5 | LIN-428@review | LIN-428 | close-out | review | ✗ | ✓ | 2570 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 6 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2574 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 1 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2429 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 2 | LIN-596@implement | LIN-596 | implementation | implement | ✗ | ✓ | 3139 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 3 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3075 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 4 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3122 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 5 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2624 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 6 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3352 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 1 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2129 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 2 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2203 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 3 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 1821 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 4 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2051 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 5 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 2401 |  |
| FIX-448-leaf | plan-less research->implementation leaf, merged but In Progress (expect -> review) | 6 | FIX-448-leaf | FIX-448-leaf | review | review | ✓ | ✓ | 1589 |  |
