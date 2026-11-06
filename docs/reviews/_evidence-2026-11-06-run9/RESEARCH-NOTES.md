## Research notes: Seams & Tangles run 9 (LIN-4323)

**Measured:** baseline `af55cb737ec4e63919bac65558b35498ede3d290` (run 8's measured commit) → `5c63aa261a2de891907c9b8d567f9932ed1985d0`. That was still origin/main after a fresh fetch at about 11:10Z, so mint-time and run-time HEAD are the same commit. Staleness check: `git log --since=2026-11-06T11:06:06Z origin/main` is empty.

**Evidence:** work branch `lin-4323-seams-run9`, folder `docs/reviews/_evidence-2026-11-06-run9/` (`README.md` lists each file and its command). The names `seams-tangles-review-2026-11-06-run9.md` and `_evidence-2026-11-06-run9/` were free on main. No PR yet. No prior run's evidence is touched.

### 0. Reproduction and window (ticket grounding checked)
- **Window:** 15 first-parent commits, 2026-11-05 20:06Z → 2026-11-06 10:56Z. 6 touch `lib routes public server.js`: 20 files, +368 / −109. No production file added or deleted (as minted). Tests: 49 files, +2,609 / −1,230. The rest is docs: Drift run 4, Comprehension run 5, run 8, the Survey sync LIN-4314 (puts `docs/plans/survey/` on main), and the LIN-4315 paper.
- **Empty diffs:** `scripts/code-shape/`, `lib/runner-kit/`, `docs/runner-prompt.md`, `docs/dispatch-integration.md` and `docs/architecture/source-map.md`.
- **One guide.** `areas.json` is blob `642e9405` at both commits, byte-identical to run 8's copy. The tool blobs are unchanged (`34f11434`, `c3a39f37`, `763a37b8`, `42a1e521`).
- **Run 8 reproduces.** At `af55cb73` the seams JSON, cochange JSON, edge dump, P7min run, window-commit list and unmapped set all equal run 8's, apart from the guide-path string.
- **Scope:** 544 → 544 files. 0 parse failures, 0 non-literal dynamic imports, 0 unmapped source files, and 4 unresolved relative imports (`routes/test.js`, F8) at both commits. `lib/` → `routes/`: 0 at both.
- **Grounding corrections:**
  - `lib/proxy-scopes.js` changed only a header comment ("three" → "four enqueue mounts"). It is still a no-import leaf. The narrowing the ticket attributes to it is `lib/dispatch-validation.js:17`: `getPeriodicals` → `getPeriodical`.
  - `lib/dispatch-entrance.js:68` imports **seven** names from `periodicals.js` at HEAD, not six (it imported two).

### 1. Import graph: what moved (all code; no placement change)
| commit | files | links | pairs | group | Other | F1 |
|---|---|---|---|---|---|---|
| af55cb73 | 544 | 1271 | 12 | 9 | 17 | 31/37 |
| 5c63aa26 | 544 | **1272** | 12 | 9 | 17 | 31/37 |

- **Exactly one file edge added, none removed:** `lib/render.js:28 → lib/periodicals.js` (Pages → LLM, `periodicalPromptName`; LIN-4313 `c491eca5`). Intra-area edges stay at 784.
- **Directed links:** Pages → LLM 36 → 37. No other link moved. LLM → Pages is 0, so no pair opens.
- **The ticket's three questions:**
  - *Does F1 grow?* No. It is 31/37 at both commits. `dispatch-entrance → periodicals` already existed: it widened from 2 names to 7 over the same edge, in the Runs → LLM direction (run logic consuming the prompt registry).
  - *Does a pair open or widen?* No pair opens. One existing one-way link (Pages → LLM) gains one edge.
  - *Is `periodicals.js` a new hub?* Not by graph shape. Importers go 7 → 8 and areas 3 → 4 (adds Pages). Cross-area names imported go 9 → 15. Outbound stays 1 (`prompt-template-defs.js`, intra-LLM). So it is a wide-in, narrow-out provider: everything points into it and it points at nothing outside LLM. Its content is now mixed, though. Beside the registry it holds one prompt renderer for both the UI and the mint, the prompt-name rule, an operator-note validator, and the `+ Autopilot` variant sniff. It grew 1151 → 1259 lines (size is Code Quality's). Named `hub:periodicals.js`, Low–Medium, watch.

### 2. Per-layer audit (each layer the window touched)
**L1. The periodical mint (LIN-4313 `c491eca5`, LIN-4317 `f2816e17`): Agent API → Runs → LLM, with Pages.**
- **New way in:** `POST /api/proxy/periodicals/:id/mint` (`routes/proxy-dispatch.js:297-312`, route at `:310`), gated on `requireGrant('dispatch')`.
- **It does not write its own enqueue.** It calls `enterPeriodicalMint` (`lib/dispatch-entrance.js:2040`). Runs's dispatch entrance goes from 4 lanes to 5 (`enterSessionDispatch`, `enterProxyDispatch`, `enterRecommendDispatch`, `enterKickoff`, `enterPeriodicalMint`). Its importers are unchanged: 3 in all, 2 cross-area, both from Agent API (S16). This is Runs's way in holding. The 2026-10-20 run called `dispatch-entrance` "an emerging front door for dispatch decisions, not yet for the area"; this lane is that front door working as intended.
- **One renderer:** `renderPeriodicalPrompt` (`lib/periodicals.js`). Both `buildPeriodicalNodes` (UI) and the mint call it.
- **One name rule:** `periodicalPromptName`. `lib/render.js:660,674` and the mint both use it. This is the one new edge, and the second copy of `${title} + Autopilot` it would otherwise need is avoided.
- **One lookup:** `getPeriodical(id)` (validation, grant rule, mint).
- **One grant rule:** `declaresPeriodicalGrant` (`lib/dispatch-entrance.js:1218`).
- **Residue, owned:** on the session lane, the variant is still learned from the rendered prompt text. `declaresDispatchGrant` calls `isAutopilotVariant(prompt)`, an `includes` of `PERIODICAL_AUTOPILOT_TAIL` (`lib/dispatch-entrance.js:1226-1227`, `lib/periodicals.js:1131`). An authority decision rests on a text contract between browser markup and Runs, which the import graph cannot see. **LIN-4318** (Backlog) owns the cure ("the app mints Periodicals by id; no grant decision reads prompt text").
- **Verdict:** a better seam. Named `seam:periodical-mint`, healthy (new as named), with an owned residue.

**L2. The browser seam (F6): LIN-4292 `b389f9b0`, LIN-4304 `f742e5ac`, LIN-4309 `8b84a8fe`, LIN-4310 `ff6a69fa`.**
- **Assignments, run 8's strict method:** `public/` 66 → **67**; `common.js` 51 → 51. The loose series is 107 → 108. The one added line is `window.LiveConsoleLane = { laneNode }` (`public/live-console.js:1367`, LIN-4310). Its comment says "nothing else reads this global". Its only consumer is `tests/unit/helpers/live-console-world.js:34`. It sits beside the file's existing `module.exports` branch (`:1361`), which `loadWorld`'s vm cannot reach.
  - So this is the **first browser global added for a test consumer only**. The nearest precedent, `public/app.js:653` `window.refreshWaitingOnYou`, is also the tick's real listener.
  - Severity contribution: Low. It is a direction note: the test harness now reaches production through `window`.
- **Reads:** `window.QuestionCards` reads in `prompt-section.js` stay at 2 (`:1030`, `:1043`). Across `public/`, 23 → 23 by `git grep -o`. That is a different pattern from run 8's 17/18, so it is not compared with run 8.
- **Script lists:** unchanged. `/cost-format.js` is still in 6 lists, and Home's list still has 14 entries (`render.js:383 → :384`, line shift only).
- **LIN-4292 and LIN-4304 are a spelling rule, not a seam.** They removed method-presence guards (`x.querySelector ? x.querySelector(…) : null` and similar) across 12 `public/` files. `tests/unit/public-element-method-guards.test.js` (new, 289 lines, AST-based) refuses an unlisted guard. Its allow-list holds 3 entries, all in `close-out.js`, for a stub suite LIN-4254 will move.
  - **What it does at area level:** no cross-script coupling moved. No markup attribute, event or script list changed in the diff. It is the browser code trusting the DOM rather than bending to test stubs. Together with L3, the burden of fidelity moves to the shared fake.
  - The window both stops production bending to stubs (L2) and adds one global bent toward a suite (`LiveConsoleLane`). Read together: **mixed, mostly better**.
- **F6 stays Medium.** Delta: +1 assignment (test-only); guards removed; spelling held by a check.

**L3. The test-harness seam (not graded as an area).**
- `HAND_WRITTEN_FAKE_DOM_FILES` (`tests/unit/fake-dom-census.test.js:52`): **25 → 10** entries.
- Files importing `client-world.js` (`loadWorld`): 40 → 57. Files importing `fake-dom.js`: 17 → 19.
- `fake-dom.js` 860 → 1039 lines, `client-world.js` 107 → 134, the census 686 → 789.
- LIN-4254 and LIN-4311 / PR #2330 (OPEN, test-only: 6 files under `tests/unit/`) continue the moves.
- **What it means for browser rebuild readiness: better.** More `public/` scripts run under one machine-checked fake, which is the precondition run 8 named for refactoring F6. The cost is L2's test-only global. Churn is Stability's; duplication in suites is Code Quality's.

**L4. The catch-all (N1) and P7min.**
- 17 → 17 members, identical lists (`compare-run9.md`).
- P7min re-measured: at HEAD it gives links 1271, Other 16, LLM ↔ Other 1/1, and Agent API → LLM 37 → 38 (an existing direction). No pair opens. The result at `af55cb73` equals run 8's.
- The guide is unchanged, so P7min is still recommended and still unapplied.
- PR #2185 (LIN-4028) is still OPEN, last updated 2026-10-30. It would add `lib/routing-ruling.js` (N12). It also edits `lib/dispatch-entrance.js`, which this window changed by +104 lines; mergeability is UNKNOWN.

**L5. Change coupling (`cochange --days 60`, one guide).**
- **Totals:** 875 / 391 / 76 → 890 / 393 / 76. `shallow: false`.
- **Overlap:** 59.338 of 60 days (98.90%). The HEAD window is a strict superset by commit: **0 commits left and 15 entered**, because nothing landed between 09-06 19:02Z and 09-07 10:56Z. So every move is this window's own. With n = 15, **it is not a trend**.
- **Pairs that moved, each +2:** Agent API + Runs 105 → 107, Pages + Runs 92 → 94, LLM + Runs 87 → 89, Agent API + LLM 64 → 66, Pages + LLM 41 → 43, Agent API + Pages 34 → 36. The two commits are `c491eca5` and `f2816e17`, each touching Agent API, LLM, Runs and Pages (S12). That is L1's footprint: four areas per mint change.
- **The browser pairs did not move.** The four browser commits (LIN-4292, 4304, 4309, 4310) touched only `public/` plus tests (unmapped), so they make no pair. Browser + Pages stays 137 and Browser + Web routes 100.
  - The candidate seam is unchanged. This window shows browser code changing alone four times, which is the shape a seam would allow.
- **No-link pairs:** 19 → 19.
- **Unmapped 5746 → 6218 is +472 / −0, all outside the source remit:**
  - 383 `docs/papers` (the LIN-4315 paper and evidence);
  - 79 `docs/reviews` (41 run 8 evidence, 28 Drift run 4, 7 Comprehension run 5, plus reports);
  - 8 `tests/unit`;
  - 2 `tests/fixtures`.

**L6. What is unchanged** (checked at HEAD, S2–S18):
- F1, F3, F4 (11/10, anchor `proxy-preamble.js:153`), F5 (53), F7 (45/96) and F8.
- N2–N5, N7, N8 (alias + 2 comments, `wall-clock-summary.js:99`), N9, N11 and N12.
- N6: `cost-read.js` 762 → 762, 11 in / 7 out.
- `hub:dispatch-store.js` (8 / 10), `hub:tree.js`, `hub:render-run-steps.js`, the `workspace-` prefix.
- `server.js`: 4,713 lines, 209 imports, 30 inline routes; outbound by area identical.
- `seam:stage-contract` (no file of it changed).
- `map:stage-kind-roster`: `git grep -l survey-place` is still 9 files in 4 areas.

### 3. Better or worse, area by area (the operator's sentence)
- **LLM & prompts: better, with a watch.** There is one Periodical renderer, one lookup by id and one name rule, all in `periodicals.js`. The file is now a wider, mixed-content provider (registry, renderer, label, note validation, variant sniff): 8 importers in 4 areas, +108 lines.
- **Runs & dispatch: better.** The fifth enqueue lane enters through the shared `dispatch-entrance.js`, and the periodical grant has one rule. The session lane still reads the grant variant from prompt text (LIN-4318).
- **Agent API: better.** The new mint mount carries no enqueue logic of its own. No edge was added, and `proxy-scopes.js` is still a leaf.
- **Pages: better, by a small amount.** It reads the prompt-name rule from the registry rather than spelling it. +1 edge in an existing direction.
- **Browser code: mixed, mostly better.** About 50 method-presence guards are gone, and one spelling is held by an AST check. +1 test-only global (`window.LiveConsoleLane`).
- **Other features: unchanged (17, worse as a map since run 8).** P7min still fixes it.
- **Web routes, Auth, Providers, Platform, Reports, Task model, Wiring: unchanged.**

### 4. Classes and bounds
- **New cross-area file edges in the window.** Bound: `edgeList` diff. Members: 1 (`render.js → periodicals.js`).
- **Importers of `periodicals.js`.** Bound: edge dump plus `git grep "from '.*periodicals.js'"`. Members: 8 at HEAD (`dispatch-entrance`, `dispatch-validation`, `periodical-report-gate`, `render`, `routes/proxy-compute`, `routes/proxy-writes`, `routes/proxy`, `server.js`).
- **Enqueue lanes in `dispatch-entrance.js`.** Bound: `^export async function enter`. Members: 5 (4 → 5). Callers: `routes/dispatch.js`, `routes/proxy-dispatch.js`, `routes/proxy-kickoff.js`.
- **Grant decisions that read prompt text.** Bound: `git grep isAutopilotVariant|PERIODICAL_AUTOPILOT_TAIL -- lib routes`. Members: 1 call site (`dispatch-entrance.js:1227`), owned by LIN-4318.
- **`window.X` assignments added or removed in the window.** Bound: S4's `-U0` diff. Members: 1 added (`live-console.js:1367`), 0 removed.
- **Test-only browser globals.** Bound: `git grep -B3` over the assignment pattern in `public/` for test/suite/unit comments. Members: 1 (`LiveConsoleLane`). `refreshWaitingOnYou` is dual-use.
- **Allow-listed method-presence guards.** Bound: `PRESENCE_ALLOW`. Members: 3, all `close-out.js`.
- **Unbounded: none.** Simple Dispatcher is still flat CommonJS at `07c88f7a` (2026-11-04T23:46Z, no commits since; S13), so it stays outside `seams.mjs`.

### 5. Closing the audit
- **Searches that could have found a missed layer:**
  - `git diff --stat` per production commit (all 6 read);
  - the complete edge diff;
  - S4 for `window.X`;
  - `-U0` grep of the `public/` diff for `addEventListener|dispatchEvent|CustomEvent|data-|scripts:|window.` (only guard removals, the comment, and the one global);
  - the script-list lines (S19);
  - `git grep` for the periodical names.
- **Not done:** the app was not run and no e2e was run. `lib/dispatch-entrance.js` was read in the LIN-4313/4317 hunks only.
- **The set would be wrong if:**
  - a crossing went through a text contract other than the variant tail (for example the `.prompt-name` text the client reads, which is now one function server-side);
  - or Drift run 5 (LIN-4324, In Progress, same window) rules `isAutopilotVariant` or the mixed `periodicals.js` as its own. Then this run records them only at area level.

### 6. Existing tickets (checked 2026-11-06 ~11:15Z)
- **Backlog, unchanged:** LIN-4193, 4258, 4259, 4154, 4155, 3922, 3923, 3736, 3737, 3738, 3555, 2600, 1249, 4235, 4238 and 4244.
- **In Progress:** LIN-4028 (PR #2185 OPEN, 2026-10-30), LIN-4254, and LIN-4311 (PR #2330 OPEN, test-only).
- **Done:** LIN-4299 (Drift run 4). It recorded that Seams run 8 "has no hand-off yet" and took none of run 8's four hand-offs. **LIN-4324** (Drift run 5, In Progress) names them, `map:stage-kind-roster` included. So the roster hand-off now has an owner.
- **New and relevant:**
  - LIN-4318 (Backlog) owns the text-keyed grant variant;
  - LIN-4320 (Backlog) covers CLAUDE.md's enqueue list missing the mint (docs);
  - LIN-4302 (Backlog: VERB OVERRIDE lists 15 of 19 keys) belongs to the roster and is Drift's.
- **Duplicate searches:** "LiveConsoleLane", "window global test", "test-only global", "laneNode", "periodicals.js", "isAutopilotVariant", "periodical grant", "stage-writes", "stage kind" and "catch-all". No ticket names the test-only global or `hub:periodicals.js`.

### Surface Assessment
Surface Assessment: [lands cleanly]. The deliverable is a docs-only report plus evidence at the free names. The series' tools, guide and scripts are reused unchanged. The evidence scripts are per-run copies, the established convention, so no second representation is introduced.
