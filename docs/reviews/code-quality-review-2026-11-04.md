# Code Quality Review — 2026-11-04 (periodical run, delta vs 2026-10-20, LIN-4207)

*Review-only: no code, config, guide or doc changed. The only files this run writes are this report and `_evidence-2026-11-04/cq-*`. Complexity, duplication and maintainability findings for Harbour and Simple Dispatcher, ranked by severity, weighted by risk × churn, grounded at HEAD. Every finding is a delta against the 2026-10-20 run.*

**Grounding SHAs.**
- `LinearViewer` (Harbour) measured at **`5334c81a`** (= `origin/main` at measurement), baseline **`9b2955cc`** (the 10-20 HEAD). 261 commits in the window, 244 first-parent.
- `simple-dispatcher` (SD) measured at **`67ff5c3b`** (= `origin/main`), baseline **`bb1da78e`** (the 10-20 HEAD). 35 commits in the window.

**Predecessor.** `code-quality-review-2026-10-20.md` (LIN-3740). Its stable finding names are carried as ledger rows in §8. Series: `code-quality-review-2026-06-25`, `-08-23`, `-08-29`, `-09-26`, `-10-12`, `-10-12-tests`, `-10-20`, now `-11-04`.

**Method (the repo's committed kit only).** `scripts/code-shape/shape.mjs --functions` with the 10-20 include regex `^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)` for Harbour, and `--areas` pointing at `{"areas":[]}` with the default include for SD. The area guide is the HEAD `areas.json` (copied to `_evidence-2026-11-04/areas-guide-head-5334c81a.json`) for every Harbour run. Area maps do not change totals, so this only affects area rollups. The calibration came first: at `9b2955cc` and `bb1da78e` the kit reproduces the 10-20 totals exactly (§4, C1–C3). Figures are read from the kit's JSON (`cq-class-counts.json`, `cq-top-units-*.json`). Nothing new was added to the repo's tooling.

---

## 0. Headline

1. **Did simplification keep up with feature growth? No, not in the production slice.** Over 163 production-touching commits, net decision points (DP) rose **+4,172** (28,252 → 32,424) and code lines **+9,856**. Feature commits (133, by subject) added **+3,893 DP**. Retirements (4 commits) removed **−430 DP**. Relocations (26 commits, by subject) moved **+709 DP** net, and 11 of those are pure moves at exactly 0 DP. The big falls in the top-unit table are relocations or removals, not simplifications (§1).
2. **Top finding: `public/prompt-section.js` (HIGH, worsened).** The file's inclusive DP went **338 → 954** and its span **1,468 → 2,856**. The `init` closure is now 1,994 lines with 131 nested functions over one shared `state`. It is the largest unit in either repo and the second-highest weight in the table (61 commits in 90 days). The owner (LIN-3546) is Backlog, unstarted, and its title is stale. §3, §6.
3. **Second: SD's `reapers.js runStallFailsafe` (HIGH, worsened).** Inclusive DP 162 → 177, span 950 → 993, own cyc 99 → 108, in the highest-weight SD file (58 commits in 90 days). Owner LIN-3544, Backlog, unstarted.
4. **New HIGH row: `lib/dispatch-store.js addFeedback` (new in this run).** The file's DP went 385 → 561 and `addFeedback` now spans 448 lines with 67 decision points, carrying three decisions (wake provisioning, grant refusal, ownership). The file has 74 commits in 90 days. Owner LIN-2398 is Backlog, and its title is stale.
5. **The router split premise has changed.** `createDashboardRoutes` (span 2,533 → 621) and `createWorkspaceApiRoutes` (span 2,950 → 706) were split into sub-routers. The decision points were **relocated, not removed** (dashboard family 551 → 492; workspace-api family 739 → 755). F-dashboard and F-workspace-api are retired into a relocated-residue row, F-subrouter-residue (§3).
6. **Mints: zero.** Every top row already has an open owner. The one owner-shape change worth making is for F-prompt-section, and it is a comment on LIN-3546, not a duplicate ticket (§6).

---

## 1. What moved since 2026-10-20 (measured)

### 1a. Class bounds (calibrated first; see §4)

| class | LinearViewer `9b2955cc` (10-20 HEAD) | LinearViewer `5334c81a` | SD `bb1da78e` | SD `67ff5c3b` |
|---|---|---|---|---|
| files | 459 | **536** (+83 born, −6 gone) | 55 | **63** |
| code lines | 97,121 | **106,977** (+9,856) | 13,159 | **14,456** (+1,297) |
| decision points (DP) | 28,252 | **32,424** (+4,172) | 4,970 | **5,451** (+481) |
| units over cyc 10 | 752 | **856** | 139 | **152** |
| functions span ≥ 200 | 90 | **108** | 9 | 9 |
| functions cyc ≥ 50 | 10 | **11** | 11 | 11 |
| functions cyc ≥ 30 | 76 | **95** | 28 | **31** |

The per-function `cyclomatic` figures omit nested closures. The inclusive figures in §2 count them, and they are the ranking basis. Conditions-only figures are published beside them.

### 1b. Per-commit attribution (Harbour, 163 production-touching first-parent commits)

Each commit was measured with the kit at that commit (`cq-commit-attribution.tsv`, `cq-commit-attribution-summary.json`). Classes are keyword-assigned from the subject, and the boundary is judgement. The keyword rule is recorded in the evidence file.

| class | commits | Δ DP | Δ code lines | reading |
|---|---|---|---|---|
| feature | 133 | **+3,893** | +8,948 | new behaviour, mostly Home, Settings, task page and Observation |
| relocation (split, move, rebuild) | 26 | **+709** | +2,314 | 11 are pure moves at exactly 0 DP (e.g. LIN-3842, -3872, -3876, -3877, -3883, -3893, -3894) |
| retirement | 4 | **−430** | −1,406 | LIN-3912 (Next run page, −319 DP, −1,039 lines), LIN-4129 (cost code, −57), LIN-3848 (nine settings switches, −49), LIN-3479 (`.text` helpers, −5) |
| **net** | **163** | **+4,172** | **+9,856** | |

The gone files account for −406 DP (6 files: `lib/next-run.js`, `public/next-run.js`, `routes/next-run.js`, `lib/render-next-run.js`, `lib/task-cost.js`, `lib/plan-fee-config.js`). The born files account for +3,188 DP (83 files, §1c).

**Answer to the headline question.** Relocation and removal together (−430 + 709 = +279 DP) offset about 7% of the feature DP (+3,893). The complexity fell in the places that were split or retired, and it rose in the places that grew. The rebuilt code is smaller, but the window's feature work outweighed it.

### 1c. Born and gone production files

- **Born: 83 files, +3,188 DP.** 36 have DP ≥ 25 (`cq-born-gone-families.tsv`). Largest: `lib/pipeline-churn.js` (222 DP, `classifyTicket` cyc 87), `lib/home-view.js` (161, worst cyc 20), `lib/render-settings-models.js` (132, `modelsBody` cyc 25), `routes/workspace-api-issue-write.js` (129, closure), `routes/dashboard-feed.js` (128, `buildSessionPayload` cyc 22), `lib/model-routing.js` (126, worst cyc 14), `routes/settings.js` (110, `sendSettingsPage` cyc 38), `lib/task-state.js` (105, `taskStateOf` cyc 35).
- **Gone: 6 files, −406 DP** (the next-run family, `lib/task-cost.js`, `lib/plan-fee-config.js`).

### 1d. Family movement (file-sum DP, base → head)

| family | base | head | Δ | reading |
|---|---|---|---|---|
| dashboard (`routes/dashboard*.js`) | 551 | 492 | −59 | split into 8 sub-routers; relocated, not removed |
| workspace-api (`routes/`/`lib/workspace-api*`) | 739 | 755 | +16 | split into 11 sub-routers; DP held |
| dispatch-store | 385 | 561 | +176 | grew (F-dispatch-store) |
| prompt-section | 338 | 954 | +616 | grew (F-prompt-section) |
| render.js | 209 | 337 | +128 | grew (F-render-page) |
| task-page-loader + render-task-page | 537 | 759 | +222 | grew; consumption of `task-state`, not a second decision (F-second-rep) |
| live-console (lib + public) | 564 | 771 | +207 | grew; owner LIN-4014 (Backlog) |
| observation (public) | 791 | 918 | +127 | grew (F-observation) |
| runner.mjs | 492 | 524 | +32 | (F-runner-kit) |
| errors.js | 55 | 97 | +42 | grew (F-errors) |
| server.js | 369 | 342 | −27 | wiring; see F-server |
| Home family (born: `home-view`, `task-state`, `task-facts-*`, `task-board-view`, `components/decision-panel`) | 0 | 520 | +520 | new; consumes one state decider (F-second-rep) |

### 1e. SD movement

DP 4,970 → 5,451 (+481). Seven of the eight growing SD units are in `reapers.js`, `dispatcher.js` and `hook.js`. Born small modules: `request-usage-flush.js` (210 code lines, worst `postRecordsWithLedger` cyc 35), `instance-guard.js` (165, `classifyPidfile` cyc 21), `request-usage.js` (128, `walkRequestRecords` cyc 23), `host-heartbeat.js` / `host-heartbeat-sender.js` (DP 31 / 22), `auth-stop.js` (DP 15). These are new, with 2 commits each in 90 days, so they are listed and not ranked.

---

## 2. Risk × churn and top units

**Weight.** I use file-level DP × commits touching the file in the 90 days to 2026-11-04 (2026-08-06 onward). It is a proxy for "where a change is most likely to hit complexity", and it is not a probability. The full table is `cq-risk-churn.tsv` (every file with DP ≥ 50, both repos).

| # | file | DP (head) | churn 90d | weight | note |
|---|---|---|---|---|---|
| 1 | SD `reapers.js` | 990 | 58 | 57.4k | F-runstall |
| 2 | `server.js` | 342 | 245 | 83.8k | highest churn; DP fell; F-server |
| 3 | `public/prompt-section.js` | 954 | 61 | 58.2k | F-prompt-section |
| 4 | `public/observation.js` | 918 | 48 | 44.1k | F-observation |
| 5 | `lib/dispatch-store.js` | 561 | 74 | 41.5k | F-dispatch-store |
| 6 | `public/common.js` | 589 | 69 | 40.6k | F-common |
| 7 | SD `dispatcher.js` | 364 | 66 | 24.0k | `processPolledItem` (F-runstall family) |
| 8 | `routes/dispatch.js` | 255 | 80 | 20.4k | entrance cluster; clean in 10-20; not re-read |
| 9 | `routes/test.js` | 411 | 48 | 19.7k | F-test-routes |
| 10 | `routes/proxy.js` | 155 | 126 | 19.5k | `createProxyRoutes` 1,179 span (F-subrouter-residue) |
| 11 | `lib/render.js` | 337 | 52 | 17.5k | F-render-page |
| 12 | `lib/task-page-loader.js` | 424 | 40 | 17.0k | grew 283 → 424; F-second-rep |
| 13 | `public/flight-companion.js` | 443 | 36 | 15.9k | 10-20 #2 unit; not re-read |
| 14 | SD `hook.js` | 405 | 39 | 15.8k | `main` cyc 92 |
| 15 | `lib/openrouter.js` | 367 | 39 | 14.3k | `getRecommendationStream` cyc 45; LIN-1250 |
| 16 | `lib/runner-kit/runner.mjs` | 524 | 26 | 13.6k | F-runner-kit (highest single function) |

**Top-level units by inclusive DP** (`cq-top-units-lv-5334c81a.json`; 10-20 value in brackets):

| # | unit | incl DP | cond | span | note |
|---|---|---|---|---|---|
| 1 | `public/prompt-section.js` IIFE | **954** [338] | 683 | 2,856 | F-prompt-section |
| 2 | `public/flight-companion.js` IIFE | 443 [447] | 371 | 2,154 | |
| 3 | `routes/test.js createTestRoutes` | **406** [364] | 280 | 2,030 | F-test-routes |
| 4 | `public/live-console.js` IIFE | 381 [308] | 304 | 1,646 | LIN-4014 |
| 5 | `public/ship.js` IIFE | 370 [370] | 323 | 1,849 | unchanged |
| 6 | `public/task-page.js` IIFE | 225 [175] | 180 | 766 | LIN-4013 |
| 7 | `routes/proxy-compute.js createComputeRoutes` | 222 [221] | 168 | 1,551 | duplicate members (F-hidden-dup) |
| 8 | `routes/dispatch.js createDispatchRoutes` | 211 [174] | 165 | 1,407 | |
| 9 | `lib/pipeline-churn.js classifyTicket` (new unit) | 144 | 117 | 168 | F-classify-ticket |
| 10 | `lib/runner-kit/runner.mjs runCommand` | **147** [142] | 98 | 326 | F-runner-kit |
| 11 | `lib/chat-tools.js createChatToolCatalog` | 155 [154] | 123 | 729 | |
| 12 | `routes/proxy.js createProxyRoutes` | 139 [—] | 109 | 1,179 | F-subrouter-residue |
| 13 | `routes/dashboard.js createDashboardRoutes` | **101** [467] | 1 | 621 | retired premise (F-dashboard) |
| 14 | `routes/workspace-api.js createWorkspaceApiRoutes` | **99** [417] | 99 | 706 | retired premise (F-workspace-api) |

SD (`cq-top-units-sd-67ff5c3b.json`; 10-20 value in brackets): `opencode-runner.js runOpenCode` 184 [181] (own cyc 134 [132]); `reapers.js runStallFailsafe` **177** [162] (own cyc 108 [99]); `dispatcher.js processPolledItem` **125** [113] (own cyc 122 [110]); `dispatcher.js runOnce` 112 [113] (flat, not the growing unit 10-20 predicted); `hook.js main` 104 [111] (span 609 → 582, cyc 90 → 92).

---

## 3. Findings, severity-ranked

Each finding names a concrete maintainability cost. Disposition is one of: **minted** (none this run), **cross-linked** (owner exists), **recorded** (no owner, no promotion), or **re-verified** / **not re-verified**. Delta is against 10-20.

### F-prompt-section · **HIGH** · worsened (10-20: MED, a shared row with F-runstall, now split) · disposition: cross-link LIN-3546; owner shape recommended (§6)

`public/prompt-section.js` (2,867 lines; 2,010 code). Inclusive DP **338 → 954** (conditions-only 260 → 683). Span 1,468 → 2,856. The IIFE's `init` closure (L853–2846) grew 826 → **1,994** lines and holds **131 nested function rows** over one shared `const state = {...}` (L869). Own-cyc leaders inside it: `renderChangePanel` 49 (span 65), `handleRunAction` 39 (span 139), `fetchPrompt` 33, `startRun` 32, `handleClick` 30. The file had **23 commits in the window** and **61 in 90 days** (weight 58.2k, the highest-weight browser file).

- **Cost:** the run, stop, answer, ladder and prompt-panel paths all read and write the same `state` across about 130 closures, so no handler can be reasoned about or tested alone. Every edit re-reads a 2,000-line closure. The UI-finish round that edits the task page (LIN-4013) would have to work inside it.
- **Not a duplicated decision.** I checked the usual suspect. The browser's `runOfferOf` (L679) and `stageBusy` (L690) read the server's `sessions.action` and `sessions.busy`, and the decision lives in `lib/task-state.js:310` (`runOfferOf`) and `:219` (`taskStateOf`). The cost is size and implicit shared state, not two sources of truth.
- **Owners.** LIN-3546 (Backlog, no comments, title "822-line" stale, unstarted). LIN-4160 (Backlog, a behaviour bug in the same closure: an identical run-preview GET on every incomplete re-read). LIN-3512 (Backlog, second mount keeps a stale run-quota count). No open child of LIN-4008 names `public/prompt-section.js` (searched the 13 children).

### F-runstall · **HIGH** · worsened (10-20: MED, cross-link LIN-3544) · disposition: cross-link LIN-3544

SD `reapers.js runStallFailsafe` (L1888): span 950 → **993**, own cyc 99 → **108**, inclusive DP 162 → **177**. The file is 2,175 lines, 990 DP, and **58 commits in 90 days**. `dispatcher.js processPolledItem` (L730): span 793 → 851, cyc 110 → 122, inclusive 113 → 125, the SD grower in the window. `dispatcher.js runOnce` stayed flat (112, the 10-20 prediction did not hold).

- **Cost:** one function plans and applies stall recovery against live opencode sessions. Each branch change alters a fail, resume or hold decision on a real session. This is the highest weight in SD (57.4k).
- **Stale anchors (not re-verified).** The 10-20 anchors for LIN-2470 (`reapers.js:1915–1932`) no longer exist: the ticket tag is gone from `reapers.js`. The two `.reason` reads are now at `:2463` and `:2518`, each in a branch that has already tested the result, so I did not confirm the 10-20 "unguarded read" claim at HEAD. LIN-2568's else arm is not tagged in the file either. Both tickets are Backlog. Their owners should re-anchor them.
- **Owner:** LIN-3544 (Backlog, unstarted; its title's "950-line" is stale, the function is now 993).

### F-dispatch-store · **HIGH** · new (10-20 carried it only as owner LIN-2398) · disposition: cross-link LIN-2398

`lib/dispatch-store.js` (3,050 → 3,967 lines; 1,543 code). File DP **385 → 561** (+46%). `addFeedback` (L3229–3676): span 399 → **448**, own cyc 60 → **67**, inclusive 59 → 66, nesting 4. It has two callers: `routes/dispatch.js:1628` and `routes/proxy-runner.js:216` (the runner's feedback path). The file had **74 commits in 90 days** (weight 41.5k).

- **Cost:** one method carries three decisions: wake-credential provisioning and the `grantRefusal` branch (LIN-3134), the runner-ownership branch (`takenByTokenId`, LIN-3130), and the legacy label-plus-null branch. A change to one branch lands in a method shared by the other two, on the runner feedback path. I read the signature and the doc comment for this, not the full 448-line body.
- **Owner:** LIN-2398 (Backlog). Its title ("2,178 lines, 31 methods, addFeedback 288 lines") is stale: the file is 3,967 lines and `addFeedback` is 448.

### F-runner-kit · **HIGH** · carried (10-20: HIGH, MINT LIN-3741) · disposition: cross-link LIN-3741

`lib/runner-kit/runner.mjs` (1,525 lines, DP 524). `runCommand` (L1026–1351): span 309 → **326**, own cyc 132 → **136** (conditions-only 94 → 98), inclusive 142 → 147. It is still the highest single function in LinearViewer (`classifyTicket` is next at 87). `waitLoop` is unchanged (cyc 48, nesting 6, span 85; moved L1274 → L1417). Churn: 26 commits in 90 days, up from 21.

- **Cost (carried):** a 12-arm `switch` with an inline effect sequence, and a depth-6 wait loop. Control-flow defects land here. The file is served to users' machines and hashed into runner prompts (`lib/prompts/runner-kickoff.js`), so each edit changes what new runs trust. The 10-20 defect count was not re-counted this run.
- **Owner:** LIN-3741 (Backlog, unstarted; characterisation tests first).

### F-live-console · **LOW-MED** · grown · disposition: cross-link LIN-4014

`lib/live-console.js` (665 code lines): file DP **256 → 390**, code 428 → 665. `deriveLoopCandidates` and `buildConsoleFeed` are both own cyc 36 (span 103). `public/live-console.js`: file DP 308 → **381**, its IIFE's inclusive DP 308 → 381, with `renderPulse` cyc 28 and `updateTimelineBarNode` cyc 24. Churn across the two files is 21 commits in 90 days (weight 6.6k and 5.3k, outside the top of §2).

- **Cost:** the Live Console derives its loop candidates and feed in one 103-line function each, and renders them in one browser IIFE. A change to a lane or a tempo bucket reaches both sides of the rendering contract.
- **Owner:** LIN-4014 ("UI finish 6: tidy Live Console and Landing", Backlog) is the in-scope owner. Cross-link it. Not minted.

### F-observation · **MED-HIGH** · new · disposition: cross-link LIN-4013

`public/observation.js` (2,694 code lines). File DP **791 → 918**. `renderRulingRow` span 241 → **268**, own cyc 26 → **31**. `renderRulings` span 123 → 129, cyc 29 → **35**. The file had **48 commits in 90 days** (weight 44.1k, the fourth-highest in the table).

- **Cost:** the rulings renderer is a 268-line function with 31 decisions, edited about once a day. Changes to Observation land in a 2.7k-line browser file with no unit boundary.
- **Owner:** LIN-4013 ("UI finish 5: tidy the task page and Observation", Backlog) names Observation in its title. Cross-link it. Not minted: the owner exists and is in the UI-finish round.

### F-render-page · **MED-HIGH** · new · disposition: partial owner LIN-4124; remainder unowned (recommend widening, §6)

`lib/render.js` `renderPage` (L264–400): span 83 → **137**, own cyc 45 → **79** (conditions-only 41 → 67), file DP 209 → 337, with 52 commits in 90 days. The function branches three page modes in one body: landing (`isLanding`), backlog (`isBacklog`, LIN-4119) and Home (`isHome`, LIN-4120). The mode flags gate the waiting region, the running region, up-next, projects and the nav bar (verified at L264–316 of the HEAD body). The `isLanding` mentions in `render.js` rose 27 → 33.

- **Cost:** a change to one mode can change another mode's output, and no test isolates a mode. `renderPage` is the most complex function that a page change lands in.
- **Owner:** LIN-4124 (Backlog) covers only the dead `isLanding` branches. The three-mode split itself has no owner. Recommended: the owner widens LIN-4124, or a UI-finish child takes it. Not minted (see §6).

### F-sd-runopencode · **MED-HIGH** · carried (10-20: MED-HIGH, recorded, next in line) · disposition: recorded

`simple-dispatcher/opencode-runner.js runOpenCode` (L1130; was L1076): span 768 → 792, own cyc 132 → **134** (conditions-only 116 → 118), inclusive 181 → 184. The state-commit block `const rec = s.sessions[sdSessionId]` appears **8 times** (L1617, 1643, 1663, 1700, 1723, 1785, 1836, 1895), the same count as 10-20 at shifted lines. 26 commits touched the file in 90 days.

- **Cost:** every terminal outcome writes the session record in one of eight hand-copied blocks, so a change to the guard must be made eight times. This is the "one helper" cut the 10-20 review recommended (`commitRunnerOutcome`), still not made.
- **Owners:** LIN-3076 (Backlog, half done), LIN-2679 (Backlog, item 1 fixed). Not minted: LIN-3544 (the SD decomposition) is still unstarted.

### F-common · **MED** · new (weight #6 in §2; no finding in the first draft) · disposition: cross-link LIN-3953; recorded

`public/common.js` (1,588 code lines, file DP **589**, **69 commits in 90 days**, weight 40.6k). The shared browser helper file that every page loads. Its worst unit is `window.dispatchPrompt` (L833–923, span **91**, own cyc **38**, nesting 2), the one sender that the dispatch surfaces call.

- **Cost:** a change to the shared sender changes dispatch on every surface at once, in a file that is edited about once a day and has no unit boundary per surface. The decision points sit in one 91-line function with a 38-branch selector, so a bug in one branch reaches all callers.
- **Owner.** None for the file's shape. LIN-3953 (Backlog) is a correctness ticket on the same function: its JSDoc says a blank model or harness inherits the consumer's default, and the code does something else. Cross-link it. LIN-144 (Done) and LIN-421 (Done) are the earlier consolidation of this file, so the file has been a shared helper bucket since then.
- **Not read in depth beyond the function above.** The rest of the file (DP 589 minus the sender) is listed here by weight only.

### F-hidden-dup · **MED** · moved (10-20: MED, cross-link Drift) · disposition: cross-link Drift (`mock-ai-builder-copies`); recorded

Shared-line counts, same commit on both sides (`cq-dup-pairs.txt`, `verbatim.mjs`):
- **Resolver mirror (moved, not gone).** The decision "a bare UUID passes straight through; a symbolic ref is listed and matched" is now in **five** places: `routes/proxy.js:1248, :1255, :1270, :1277` (the team, state, project and one more input resolver) and `routes/workspace-api-issue-write.js:166` (the generic `resolveRefVia`, whose comment at `:157` says "mirroring the proxy write path"). `proxy.js ↔ workspace-api.js` dropped from 52 to **19** matched lines, but `proxy.js ↔ workspace-api-issue-write.js` is **23 of 271** (8.5%, longest run 6).
- **Mock-builder copies (unchanged).** `routes/proxy-compute.js ↔ routes/task-chat.js`: **52 matched of 325** new lines (16%), longest verbatim run **27** (both at 9b2955cc and 5334c81a). `proxy-compute ↔ lib/workspace-api-mocks.js`: 9 matched (4.8%). `task-chat ↔ mocks`: 8 (4.2%). The "mirrors `lib/workspace-api-mocks.js`" comments at `routes/proxy-compute.js:108` and `routes/task-chat.js:59` are now stale: the mocks module exports the same builders, so the fix is an import.
- **Cost:** changing UUID or mock semantics means editing five resolver sites and at least two mock builders. The LIN-3659 fix (10-20) already had to patch one predicate in three files.
- **Honest limit.** Copies rewritten past the verbatim threshold are not found by this method. This row is bounded only for the known members.

### F-kpi-twins · **MED** · unchanged by shared-line count (10-20: MED, recorded) · disposition: recorded; promotion trigger reached in principle

`public/kpis.js ↔ public/workspace-kpis.js`: **65 matched of 90** new lines (72%), longest run 13, **identical at both SHAs**. `lib/render-kpis.js ↔ render-workspace-kpis.js`: 11 matched (8%) at both SHAs. `public/kpis.css ↔ escalation-kpis.css`: 49 → 50. `doneTotalHtml` (`render-kpis.js:186`, `render-workspace-kpis.js:110`) and `LOOKBACK_DAYS = 7` (`:180`, `:105`) persist.

- **What moved.** LIN-4178 (costs rebuild) removed the `formatUsd` twin from the KPI renderers, which the pair counts do not register. The shared-line counts are the decision basis, so the row is **unchanged**, not "improved".
- **Cost:** the same KPI decisions are maintained in two renderers. LIN-4178 co-edited both pages in one change, which is the 10-20 promotion trigger ("touched a third time"). Not minted: the pair is about 65 lines and no owner is assigned. Decide at the next feature touch.

### F-subrouter-residue · **MED** · new (replaces F-dashboard and F-workspace-api) · disposition: recorded; no owner needed yet

The one-lexical-scope premise is retired: `createDashboardRoutes` (span 2,533 → 621, own cyc 29 → 7) and `createWorkspaceApiRoutes` (span 2,950 → 706, cyc 12 → 14) are now small roots. The decision points moved to the new sub-routers, not out of them (dashboard family 551 → 492, workspace-api family 739 → 755). The residue is still closures of 300–1,200 lines (`createProxyRoutes` is the largest, at 1,179):

| closure | file:line | span | cyc | note |
|---|---|---|---|---|
| `createRoadmapRoutes` | `routes/workspace-api-roadmap.js:70` | 813 | 1 | 122 incl DP |
| `registerScanRoutes` | `routes/workspace-api-scan.js:95` | 592 | 1 | |
| `registerIssueWriteRoutes` | `routes/workspace-api-issue-write.js:252` | 514 | 2 | 83 incl DP |
| `createProxyRoutes` | `routes/proxy.js:490` | 1,179 (was 1,126) | 22 (was 19) | grew in the window; not a sub-router |
| `buildSessionPayload` | `routes/dashboard-feed.js:249` | 110 | 22 | |

- **Error handling is consistent per response type.** The JSON routers use the shared `jsonError` / `errorEnvelope` helpers, and every `catch` in the 19 router files logs. The four page routers answer 500 with `renderErrorPage` (`dashboard-feed.js:676`, `dashboard-effort.js:215`, `settings.js:441`, plus `dashboard-kpis.js`), which is the page convention, not drift. No empty catches were found.
- **Cost:** each closure is still one scope for 10–40 routes, so a shared local changes many routes. The cost is lower than the 2,500-line giants, and the decision points did not disappear.
- **Churn.** `routes/proxy.js` has 126 commits in 90 days (second only to `server.js`, 245), but its decision points are low (155). Its cost is closure breadth, not complexity, so this row stays MED and does not promote the file.
- **Owners:** LIN-2246 and LIN-3742 are both Done. No open owner for the residue. Not minted: a decomposition ticket for `createProxyRoutes` would be a rebuild of a 1,179-line closure with low DP, and the decision is for the owner after the next churn read.

### F-test-routes · **LOW-MED** · new · disposition: recorded; cross-link LIN-3517 (test estate)

`routes/test.js createTestRoutes` (span 2,030, own cyc 9): inclusive DP **364 → 406** (rank #5 → #3 among units). `routes/test.js` is mounted only under `NODE_ENV === 'test'` (`routes/test.js:5`, `server.js:1213`), and it lives in the shipped `routes/` tree, so it is measured as production complexity (weight 19.7k, 48 commits in 90 days).

- **Cost:** the test harness (fake tokens, fail-next switches, fixtures, the mock transport) is reviewed and measured as production code, and its fixtures duplicate the mock builders (F-hidden-dup).
- **Owner:** LIN-3517 covers `tests/` only. Placement is out of this review's remit (Seams & Tangles).

### F-server · **MED** · carried (10-20: MED, recorded, LIN-1249 numbers stale) · disposition: cross-link LIN-1249

`server.js` 4,657 → 4,668 lines. Churn **210 → 245** commits in 90 days, so it is the highest churn in either repo and the top weight in §2 (83.8k). Decision points fell 369 → 342. The cost is wiring breadth, not decision points: a change to a route mount or import touches the one file everything else is wired through. Severity stays MED because of churn, not DP. Owner LIN-1249 (Backlog) has a stale title ("2542-line", now 4,668).

### F-census-core · **LOW-MED** · carried, unchanged · disposition: recorded

`scripts/code-shape/census-core.mjs runCensus` (L48): span **782**, own cyc **145**, nesting 4. Unchanged from 10-20. The file is the instrument three periodicals use. Owners LIN-3549 and LIN-3628 are Done. The kit still emits per-function inclusive figures only through a throwaway sum.

### F-experiments · **LOW-MED** · carried, scope note · disposition: recorded

`experiments/` is outside the production slice. At HEAD it has **248 js/mjs files, 13,431 DP, 32,009 code lines** (247 files, 13,356 DP at the baseline). `scripts/` adds 275 files, 15,455 DP. Pinned replay copies remain, for example `experiments/rebuild-rung5a/replay/pinned/origin-main/dispatch-factory.js`. The census and shape tools exclude `pinned/` and `work/` by default, so the measurement risk is the same as in 10-20. No runtime risk: CI and `package.json` do not reference the tree.

### F-hotspots-never-reached · **LOW-MED** · carried, revalidated · disposition: recorded

Revalidated against HEAD (own cyc / conditions-only / span, base → head):

| unit | 10-20 | HEAD | verdict |
|---|---|---|---|
| `lib/unanswered-decisions.js collectUnansweredDecisions` | 63 / 44 / 269 | **renamed** `reduceUnansweredDecisions` 62 / 46 / 248 | replacement named; flat |
| `lib/agent-turn.js runAgentTurn` | 60 / 57 / 406 | 61 / 57 / 423 | flat, slightly longer |
| `lib/run-closeout-state.js deriveCloseOutState` | 48 / 44 / 209 | 48 / 44 / 209 | unchanged |
| `lib/ci-wake-sweep.js sweepOneWorkspace` | 52 / 42 / 142 | 54 / 44 / 149 | Drift #3 locus; grew slightly |
| `lib/connection-credential.js convertToConnectionBacked` | 46 / 42 / 125 | 46 / 42 / 125 | unchanged; Drift #1 / LIN-2150 locus |
| `lib/ship-biscuit.js buildEditionModel` | 52 / 49 / 117 | 53 / 49 / 119 | flat |
| `lib/next-run.js formatNextRunContext` | 57 / 44 / 124 | file deleted | **retired** |
| `lib/terminal-marked-task-cost.js`, `lib/plan-review-round-trips.js` | 57 / 48 | files exist; top units not re-measured | open |

None rises to promotion. `runAgentTurn` and `collectUnansweredDecisions` are the first candidates if either begins to change.

### F-orphans · **LOW** · partly resolved · disposition: recorded

- **Resolved.** `lib/plan-fee-config.js` is deleted. `reviewLoopExhausted` (`lib/recommendation-facts.js`) and `isOwnerAnswer` (`lib/workspace-owner.js`, now used by `lib/connection-credential.js`) have production callers.
- **Still open.** `getAvailablePrompts` (`lib/prompt-templates.js`) is test-only.
- **Unused anywhere at HEAD (11):** `DEFAULT_BRIEF_MODEL`, `DEFAULT_RECAP_MODEL`, `DEFAULT_RUN_SUMMARY_MODEL`, `DEFAULT_SCAN_MODEL`, `getPromptCategory`, `isInReadyQueue`, `getAllPromptsByCategory` (`lib/prompt-templates.js`), `isHarbourAvailable` (`lib/harbour-spawn.js`), `jobsOnSurface` (`lib/llm-jobs.js`), `LIVENESS_ALARM_COLLECTION` (`lib/liveness-alarm-store.js`), `WAKE_SHADOW_COLLECTION` (`lib/wake-shadow.js`).
- **Method change (not comparable to 10-20).** The 10-20 counts (fully dead 15, test-only 113) used a different detector. This run uses one method at both SHAs: unused anywhere 10 → 11; used only inside their own file 120 → 139; test-only 423 → 481; live 1,534 → 1,918 (`cq-dead-exports.txt`). The trend is within this table only.

### F-store-css-swim · **LOW** · **not re-verified** · disposition: open

The 10-20 `clear(urlKey)` family (20 members) was measured by a detector I did not re-run. A literal `clear(urlKey)` search finds 0 hits in `public/` at either SHA, so I cannot confirm the count or the churn this run. `drawBlockingConnectors` and `drawBlockingConnectorsVertical` are both still present in `public/swim.js`. The next run should re-run the 10-20 detector before reporting this row.

### F-sd-other · **LOW** · carried, not re-measured in depth · disposition: recorded

`e2e-smoke.js runFailsafeOnce` (cyc 53, span 117), `scripts/floor-report.mjs main` (cyc 41), `heartbeat.js resolveAsyncWait` (cyc 57, span 94) and `reapers.js runOpenCodeCompletionCheck` (cyc 42) are unchanged in shape. The SD cross-repo and in-repo duplicate pairs are 0 at both SHAs (10-20 method; not re-run). The new small SD modules (§1e) are listed, not ranked.

### F-classify-ticket · **LOW** · new · disposition: recorded

`lib/pipeline-churn.js classifyTicket` (L195–362): span 168, own cyc **87** (conditions-only 74), nesting 4. Born in this window (LIN-3891, the pipeline churn instrument). It is a single if-chain that classifies tickets for `scripts/pipeline-churn.mjs`. **Cost:** a wrong class silently changes the churn report. LOW because it is an operator tool with one commit in 90 days.

### F-settings-born · **LOW** · new · disposition: recorded

`routes/settings.js sendSettingsPage` (L200): span 193, own cyc 38 (conditions-only 25), nesting 2. The file was born in the window (LIN-3846, LIN-3890 series, 110 DP). **Cost:** one 193-line sender with 38 decisions in a page the Settings rebuild touched six times. LOW: the rebuild is recent and the churn is 7.

### F-errors · **LOW** · grown (handed here by Seams & Tangles) · disposition: recorded

`lib/errors.js`: DP 55 → **97**, code 176 → 249. `describeSourceFailure` (L374, new in window): span 48, cyc 32. The growth is from LIN-3775 ("error pages say what failed", +50 DP in one commit). **Cost:** a 32-decision mapping from source failure to user text is the one place that wording lives; the error-page contract depends on it. LOW: churn is 9. The file's placement is S&T's.

### F-second-rep · **clean (answers an open question)** · disposition: no finding

**No second representation of opened-task state.** The state is decided once: `lib/task-state.js` (`sessionFactsOf` :55, `taskStateOf` :219, `runOfferOf` :310, `pageStatusOf` :336). The consumers read it: `task-page-loader.js` (18 references), `render-task-page.js` (2), `task-board-view.js` (2), `home-view.js` (1). `routes/task-page.js` reads through the loader. The one naming collision is the browser's `runOfferOf` (`public/prompt-section.js:679`), which is a reader of the server's `sessions.action` with a fallback to `row.action`, not a decider. The growth of `task-page-loader` (283 → 424) and `render-task-page` (254 → 335) is consumption, not duplication.

### F-dashboard · **retired** (10-20: HIGH, MINT LIN-3742) · disposition: retired into F-subrouter-residue

Premise gone: `createDashboardRoutes` span 2,533 → 621 and own cyc 29 → 7. LIN-3742 is Done. Decision points are relocated (family 551 → 492), so this is "resolved, relocated", not "removed".

### F-workspace-api · **retired** (10-20: MED, cross-link LIN-2246) · disposition: retired into F-subrouter-residue

Premise gone: `createWorkspaceApiRoutes` span 2,950 → 706 and cyc 12 → 14. LIN-2246 is Done (10-20 had it as "partly satisfied"). The DP moved into the sub-routers (family 739 → 755).

### Clean results

- **`lib/components/decision-panel.js`** (born, DP 94, worst `numbersHtml` cyc 16): the one decision panel that replaced two copies (LIN-3962). Clean on duplication.
- **`lib/task-state.js`** (born, DP 105, worst `taskStateOf` cyc 35): dense by nature (a precedence table), and the single decider. Clean on duplication.
- **`lib/home-view.js`** and **`lib/home-rows.js`** (born): worst functions 20 and 17. Read at header and metric level only.

---

## 4. Class dispositions

| class | bound | result |
|---|---|---|
| **C1** span ≥ 200 | `shape.mjs --functions` | LV 90 → 108; SD 9 → 9. Named units in §2 and §3; the remainder are not findings alone. |
| **C2** cyc ≥ 50 / ≥ 30 | same | LV 10 → 11 / 76 → 95; SD 11 → 11 / 28 → 31. Hotspots in §3. |
| **C3** inclusive-DP top units | top 60 per run in `cq-top-units-*.json` | §2. |
| **C4** rebuilt files (10-20 set of 20) | not re-run this pass | **not re-measured.** The 10-20 claim was "within ±13 DP"; the grown rebuilt files are covered by F-second-rep and F-render-page. |
| **C5** new production modules (83 born) | every born file with DP ≥ 25 is listed (§1c); named reads owed in 10-20 were `home-view`, `task-state`, `decision-panel`, `render-settings-models`, `sendSettingsPage`, `cost-read`, `model-routing`, `pipeline-churn` | **Partly read.** Metric-level reads for all 36; source reads for `task-state` (decider, §3 F-second-rep), `decision-panel` (clean), `classifyTicket` (F-classify-ticket), `sendSettingsPage` (F-settings-born). `cost-read` (`readCost` cyc 29), `render-settings-models` (`modelsBody` cyc 25) and `model-routing` (`tableFromPreferences` cyc 14) are metric-only. |
| **C6** duplicate windows | the 10-20 window scanner is not re-run; replaced by verbatim pair counts | `cq-dup-pairs.txt`. Gone: none confirmed. Born: none found among the known pairs. |
| **C7** hidden duplicates | known members bounded by shared-line count | F-hidden-dup. Unnamed copies rewritten past threshold are **unbounded by construction**, and this report does not claim a complete sweep. |
| **C8** dead and orphan exports | same-method counts at both SHAs | F-orphans (11 unused anywhere; 139 internal-only; 481 test-only). |
| **C9** `clear(urlKey)` family | not re-run | F-store-css-swim, **not re-verified**. |
| **C10** carried tickets | §5 | live states read this run. |

---

## 5. Carried items and owner verdicts (live state at review time; no ticket edited, except one comment on LIN-3546 per §6)

| ticket | state | verdict |
|---|---|---|
| LIN-3546 | Backlog, no comments | **stale title** ("822-line", now 2,856 span); premise changed (F-prompt-section). Owner-shape change recommended (§6). |
| LIN-3741 | Backlog, unstarted | cross-link F-runner-kit. Premise unchanged (cyc 132 → 136). |
| LIN-3544 | Backlog, unstarted | cross-link F-runstall. **Title stale** ("950-line"; now 993). |
| LIN-2398 | Backlog | **stale title** (2,178 lines / addFeedback 288; now 3,967 / 448). Cross-link F-dispatch-store. |
| LIN-1249 | Backlog | **stale title** ("2542-line"; now 4,668). Intent stands (wiring breadth). |
| LIN-2246 | Done | satisfied; sub-routers relocated residue (F-subrouter-residue). |
| LIN-3742 | Done | satisfied; dashboard premise gone (F-dashboard retired). |
| LIN-4124 | Backlog | partial owner for F-render-page (dead `isLanding` branches only). |
| LIN-4160 | Backlog | behaviour bug in the F-prompt-section closure; not a decomposition. |
| LIN-3512 | Backlog | behaviour bug (second mount quota); same closure. |
| LIN-4013 | Backlog | owner for Observation and task page; in-flight pressure on F-prompt-section and F-observation. |
| LIN-4014 | Backlog | owner for Live Console (F-live-console growth, §1d). |
| LIN-3953 | Backlog | correctness ticket on `public/common.js dispatchPrompt` (JSDoc vs behaviour); cross-link F-common. |
| LIN-4008 | Backlog (13 children; 5 open) | parent of the UI-finish round; no child names `prompt-section.js`. |
| LIN-4040 | Done | no open child owns the prompt-section decomposition. |
| LIN-2470 | Backlog | **anchor stale** (memo no longer tagged in `reapers.js`). Re-anchor. |
| LIN-2568 | Backlog | **anchor stale** (ref no longer in `reapers.js`). Re-anchor. |
| LIN-3076 | Backlog | half done (F-sd-runopencode). |
| LIN-2679 | Backlog | item 1 fixed by `1a7fd15` (10-20). |
| LIN-3549, LIN-3628 | Done | the kit owners (F-census-core). |
| LIN-3517 | Done | test estate; `routes/test.js` not in its remit (F-test-routes). |
| LIN-4152 | Done | the Seams & Tangles run that handed `lib/errors.js` here. |
| LIN-4154, LIN-4155 | Backlog | Seams placement moves; out of this review's remit. |
| LIN-3490 | In Progress | the charter this review's headline question refers to. |
| LIN-3740 | Done | the 10-20 run. |

---

## 6. Follow-ups: none minted, and the owner-shape recommendation

**Mints: zero.** Searches before deciding (Linear search, `GET /search`): `prompt-section`, `prompt-section.js`, `decompose prompt-section`, `prompt-section init closure`. The only open tickets that name the file are **LIN-3546** (decomposition, the same finding), **LIN-4160** and **LIN-3512** (behaviour). Under the brief's rule ("if one exists, note it instead of minting a duplicate"), F-prompt-section is not minted.

**Owner-shape recommendation for F-prompt-section (decided for the owner, not applied here).** LIN-3546 is an unparented, Backlog decomposition of a closure that the UI-finish round (LIN-4013, LIN-4008's children) has to edit. The recommended shape is: re-parent LIN-3546 under LIN-4008, and make it a prerequisite (`blocks`) of LIN-4013, with the current premise (954 inclusive DP, 131 nested functions, 61 commits in 90 days). This is a decision for the owner. A one-line comment on LIN-3546 carries the recommendation and this report's link.

**Owner-shape recommendation for F-render-page.** The three-mode split has no owner (LIN-4124 covers only the dead branches). Widen LIN-4124 or assign the mode split to a UI-finish child. Not minted.

**Promotion trigger for F-kpi-twins.** LIN-4178 co-edited both renderers in this window, which meets the 10-20 "touched a third time" trigger. Decide at the next feature touch.

---

## 7. Method notes and limits

- **Calibration first.** At `9b2955cc` the kit gives 459 files, 97,121 code lines, 28,252 DP, 752 units over cyc 10, span ≥ 200 = 90, cyc ≥ 50 = 10, cyc ≥ 30 = 76, and the 10-20 top inclusive units match digit for digit. At `bb1da78e` it gives 55 files, 13,159 code lines, 4,970 DP, 139 units, 9 / 11 / 28. Both are recorded in `cq-class-counts.json`. A mismatch would have been a stop.
- **Area guide.** One HEAD guide for every Harbour run. The 10-20 head guide differs from HEAD (16+ and 6 lines in `areas.json`). Area maps do not change totals, so this does not move any figure in this report.
- **Per-commit attribution.** Measured at each of the 163 production-touching first-parent commits, not all 244. The class assignment is keyword-based (§1b). The relocation-versus-removal split is the part to challenge, and the family table in §1d is the check on it.
- **Churn.** Commits touching the path in 90 days to 2026-11-04 (from 2026-08-06), at HEAD. Churn counts drift by a few commits with the measurement instant; only the ranking is relied on.
- **Weight.** File DP × 90-day churn (§2). It is a proxy, and it is not a probability. Where it and the unit-level measure disagree (`server.js`), the reason is written with the finding.
- **Dead exports.** A new, token-based detector run at both SHAs with the same method. It is not the 10-20 detector, so its absolute numbers are not comparable to the 10-20 figures (15 and 113). The trend is read within the table only.
- **Duplicates.** Verbatim shared-line counts (`verbatim.mjs`) only. The 10-20 window scanner was not re-run, and no duplicate is claimed from a window scan.
- **Not read in depth (in-remit, weighted high, carried for the next run):** `routes/dispatch.js` (20.4k; 10-20 graded the entrance cluster clean), `public/flight-companion.js` (15.9k), `lib/openrouter.js` `getRecommendationStream` (cyc 45, LIN-1250), `public/swim.js` (file DP 904, 2,315 code lines, in no finding; surfaced by the second read). SD `config.js` (667 code lines, DP 274, 35 commits in 90 days) and SD `transcript.js` / `harnesses.js` are also unmentioned, and are listed here as not read. These are listed by weight and given no finding in this run.
- **Not re-measured:** C4 (rebuilt-file set), F-store-css-swim (§3), the 10-20 `clear(urlKey)` detector, the SD duplicate-pair scan, and the unread `scripts/` operator tools beyond their shape rows.
- **Tests.** Test files were not audited (LIN-3517 owns the test estate). `routes/test.js` is production-tree code and is covered by F-test-routes.
- **Calibration of the research claims.** Three claims in the ticket's research comment did not hold on re-measurement and are corrected here: the KPI pair "improved" (it is unchanged in shared lines); `runOnce` "growing" (it is flat); the `runStallFailsafe` LIN-2470 anchor (no longer in the file).

---

## 8. Trend ledger

Every 10-20 stable name, with its disposition now (retained, retired, or renamed) and the delta. Then the names new in this run.

| stable name | 10-20 severity / disposition | 11-04 severity | delta | owner / replacement |
|---|---|---|---|---|
| **F-dashboard** | HIGH, minted LIN-3742 | **retired** | resolved: span 2,533 → 621; family DP 551 → 492 (relocated) | LIN-3742 Done; → F-subrouter-residue |
| **F-runner-kit** | HIGH, minted LIN-3741 | HIGH | worsened slightly: cyc 132 → 136 | LIN-3741 (Backlog) |
| **F-sd-runopencode** | MED-HIGH, recorded | MED-HIGH | unchanged: cyc 132 → 134; 8 blocks | LIN-3076, LIN-2679 |
| **F-kpi-twins** | MED, recorded | MED | **unchanged** (65 shared lines at both SHAs) | none; promotion trigger reached |
| **F-hidden-dup** | MED, cross-link Drift | MED | moved: resolver now 5 copies; proxy↔workspace-api 52 → 19; new file 23; mock pair 52 / 27 unchanged | Drift (`mock-ai-builder-copies`) |
| **F-workspace-api** | MED, cross-link LIN-2246 | **retired** | resolved: span 2,950 → 706; family DP 739 → 755 | LIN-2246 Done; → F-subrouter-residue |
| **F-server** | MED, recorded | MED | churn 210 → 245 (top); DP 369 → 342 | LIN-1249 (stale title) |
| **F-runstall** | MED, cross-link LIN-3544 | **HIGH** | worsened: incl 162 → 177; span 950 → 993 | LIN-3544 (Backlog) |
| **F-prompt-section** | MED, cross-link LIN-3546 (shared row with F-runstall) | **HIGH** | worsened: incl 338 → 954; span 1,468 → 2,856 | LIN-3546 (stale title; §6) |
| **F-hotspots-never-reached** | LOW–MED, recorded | LOW–MED | revalidated: `collectUnansweredDecisions` renamed; `formatNextRunContext` retired | none |
| **F-census-core** | LOW–MED, owner LIN-3549/3628 | LOW–MED | unchanged: span 782, cyc 145 | LIN-3549, LIN-3628 (Done) |
| **F-experiments** | LOW–MED, recorded | LOW–MED | unchanged in kind: 248 files, 13,431 DP | none |
| **F-orphans** | LOW, recorded | LOW | partly resolved: `plan-fee-config` deleted; two orphan exports now used; 11 unused anywhere | none |
| **F-store-css-swim** | LOW, recorded | LOW | **not re-verified** | none |
| **F-sd-other** | LOW, recorded | LOW | carried; not re-measured in depth | none |

| new name (11-04) | severity | note |
|---|---|---|
| **F-prompt-section** (split from the 10-20 shared row) | HIGH | §3 |
| **F-dispatch-store** | HIGH | §3; LIN-2398 |
| **F-observation** | MED-HIGH | §3; LIN-4013 |
| **F-render-page** | MED-HIGH | §3; LIN-4124 (partial) |
| **F-subrouter-residue** | MED | §3; replaces F-dashboard and F-workspace-api |
| **F-test-routes** | LOW-MED | §3; LIN-3517 cross-link |
| **F-classify-ticket** | LOW | §3 |
| **F-settings-born** | LOW | §3 |
| **F-errors** | LOW | §3 |
| **F-common** | MED | §3; LIN-3953 cross-link |
| **F-live-console** | LOW-MED | §3; LIN-4014 cross-link |
| **F-second-rep** | clean | answers the born-module question (§3) |

---

## 9. Adversarial Second-Read

**Tier used:** Tier 2 (a fresh-context sub-agent with no memory of the report-writing turn). It was given the two repo paths, the two window ranges and the report path. It formed its own ranked answer from `git log` and the kit before reading the report.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (summary, verified where cited):**

- Its own top item: `public/prompt-section.js`, the same as the report's #1. It spot-checked about 20 `file:line` references and found them correct, including the SD `runStallFailsafe` cyclomatic 108.
- Largest missed item: `public/common.js`, `dispatchPrompt`. The report ranked the file #6 by weight with no finding and marked it "not read in depth". **Verified:** the file has DP 589 and 69 commits in 90 days. The reader's span of 710 lines was wrong: `dispatchPrompt` is L833–923, 91 lines, cyc 38. The finding is now F-common (MED).
- Secondary: `F-live-console` was referenced in §1d and §5 but had no finding and no ledger row. **Fixed:** F-live-console added. The reader's live-console figure (287 → 459) is the file's `cyclomatic.total`; this report uses `decisionPoints` (256 → 390 for `lib/live-console.js`). Both are from the kit.
- Secondary: `routes/proxy.js` churn was worded as "no churn says it is needed now". **Verified:** 126 commits in 90 days (the reader counted first-parent only, 117). **Fixed:** F-subrouter-residue now states the churn and why the row stays MED.
- Secondary: `public/swim.js` (file DP 904, 2,315 code lines) and SD `config.js` (DP 274, 35 commits), with SD `transcript.js` and `harnesses.js`, were in no finding and no not-read list. **Fixed:** all listed in §7 as not read in depth. Not promoted, because no finding was measured.
- Duplication: the reader ran a `verbatim` scan of the 82 born production files against the non-born files (1,166 of 6,980 born lines matched; longest run 11). This is the reader's measurement and was not re-run for this report. It is consistent with the report's position that born-file duplication is not a finding.

**Verdict:** DISAGREE, on coverage. The top ranking holds. The report's own #6 weighted file had no finding, and one reference was dangling. Both are fixed in place. The ranking is unchanged.

**Differed from top finding:** NO. The reader's own top item is `public/prompt-section.js`, the report's #1.

Adversarial second-read verdict: DISAGREE
Differed from top finding: NO
Disposition: fixed in place
