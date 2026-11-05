# Seams & Tangles Review — 2026-11-05, run 7 (delta vs the 2026-11-04 run 6)

Task: LIN-4249 · Parent: LIN-3549 · Previous: `seams-tangles-review-2026-11-04-run6.md` (LIN-4231, run 6) · Tools: `scripts/code-shape/seams.mjs` and `scripts/code-shape/cochange.mjs`. Neither changed in the window; the tools, the guide and the runner kit all have empty diffs.

Review-only. The only changes are this report and `docs/reviews/_evidence-2026-11-05/`. It proposes changes to the guide but does not edit it. Below, "E/" means that evidence folder.

**Headline: a small window, and only one knot moved by code.**
- **The window** has 11 commits, 9 of them production. Most of the production work is the Home "Waiting on you" feature (LIN-4241, 4242, 4243) and two task-page fixes (LIN-4048, LIN-4143). The rest is the last costs piece (LIN-4226).
- **The guide did not change**, so every difference is code. One guide (blob `642e9405`) serves both commits.
- **F1 grew +1 by code (30/37 → 31/37).** `model-routing-history` now calls the cost read directly. This is the one real change at area level.
- **The catch-all grew 14 → 16, and Pages ↔ Other grew 8/6 → 9/8.** Both come from two new files that no guide pattern names. A labelled experiment that places just those two files removes the Pages ↔ Other growth completely (§2, §7). This is a guide gap, not a tangle.
- **The costs rebuild is finished.** LIN-4195 and all nine of its pieces are Done. Run 6 deferred F1, N6 and N10 because the cost code was "still moving". That reason has expired, and the cost-area decision can now be measured (§7 P2). It goes to LIN-4193 as a comment, not a new ticket.
- **The Home/task-page seam has one way in** on each side: one ruling read and one renderer on the server; one tick, one keyed merge and one placement policy in the browser (§4). The browser half adds 7 `window.X` globals (F6).
- **A correction to run 6:** its change-coupling "top 10" table carried run 5's set of pairs. At `d7ceb373` the real top ten included Runs + Wiring (81) and Pages + Wiring (79) (§6).
- **No follow-ups are minted** (§9).

## 0. What was measured

- **Commits.**
  - Baseline: `d7ceb373444f9efbc027656132352d247535aa5e`, run 6's measured commit.
  - Measured: `2eb73ae07fb7297fc0fa057a6198aa8cbe901558`. It was origin/main when the ticket was minted (2026-11-05 07:53Z), and still origin/main after a fresh fetch while this report was written.
  - The window `d7ceb373..2eb73ae0` has 11 commits (E/supplementary-figures.txt §S0):
    - 2 docs-only: `43dd0d64` (run 6) and `476d9ad4` (Drift & Coherence 11-04 run 2);
    - 9 production: `c55f0fb3` LIN-4226, `950113b1` LIN-4234, `279dcb0a` LIN-4240, `94195271` LIN-4241, `ee8ec42e` LIN-4242, `172f644a` LIN-4243, `13fe24a0` LIN-4151, `c70b004c` LIN-4048, `2eb73ae0` LIN-4143.
  - The production diff (`lib routes public server.js`) is 44 files, +1,430 / −363.
  - Added: `lib/ruling-settled.js`, `lib/waiting-section.js`, `public/home-placement.js`. Deleted: none.
  - Empty diffs: `scripts/code-shape/`, `lib/runner-kit/`, `docs/runner-prompt.md`. Changed docs: `docs/architecture/source-map.md`, `docs/dispatch-integration.md`.
- **One guide is enough.** `scripts/code-shape/areas.json` is the same blob, `642e9405`, at both commits, and is byte-identical to run 6's HEAD guide copy (E/README.md). So seams and cochange were run once per commit with the one guide, and any difference between the runs is code.
- **Reproduction of run 6.** The `d7ceb373` seams and cochange JSON here match run 6's committed JSON key for key, apart from the guide path string. The `d7ceb373` edge list matches run 6's exactly (E/README.md). Every "run 6" figure below is therefore both run 6's published number and this run's baseline.
- **Scope.** 540 → 543 files. 0 parse failures, 0 non-literal dynamic imports and 0 unmapped files at both commits. 4 unresolved relative imports at both, all in `routes/test.js` (F8) (E/compare-run7.md:5-9).
- **Direction rule.** `lib/` → `routes/` imports are **0** at both commits, by the edge dumps and by `git grep` (E/supplementary-figures.txt §S1).
- **Witness.** Each edge dump's cross-area count equals the seams link total: 1259 and 1269 (E/compare-run7.md:11-14).

## 1. Changes since run 6 (first)

1. **F1 grew +1/+0 by code** (LLM → Runs 30 → 31). `lib/model-routing-history.js:12` imports `readCost` from `lib/cost-read.js` (LIN-4226). Unlike run 6's import of a guard function, this edge is called at run time: the history read hands the loader to `readCost` (`:40`). Run 6 predicted this edge.
2. **The catch-all grew 14 → 16 by code.** `lib/waiting-section.js` and `lib/ruling-settled.js` fall through to "Other features" (E/compare-run7.md:48-51). Neither is a wrong-way edge; each is a file with an obvious home that the guide does not name (N1).
3. **Pages ↔ Other grew 8/6 → 9/8, entirely by placement.** `waiting-section.js` is a page renderer. `lib/render.js` imports it, and it imports `question-card.js` and `task-page-href.js`, both Pages files. One intra-Pages edge (`render.js → question-card.js`) became three cross-area edges. Placing the file in Pages (P7min) gives 8/6 at both commits (E/guide-experiments.txt).
4. **The cost read's importers grew 5 → 7 cross-area, still from 4 areas.** The new ones are `lib/kpi-stats.js:47` (Reports) and `lib/model-routing-history.js:12` (LLM) (E/supplementary-figures.txt §S16). This is the number run 6 predicted for PR #2275.
5. **The browser seam grew.** `window.X =` lines went 100 → 107 in `public/`, and 52 → 55 in `public/common.js`. `public/home-placement.js` is new (F6; E/supplementary-figures.txt §S4).
6. **Wiring.** `server.js` gained one import (`:167`) and one inline route (`:3738`, `/api/home-waiting`). Wiring → Other went 8 → 9 (E/supplementary-figures.txt §S18).
7. **In-flight work closed.** LIN-4195 is Done and all its pieces are Done (LIN-4226 last, `c55f0fb3`). PR #2275 merged. PR #2185 is still open and untouched since 2026-10-30 (E/external-state-2026-11-05.txt).
8. **Correction to run 6** (§6): its change-coupling "top 10" label.

Unchanged by code: F3, F4, F5, F7, F8, N2, N3, N4, N5, N7, N8, N9, `hub:tree.js`, `hub:render-run-steps.js`, `hub:dispatch-store.js` (by import), the `workspace-` prefix item, the other ten knot pairs, and the knot group of nine. See §3 and §11.

## 2. Trend table and placement versus code

| commit | files | links | pairs | group | Other | F1 (LLM→Runs / Runs→LLM) | Pages ↔ Other |
|---|---|---|---|---|---|---|---|
| `d7ceb373` (run 6) | 540 | **1259** | 12 | 9 | 14 | 30/37 | 8/6 |
| `2eb73ae0` (run 7) | 543 | **1269** | 12 | 9 | 16 | 31/37 | 9/8 |

Source: E/compare-run7.md:11-35.

- **All code.** The guide is unchanged, so none of the +10 links is placement in the run 6 sense (a guide edit or a moved file). Code added 10 cross-area file edges and removed none (E/compare-run7.md:82-95):
  - LIN-4226 (2): `kpi-stats → cost-read` (Reports → Runs) and `model-routing-history → cost-read` (LLM → Runs);
  - LIN-4241 (3): `routes/dashboard-rulings`, `routes/workspace-api-issue-write` and `routes/workspace-api-scan` → `ruling-settled` (Web routes → Other);
  - LIN-4242 (5): `render.js → waiting-section` (Pages → Other), `waiting-section → question-card` and `→ task-page-href` (Other → Pages), `waiting-section → utils/html` (Other → Platform), and `server.js → waiting-section` (Wiring → Other).
  - Intra-area edges went 785 → 784: `render.js → question-card` was removed, because the section moved out of `render.js`.
- **How much of that is a guide gap** (labelled experiments, E/guide-experiments.txt; nothing edited):
  - **P7min** (place only the window's two new files): links 1259 → **1266** (+7), the catch-all stays at 14, Pages ↔ Other stays at 8/6, and F1 still goes 30/37 → 31/37.
  - **P1d** (place all 16 catch-all files): links 1249 → **1256** (+7), the catch-all is 0, the knot group has 8 areas at both commits, and F1 is the only pair that moves.
  - So 3 of the 10 new cross-area links exist only because `waiting-section.js` has no area. On any placed map, the window's area-level code movement is F1 +1 plus four one-way edges into Runs and Pages.
- **Directed counts that moved** (E/compare-run7.md:37-46): Web routes → Other 3 → 6; Other → Pages 6 → 8; Pages → Other 8 → 9; Wiring → Other 8 → 9; Other → Platform 1 → 2; LLM → Runs 30 → 31; Reports → Runs 13 → 14.

Knot pairs, a→b / b→a (E/compare-run7.md:17-35):

| pair | run 6 (`d7ceb373`) | run 7 (`2eb73ae0`) | status |
|---|---|---|---|
| Agent API ↔ LLM | 37/4 | 37/4 | unchanged |
| Agent API ↔ Providers | 20/3 | 20/3 | unchanged |
| Agent API ↔ Runs | 45/10 | 45/10 | unchanged |
| Auth ↔ Pages | 14/11 | 14/11 | unchanged |
| Auth ↔ LLM | 4/3 | 4/3 | unchanged (N3) |
| Auth ↔ Providers | 12/1 | 12/1 | unchanged |
| LLM ↔ Providers | 11/4 | 11/4 | unchanged (F3) |
| LLM ↔ Runs | 30/37 | **31/37** | grew by code (F1) |
| Pages ↔ Runs | 13/8 | 13/8 | unchanged |
| Pages ↔ Other | 8/6 | **9/8** | grew: guide gap (N1, `waiting-section`) |
| LLM ↔ Other | 1/1 | 1/1 | unchanged |
| Other ↔ Runs | 6/5 | 6/5 | unchanged |

## 3. Findings, severity-ranked, trend-framed

The stable names are run 6's (§11). Severity and trend are measured against run 6. Two new names are added (N11, N12); none is retired.

### Ranking note

F1 stays first: it is the High knot and the only pair that grew by code. F6 is second because it is the one place where the window's main feature added coupling the tool cannot see. N1 is third: it grew, but the growth is a guide gap, not code pointing the wrong way. N6 drops from "watch, still moving" to settled.

### F1 — `knot:agents-chat<->runs(chat-tools)` · **High** · **grew by code (+1/+0)**

- **Series:** 30/37 → **31/37** (E/compare-run7.md:30).
- **The edge.** `lib/model-routing-history.js:12` imports `readCost` from `lib/cost-read.js` (LIN-4226, `c55f0fb3`), and calls it with the loader passed in at `:40`.
  - This is a real dependency at run time: model routing's history reads Runs' cost read.
  - Run 6's runtime caveat (an import of a guard function only) does not apply to this edge.
- **Cost share.** 12 of the pair's 68 edges are cost-family: 6 LLM → Runs and 6 Runs → LLM (run 6: 11 of 67; E/supplementary-figures.txt §S8). The rest of F1 is chat tools, model routing and dispatch, unchanged in shape since run 4.
- **Reading.** F1's cost half is the cost family spread across LLM and Runs (N10). The costs rebuild is finished (LIN-4195 Done), so this is no longer a moving target. The decision it waits on is where the cost modules live, which is a guide decision that LIN-4193 owns (§7 P2, §9).
- **Survey.** `place-ledger.md:35` (LIN-4226 row: "LLM↔Runs (F1) +1") agrees (E/supplementary-figures.txt §S14).

### F6 — `knot:browser-window-globals(common.js)` · **Medium** · **worsened (100 → 107)**

- `window.X =` lines: 100 → **107** in `public/`, and 52 → **55** in `public/common.js` (48 → 51 with the strict pattern) (E/supplementary-figures.txt §S4).
- **The new globals** (LIN-4241, 4242, 4243):
  - `window.HomePlacement` (`public/home-placement.js:120`);
  - `window.onRulingsTick` (`public/common.js:3116`);
  - `window.dispatchesInFlight` (`public/common.js:934`);
  - `window.refreshWaitingOnYou` (`public/app.js:653`);
  - a second `window.dispatchPrompt` assignment in `common.js`.
- **The new file is reached only through a global.** `public/home-placement.js` has no import edges either way (E/compare-run7.md:76-80). How it was read instead is in §4.
- `/cost-format.js` is still in 6 script lists.
- **Change coupling.** The browser-code pairs are still the largest pairs with no import link (§6). 6 of the window's 9 production commits touched `public/`, 5 of them a script (E/supplementary-figures.txt §S12).
- **Owners.** LIN-4238 (Backlog) moves the Observation page's rulings rows onto the shared card merge. LIN-4244 (Backlog) makes the other answer surfaces handle `409 ruling-settled`. Both are client-side follow-ons of this feature. No ticket owns the globals pattern as such, and this report mints none (§9).

### N1 — `knot:other-features-catch-all(lib first-match)` · **Medium–High as a map, Medium as code** · **worsened, 14 → 16, by code into a guide gap**

- **The two new members** (E/compare-run7.md:48-51, :76-80):
  - `lib/waiting-section.js`: Home's "Waiting on you" renderer, moved out of `render.js` by LIN-4242. Imported by `lib/render.js:32` and `server.js:167`. It imports `question-card.js`, `task-page-href.js` and `utils/html.js`. It is a page renderer. The Pages pattern names `question-card` and `task-page-href` explicitly but not this file, so it falls through.
  - `lib/ruling-settled.js`: the frozen `409 ruling-settled` refusal (LIN-4241, 14 lines, no imports). Imported by three route files. It is a rulings constant. No area names `ruling-`, so it falls through, beside `ruling-standing.js` (N12).
- **Members at HEAD (16):** run 6's 14 (`cost-format`, `dashboard-refresh`, `home-pipeline`, `home-row-states`, `home-rows`, `home-view`, `key-state`, `key-state-holders`, `live-anchor`, `ruling-standing`, `subtree-index`, `task-facts-holder`, `task-state`, `usage-snapshot-intake`) plus the two.
  - 10 of the 16 are the Home and task-page read model.
- **Placement, not code.** P7min shows the whole Pages ↔ Other growth is this gap (§2). Wrong-way code is unchanged: `task-state.js:22` (→ `render-run-steps`), `home-row-states` (→ `task-page-loader`), `subtree-index` (→ `recommendation-facts`).
- **Survey.** `place-ledger.md:46` (LIN-4241, "one new file without a home") and `:47` (LIN-4242, "one new file without a home"; "Pages↔Other grew 8/6 → 9/8") agree.
- **Owners.** LIN-4193 (Backlog) covers the cost files (`cost-format` is left). LIN-3720 (Done) was the map ticket. The fix is a guide edit (§7 P1d), not a code move.

### N6 — `hub:cost-read.js` · **Medium (was Medium, watch)** · **grew as predicted; settled**

- **Cross-area importers 5 → 7, still from 4 areas.** The 7 are LLM `model-routing-history` and `model-routing-spend`; Reports `kpi-stats` and `workspace-kpi-stats`; Agent API `routes/proxy-compute`; and Web routes `routes/settings` and `routes/ship-biscuit`. All 11 importers are unchanged otherwise. Cross-area outbound is 2, unchanged (E/supplementary-figures.txt §S16).
- **One way to load records.** `readCost`, `lineageRecords` and `buildRunView` require a `requestSource` and throw without one, and the old `requestRows` argument is refused (`lib/cost-read.js:144-148`). Every caller passes the injected loader (N9). The direction is right: readers in four areas point into Runs, and the read points out only to `llm-call-log` and `utils/time`.
- **Shape.** 592 → 651 lines (E/supplementary-figures.txt §S0). It still holds two reads (lineage cost, and Harbour's own calls); LIN-4176 and LIN-4179 decided that on purpose. Its header still says "Pure: no store, clock or network" (`:34`). With loading now part of the read, that is true only because the source is passed in. The wording is Drift's to weigh.
- **Reading.** The cost read now has a fixed set of importers and one door. Run 6's "judge after #2275 merges" is answered: it merged, and the hub did not move further than predicted.

### N12 — `map:rulings-family-split` · **Low** · **new as named**

- **Rulings code spans six areas at HEAD:**
  - Runs: `unanswered-decisions`, `task-decisions-store`, `shelved-rulings-store`, `dismissal-suggestions-store`;
  - Other: `ruling-standing`, `ruling-settled`;
  - Web routes: `routes/dashboard-rulings`;
  - Agent API: `routes/proxy-rulings`;
  - Pages: `question-card`;
  - browser code: `public/question-cards.js`.
- PR #2185 (LIN-4028, open) adds `lib/routing-ruling.js`. Its name matches no pattern (LLM's is `model-routing…`), so it would land in the catch-all too (E/external-state-2026-11-05.txt).
- **Reading.** Like N10, the import graph draws a family the guide has no name for. The edges themselves point down into Runs (`ruling-standing → unanswered-decisions`). The split is a naming question (§7 P4), not a wrong-way dependency.

### N10 — `map:cost-family-split(pricing LLM, folds Runs)` · **Low–Medium** · **unchanged in shape (11 → 12 of F1's edges); now decidable**

- The cost code still spans four areas: LLM (`model-pricing`, `llm-call-log`, `model-routing-spend`, `model-routing-history`), Runs, Other (`cost-format`, `usage-snapshot-intake`) and Reports (`kpi-stats`, `workspace-kpi-stats`).
- Run 6 said to decide this after LIN-4195 closes. It has closed, so §7 P2 can now be measured. It has not been measured in this run.

### `wiring: server.js` · **Low, watch** · **+1 import, +1 inline route**

- 4,682 → 4,713 lines; 208 → 209 top-level imports; inline `app.<verb>(` routes 29 → 30 (E/supplementary-figures.txt §S0).
- The new route is `GET /workspace/:urlKey/api/home-waiting` (`server.js:3738`). It sits beside Home's other inline routes, not in a `routes/` factory.
- The shared ruling read is built once (`server.js:3313-3319`) and passed to both Home's page and the fragment.
- Wiring → Other 8 → 9; Wiring → Runs 45, unchanged (E/supplementary-figures.txt §S18).
- Owner: LIN-1249 (Backlog, "Decompose server.js"). Its numbers are stale (Code Quality's F-server says so too).

### `hub:dispatch-store.js` · **Low–Medium** · **unchanged by import; one more responsibility**

- 8 importers (7 cross-area from 4 areas), 10 imports out (3 cross-area), at both commits (E/supplementary-figures.txt §S16).
- LIN-4241 added `isDecisionSettled` and the stamp-once result `{ success: false, alreadySettled: true }`: 4,038 → 4,086 lines.
- The store keeps taking domain checks, as run 6 noted for the lineage-identity read. Size belongs to Code Quality, and the settled-check copies to Drift (`place-ledger.md:91`: "the scan-row settled check goes from 2 copies to 5").

### N11 — `door:home-waiting(one reduction, one renderer)` · **healthy, Low** · **new**

The way into Home's live Waiting section (§4). Recorded so the next run can tell whether it stays one door.

### N9 — `door:request-usage-loader` · **healthy, Low** · **unchanged in count; now required**

7 importers, 6 cross-area (E/supplementary-figures.txt §S16). The cost read now refuses to run without it (N6), which makes it the only way to load records rather than a preferred one.

### Unchanged (each checked at HEAD against code)

- **F2 `knot:runs<->page-renderers(render-swipe)`:** retired since run 4. Its successor, Pages ↔ Runs, is 13/8.
- **F3 `knot:providers->upward`, Medium:** Providers → LLM 4 and → Agent API 3. `parentNextOf` (`lib/recommendation-facts.js:226`) is still imported by the jira, linear and local providers (E/supplementary-figures.txt §S6).
- **F4 `knot:runs->agent-api(proxy-preamble)`, Medium:** 11 importer files, 10 cross-area. `applyDefaultDispatchHarness` is still at `lib/proxy-preamble.js:152` (LIN-4155).
- **F5 `knot:routes-as-libraries(dashboard)`, Medium:** 53 route → route edges, 3 cross-area (§S2).
- **F7 `knot:dead-import-inflation(routes/proxy.js)`, Low:** 45 of 96 named imports unused (§S3; LIN-2600).
- **F8 `knot:production-loads-routes/test.js`, Low:** the import is at `server.js:142`, and the call `installTestTokenLinearTransport()` moved from `:1215` to `:1216`. 4 unresolved fixture imports. Code Quality's F-test-routes hands the placement here.
- **N2 `hub:task-page-loader.js`, Medium (Runs):** 8 importers (7 cross-area), 20 imports out (9 cross-area). LIN-4143 changed 3 lines and no imports. `fmtDuration` is still imported at `:50` (LIN-4154).
- **N3 `knot:auth->llm(model-routing)`, Low–Medium:** Auth → LLM 4.
- **N4 `hub:run-controls.js`, Medium, watch:** 21 importers, 19 cross-area from 3 areas.
- **N5 `knot:task-model`, healthy:** 2 files, in no two-way pair.
- **N7 `door:request-usage-intake`, Low, healthy:** 3 importers.
- **N8 `map hygiene: deleted task-cost module still named`, Low:** the `task-cost|` alias plus 2 comments (`lib/model-routing-spend.js:5`, `lib/wall-clock-summary.js:97`) (§S5).
- **`map hygiene: workspace- prefix (Auth)`, Low:** the same 14 `workspace-*` files are in Auth. `workspace-api-mocks.js` has 6 importers (§S9).
- **`hub:tree.js`, watch:** 8 importers, 6 cross-area. The `:189` re-export is still there (LIN-3922).
- **`hub:render-run-steps.js` (FU-1), Medium:** 4 importers (2 cross-area), 4 imports out (4 cross-area). `fmtDuration` at `:258`. LIN-4240 changed lines but no imports.

## 4. The Home and task-page seam, including the browser half

LIN-4242, 4243, 4048 and 4143 all touched this seam. The tool reads the server half; the browser half was read by hand.

- **Server: one way in.**
  - **The data.** One ruling read, `createWaitingStanding` (`lib/home-row-states.js:82`). `server.js:3313-3319` builds it once and passes it both to Home's row states (`createHomeRowStates`) and to the fragment route (`server.js:3743`). It reads ruling standing through the live-run guard, which is now unconditional (LIN-4143; `lib/ruling-standing.js:15`, `lib/task-page-loader.js:1270`).
  - **The markup.** One renderer, `renderWaitingSection` (`lib/waiting-section.js:30`). Home's page calls it at `lib/render.js:291` and the fragment at `server.js:3749`.
  - So the page and a refresh cannot read different inputs or draw different cards.
- **Direction.** At the area level, Pages (`render.js`) → Other (`waiting-section`) → Pages (`question-card`, `task-page-href`). That is a two-way edge only because the renderer has no area (N1). On P7min it is internal to Pages. The read model points down: `home-row-states` → `ruling-standing` → `unanswered-decisions` (Runs) (E/supplementary-figures.txt §S16). No new import from Runs into Home's renderers.
- **The task page.** LIN-4048 (`render-task-page.js`, `public/prompt-section.js`) and LIN-4143 (`ruling-standing`, `unanswered-decisions`, `task-page-loader`, `live-anchor`, `home-row-states`) changed code inside the seam without adding or removing a single import.
- **Browser: one tick, one merge, one policy, joined by globals** (F6). Read by hand at `2eb73ae0`:
  - **The tick.** `window.onRulingsTick` (`public/common.js:3116`) hangs listeners on the existing 5-second rulings poll. There is no second timer.
  - **The fetch.** `window.refreshWaitingOnYou` (`public/app.js:642-654`) fetches `/api/home-waiting`, one request at a time.
  - **The merge.** `QuestionCards.mergeWaitingCards` (`public/question-cards.js:496`) merges by `rulingKeyOf`.
  - **The policy.** `HomePlacement.createHomePlacement` (`public/home-placement.js:70`) decides when Running and Up next may be re-read. `app.js`'s `createDeskPlacement` (`:709`) is the DOM half.
- **Load order.** Home's script list (`lib/render.js:383`) has 14 entries. `question-cards.js` is 4th, `home-placement.js` 5th and `app.js` last (E/supplementary-figures.txt §S19). No other page loads `home-placement.js`.
- **One unguarded global.** `app.js` is on 11 pages. It uses `window.HomePlacement` with no guard (`public/app.js:720`, `:816`). This is safe because the code runs inside `initWaitingOnYou`, which returns unless Home's server-drawn section (`[data-testid="waiting-on-you"]`) is on the page (`public/app.js:593-594`). The other new globals are reached through `?.` or `typeof` guards (`app.js:654`, `:719`).
- **Not run.** I did not start the app or run the e2e specs (`tests/e2e/lin-4242-waiting-live.spec.js`, `lin-4243-placement-swap.spec.js`, `lin-4048-finished-task-run.spec.js`). The browser reading above is a source read only; the PR's CI runs those specs (§9).
- **Survey.** `place-ledger.md:48` (LIN-4243: "the new file has a home", `public/home-placement.js`) agrees. It is placed in browser code. Its dependency is a global, which the tool cannot count.

## 5. Ways in and rebuild readiness

Only what moved is written here. Entry files are `seams.mjs`'s (E/supplementary-figures.txt §S15); readiness is judgement.

- **Runs & dispatch.** 93 of 108 files are entry files, unchanged. The cost read now has one door for records (N6, N9).
  - **Readiness: low–medium, unchanged.** The cost part is ready to be named as a unit, since LIN-4195 is closed. The area as a whole still has no narrow way in.
- **Front end: server-rendered pages.** 53 → 55 entry files. `question-card` and `task-page-href` became entry files only because `waiting-section` imports them from outside the area.
  - **Readiness: unchanged.** Home's section now has its own module, which makes Home's render more separable, but the map does not show it yet (N1).
- **Other features.** 13 → 15 entry files, 16 files. Readiness: not applicable until the files are placed.
- **Front end: browser code.** 43 → 44 files, 0 imports. The area has no import graph to read. Its way in is a script list plus `window.X` (F6, §4).
- **Web routes.** Three routes gained one constant import each, into the catch-all. No change in shape.
- **Wiring.** One more inline route (`wiring: server.js`).
- **Where the graph and the guide's names differ:**
  - the Home/task-page read model (10 of 16 catch-all files);
  - the cost family across four areas (N10);
  - the rulings family across six areas (N12).

  None is a wrong-way dependency. All three are naming questions (§7).

## 6. Change coupling beside import coupling

`cochange.mjs --days 60`, one guide, both commits (E/compare-run7.md:101-166).

- **Overlap.** The windows are 2026-09-05T17:18Z → 11-04T17:18Z and 2026-09-06T06:00Z → 11-05T06:00Z. They share **59.471 of 60 days (99.12%)**: 840 commits shared, 14 dropped out (dated 2026-09-05 and early 09-06) and 11 added (this window's commits) (E/README.md; E/supplementary-figures.txt §S11). **This is not a trend.** The movements below are mostly commits leaving the window.
- **Totals.** 854 / 392 / 76 → **851 / 390 / 76** (changes / touching two or more areas / pairs). Unmapped files 5351 → 5416. `shallow: false` at both.
- **Correction to run 6's §6 and §11.** Run 6's "top pairs" table kept run 5's ten pairs. At `d7ceb373` the real top ten included Runs + Wiring (81) and Pages + Wiring (79), and did not include LLM + Web routes (77, 12th). Run 6's numbers are right; only the "top 10" label was wrong (E/supplementary-figures.txt §S11). The table below is the real top ten at each commit.

| pair | run 7 (`2eb73ae0`) | run 6 (`d7ceb373`) | (run 5) | import link? |
|---|---|---|---|---|
| Browser code + Pages | 140 | 140 | (142) | no |
| Runs + Web routes | 111 | 110 | (111) | yes |
| Browser code + Web routes | 102 | 105 | (107) | no |
| Agent API + Runs | 101 | 100 | (101) | yes |
| Pages + Web routes | 98 | 99 | (99) | yes |
| Web routes + Wiring | 93 | 93 | (95) | yes |
| Pages + Runs | 92 | 91 | (92) | yes |
| Browser code + Runs | 86 | 85 | (87) | no |
| LLM + Runs | 84 | 84 | (85) | yes |
| Runs + Wiring | 82 | 81 | (81) | yes |
| *Pages + Wiring* | *81* | *79* | *(79)* | yes |
| *LLM + Web routes* | *73* | *77* | *(82)* | yes |

The last two rows are outside the top ten at one commit or the other; they are shown so the label change is traceable. Run 5's values for Runs + Wiring and Pages + Wiring come from run 6's evidence (`_evidence-2026-11-04-run6/compare-run6.md:302-303`), which run 5's table did not print.

- **No-link pairs: 20 of 76 at both commits** (E/compare-run7.md:166). Twelve are browser code with something, plus Agent API + Reports (14), Agent API + Other (12), Other + Reports (5) and five Task-model or Providers pairs of 3 or fewer.
- **Candidate seam: the browser code, unchanged and the clearest it has been.**
  - Browser code + Pages (140) and browser code + Web routes (102) are the two largest pairs with no import link. This window shows why: LIN-4241, 4242, 4243 and 4048 each changed server code and a `public/` script together, and LIN-4151 changed a renderer with `public/llms.txt` (E/supplementary-figures.txt §S12).
  - The coupling runs through markup and `window.X` (F6, §4), which the import graph cannot see. Merges that touch Home queue behind each other for this reason.
  - Per-file churn belongs to the Stability Review.
- **Agent API + Reports (14, no link).** Driven by the cost work (`c55f0fb3`, `2ee4e600`, `9cc5ff9c`, `46b43b3b`, `30db2052`, …; §S12). `/api/proxy/cost` and the KPI readers both read the cost read in Runs, so this is a shared dependency, not a missing seam. With LIN-4195 closed, it should start to fall as those commits age out of the window.
- **Agent API + Other (12) and Other + Reports (5)** are the same cost commits, seen through files that cochange's history still places in the catch-all (run 6 §5's measurement caveat). Not seams.

## 7. Guide proposals (prose only; nothing is edited)

None of these is a code move, and none is enforced by a test, check or count. P1d and P7min were measured as labelled experiments (E/guide-experiments.txt; E/guide-experiments.py writes the two proposal guides).

- **P1d — place the 16 catch-all files (measured; replaces P1b).** This is run 5's P1b placement plus the three files that arrived since:
  - Pages: `home-pipeline`, `home-rows`, `home-view`, `dashboard-refresh`, `waiting-section`;
  - Task model: `home-row-states`, `subtree-index`, `task-facts-holder`, `task-state`;
  - Platform: `cost-format`, `key-state`, `key-state-holders`;
  - Runs: `live-anchor`, `ruling-standing`, `ruling-settled`, `usage-snapshot-intake`.

  Measured: the catch-all is 0, links go 1249 → 1256, there are 12 pairs, and the group has 8 areas at both commits. The three Other pairs become Pages ↔ Task model (5/2), Runs ↔ Task model (4/3) and LLM ↔ Task model (2/1), and Pages ↔ Runs becomes 15/8. F1 is the only pair that moves. P1d leaves the wrong-way code where it is.

  Note LIN-4235 (Backlog): it deletes the legacy `[usage]` snapshot fold after 2026-12-04, which may make `usage-snapshot-intake`'s placement moot.
- **P7min — place the window's two new files only (measured).** `waiting-section` to Pages, beside `question-card` and `task-page-href`. `ruling-settled` to Runs, beside the rulings stores. This is the smallest edit that stops the window's growth showing as a knot: Pages ↔ Other is 8/6 and the catch-all 14 at both commits.
- **P1c — hygiene in the same edit (still stands).** Drop the dead `task-cost|` alias (N8). Narrow `workspace-(?!kpi-stats\.js)[^/]*` to the Auth files it means, and move `workspace-api-mocks.js` to Web routes.
- **P2 — `tree.js` to Task model; model routing as its own area; or a "Costs & usage" area (still stands, now measurable).** LIN-4195 is Done, which was run 6's condition for measuring the cost-area option. It is not measured in this run. It belongs to LIN-4193 (§9).
- **P3 — `experiments/rebuild-[^/]+/` to Reports & operator tools (still stands).** Cosmetic, as measured by run 5. Stability 11-04 F10 records the same gap.
- **P4 — a rulings pattern (new).** Name `ruling-[^/]*` (and `routing-ruling`, if PR #2185 lands) into the area that holds the rulings stores, so new rulings files stop falling through (N12). Whether rulings become their own area is the larger form of the same question. It belongs with P1d.

## 8. Existing tickets and the carried items

Checked against code at `2eb73ae0` and against Linear and GitHub state read on 2026-11-05 (E/external-state-2026-11-05.txt). None was changed by this report.

| ticket | state | what it covers | this run |
|---|---|---|---|
| LIN-4154 (FU-1) | Backlog, parent LIN-3490 | `fmtDuration` out of `render-run-steps.js` | anchors hold (`:258`; importers `task-state.js:22`, `task-page-loader.js:50`, `render-task-page.js:58`) |
| LIN-4155 (FU-2) | Backlog, parent LIN-3820 | `applyDefaultDispatchHarness` out of `proxy-preamble.js` | anchor holds (`:152`) |
| FU-3 (recorded only) | — | Providers → `recommendation-facts` (`parentNextOf`) | unchanged |
| LIN-3922 | Backlog | `tree.js:189` re-export | unchanged |
| LIN-3923 | Backlog | the LLM ↔ Providers knot | unchanged (11/4) |
| LIN-3736 | Backlog, parent LIN-3449 | `stableStringify`/`hashContext` to plumbing | unchanged (`recap-cache.js:27,94`; twin `run-summary-cache.js:32`) |
| LIN-3737, LIN-3738, LIN-3555 | Backlog | `collectIssueAttachments`; preamble provisioning; `RefResolutionError` | unchanged (`proxy-wire.js:285`, `proxy-ref-resolver.js:80`) |
| LIN-2600 | Backlog, parent LIN-2601 | dead imports in `routes/proxy.js` | 45 by the run-4 heuristic (F7) |
| LIN-4193 | Backlog, parent LIN-3936 | name the cost modules into an area; rename `weekly-budget.js` | `cost-format` and the rename are left; now the home of the P2 cost-area decision (§9 comment) |
| LIN-4195 | **Done** | costs rebuild 2 | all nine pieces Done; LIN-4226 (`c55f0fb3`) last |
| LIN-4235 | Backlog | delete the legacy `[usage]` fold after 2026-12-04 | may retire `usage-snapshot-intake` (N1, P1d) |
| LIN-4238 | Backlog | Observation rulings rows onto the shared card merge | the F6 / §4 browser follow-on |
| LIN-4244 | Backlog | other answer surfaces handle `409 ruling-settled` | the F6 / §4 browser follow-on |
| LIN-1249 | Backlog | decompose `server.js` | `wiring: server.js` (+1 inline route) |
| PR #2185 (LIN-4028) | open, In Progress, last updated 2026-10-30 | `lib/routing-ruling.js` | not on main; would land in the catch-all (N12, P4) |
| LIN-3720 | Done | the earlier map ticket for the catch-all | the catch-all is 16 |
| LIN-4176, LIN-4179 | Done | one cost read; Harbour calls on it | why N6's two reads are not ticketed |

## 9. Follow-ups minted: none

Before deciding, I searched Linear again (21 queries, including "cost area", "Costs & usage", "cost modules area", "code-shape area", "model-routing-history", "readCost", "browser seam", "window globals", "window.HomePlacement", "public/common.js globals", "script list", "waiting-section", "ruling-settled", "rulings area", "ruling- pattern", "routing-ruling", "Other features", "catch-all", "home-waiting" and "server.js inline route"; E/external-state-2026-11-05.txt).

1. **F1 and N10, the cost seam.** The move is the cost-area decision, a guide edit that LIN-4193 already owns ("name the cost modules into a code-shape area"). A code move inside F1 would need that decision first. **Not minted.** Instead, a comment on LIN-4193 records that LIN-4195 is Done and that F1, N10 and P2 are now measurable. Owner: LIN-4193 / LIN-3936.
2. **F6, the browser globals.** The window's growth is one feature's client, and LIN-4238 and LIN-4244 already carry its follow-ons. A ticket to "reduce `window.X`" would not be one move, and it would not be worked ahead of the feature work it would interrupt. **Not minted.** Owner: recorded here; the next run re-measures it.
3. **N1, N12, P1d, P7min and P4, the catch-all and the rulings name.** These are guide edits, so they are proposals, not code moves. LIN-3720 was the map ticket and LIN-4193 covers the cost part. **Not minted.**
4. **N6, the cost hub.** Splitting Harbour's call-cost read out would reverse LIN-4176 and LIN-4179. **Not minted.**
5. **`wiring: server.js`.** LIN-1249 exists. **Not minted.**
6. **`hub:dispatch-store.js`.** Its size belongs to Code Quality and the copies to Drift. **Not minted.**

Nothing in the window adds a `lib/` → `routes/` import, opens a knot pair, or adds a wrong-way edge on a placed map. Those are the things that would justify a new seam ticket in a window this size.

## 11. Trend ledger

The stable names carry forward from run 6. Delta is against run 6's published figures, which this run reproduces at `d7ceb373`. N11 and N12 are new. None is retired or renamed.

| name | severity | run 6 | run 7 | delta |
|---|---|---|---|---|
| F1 `knot:agents-chat<->runs` | High | 30/37 | 31/37 | **grew** by code +1/+0 (`model-routing-history → cost-read`) |
| F6 `knot:browser-window-globals` | Medium | 52 / 100 | 55 / 107 | **worsened** (+7; `HomePlacement`, `onRulingsTick`, `dispatchesInFlight`, `refreshWaitingOnYou`, `dispatchPrompt`) |
| N1 `knot:other-features-catch-all` | Medium–High map / Medium code | 14 files | 16 (+`waiting-section`, +`ruling-settled`) | **worsened** by code into a guide gap; Pages ↔ Other 8/6 → 9/8 is the same gap |
| N6 `hub:cost-read.js` | Medium | 5 cross-area in from 4 areas | 7 from 4 areas | grew as predicted; **settled** (LIN-4195 Done) |
| N9 `door:request-usage-loader` | healthy, Low | 7 importers | 7; now required by the cost read | unchanged in count; stronger |
| N10 `map:cost-family-split` | Low–Medium | 11 of 67 | 12 of 68 | unchanged in shape; **now decidable** (P2) |
| N11 `door:home-waiting` | healthy, Low | — | 1 read (`home-row-states.js:82`), 1 renderer (`waiting-section.js:30`), 2 callers | **new** |
| N12 `map:rulings-family-split` | Low | — | 6 areas; PR #2185 would add one more to Other | **new as named** |
| `hub:dispatch-store.js` | Low–Medium | 7 cross-area in; 10 out | same; +`isDecisionSettled` | unchanged by import |
| `wiring: server.js` | Low, watch | Runs 45; Other 8; 29 inline routes | Runs 45; Other 9; 30 inline routes | +1 import, +1 route (`/api/home-waiting`) |
| N8 `map hygiene: deleted task-cost` | Low | alias + 2 comments | alias + 2 comments | unchanged |
| `map hygiene: workspace- prefix (Auth)` | Low | 14 `workspace-*` files in Auth; mocks 6 importers | same | unchanged |
| N7 `door:request-usage-intake` | Low, healthy | 3 importers | 3 | unchanged |
| F2 `knot:runs<->page-renderers(render-swipe)` | retired | retired | retired | unchanged |
| F3 `knot:providers->upward` | Medium | 4 | 4 | unchanged |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 11 / 10 | 11 / 10 | unchanged |
| F5 `knot:routes-as-libraries(dashboard)` | Medium | 53 | 53 | unchanged |
| F7 `knot:dead-import-inflation(routes/proxy.js)` | Low | 45 | 45 | unchanged |
| F8 `knot:production-loads-routes/test.js` | Low | 4 unresolved | 4 unresolved | unchanged (`server.js:1215 → 1216`) |
| N2 `hub:task-page-loader.js` | Medium | 7 in / 9 out (cross-area) | 7 / 9 | unchanged |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 4 | 4 | unchanged |
| N4 `hub:run-controls.js` | Medium, watch | 19 | 19 | unchanged |
| N5 `knot:task-model` | healthy | 2 files | 2 files | unchanged |
| `hub:tree.js` | watch | 6 | 6 | unchanged |
| `hub:render-run-steps.js` (FU-1) | Medium | 2 in / 4 out | 2 in / 4 out | unchanged |

**Change-coupling top pairs.** Run 5 values are in brackets. The windows overlap 99.12%. This is the real top ten at `2eb73ae0`; run 6's table was labelled "top 10" but kept run 5's set (§6).

| pair | run 7 | run 6 | (run 5) |
|---|---|---|---|
| Browser code + Pages | 140 | 140 | (142) |
| Runs + Web routes | 111 | 110 | (111) |
| Browser code + Web routes | 102 | 105 | (107) |
| Agent API + Runs | 101 | 100 | (101) |
| Pages + Web routes | 98 | 99 | (99) |
| Web routes + Wiring | 93 | 93 | (95) |
| Pages + Runs | 92 | 91 | (92) |
| Browser code + Runs | 86 | 85 | (87) |
| LLM + Runs | 84 | 84 | (85) |
| Runs + Wiring | 82 | 81 | (81) |

No-link pairs: 20 of 76 at both commits (run 6 HEAD guide: 20).

## Sibling hand-offs

- **Drift & Coherence** owns decisions held in several places, file-level direction, file-level cycles, text contracts and stale comment text. The 11-04 run 2 report is LIN-4232, Done. Run 3, LIN-4250, is in progress alongside this run and had no comments or branch when I read it.
  - Run 2 handed this review `usage-snapshot-intake` with no area (still N1, now one of 16), the `task-cost|` alias (N8, unchanged) and route → route 53 (F5).
  - Seen in this window and handed to Drift, not graded here:
    - `lib/home-row-states.js:121` still says "the task page's read leaves it off", which LIN-4143 made untrue (compare `:67` and `lib/ruling-standing.js:15`);
    - `lib/waiting-section.js:5` names `readWaitingStanding`, which does not exist (the function is `createWaitingStanding` / `waitingStanding`);
    - `public/question-cards.js:248` restates the `'ruling-settled'` code beside `lib/ruling-settled.js:13`, a text contract the browser cannot import;
    - the settled-check copies and "two 409 codes" (`place-ledger.md:91`);
    - "finished but held decided in three places" (`place-ledger.md:95`);
    - N6's "Pure" wording.
- **Code Quality** (11-04, LIN-4207) handed over `routes/test.js` (F8) and `lib/errors.js`, which is still Platform with 63 cross-area importers from 7 areas (§S16). Function size, including `dispatch-store.js` and `server.js`, stays with Code Quality.
- **Stability** (11-04, LIN-4206) owns churn. Its F10 (`experiments/` unclaimed) is P3 here.
- **Documentation.** `docs/architecture/source-map.md` lists `waiting-section.js` (`:255`) and `home-placement.js` (`:345`) but not `ruling-settled.js` or `ruling-standing.js`. Recorded here only.
- **Simple Dispatcher** is still flat CommonJS at `07c88f7a` (2026-11-04T23:46Z). `dispatcher.js` has 35 `require(` lines and no `import`/`export`, and `package.json` has no `"type"`. Of 371 JS files, two use `import`/`export`, neither production: `scripts/floor-report.mjs` (added 2026-07-04) and `test/helpers/transcript-corpus-oracle.mjs`. It stays outside `seams.mjs`; no tool was built (E/supplementary-figures.txt §S13).
- **Survey** (read only, `origin/claude/cool-rubin-6acj5j` at `23edd667`):
  - F1 bears on the LIN-4226 row (`place-ledger.md:35`).
  - N1 bears on the LIN-4241 and LIN-4242 rows (`:46`, `:47`).
  - F6 and §4 bear on the LIN-4243 row (`:48`).

  All agree with the numbers here. No row is edited.

## Measurement notes

1. **The ticket's mint-time window facts all reproduced:** 11 commits, 44 files, +1,430 / −363, three added files, no deletions, and empty diffs for the tools, the guide, the runner kit and `docs/runner-prompt.md` (E/supplementary-figures.txt §S0).
2. **This run's own beat-2 recap gave the fragment route as `server.js:3739`.** The `app.get(` line is `:3738`; `:3739` is the line after it.
3. **`compare-run7.mjs` and `supplementary-figures.py` read committed git objects at the two pinned SHAs and the JSON in this folder.** Their outputs regenerate byte for byte (E/README.md).
4. **PR, Linear and Survey state are as read on 2026-11-05** (E/external-state-2026-11-05.txt).
5. **§10 is left for the adversarial second-read.** It is written by a separate reader after this report is drafted.
