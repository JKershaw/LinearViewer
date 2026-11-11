# Test Coverage Gap Review — 2026-11-11 (delta vs 2026-10-23)

*Advisory, review-only. Periodical: **Test Coverage Gap Review**; review task: LIN-4418. Previous run:
`docs/reviews/test-coverage-gap-2026-10-23.md` (LIN-3797; research at `f81f472b`, written at
`0b5afa6f`). Baseline: `docs/reviews/test-coverage-gap-2026-06-25.md`. This report changes no code,
config or tests and files no follow-up tickets. It grades whether the suite's green can be trusted,
by coverage and by CI reliability, and writes its leftovers into the area notes.*

**Grounding.** Everything below was measured at `b5950f704` (`origin/main` when this run started),
which is 480 commits after `0b5afa6f`. Research for this task ran at `da5df707d`. The four commits
between them touch none of the mutated modules or the tests that kill or miss them: `git diff
--name-only da5df707d b5950f704 -- tests/` lists only kickoff and periodical tests (LIN-4415). Every
`file:line` below was read at `b5950f704`. Evidence is in `docs/reviews/_evidence-2026-11-11-coverage/`.

## Method and evidence bar

**Coverage command** (from `package.json` `test:unit` and `scripts/run-unit-tests.mjs`; the wrapper
only forwards the file list, blanks the two OpenRouter keys and caps local concurrency, so those are
done by hand here; real Mongo on, as CI has it at `.github/workflows/test.yml:69,88`):

```
OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= MONGODB_TEST_URI=mongodb://localhost:27017 \
node --experimental-test-coverage --test --test-concurrency=5 \
  tests/unit/*.test.js scripts/eval/eval-dense.test.mjs scripts/code-shape/*.test.mjs
```

| | `0b5afa6f` (last report) | `b5950f704` (this run) |
|---|---|---|
| Unit tests | 19,272 local (CI 19,296) | **24,923; 24,922 pass, 1 fail** (real-Mongo suites included) |
| Line / branch / funcs | 95.97 / 87.60 / 92.35 | **95.00 / 88.70 / 91.08** |

The one failure is environmental, not a product signal (L9): `scripts/code-shape/wrappers.test.mjs:258`.
This run used Node v25.9.0 locally. CI pins Node 24 (`.nvmrc`, `package.json` engines), and the
native coverage numbers may differ slightly between the two.
Line coverage fell a point while the suite grew by 5,600 tests, and as last time the percentage
says little. The verdicts below rest on mutation spikes.

**Mutation spikes.** Each mutant was applied in a throwaway worktree at `b5950f704`. The tests run
were the union of the unit files that transitively import the module and the files that name it
or its store or route keywords. That set is wider than research's: 37 files for
`lib/dispatch-tokens.js`, 58 for `lib/harbour-feedback-tokens.js`, 53 for
`lib/model-routing-store.js` and 7 for `lib/account-erasure.js`. A run is KILLED if any test fails.
The tree was reverted and checked clean after each run. A no-op control passed 1,038 of 1,038 first.
**Then all nine survivors were applied together and the whole unit suite was run: 24,923 tests, the
same single environmental failure.** No unit test anywhere catches any of them. Diffs, file lists and
counts are in `mutants/` in the evidence folder.

| # | Mutant (at `b5950f704`) | Files / tests | Result |
|---|---|---|---|
| CTRL | no-op comment in `lib/dispatch-tokens.js` | 37 / 1,038 | pass (harness valid) |
| M3 | `DispatchTokenStore.revokeToken` drops `urlKey` from `deleteOne` (`lib/dispatch-tokens.js:246-249`) | 37 / 1,038 | **SURVIVED** |
| M5 | `listTokens` adds `tokenHash` to each row (`lib/dispatch-tokens.js:213-226`) | 37 / 1,038 | **SURVIVED** |
| M17b | feedback token accepts expired tokens: `expiresAt: {$gt: new Date(0)}`, query shape kept (`lib/harbour-feedback-tokens.js:95`) | 58 / 1,157 | **SURVIVED** |
| M18 | feedback token `itemId` binding dropped (`lib/harbour-feedback-tokens.js:98-99`) | 58 / 1,157 | **SURVIVED** |
| M20 | `applyPreset` drops `urlKey` (`lib/model-routing-store.js:222`) | 53 / 1,554 | **SURVIVED** |
| M21 | `undo` drops `urlKey` (`lib/model-routing-store.js:233`) | 53 / 1,554 | **SURVIVED** |
| M22 | `listPresets` drops `urlKey` (`lib/model-routing-store.js:161`) | 53 / 1,554 | **SURVIVED** |
| M23 | `getLog` drops `urlKey` (`lib/model-routing-store.js:142`) | 53 / 1,554 | **SURVIVED** |
| M28 | erasure: the shared-anonymisation `arrayFilters` matches every element (`$exists: true` for `$in: groupIds`, `lib/account-erasure.js:932`) | 7 / 407 | **SURVIVED** |
| ALL | M3, M5, M17b, M18, M20–M23, M28 together, whole unit suite | 24,923 | **all SURVIVED** (1 fail, the environmental one) |

Carried from research at `da5df707d`. These modules and their killing tests are unchanged through
`b5950f704`. Kills: M3p and M5p, the same two mutants on `ProxyTokenStore`
(`tests/unit/proxy-tokens.test.js:672`, `:641`); M19 (feedback token replayable,
`tests/unit/harbour-feedback-tokens.test.js:34`); M25 (`DELETE …/dispatch/tokens/:tokenId` drops
`refuseNonOwner`, `routes/dispatch.js:1173`); M26, M27 and M30 (the erasure re-check, plan-mismatch
and unmapped-workspace gates); M31 (dispatch-store cleanup deletes un-archived rows, behavioural,
`tests/unit/lin-3805-store-fault-503.test.js:257`); M32 (killed, but only by a source-shape census at
`:677`). Survived: M14 (proxy-token idle prune, L1). **Not counted as evidence:** M17 (drop the expiry
filter) "killed" only because the inline fake dereferences `query.expiresAt.$gt`
(`tests/unit/harbour-feedback-tokens.test.js:18-19`), a fake-shape artefact, which is why M17b exists.
M24 (`readTakenForUsage` drops `urlKey`) is partly equivalent, since token-scoped rows filter on
`takenByTokenId`. M29 (erasure `idPrefix` unanchored) is near-equivalent, since account ids are UUIDs.

**Traps.**
- *Trap 1 (zero coverage is absent from the table).* `git ls-files lib routes` minus the parsed
  table leaves **`routes/test.js` only**, which is mounted only under `NODE_ENV=test`. Last run it was
  eleven files. **The trap has changed shape:** modules that used to be absent now appear as
  *import-only rows*, with declaration lines counted and almost no functions run. This run adds a
  **funcs-below-50% sweep** to the method: `lib/render-audit.js`, `lib/render-custom-prompts.js` and
  `lib/render-templates.js` at 0; `lib/custom-prompts-store.js` 14.3; `routes/legacy-redirects.js` 28.6;
  `lib/dispatch-session-read.js` 44.4; `routes/ship-biscuit.js` 45.5. None is on an auth, money or
  data-integrity path.
- *Trap 2 (Playwright covers it)* and *Trap 3 (full lines hide an unasserted branch)* were applied
  per finding. M5 is a Trap 3 case: `listTokens` is 100% line-covered.
- *Fakes.* A census of the 62 `lib/**` modules that call a collection operation finds **17 with no
  unit file that both imports them directly and loads a real engine**: brief-cache,
  collective-characters-store, collective-presets-store, custom-prompts-store,
  dismissal-suggestions-store, dispatch-presets-store, harbour-comments-store, **model-routing-store**,
  observation-sessions-store, run-proposals-store, saved-chat-store, shelved-rulings-store,
  ship-biscuit-history-store, task-snapshot-store, wake-shadow, workspace-change-log and
  workspace-preferences. The high-cost member is model-routing-store (C2). This is a file-level
  heuristic. It misses a fake-backed invariant inside a file that also opens a real engine, and
  `lib/harbour-feedback-tokens.js` is exactly that case (C3). The home for replacing fakes is
  LIN-3541 (Todo). `fake-only-census.json` in the evidence folder lists all 62.

**Reliability data (CI history reachable).** `gh` is authenticated and the repo is public.
`gh run list` returns at most 1,000 runs, and research's single listing therefore began at
2026-10-24T19:19Z, not at `0b5afa6f` (2026-10-23T12:43Z). This run lists `test.yml` by
`--created` date slice instead, seven three-day slices with none above 405 runs. **The window holds
1,188 runs: 1,125 success, 63 failure, 16 with `run_attempt > 1`.** 188 of them fall before research's
listing began, and 154 of those came after LIN-3798's merge (`cada192e0`, 2026-10-23T17:21Z).

Sample: every fourth first-attempt green run, plus every failed and every re-run run, drawn
separately in the gap and after it. That is 355 runs, with the E2E shard and unit job logs of
every attempt (all 355 with a complete log set). Per-test granularity is the same as last time
and no finer: the Playwright `list` reporter's first-attempt `✘` line, its `N flaky` block and the
first-attempt error. `retries: process.env.CI ? 2 : 0` is at `playwright.config.js:22`, and
`test-results/` is uploaded only on failure (`.github/workflows/test.yml:133`). The 1-in-4 green
sample is a bound, not the population. `ci-census.md` in the evidence folder has the commands, the
counts and every sampled run's first-attempt failure sites.

**85 of 292 sampled green runs (29%) carried at least one retry rescue**: 81 of 246 (33%) after
10-24T19:19Z, the same as last run's 33%, and 4 of 46 in the earlier gap slice. The rate did not move;
new sites replaced the old ones.

## Findings, severity-ranked

### High

**C2 — `model-routing-store-urlkey-filters-unasserted` — new name; grades an existing Security Review entry. Top finding (raised from Medium-High by the second read).**
The Security Review (10 Nov) counted these filters as untested (row 21,
`docs/reviews/security-review-2026-11-10.md:64`) and left the entry "`urlKey` filters untested" in
`docs/areas/agent-api.md` (`routes/proxy-model-routing.js`). This run grades that entry and does not
duplicate it. **M20 (preset apply), M21 (undo), M22 (`listPresets`) and M23 (`getLog`) all survive
the whole unit suite.** M22 and M23 carry the weight, and they have no precondition.
`GET …/model-routing/presets` and `…/log` (`routes/proxy-model-routing.js:97-105`) accept any proxy
token, and `publicEntry` (`:56-59`) strips only `urlKey` and the actor's account id. Settings
(`routes/settings.js:190-191`, `:297-298`) reads the same two methods. A dropped filter would serve
every workspace's presets and change log to any token from any workspace and to any member: actor
names, reasons, token ids and entry ids. No test would fail. M20 and M21 need another workspace's
UUID, which bounds them. The store is new in the window, fake-only (see Fakes above), and its one
direct test file has no real engine. No ticket holds this; the existing note entry is its home.

### Medium-High

**C1 — `dispatch-token-store-untested-auth-boundary` — not resolved, though LIN-690 is Done (lowered from High by the second read).**
LIN-690 was closed on 30 Oct by backlog triage: "Already fixed on main … I did not check every case
the ticket lists." Neither case the ticket named is asserted:
- **Cross-workspace revoke.** The only workspace guard is `urlKey` in `deleteOne({ _id: tokenId,
  urlKey })` (`lib/dispatch-tokens.js:246-249`), behind `DELETE /workspace/:urlKey/api/dispatch/tokens/:tokenId`
  (`routes/dispatch.js:1164`). The route's owner gate (`:1173`, M25 killed) checks the caller's
  workspace, not the token's. **M3 survives the whole unit suite**: a regression that let an owner
  of workspace A revoke workspace B's runner token by id would ship green. It is bounded like M20
  and M21: the id is a UUID (`routes/dispatch.js:1170`) that is never listed outside its own
  workspace, and the harm is a revoke (a runner stops), not an exposure.
- **Hash never listed.** `listTokens` (`lib/dispatch-tokens.js:205-231`) goes straight to
  `res.json({ tokens })` (`routes/dispatch.js:1153-1154`). **M5 survives the whole unit suite**,
  even though the function is 100% line-covered (Trap 3). A leaked hash would reach only the token's
  own workspace, and it cannot be presented as a credential, because validation hashes whatever the
  caller sends (`lib/dispatch-tokens.js:129-136`). It is a contract the store's own comment states
  ("never the token hash") that no test holds.

What keeps this near the top is the closure, not the impact: a ticket minted for exactly these two
cases was closed as fixed without either being checked. `lib/dispatch-tokens.js` has not changed
since `9aa68bb82` (23 Oct). The sibling `lib/proxy-tokens.js` kills both mutants (M3p, M5p), so the
gap is specific to the dispatch store, and the proxy tests are the pattern to copy. With LIN-690
closed, nothing open holds this. It is written as a Waiting entry in `docs/areas/agent-api.md`;
whether to reopen LIN-690 instead is a question for the person (see the end).

**C3 — `harbour-feedback-tokens-zero-coverage` — changed shape: covered through a fake, two invariants still unasserted.**
The module is no longer absent. It reads 90.23 / 70 / 80 through an inline fake added by LIN-3795 in
the window. Single use is asserted (M19 killed). **Expiry (M17b) and item binding (M18) survive
the whole unit suite.** The plain expiry mutant's "kill" (M17) came from the fake's shape, not from a
behavioural assertion: the T-mockcoll seam in
`docs/reviews/code-quality-review-2026-10-12-tests.md`, cited here only as the cause. LIN-2061
(Backlog) names exactly these two invariants. It stays in the report only.

### Medium

**R1 — `e2e-retry-hidden-task-page-phone-layout` — new.**
`tests/e2e/task-page.spec.js:274` ("layout: one calm column on a phone … stages beside the brief on
desktop") failed its first attempt and passed on retry in **33 of 292 sampled green runs
(10-29 to 11-11), and is still occurring**. Playwright reports it at `:374`, `:376` and `:379` as the
file moved. The first-attempt error is always the desktop half: `both offers on one line`, expected
< 4, received 10.25 (11.20 three times), at `tests/e2e/task-page.spec.js:321`. That is a one-shot
`boundingBox` read of the two quiet offers (`lib/render-task-page.js:884-885`) straight after a
reload, with no wait for layout to settle. Only a regression that fails every attempt goes red. The
offset is the same 10.25 px almost every time, which points to one repeatable first-load layout state
(the offers apart until something settles), not noise. That state may be what a person sees on a cold
load, and the retry hides it. The onset follows LIN-3975
(`74ad4f4c9`, 26 Oct), which added the quiet offers. No ticket. Waiting entry in
`docs/areas/front-end-pages.md`.

**C4 — `account-erasure-array-anonymise-overreach` — new.**
The last run's "Not done" list asked for `lib/account-erasure.js` to be mutation-spiked. Most guards
are killed (M26, M27, M30). **M28 survives:** if the Full level's shared-anonymisation
`arrayFilters` (`lib/account-erasure.js:932`) matched every element, every `trimHistory[].by` in a
row naming the erased account would be rewritten to `erased`, a co-member's entry included. That is
an irreversible over-anonymisation of other people's audit history. The test asserts only the
erased account's own entry (`tests/unit/account-erasure.test.js:267`). Waiting entry in
`docs/areas/reports-and-operator-tools.md`.

**C5 — `proxy-fetch-egress-untested` — unchanged (43.22%).**
`createProxyFetch` (`lib/proxy-fetch.js:103-198`) is still uncovered, with the open defect LIN-1879
(Backlog) inside those lines. It stays in the report only.

### Medium-Low

**R2 — `unit-rerun-rescues-scheduler-timing` — new.**
The last report said a unit flake "would show as red" because the unit suite has no retry layer.
In fact, manual whole-run re-runs are a retry layer. In the 16 re-run runs, attempt 1 failed a
**unit** job in five that then went green. Three were `tests/unit/db-indexes.test.js` (10-25
and 10-26, one on a `main` push), fixed in the window by LIN-3985 (`96efd1fe6`). One is open:
`tests/unit/scheduler.test.js:265` "(e) error containment" failed once (run 40251525217, 10-26) with
`expected the interval to keep ticking past the first throw (at least 2 calls), got 1`. The test
sleeps 300 ms of wall clock for 30 ms ticks (`:285`). Under load its failure message is the
defect it guards (an interval cleared after a throw), so a person reading the red cannot tell them
apart, and the habit it teaches is to re-run. No ticket; LIN-4294 is the sibling fixed-sleep case in
`task-mode-routes`. Waiting entry in `docs/areas/platform-and-plumbing.md`. The fifth unit rescue is
L8.

**R3 — `e2e-live-github-egress` — new member of the LIN-3815 class.**
`tests/e2e/settings-providers.spec.js` seeds a GitHub binding (`octo/repo`) with a fake installation
token. The background task-facts refresh (`lib/task-facts-holder.js:150`) then calls `api.github.com`
live. `Bad credentials` appears in the E2E logs of **127 of the 355 sampled runs**, on REST
`/repos/octo/repo/issues` and `/milestones` and on GraphQL. LIN-3798 stubbed only Linear's
`test-token`, in-process (`routes/test.js:53`; the "Authentication required" lines in the run-page
logs are that stub, not egress). LIN-3815 (Backlog) names the OpenRouter catalog and
uploads.linear.app, not GitHub. This is not proven to cause any rescue, and the population cannot be
bounded from logs, because only calls that log an error are visible. The e2e server has no egress
guard, while the unit suite has `test:hermetic`. The guard is the larger tidy: a size-of-move entry
in `docs/areas/web-routes.md`. The site itself is for LIN-3815 (a question for the person).

**R4 — `e2e-retry-hidden-session-run-chat` — new.**
`tests/e2e/session-proposals.spec.js:64` was retry-rescued in **10 sampled green runs
(11-04 to 11-11)**. Its first attempt does not find `[data-testid="session-run-chat"]`
(`tests/e2e/session-proposals.spec.js:72`; the link is drawn by `lib/render-session.js`). A run
page that lost its chat link would read as this flake. The cause is not established. No ticket.
Waiting entry in `docs/areas/front-end-pages.md`.

### Low

- **L1 — `proxy-tokens-residual-branches`: unchanged.** M14 survives: the idle prune
  (`lib/proxy-tokens.js:1050-1062`) still has no test that keeps a recently used old token.
- **L2 — `real-mongo-suites-skip-silently`: downgraded and corrected.** The last report said that if
  the CI env line were dropped, "CI stayed green". That was wrong. All seven real-`mongod` suites
  (`mongo-smoke`, `scheduler`, `cost-read-usage-parity`, `dispatch-store-decision-withdrawal`,
  `lin-3130-taken-by-token-id-mongo`, `lin-3134-grant-declaration-mongo`,
  `lin-4198-request-usage-mongod`) already throw when `CI` is set and the URI is missing (the guard
  at `tests/unit/mongo-smoke.test.js:53` was there at `0b5afa6f`). Research verified it with `CI=1
  MONGODB_TEST_URI=`. What is left is that the guard is a per-file convention: nothing makes a *new*
  real-Mongo file carry it. LIN-3799 (Backlog) could narrow to that census.
- **L3 — `agent-status-grouping-untested-data-integrity`: dead code still present.** LIN-691 was
  canceled on 30 Oct, but `listSessions` and `listTaskThreads` (`lib/agent-status-store.js:228`,
  `:299`) remain with no production caller. Waiting entry in `docs/areas/runs-and-dispatch.md` to
  delete them.
- **L4 — `e2e-conditional-skip-never-asserts`: unchanged.** `tests/e2e/interactions.spec.js:467`
  skips at `:475` whenever the landing page draws no `.line.expandable`, which it never does.
- **L5 — `custom-prompts-store-zero-coverage`: now an import-only row** (51.25 / 100 / 14.29). Same
  substance; exercised only by Playwright (Trap 2).
- **L6 — `openrouter-auth-callback-error-branches`** (86.55 / 77.14) and **`harbour-spawn-tty-path`**
  (83.77 / 33.33): unchanged.
- **L7 — `proxy-agent-status-input-validation` — new.** `routes/proxy-agent-status.js` is
  76.71 / 65.71. Its body validation (`:32-79`, required fields and length caps) is unexecuted, so
  a dropped length cap on an agent-written field would pass.
- **L8 — `unit-rerun-rescues-token-tail-collision` — new.** On a `main` push (run 40051600931,
  10-24), attempt 1 failed `tests/unit/task-share-route.test.js:525`, "dispatch token tail reached
  the body", and the re-run went green. The test checks that the last four characters of a fresh
  random base64url token do not appear anywhere in an 11,920-byte page. That collides by chance:
  simulated against the real body, about 0.06% of runs, or roughly one in 1,600, which fits one
  sighting in about 1,200 CI runs. The full-token check on the line before is the real guard. The
  cost is a security-worded false red that teaches people to re-run, not a hidden leak.
- **L9 — `wrappers-tmpdir-false-red` — new.** `scripts/code-shape/wrappers.test.mjs:258` fails for
  every dispatched agent that runs `test:unit`. Its "no acorn on the path" copy lives under `TMPDIR`,
  and a dispatched session's `TMPDIR` sits under the simple-dispatcher checkout, whose `node_modules`
  holds acorn. CI is unaffected. It has no area file (the test is under `scripts/`), so it is raised
  for the person in the closing comment. Reported, not fixed.
- **L11 — `task-share-timeline-mask-unasserted`: graded, already homed.** Security Review row 16
  (`docs/reviews/security-review-2026-11-10.md:59`) said no test pins `maskFragment` on the public
  `GET /t/:token/timeline` (`routes/task-share.js:307`, new in the window). Its entry already sits in
  `docs/areas/web-routes.md` (`routes/task-share.js`), so this run adds no note. Removing the mask
  (M33) survives the 13 task-share unit files (283 tests), and the second reader found it survives the
  whole suite. The sibling masks are pinned: dropping the `/state` mask fails 2 tests, as does dropping
  the timeline's `withoutSpend` (second reader). The fragment is mostly structural text, so this is Low.
  The first draft missed it; the second read found it.
- **L10 — `free-tier-store-helper-lines`, recorded only.** `lib/free-tier-store.js` reads 82.37
  because `recordUsage` (a test helper), `cleanup` and `clear` (`:219-362`) are uncovered. None is on
  the money path, and M1, M2 and M13 were killed last run.

### Resolved or improved since 2026-10-23

| Stable name | Trend | Evidence |
|---|---|---|
| `e2e-retry-hidden-dispatch-api-stray-queue-item` | **resolved** (LIN-3798) | 0 first-attempt `✘` for `tests/e2e/dispatch.spec.js` in any sampled green run after the merge. The census can see it: the two gap-slice runs before the merge (10-23 12:57Z and 14:16Z) both show the old signature at `:604`. The only later `dispatch.spec.js` failures are red PR runs on two feature branches (LIN-3812 on 10-23, LIN-3849 on 10-24), failing every retry at other lines. That is the suite catching a branch's breakage, not a rescue. |
| `e2e-retry-hidden-collective-fanout-seat-failure` | **resolved** (LIN-3798) | 0 first-attempt `✘` for `tests/e2e/collective.spec.js` in any sampled run, red or green. |
| Trap-1 absent set | improved | 11 to 1 (`routes/test.js`, test-only); see import-only rows. |
| db-indexes unit flake | resolved | LIN-3985 (`96efd1fe6`, 31 Oct); none after. |
| `llm-call-log-query-funcs` | improved | 95.16 (`lib/llm-call-log.js:177-185` left) |
| `token-refresh-failure-branch` | unchanged | 96.68 (`lib/token-refresh.js:174-180`) |
| `free-tier-…`, `proxy-events-…`, `linear-fetch-…` | still resolved | 82.37*, 96.30, 96.00 (*L10) |

**Checked and not gaps.** Modules that are high-cost and new or heavily changed in the window (churn
of 150 lines or more, a high-cost name, and line below 97 or branch below 88):
`routes/proxy-compute.js` (90.14 / 71.28; its uncovered lines are error mappings to 4xx/5xx, the
recap/brief chain the agent-api note already holds), `routes/proxy-model-routing.js` (96.3 / 91.78;
its store is C2), `lib/close-out-merges.js` (100 / 86.79; it records the merged audit event and does not gate the merge), `routes/proxy-writes.js` (99.78 / 87.73)
and `lib/dispatch-session-read.js` (100 / 86.67 / funcs 44.4, an import-only gap in helpers). None
showed a high-cost defect a test would miss beyond C2.

## Retry-rescued e2e sites in green runs (all that the logs expose)

Counts are sampled green runs with a first-attempt `✘` at the site. Lines are as Playwright reported
them at each run's sha.

| runs | site | first..last | test |
|---|---|---|---|
| 16 | `tests/e2e/task-page.spec.js:379` | 11-07..11-11 | Task page, owner view (LIN-3329) › layout: one calm column on a phone (answer, s |
| 14 | `tests/e2e/task-page.spec.js:376` | 11-02..11-06 | Task page, owner view (LIN-3329) › layout: one calm column on a phone (answer, s |
| 10 | `tests/e2e/session-proposals.spec.js:64` | 11-04..11-11 | Run page: chat about this run → proposals (LIN-3254) › proposes, applies once, a |
| 9 | `tests/e2e/lin-3833-home-first-page.spec.js:98` | 10-25..10-25 | Home first page — the Change panel is a full-screen sheet on a phone (LIN-3833)  |
| 6 | `tests/e2e/detail-nonactive-binding.spec.js:118` | 10-25..10-25 | Sibling id-scoped routes on a non-active (Jira) binding (LIN-1904) › prompt and  |
| 6 | `tests/e2e/detail-nonactive-binding.spec.js:390` | 10-25..10-25 | Recap / Brief / Recommend / Task Chat on a non-active (Jira) binding (LIN-1910)  |
| 6 | `tests/e2e/lin-4010-home-opened-task.spec.js:230` | 11-02..11-08 | Change is a drawer at desktop width, and Escape closes it (LIN-4010) › the drawe |
| 5 | `tests/e2e/local-provider.spec.js:305` | 10-24..10-25 | Local provider (no test-token mock) › description Preview renders real Markdown, |
| 3 | `tests/e2e/dispatch-page.spec.js:1142` | 10-24..10-25 | Dispatch Page › Token Management › can revoke token |
| 3 | `tests/e2e/lin-4010-home-opened-task.spec.js:227` | 10-30..11-01 | Change is a drawer at desktop width, and Escape closes it (LIN-4010) › the drawe |
| 3 | `tests/e2e/local-provider.spec.js:246` | 10-25..10-26 | Local provider (no test-token mock) › description Preview renders live and savin |
| 3 | `tests/e2e/proxy.spec.js:58` | 10-24..10-24 | Proxy Page › can create and revoke proxy tokens via UI (retry #2) |
| 3 | `tests/e2e/proxy.spec.js:59` | 10-25..10-26 | Proxy Page › can create and revoke proxy tokens via UI |
| 3 | `tests/e2e/task-page.spec.js:374` | 10-29..10-31 | Task page, owner view (LIN-3329) › layout: one calm column on a phone (answer, s |
| 2 | `tests/e2e/dispatch.spec.js:604` | 10-23..10-23 | Dispatch API › GET /api/dispatch lists queue items |
| 2 | `tests/e2e/lin-4010-home-opened-task.spec.js:342` | 11-02..11-04 | the review-shaped Home at 1280px, dark (LIN-4010 review) › one running box with  |
| 2 | `tests/e2e/observation.spec.js:519` | 11-06..11-07 | Autopilot Observation page (first-class) › Running-collapsed livebar shimmer (LI |
| 2 | `tests/e2e/ship.spec.js:332` | 10-25..10-25 | Ship Page › layout is deterministic across reloads |
| 1 | `tests/e2e/lin-3968-home-next-step.spec.js:332` | 11-10..11-10 | Home: the stage strip is one row and styled (LIN-3968) › every chip sits on one  |
| 1 | `tests/e2e/live-console.spec.js:3215` | 11-02..11-02 | Live Console (experimental) › LIN-4035: activity collapsed, one link rule, the t |
| 1 | `tests/e2e/look-alike-controls.spec.js:209` | 11-03..11-03 | Look-alike controls in ticket text answer nothing (LIN-3385) › task page: a look |
| 1 | `tests/e2e/observation-rulings.spec.js:1148` | 11-08..11-08 | Bulk-agree suggested rulings (LIN-2444 Phase 5) — e2e › two loops sharing one de |
| 1 | `tests/e2e/observation-rulings.spec.js:1275` | 11-08..11-08 | Bulk-agree progress / Stop / completion summary (LIN-2758) — e2e › a full 3-row  |
| 1 | `tests/e2e/observation.spec.js:543` | 11-06..11-06 | Autopilot Observation page (first-class) › Running-collapsed livebar shimmer (LI |
| 1 | `tests/e2e/task-page.spec.js:817` | 11-05..11-05 | Task page, owner view (LIN-3329) › LIN-3634: a head that moves after the page lo |

Only sites that recur and name a concrete defect a pass-on-retry would hide are graded (R1, R4).
The lin-4010 drawer rescues (`:227`, `:230`) belong to LIN-4102 (Backlog). The same spec's `:342`
(the 1280px dark Home, two runs) is recorded, not graded. The 10-24 to 10-26 cluster
(detail-nonactive-binding, lin-3833 home sheet, local-provider, proxy page, dispatch-page "can
revoke token") has not recurred since 10-26. The dispatch-page revoke error (`settings-key-dispatch`
count expected 0, received 1) is exactly what a revoke no-op looks like, but with no recurrence it
is recorded, not graded.

## The last report's "Not done" list

- *`lib/dispatch-store.js` and the e2e-only surfaces were not mutation-tested.* Research spiked
  dispatch-store: M31 (cleanup deletes un-archived rows) was killed behaviourally; M32
  (`getItemWatchToken` swallows a store fault) was killed only by a source-shape census, not
  behaviourally; M24 is partly equivalent. The e2e-only surfaces are still not mutation-tested.
- *Unbounded class: high-cost modules unit-covered only through an inline fake.* Now bounded as a
  file-level census: 17 of 62 (see Fakes). Two members carry graded gaps (C2; C3 by the
  file-that-also-opens-a-real-engine miss). LIN-3541 remains the home.
- *`lib/account-erasure.js` not mutation-spiked.* Done: M26, M27 and M30 killed, M28 survived (C4),
  M29 near-equivalent.
- *Whether R1 and R2 (old) share one cause.* Moot: both are resolved by LIN-3798.

## Sibling repo `JKershaw/simple-dispatcher` (graded, bounded depth)

**Decision: graded this time.** LIN-3160 is Done, so a grade is meaningful, and it costs one suite
run. The depth is bounded: no mutation spikes, and no sibling note, because a simple-dispatcher note
cannot cite this repository's report. At `origin/main` `7d6c5c6`, 67 commits after `e2b4dcc`, with
`npm test`'s own `--require`s under native coverage: **4,346 tests (was 3,471), 0 fail, 6 skipped,
97.22 / 91.34 / 90.17 (was 96.86 / 90.81 / 89.14).** The two instrumentation-only failures from last
time (LIN-2509, LIN-1420 W4) did not recur in six runs. During research, at the same sha,
`test/state-store.test.js:50` ("never loses a field under many interleaved concurrent writers") failed
once under full-suite load. **This run did not reproduce it**: 0 in six full instrumented runs (two
alongside the full Harbour unit suite) and 0 in 12 isolated runs. The store's designed lock steal
after `LOCK_TIMEOUT_MS = 5000` (`state-store.js:84`, `acquireLock`) is the plausible path if it
recurs; one sighting is not a finding. CI's last 30 runs (11-04 to 11-11) are green. CI runs
`npm test` only, on purpose (`.github/workflows/ci.yml`; LIN-1580, LIN-3160). Detail:
`sibling-simple-dispatcher.md` in the evidence folder.

## Area notes written

Each entry cites the area's file first and this report second; the source reads "(Test Coverage
Gap Review, 11 Nov.)". Findings that already have a ticket stay out of the notes: LIN-2061 (C3),
LIN-1879 (C5), LIN-3799 (L2), LIN-3815 (R3's site), LIN-4102 (drawer rescues) and LIN-3541 (fakes).

| Note | Entry | Finding |
|---|---|---|
| `docs/areas/agent-api.md` | `lib/dispatch-tokens.js` | C1 |
| `docs/areas/front-end-pages.md` | `lib/render-task-page.js`; `lib/render-session.js` | R1; R4 |
| `docs/areas/reports-and-operator-tools.md` | `lib/account-erasure.js` | C4 |
| `docs/areas/platform-and-plumbing.md` | `lib/scheduler.js` | R2 |
| `docs/areas/runs-and-dispatch.md` | `lib/agent-status-store.js` | L3 |
| `docs/areas/web-routes.md` | `routes/test.js`, a size of move (an e2e egress guard), naming `lib/task-facts-holder.js` (Other features) across the seam | R3 |

C2 has no new entry. Its home is the Security Review's existing `routes/proxy-model-routing.js`
entry in `docs/areas/agent-api.md`, which this report grades. `docs/areas/llm-and-prompts.md`
(the store's own area, 1 byte under the cap) is not edited.

**Pruned from `docs/areas/agent-api.md` to make room (6,124 bytes, 20 free).** Two entries, each
double-homed with an open ticket. `LEFTOVER_RULE` (`lib/prompts/leftover-words.js`) says "an item
never lives in both", and `docs/areas/README.md` says "When a follow-up is filed for a note entry,
remove the entry":
- `routes/proxy-rulings.js` (its own live-run predicate instead of `liveOnAnchor`): **LIN-3843**
  (Backlog, "Rulings live-on-anchor predicate is duplicated in routes/proxy-rulings.js and …") holds
  exactly this. The duplicate is still in the code (`routes/proxy-rulings.js:248-250`).
- `lib/proxy-preamble.js` (`applyDefaultDispatchHarness` imported by model routing): **LIN-4155**
  (Backlog, "Seams: move applyDefaultDispatchHarness out of lib/proxy-preamble.js so model routing
  stops importing Agent API") holds exactly this.

Every other agent-api entry was re-read against the code at `b5950f704` and still holds, so none
was cut or shortened. Note sizes after the change: agent-api 5,870, front-end-pages 5,937, runs-and-dispatch 5,980, platform-and-plumbing 2,291, reports-and-operator-tools 1,379, web-routes 2,085, llm-and-prompts 6,143.

**Seams have no full home in the notes yet.** R3 is a cross-area seam: the guard would sit with
the e2e test routes (web-routes), and the egress site is in Other features. It is filed under the
area a change would start from, naming the other side.

## Not done / what could make this set wrong

- **Classes and their bounds.** (1) Store `urlKey` and binding filters: the ticket's stores,
  Security Review row 21 and the proxy sibling, not a sweep of every filter in the 62 DB modules. A
  high-cost filter elsewhere would be missed. (2) Fake-only DB modules: a file-level heuristic, which
  misses a fake inside a file that also imports MangoDB. (3) Retry rescues: a 1-in-4 sample of green
  runs, so a rare site seen only in unsampled runs is missed. (4) Real-mongod suites: 7, all guarded.
  (5) Unit re-run rescues: every attempt-1 job of all 16 re-runs. (6) E2e egress: **unbounded**; only
  calls that log an error are visible.
- Not run: `test:clock-shift` and the hermetic arms. The hermetic keyed arm is CI's own unit job,
  which is green on `b5950f704`.
- The e2e-only (Trap 2) surfaces were not mutation-tested.
- The cause of R4 (late link or late seed) is not established.

## For the person (none blocks hand-off)

- Reopen **LIN-690** with M3 and M5 as its acceptance tests? If yes, remove the C1 entry from
  `docs/areas/agent-api.md` (one home).
- Add the GitHub task-facts egress (R3) to **LIN-3815**?
- Narrow **LIN-3799** to a census that makes every new real-Mongo suite carry the CI guard (L2)?
- Larger tidy: a standing e2e egress guard (R3; `docs/areas/web-routes.md`).
- No area file: the `wrappers.test.mjs` `TMPDIR` false red (L9).
- Sibling: the research-time `state-store` failure did not reproduce in 18 runs. Nothing to act on
  unless simple-dispatcher's own run sees it again.

## Trend Ledger (stable names; the next run diffs against this)

| Stable name | Module | Severity | State vs 2026-10-23 |
|---|---|---|---|
| `model-routing-store-urlkey-filters-unasserted` | `lib/model-routing-store.js` | High | new (grades Security Review row 21); top finding |
| `dispatch-token-store-untested-auth-boundary` | `lib/dispatch-tokens.js` | Medium-High | lowered from High (bounded impact); LIN-690 closed unresolved (M3, M5 survive the whole suite) |
| `harbour-feedback-tokens-zero-coverage` | `lib/harbour-feedback-tokens.js` | Medium-High | changed shape: fake-covered, M17b/M18 survive (LIN-2061) |
| `e2e-retry-hidden-task-page-phone-layout` | `tests/e2e/task-page.spec.js` | Medium | new |
| `account-erasure-array-anonymise-overreach` | `lib/account-erasure.js` | Medium | new |
| `proxy-fetch-egress-untested` | `lib/proxy-fetch.js` | Medium | unchanged (LIN-1879) |
| `unit-rerun-rescues-scheduler-timing` | `tests/unit/scheduler.test.js` | Medium-Low | new |
| `e2e-live-github-egress` | `lib/task-facts-holder.js` | Medium-Low | new (LIN-3815 class) |
| `e2e-retry-hidden-session-run-chat` | `tests/e2e/session-proposals.spec.js` | Medium-Low | new |
| `proxy-tokens-residual-branches` | `lib/proxy-tokens.js` | Low | unchanged (M14) |
| `real-mongo-suites-skip-silently` | `tests/unit/mongo-smoke.test.js` | Low | downgraded and corrected (LIN-3799) |
| `agent-status-grouping-untested-data-integrity` | `lib/agent-status-store.js` | Low | dead code still present (LIN-691 canceled) |
| `e2e-conditional-skip-never-asserts` | `tests/e2e/interactions.spec.js` | Low | unchanged |
| `custom-prompts-store-zero-coverage` | `lib/custom-prompts-store.js` | Low | now an import-only row |
| `openrouter-auth-callback-error-branches` | `routes/openrouter-auth.js` | Low | unchanged |
| `harbour-spawn-tty-path` | `lib/harbour-spawn.js` | Low | unchanged |
| `proxy-agent-status-input-validation` | `routes/proxy-agent-status.js` | Low | new |
| `unit-rerun-rescues-token-tail-collision` | `tests/unit/task-share-route.test.js` | Low | new |
| `wrappers-tmpdir-false-red` | `scripts/code-shape/wrappers.test.mjs` | Low | new (environmental) |
| `free-tier-store-helper-lines` | `lib/free-tier-store.js` | Low | recorded only |
| `task-share-timeline-mask-unasserted` | `routes/task-share.js` | Low | new here (Security Review row 16; M33 survives) |
| `e2e-retry-hidden-dispatch-api-stray-queue-item` | `tests/e2e/dispatch.spec.js` | (was High) | resolved (LIN-3798) |
| `e2e-retry-hidden-collective-fanout-seat-failure` | `tests/e2e/collective.spec.js` | (was Medium) | resolved (LIN-3798) |
| `free-tier-global-hourly-cap-unenforced` | `lib/free-tier-store.js` | (was Critical) | still resolved |
| `proxy-events-zero-coverage` | `lib/proxy-events.js` | (was Medium) | still resolved |
| `linear-fetch-retry-exhaustion` | `lib/linear-fetch.js` | (was Low) | still resolved |
| `llm-call-log-query-funcs` | `lib/llm-call-log.js` | Low | improved |
| `token-refresh-failure-branch` | `lib/token-refresh.js` | Low | unchanged |

## Adversarial Second-Read

**Tier 2:** a fresh-context sub-agent with no memory of the research or the report-writing turns.
It was given only the report path, the window SHAs (`0b5afa6f` to `b5950f704`) and the question.
**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer** (every point it made, with its formatting condensed; a preamble noting that the
report was committed while it read, with no finding or citation moving, is omitted):

> No miss large enough to change the report's conclusions; the largest issue is a **severity misfile
> between the top two findings**: by the report's own bounding logic, C2 is at least as severe as C1,
> and arguably more.
>
> I re-ran the mutants jointly on the whole unit suite: M3, M5, M22 and M23 all survive (24,923 tests,
> only the known environmental failure), so the survival claims hold. But the report discounts
> M20/M21 because they "need another workspace's UUID, which bounds them", and gives M3 no such
> discount, though M3 has exactly that precondition: the route checks `UUID_REGEX`
> (`routes/dispatch.js:1170`) and deletes by `_id: tokenId`, and token ids are never listed outside
> their own workspace. Its harm is also only a revoke, a runner taken down, with nothing exposed. M5
> is weaker still: it would add a SHA-256 of a 256-bit random token to a listing shown only to the
> token's own workspace, and tokens are validated by hashing what the caller presents
> (`lib/dispatch-tokens.js:129-136`), so a leaked hash is not a usable credential. By contrast, C2's
> M22/M23 has no precondition: any proxy token from any workspace would read every workspace's change
> log (actor names, reasons, token ids, entry ids; `publicEntry` at `routes/proxy-model-routing.js`
> strips only `urlKey`). It is new code in the window (`lib/model-routing-store.js`, +330 lines) with
> no ticket, while `lib/dispatch-tokens.js` is unchanged since `9aa68bb82`. C1's real weight is a
> process failure: LIN-690 was closed as fixed without the fix being checked. That is worth
> reporting, but it does not raise the regression impact.
>
> One real miss, small: Security Review row 16 (`docs/reviews/security-review-2026-11-10.md:59`)
> records a test gap on a new public surface that the report never mentions. I confirmed it: removing
> `maskFragment` from `GET /t/:token/timeline` (`routes/task-share.js:307`, added on 11-10 by
> LIN-4405) survives the whole suite (24,923 tests, 1 environmental failure). The sibling masks are
> pinned: removing the `/state` mask fails 2 tests, and removing the timeline's `withoutSpend` fails 2.
> The report graded row 21 of that review (C2) but skipped row 16. It is Low, because the timeline
> renders mostly structural text.
>
> Checked and sound: the model-routing write paths (forcing the proxy-write setting gate open fails
> 1 test; removing the version check fails 2); the free-tier billing clamp (`lib/agent-turn.js:460`
> killed behaviourally; `routes/dashboard-summaries.js:90` killed only by census and witness tests);
> tests deleted in the window, each removed with its feature (LIN-3912, LIN-3855, LIN-4129); the
> test-runner and CI changes (keyed hermetic arm, clock-shift arm, LIN-3798's e2e write-drain), all of
> which strengthen the suite; the test files outside the CI globs (`tests/judge`, `tests/measures`,
> `tests/visual`, `tests/perf`), all off CI on purpose. One stale failure predates the window
> (`scripts/eval/jev-routing-state.test.mjs`, 1 of 15). The coverage ran on Node v25.9.0 while CI
> pins Node 24; minor, and the report does not disclose it.
>
> Citations I checked are accurate, except one: `tests/unit/scheduler.test.js:264` is a blank line;
> the test starts at `:265`, with the failure message at `:290`.
>
> Is the High the right top finding? Only partially. C1's facts hold, but its severity rests on the
> LIN-690 closure, not on impact. C2 (M22/M23) is an unconditioned cross-workspace read in new,
> unticketed code and should be the top finding. Demote C1 to Medium-High, and keep the
> closed-unresolved LIN-690 as a process note.
>
> Adversarial second-read verdict: AGREE
> Differed from top finding: YES

**Disposition (fixed in place).**
- The re-rank is accepted, and it agrees with the bounding this report already applied to M20 and
  M21. C2 is now the High and the top finding; C1 is Medium-High, and the LIN-690 closure is stated as
  what keeps it near the top.
- The row-16 miss is added as L11. M33 was re-run here: it survives 283 tests in the 13 task-share
  files. Row 16 already has its home in `docs/areas/web-routes.md`, so no note is added.
- The scheduler citation is corrected to `:265`, and the Node-version difference is disclosed under
  Method. The other "checked and sound" items are not findings.
- The reader's verdict stands as AGREE: no change to the report's conclusions beyond the ordering.
  The `docs/areas/agent-api.md` entry for C1 is unchanged; it records an unasserted contract whatever
  the severity.

Adversarial second-read verdict: AGREE
Differed from top finding: YES
Disposition: fixed in place
