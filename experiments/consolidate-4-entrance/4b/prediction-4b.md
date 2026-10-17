# Experiment 4b prediction: one authority per dispatch-entrance decision

Grounded at LinearViewer origin/main `15191460` (LIN-3601, #1912). Written before launch. The decision map with file:line is `decisions.md`; the ticket is `ticket-4b.md`; the replay is `replay/`.

## 1. Sites per decision, before → after (by hand)

Before is counted from `decisions.md` §1 at `15191460`. After is the expected state on the PR branch.

| # | Decision | Before (sites) | After: authority | After: callers |
|---|---|---|---|---|
| D1 | store missing → 503 | 2 | 1 | P, R, K |
| D2 | body read | 4 | 1 | S, P, R, K |
| D3 | verb shape / prompt / target | 2 | 1 (target set a param) | S, P |
| D4 | abort/cascade/kind/periodical/run-field list | 2 | 1 | S, P |
| D5 | presetId shape + lookup | 2 | 1 | S, K |
| D6 | model/harness/effort + effort warning | 3 | 1 check group + the one warning | S, P (via vDP), R, K |
| D7 | issueIdentifier / sessionId | 4 | 1 (V5 kept as a param) | S, P, R, K |
| D8 | audited 400 | 3 | 1 (audit a lane param) | S, P, R, K |
| D10 | subscription default | 4 | 1 | all |
| D11 | cascade expansion | 2 | 1 | S, P |
| D12 | persisted issueSource | 4 | 1 (`stampOnAbort` keeps V10) | all |
| D13 | issue credential | 3 | 1 proxy step (`required` param) + the session binding | P, R, K (+S) |
| D14 | issue context / 404 | 2 | 1 (transport param) | Ro, K |
| D15 | dangling-referent 422 | 2 | 1 | S, P |
| D16 | repo verbatim | 5 | 1 | all |
| D17 | proxy-context policy | 3 | 1 (S opt-in a param) | all |
| D18 | free-tier key + run gate | 5 | 1 | all |
| D19 | plan block | 4 | 1 extraction + per-arm source | S, P, Ro, Rl |
| D20 | base URL | 7 | 1 | all |
| D21 | `createDispatchItem` call | 5 | **1** | all |
| D22 | credential mint | 14 (4 gates, 5 attaches, 5 plain) | **1 gate + 1 attach + 1 plain**, inside the one call | all |
| D23 | row fields | 5 | 1 inline literal | all |
| D25 | 201 receipt | 3 | 1 builder, 3 named layouts | all |
| D26 | enqueue-failure map | 6 | 1 relay, per-verb order params | all |
| **Total** | 24 shared decisions | **96** | **24** (D22 counted as one) | |

The lane decisions are unchanged: D9 (S owner gate, P/R/K `requireGrant('dispatch')` at the registrations), D24 (S task-mode record and Harbour OS spawn), D27 (proxy `logEvent`) and D28 (R keepalive).

*Confidence.* High that D1–D23 reach one authority each. Medium for D25 and D26. Keeping the three 201 byte layouts and K's attach-failed-first order may lead a worker to keep three receipt literals or two relay functions. The replay will say whether bytes and order held, not how many builders there are.

## 2. Knots (`scripts/code-shape/seams.mjs`)

| Tree | Pairs | Group | Links |
|---|---|---|---|
| origin/main `15191460` (`seams-base.json`) | 18 | one of 9 | 62 |
| model A: the authority's 21 imports added to `lib/dispatch-entrance.js` | 18 | 9 | 62 |
| model B: A, plus the route files drop the imports the authority takes over | 18 | 9 | 62 |

**Prediction: 18 → 18, the group stays at 9, no new pair, no new link.**

The edges in model B that change:
* Agent API → Runs & dispatch, 46 → 38 imports;
* Agent API → LLM, 35 → 33;
* Agent API → Providers, 18 → 17;
* Agent API → Other features, 3 → 2;
* Runs & dispatch → {Agent API +2, Auth +1, LLM +2, Platform +2, Providers +2}.

Each Runs & dispatch → X link already exists because `routes/dispatch.js` makes it, so the authority adds weight, not edges. A new knot could arise only if the worker puts code in an unmapped file, or imports from a Runs & dispatch file into a Providers-area file. The ticket forbids `areas.json` edits.

## 3. Census (`dl1/census.mjs` at origin/main: 309 groups, 1,022 sites, 5.7 s)

12 groups touch an entrance file (`census-15191460.json`):

| Group | Decision | E sites | Inside an entrance handler? |
|---|---|---|---|
| G0000 | record `{remaining, limit, resetsAt}` | `dispatch.js:1063` | no (quota route) |
| G0003 | `['localhost','127.0.0.1'].includes` | `dispatch.js:606` | yes (S local-host check) |
| G0007 | `UUID_REGEX` | `dispatch.js:123` | no |
| G0012 | record `{code, category, retryable}` | `dispatch.js:1446`, `proxy-kickoff.js:533` | `proxy-kickoff.js:533` (K upstream envelope, V26) |
| G0033 | `[dispatch]` marker | `dispatch.js:1763` | no (broker) |
| G0036 | `DANGEROUS_CHARS_REGEX` | `dispatch.js:134` | no |
| G0037 | `MAX_NAME_LENGTH` | `dispatch.js:131` | no |
| G0042 | receipt record `{id: _id, promptName, kind, issueIdentifier, …}` | `dispatch.js:933`, `proxy-dispatch.js:163`, `proxy-kickoff.js:441` | **yes: D25, all three** |
| G0043 | `{'cancelled','expired'}` | `dispatch.js:1791` | no |
| G0115 | `MAX_IDENTIFIER_LENGTH` | `proxy-dispatch.js:40` | no |
| G0118 | record `{urlKey: proxyUrlKey, createdBy, clientSignal…}` | `proxy-dispatch.js:1137` | yes (Rl `computeOne`, against `proxy-compute.js`; R-only, not consolidated) |
| G0123 | near-duplicate fn | `proxy-dispatch.js:252` | no (watch formatter) |

*Finding (fact).* Of the 24 shared entrance decisions, the census sees exactly one as a group: D25, the receipt (G0042). The other 23 are intra-file or cross-file near-duplicate arms below its detectors' thresholds, or not records at all. This matches #2's observation: scattered *rules* are mostly invisible to a text census.

*Prediction.* G0042 goes 3 → 1 site and dissolves if the receipt becomes one builder with key-list layouts. It stays at 3 sites in one file if the worker writes three literal layouts. Census 309 / 1,022 → **308–309 / 1,019–1,022**. G0003, G0012 and G0118 stay; the decisions they hold are single-lane or (d). New groups inside `lib/dispatch-entrance.js`: 0–1 (for example a repeated lane-context record).

## 4. Lines

Entrance-specific code at `15191460` is about 2,000 lines including comments:
* S, `dispatch.js:483-999`: 517 lines;
* P, `proxy-dispatch.js:411-727`: 317;
* R, `:766-1382`: 617;
* K, `proxy-kickoff.js:76-79`, `:116-174` and `:206-544`: about 405;
* helpers: about 150.

Predicted:
* **Route files:** −1,600 to −1,950.
* **`lib/dispatch-entrance.js`:** +1,250 to +1,650 (45 lines today). Reason comments move with their code. #2 showed gathering comments beside one authority can add lines.
* **Production net:** −150 to −450, central −300.
* **Tests:** 0 required edits. The B censuses are written to pass if the shape rules in `ticket-4b.md` are kept. +0 to +200 lines if the worker adds unit tests for the authority's check groups.
* **The #4a sweeps:** 0 lines changed.

## 5. Fixes, rulings, divergences

* **Fixes expected: 7, all comments** (A1–A7 in `decisions.md` §2). **0 behaviour fixes.**
* **Divergences.**
  * (b): about 20, kept as named parameters.
  * (c): 9 (V1, V16, V19, V24, V29, V30, V33, V40, plus the S-only refusal tags on the proxy lanes).
  * (d): 7, kept and written up under Open questions (V4/V37, V5, V10, V12, V18, V23, V26).
* **Rulings expected: 0.** The ticket routes every (d) to the PR body, never to DECISION/BLOCKED. Residual risk is about 25%: #4a's 63-pin plan hit the plan-review loop bound. #4b has a similar security weight and a larger code move, so one plan-loop press is the likeliest cost to John.
* **Replay on the merge** (`replay/`, two seeds, about 21,000 requests each):
  * 0 differences;
  * entrance-unit coverage on the new side ≥95%;
  * `info:addItem-rawArgs` > 0 is likely if the one `fields` literal passes `undefined`/`null` where a verb passed no key. It is not a difference, but unit tests that `deepEqual` the item would see it.

  If differences appear, each needs its class from `decisions.md` §2.
* **Rebuild measures** (not in the ticket): the verbatim share of the new authority against the old handlers will be high, at least 75%. This is a consolidation, a move with unification, not a rebuild. The design-first rebuild is the next ticket (#4c).

## 6. Run time

* **Kickoff to merge: 1.5–3 h.** For comparison: 5c rebuilt the same files in 106 min; 4a took 2 h 34 min, including 54 min waiting on a ruling; #2 took 35 min; #3 took 16 min.
* **Replay at merge:** about 2 min 10 s per seed with coverage, 8 min for the full self-check (3 jobs).
* **Seams:** about 1 s per run. **Census:** about 6 s.

## 7. Replay self-check (done before launch, `replay/reports/selfcheck.log`)

* Identity: 0 differences on seeds 1 and 7, 21,077 requests each.
  * gen 16,430, of which S 3,000, P 3,008/3,006, R 3,000 and K 3,000;
  * edge 3,158;
  * test 1,489.
* Mutants: 16 of 16 caught on exactly their expected entrance(s). These cover:
  * a gate dropped in each of S, P, R and K;
  * a reply field changed in each;
  * a store argument;
  * a mint label;
  * an audit status;
  * a shared relay, caught on both P and R;
  * a first-failure order swap;
  * a key-order-only swap, caught by `bodyBytes` alone.
* `r-grant`, `k-grant` (the `dispatch` grant dropped from the R and K registrations): caught on R only and K only, because a token lacking `dispatch` with a valid issue reaches `addItem` (×35, ×29). This covers the gap in the #4a proxy-grant sweep, whose "reaches no sink" checks pass vacuously for R and K.
* One equivalent rewrite showed 0 differences.
* Entrance-unit line coverage: 99.67% (913/916). The 3 uncovered lines are HTTP-unreachable.
