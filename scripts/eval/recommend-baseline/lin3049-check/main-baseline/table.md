# Recommendation baseline — 2026-06-29

model: `openai/gpt-5.4-mini` · repeats: 6 · harness: `scripts/eval-recommend-baseline.mjs` (local pipeline, fixtures-only — NOT deployed proxy)

## Scored summary (LIN-596)

Deterministic grader (no LLM judge): terminal action ∈ `expect`; descent terminal id === `descentExpect`.

| metric | value |
|---|---|
| terminal-action accuracy | 18/18 (100%) |
| descent-correct rate | 18/18 (100%) |
| distinct expected next-actions | 5 |

### Per expected-action recall

| expect | descentExpect | accuracy |
|---|---|---|
| implement|implementation | LIN-APB-pos | 6/6 (100%) |
| implement|implementation|plan | LIN-APB-neg | 6/6 (100%) |
| plan|plan-review|research | LIN-APB-diverged | 6/6 (100%) |

## Per-run capture

| target | role | run | descent path | terminal | action | expect | ✓action | ✓descent | prompt len | stop |
|---|---|---|---|---|---|---|---|---|---|---|
| LIN-APB-pos | no-regression pin: a breakdown child carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict routes to implement/implementation — AND already does so on unmodified main (6/6); this case does NOT isolate the meta guards' effect | 1 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2218 |  |
| LIN-APB-pos | no-regression pin: a breakdown child carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict routes to implement/implementation — AND already does so on unmodified main (6/6); this case does NOT isolate the meta guards' effect | 2 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2418 |  |
| LIN-APB-pos | no-regression pin: a breakdown child carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict routes to implement/implementation — AND already does so on unmodified main (6/6); this case does NOT isolate the meta guards' effect | 3 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2061 |  |
| LIN-APB-pos | no-regression pin: a breakdown child carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict routes to implement/implementation — AND already does so on unmodified main (6/6); this case does NOT isolate the meta guards' effect | 4 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2484 |  |
| LIN-APB-pos | no-regression pin: a breakdown child carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict routes to implement/implementation — AND already does so on unmodified main (6/6); this case does NOT isolate the meta guards' effect | 5 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2305 |  |
| LIN-APB-pos | no-regression pin: a breakdown child carrying its own copied plan slice + session-fit + plan-review-due:no citing the parent's approving verdict routes to implement/implementation — AND already does so on unmodified main (6/6); this case does NOT isolate the meta guards' effect | 6 | LIN-APB-pos | LIN-APB-pos | implement | implement/implementation | ✓ | ✓ | 2302 |  |
| LIN-APB-neg | non-discriminating control: a breakdown child with a plain acceptance-criteria description and NO recorded Approve (its expect accepts every label seen on both main and the PR, so it cannot fail; a thin dispatch-contract child staying in prep is still unmeasured) | 1 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1701 |  |
| LIN-APB-neg | non-discriminating control: a breakdown child with a plain acceptance-criteria description and NO recorded Approve (its expect accepts every label seen on both main and the PR, so it cannot fail; a thin dispatch-contract child staying in prep is still unmeasured) | 2 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1561 |  |
| LIN-APB-neg | non-discriminating control: a breakdown child with a plain acceptance-criteria description and NO recorded Approve (its expect accepts every label seen on both main and the PR, so it cannot fail; a thin dispatch-contract child staying in prep is still unmeasured) | 3 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1729 |  |
| LIN-APB-neg | non-discriminating control: a breakdown child with a plain acceptance-criteria description and NO recorded Approve (its expect accepts every label seen on both main and the PR, so it cannot fail; a thin dispatch-contract child staying in prep is still unmeasured) | 4 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1912 |  |
| LIN-APB-neg | non-discriminating control: a breakdown child with a plain acceptance-criteria description and NO recorded Approve (its expect accepts every label seen on both main and the PR, so it cannot fail; a thin dispatch-contract child staying in prep is still unmeasured) | 5 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1604 |  |
| LIN-APB-neg | non-discriminating control: a breakdown child with a plain acceptance-criteria description and NO recorded Approve (its expect accepts every label seen on both main and the PR, so it cannot fail; a thin dispatch-contract child staying in prep is still unmeasured) | 6 | LIN-APB-neg | LIN-APB-neg | implement | plan/implement/implementation | ✓ | ✓ | 1922 |  |
| LIN-APB-diverged | acceptance case: a breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice — the gate (and the Step-1/completed-prep guards) must re-derive on visible divergence; acceptance criterion is ZERO implement-family (research is accepted: reviewed baseline 5/6 research on main) | 1 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review/research | ✓ | ✓ | 2148 |  |
| LIN-APB-diverged | acceptance case: a breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice — the gate (and the Step-1/completed-prep guards) must re-derive on visible divergence; acceptance criterion is ZERO implement-family (research is accepted: reviewed baseline 5/6 research on main) | 2 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review/research | ✓ | ✓ | 2107 |  |
| LIN-APB-diverged | acceptance case: a breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice — the gate (and the Step-1/completed-prep guards) must re-derive on visible divergence; acceptance criterion is ZERO implement-family (research is accepted: reviewed baseline 5/6 research on main) | 3 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review/research | ✓ | ✓ | 2265 |  |
| LIN-APB-diverged | acceptance case: a breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice — the gate (and the Step-1/completed-prep guards) must re-derive on visible divergence; acceptance criterion is ZERO implement-family (research is accepted: reviewed baseline 5/6 research on main) | 4 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review/research | ✓ | ✓ | 2223 |  |
| LIN-APB-diverged | acceptance case: a breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice — the gate (and the Step-1/completed-prep guards) must re-derive on visible divergence; acceptance criterion is ZERO implement-family (research is accepted: reviewed baseline 5/6 research on main) | 5 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review/research | ✓ | ✓ | 2383 |  |
| LIN-APB-diverged | acceptance case: a breakdown child whose copied slice cites the parent's approving verdict, but a later comment shows the parent plan revised past that slice — the gate (and the Step-1/completed-prep guards) must re-derive on visible divergence; acceptance criterion is ZERO implement-family (research is accepted: reviewed baseline 5/6 research on main) | 6 | LIN-APB-diverged | LIN-APB-diverged | research | plan/plan-review/research | ✓ | ✓ | 2334 |  |
