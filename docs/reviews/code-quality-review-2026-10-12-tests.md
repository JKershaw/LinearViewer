# Code Quality Review — test estate (trial for LIN-3449), run of 2026-10-12

**Grounding.** Measured at `LinearViewer` `ce5d4120` (one docs-only commit past the research's `e24f8d12`: #1878, which touches no `tests/`, `scripts/` or code path) and `simple-dispatcher` `3dc08b5`. Both were fetched from `origin/main` before measuring. Every figure below was re-measured at these SHAs, not copied from the ticket leads. Where a live number differs from the lead, the live number is reported with the delta.

**Scope.** Tests only: `LinearViewer/tests/` (unit, e2e, fixtures, `unit/lib/`, `helpers.js`, `visual/`, `fixed-overlay-sweep.js`) and `simple-dispatcher/test/` (including `helpers/`, `system/`, `system/mutation/`). Widened (nothing shrunk): the two Playwright configs, the `npm test*` scripts in both repos, `.github/workflows/test.yml` and SD `ci.yml`, `scripts/survey-tests-*.mjs`, `scripts/eval/*.test.mjs`, `tests/visual/`, and the cross-repo copy `test/system-harness-driver-writer.test.js`. Production code was read only where a test-only seam or exported helper lives in it.

**Review-only.** The one file this task changes is this report. Follow-ups are Linear tickets.

**Method.** File and function length; `git log --since=90.days` churn × lines (the series' sub-board method); definition greps for each class; the `survey-tests-shape.mjs` classifier (existing tooling); and a read-only script that counts each mutant's `find` anchor in its target file. Counts use the stated grep; where my grep differs from the research's (noted in §6), the difference is a definition difference, not a change in the repo.

---

## 1. Answer to the trial question

> *Can the LIN-3449 loop simplify the tests the way it simplified the code?*

**Yes for test-harness mechanics. Mostly no for swap-time tests.**

- **Harness mechanics are decisions held in N places.** The in-memory Mongo collection (64 local copies, 41 variants), the one-shot HTTP helper, route-handler extraction (`getHandler`), the fake `res`, e2e session and seeding, and SD's config and Stop-hook harnesses are each one decision written many times. In three LinearViewer cases a shared home **already exists and is bypassed** (`tests/fixtures/mock-collection.js`, `tests/unit/lib/proxy-fake-deps.js` `call()`, `tests/fixtures/github-install-flow-branches.js` `getHandler`). Those fit the child-ticket shape exactly: one decision, the home exists or is extended, old copies deleted in the same PR, no new mechanism.
- **Swap-time deletion yields little.** About 150 lines of guards and removed-code pins can go (finding 13). LIN-3449's roughly +2,300 test lines are mostly caller coverage for homes that have no test file of their own (`lib/connection-credential.js`, `lib/connection-binding.js`, `lib/workspace-lookup.js`, `lib/chat-request.js`), written into new `lin-NNNN-*` files. That coverage is legitimate; deleting it loses it.
- **"Test lines per product line removed" is the wrong gauge.** It reads red when a swap adds legitimate caller coverage, and green when a copy diverges. The gauge that tracks the outcome is the Drift & Coherence one applied to tests: **copies and variants per test decision**. Variants matter because divergence is where a test lets a bug through.
- **The cause-level lever** is where the swap's tests are written. Where the home had a test file, the swap stayed small (LIN-3459, 3460, 3465, 3469, 3470, 3471-A). LIN-3456 wrote its characterizations into each module's own test file and stayed small. See the open question in §9.

---

## 2. Ranked findings (risk × churn)

Every finding is recorded, promoted or not. "Minted" findings have follow-up tickets (§7).

| # | ID | Sev | Finding | Concrete maintenance cost | Disposition |
|--|--|--|--|--|--|
| 1 | **T-mutants** | HIGH | SD `test/system/mutation/run-mutations.js`: **8 of 52** mutants' `find` anchors match 0 times at HEAD (#19 `dispatcher.js`; #22–#28 `reapers.js`, the LIN-1697 child-shield). The gate is not in CI (`ci.yml:5-6`, deliberate, LIN-3160), so the child-shield kill claim is unverified. | A production edit silently disables a mutant; the "kill" claim for LIN-1697 rests on nothing. Each `find` is a verbatim second copy of a production line, so it rots on every nearby edit (28 commits/90d on the file). Regressed since LIN-3160 brought the gate to clean. | **Minted** |
| 2 | **T-mockcoll** | HIGH | In-memory collection: 56 local `createMockCollection` + 8 `inMemoryCollection`, 41 variants, about 1,990 lines. The shared `tests/fixtures/mock-collection.js` (92 importers) is bypassed; it lacks `$setOnInsert` (22 local copies need it) and `$or` (9 copies). | A change to collection semantics is a 64-file edit; copies can silently diverge from Mongo behaviour and let a bug through. | **Minted** |
| 3 | **T-mirror** | HIGH (small) | `chat-tools.test.js:1221-1233` hand-mirrors `sessionIsTerminal`. The real one is exported (`routes/dashboard.js:263`) and has diverged: it anchors via `findAnchorLoop` and treats `isRowClosed` loops as terminal (through `isTerminalLoop` → `enrichLoop`). | The LIN-1486 tests exercise a stale copy of the decision; a real regression in terminality can pass. | **Minted** |
| 4 | T-http-call | MED-HIGH | Hand-rolled listen→fetch→close helpers, 253 `listen(0` sites in 198 unit files (156 helpers in 141 files, 111 distinct by the research's normalised-body count). Shared `proxy-fake-deps.js` `call()` has 16 importers. | A change to the harness's bind or teardown contract is a 141-file edit. | Recorded; next-batch candidate |
| 5 | T-route-harness | MED | `getHandler` 28 definitions (6 variants); 17 match the exported one at `fixtures/github-install-flow-branches.js:21`; 6 drop the `assert.ok`; `lin-1890-jira-entry-layer:676` takes `route.stack[0]`. `makeRes` 20 definitions (8 variants); no copy implements `set`/`type`/`setHeader`; two conflate `send` and `json`. All depend on Express-private `router.stack`. | An Express upgrade or a route switching `send`↔`json` passes silently. | Recorded; next-batch candidate (cf. LIN-2505) |
| 6 | T-e2e-session | MED | `createSession` (`tests/helpers.js:65`) has 0 callers; 363 direct `/test/set-session` calls in 39 files; provider harnesses are four near-copies whose request shape has drifted; `featuresParam` ×8 is incompatible with the helper of the same name; 6 seed POSTs never check the response. | The documented session seam (CLAUDE.md, LIN-215) is dead; any session-shape change is a many-spec edit. | Recorded |
| 7 | F10 `e2e/proxy.spec.js` | MED | 6 copied token-setup `beforeEach` blocks (4 with a dead readWrite mint, a LIN-3136 paste) and a 403 test pasted ×3. Third edition. | A token-model change is a 6-site edit with dead code at four. | Recorded (3rd edition) |
| 8 | T-dash-router | MED | `dashboard-routes.test.js` writes `createDashboardRoutes({` out 46 times; 40 pass `fetchIssueContext: async () => ({})`, which diverges from `makeRouter`'s In-Progress default. Re-grades 09-26's "clean". | A new required router dependency is 46 edits. | Recorded |
| 9 | T-sd-harness | MED | SD has no unit toolkit (`test/helpers/` used by 7 of 153 files): `loadConfigWith` ×14, Stop-hook harness ×15 (`MODULES` in 4 variants), `stubWorkspaceToken` ×9 (and a `workspaces.json` fake in ~27 files), `RELAY_ENV_KEYS` ×4 and absent from `opencode-runner.test.js` (the cause of **LIN-3234**), `ago` ×13. | A new env key or module is a 14-file edit; the missing key is a live failure. | Recorded; `loadConfigWith` the cleanest candidate |
| 10 | T-stall-deps | MED | SD `stall-failsafe.test.js`: `runStallFailsafe(` called 117 times with inline dependency objects whose defaults are real I/O (the LIN-2274 class). | A new dependency silently reaches the real filesystem in tests. | Recorded; cross-link **LIN-2306** |
| 11 | F-fixture | MED-LOW | `prompt-templates.test.js`: 34 `const issue = {` literals (+4 since 09-26) and still no factory. Further literals in `openrouter.test.js`. Third edition. | A required context field is dozens of edits in a 59-commit/90d file. | Recorded (3rd edition) |
| 12 | T-scan-helpers | LOW-MED | `sliceServerFunction` ×4 with two different end markers; `extractResolveWorkspaceAccessBody` ×4 identical; `stripComments` ×7; `walk` ×23; `tests/unit/lib/import-graph.js` has 3 referencing files (an orphan of cancelled LIN-3201). | Divergent end markers make two scans disagree about the same function. Pins are not re-proposed (LIN-3201). | Recorded |
| 13 | T-swap-residue | LOW-MED | About 150 lines the LIN-3449 child rule forbids: a source-scan guard plus plant tests (`lin-2389-workspace-lookup:101-161`), `lin-3452:64-71`, `loose-json:65-83`, removed-code pins from LIN-3461 (3 files) and absence pins (3 files). | Pin tax: `lin-3124-pr1-count-pins` was edited by 4 children in 2 days. | Recorded; LIN-3449 loop item; cross-link **LIN-3479** |
| 14 | T-ticket-named | LOW-MED (structural) | 175 `tests/unit/lin-NNNN-*` entries (172 match `*.test.js`); undocumented as a convention; 18 production modules are imported only by ticket-named tests. SD has 8 (4 named `lin3431-*` without the hyphen). | Finding a module's tests, or deleting swap-time tests, means searching by ticket number. No renames proposed (cosmetic churn). | Recorded; see §9 |
| 15 | T-shims | LOW-MED | `FakeElement` ×9 (none identical); the `prompt-section` vm harness copied verbatim; 6 tests duplicated between `dispatch-page.spec` and `dispatch.spec`; `opencode-runner` `fakeFs` ×10 (only one has `mkdirSync`, which the runner calls) and `fakeChild` ×11. | A DOM or fs behaviour the code starts to use is missing from most copies. | Recorded |
| 16 | T-vacuous | LOW-MED | `chat-tools:692-700` cannot fail (asserts `length >= 0`); `interactions.spec:254,497` skip on fixture drift; SD `hook-decision:855-869` "→ defer" tests never assert the type; ORD `makeTaskBoundRow` leaves `effect` undefined. | Fixture drift reads as a skip or a pass. | Recorded |
| 17 | T-unrun | LOW | `scripts/eval/jev-progress.test.mjs` and `jev-routing-state.test.mjs` run in no npm script and no workflow; `tests/visual/` has no script or workflow (5 of 7 specs have no `expect`); the two Playwright configs have drifted env. | Tests that never run protect nothing and age silently. | Recorded |
| 18 | T-census-parser | MED | Added by the second-read. `tests/unit/lin-3134-declared-mint-census.test.js` (840 lines, 11 commits since 09-26) carries a hand-written regex JS tokenizer for production source (`maskSource` :208, `matchClose` :238, `enclosingConstruct` :252, `topLevelProp` :263, `scanDispatchCalls` :290, `scanMintSites` :420) and hard-coded lists that are second copies of which production sites mint or declare grants (`MECHANISM_MODULES` :25, `F3_WRITERS` :84, `FOLLOWUP_SITES` :327, `NON_FOLLOWUP_CALLS` :337, `KICKOFF` :454). | Test infrastructure that needs its own correctness proof; every new mint site is an edit to a list that rots (LIN-3384, LIN-3436, LIN-3438 each touched it). Same family, not read closely: `lin-3134-default-path-characterization` (983 lines), `runner-kit-helper` (1,556), `owner-backfill` (1,226). Graded for maintainability only (LIN-3201). | Recorded |

**Clean or verified:** `listen` bind (0 hostless sites; enforced by `test-server-listen-bind.test.js`); no leaked servers; `e2e-smoke` and `hook-decision` (SD); `flight-companion-client` and `observation-ruling-delivery` (well factored in-file); `fixed-overlay-sweep.js`; `test-base.js`; hard-coded urlKeys (LIN-625). The unit suite running twice in CI is deliberate (LIN-1880/2992) and not a finding.

**Coincidental, leave as is** (so nobody re-flags them): `buildApp`, `makeStores`, `makeRouter`, `fakeStore`, `makeReqRes`, `fakeRes`, `fakeProvider`, `makeSandbox`. Each wires a different contract.

---

## 3. Decision rows (Drift & Coherence format)

| Decision | Copies | Variants | Shared home | Loop-ready? |
|--|--:|--:|--|--|
| In-memory Mongo collection | 64 | 41 | exists (`tests/fixtures/mock-collection.js`), bypassed 52× | **Yes**: extend `$setOnInsert`/`$or`, delete copies (minted) |
| Mirror of `sessionIsTerminal` | 1 | 1 (diverged) | exists, exported (`routes/dashboard.js:263`) | **Yes** (minted) |
| SD mutant anchors | 52 | 8 stale | none (verbatim second copy of production lines) | **Yes**: re-point 8 (minted) |
| One-shot HTTP call | 156 | 111 | exists (`proxy-fake-deps.js` `call`), bypassed | Yes, large; next batch |
| Route-handler extraction | 28 + inline walks | 6 | exists (`github-install-flow-branches.js:21`) | Yes; next batch |
| Fake `res` | 20 (+ status recorders) | 8 | none | Needs a home first; after route-harness |
| `createDashboardRoutes` builder (in-file) | 46 | 2+ | `makeRouter` in file | Yes, single file |
| SD `loadConfigWith` | 14 | key list only | none | Yes: cleanest SD candidate |
| SD Stop-hook harness | 15 | 4 module lists | none | Larger; after `loadConfigWith` |
| e2e session/seed | 363 + provider harnesses | several | `helpers.js` (unused) | No: 39 files, needs a settled seam first |
| Source-scan slicing helpers | 4 / 4 / 7 / 23 | 2 end markers | `unit/lib/` | Low value; pins not re-proposed |
| LIN-3449 swap residue | ~150 lines | — | n/a | Yes, as a loop deletion |
| Inline fixture literals (`prompt-templates`) | 34 | — | none | Optional |
| DOM shim `FakeElement` | 9 | 9 | none | Not worth consolidating |

---

## 4. Comparison with `docs/papers/harbour/test-estate.md`

`scripts/survey-tests-shape.mjs` re-run at `ce5d4120` / SD `3dc08b5`. The paper's 30 Sep figures reproduce at `c65b7dd8`; the 9 Oct column is the research's re-run at `2919e08a`.

| LV class (tests) | 30 Sep | 9 Oct (pre-LIN-3449) | HEAD (this run) | Δ since paper |
|--|--:|--:|--:|--:|
| behavioural | 11,600 | 13,972 | **14,303** | +2,703 (+23%) |
| text pin | 490 | 542 | **538** | +48 |
| census | 145 | 213 | **208** | +63 (+43%) |
| source scan | 216 | 292 | **294** | +78 (+36%) |
| e2e | 1,646 | 1,765 | **1,769** | +123 |

SD at `3dc08b5`: behavioural 3,061 (was 2,817), text pin 5 (6), census 0, source scan 1, system 84.

Readings:
1. The pin classes grew between 30 Sep and 9 Oct. Inside the LIN-3449 window they are flat or falling (census −5, text pin −4, source scan +2). LIN-3449's added tests are almost all behavioural.
2. LIN-3201's ruling stands ("the existing count checks stay as they are"). Pins are counted here only for maintainability cost; no conversion is proposed.
3. **Paper fixes verified present** (not re-flagged): LIN-3158 (proxy timer cleared in `.finally`), LIN-3159 (unit flakes), LIN-3198 (`/test/clear-comment-dedupe`, `clickAndAwaitReload`), LIN-3160 (AppleScript test skips with a reason; handoff threshold budget).
4. **One regression since the paper:** the SD mutation gate (finding 1). LIN-3160 brought it to clean; 8 of 52 are stale now.

---

## 5. Re-measurement: drift from the research numbers

| Lead | Research / ticket | Live (`ce5d4120`) | Note |
|--|--:|--:|--|
| unit test entries (`ls tests/unit`) | 807 | 807 entries / 803 `*.test.js` | ticket counts entries |
| `lin-NNNN-*` unit entries | 175 | 175 (172 `lin-[0-9]*.test.js`) | 3 differ in suffix |
| e2e specs | 107 | 107 | same |
| `createMockCollection` definitions | 56 | 56 | same |
| `inMemoryCollection` definitions | 8 | 8 | same |
| fixture importers | 92 | 92 | same |
| local copies needing `$setOnInsert` / `$or` | 22 / 9 | 22 / 9 | same; fixture has 0 of both |
| `getHandler` definition files | 28 | 28 | same |
| `makeRes` definition files | 20 | 20 | same |
| files with `listen(0` | 198 | 198 | same (253 sites) |
| `/test/set-session` occurrences in e2e | 364 in 35 specs | 363 in 39 files | grep scope differs; one fewer |
| `createSession` callers outside `helpers.js` | 0 | 0 | a bare-word grep finds only a comment in `test-base.js` |
| `createDashboardRoutes(` in `dashboard-routes.test.js` | 46 | 46 | same; 40 (not 39) with the empty `fetchIssueContext` |
| `prompt-templates` `const issue = {` | 34 | 34 | same |
| `loadConfigWith` files (SD) | 14 | 14 | same |
| `runStallFailsafe(` calls (SD) | 117 | 117 | same |
| mutants with 0 matching anchors | 8 of 52 | 8 of 52 (#19, #22–#28) | same, reproduced by script (below) |
| `stripComments` / `walk` definitions | 6 / 19 | 7 / 23 | my grep is looser; same class |
| `router.stack` walks | 8 inline | 46 occurrences in 37 files | my grep counts the `getHandler` bodies too |

Sub-board lines and 90-day commits (live): `dashboard-routes` 6,466/54; `prompt-templates` 4,420/59; `flight-companion-client` 4,498/35; `observation-ruling-delivery` 4,332/26; `chat-tools` 3,642/32; `mongo-smoke` 2,104/34; `pipeline-loops` 2,750/21; `e2e/proxy.spec` 3,040/20. SD: `opencode-runner` 4,428/39; `stall-failsafe` 3,871/37; `e2e-smoke` 2,087/6; `hook-decision` 1,361; `run-mutations.js` 28 commits.

**Stale-anchor reproduction.** A read-only script loads the `MUTANTS` array from `run-mutations.js` and counts each `find` in its target file (default dir = SD, `dir: HARBOUR` = this repo):

```
mutants 52 non-unique-or-zero 8
#19 dispatcher.js matches=0 :: the forced kill-first window close is dropped (LIN-559 transcript-collision regression)
#22–#28 reapers.js matches=0 :: findStalledVerifies / findStalledPending / findStalledExecuting / findStalledBootstrap /
        runStallFailsafe (×2 arms) / findExhaustedRefires drop the live-subscribed-child exemption (LIN-1697)
```

**T-mirror spot-read.** The mirror (`chat-tools.test.js:1221-1233`) treats `agentState ∈ {complete,error}` or a mapped `terminalStatus` as terminal and anchors on the first `kind === 'autopilot'` loop. The real `sessionIsTerminal` (`routes/dashboard.js:263`) anchors with `findAnchorLoop(session)` and terminality is `isTerminalLoop(enrichLoop(loop))`, which also counts `isRowClosed`. Note the real `loopIsTerminal` is **not** exported (`isTerminalLoop` is), so the follow-up needs only `sessionIsTerminal`.

---

## 6. Classes and bounds

| Class | Bound (query) | Members at HEAD |
|--|--|--|
| C1 in-memory collection fakes | `(function\|const) (createMockCollection\|inMemoryCollection)` in `tests/unit/*.test.js` | 56 + 8; shared home `tests/fixtures/mock-collection.js` |
| C2 one-shot HTTP helpers | files with `listen(0` and a close | 198 files / 253 sites; research: 156 helpers in 141 files |
| C3 route-handler extraction | `getHandler` definitions + `router.stack` walks | 28 + walks |
| C4 fake response | `makeRes` definitions + hand-rolled `status()` recorders | 20 + about 46–61 (grep-dependent) |
| C5 e2e session/seed | `/test/set-session`, `featuresParam =`, `createSession` | 363 in 39 files; 8 `featuresParam`; 0 `createSession` callers |
| C6 test mirrors of production decisions | comment wording `faithful\|verbatim\|exact (mirror\|copy)`, `mirror of the real`, `copied from` in both repos | `chat-tools:1221` (diverged, importable); `malformed-body:73`; `worker-lane-prompt-ticket-marker-relay:9` (cross-repo, identical today); SD `system-harness-driver-writer:7` |
| C7 source-scan slicing helpers | helper definitions | 4 / 4 / 7 / 23 |
| C8 LIN-3449 swap residue | research items A–E | about 150 lines plus `lin-3487` message re-asserts |
| C9 SD setup copies | definition greps | `loadConfigWith` 14, Stop-hook harness 15, `stubWorkspaceToken` 9, `RELAY_ENV_KEYS` 4, `ago` 13, `fakeFs` 10, `fakeChild` 11, `runStallFailsafe(` 117 |
| C10 SD mutant anchors | script above | 52 mutants, 8 stale |
| C11 in-file router builders | `createDashboardRoutes(` | 46 |
| C12 inline fixture literals | `const issue = {` | `prompt-templates` 34; `openrouter` ≥1 by my grep |
| C13 DOM shims | `FakeElement` | 9; `makeSandbox` in 16 files (distinct, leave) |
| C14 vacuous or weak tests | finding 16 | 4 |
| C15 unrun suites and config | finding 17 | `scripts/eval/jev-*` ×2, `tests/visual` ×7, 2 Playwright configs |
| Ticket-named files | `lin-[0-9]*` | 175 LV entries, 8 SD |

**What could still be missing.** Not examined: run-time cost per file (`survey-tests-timing.mjs` needs an idle machine and is the paper's axis), CI flake history (the flake census and LIN-3198 own it), and the internals of SD `test/system/harness/` beyond adherence. A shared harness that lives in production code (`routes/test.js`, `createTestRoutes`) is the test-only seam owned by LIN-2847 and earlier editions, so it is cross-linked, not re-flagged.

---

## 7. Follow-ups

**Minted (3)**, each a LIN-3449-style child (one decision, one PR, old copies deleted in the same work, no new guard/sweep/census pin), related to LIN-3517 and LIN-3449. Searched first for an existing ticket (mutation gate, `run-mutations`, `createMockCollection`, `mock-collection`, `sessionIsTerminal`): none names the same finding. Nearest, cross-linked and not duplicates: LIN-2596 (missing mutants for `findFastFailCandidates`), LIN-2374 (done; a non-unique anchor aborting the run), LIN-3160 (done; the last clean pass).

- **T-mutants:** **LIN-3518** — re-point the 8 stale anchors (#19, #22–#28) to current source; each mutant still killed by its named killer; no CI step.
- **T-mockcoll:** **LIN-3519** — `tests/fixtures/mock-collection.js` gains `$setOnInsert`/`$or`; every local `createMockCollection`/`inMemoryCollection` copy is deleted in one PR (precedent: LIN-3460).
- **T-mirror:** **LIN-3520** — `chat-tools.test.js` imports `sessionIsTerminal`; the hand mirror is deleted; the LIN-1486 tests stay green or expose a real divergence (then that is the finding).

**Recorded, not minted** (past the cap), sized in rows: T-http-call (156 copies / 111 variants), T-route-harness (28 + 20 copies), T-sd-harness `loadConfigWith` (14 copies), T-swap-residue (about 150 lines, 5 items).

---

## 8. Cross-links (not rivalled)

LIN-3234 (`RELAY_ENV_KEYS` missing in `opencode-runner.test.js`), LIN-2306 (stall-failsafe `locateTranscript` precondition), LIN-2413 (the flaky half is fixed; the message half is open and could be narrowed), LIN-2840 (import-guard SCAN_DIRS), LIN-3479 (export-shape pins), LIN-2505 (moving tests off `router.stack`), LIN-2543 (precedent for consolidating a shared test helper), LIN-2847 (isTestMode class), LIN-2002 (credential-blind e2e fakes), LIN-625 / LIN-821 (e2e parallelism), LIN-3445 / LIN-2274 (vacuous-test class), LIN-3201 (cancelled pin conversion; pins graded for maintainability only).

---

## 9. Open question for John (non-blocking)

Should the LIN-3449 child rule say **"tests go in the home module's own test file, created if missing"**, as LIN-3456 did? That is the cause-level fix for the test growth per swap: today each swap re-derives its caller tests in a new `lin-NNNN-*` file, and 18 modules are tested only by ticket-named files. It changes the loop's process, not code, so it is John's call.

---

## Adversarial Second-Read

**Tier:** 2 (fresh-context sub-agent, read-only, no memory of the report-writing turn; it looked at the test directories first, then read the report).

**Question (verbatim):** "what is the largest item in this window that this report missed or misfiled?"

**Reader's answer (in full, condensed only of file-list repetition):** The largest missed item is `tests/unit/lin-3134-declared-mint-census.test.js` (840 lines): a hand-written regex tokenizer for production JS plus five hard-coded lists that copy production mint/declare sites, edited by 10+ commits in the window; the report folded it into "pins, LIN-3201" and has no finding for the parser-in-a-test complexity class. Three same-family files were not read closely (`lin-3134-default-path-characterization`, `runner-kit-helper`, `owner-backfill`). The largest churn by naive ranking (`lin-3126-proxy-selector`, `lin-3126-residual-forwarding`) was deleted at HEAD (`7b832382`), which the report ignores correctly but does not say. T-mutants is the right top finding (it eyeballed the `reapers.js` anchors); T-mockcoll second; it would rate T-mirror MED rather than HIGH, because the mirror is a deliberate injected double (`chat-tools.test.js:1219-1256`), though the divergence from the real function is real.

**Handling:** I verified the census file's size, helpers and lists (840 lines; the named functions and lists exist at the cited lines; 11 commits since 09-26) and added it as finding 18. T-mirror stays HIGH (small) because the double exists to reproduce the real bug and has diverged from the function it claims to be faithful to; the reader's MED is noted. Not promoted: the cap is full and LIN-3201 constrains the pin class.

Adversarial second-read verdict: AGREE
Differed from top finding: NO
Disposition: fixed in place

