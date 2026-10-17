# Score: experiment #4b (LIN-3604, PR #1913)

The PR is "dispatch entrance — one authority per entrance decision". It was merged at 13:17:38Z as `47d87055`, with first parent `15191460`. Kickoff was at 11:42Z, so kickoff to merge took **1 h 36 min**. There were no rulings.

All artefacts are under `dl4/b/score/` (`reports/`, `pin/`, `replay-ko/`, `factory-replay/`, `sweepcheck/`, `capture/`, `tree/`). The repo was only read: `git fetch` plus `git archive` exports.

## 1. Independent replay, old `15191460` vs new `47d87055`

New pins were made with `pin-side.mjs`: `score/pin/47d87055` and `score/pin/47d87055-b`. The old pins `pin/15191460` and `-b` were checked byte-equal to a fresh `git archive` for `routes/`, `lib/` and `server.js`.

| Run | Requests | Differing | Exports | Info groups |
|---|---|---|---|---|
| old vs new, seed 1 (`reports/main-seed1.*`, coverage) | 21,077 (gen 16,430, edge 3,158, test 1,489) | **0** | identical | 0 |
| old vs new, seed 7 | 21,077 | **0** | identical | 0 |
| old vs old twin, seeds 1 and 7 | 21,077 ×2 | 0 / 0 | identical | 0 |
| new vs new twin, seeds 1 and 7 | 21,077 ×2 | 0 / 0 | identical | 0 |

* **Requests per entrance** (seed 1): S 4,020, P 3,547, R 3,811, K 3,446. Every entrance differs on 0. There were 0 socket escapes.
* **Run time:** 2 min 3 s per seed with coverage.
* **Entrance-unit line coverage:**
  * old: 99.67% (913/916);
  * **new: 99.47% (941/946)**. The 5 uncovered lines are `lib/dispatch-entrance.js:970-971` and `:1284-1286`:
    * `:970-971` is the missing-`ownerGate` throw. HTTP cannot reach it; the PR's new `dispatch-entrance-owner-gate-fail-closed.test.js` covers it.
    * `:1284-1286` is the override arm's `!generated` 500, the same line the old side cannot reach.
* **Whole-file coverage on the new side:** `routes/dispatch.js` 99.23%, `routes/proxy-dispatch.js` 100%, `routes/proxy-kickoff.js` 100%, `lib/dispatch-entrance.js` 99.43%.

**Classification: there is nothing to classify.** 0 fixes, 0 regressions, 0 fuzz.

### addItem key order: the replay is blind to it, so I checked it separately

`lib/compare.mjs` compares queue writes as the persisted doc. It also compares the raw `addItem` argument as info, but both through `stableStringify`, which sorts keys. **So the shipped replay does not compare addItem key order, or the persisted doc's key order.**

I made an instrumented copy (`replay-ko/`). It adds two order-sensitive info kinds: `info:addItem-argKeyOrder` and `info:persisted-exactBytes`. I re-ran it on both seeds (`reports/keyorder-seed*.json`):

| Seed | addItem calls compared | argKeyOrder | persisted-exactBytes | rawArgs (key set + values) |
|---|---|---|---|---|
| 1 | 4,675 | R ×1,035, K ×773 | **0** | 0 |
| 7 | 4,723 | R ×1,041, K ×745 | **0** | 0 |

* **Where the order changed.** It is only on R and K, where the new single `fields` literal orders keys differently:
  * K: `sessionId` now comes before `waitForFollowUps`;
  * R: `followUpTo` and `force` now come before `sessionId`.
* **The key set and values are identical** on every write (no `rawArgs` info).
* **The persisted row is byte-identical, key order included.** The store builds the doc from named keys plus `normalizeRunFields`' fixed list, and never spreads the item (`lib/dispatch-store.js:373-427`).

This confirms the PR's statement: the order changed, the key set did not, and nothing persisted changed. Unit tests that `deepEqual` the item cannot see order. A test that compared `JSON.stringify(arg)` would see it; none does, since the suite passes (§7).

### Mutants planted on the NEW tree

All are in `replay-ko/selfcheck-new.mjs`, with n=2,000 plus 1,000 per entrance on seed 1. **15/15 pass** (`reports/selfcheck-new.log`):

| Mutant | Where it was caught |
|---|---|
| `n-s-gate`: authority drops the owner-gate call | S only (status ×180, store writes, …) |
| `n-s-mint-label` | S, `store:proxyTokenStore` ×200 |
| `n-p-grant`: P registration drops `requireGrant('dispatch')` | P only (status ×101, `addItem` ×41) |
| **`n-r-grant`** | **R only, `store:dispatchQueueStore` ×35** |
| **`n-k-grant`** | **K only, `store:dispatchQueueStore` ×29** |
| `n-shared-receipt`: proxy layout drops `sessionId` | P ×559 and R ×471 |
| `n-k-keyorder`: id/sessionId swap | K, bodyBytes + etag ×345 only (`body` did not differ) |
| `n-row-queueIfBusy`: ROW_FIELDS | S ×24, P ×16, R ×28 |
| `n-k-order`: KICKOFF_STEPS target before goal | K, body ×3 |
| `n-relay`: kit relay 503 → 502 | P ×76, R ×68, **K ×70** |
| `n-r-capgate` | R only |
| `n-dangling` | S and P |
| `n-k-gate`: kickoff storeMissing dropped | K only |
| `n-eq-dispatchedAt` (equivalent) | 0 |
| `n-factory-revert`: the PR's factory loop removed | **0 differences.** Info only: `info:addItem-rawArgs` (P ×590, R ×510, K ×367; keys present as explicit `undefined`) |

* **The relay now covers K too.** At the base, K had its own attach-failed branch. Now one relay answers P, R and K.
* **What `n-factory-revert` shows.** The factory change is needed only to keep each lane's argument key set. Without it nothing persisted differs.

**The new grant sweep** (`sweepcheck/`) is `dispatch-entrance-proxy-grant-sweep.test.js` at the merge. Run on the base code it passes (14/14). It fails 3 tests on each of these trees: base with R's grant dropped, base with K's grant dropped, merge with R's grant dropped, merge with K's grant dropped. So the "reaches no sink" vacuity for R and K is closed.

## 2. The factory change (`createDispatchItem` drops caller fields left `undefined`)

The five out-of-scope callers and their `fields` literals:

| Caller | Fields | Can a value be `undefined`? |
|---|---|---|
| `routes/workspace-api.js:3000` (triage) | promptName, issue*, dispatchedBy, target, issueSource | yes: `issue.identifier` |
| `routes/workspace-api.js:3062` (autopilot) | same | same |
| `routes/collective.js:352` | promptName, target, dispatchedBy | `target`: yes |
| `lib/chat-tools.js:1942` | followUpTo, target, force, dispatchedBy | `dispatchedBy` (and `force` in principle) |
| `lib/follow-up-dispatch.js:106` | followUpTo, target, force, dispatchedBy | same |

**By construction, no saved-row difference is possible.** Both changes feed the store's `addItem`, which reads every key by value (`||`, `??`, `!= null`, `=== true`, `normalizeRunFields`). It never uses `in`, `Object.keys(item)` or a spread of `item`. So `{k: undefined}` and `{}` persist the same row.

**Witness** (`factory-replay/run.mjs`). Each input goes through both trees' real `createDispatchItem`. A fake store projects each `addItem` argument through the old tree's real `DispatchQueueStore.addItem`, with `_id` and dates fixed. Optional anchors exercise `inheritFromAnchor`.

Inputs:
* **374 captured:** 187 real calls from the 4 caller modules, recorded from 105 unit-test files on a patched copy of the base. Each is run without and with an anchor.
* **5,000 generated:** 1,000 per caller. They draw from value pools that include `undefined`, `null` and `''`, plus random explicit-`undefined` extra keys.

| Pair | Persisted (canonical) | Persisted bytes | Returned item | Errors | Arg key set | Arg key order |
|---|---|---|---|---|---|---|
| old vs old twin | 0 | 0 | 0 | 0 | 0 | 0 |
| new vs new twin | 0 | 0 | 0 | 0 | 0 | 0 |
| **old vs new** | **0** | **0** | **0** | **0** | 2,956 (gen only) | 2,959 (gen only) |
| new vs mutant (also drops `dispatchedBy`) | 2,268 | 2,268 | 2,268 | 0 | 4,434 | 4,434 |

**Result: no saved-row difference** for any of the five callers. The argument's key set changes only for an input carrying an explicit `undefined`. None of the 187 captured unit-test calls from the five callers carries one: the key-set count is 0 on all captured rows. So their unit-test-visible arguments are unchanged too.

## 3. Sites per decision (counting rule from `ticket-4b.md` §56)

**Route files.** I grepped the non-comment lines of the three route files at `47d87055`. None of these appears in them: `createDispatchItem`, `receiptFor`, `relayEnqueueFailure`, `runGateFor`, `buildRunGate`, `isDanglingReferent`, `DEFAULT_SUBSCRIPTION`, `dispatchIssueSourceField`, `attachProxyContext`, `validateDispatchPayload`, `executionFieldError`, `'Dispatch is not available'`, `expandCascade`.

The hits that remain all belong to non-entrance routes:
* `req.body || {}` ×5 in halt, trim, tokens and preset CRUD;
* `req.protocol`: poll, broker-token, and GET kickoff;
* `provisionResumeCredential`: broker-token;
* `repo || null`: the watch formatter.

So **the route files hold 0 entrance sites**, which confirms the PR. Each POST is a block-bodied forwarder.

**Hand count in `lib/dispatch-entrance.js`, for 15 decisions:**

| Decision | After | Where |
|---|---|---|
| D1 | 1 | `refuseWithoutStore`; P/R/K reach it via `kit.storeMissing()` |
| D2 | 1 | `bodyOf`. **Before was 3, not 4:** S at `dispatch.js:487` destructures the raw `req.body` and never had `\|\| {}`. This is the PR's 95. |
| D10 | 1 | `ROW_FIELDS.subscription` |
| D12 | 1 | `ROW_FIELDS.issueSource`, with the `stampsOnAbort` parameter |
| D15 | 1 | `kit.refuseDangling` |
| D16 | 1 | `ROW_FIELDS.repo` |
| D17 | 1 | `proxyContextPolicy`, with the `optIn` parameter |
| D18 | 1 | `kit.runGateFor` / `gateFor` |
| D20 | 1 | `createKit` `baseUrl` |
| D21 | 1 | `kit.enqueue` |
| D22 | 3 | gate, attach and plain return, inside the one `finalizePrompt` |
| D25 | 1 | `receiptFor`, 3 layouts |
| D26 | 1 | `kit.failure`, with lane tails |
| D6 | 1 | `executionFieldError`, in `lib/dispatch-validation.js` (not the authority file, but one rule) |
| D7 | 1, or 2 on a strict reading | R/K's format rule is `issueIdentifierError`; `validateSessionId` is shared. S/P keep only the payload validator's length cap: the documented V5 difference. |

* **My total is 26**, counting D22 as 3 and D7 as 1. That matches the PR's 26.
* **The before total is 95** (the ticket's 96 overcounted D2 by one). That also matches the PR.
* Counting D22 as one, the result is 24, which is the prediction.

## 4. Seams (`scripts/code-shape/seams.mjs`)

| | `15191460` | `47d87055` |
|---|---|---|
| Pairs | 18 | 18 |
| Groups | one, of 9 areas | one, of 9 areas |
| Links | 62 | 62 |

There is **no new pair, no lost pair and no new link**, which confirms the PR's 18 → 18.

Edge weights that changed:

| Edge | Before | After |
|---|---|---|
| Agent API → Runs & dispatch | 46 | **34** |
| Agent API → LLM | 35 | 31 |
| Agent API → Auth | 15 | 13 |
| Agent API → Platform | 27 | 26 |
| Agent API → Providers | 18 | 17 |
| Agent API → Other | 3 | 2 |
| Runs & dispatch → Agent API | 7 | 9 |
| Runs & dispatch → LLM | 16 | 20 |
| Runs & dispatch → Platform | 44 | 46 |
| Runs & dispatch → Providers | 7 | 8 |

## 5. Census (`dl1/census.mjs`)

| | `15191460` | `47d87055` |
|---|---|---|
| Groups / sites | 309 / 1,022 | **309 / 1,021** |
| Run time | 6.1 s | 5.7 s |

**Groups touching the 4 entrance files:** 12 at both commits. Of those, 0 touch `lib/dispatch-entrance.js` at the base and 4 at the merge.

| Group | Change |
|---|---|
| **G0042** (the receipt record: `dispatch.js:933`, `proxy-dispatch.js:163`, `proxy-kickoff.js:441`) | **dissolved**; it is the only group gone |
| G0003 (`localhost`/`127.0.0.1`) | moved into the authority (`:229`) |
| G0012 (`{code, category, retryable}`) | moved into the authority (`:924`), kept with `dispatch.js:919` |
| G0118 (Rl `computeOne` record) | moved into the authority (`:1375`) |
| G0000, G0007, G0033, G0036, G0037, G0043, G0115, G0123 | stay in the route files, at shifted lines |
| **New: string set {effort, harness, model, terminal}** | joins `dispatch-entrance.js:247` (STEPS.execution's `['model','harness','effort']`) to `OPAQUE_FIELDS` (`dispatch-validation.js:188`). It is a near-set echo: the field list is restated as a subset. |

## 6. Shape (`experiments/rebuild-exp1/kit/shape.mjs`)

| File | Lines (code), before → after | Decision points | Worst function (cyclomatic), before → after |
|---|---|---|---|
| `routes/dispatch.js` | 1,963 (1,051) → 1,436 (782) | 331 → 210 | S handler λ@483 **63** → broker-token λ@1181 28 |
| `routes/proxy-dispatch.js` | 1,773 (846) → 750 (326) | 250 → 100 | R handler λ@766 **52** → `formatDispatchWatch` 24 |
| `routes/proxy-kickoff.js` | 569 (250) → 149 (70) | 65 → 7 | K handler λ@206 **41** → `createKickoffRoutes` 5 |
| `lib/dispatch-entrance.js` | 45 (11) → 1,677 (878) | 3 → 268 | `firstFailure` 3 → `enterRecommendDispatch` **29** (171 code lines); `kit.failure` 28; `enterSessionDispatch` 19 |
| `lib/dispatch-validation.js` | 302 (146) → 317 (153) | 57 → 60 | `validateDispatchPayload` 20 → 17 |
| `lib/dispatch-factory.js` | 1,047 (490) → 1,053 (493) | 169 → 171 | `createDispatchItem` 49 → 51 |

**Worst function across the four entrance files: S's handler at 63 → `enterRecommendDispatch` at 29.**
* Units over 10: 14 → 15.
* Max nesting: 5 → 4.
* Longest unit: R's handler (326 code lines) → `createKit` (256 code lines, cyclomatic 6).

**Production totals** (the 6 files, which are the only production files changed):

| Measure | Before | After | Change |
|---|---|---|---|
| Lines | 5,699 | 5,382 | **−317** (git numstat: +1,796 −2,113) |
| Code lines | 2,794 | 2,702 | **−92** |
| Decision points | 875 | 816 | −59 |

* **Route files:** −1,970 lines (−1,019 code lines).
* **Tests:** +157 (2 files, additions only). `lin-3134-declared-mint-census.test.js` (POST_DISPATCH_GATE) and every other census file are untouched.
* **Other:** +1,012, from `experiments/lin-3604-entrance-replay/` and docs.

**Verbatim share of the new authority against the old handlers:**
* 67.0% of tokens are covered by an 8-token shingle from the old route files plus `dispatch-validation`;
* 41.8% of code lines and 16.3% of comment lines are exact matches (comments were re-wrapped).

## 7. Unit suite on `47d87055`

**Result: 17,436 / 17,436 pass, 0 fail** in a git checkout of the merge. The base gives 17,426 / 17,426, so the PR adds 10 tests. node_modules is symlinked from the repo, and the run is `npm run test:hermetic`, which is what CI runs.

| Run | Result | Log |
|---|---|---|
| merge, plain `git archive` export | 17,430 pass, 6 fail | `reports/unit-new.log` |
| `task-page-links.test.js` only, in a `git init` copy, merge and base | 6/6 pass on each | `reports/task-page-links-*.log` |
| full suite, `git init` copy of the merge | 17,436 / 17,436 | `reports/unit-new-git.log` |
| full suite, `git init` copy of the base | 17,426 / 17,426 | `reports/unit-old-git.log` |

* **The 6 failures in the plain export are environmental.** All 6 are `task-page-links.test.js` (LIN-3331), which shells out to `git grep` and fails with "not a git repository".
* **The hermetic socket gate is red at both commits, for the same pre-existing reason.** Each run opens 3 `openrouter.ai:443` sockets, from `feedback-route.test.js`, `lin-2354-session-lane-no-provider.test.js` and `lin-2804-provider-ui-endpoint-hints.test.js`. This session's environment has OpenRouter variables set, which likely explains it. It is identical on the base, so the PR did not introduce it.

## 8. Prediction lines (`prediction-4b.md`)

| § | Prediction | Actual | Score |
|---|---|---|---|
| 1 | 24 shared decisions → 1 authority each; total 96 → 24 (D22 as one) | 26 counting D22 as 3, so 24 counting it as one; route files 0 | **hit** |
| 1 | before = 96 | 95 (D2: S never had `\|\| {}`) | miss (by 1) |
| 1 | D22 → 1 gate + 1 attach + 1 plain, inside one call | exactly that | hit |
| 1 | D25 one builder, 3 named layouts (medium confidence) | `receiptFor(layout)` | hit |
| 1 | D26 one relay with per-verb order params (medium confidence) | `kit.failure` with lane tails; K now on the shared relay | hit |
| 1 | D6 one check group + the one warning | `executionFieldError` | hit |
| 1 | lane decisions D9/D24/D27/D28 unchanged | owner gate passed in as `ctx.ownerGate`; `requireGrant` at the registrations; `afterEnqueue`; `logEvent`; keepalive | hit |
| 2 | seams 18 → 18, group 9, no new pair, no new link | 18 → 18, 9, 0 new, 62 → 62 | **hit** |
| 2 | edge detail (Agent API → Runs 46 → 38, → LLM 35 → 33, → Providers 18 → 17, → Other 3 → 2; Runs → Agent API +2, Auth +1, LLM +2, Platform +2, Providers +2) | 46 → 34, 35 → 31, 18 → 17, 3 → 2; +2, **0**, **+4**, +2, **+1**; also Agent API → Auth −2 and → Platform −1, not predicted | partial (5 of 9) |
| 3 | G0042 3 → 1 site / dissolves with one builder | dissolved | hit |
| 3 | census 308–309 / 1,019–1,022 | 309 / 1,021 | hit |
| 3 | G0003, G0012, G0118 stay | stay (moved into the authority) | hit |
| 3 | 0–1 new groups inside the authority | 1 (the OPAQUE_FIELDS subset echo) | hit |
| 4 | route files −1,600 to −1,950 | −1,970 | **miss** (by 20) |
| 4 | `lib/dispatch-entrance.js` +1,250 to +1,650 | +1,632 | hit |
| 4 | production net −150 to −450 (central −300) | −317 | hit |
| 4 | 1 required test addition (grant sweep with positive controls, own commit first, green on unchanged code, dropped-grant runs failing) | first commit, tests only, +49; green on the base; fails 3 on dropped R and K grants (my rerun) | hit |
| 4 | `POST_DISPATCH_GATE` conversion 0–1 (about 40% for 1) | 0, kept | hit |
| 4 | tests +0 to +200 if unit tests added | +157 (adds `dispatch-entrance-owner-gate-fail-closed.test.js`, 108 lines) | hit |
| 4 | LIN-3601 sweeps: additions only in the proxy-grant sweep; others 0 | yes | hit |
| 5 | 7 comment fixes, 0 behaviour fixes | 0 behaviour (replay 0); A1, A3–A7 stale texts gone, A2 named in the commit | hit |
| 5 | (d) 7 under Open questions | PR body: 8 open questions | miss (by 1) |
| 5 | (b) about 21, (c) 9 | PR body not available offline | not scored |
| 5 | 0 rulings | 0 | hit |
| 5 | replay 0 differences, new coverage ≥95% | 0/0, 99.47% | hit |
| 5 | `info:addItem-rawArgs` > 0 likely | 0: the factory change removed it, and only key order differs, which the replay does not see | **miss** |
| 5 | verbatim share ≥75% | 67% of tokens by 8-gram (41.8% exact code lines) | miss |
| 6 | kickoff to merge 1.5–3 h | 1 h 36 min | hit |
| 6 | replay about 2 min 10 s per seed, seams about 1 s, census about 6 s | 2 min 3 s, 1.5 s, 5.7–6.1 s | hit |
| 7 | self-check identity 0 on both seeds | reproduced: old/old and new/new 0 on both seeds | hit |

**Tally:** 23 hits, 5 misses (before-count 96, route −1,970, open questions 8, rawArgs info, verbatim share), 1 partial (edge weights), 1 not scored.

## Surprises

* **The shipped replay is blind to `addItem` key order.** The arg and the persisted doc are compared through sorted-key `stableStringify`. The order-aware rerun shows R ×1,035–1,041 and K ×745–773 order changes per seed, with the key set and the persisted bytes identical.
* **The factory change is what suppresses `info:addItem-rawArgs`.** Without it, the new `fields` literal would pass explicit `undefined` for every key a lane does not carry. That is still 0 persisted differences, but it shows as rawArgs info on P, R and K.
* **The ticket's D2 before-count was wrong:** S never had `req.body || {}`. The authority keeps S on the raw body deliberately, so a missing body still 500s on S.
* **K joined the shared relay.** The planted 503 → 502 relay mutant now hits P, R and K.
* **The worst function halved, but the authority is now the most complex file** of the four: 268 decision points, 7 units over 10, `createKit` 256 code lines. Code lines fell only 92 net, against −317 total lines.
