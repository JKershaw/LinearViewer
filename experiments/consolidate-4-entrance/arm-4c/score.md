# #4c score: LIN-3611, PR #1917, design-first rebuild of `lib/dispatch-entrance.js`

The merge is `2e8cba6e`, a squash with one parent. Old is that parent, `ab85eb9e`; new is `2e8cba6e`. The PR head
`3b8f5524` was fetched as `refs/score/pr1917` (`git fetch origin pull/1917/head`), and its tree is byte-identical to the
merge. The merge changed four files: `lib/dispatch-entrance.js`, a new `tests/unit/dispatch-entrance-addItem-key-sets.test.js`,
`tests/unit/lin-3134-declared-mint-census.test.js` and `docs/architecture/source-map.md`.

Timeline (UTC): kickoff 14:25; ruling ~15:16; first head `9c0d058e` committed 15:44:52 (sent back at 72.7% verbatim);
final head `3b8f5524` 16:19:01; merged 16:44:40. **Kickoff to merge: 2 h 20 min.**

Everything below is in this folder. `/home/user/LinearViewer` was only fetched and read (`git archive`, `git show`).

## 1. Replay (independent, `replay/`)

Tool changes for this base (all in `replay/`, the originals in `../replay/` are untouched):
* `replay.mjs`: LIN-3610 (`ab85eb9e`) moved `buildPeriodicalGateMarker` to `lib/periodicals.js`, so the vocabulary
  load now falls back to `per.buildPeriodicalGateMarker` (one line). Without the change the replay failed before its
  first request on both sides.
* The test tier was re-captured at `ab85eb9e`: 1,501 calls from 112 files, the same count as at `47d87055`
  (`pinned/test-calls-ab85eb9e.json`). It was also captured at the merge: 1,506 calls from 113 files, 5 of them from
  the new A3 test (`pinned/test-calls-2e8cba6e.json`).
* `selfcheck-new.mjs` and `check-anchors-new.mjs`: the mutants re-targeted at the merged tree (`mutants-new.js`),
  plus the new mutant `s-gate-late`. All 21 anchors count 1.
* `direct-selfcheck-new.sh`: the four direct-class mutants re-targeted at the merged tree.
* `replay-flake.mjs`: `replay.mjs` plus `--only-re <regex>`, which keeps only the scenarios whose JSON matches.

Pins: `pin/ab85eb9e`, `pin/ab85eb9e-b` (an old twin), `pin/2e8cba6e`, `pin/2e8cba6e-b` (a new twin).

| Run | Result |
|---|---|
| old vs old twin, seeds 1 and 7 (`reports/identity-seed{1,7}`) | 21,089 requests each (gen 16,430, edge 3,158, test 1,501), **0 differing** |
| **old vs new, seed 1** (`reports/score-seed1`) | 21,089 requests (S 4,020, P 3,547, R 3,819, K 3,450), **0 differing**, exports identical |
| **old vs new, seed 7** (`reports/score-seed7`) | 21,089 requests, **0 differing** |
| old vs new, test tier captured at the merge, seeds 1 and 7 | 1,506 requests each, 0 differing |
| direct class, old vs new, seeds 1 and 7 | 600 cases each, **0 differing**, exports identical (the 8 names, `typeof`, arity), fail-closed holds on both sides |
| direct class, old vs old twin (seed 1) and new vs new twin (seed 7) | 0 differing |
| entrance-unit coverage, new | **99.5% (1,000/1,005)**. `lib/dispatch-entrance.js` 99.47% (932/937). Uncovered: `:1199-1200` (the fail-closed throw, which the direct class covers) and `:1393-1395` (the override arm's `!generated` 500, unreachable over HTTP). These are the same two places as at old (`:970-971`, `:1284-1286`). |

**Self-check on the new tree** (`reports/selfcheck-new.log`, 8 min 41 s, base `pin/2e8cba6e`, twin `pin/2e8cba6e-b`): **23/23 PASS.**
* Identity, seeds 1 and 7: 0 differing. Coverage 99.5% on each seed.
* `s-gate` (the owner-gate stage removed): caught on S only (depCalls ×1,481).
* **`s-gate-late`** (new: the owner-gate stage moved after the `SESSION_AFTER_GATE` checks): caught on S only (depCalls ×338, console, bodyBytes).
* `s-reply` ×860, `s-store-arg` ×24, `s-mint-label` ×196: each caught on S only.
* `p-gate` ×320, `p-reply` ×559, `p-log` ×47: each caught on P only.
* `r-gate` ×1,261, `r-reply` ×298: each caught on R only.
* `shared-relay`: caught on P, R and K, all three.
* `k-gate` ×36, `k-reply` ×351, `k-order` ×3: each caught on K only. `k-keyorder` ×351 was caught as bytes and etag only, never in the parsed body.
* **`r-grant`** (`requireGrant('dispatch')` dropped on R): caught on R only (queue store ×35).
* **`k-grant`** (the same on K): caught on K only (queue store ×29).
* `m-declare` (`declared: true` → `false` on K): caught on K only (proxy token store ×588).
* `gate-to-prompt`: caught on K and S.
* Equivalent rewrites `eq-dispatchedAt` and `eq-fields-row` (`fields: { ...rowFor(...) }`): 0 differences, as expected.

Direct mutants on the new tree (`reports/direct-selfcheck-new.log`): all four caught.
* `fail-open`: 332 differing, and fail-closed reported FAILS on the new side.
* `gate-late`: 70.
* `gate-target`: 26.
* `gate-ignored`: 39.

These are the same counts as at `47d87055`.

**Keepalive and hang-up timing flake.**
* **This replay, 30 runs:** `replay-flake.mjs --only-re 'hangUp|clientAbort|keepalive|Keepalive'` selects 319 scenarios at seed 1 and 312 at seed 7. I ran 5 rounds × 2 seeds × {old vs new, old vs old, new vs new}. **All 30 runs: 0 differing** (`reports/flake.log`). This replay runs on a virtual clock, so it cannot show real teardown timing.
* **The worker's own harness, the one the PR quotes** (`experiments/lin-3604-entrance-replay`, 2,455 inputs, 17 of them keepalive):
  * Run 5× per side sequentially: 5 old-vs-new compares, 4 old-vs-old and 4 new-vs-new. **All 0 differences**, vacuity guard 0 (`wr/summary.log`).
  * Run 3× more with old and new concurrently while the full unit suite was running (load): 3 old-vs-new, 2 old-vs-old and 2 new-vs-new. All 0 (`wr/load/`).
* **The PR's one keepalive/hang-up difference did not reproduce in 20 harness comparisons, on either side, loaded or not.** I could not tell whether it is a timing flake that also hits old vs old: nothing differed on any pairing. The commit message of `8397ff9a` also mentions "2,458 with the abort fixtures", i.e. 3 abort fixtures that are not in the committed harness. If the difference came from one of those, it cannot be re-run from the repo.

**Classification: 0 differences on every tier, so there is nothing to classify.**

## 2. Verbatim (`verbatim/vb.mjs`, `verbatim/*.json`)

| Comparison | Raw | Semicolons normalised | Longest run |
|---|---|---|---|
| **authority, old `ab85eb9e` → new** | 45.7% (355/777) | **45.7%** | 89 |
| authority, `47d87055` → new | 45.7% | 45.7% | 89 |
| authority, old → first head `9c0d058e` (the one review sent back) | 72.7% (545/750) | 72.7% | 89 |
| authority, old → final head `3b8f5524` | 45.7% | 45.7% | 89 |
| **authority vs pre-#4b sources at `15191460`** (3 route files + the 45-line helper, 1,747 lines; the files 5c's 86% was measured *into*, `d2d7d818` = `15191460` on these files) | 25.2% (196/777) | **25.2%** | 28 |
| the same, with `lib/dispatch-validation.js` added (the 1,864-line pool #4b's 42.0% used) | 25.4% | 25.4% | 28 |
| entrance unit (4 files) vs pre-#4b 4 files | 62.9% (1,078/1,714) | 62.9% | 292 |
| entrance unit, `47d87055` → new | 75.4% | 75.4% | 1,026 (the untouched route files) |
| authority vs 5c's *base* `16e7ae77` (3 routers) | 19.4% | 19.4% | 9 |
| entrance unit vs 5c's base | 55.8% | 55.8% | 86 |
| for reference: #4b authority vs pre-#4b 4 files | 41.9% | 41.9% | 28 |
| for reference: 5c, `16e7ae77` → `d2d7d818` | 86.1% | 86.1% | 151 |

* **This confirms the PR's 45.7%** (raw = normalised: the file's semicolon style is unchanged). The self-check old→old and new→new is 100%.
* **The sequence against 5c's endpoint:** 5c kept 86% of its own text. #4b's authority kept 42% of 5c's output, #4c's 45.7% of #4b's. Compounded, **25% of the rebuilt authority is still verbatim from the 5c-era sources** (19% from before 5c). The whole entrance unit is 63% verbatim against 5c's output, because the three route files' GET/DELETE/PATCH code is untouched.

## 3. Shape (`experiments/rebuild-exp1/kit/shape.mjs`; `shape/<sha>/*.json`, `shape/summ2.cjs`)

**Authority, `ab85eb9e` → `2e8cba6e` (confirms the PR's table on every row):**

| | Old | New |
|---|---|---|
| Lines (code / comment) | 1,677 (878 / 704) | 1,769 (**937** / 731) |
| Decision points | 268 | **238** |
| Functions (`functions.count`) | 106 | **163** |
| Units over 10 | 7 | 2 (`finalizePrompt`, `descentArm`) |
| Worst function | `enterRecommendDispatch` 29 | **`finalizePrompt` 13** (`:939-1005`) |
| Longest function (code lines) | `createKit` 256 | **`descentArm` 74** |
| Max nesting | 4 | **3** |
| Exports | 8 | 8 (same names) |

First head `9c0d058e`, for comparison: 897 code lines, 252 decision points, 133 functions, worst `finalizePrompt` 19,
longest `bindLane` 142.

**The four entrance files across the sequence:**

| Commit | Lines | Code | Comment | Decision points | Functions | Over 10 | Worst (unit) | Worst entrance function | Longest function (code) | Max nesting |
|---|---|---|---|---|---|---|---|---|---|---|
| 5c base `16e7ae77` (3 routers) | 4,553 | 2,450 | 1,848 | 708 | 83 | 16 | 122 | 122 (S handler) | 1,079 | 5 |
| 5c merge = `15191460` (before #4b) | 4,350 | 2,158 | 1,931 | 649 | 172 | 14 | 63 | 63 (S handler) | 889 | 5 |
| `47d87055` (after #4b) | 4,012 | 2,056 | 1,671 | 585 | 187 | 15 | 29 | 29 (`enterRecommendDispatch`) | 657 (`createDispatchRoutes`) | 4 |
| **`2e8cba6e` (after #4c)** | 4,104 | **2,115** | 1,698 | **555** | 244 | 10 | 28 (the refire broker in `routes/dispatch.js`, not an entrance) | **13 (`finalizePrompt`)** | 657 (`createDispatchRoutes`, untouched) | 4 (route files) |

* **Against 5c.** 5c cut code lines 12% (2,450 → 2,158), decision points 8% and the worst function 122 → 63.
  #4b plus #4c from 5c's endpoint: code lines −2% (2,158 → 2,115), decision points −14% (649 → 555), and the worst
  entrance function 63 → 13. From 5c's base the whole sequence is: code lines −14%, decision points −22%, worst
  122 → 13.
* **#4c on its own** cut decision points 11% and the worst function 29 → 13, but **added** 59 code lines (+7%) and 57
  functions. The design is many small units (lanes as data, failure-rule tables, stage lists); the 938-line kit
  became 163 functions.

## 4. Conversions

PR branch commits, in order (`git log ab85eb9e..3b8f5524`):

| Time (+01:00) | Commit | What |
|---|---|---|
| 16:28:12 | `7613fde2` | **A1 replacement**: `plantAtEntranceGate` (position-planted through `scanDispatchCalls` + `findEntranceGate`); mutations 1 (iii c), 4 and 1 (v) re-planted, each also on a re-indented authority. Additions only (+51) |
| 16:28:25 | `10943a0f` | **A1 loosening**: `POST_DISPATCH_GATE` and its three text-planted tests removed (−17) |
| 16:29:52 | `a5706869` | **A3 replacement**: new `dispatch-entrance-addItem-key-sets.test.js` (per lane: every field plus a canary key; the key set equals the lane's literal) |
| 16:31:37 | `15bdaec5` | **A3 narrowing**: C2 (ii) accepts `fields: rowFor(...)` in `lib/dispatch-entrance.js` only, as one call with nothing after it, over a sole `rowFor` binding. Plus 4 witness tests (a trailing `\|\| body`, `&& body` or `?? body`; `rowFor` in a route file; 4 rebinding forms). This is narrower than the ticket's "exempt E calls from (ii)" |
| 16:42:45 | `fb0345bd` | the rebuild of `lib/dispatch-entrance.js` |
| 16:44:52 | `9c0d058e` | source-map (the first head) |
| 17:18:16 | `8397ff9a` | re-derive the entrances and the kit (review finding 1); deletes a stray `console.log` in the A3 test |
| 17:19:01 | `3b8f5524` | restore the exact `resolveProviderAccess` destructure (A5 kept) |

**In both conversions the replacement landed before the loosening, and all four test commits precede the rewrite.**

**Kept as written:** A2 (`E_GATE_PREDICATES`; the gate is still `if (isFollowUp) {`), A4 (two `declaredGrants: ['dispatch'],`
lines, `:737` and `:774`), A5 (the exact destructure, `:833`), A6 (no helper module) and A7.
`proxy-credential-fingerprint-stamping.test.js` and `lin-3130…` are unmodified. A1's position-planted witnesses still
go through `findEntranceGate`, and so through A2's predicate list.

**My re-run of the witnesses** (exported copies under `conv/`, `run-mut.sh`; each line runs lin-3134, the A3 test and the mint sweep, 89 tests):

| Copy | Result |
|---|---|
| merge, unchanged (`new-base`) | 89/89 pass |
| merge with the gate rewritten to `if (prompt) {` (`a1-prompt`) | 12 fail. The production census flags (iii c) and (v), and the mint sweep's M1 and M2 rows fail, so the behaviour witness holds. The position-planted tests also fail, because `plantAtEntranceGate` asserts the gate is `if (isFollowUp) {` |
| merge with the authority indented 2 more spaces (`new-indent`) | **89/89 pass**. At old, the same rewrite fails 3 (`old-indent`: the three text-anchored tests). A1's location pin is gone |
| merge with a `...spec.row` spread planted into `fields` (`a3-spread`) | the A3 test fails on S and P (canary present) and on "key set equals literal", and the census flags (ii) |
| merge with `rowFor` widened to spread its input (`a3-rowfor`) | **the census is silent (lin-3134 all green)**; the A3 behaviour test fails on S and P and on the key-set literal. The replacement catches what the narrowed census no longer sees |
| old `ab85eb9e` plus the new A3 test (`old-a3test`) | 6/6 pass: green on unchanged code |

## 5. Security

* **The #4a sweeps and the owner-gate test are unmodified.** All 11 files, diffed old → new: 0 lines.
  * `dispatch-entrance-{mint-limiter-order,mint-sweep,no-token,owner-gate-fail-closed,pins,proxy-grant-sweep,proxy-key-sets,redaction-canary-sweep,session-owner-sweep}.test.js`
  * `tests/unit/lib/entrance-route-sweep.js`
  * `lin-3383-runner-owner-gate.test.js`
* **The sweeps are green on the merge:** 165/165 (`conv/sweeps-new.tap`).
* **A dropped `requireGrant('dispatch')` is caught by both the sweeps and the replay.**
  * R: the sweeps fail 3 (proxy-grant sweep: R answers 403 to a readWrite token; known issue reaches no sink; 403 with a known issue). The replay's `r-grant` is caught on R only.
  * K: the sweeps fail 3 (the same three, on K). The replay's `k-grant` is caught on K only.
* **The owner gate moved after the body checks:**
  * the sweeps fail 2 (the LIN-3604 "gate runs at its one position" suite);
  * the replay's `s-gate-late` is caught on S;
  * the direct class's `gate-late` is caught (70 cases).
* The direct class's fail-closed check holds on new (the `fail-open` mutant is caught).

## 6. Seams and census

* **Seams** (`scripts/code-shape/seams.mjs`; `seams/`): `ab85eb9e` 16 pairs, one group of 9 areas, 60 links. The merge: **identical**. `knots` and `links` are byte-equal JSON. **16 → 16**, matching the PR's figure.
  * The predicted 18 was at `47d87055`. Two pairs dissolved on main before the run: Agent API ↔ Front end (LIN-3606, `isBlocked`) and Other features ↔ Runs & dispatch (LIN-3610, the gate-marker move; it was one of the four pairs the authority crossed).
* **Census** (`dl1/census.mjs`; `census/`): 309 groups / 1,021 sites → **310 / 1,023**.
  * One new group: a vocabulary clone between `SESSION_FAILURES[0]` (`lib/dispatch-entrance.js:539`, the `mapDispatchRefusal` rule) and `relayDispatchRefusal` in `routes/proxy.js:841`.
  * No group gone.
  * The authority's four groups at old stay: localhost set `:243`, `{code, category, retryable}` `:689`, the `computeOne` record `:1490`, and the execution-field set `:261`.
  * Groups touching the 4 entrance files: 12 → 13.

## 7. Unit suite

A git clone checked out at `2e8cba6e` (`clone/`, `node_modules` symlinked). The `test:unit` file set ran with
non-loopback sockets blocked (`../probe/run-suite.sh`): **17,467 tests, 17,467 pass, 0 fail**, 135 s, 0 blocked
sockets (`suite/new.tap`). The 6 `task-page-links` failures of the archive-based probe are gone, as expected in a git
checkout.

## 8. Prediction (`../prediction-4c.md`)

| # | Prediction | Actual | |
|---|---|---|---|
| 1 | one PR, not split (~85%) | one PR | **hit** |
| 2 | merges (~80%) | merged | **hit** |
| 3 | no ruling (~70%); likeliest cause the plan loop over the conversions | 1 ruling, the plan loop over the A3 rule | **miss** (the cause was predicted right) |
| 4 | 2 h – 3 h 15 kickoff to merge | 2 h 20 | **hit** |
| 5 | A1–A4 all converted (~55%) | A1 and A3 only | **miss** |
| 6 | at least two converted (~85%) | 2 | **hit** |
| 7 | A3 likeliest kept as written | A3 converted; A2 and A4 kept | **miss** |
| 8 | A2 (i) ~55% / (ii) ~45% | neither; A2 kept as written | **miss** |
| 9 | A5 converted ~35% | kept (the last commit restored the exact line) | **hit** (leaned no) |
| 10 | A6 only with a helper, ~25% | no helper, no A6 | **hit** |
| 11 | total 4 conversions (range 2–6), each failing-then-passing | 2 (bottom of range); replacement-first commits; witnesses re-run green and failing here | **partial**: in range, below the centre |
| 12 | the #4a sweeps and owner-gate test unmodified (~90%) | 0-line diff, green | **hit** |
| 13 | no conversion weakens its pin (~85%) | A1 stronger (also survives re-indent); A3 narrowed, not exempted, with a behaviour test that catches a widened `rowFor` the census misses | **hit** |
| 14 | authority code lines 720–830 (centre 780); unit 1,900–2,010 | **937**; unit 2,115 (both rose) | **miss** |
| 15 | decision points 200–245 (centre 225); unit 515–560 | 238; 555 | **hit** |
| 16 | worst 12–20 (centre 16), ≤ 20 ~75% | 13 | **hit** |
| 17 | by splitting R's two arms and the per-lane failure mapping | `overrideArm` / `descentArm`; per-lane failure-rule tables | **hit** |
| 18 | comment lines 700 ± 60 | 731 | **hit** |
| 19 | verbatim centre 50%, range 42–60%; < 55% ~60%; > 65% ~10% | 45.7% (the first head was 72.7%, sent back) | **hit** |
| 20 | raw within 2 points of normalised | identical | **hit** |
| 21 | replay 0 on every tier (~70%) | 0 on 2 × 21,089 + 2 × 1,506 | **hit** |
| 22 | direct class 0 and fail-closed holds (~90%) | 0 / 600 × 2, holds | **hit** |
| 23 | coverage ≥ 99% | 99.5% unit, 99.47% file | **hit** |
| 24 | the worker's replay 0 differences (~85%) | 0 reported (one earlier run had 1); 0 in all 20 of my harness runs | **hit** |
| 25 | seams 18 → 18, no new pair (~90%) | 16 → 16 identical (main dropped 2 pairs before the run) | **hit** in substance; the count's premise was stale |
| 26 | a helper lands in Runs & dispatch | no helper | n/a |
| 27 | rulings 0 | 1 | **miss** |
| 28 | open questions: the 8 carried, plus 0–3 new | not checked (PR body not available offline) | unscored |
| Q | "inside the band, simplified further than 5c" (37–55% and worst ≤ 20), ~55% | 45.7%, worst 13 | **hit**. "Leaves the band" (< 37%, ~10%): no, against the merge base. But 25% against the pre-#4b sources |

**Tally:** 20 hits (Q included), 6 misses, 1 partial, 2 unscored or n/a.
* Misses: the ruling (counted twice: #3 and #27); which A pins convert (#5, #7, #8); and the code-line cut (#14).

## Surprises

* **The code-line count rose.** It went 878 → 937, though every complexity measure fell: decision points −11%, worst 29 → 13, longest function 256 → 74, nesting 4 → 3. The rebuild bought small units with lines; functions rose 106 → 163.
* **The A conversions the design actually needed** were A1 (indentation) and A3 (`fields: rowFor(...)`), not the A2 and A4 pins the prediction expected. The gate kept `if (isFollowUp) {` and both declaration literals stayed.
* **The A3 conversion narrowed the census instead of exempting E.** That is stricter than the ticket asked, and the witnesses show the behaviour test covers what the census gave up.
* **The worker's one keepalive/hang-up difference did not reproduce**: 0 in 20 harness comparisons (old vs new, old vs old and new vs new), sequential or under suite load.
* **The replay tool broke on the base before any request**, because LIN-3610 moved `buildPeriodicalGateMarker`. It was fixed with a one-line fallback.
