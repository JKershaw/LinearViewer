# Code Quality Review — 2026-10-20 (production edition, periodical run, LIN-3740)

*Review-only: no code, config or secrets changed. The only files this run writes are this report and `_evidence-2026-10-20/cq-*`. Severity-ranked complexity / duplication / maintainability findings, weighted by risk × churn, grounded against source at HEAD.*

**Grounding SHAs.** `LinearViewer` @ **`9b2955ccb2a9a7f7e1e9517feec965685b6a97af`** (= `origin/main`) and `simple-dispatcher` @ **`bb1da78e29a99940dc5aa37cf7e826992db097f5`** (= `origin/main`). LinearViewer is one commit past the mint/research SHA `6be536c5` (LIN-3739, `tests/e2e/kpis.spec.js` only); `git diff --stat 6be536c5 HEAD -- . ':!tests'` is empty, so every production measurement is unchanged and none was carried across a moved file. simple-dispatcher has not moved.

**Predecessor (built on, not re-derived).** `code-quality-review-2026-10-12.md` (LIN-3543): its §2 findings, §3 classes, §4 carried items and its Adversarial Second-Read. Series: LIN-667, LIN-1232 (lost), LIN-1920, LIN-2378, LIN-3103, LIN-3517 (tests only), LIN-3543.

**Method.** The repo's committed kit only: `scripts/code-shape/shape.mjs --functions` with `--include '^(server\.js$|(lib|routes|public)/.*\.[cm]?js$)'` at `1ef562ce` and `9b2955cc` (LinearViewer) and at `0d54b974` and `bb1da78e` (simple-dispatcher, `--areas` pointing at `{"areas":[]}`). Production-slice totals (the include regex above; **not** the whole checkout, see F-experiments) reproduce the mint figures exactly: code lines 95,364 → 97,121; decision points 28,006 → 28,252; units over cyc 10 756 → 752; functions with span ≥ 200 103 → 90. Raw per-function JSON is 4–5 MB per run and regenerable with the command above, so only the derived tables are committed (`_evidence-2026-10-20/cq-*`). Throwaway sums over the kit's JSON, nothing new committed.

**Two corrections to the kit's `cyclomatic`, published beside it for every ranked unit.** (1) Per-function rows exclude nested closures, so route factories read falsely low (`createWorkspaceApiRoutes` spans 2,950 lines and scores cyc 12). Units are therefore ranked by **inclusive decision points (DP)**: Σ(cyc−1) over the unit and every function nested in it. (2) `||`, `??` and default values count everywhere, so `runCommand` reads 132 but is **94 conditions-only** (`cyclomaticConditionsOnly`). Inclusive DP is also the bridge to the 10-12 brace scanner: it reproduces that report's order (`runStallFailsafe` 162 vs scanner 145; `runOpenCode` 181 vs 156; `runCommand` 123 at `1ef562ce` vs 119).

---

## 0. Headline

1. **The rebuild wave removed complexity; it did not relocate it.** Per-commit attribution (the kit at every one of the first-parent LinearViewer commits since `1ef562ce`, 141 including LIN-3739): the 21 wave commits (20 rebuild/design-first/clean-room commits plus LIN-3604) took **−1,048 DP and −2,127 code lines**; the other 119 feature commits added **+1,294 DP and +3,880 lines**. Net +246 DP, which is exactly why the production-slice total rose while the giants shrank.
2. **Top finding: `routes/dashboard.js createDashboardRoutes` (inclusive DP 467) is now the #1 unit in LinearViewer and the only giant router the wave skipped.** Minted → **LIN-3742**.
3. **Highest single function: `lib/runner-kit/runner.mjs runCommand`** (cyc 132 / 94 conditions-only), plus `waitLoop` (cyc 48, nesting 6), with a stream of control-flow defects in the window and no structural owner. Minted → **LIN-3741**.
4. **Two mints, not three.** The KPI page twins (new, 13 commits in 3 days) are the third candidate; they are recorded as next-in-line because two of the last three mints are still unstarted. SD `runOpenCode` is recorded, not minted.
5. **Several owner tickets are stale against the code** (LIN-2246, LIN-1249, LIN-2398, LIN-1456, LIN-2679, LIN-3076, LIN-2568; Drift's LIN-3417 citation). Named in §5; updating them is outside this review's remit.

---

## 1. What the rebuild wave did to complexity (measured)

| commits | n | Δ decision points | Δ code lines |
|---|---|---|---|
| Rebuild wave (LIN-3549 children, plus LIN-3604) | 21 | **−1,048** | −2,127 |
| Everything else (feature work) | 119 | **+1,294** | +3,880 |
| Net | 140 | +246 | +1,757 |

Class bounds, `shape.mjs --functions` (`cq-class-counts.json`):

| class | 10-12 `1ef562ce` | HEAD `9b2955cc` |
|---|---|---|
| LV functions span ≥ 200 | 103 | 90 (35 are `public/` IIFE rows, which are files) |
| LV functions cyc ≥ 50 | 21 | 10 |
| LV functions cyc ≥ 30 | 93 | 76 |
| SD span ≥ 200 / cyc ≥ 50 / cyc ≥ 30 | 9 / 11 / 28 | 9 / 11 / 28 (nothing moved) |
| LV decision points / code lines | 28,006 / 95,364 | 28,252 / 97,121 |
| SD decision points / code lines | 4,751 / 12,570 | 4,970 / 13,159 |

- **Dispatch-entrance cluster** (the four entrance files plus their helpers): DP 1,033 → 855 (−17%), code 3,395 → 3,055; worst function cyc 181 → 51 (`createDispatchItem` span 913 → 199). `routes/dispatch.js createDispatchRoutes` 1,883 → 1,200 lines (inclusive DP 348 → 174); `proxy-dispatch.js` 1,726 → 512; `proxy-kickoff.js` 556 → 113. `lib/dispatch-entrance.js` was born at +265 DP but the routes lost more in the same commit (LIN-3604 net −59), and LIN-3611 then took −30.
- **`lib/dispatch-entrance.js` graded as a unit: clean inside.** 1,812 lines, of which 745 are comments and 966 code; 165 functions, worst cyc 14, nesting 3. Four commits since LIN-3611 added +13 DP. Its open debt is behavioural and authority work owned by LIN-3607 / 3608 / 3609 / 3649 (Backlog); placement is Seams & Tangles' (F1/F4). **Disposition: clean.** LIN-3545 is verified Done.
- **Paper claims cross-checked against the kit**: pipeline-loops 388 → 300 (paper 388 → 300), factory + validation 285 → 226 (measured 208 + 77 → 169 + 57), workspace-api 769 → 589 (538 + mocks 50), kpi-stats 152 → 99. All match.
- **Regrowth** across the 20 rebuilt files is +100 DP. `kpi-stats.js` 99 → 167 (13 commits in 3 days, additive small functions, worst cyc 12: healthy growth, not re-tangling), `jira/adf.js` +29, `task-page-loader.js` +26; every other rebuilt file is within ±13.
- **Where the feature DP went**: `lib/account-erasure.js` +281 (new, LIN-3423, 152 small functions, worst cyc 31), `lib/ci-wake-sweep.js` +117 (LIN-3661), KPI work about +200, `runner.mjs` +107, `connection-credential.js` +44.
- **For LIN-3490** ("gets simpler as it goes"), as a measured observation not a finding: it now holds inside rebuilt code (−1,048 DP, peaks halved) and does not yet hold across the production slice, because feature work adds about 1.2 DP for every 1 the wave removed.
- **A measurement blind spot the wave created.** Rebuilds rewrote some duplicates past the window scanners' thresholds, so they read "gone" when they are not (§3, F-hidden-dup). Method lesson: confirm a duplicate that reads gone with a shared-code-line count, not a window scan alone.

---

## 2. Risk × churn at HEAD

Churn method: `wc -l` × commits touching the path in the 90 days to 2026-10-20 (the 10-12 filter). Counts drift by a few commits depending on the instant of measurement (`server.js` read 192 in the research snapshot and 210 when re-run at write time); ranking is unaffected.

| # | file | lines × 90d | score |
|---|---|---|---|
| 1 | `server.js` | 4,657 × 210 | ~978k |
| 2 | `routes/workspace-api.js` | 3,782 × 99 | ~374k |
| 3 | `routes/dashboard.js` | 3,072 × 83 | ~255k |
| 4 | `routes/proxy.js` | 1,614 × 129 | ~208k |
| 5 | `lib/dispatch-store.js` | 3,050 × 66 | ~201k |
| 27 | `lib/runner-kit/runner.mjs` | 1,382 × 21 | ~29k |
| 54 | `lib/dispatch-entrance.js` | 1,812 × 7 | ~13k |

`routes/proxy-dispatch.js` fell from #16 to #25 and `routes/dispatch.js` dropped below `public/observation.js`.

**Top-level units by inclusive DP** (inclusive DP / conditions-only inclusive / span / 10-12; full top 60 per run in `cq-top-units-*.json`):

| # | unit | incl DP | cond | span | 10-12 |
|---|---|---|---|---|---|
| 1 | `routes/dashboard.js:507 createDashboardRoutes` | **467** | 328 | 2,533 | 474 |
| 2 | `public/flight-companion.js:47` IIFE | 447 | 375 | 2,158 | 447 |
| 3 | `routes/workspace-api.js:833 createWorkspaceApiRoutes` | 417 | 341 | 2,950 | **736** |
| 4 | `public/ship.js:11` IIFE | 370 | 323 | 1,849 | 369 |
| 5 | `routes/test.js:62 createTestRoutes` | 364 | 250 | 1,887 | 353 |
| 6 | `public/prompt-section.js:12` IIFE | 338 | 260 | 1,468 | 335 |
| 7 | `public/live-console.js:21` IIFE | 308 | 242 | 1,394 | 308 |
| 8 | `routes/proxy-compute.js:67 createComputeRoutes` | 221 | 167 | 1,531 | 221 |
| 11 | `routes/dispatch.js:263 createDispatchRoutes` | 174 | 144 | 1,200 | 348 |
| 13 | `lib/chat-tools.js:1299 createChatToolCatalog` | 154 | 122 | 723 | |
| 15 | `lib/runner-kit/runner.mjs:901 runCommand` | 142 | 99 | 309 | 123 |

`public/` rows are classic-script IIFEs: files, not functions. SD (inclusive DP / cond / span): `opencode-runner.js:1076 runOpenCode` 181/165/768; `reapers.js:1715 runStallFailsafe` 162/136/950; `dispatcher.js:693 processPolledItem` 113/91/793; `dispatcher.js:1597 runOnce` 113/95/520 (500 → 520, the only top-5 SD unit still growing); `hook.js:1579 main` 111/82/609.

---

## 3. Findings, severity-ranked

### F-dashboard · **HIGH** · disposition: **MINT → LIN-3742**
`routes/dashboard.js:507-3039 createDashboardRoutes`: one 2,533-line closure, inclusive DP **467** (328 conditions-only), 24 `router.<verb>` routes plus the helpers they share. Own cyc is 29, which is why a per-function ranking never named it. Inside it: `buildSessionPayload` `:707` (188 lines, cyc 28), `handleSessionSummary` `:2789` (108, cyc 27), `handleRunSummary` `:2628` (81, cyc 21), an anonymous handler at `:1218` (127, cyc 21). **Second site / delta:** the wave halved its two siblings (`createWorkspaceApiRoutes` 736 → 417, `routes/dispatch.js` 348 → 174) and left this one at 474 → 467. Third on risk × churn (~255k; 83 commits in 90 days, 8 since 10-12, including the LIN-3717 extraction of loop-terminal checks, which moved no router structure). **Cost:** every session, run and passage page change lands in one lexical scope, so handlers share state implicitly and cannot be tested or reasoned about alone; this is where a change most often lands and least often has a boundary. **Owners considered and rejected (search-before-mint, 2026-10-20):** LIN-3349 rebuilds the run page only (post-V1, ~620 lines); LIN-3017 moves one helper; LIN-3717 (Done) moved one decision; LIN-1989 / LIN-1912 are credential-lane concerns (Drift). No ticket owns the router. This was a judgement call the research left open; the evidence answers it (no existing ticket covers the router), so it is decided here rather than parked. Run page is excluded from the mint's scope. Placement is Seams & Tangles'; credential multiplicity is Drift's.

### F-runner-kit · **HIGH** · disposition: **MINT → LIN-3741**
`lib/runner-kit/runner.mjs:901-1209 runCommand`: 309 lines, cyc **132** (94 conditions-only), the highest single function in LinearViewer, a 12-arm `switch (command)` (recover / poll / take / handoff / feedback / usage / wait / stop-broker / ledger / open / status). `waitLoop` `:1274-1358`: 85 lines, cyc 48 (43), nesting **6**, the deepest in the file. **Second site / delta:** file 1,104 → 1,382 lines; `runCommand` span 262 → 309 and cyc 114 → 132; 9 commits since 10-12 (LIN-3451, 3495, 3496, 3630, 3667, 3669, 3670, 3675, 3685); 21 in 90 days. **Cost:** six control-flow defects were filed against this loop in the window (LIN-3667, 3669, 3675, 3676, 3685 Done; LIN-3707 and LIN-3511 Backlog), each a path that escaped with no reason or acted on stale state, which is what a depth-6 loop with inline effect sequences produces. The file is served to users' machines (`routes/runner-kit.js`) and `lib/prompts/runner-kickoff.js:85-89` computes a sha256 of each kit file when it builds the runner prompt, so every edit changes what new runs are told to trust. It was recorded on 10-12 for low churn; churn has risen. No structural owner (LIN-3707 / 3511 are behavioural; Drift owns the contract multiplicity, LIN-3451 Done, LIN-3624 the marker set). The mint requires characterization tests first.

### F-sd-runopencode · **MED-HIGH** · disposition: **recorded-not-promoted (next in line)**
`simple-dispatcher/opencode-runner.js:1076-1843 runOpenCode`: 768 lines, cyc **132** (116 conditions-only; tied for the highest in either repo), inclusive DP 181. The same `updateStateFn((s) => { const rec = s.sessions[sdSessionId]; if (!rec) return; …` commit block appears five times (`:1547`, `:1573`, `:1654`, `:1721`, `:1816`) with an exact FAILED-commit twin at `:1721-1738` ↔ `:1816-1830`; the terminal-phase guard line appears seven times; comments at `:1714` and `:1808` cite stale line numbers. Open defects live in that block: LIN-3076 (half done), LIN-2679 (item 1 fixed by `1a7fd15`), LIN-2657, LIN-2652, LIN-2765, LIN-1707. **Why not minted:** LIN-3544 (`runStallFailsafe`, the SD decomposition) is Backlog and unstarted, with no branch, commit or PR; `runOpenCode` had no body commits since 10-12 (31 file commits in 90 days, none in the function body), so a second SD decomposition would queue behind an unstarted one. Ranked by risk × churn it is next: span 768 × 31 = 23.8k against `processPolledItem` 20.6k and `hook.js main` 9.7k. Cheap first cut when it is promoted: one `commitRunnerOutcome(rec, phase, {residueGuard})` helper, which also closes LIN-3076. Watch `runOnce` (the only growing SD giant).

### F-kpi-twins · **MED** · disposition: **recorded-not-promoted (first candidate next edition)**
`public/kpis.js:166-226` ↔ `public/workspace-kpis.js:38-99`: 8 strict and 20 loose-B shared windows (my scan, `cq-dup-windows-lv.txt`: not present at `1ef562ce`), plus `render-kpis.js:186` ↔ `render-workspace-kpis.js:116 doneTotalHtml`, `LOOKBACK_DAYS = 7` in both, and `kpis.css:256-280` ↔ `escalation-kpis.css:109-133` (25 lines). All born with LIN-3732 and 13 commits in 3 days (LIN-3689, 3710, 3711, 3713, 3714, 3724, 3732, 3733), and born after Drift 10-19, so no Drift row names them. **Cost:** LIN-3732 already had to touch both pages for one feature. **Why not minted:** smallest of the candidates (the pair is ~60 lines), and two of the last three mints (LIN-3544, LIN-3546) are still unstarted; restraint wins this edition. If the pair is touched a third time in a feature, promote.

### F-hidden-dup · **MED** · disposition: **cross-link Drift (`mock-ai-builder-copies`, no owner) + method note**
The wave rewrote copies past scanner thresholds; they persist:
- **Mock-builder trio**: `lib/workspace-api-mocks.js:186 buildMockRecapContext` (and siblings at `:222`, `:239`), `routes/proxy-compute.js:110/151/191`, `routes/task-chat.js:61`. Shared lines with the old copy fell to 7/76, but the behaviour is the same. Cost already paid once: LIN-3659 (`35031d6d`) patched the same open-child predicate in three files separately. Stale "mirrors workspace-api.js" comments remain at `proxy-compute.js:108`, `:188`, and `task-chat.js:58`. The mocks module now exports pure functions, so the fix is to import them. Multiplicity is Drift's; that the scanners stopped seeing it is ours.
- **Ref resolvers**: `routes/workspace-api.js:506-527` ("mirroring the proxy write path", `:499`) ↔ `routes/proxy.js:1203-1230 resolveTeamInput`; `partialWriteFailed` `workspace-api.js:606` ↔ `proxy.js:1261`.
- The strict windows that vanished are the wave's genuine wins (`proxy-compute` ↔ `workspace-api` 51 → 0; `task-chat` ↔ `workspace-api` 24 → 0 in my scan; the research scan read 49 and 22). The rest are unchanged. Copies no prior report named are **unbounded by construction** (window, census and verbatim all miss a rewrite past threshold); this class is bounded only for known members.

### F-workspace-api · **MED** · disposition: **cross-link LIN-2246 (partly satisfied, title stale)**
`routes/workspace-api.js` 4,673 → 3,782 lines; `createWorkspaceApiRoutes` span 4,364 → 2,950, inclusive DP 736 → **417**; still ~30 routes in one closure, 99 commits in 90 days. The 08-23 stages 1–2 landed (the roadmap and prompts siblings `routes/workspace-api-roadmap.js` 873 and `-prompts.js` 131); stage 3 is blocked on LIN-680 (Backlog) and about 17 endpoints never got a target module. LIN-2246 is Todo with a title citing 4,388 lines: **partly satisfied, title stale**. Not minted: owner exists and the wave already halved it.

### F-server · **MED** · disposition: **recorded-not-promoted (LIN-1249, numbers stale)**
`server.js` 4,582 → 4,657 lines, still #1 on churn (210 commits in 90 days, ~978k). Re-opened as the 10-12 report asked: its cost is **wiring breadth, not decision points** (32 inline routes, 42 mounts, 182 imports; worst unit `resolveWorkspaceAccess:2625` inclusive DP 36, no unit over 40). A decomposition would move no decision points, so it does not meet this review's bar; the structural owner LIN-1249 stands but its title ("2542-line") is stale, and four of the five helpers it names are still there.

### F-runstall / F-prompt-section · **MED** · disposition: **cross-link LIN-3544, LIN-3546 (unstarted; not re-minted)**
`reapers.js runStallFailsafe` span 950, inclusive DP 162, unchanged, still hosts LIN-2470 (verified real: memo at `reapers.js:1915-1919`, `.reason` read unguarded at `:1932`; the sibling guard is `dispatcher.js:1821-1827`) and LIN-2568 (else arm at `:2569-2574` is probably unreachable for opencode, since `findStalledExecuting` skips sessions without `transcriptPath` at `:975`; better pinned by a test than fixed). `public/prompt-section.js init` span 822 → 826 (LIN-3546). No work has started on either; open SD PRs #199 and #112 do not touch `reapers.js`. Correction to 10-12: the "post to item" block appears 3×, not 7×, inside `runStallFailsafe`. The resume-arm field-clear twin (`dispatcher.js:281-327` vs `reapers.js:2384-2399`, `:2403-2427`) persists with differing field sets; reaper comments cite stale `dispatcher.js:244/246`.

### F-hotspots-never-reached · **LOW–MED** · disposition: **recorded-not-promoted**
Mid-length, high-complexity units no edition ranked by complexity before (own cyc / conditions-only / span / function-body commits in 90d / since 10-12 / owner):

| unit | cyc / cond | span | 90d | since 10-12 | owner |
|---|---|---|---|---|---|
| `lib/unanswered-decisions.js:450 collectUnansweredDecisions` | 63 / 44 | 269 | 17 | 0 | none (rulings path) |
| `lib/agent-turn.js:176 runAgentTurn` | 60 / 57 | 406 | 14 | 1 | none (chat turn path) |
| `lib/openrouter.js:1007 getRecommendationStream` | 45 / 32 | 235 | 11 | 0 | LIN-1250 |
| `lib/terminal-marked-task-cost.js:215` | 57 / 55 | 475 | 9 | 2 | none (cost KPI) |
| `lib/run-closeout-state.js:148 deriveCloseOutState` | 48 / 44 | 209 | 9 | 1 | none (LIN-3649 behavioural) |
| `lib/plan-review-round-trips.js:569` | 48 / 41 | 223 | 7 | 0 | none |
| `lib/ci-wake-sweep.js:271 sweepOneWorkspace` | 52 / 42 | 142 | 3 | 3 | Drift #3 locus; new |
| `lib/connection-credential.js:1251 convertToConnectionBacked` | 46 / 42 | 125 | 2 | 0 | Drift #1 / LIN-2150 locus |
| `lib/ship-biscuit.js:343 buildEditionModel` | 52 / 49 | 117 | 1 | 0 | none |
| `lib/next-run.js:294 formatNextRunContext` | 57 / 44 | 124 | 0 | 0 | none |

By risk × churn only `collectUnansweredDecisions` and `runAgentTurn` stand out, and both are flat since 10-12 (0 and 1 body commits). **Recorded-not-promoted**; first promotion candidates if either starts changing. For the two Drift loci the complexity is ours and the multiplicity is Drift's.

### F-census-core · **LOW–MED** · disposition: **recorded-not-promoted (owner LIN-3549 / LIN-3628)**
`scripts/code-shape/census-core.mjs:48 runCensus`: 782 lines, cyc 145, the highest single unit in either estate. It is the instrument three periodicals rely on, so a wrong census silently mis-steers Drift and Seams & Tangles. Tested (`census-core.test.mjs`); 17 commits in the kit directory in 90 days. Recorded. Note for LIN-3549 / LIN-3628, not a subtask: the kit could emit inclusive and conditions-only figures per unit, which this edition computed by a throwaway sum.

### F-experiments · **LOW–MED** · disposition: **recorded-not-promoted (out of the measured scope; surfaced by the second read)**
`experiments/` is outside the include regex and holds the largest share of the window's added lines: 513,993 of the added lines in `git diff --numstat 1ef562ce HEAD` (against `lib/` 16,172, `routes/` 3,948, `tests/` 25,480, `docs/` 71,897). It includes frozen pre-rebuild copies of the giants the wave removed: `experiments/rebuild-rung5a/replay/pinned/origin-main/dispatch-factory.js` (`createDispatchItem`, span 913), `experiments/rebuild-rung7/replay/pinned/origin-main/workspace-api.js` (`createWorkspaceApiRoutes`, span 4,364) and `experiments/rebuild-rung5c/replay/pinned/server.js.ref`. Neither CI nor `package.json` references the tree, so there is no runtime risk; the cost is measurement: any scan not scoped as this one is will re-find those copies as duplicates and as giants, and the dead-export grep here never sees them. **Disposition:** recorded; the figures in this report are the production slice only. Whether pinned replay fixtures belong in the repo is a repo-hygiene question for the owner of LIN-3549, not a decomposition target.

### F-orphans · **LOW** · disposition: **recorded-not-promoted**
- **`lib/plan-fee-config.js` is a whole-module orphan**: LIN-3703 dropped its only production caller (the old `server.js` use); only `tests/unit/plan-fee-config.test.js` imports it (verified by grep over `server.js lib routes public tests scripts`; the only other mention is `scripts/code-shape/areas.json`). `lib/weekly-budget.js` still cites it.
- Compat re-exports left behind: `lib/dispatch-factory.js:119` (LIN-3706), `lib/tree.js:188` (LIN-3727). Exports orphaned by the wave: `prompt-templates.js:348 getAvailablePrompts`, `recommendation-facts.js:444 reviewLoopExhausted`, `workspace-owner.js:115 isOwnerAnswer` (whose doc at `:27` still says callers go through it). `workspace-api.js:102-103` re-exports a test-only mock with a comment that wrongly says the dashboard uses it.
- Dead exports: fully dead 15 (same set as 10-12), test-only 95 → 113 (19 born, the orphans above).

### F-store-css-swim · **LOW** · disposition: **recorded-not-promoted (unchanged from 10-12)**
`clear(urlKey)` family: 20 members, unchanged, first window with no growth. `public/swim.js:1655 drawBlockingConnectors` ↔ `:2041 drawBlockingConnectorsVertical` (both span 375, cyc 32; 185/260 shared lines, byte-identical, zero churn). `style.css` ↔ `swipe.css` 112-line block persists; `swim.css:835-836` still dead. Zero churn, so risk is deferred, not growing.

### F-sd-other · **LOW** · disposition: **recorded-not-promoted / clean**
`e2e-smoke.js` (2,066 lines): a manual harness, 6 commits in 90 days, with copy-pasted scenario runners (windows of 12 and 9) that drift from the runner contract (LIN-2377). `scripts/floor-report.mjs`: operator tool, 0 commits in 90 days. `config.js`: declarative; its cyc is `parseInt(env) || default` (the `0` → default hazard is LIN-2588 / LIN-2482), not a decomposition target. SD cross-repo and in-repo duplicate pairs: 0 at both SHAs. Process note, not a code finding: three SD main commits are titled "do not merge" (`55cb461`, `4c9fb76`, `b43fdca`).

### Clean results
`lib/dispatch-entrance.js` (above); `lib/account-erasure.js` (new, 1,051 lines, 152 functions, worst cyc 31, 2 commits; S&T handed it here: **clean**); rebuilt renderers, `pipeline-loops`, `task-page-loader`, Agent API routes, Jira ADF codec and free tier (DP down, regrowth ≤ +29); `lib/proxy-preamble.js` (822 lines, `provisionBootstrapToken` cyc 31, 0 commits since 10-12; placement is S&T F4 / LIN-3738; recorded, not promoted); `lib/providers/*` (direction is S&T F3).

---

## 4. Class dispositions

| class | bound | result |
|---|---|---|
| C1 span ≥ 200 | `shape.mjs --functions`, LV 103 → 90, SD 9 → 9 | named units above; the remainder are not findings by themselves |
| C2 cyc ≥ 50 / ≥ 30 | LV 21 → 10 / 93 → 76; SD 11 → 11 / 28 → 28 | §3 hotspots table and F-runner-kit / F-sd-runopencode |
| C3 inclusive-DP top units | top 60 per run in `cq-top-units-*.json` | §2 |
| C4 rebuilt files | 20: all within ±13 DP of post-rebuild except kpi-stats +68, adf +29, task-page-loader +26 | clean; regrowth recorded |
| C5 new production modules | 31 from `git diff --diff-filter=A 1ef562ce HEAD` over the include regex; every one with DP ≥ 25 read | `account-erasure` 281, `dispatch-entrance` 251, `ci-wake-sweep` 117, `kpi-daily-rollup` 73, `question-card` 58, `question-cards` 57, `workspace-api-mocks` 50, `chart-helpers` 37 are all clean or recorded above |
| C6 duplicate windows | my 8-line scan (`cq-dup-windows-lv.txt`) at both SHAs, direction only: it is a different approximation from the 10-12 scanner and does not reproduce its absolute counts | gone: proxy-compute ↔ workspace-api, task-chat ↔ workspace-api; born: kpis twin; rest unchanged |
| C7 hidden duplicates | known members bounded by shared-line count; **unnamed copies unbounded by construction** | F-hidden-dup |
| C8 dead and orphan exports | fully dead 15; test-only 113; 1 orphan module | F-orphans |
| C9 `clear(urlKey)` | 20 | unchanged |
| C10 carried tickets | §5 | live states |

## 5. Carried items and owner verdicts (live state at review time; updating these tickets is outside remit)

| ticket | state | verdict |
|---|---|---|
| LIN-3544 | Backlog, unstarted | cross-link; not re-minted; still hosts LIN-2470 (real) and LIN-2568 (likely unreachable: pin with a test) |
| LIN-3545 | Done | **verified**: `createDispatchItem` span 913 → 199, cyc 181 → 51; residual work owned by LIN-3607 / 3608 / 3609 / 3649 |
| LIN-3546 | Backlog, unstarted | cross-link; not re-minted |
| LIN-2246 | Todo | **partly satisfied, title stale** (4,388-line citation; now 2,950) |
| LIN-1249 | Backlog | **numbers stale** (title says 2,542 lines; now 4,657); intent stands; cost is wiring breadth |
| LIN-2398 | Backlog | **stale** (`dispatch-store.js` 2,178 → 3,050 lines; `addFeedback` 399 / cyc 60, 0 body commits since 10-12) |
| LIN-3349 | Backlog | run page only; does **not** cover `createDashboardRoutes` |
| LIN-3112 / LIN-3113 | Backlog | unchanged since 10-12 |
| LIN-3016 | Backlog | the hand-copied formatter copy is still at `proxy-dispatch` |
| LIN-1456 | Backlog | **stale**: SD has CI (`.github/workflows/ci.yml`) |
| LIN-1760 / LIN-2847 | Backlog | unchanged |
| LIN-3353 / LIN-3355 | In Progress | code merged; held for two live post-deploy checks (LIN-3355 comment of 10-08), not merely stale |
| LIN-2679 | Backlog | item 1 fixed by `1a7fd15` |
| LIN-3076 | Backlog | half done |
| LIN-2568 | Backlog | else arm still at `reapers.js:2569-2574`, probably unreachable for opencode |
| Drift's LIN-3417 citation | | should point to LIN-3649 |
| LIN-3607 / 3608 / 3609 | Backlog | entrance behaviour divergences; owners of the dispatch-entrance residue |
| LIN-3549 / LIN-3490 / LIN-3449 | In Progress | umbrella / measure / coherence loop |
| LIN-2150, LIN-2071, LIN-1250 | Todo / Backlog | credential multiplicity (Drift), `render-settings`↔`common.js` window, `getRecommendationStream` |

## 6. Follow-ups minted

| ticket | finding | related |
|---|---|---|
| **LIN-3742** — Design-first rebuild of `routes/dashboard.js createDashboardRoutes` (run page excluded) | F-dashboard | LIN-3740, LIN-3349, LIN-3549 |
| **LIN-3741** — Decompose `lib/runner-kit/runner.mjs runCommand` + `waitLoop` (characterization tests first) | F-runner-kit | LIN-3740, LIN-3707, LIN-3549 |

Search-before-mint was re-run immediately before each create (`runCommand`, `waitLoop`, `runner-kit runner`, `createDashboardRoutes`, `routes/dashboard.js`, `dashboard router`, `kpis.js workspace-kpis`, `KPI duplicate`, `doneTotalHtml`, `LOOKBACK_DAYS`). No ticket named the same finding. Two mints against a cap of about three; the third candidate (F-kpi-twins) is deliberately held.

## 7. Method notes and limits

- Churn counts move by a few commits with the instant of measurement; only the ranking is relied on.
- Function-body commit counts come from `git log -L` and were taken in the research stage; they were not re-run here.
- The 8-line duplicate scan here is a re-implementation and does not reproduce the 10-12 scanner's absolute counts (36 pairs against 6 at `1ef562ce`); it is used for the direction of change only. The figures quoted as "research scan" (49/22/20/8/5/5) come from the 10-12 scanner re-run in the research stage and are not re-derived here.
- `public/` classic scripts appear as `<module>/λ@N` rows: files, not functions.
- Units outside `server.js|lib|routes|public` that execute at runtime: `routes/runner-kit.js` serves `lib/runner-kit/*.mjs` (covered); `scripts/` are operator tools (SD's `floor-report.mjs` read; LinearViewer's `scripts/code-shape/*` read as F-census-core). Zero parse failures at all four measurements.
- Test files were not audited (LIN-3517 owns the test estate).

## 8. Adversarial Second-Read

**Tier used:** Tier 2 (a fresh-context sub-agent with no memory of the report-writing turn; it was given the report path and the two repo paths only).

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's answer (in full):**

> The largest item the report missed is the `experiments/` tree: about 514,000 added lines (about 20.6 MB) of the roughly 620,000 added across the window. The report never mentions it. Its include regex drops `experiments/` and `scripts/` apart from `code-shape`. `git diff --numstat 1ef562ce HEAD` by top directory: `experiments/` 513,993; `docs/` 71,897; `tests/` 25,480; `lib/` 16,172; `scripts/` 3,811. `experiments/` has 570 files, about 431k lines of them JSON, about 59k lines of `.mjs`/`.js`. `shape.mjs` over `^(scripts|experiments)/.*\.[cm]?js$` parses 523 files, 70,666 code lines and 31,995 decision points, more than the report's production total (28,252), which the report wrongly calls "whole-tree".
> The headline (the wave removed complexity) is unaffected, but `experiments/**/replay/pinned/origin-main/*.js` (13 files, about 24.9k lines) and two `.ref` files are frozen copies of the pre-rebuild giants: `createDispatchItem` at `experiments/rebuild-rung5a/replay/pinned/origin-main/dispatch-factory.js:333` (span 913, cyc 181), `createWorkspaceApiRoutes` at `experiments/rebuild-rung7/replay/pinned/origin-main/workspace-api.js:310` (span 4,364), `server.js.ref` (4,582 lines). The old complexity is still in the repo, the rebuilt code's duplicates will be re-found by any window scan not scoped as the report's is, and the dead-export grep never sees them. Not referenced by CI or `package.json`: no runtime risk, a hygiene and measurement miss.
> It outranks the top finding by size, but within production code the ranking is right: `createDashboardRoutes` has own cyc 29 and spans `routes/dashboard.js:507-3039`; `runCommand` is the highest single function (cyc 132 / 94). Minting LIN-3742 then LIN-3741 is defensible. The weakness is the scope claim, not the ranking. Spot-checks all matched HEAD: dashboard, `buildSessionPayload` (188 / 28), `createWorkspaceApiRoutes` (cyc 12), `runCommand` and `waitLoop`, the hotspot rows, `plan-fee-config.js` orphan, `runCensus`. Smaller gaps, not checked in depth: SD gained three small modules (`host-heartbeat.js`, `host-heartbeat-sender.js`, `auth-stop.js`) and `reapers.js` grew ~164 lines; `scripts/survey-*.mjs` have module-level cyc 110–170 but predate the window.

**Resolution.** The reader's numbers were re-run by the author (`git diff --numstat` by top directory, and the three pinned paths exist). The scope claim was corrected in place (§Method and the trend statements now say "production slice") and the item is recorded as F-experiments. The ranking and the mint set are unchanged: the reader confirmed the production ranking, and the experiments tree has no runtime or churn risk.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
