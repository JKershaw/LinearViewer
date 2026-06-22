# Recommendation baseline — lin597-fix-v2

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
| breakdown|plan|research | LIN-215 | 6/6 (100%) |
| plan|research | LIN-202 | 11/12 (92%) |
| breakdown|implement | LIN-489 | 6/6 (100%) |
| implement | LIN-428 | 30/30 (100%) |
| breakdown | LIN-385 | 4/6 (67%) |
| review | LIN-428 | 6/6 (100%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 1 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 3161 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 2 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 2908 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 3 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 3001 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 4 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 3108 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 5 | LIN-215@plan | LIN-215 | plan | plan/research/breakdown | ✓ | ✓ | 3039 |  |
| LIN-215@plan | OVER-advance probe — broad multi-surface E2E maintainability, nothing done, 'Proposed Changes' list reads plan-ish but NO committed scope/session-fit, no plan, no code -> expect plan/research/breakdown; a miss to implement is the over-keen direction | 6 | LIN-215@plan | LIN-215 | research | plan/research/breakdown | ✓ | ✓ | 3109 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 1 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2135 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 2 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 2299 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 3 | LIN-202@research | LIN-202 | research | research/plan | ✓ | ✓ | 2204 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 4 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 1948 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 5 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 2339 |  |
| LIN-202@research | OVER-advance probe (extreme) — broad migration, empty/unscoped description, nothing to act on -> expect research/plan; anything downstream (implement/breakdown) is the over-keen miss | 6 | LIN-202@research | LIN-202 | plan | research/plan | ✓ | ✓ | 1991 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 1 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2479 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 2 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2574 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 3 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2440 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 4 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2426 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 5 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 3267 |  |
| LIN-489@implement | UNDER-advance / plan-detection probe — research done (codebase Findings) + committed phasing plan + comment 'Planning complete, fits one focused session, ready for implementation', no code -> expect implement (breakdown defensible); a miss to plan/research is the re-deliberate / doesn't-detect-planning-is-done direction (fresh non-LIN-596 task for hypothesis 2) | 6 | LIN-489@implement | LIN-489 | implement | implement/breakdown | ✓ | ✓ | 2403 |  |
| LIN-385 | epic (descent → LIN-428) | 1 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2580 |  |
| LIN-385 | epic (descent → LIN-428) | 2 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2547 |  |
| LIN-385 | epic (descent → LIN-428) | 3 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2133 |  |
| LIN-385 | epic (descent → LIN-428) | 4 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3433 |  |
| LIN-385 | epic (descent → LIN-428) | 5 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3372 |  |
| LIN-385 | epic (descent → LIN-428) | 6 | LIN-385 → LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2240 |  |
| LIN-389 | mid (descent → LIN-428) | 1 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2995 |  |
| LIN-389 | mid (descent → LIN-428) | 2 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2847 |  |
| LIN-389 | mid (descent → LIN-428) | 3 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2905 |  |
| LIN-389 | mid (descent → LIN-428) | 4 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3437 |  |
| LIN-389 | mid (descent → LIN-428) | 5 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3178 |  |
| LIN-389 | mid (descent → LIN-428) | 6 | LIN-389 → LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 3347 |  |
| LIN-428 | leaf (descent → LIN-428) | 1 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2728 |  |
| LIN-428 | leaf (descent → LIN-428) | 2 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2718 |  |
| LIN-428 | leaf (descent → LIN-428) | 3 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2707 |  |
| LIN-428 | leaf (descent → LIN-428) | 4 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2685 |  |
| LIN-428 | leaf (descent → LIN-428) | 5 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2782 |  |
| LIN-428 | leaf (descent → LIN-428) | 6 | LIN-428 | LIN-428 | implement | implement | ✓ | ✓ | 2805 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 1 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3250 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 2 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 2720 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 3 | LIN-385@plan | LIN-385 | plan | plan/research | ✓ | ✓ | 3299 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 4 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3249 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 5 | LIN-385@plan | LIN-385 | implement | plan/research | ✗ | ✓ | 3092 |  |
| LIN-385@plan | leaf @ nothing-done — broad multi-spec migration epic, scope checklist, no plan → plan/research | 6 | LIN-385@plan | LIN-385 | research | plan/research | ✓ | ✓ | 3153 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 1 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2202 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 2 | LIN-385@breakdown | LIN-385 | implement | breakdown | ✗ | ✓ | 3250 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 3 | LIN-385@breakdown | LIN-385 | implement | breakdown | ✗ | ✓ | 2650 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 4 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2106 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 5 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2075 |  |
| LIN-385@breakdown | leaf @ plan-committed (comment[0]), multi-session migration across files → breakdown | 6 | LIN-385@breakdown | LIN-385 | breakdown | breakdown | ✓ | ✓ | 2450 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 1 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2312 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 2 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2332 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 3 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 3088 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 4 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2769 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 5 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2614 |  |
| LIN-428@implement | leaf @ plan-ready — one-session impl plan in desc + comment[0] "Plan ready", before code → implement | 6 | LIN-428@implement | LIN-428 | implement | implement | ✓ | ✓ | 2368 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 1 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2377 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 2 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2806 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 3 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 3113 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 4 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2875 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 5 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2840 |  |
| LIN-428@review | leaf @ landed — comment[1] implemented + PR open + CI green, before approve/merge → review | 6 | LIN-428@review | LIN-428 | review | review | ✓ | ✓ | 2547 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 1 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3395 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 2 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3302 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 3 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2685 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 4 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2025 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 5 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 2960 |  |
| LIN-596@implement | leaf @ plan-committed — full plan in desc (open questions deferred to impl) + comment[2] "Planning complete — ready for implementation", no code → implement; reproduces the live re-plan miss (LIN-597) | 6 | LIN-596@implement | LIN-596 | implement | implement | ✓ | ✓ | 3178 |  |
