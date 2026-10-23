# Test Coverage Gap Review — 2026-10-23 (delta vs 2026-06-25 baseline)

*Advisory, review-only. Periodical: **Test Coverage Gap Review**; review task: LIN-3797. Previous
run: `docs/reviews/test-coverage-gap-2026-06-25.md` (LIN-672, audited at `8de7da5`). This report
changes no product code; it grades the suite's coverage **and** reliability and hands the highest-severity
items forward as at most three bounded follow-ups.*

**Grounding.** Research ran at `origin/main` = `f81f472b`; the report was written at `0b5afa6f`
(LIN-3775, one commit later). That commit touched none of the modules or specs cited below
(`git diff --name-only f81f472b 0b5afa6f` has no overlap with them), and every `file:line` citation was
re-read at `0b5afa6f` before it went in. The window since the baseline is about 2,780 commits.

## Method and evidence bar

**Coverage command.** Derived from `package.json` `test:unit` and `scripts/run-unit-tests.mjs`
(which only forwards file paths; the local concurrency cap is applied by hand):

```
node --experimental-test-coverage --test --test-concurrency=5 \
  tests/unit/*.test.js scripts/eval/eval-dense.test.mjs scripts/code-shape/*.test.mjs
```

This **includes** the `scripts/` tests (the baseline's bare `tests/unit/*.test.js` did not), so the
table gains 51 `scripts/` rows. Test files themselves are not in the table.

| | Baseline `8de7da5` | Research run `f81f472b` |
|---|---|---|
| Unit tests | 2,430 pass | **19,228 pass, 0 fail** |
| Line / branch / funcs | 82.80 / 79.18 / 84.30 | **95.97 / 87.58 / 92.35** |
| Re-run at report HEAD `0b5afa6f` | | 19,272 pass, 0 fail; 95.97 / 87.60 / 92.35 (44 more tests from LIN-3775) |

CI runs 19,296 tests on the same sha. The 68 missing locally are the three real-Mongo suites, which
skip without `MONGODB_TEST_URI` (finding R3). Any Mongo-specific path (duplicate `_id`, concurrent
writers, CAS races) is therefore under-counted by a local run and was graded on its CI behaviour.

**The percentage does not track the outcome here.** Line coverage rose 13 points, but two of the
baseline's three promoted invariants are still unasserted. The evidence bar for every coverage verdict
below is a **mutation spike**: apply the named defect to the module, run every unit file that imports
it, and record whether any test fails (KILLED) or none does (SURVIVED). A coverage finding must name a
defect the suite would or would not catch; a raw percentage never qualifies.

| # | Mutant | Result |
|---|---|---|
| M1 | free-tier `tryUse` re-introduces the `global:global:` double-prefix key | KILLED |
| M2 | free-tier hourly over-cap rollback removed | KILLED |
| M13 | run limit `runsUsed >= limit` → `>` (off-by-one on the money gate) | KILLED |
| M3 | `DispatchTokenStore.revokeToken` drops `urlKey` from the delete filter | **SURVIVED** (18 files, 591 tests) |
| M4 | `validateToken` falls back to any row | KILLED |
| M5 | `listTokens` adds `tokenHash` to each row | **SURVIVED** |
| M6–M9 | `agent-status-store` `listSessions` / `listTaskThreads` label refresh, sort, grouping key, `__unattributed__` filter | all SURVIVED (dead code, see C6) |
| M10/M11 | session store ignores expiry / `isSessionRowLive` always true | KILLED |
| M12 | periodical Done gate skips the adversarial-read check | KILLED |
| M14 | proxy-token idle prune deletes recently-used old tokens | **SURVIVED** (1,488 tests) |
| M15 | exchange drops the `doc.consumed` pre-check | survived, equivalent (the atomic `{consumed:false}` filter still guards) |
| M16 | exchange drops both single-use guards (bootstrap replayable) | KILLED |

**Traps.** Trap 1 (a zero-coverage module is absent from the table): every `lib/**` and `routes/**`
file was diffed against the parsed table; the absent set is `lib/harbour-feedback-tokens.js`,
`lib/custom-prompts-store.js`, `lib/render-audit.js`, `lib/render-custom-prompts.js`,
`lib/render-prompts.js`, `lib/render-templates.js`, `lib/sample-data/ship-dense-sample-data.js`,
`routes/legacy-redirects.js`, `routes/passage-planner.js`, `routes/ship-journey.js`, `routes/test.js`.
Only the first is on a high-cost path. Trap 2 (route/render modules covered by Playwright) and Trap 3
(full line coverage hiding an unasserted branch) were applied per finding.

**Reliability data.** CI history is **reachable** (public repo, `gh` authenticated). 200 `test.yml`
runs from 2026-10-19 to 10-23 gave 192 success and 8 failure, with one `run_attempt > 1`. 480 e2e shard
logs were read from 120 green runs (60 recent, plus 12 from each of five earlier windows back to
2026-09-20). The only per-test signal the logs carry is the `list` reporter's `N flaky` block, the `✘`
first attempt and the first-attempt error; `test-results/` is uploaded only `if: failure()`
(`.github/workflows/test.yml:116-118`), so nothing finer exists. 20 of the 60 recent green runs (33%),
and 43 of all 120 sampled (36%), carried at least one retry-rescued test, against 80% in the LIN-3168
census.

**Hermetic arms.** No vacuous-pass path found: `guardSockets` observes the connect and passes it
through (`tests/fixtures/network-guard.js:163-167`), and the proxy arm counts a connect to a dead
loopback port as an escape, so a test cannot go green because the guard short-circuited it.

## Findings, severity-ranked

### High

**C1 — `dispatch-token-store-untested-auth-boundary` — improved, not resolved.**
`tests/unit/dispatch-tokens.test.js` now exists but covers `createdBy` and `touch`
(LIN-1397/LIN-3647). Neither invariant the baseline named is asserted:
- Cross-workspace revoke: the only guard is `urlKey` in `deleteOne({ _id: tokenId, urlKey })`
  (`lib/dispatch-tokens.js:240-243`), behind `DELETE /workspace/:urlKey/api/dispatch/tokens/:tokenId`
  (`routes/dispatch.js:992`). The route's owner gate checks the *caller's* workspace, not the token's.
  M3 survives.
- `listTokens` must never return `tokenHash` (`lib/dispatch-tokens.js:205-220`); the result goes
  straight to `res.json({ tokens })` (`routes/dispatch.js:969-970`). M5 survives.

Existing ticket **LIN-690** (minted by the baseline for exactly this) is still Backlog. Not re-minted;
M3 and M5 should be its acceptance tests.

**R1 — `e2e-retry-hidden-dispatch-api-stray-queue-item` — new.**
The `Dispatch API` describe in `tests/e2e/dispatch.spec.js` (beforeEach at `:575-579`) fails its first
attempt and passes on retry (`playwright.config.js:18`, `retries: process.env.CI ? 2 : 0`). It appears
in every sampled window from 2026-09-20 to 10-23 and in 11 of the 20 recent flaky runs. First-attempt
errors seen: `items.length` expected 1 got 2 (`:621`), expected 0 got 1 after DELETE (`:641`),
`items[0].target` expected `web` got `cli` (`:664`). Each is exactly what a real double-enqueue, a
DELETE no-op or a dropped `target` would look like, and the retry turns all of them green, so CI cannot
tell a stray row from a product regression on the dispatch queue. 700 isolated runs
(`--repeat-each=25 --workers=2 --retries=0`, this describe only) produced no stray item, so the row
arrives from an earlier spec in the same worker partition after the `/test/clear-dispatch-queue`
call. No existing ticket (searched "dispatch.spec", "Dispatch API flake", "stray", "retry-hidden";
LIN-798/3168/3198 are the Done sweep and census, not this test). **Follow-up F1.**

### Medium-High

**C3 — `harbour-feedback-tokens-zero-coverage` — new name (Trap 1).**
`lib/harbour-feedback-tokens.js` is absent from the coverage table. Route tests that reach
`authenticateFeedbackToken` use a fake store (`tests/unit/dispatch-entrance-session-owner-sweep.test.js:85`),
so `routes/dispatch.js:330-336` reads as covered while the real single-use / item-bound / expiry claim
(`lib/harbour-feedback-tokens.js:90-101`: `used:false`, `expiresAt > now`, optional `itemId`, atomic
`findOneAndUpdate`) has never executed. `validateAndConsume` runs first on every production feedback POST
(`routes/dispatch.js:330-332`); tokens are minted only on the `target=local` spawn path (`:394-395`),
which bounds the exposure. This is the reliability face of the fake-store seam in
`docs/reviews/code-quality-review-2026-10-12-tests.md` (T-mockcoll); cited, not re-flagged as
maintainability. Existing ticket **LIN-2061** names exactly this gap; cited, not re-minted.

### Medium

**R2 — `e2e-retry-hidden-collective-fanout-seat-failure` — new.**
`tests/e2e/collective.spec.js:211` and `:290` (`dispatched.every(d => d.ok)`) fail first and pass on
retry: 5 of 60 recent green runs plus 3 in 10-11…14, none before 10-11. Onset follows the LIN-3383/3408
owner-only enqueue gate, which added the `ok:false` owner-refusal seat (`routes/collective.js:297`)
next to the catch-all `ok:false 'dispatch failed'` (`:459`). A partial fan-out (one seat silently not
launched) is a user-visible defect this test exists to catch, but the assertion discards the seat's
`error`/`code`, so the CI log cannot say which branch fired. 440 local runs of the whole spec showed no
fan-out failure (two *other* Yap tests, `:407` and `:429`, each failed once locally). Possibly the
same state leak as R1; this run could not prove or exclude that. No existing ticket (searched
"collective fan-out"). **Follow-up F1** (same ticket as R1).

**C5 — `proxy-fetch-egress-untested` — unchanged (43.2% vs 37.6%); severity raised from Low.**
Only the pure helpers `isRetryableError` and `isGraphQLMutation` are tested; `createProxyFetch`
(`lib/proxy-fetch.js:103-198`) is uncovered, and so is its twin (`lib/openrouter.js:458-497`). Severity
rises because the open defect **LIN-1879** (both transports drop the URL's scheme and port; see
`hostname: urlObj.hostname` / `path:` at `lib/proxy-fetch.js:113-118`) sits in precisely the uncovered
lines. A known defect inside a gap is a cost the baseline did not have. Cited, not re-minted.

### Medium-Low

**R3 — `real-mongo-suites-skip-silently` — new.**
The real-Mongo suites use `describe(…, { skip: uri ? false : '…' })`
(`tests/unit/mongo-smoke.test.js:59-61`). A skipped *suite* is not counted in Node's `skipped`, so a run
without the URI reports `skipped 0` with 68 tests missing. CI sets the URI today
(`.github/workflows/test.yml:60,72`) and the suite does run there. But nothing asserts that it ran: if
the env line or the Mongo service were dropped, the Mongo-only proofs (duplicate `_id`, concurrent
writers, identity races) would vanish while CI stayed green. No existing ticket (LIN-1340/1348 concern
probe content, LIN-3541 replaces fakes). **Follow-up F2.**

### Low

**C7 — `proxy-tokens-residual-branches` — unchanged (the gap moved).**
The baseline's lines (179-180, 213-240, 261-263) are now covered and bootstrap single-use is asserted
(M16 killed). What remains is the idle-prune loop (`lib/proxy-tokens.js:1030-1037`, default 60 days
at `:66`): the delete at `:1036` never executes in the suite and M14 (dropping the keep-if-recently-used
check at `:1035`) survives. A regression that deleted actively used tokens older than 60 days, such as
90-day operator mints, would pass. Recorded, not promoted.

**C6 — `agent-status-grouping-untested-data-integrity` — resolved by reclassification (misfiled at baseline).**
`listSessions` / `listTaskThreads` have no production caller (only `lib/agent-status-store.js` and its
test); their consumer was removed by LIN-451 (`a0ad7310`, 2026-06-16), nine days before the baseline.
M6–M9 survive but nothing shipped depends on them. Recommend cancelling **LIN-691** (still Backlog) and
deleting the two methods in a code task. Both are human calls: this review closes nothing and deletes
nothing.

**R4 — `e2e-conditional-skip-never-asserts` — new.**
`tests/e2e/interactions.spec.js:489` ("Comments toggle does NOT appear on landing page") was skipped in
120 of 120 sampled green runs through its data-conditional `test.skip()` at `:497`: the landing page
renders no `.line.expandable`, so the assertion has not run in the window. The other skip sites are
benign: `interactions.spec.js:254` never fired; `library.spec.js:136,145` are WebKit-only and inert in
chromium CI. Delete the test or rewrite it against the current landing page.

**C8 — `custom-prompts-store-zero-coverage` — unchanged.** Still absent from the table and still no
unit import; exercised by `tests/e2e/custom-prompts.spec.js` (Trap 2). No auth or money exposure.

**C9 — `openrouter-auth-callback-error-branches` — new, minor.** `routes/openrouter-auth.js` is 86 / 77
with the OAuth-callback error branches (`128-149`, `166-181`) uncovered. Recorded only.

**C10 — `harbour-spawn-tty-path` — new, minor.** `lib/harbour-spawn.js` is 83.8 / 33.3 / 80; the spawn
path needs `/dev/tty`. Low priority.

### Resolved or improved since the baseline

| Stable name | Trend | Evidence |
|---|---|---|
| `free-tier-global-hourly-cap-unenforced` (was Critical) | **resolved** | Key built once at `lib/free-tier-store.js:97-99`; M1, M2 killed. The boundary has moved from prompts/day to runs per account per day (`checkRun`, `:312-325`, LIN-2955) and M13 (off-by-one) is killed. Concurrency is proven on MangoDB only. LIN-689 Done. |
| `proxy-events-zero-coverage` | **resolved** | 96.3% on real MangoDB (`tests/unit/proxy-events-store.test.js`) |
| `linear-fetch-retry-exhaustion` | **resolved** | Exhaustion asserted (`tests/unit/linear-fetch.test.js:80`); only the default `sleep`, a DNS-diagnostic failure and the `AbortSignal.any` fallback remain |
| `llm-call-log-query-funcs` | improved | 94.8% (uncovered: 136-138, 230-232, 287-289, 339-347) |
| `token-refresh-failure-branch` | improved | 96.7%; only the AbortError retry (`lib/token-refresh.js:174-180`) is left |
| Trap-2 routes (`routes/proxy.js`, `auth.js`, `workspace-api.js`) | improved | 41 / 25 / 32 → 98.9 / 88.0 / 88.1 |

**Checked and not gaps** (the minting pass suspected them): `routes/proxy-token-exchange.js`
(94.1 / 85.7, own test files, replay mutant M16 killed), `lib/ownerless-token-policy.js` (100%),
`routes/proxy-writes.js` (99.06 / 87.1). `lib/periodical-report-gate.js`, `lib/runner-owner-gate.js`,
`lib/require-grant.js`, `lib/proxy-scopes.js` and `lib/plan-allowance.js` are all at 100% with the
relevant mutants killed. Unit flake tickets LIN-1663, LIN-1987 and LIN-2413 did not reproduce (0 fail in
19,228) and the unit suite has no retry layer, so a flake there would show as red; they remain open
Backlog. The open e2e flake LIN-2547 (`observation.spec.js:401` in the sampled logs) appeared only in the
09-20…24 window.

## Retry-rescued e2e tests in the window (all that the logs expose)

`dispatch.spec.js` "Dispatch API" `:604`, `:625`, `:644` (`:599`/`:600`/`:620`/`:621` at older shas);
`collective.spec.js:173`, `:193`, `:273`; `runner-kit-loop.spec.js:119` (ECONNRESET, once);
`observation.spec.js:401` (09-20…24 only); `session-decision-layout.spec.js:251`,
`session-page.spec.js:662`, `local-provider.spec.js:217,293`, `ship.spec.js:301` (once each). Local only:
`collective.spec.js:407,429`. Only the first two groups are graded (R1, R2): they recur across windows
and name a concrete defect a pass-on-retry would hide. The singletons are recorded, not graded.

## Sibling repo `JKershaw/simple-dispatcher` (read-only, `e2b4dcc`)

Not graded; recorded as a gap for its own run. `npm test`'s own `--require`s under
`--experimental-test-coverage` gave 3,471 tests at 96.86 / 90.81 / 89.14. Two tests failed *under
instrumentation only*: a 3.0 s-timeout subprocess git-probe test (LIN-2509) and the LIN-1420 W4 fetch
call-list test. The last 30 CI runs are green; CI runs only `npm test`, not `test:system` or
`test:mutation` (LIN-3160).

## Not done / what could make this set wrong

- `lib/dispatch-store.js` (96.8 / 91.3, scattered error branches) and the e2e-only (Trap 2) surfaces
  were not mutation-tested.
- **Unbounded class:** high-cost modules that are unit-covered only through an inline fake, like C3.
  Only C3 was found, by tracing. A full census needs a sweep for fakes standing in for real
  `lib/*-store.js` classes; LIN-3541 (replace hand-written DB fakes) is the nearest existing work.
- `lib/account-erasure.js` (irreversible data-integrity tool, new in the window) has large real-engine
  tests but was not mutation-spiked (surfaced by the second-read).
- Whether R1 and R2 share one cause (cross-spec partition state) is unproven.

## Follow-ups minted (cap ~3; two minted)

| ID | Covers | Scope (behavioral) |
|---|---|---|
| F1 = LIN-3798 | R1 + R2 | Make the retry-rescued Dispatch API and collective fan-out failures diagnosable, then fix at the cause: print `dispatched` (seat `error`/`code`) in the `every(d => d.ok)` assertions; identify which earlier spec leaves a queue item in the worker partition; the fix must leave the existing assertions on item count, DELETE and `target` intact and green with `--retries=0`. |
| F2 = LIN-3799 | R3 | Make the CI real-Mongo suite's execution assertable: fail the CI unit job if `MONGODB_TEST_URI` is set and the real-Mongo suites did not run (or if CI runs without the URI). Must demonstrably fail when the env line is removed. |

Cited rather than minted: **LIN-690** (C1: add M3 and M5 as acceptance tests), **LIN-2061** (C3),
**LIN-1879** (C5). Decision for a human: cancel **LIN-691** (C6) and delete the dead methods.

## Trend Ledger (stable names — the next run diffs against this)

| Stable name | Module | Severity | State vs baseline |
|---|---|---|---|
| `dispatch-token-store-untested-auth-boundary` | `lib/dispatch-tokens.js` | High | improved, not resolved (LIN-690) |
| `e2e-retry-hidden-dispatch-api-stray-queue-item` | `tests/e2e/dispatch.spec.js` | High | new (F1) |
| `harbour-feedback-tokens-zero-coverage` | `lib/harbour-feedback-tokens.js` | Medium-High | new (LIN-2061) |
| `e2e-retry-hidden-collective-fanout-seat-failure` | `tests/e2e/collective.spec.js` | Medium | new (F1) |
| `proxy-fetch-egress-untested` | `lib/proxy-fetch.js` | Medium | unchanged, severity raised (LIN-1879) |
| `real-mongo-suites-skip-silently` | `tests/unit/mongo-smoke.test.js` | Medium-Low | new (F2) |
| `proxy-tokens-residual-branches` | `lib/proxy-tokens.js` | Low | unchanged, gap moved |
| `agent-status-grouping-untested-data-integrity` | `lib/agent-status-store.js` | Low | resolved (misfiled; dead code) |
| `e2e-conditional-skip-never-asserts` | `tests/e2e/interactions.spec.js` | Low | new |
| `custom-prompts-store-zero-coverage` | `lib/custom-prompts-store.js` | Low | unchanged |
| `openrouter-auth-callback-error-branches` | `routes/openrouter-auth.js` | Low | new |
| `harbour-spawn-tty-path` | `lib/harbour-spawn.js` | Low | new |
| `free-tier-global-hourly-cap-unenforced` | `lib/free-tier-store.js` | (was Critical) | resolved |
| `proxy-events-zero-coverage` | `lib/proxy-events.js` | (was Medium) | resolved |
| `linear-fetch-retry-exhaustion` | `lib/linear-fetch.js` | (was Low) | resolved |
| `llm-call-log-query-funcs` | `lib/llm-call-log.js` | Low | improved |
| `token-refresh-failure-branch` | `lib/token-refresh.js` | Low | improved |

## Adversarial Second-Read

**Tier 2** (fresh-context sub-agent, no memory of the report-writing turn). **Question:** "What is the
largest item in this window that this report missed or misfiled?"

**Reader's answer (condensed from its full reply):** No large miss. The one gap is in the audit's scope:
`lib/account-erasure.js` (1,051 lines, new in the window, LIN-3423/3486) is an irreversible operator
wipe that rewrites account ids to `'erased'` in shared workspaces, so it is a high-cost data-integrity
module, and the first draft never named it. It does not look under-tested
(`tests/unit/account-erasure.test.js`, 1,071 lines on real MangoDB, and `erase-account-script.test.js`,
228 lines, assert `ERASED_ACCOUNT_ID` on archived rows), but it was not mutation-spiked. The reader
agreed C1 is the right top finding (a carry-over from the baseline, with R1 the closest rival), and
found one wrong citation (`test.yml:114-118`, corrected to `116-118`). All other citations it checked
held.

**Disposition (fixed in place):** the miss is a scope omission, not a proven gap. It is recorded here
as an un-spiked, apparently well-tested high-cost module and added to "Not done"; nothing is promoted
or minted for it. The citation is corrected.

Adversarial second-read verdict: AGREE
Differed from top finding: NO
Disposition: fixed in place
