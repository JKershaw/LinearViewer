# Code Quality Review — 2026-10-12 (production edition, periodical run, LIN-3543)

*Review-only: no code, config or secrets changed — the only file this run writes is this report. Severity-ranked complexity / duplication / maintainability findings, weighted by risk × churn, grounded against source at HEAD.*

**Grounding SHAs.** `LinearViewer` @ **`1ef562ce0055034a686ad58a01fd08c87da80d70`** (= `origin/main`) and `simple-dispatcher` @ **`0d54b97458fdbd697f151a7c7d8f0c37848e280f`** (= `origin/main`). Both equal the SHAs the ticket was minted against; `git log --since=2026-10-12T14:30:12Z` is empty in both repos, so no cited path moved between mint and review. Every mint-time lead was nevertheless re-measured at these SHAs, and the loci for the three promoted findings were re-read at source while writing this report (`reapers.js:1680`, `dispatch-factory.js:333`, `prompt-section.js:625`, `routes/dispatch.js:251`, `dispatch-store.js:2327`, `hook.js:1173`, `reapers.js:1877-1884`, `:2503-2508`). Where a mint lead was wrong, the correction is stated (§2, `decideHookActionInner`).

**Predecessors (built on, not re-derived).** `code-quality-review-2026-09-26.md` (LIN-3103, the last production edition) and `code-quality-review-2026-10-12-tests.md` (LIN-3517, test estate only; its follow-ups LIN-3518 Done, LIN-3519 Canceled, LIN-3520 Done). Test-file maintainability appears here only as a delta against LIN-3517; nothing from it is re-flagged.

**Churn method.** `git ls-tree -r --name-only HEAD` → filter → per path `wc -l` × occurrences in `git log --since=90.days --name-only --pretty=format:` (the 09-26 §1 method, one method throughout). **Filter (widened this edition):** `*.js`, `*.css` **plus production `.mjs` under `lib/`**, minus the 09-26 exclusions (`package-lock`, `node_modules/`, `public/*.min.js`, `tests/fixtures/`, `tests/screenshots/`, `prototypes/`, `test-results/`, `content/`, `plans/`, `data/`, `scripts/`). The `.mjs` addition exists because `lib/runner-kit/runner.mjs` (1,104 × 12) and `broker.mjs` (639 × 5) are served to users' machines by `routes/runner-kit.js:27` (mounted `server.js:2972`) with their sha256 pinned in `lib/prompts/runner-kickoff.js`; the 09-26 filter hid them.

---

## 0. Headline

1. **The big units kept growing, and feature work, not drift, is the cause.** About +3,000 lines landed in the large units since 09-26, almost all as new responsibilities added to existing functions (§3). The LIN-3449 consolidation loop created no large function or hub, but it also barely touched the big ones (single-digit deltas). On the complexity axis, LIN-3490's "gets simpler as it goes" **does not hold yet** (§2a).
2. **`simple-dispatcher` was under-graded two editions running; this edition grades it fully.** `reapers.js runStallFailsafe` (950 lines, 145 branch points, 35 commits in 90 days, two open defects inside it, no structural owner) is promoted — it was mandated for promotion by the 09-26 report.
3. **Two LinearViewer units grew fast enough to promote:** the dispatch entrance (`createDispatchItem` 625 → 913, POST dispatch handler 479 → 683) and `public/prompt-section.js init` (390 → 822).
4. **Several owner tickets are stale against the code** (LIN-1249, LIN-2246, LIN-2398, LIN-3112, LIN-1456, LIN-3353/3355). Recorded; updating them is outside this review's remit.
5. **Minted (3, the cap):** LIN-3544, LIN-3545, LIN-3546.

---

## 1. Risk × churn at HEAD — re-measured

### LinearViewer (whole tree incl. tests, as in 09-26 §1; test rows are context only)

| # | file | lines | 90d | risk×churn | 09-26 (lines/90d) |
|---|---|---|---|---|---|
| 1 | `server.js` | 4,582 | 199 | 911,818 | 4,085/143 |
| 2 | `routes/workspace-api.js` | 4,673 | 90 | 420,570 | 4,234/65 |
| 3 | `tests/unit/dashboard-routes.test.js` | 6,466 | 54 | 349,164 | 5,686/47 |
| 4 | `tests/unit/prompt-templates.test.js` | 4,420 | 59 | 260,780 | 4,876/46 |
| 5 | `routes/dashboard.js` | 3,181 | 79 | 251,299 | 2,626/55 |
| 6 | `lib/dispatch-store.js` | 3,041 | 76 | 231,116 | 2,600/58 |
| 7 | `routes/proxy.js` | 1,612 | 136 | 219,232 | 1,591/134 |
| 8 | `public/observation.js` | 4,479 | 42 | 188,118 | 4,614/46 |
| 9 | `public/common.js` | 3,199 | 57 | 182,343 | 2,518/43 |
| 11 | `routes/dispatch.js` | 2,041 | 68 | 138,788 | 1,775/47 |
| 13 | `public/style.css` | 4,372 | 26 | 113,672 | 4,559/39 |
| 15 | `routes/test.js` | 1,914 | 43 | 82,302 | 1,605/37 |
| 16 | `routes/proxy-dispatch.js` | 1,911 | 42 | 80,262 | — |
| 17 | `lib/chat-tools.js` | 2,089 | 35 | 73,115 | 2,219/33 |
| 19 | `lib/openrouter.js` | 1,967 | 34 | 66,878 | — |
| 20 | `public/flight-companion.js` | 2,204 | 30 | 66,120 | 1,843/21 |
| 21 | `lib/prompt-template-defs.js` | 1,233 | 53 | 65,349 | 1,348/40 |
| 22 | `lib/pipeline-loops.js` | 1,868 | 33 | 61,644 | 1,852/30 |
| 25 | `lib/proxy-instructions.js` | 1,163 | 49 | 56,987 | — |
| 29 | `public/prompt-section.js` | 1,467 | 36 | 52,812 | new to the top 30 |

(Unlisted ranks are test files — 10, 12, 14, 18, 23, 24 — covered by LIN-3517.) Rows 1–9 reproduce the ticket's mint-time board exactly.

### simple-dispatcher

| file | lines × 90d | risk×churn |
|---|---|---|
| `reapers.js` | 3,740 × 65 | 243,100 |
| `dispatcher.js` | 2,284 × 66 | 150,744 |
| `hook.js` | 2,189 × 38 | 83,182 |
| `opencode-runner.js` | 1,886 × 42 | 79,212 |
| `config.js` | 1,376 × 35 | 48,160 |
| `terminal-driver.js` | 1,580 × 15 | 23,700 |
| `executors.js` | 780 × 28 | 21,840 |

New SD modules since 09-26 (`duplicate-launch.js`, `shutdown.js`, `signal-guard.js`) are small and clean.

### Scope audit (widened, not shrunk)

- **Added:** `lib/runner-kit/runner.mjs` and `broker.mjs` (above). `runner.mjs:711-972 runCommand` is 262 lines, 119 branch points, depth 8 → joins the long-function class (**recorded-not-promoted**: low churn, 12 commits).
- **Checked, kept off the board:** `scripts/` (nothing in `server.js`/`lib/`/`routes/` imports it; no Procfile/Dockerfile); CI (`.github/workflows/test.yml` 148 lines, `secret-scan-scheduled.yml` 26, `scripts/assert-unit-suite-hermetic.mjs` 206) — below board weight; runtime-loaded prompt docs (content, not code → Documentation / prompt seams); `lib/providers/*` (10,365 lines, 6 commits since 09-26, no change).
- **New production modules since 09-26** (`git diff --diff-filter=A`: 110 lib/routes/public files, 24,161 lines). Every ≥500-line module and ≥200-line function among them is named in this report; the rest (`lib/liveness-detectors.js` 853 / largest fn 139, `lib/task-page-loader.js` 776 / `createTaskPageLoader` 198, `lib/connection-store.js` 738, `lib/library.js` 578) are under the bar.
- **Cross-repo:** no code is copied between the runner kit and SD (duplicate-window scan found no cross-repo pairs). `runner.mjs:200-244 haltAction`/`haltSweep` re-states SD's halt meaning by hand — that is Drift's `runner-contract-semantics-cross-repo` row (LIN-3451).

---

## 2. Findings, severity-ranked

### 2a. What LIN-3449's consolidation did to complexity (the reading LIN-3490 needs)

- **It created no large function or hub.** Its modules are small: `lib/loose-json.js` 60 lines, `dispatch-fields.js` 227 (a declarative table), `dispatch-refusal.js` 88, `dispatch-targets.js` 37, `recommendation-input.js` 36, `dispatch-lineage.js` 268 (largest function 111, moved out of `kpi-stats.js`), `utils/time.js` 26 (fan-in 36, a leaf), `sample-data/` 93/119/276.
- **Net production lines:** batches 1–2 **−329** (LIN-3461 −156, LIN-3114 −95, LIN-3454 −65, LIN-3459 −40); batch 3 **+454**, i.e. **−31** once LIN-3472's +485 test-fixture-to-`lib/sample-data` move is excluded.
- **Callers shrank only marginally:** `routes/proxy.js` −130, `routes/dispatch.js` −39 (LIN-3470); `createWorkspaceApiRoutes` −30 across 6 loop commits; `createDispatchItem` −19.
- **Misattributions to correct:** `connection-credential`/`connection-binding` are LIN-3124 (`9426730f`, 09-29), `chat-request` is LIN-2970, `hourly-cleanup` is LIN-3424 — not loop products.
- **Reading:** consolidation lowered places-per-decision without raising complexity, but the large units moved by single digits while feature work added ~3,000 lines to them over the same window. "Gets simpler as it goes" is not yet true on the complexity axis. This is a measured observation, not a finding against the loop.

### F-sd-stall · **HIGH** · disposition: **MINT → LIN-3544**

- **Locus.** `simple-dispatcher/reapers.js:1680-2629 runStallFailsafe`: **950 lines** (930 on 09-26), **145 branch points, depth 7**, ~440 code lines + ~500 comment lines, **35 commits in 90 days** (6 since 09-26: LIN-3135, 3208, 3199, 3270, 3355, 3431).
- **Second site / delta.** Grew 454 (08-29) → 930 (09-26) → 950. Twin: the reaper's opencode resume arms (`:2349-2394`) re-create `resumeSession`'s `directExecuting` transition (`dispatcher.js:279-330`) "by mirroring" — and clear a **different field set** (`resumeSession` also deletes `awaitingVerify`, `bootstrapRefireCount`, `pendingExternalRefireCount`; the reaper arms do not). Local repetition inside `reapers.js`: the "post to item" block (`meta?.itemId && meta?.workspaceKey → token → pending.push`) 7×, the hold-field clear (`delete holdingSince/holdKind/pendingFollowUp`) 6×.
- **Structure.** 17 injected deps → transcript heal under `updateState` → four memoised readers → seven selector passes + union → terminal-health memo (`:1877-1884`) → `isCandidateHeld`/`armBrokerForRefire` → a nine-arm async decision loop (`:1927-2291`) → an eight-arm apply-under-lock (`:2304-2568`, `refire` has four sub-arms plus a FAILED catch-all) → six log loops → feedback POST with retry budget.
- **Maintainability cost.** Two open defects sit inside it and cannot be fixed safely in place: **LIN-2470** (still real: the terminal-health memo at `:1877-1884` has no shape guard; sibling `dispatcher.js:1787-1792` throws on `!health || typeof health.healthy !== 'boolean'`) and **LIN-2568** (generic `else` arm at `:2503-2508`; the only re-validation under the lock is phase equality at `:2315`, and an opencode `directExecuting` resume is EXECUTING→EXECUTING; reachability at HEAD is **unproven** — the opencode divert `:2216-2237` and the transcript gate may keep opencode out of `refire` plans — so it needs a failing race test first). Every stall-recovery feature (35 commits) edits one 950-line function with 8 apply arms sharing mutable `session` fields.
- **Why this is decomposable.** `reapers.js` already follows plan→apply: pure `find*` selectors (`:390`, `:844-1256`), pure predicates (`refireYieldedNothing` `:908`, `pendingExternalExhausted` `:921`, `failsafeChildShield` `:1092`), pure message builders, effectful launchers with injected deps (`:1487`, `:1602`); `runFastFailWatchdog` (`:669`) is the small template. Natural seams: (a) `makeStallReaders`, (b) `gatherStallCandidates`, (c) pure intent classifier + effect executor for the loop, (d) **`applyStallPlan`** as a per-action table (already pure field writes except `getWorkspaceToken` — the cleanest first cut), (e) `formatStallOutcome`.
- **Owner search (re-run before minting).** `runStallFailsafe`, `stall failsafe`, `reapers.js`: only behavioural/observability tickets (LIN-1906, 1705, 1722, 958, 2568, 2470, 3355). No structural owner. **Sequencing:** LIN-3353/3355 code is already merged (#265 `f34cf15`, #266 `954a164`, 10-08; LIN-3431 #267 10-09; `origin/feat/lin-3355-*` has no commits off main; open SD PRs #199/#112 don't touch `reapers.js`), so nothing collides today; the Linear state of LIN-3353/3355 (In Progress) looks stale or awaiting a witness — recorded only.
- **Siblings (same reasoning, recorded-not-promoted, all grew, none owned):** `dispatcher.js:676-1468 processPolledItem` 793 (was 744; 9 commits incl. a revert pair), `opencode-runner.js:1076-1843 runOpenCode` 768 (was 677; 156 branches, depth 8; internal duplicate FAILED-commit block `:1710-1737` ↔ `:1815-1830`, 8 windows), `hook.js:1572-2179 main` 608 (was 577), `dispatcher.js:1580-2079 runOnce` 500 (flat), `hook.js:1173-1535 decideHookActionInner` 363, `opencode-runner.js:803-1020 holdForOpenCodeFollowUp` 218, `reapers.js:176-377 runHeartbeats` 202. Resume-launch options are assembled separately at `dispatcher.js:1028` and `reapers.js:1634`. No cross-file literal duplicate pairs among reapers/dispatcher/hook. They wait one cycle behind F-sd-stall; the next edition should promote by risk × churn.
- **Correction to the mint lead.** `decideHookActionInner` was **not** decomposed: it is 363 lines at `hook.js:1173-1535`; the lead's "8" was the 3-line wrapper `decideHookAction` (`:1560`). It shrank 16 lines only via LIN-3199's SUMMARIZING removal (`1deb625`).

### F-dispatch-entrance · **HIGH** · disposition: **MINT → LIN-3545**

- **Locus.** `lib/dispatch-factory.js:333-1245 createDispatchItem`: **625 → 913 lines** (+288 in 17 days: LIN-3200 +113 file-pointer prompt block, LIN-3238 +80 run/hourly gate, LIN-3245 +58 stopAt close-out refusal, LIN-3126 +35 binding inheritance, LIN-3138 +25), ~171 branch points.
- **Second site / delta.** Entrances: `routes/dispatch.js:251-933` POST dispatch **479 → 683 (+43%, 27 commits)**; `routes/proxy-dispatch.js:698-1450` recommend-and-dispatch 690 → 753 (24 commits); `:228-659` `/api/proxy/dispatch` 404 → 432 (20 commits); `routes/proxy-kickoff.js:126-576` kickoff 401 → 451.
- **Maintainability cost.** This is the dispatch critical path, and each new run feature edits a 913-line function and up to four 400–700-line closure handlers; an arm missed in one entrance silently diverges. Owners are behavioural only (LIN-1760 "refusal codes branched at only 5 of 9 call sites", LIN-3481, LIN-2160).
- **Seam.** Drift rows `dispatch-entrance-field-duplication` (`dispatch-factory.js:644`) and `close-out-merged-refusal-split` (`:739`) sit inside this unit: the multiplicity is Drift's (LIN-3449); the 913-line size/branching is this review's.

### F-go-ladder · **MED-HIGH** · disposition: **MINT → LIN-3546**

- **Locus.** `public/prompt-section.js:625-1446 init`: **390 → 822 lines (+111%)** — LIN-3341 "Go is one press" +205, LIN-2944 +132, LIN-2942 +42, LIN-3267 +31. File now 1,467 × 36.
- **Cost.** One closure holds the Go ladder, take-modes, run-quota refresh and prompt panel with shared mutable state; LIN-3512 (stale run-quota across two mounts) is the class of defect that shape produces. No owner (searched `prompt-section`, `Go ladder`).

### F-dispatch-store · **MED↑** · disposition: **cross-link LIN-2398**

- `lib/dispatch-store.js:2327-2725 addFeedback`: **286 → 399 lines, branch points 36 → 58** (LIN-3139 +39 declared wake, LIN-3257 +32 wake-shadow classifier, LIN-3365 +27 and LIN-3130 +15 handover/lineage closers). The file grew 2,600 → 3,041 and 33 → 42 methods, yet **everything else in it is healthy** (`addItem` 176 → 118, `_formatItem` 116 → 60, all new methods < 50 lines). **LIN-2398's title ("2,178 lines, addFeedback 288") is stale — the growth outran the ticket.** Not minted: an owner exists.

### F-credential-ladder · **MED** · disposition: **cross-link LIN-1249 + LIN-2150**

- `server.js` auth trio grew **+133 lines**, entirely LIN-3124 plus LIN-3323/3335/3241: `ensureValidToken` `:1104-1376` 236 → 273, `handleUnauthorizedError` `:1788-2044` 208 → 257, `resolveWorkspaceAccess` `:2558-2805` 201 → 248. Same cluster: `createConnectionAccess` `lib/connection-credential.js:523-978` 456 (new; peaked at 498), `createJiraAuthRoutes` `routes/jira-auth.js:122-996` 679 → 875, `createGitHubInstallFlowRoutes` `lib/github-install-flow.js:166-1041` 570 → 876 (LIN-3125 +99, 2882 +84, 3382 +47, 3124 +36; `linkPath` handler 263 → 372).
- **Seam.** Multiplicity (Drift `credential-decision-multiplicity`, LIN-2150; loci `server.js:1260` inside `ensureValidToken`, `connection-credential.js:843-857`) is theirs; size and branching are ours. **Not minted:** decision consolidation should land first or decomposition just moves branches around.
- `server.js` itself: 4,085 → 4,582, 88 non-merge commits since 09-26 (+765/−268), 32 inline routes (unchanged), `app.use` mounts 28 → 38, imports 131 → 172, no new ≥100-line unit. **LIN-1249's title ("2542-line app-entry: 29 routes + 17 helpers") is stale** (today 4,582 lines, 32 routes, 29 helpers, 38 mounts).

### F-dashboard-run-page · **MED** · disposition: **cross-link LIN-3349**

- `routes/dashboard.js` 2,626 → 3,181; the closure `createDashboardRoutes` (`:610-3148`) 2,099 → 2,539 (+440: LIN-3251 +155, LIN-3254 +105, 3247, 3248, 3242). **The 08-29 F6 deferral's premise has failed**: the growth is a new sub-domain (the run page, ~620 lines: handlers `:1275-1608`, helpers `:1631-1934`), and LIN-3311 (lifted 107 lines to `lib/pr-state-store.js`) proved a lift works. An owner exists — **LIN-3349 "Rebuild the run page properly"** (Backlog, deferred post-V1) — so cross-link, don't mint. Input for that rebuild: nine closure-free helpers movable to module level today (`buildSessionPayload` `:807-994` 188 lines, `rollupDescendantActivity` `:1222`, `readRunExternal` `:1711`, `readRunFacts` `:1752`, `sessionActivityMs` `:775`, `recentRunKind` `:787`, `parseWindowDays` `:2514`, `parseTargetPerDay` `:2519`, `projectNeighbor` `:3096`).

### F-workspace-api · **MED** · disposition: **cross-link LIN-2246**

- `routes/workspace-api.js` 4,234 → 4,673; `createWorkspaceApiRoutes` `:310-4673` 3,914 → 4,364 (+450: LIN-3248 +278 close-out route, LIN-3126, 3240, 3293). LIN-2246's title (4,388 lines) is stale. Inline handlers: recommend stream `:1025-1373` 373 → 349, comments `:1465-1764` 266 → 300.

- **Why this is not minted (made explicit after the second read).** By size and risk × churn, `createWorkspaceApiRoutes` (4,364 lines, 450 added this window, 4,673 × 90 = 420,570) and `server.js` (4,582 × 199 = 911,818, rank 1) outweigh `runStallFailsafe` as *units of file*. They are not minted because each already has a structural owner (LIN-2246 Todo, LIN-1249 Backlog) whose scope covers the decomposition, whereas the SD function has none; minting a duplicate would split ownership. The owners' stale titles and the growth outrunning them are the finding. The next edition should check whether LIN-2246/LIN-1249 have moved; if they have not by then, the growth rate (+450 and +497 lines in 17 days) is itself grounds to re-open the promotion question. `server.js` has no single unit ≥ 280 lines: its cost is the sheer count (32 inline routes, 29 helpers, 38 mounts, 172 imports), not a function.

### F-handler-class · **MED** · disposition: **cross-link (LIN-2246 / LIN-1760) + class recorded**

Inline route-handler class (≥300 lines inside closures; scanner reproduces the 09-26 figures exactly at `b5c528c4`, so comparisons are like-for-like) — **10 members**:

| handler | 09-26 → HEAD |
|---|---|
| `POST /api/proxy/recommend-and-dispatch` `routes/proxy-dispatch.js:698-1450` | 690 → 753 |
| `POST /workspace/:urlKey/api/dispatch` `routes/dispatch.js:251-933` | 479 → 683 |
| `POST /api/proxy/autopilot/kickoff` `routes/proxy-kickoff.js:126-576` | 401 → 451 |
| `POST /api/proxy/dispatch` `routes/proxy-dispatch.js:228-659` | 404 → 432 |
| `GET /auth/callback` `routes/auth.js:106-498` | 334 → 393 |
| `POST linkPath` `lib/github-install-flow.js:667-1038` | 263 → 372 |
| recommend stream `routes/workspace-api.js:1025-1373` | 373 → 349 |
| `POST task-chat` `routes/task-chat.js:387-704` | 242 → 318 |
| `POST start` `routes/collective.js:153-463` | 295 → 311 |
| `POST comments` `routes/workspace-api.js:1465-1764` | 266 → 300 |

All but two grew. The dispatch four are covered by LIN-3545; the others sit in files with owners. No inline handler in `server.js` reaches 250 lines.

---

## 3. Class dispositions

### 3a. Long-function class — ≥200-line named functions (brace-matching scanner, regex/string/template-aware)

**LinearViewer production: 65 members** (63 on 09-26, same bound). **simple-dispatcher: 8 members.** Members above the cluster level, 09-26 → HEAD:

| unit | lines | disposition |
|---|---|---|
| `createWorkspaceApiRoutes` `routes/workspace-api.js:310` | 3,914 → 4,364 | cross-link LIN-2246 |
| `createDashboardRoutes` `routes/dashboard.js:610` | 2,099 → 2,539 | cross-link LIN-3349 |
| `createDispatchRoutes` `routes/dispatch.js:159` | 1,595 → 1,883 | LIN-3545 |
| `createTestRoutes` `routes/test.js:62` | 1,553 → 1,853 | recorded (test-mode route factory; mock decision is LIN-2847's class) |
| `createDispatchRoutes` `routes/proxy-dispatch.js:186` | 1,580 → 1,726 | LIN-3545 |
| `createComputeRoutes` `routes/proxy-compute.js:67` | 1,524 → 1,531 | recorded, flat |
| `buildInstructions` `lib/proxy-instructions.js:36` | 1,128 | recorded (documentation text; Documentation seam) |
| `createProxyRoutes` `routes/proxy.js:487` / `createProxyWriteRoutes` | 1,123 → 1,126 / 990 → 1,005 | recorded, flat |
| `createDispatchItem` `lib/dispatch-factory.js:333` | 625 → 913 | **LIN-3545** |
| `createGitHubInstallFlowRoutes` / `createJiraAuthRoutes` | 570 → 876 / 679 → 875 | cross-link LIN-1249/2150 |
| `init` `public/prompt-section.js:625` | 390 → 822 | **LIN-3546** |
| `createConnectionAccess` `lib/connection-credential.js:523` | new, 456 | cross-link LIN-2150 |
| `createEmailAuthRoutes` `routes/email-auth.js:121` | new, 508 | recorded-not-promoted (new, low churn) |
| `addFeedback` `lib/dispatch-store.js:2327` | 286 → 399 | cross-link LIN-2398 |
| `createHeldConnectionRoutes` `routes/held-connection.js:114` | new, 338 | recorded |
| `createTokensAdminRoutes` | 207 → 336 | recorded |
| `createRejectedCredentialRegistry` | 195 → 282 | recorded (LIN-3186) |
| `createTaskShareRoutes` | new, 248 | recorded |
| `ensureValidToken` / `handleUnauthorizedError` / `resolveWorkspaceAccess` (`server.js`) | 273 / 257 / 248 | cross-link LIN-1249/2150 |
| `deliverRulingReply` `public/observation.js:3127-3424` | **365 → 298 (shrank)** | see §4 (LIN-3112) |
| `runCommand` `lib/runner-kit/runner.mjs:711-972` | 262, 119 branches, depth 8 | recorded (new scope) |

SD's 8 members: `runStallFailsafe` 950 (**LIN-3544**), `processPolledItem` 793, `runOpenCode` 768, `main` 608, `runOnce` 500, `decideHookActionInner` 363, `holdForOpenCodeFollowUp` 218, `runHeartbeats` 202 (siblings recorded-not-promoted, F-sd-stall). The remaining LinearViewer members below ~250 lines are un-named here; they are reproducible from the stated scanner and none is a finding by itself (no growth above noise, no churn).

### 3b. Duplicate-window pairs (normalised 8-line windows, ≥5 shared windows, non-test production `.js`)

The 09-26 list of 17 **cannot be reproduced like-for-like**: that scanner kept JSDoc and punctuation lines. This report therefore publishes both variants rather than comparing across methods.

- **Strict method (6 pairs):** the mock-builder trio (49 / 22 / 20 windows), `render-settings` ↔ `common.js` 8 (LIN-2071), `llm-call-log` ↔ `proxy-events` 5, `report-history` ↔ `ship-biscuit-history` 5. Gone since 09-26: the two loose-JSON pairs (LIN-3114) and github-projects ↔ github (LIN-3125 `completeAppInstallation`).
- **Loose method (adds):** `public/close-out.js:73-148` ↔ `public/session.js:756-850` (`applyCloseOutState`, `pressCloseOut`; 11) — deliberate per LIN-3340 (`1fefed45`), whose header says "left for LIN-3349" → **cross-link LIN-3349**; `session.js` ↔ `task-page.js` 6 (`formatElapsed` ×2, `session.js:544`, `task-page.js:184`, inside Drift's `server-formatter-duplication` row). The loose variant also recovers `dispatch-tokens` ↔ `proxy-tokens` (50 → 33) and `llm-call-log` ↔ `prompt-trace-store` (20 → 7).

### 3c. Mock-fixture builders (F-mockbuilders) — **recorded-not-promoted**
Unchanged byte-for-byte, zero churn: `routes/proxy-compute.js:110-219`, `routes/workspace-api.js:2323-2425`, `routes/task-chat.js:58-93`. Risk × churn too low to promote.

### 3d. `clear(urlKey)` store family (F-store) — **recorded-not-promoted**
**17 → 20** members (19 async, 1 sync). New: `close-out-events-store.js:330` (LIN-3248), `run-proposals-store.js:194` (LIN-3254), `task-mode-store.js:340` (LIN-2942). Still no store base; the family is growing by about one a fortnight but each member is tiny. Drift overlap; owner class LIN-2847 (Backlog).

### 3e. Dispatch-validation pair — **downgraded to LOW, recorded**
`routes/dispatch.js:254-504` ↔ `routes/proxy-dispatch.js:233-347`: 38 exact code-line matches (33 on 09-26 like-for-like; the 09-26 "87" was a wider-span count). The rules are shared now (`lib/dispatch-validation.js`, `lib/dispatch-fields.js` `RUN_FIELD_RULES`/`validateRunField`; LIN-3486/3487/3467); only the call sequence is twinned (mostly `const xMsg = helper(); if (xMsg) return …`), plus the prompt-required check still written inline twice. Folded into LIN-3545's scope; adjacent LIN-1760.

### 3f. Client-module and stylesheet class
- `public/swim.js` connector near-twin: byte-identical file, zero commits, 185 of 260 code lines shared → **recorded-not-promoted**.
- **Stylesheet structure** (stays here by standing arrangement): `public/style.css:4239-4350` and `public/swipe.css:1356-1467` are **byte-identical, 112 lines / 25 rules** (LIN-522, 06-16) and both load on the same pages (`lib/render.js:278`, `lib/render-swipe.js:686`); `audit.css` and `settings.css` share 13 identical rules; `swim.css:835-836` can never match (`swim.js:1014` puts `data-segment` on the label and `.swim-fband` is never rendered). All **recorded-not-promoted** (stable, cheap, no churn). **Dead selectors: 13 verified by hand; this is a heuristic bound** (class token absent from JS/render/route sources, dynamic prefixes filtered out).
- **Dead exports (heuristic; static imports only; LOW):** fully dead `lib/prompt-templates.js:321,341,386`, `lib/harbour-spawn.js:42`, 4 alias re-exports, 2 collection-name constants; test-only 43, including `lib/completion-signals.js:229-326` (6 functions, ~95 lines) and 8 roadmap "backward-compatible" wrappers. `lib/render-run-evidence.js:250 renderRunEvidence` has a JSDoc that says it is "the one call the session page mounts", but both mounts import the parts directly (misleading rationale → Comprehension-Debt seam).

---

## 4. Re-verified prior follow-ups and carried items (live state at review time)

| item | live state | verdict |
|---|---|---|
| **LIN-3114** (F-json) | Done 10-11 | **Verified.** `lib/loose-json.js` (`stripCodeFence` `:24`, `extractJsonObject` `:42`); all 7 sites plus `lib/run-paragraph.js:187` call it; no residual copy in lib/routes/server/public; LIN-1674 has not landed, so no new copy exists. HEAD `1ef562ce` (LIN-3523) deliberately removed the anti-regrowth census from `tests/unit/loose-json.test.js` under LIN-3449's child rule — recorded, not a finding. |
| **LIN-3112** (F-obs) | Backlog | **Premise partly stale.** `deliverRulingReply` `public/observation.js:3127-3424` shrank 365 → 298 through LIN-3252 (`607d0c18`, `49c17038`, 10-02), which moved effect routing into `common.js` `ReplyDelivery`; no commit cites LIN-3112. The 298-line remainder still holds the partial-failure/retry path LIN-2784 sits in. Record only; re-scoping is outside remit. |
| **LIN-3113** (F-gate) | Backlog | Unchanged: `lib/periodical-report-gate.js:117-119` untouched since LIN-2323, its three predicates still unanchored. |
| LIN-2470 / LIN-2568 | Backlog | Both inside F-sd-stall (§2); LIN-2470 verified real, LIN-2568 reachability unproven. |
| LIN-3353 / LIN-3355 | In Progress | Code merged (#265/#266/#267); state looks stale. Record only. |
| LIN-1249 / LIN-2246 / LIN-2398 | Backlog / Todo / Backlog | Titles stale vs code (§2). Growth outran each. Record only. |
| LIN-2847 / LIN-2071 | Backlog | Class owners, unchanged. |
| LIN-3016 | Backlog | Copy still at `routes/proxy-dispatch.js:65`, mapping `:120-136`; canonical formatter moved to `lib/dispatch-feedback-format.js:20` (LIN-2388) and the copy was not switched. They have **drifted** (`timestamp: f.timestamp \|\| null` vs `f.timestamp?.toISOString?.() \|\| f.timestamp`); 6 commits edited the copy without consolidating. Owner stands; premise stronger. |
| LIN-1456 | Backlog | **Stale**: "simple-dispatcher has no CI" — `simple-dispatcher/.github/workflows/ci.yml` (LIN-1580, 07-25) runs `npm ci && npm test` on PRs and main. Record only. |
| LIN-1760 | Backlog | Adjacent to LIN-3545 (refusal codes branched at only 5 of 9 sites); behavioural. |
| LIN-3349 | Backlog | Owner for the run page / `close-out.js` ↔ `session.js` (§2, §3b). |
| LIN-3517 / 3518 / 3519 / 3520 | Done / Done / Canceled / Done | Test review not re-run; no material delta found. |

---

## 5. Clean results

- **`public/common.js` — clean (re-graded from scratch).** +681 lines / 31 commits is the LIN-3252 `ReplyDelivery` consolidation, decomposed: `:882-1375` ~495 lines in 14 functions, largest `deliverReply` 76; `deliverRulingRecord` `:1223`, `deliverRulingDispatch` `:1271`, `deliverRulingAnswer` `:1349`. `ProxyToggle` `:1936-2308` is 373 lines (mint, driver copy, runner bootstrap). No new ≥100-line function; ~14 client↔server mirrors, the new ones parity-tested (`tests/unit/task-page-href.test.js:22`). **Recorded note only:** two subsystems with their own consumers live in a 3,199-line file every page loads; the obvious seam is `public/proxy-toggle.js` and `public/reply-delivery.js`. Not promoted.
- **`lib/dispatch-store.js` except `addFeedback`** — clean (§2).
- **LIN-3449 modules** (`loose-json`, `dispatch-fields`, `dispatch-refusal`, `dispatch-targets`, `recommendation-input`, `dispatch-lineage`, `utils/time`, `sample-data/`) — clean, small, single-purpose.
- **`lib/providers/*`** — clean (no change in 6 commits).

---

## 6. Follow-ups minted

At the cap of 3, highest-severity unowned only, after search-before-mint (re-run immediately before minting). Each is in team `LIN`, default state, `related` to LIN-3543 and its cross-links.

| ticket | finding | related | sequencing |
|---|---|---|---|
| **LIN-3544** — Decompose `reapers.js runStallFailsafe` | F-sd-stall | LIN-3543, LIN-3103, LIN-2470, LIN-2568 | LIN-2470 first, LIN-2568 test-first, then `applyStallPlan`, readers/selectors, loop split; fold in the resume-arm field-clear twin |
| **LIN-3545** — Decompose `createDispatchItem` + dispatch entrance handlers | F-dispatch-entrance | LIN-3543, LIN-1760, LIN-3481, LIN-3451 | characterization tests first; sequence against LIN-1760/3481; multiplicity stays Drift's |
| **LIN-3546** — Decompose `public/prompt-section.js init` | F-go-ladder | LIN-3543, LIN-3512 | characterization coverage first; no UI change |

Search-before-mint: structural owners searched for `runStallFailsafe`, `stall failsafe`, `reapers.js`, `processPolledItem`, `runOpenCode`, `hook.js`, `runOnce`, `createDispatchItem`, `dispatch-factory`, `routes/dispatch.js`, `dispatch entrance`, `prompt-section`, `Go ladder`, `createDashboardRoutes`, `ProxyToggle`, `swipe.css`, `github-install-flow`, `jira-auth` — only behavioural tickets returned; the single structural exception is LIN-3349 (run page), cross-linked instead of minted.

---

## 7. Deliberately not re-flagged — owned by a sibling review

- **Cross-cutting decision duplication / places-per-decision** → **Drift & Coherence** (LIN-3449): `runner-contract-semantics-cross-repo` (LIN-3451), `credential-decision-multiplicity` (LIN-2150), `human-wait-derivation-split`, `close-out-merged-refusal-split`, `dispatch-entrance-field-duplication`, `server-formatter-duplication`. Where complexity sits inside a Drift locus, the complexity is this report's and the multiplicity is Drift's (stated per finding).
- **Test estate** → LIN-3517 (not re-run). **Test adequacy** → Test Coverage Gap. **Interface/contract shape** → API Quality. **Rendered UI** → Design & Interface (stylesheet structure stays here). **Missing rationale** → Comprehension-Debt (`renderRunEvidence` JSDoc noted). **Performance** → Performance/Scale. **Convergence** → Stability. **Docs accuracy** → Documentation (`buildInstructions` is treated here only as code bulk).

---

## 8. Method notes and limits

- **Queries.** Board: `git ls-tree` → filter → `wc -l` × 90-day path count. Long functions: brace-matching span scan, ≥200 lines, named only. Duplicates: normalised 8-line windows, ≥5 shared, non-test `.js`. Growth attribution: `git log -L` on function bodies. Ticket state: live workspace API.
- **Heuristic, not exact:** dead CSS selectors (13 verified by hand) and dead exports (static imports only; dynamic usage can hide a use). The two duplicate variants (§3b) are not comparable to the 09-26 list.
- **Spans are scan-derived.** Branch-point and depth figures come from the scanner; line spans for the promoted findings were re-read at their first lines at HEAD. This report lists the 24 largest/most-changed long-function members by name (§3a); the other members of the 65 are scanner output not itemised here.
- **What would make the set wrong:** (1) a production surface outside the `*.js`/`*.css`/`lib/**/*.mjs` filter and the import graph from `server.js` (checked: `routes/runner-kit.js`, `readFileSync` of docs); (2) a mis-spanned unit (the scanner reproduces 09-26's handler figures exactly at `b5c528c4`); (3) production data, out of remit.
- **The bar applied.** A finding names (i) a `file:line` at HEAD, (ii) a second site or measured delta, (iii) a concrete maintainability cost. Rejected by construction: renames, reformatting, "this file is big", any metric that moves without removing a decision point.

---

## Adversarial Second-Read

**Tier:** Tier 2 — a fresh-context sub-agent with no memory of the report-writing turn (it was given the report path, both repos and the question, and no ticket or research comments).

**Question:** What is the largest item in this window that this report missed or misfiled?

**Answer (reader's, in full):** The report under-weights `routes/workspace-api.js:310-4673`, where `createWorkspaceApiRoutes` is one 4,364-line closure, about 4.6× `runStallFailsafe`, in the file with the second-highest risk × churn (reader's measure 4,673 × 93 = 434k, against `reapers.js` ≈ 247k). The report gives it a single line, "cross-link LIN-2246", and no finding; the closure grew by 450 lines this window, ~40% more than the 288-line growth of `createDispatchItem`, which is promoted. It was deferred because an owner ticket exists, not because it measured smaller. Secondarily, `server.js` (rank 1, 4,582 lines, 199 non-merge commits ≈ 1.0M) has no finding of its own: F-credential-ladder covers only the auth trio (~780 lines) and says "no new ≥100-line unit"; the reader flags this as a judgement call with weak per-function evidence. The reader partly disagrees: F-sd-stall is the largest unowned single function and promoting it is defensible, but it is not the largest item by risk × churn or size. Spot-checks: all of `reapers.js:1680-2629` (950), `dispatch-factory.js:333-1245` (913), `prompt-section.js:625-1446` (822), `hook.js:1173-1535` (363), `routes/dispatch.js:251-933` (683) and the `workspace-api.js`/`server.js` sizes were confirmed; no wrong claim found (reapers 90-day count read 66 by the reader against the report's 65, a counting-method difference of one). Not verified by the reader: the 35-commit count, growth history, branch-point counts, `common.js` clean grade.

**Resolution:** the report was amended in place (F-workspace-api now states why the two bigger files are cross-linked rather than minted, and that `server.js`'s cost is count, not a function). The mint set is unchanged: both files already have structural owners (LIN-2246, LIN-1249), the SD function has none, and the mint cap is 3.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
