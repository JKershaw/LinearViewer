# Seams & Tangles Review — 2026-11-04, run 6 (delta vs the 2026-11-04 run 5)

Task: LIN-4231 · Parent: LIN-3549 · Previous: `seams-tangles-review-2026-11-04.md` (LIN-4208, run 5) · Tools: `scripts/code-shape/seams.mjs` and `scripts/code-shape/cochange.mjs`. Neither changed in the window: they were last touched by `b45aeff2` (LIN-3860), and their shared `code-shape-lib.mjs` by `856d8ae6` (LIN-3881).

Review-only. The only changes are this report and `docs/reviews/_evidence-2026-11-04-run6/`. It proposes against the guide, it does not edit it. Below, "E/" means that evidence folder.

**Headline: a thin window, and most of what moved on the map is the guide, not the code.**
- **The window.** It has 8 commits; 4 of them are code, all from the costs rebuild (LIN-4195).
- **The guide edit.** LIN-4201 edited the area guide for the first time since run 4. It moved `cost-read`, `row-usage` and `lineage-membership` from the catch-all into Runs. That shrank the catch-all from 17 to 14 files and took most of the reach out of run 5's top hub, `cost-read.js`. The code under it barely changed.
- **The real code growth** is two edges in the High knot between LLM & prompts and Runs & dispatch (F1), which is now 30/37:
  - `model-routing-history → request-usage-loader`;
  - `request-usage-fold → model-pricing`.
  - The first is an import of a guard function. The loader itself is passed in at runtime, so measured by runtime dependency the growth is +0/+1.
- **New entry point: `request-usage-loader`.** The records-first cost read added a clean door to the request records. It is built once in `server.js` and passed to each caller.
- **One new file has no area.** `usage-snapshot-intake.js` replaced the deleted `founder-lookup.js` in the catch-all.
- **Little else moved.** No knot pair opened or closed, and the knot group stays at nine areas.
- **Change coupling** cannot show a trend: the two 60-day windows share 99.17% of their days.
- **No follow-ups are minted** (§9). The cost hub is still moving: PR #2275 (LIN-4226) is open and will add two cross-area importers next run.

## 0. What was measured

- **Commits.**
  - Baseline `5334c81a7207b9f2cc85ca429a2c6b18e1635c0e`, run 5's measured commit.
  - Measured `d7ceb373444f9efbc027656132352d247535aa5e`: origin/main at the ticket's mint time, and still origin/main when this report was written. Main has not moved, so there was nothing to re-measure.
  - The window `5334c81a..d7ceb373` has 8 commits:
    - 4 docs-only reports: `e439f637`, `1403d52d`, `57b22b92`, `f5bc752c`;
    - 4 code: `230cc2c2` LIN-4200, `eb44eff9` LIN-4212, `2ee4e600` LIN-4201, `d7ceb373` LIN-4203.
  - The production diff (`lib routes public server.js`) is 33 files, +1,049 / −288 (E/supplementary-figures.txt §S0).
  - Added: `lib/request-usage-{fold,loader,vocabulary}.js`, `lib/usage-snapshot-intake.js`, `lib/workspace-kpis-cache.js`. Deleted: `lib/founder-lookup.js`. No `public/` file changed (E/supplementary-figures.txt §S4).
- **Scope.** 536 → 540 files. 0 parse failures, 0 non-literal dynamic imports, 0 unmapped files, and 4 unresolved relative imports (all in `routes/test.js`, F8) at all four runs (E/compare-run6.md:3-9).
- **Direction rule.** `lib/` → `routes/` imports are **0** at both commits under both guides, by the edge dumps and by `git grep` (E/supplementary-figures.txt §S1).
- **Two guides, all four combinations.**
  - The old guide (`areas.old-5334c81a.json`, blob `816b2e66`) is byte-identical to run 5's HEAD guide.
  - The HEAD guide (`areas.head-d7ceb373.json`, blob `642e9405`) differs by two lines, both from LIN-4201 (`2ee4e600`):
    - `cost-read|row-usage|lineage-membership` was appended to "Runs & dispatch" (`areas.json:24`);
    - `workspace-kpis-cache` was added to "Reports & operator tools" (`areas.json:44`).
  - Seams and cochange were each run at {`5334c81a`, `d7ceb373`} × {old, HEAD} guide (E/README.md).
  - **The series uses the HEAD guide at both commits.** "Run 5's figure" means the old guide at `5334c81a`, which is what run 5 published.
- **Witness.** The edge dump's cross-area count equals the seams link total at each of the four runs (1262, 1249, 1275, 1259; E/README.md).

## 1. Changes since run 5 (first)

1. **F1 grew by code, +1/+1** (LLM → Runs / Runs → LLM).
   - Series: 29/36 → 30/37. Run 5 published 26/35; the extra +3/+1 is the guide edit (§2, §3 F1).
   - The +1 LLM → Runs edge imports only a guard function, because the loader is injected; measured by runtime dependency it is +0/+1.
2. **The catch-all shrank 17 → 14 by placement.**
   - The guide edit placed `cost-read`, `row-usage` and `lineage-membership` in Runs.
   - Code swapped one member: `founder-lookup.js` was deleted (its query moved into `lib/dispatch-store.js`, LIN-4201) and `lib/usage-snapshot-intake.js` arrived, in the catch-all under both guides (E/compare-run6.md:46-50).
   - **The 14 at HEAD = 13 of run 5's 17 + `usage-snapshot-intake`.**
3. **N6, `cost-read.js`, lost most of its reach to placement, not code.**
   - Cross-area importers: 9 from 5 areas → 5 from 4. Cross-area outbound: 4 → 2 (E/compare-run6.md:102-105).
   - Code added one import, to `request-usage-fold` inside Runs. The importer set did not change.
4. **New door: `request-usage-loader`** (N9). It is built once (`server.js:586`) and injected; callers import only its guard. It has 7 importers: 6 cross-area from 5 areas (LLM, Reports, Agent API, Web routes, and Wiring via `server.js`) plus `run-paragraph-hook` inside Runs.
   - Run 5 expected the store's importers to grow from 1 to about 7. They did not: the store still has 1 importer, and the door went in front of it (E/compare-run6.md:107-118).
5. **Wiring.** Wiring → Runs 44 → 45 (the loader). Wiring → Other is unchanged in count: `founder-lookup` out, `usage-snapshot-intake` in (E/compare-run6.md:215, :238-243).
6. **Map hygiene.**
   - The stale `task-cost` comments went from 3 to 2 (LIN-4203 removed `runner.mjs:768`). The `task-cost|` alias survived LIN-4201's edit of that same guide line (N8; E/supplementary-figures.txt §S5).
   - `workspace-kpis-cache.js` would have landed in Auth through the over-broad `workspace-` pattern, so LIN-4201 had to name it in Reports (E/supplementary-figures.txt §S9).
7. **Correction to run 5.** `lib/task-page-loader.js` is a **Runs** file under both guides (E/compare-run6.md:144-147). Run 5's hub table listed it as Pages. Its `→ render-run-steps.js` edge is therefore Runs → Pages: the wrong-way edge LIN-4154 targets.

Unchanged: F2 (retired), F3, F4, F5, F6, F7, F8, N2, N3, N4, N5, N7, the `tree.js` hub, Pages ↔ Runs (13/8), and the knot pair set and group. See §3 and §11.

## 2. Trend table and the guide effect

| code \ guide | old guide (`5334c81a`) | HEAD guide (`d7ceb373`), the series |
|---|---|---|
| `5334c81a` (run 5) | 536 files · **1262** links · 12 pairs · group 9 · Other 17 · F1 26/35 | 536 · 1249 · 12 · 9 · Other 14 · F1 29/36 |
| `d7ceb373` (run 6) | 540 · 1275 · 12 · 9 · Other 17 · F1 27/36 | 540 · **1259** · 12 · 9 · Other 14 · F1 30/37 |

Source: E/compare-run6.md:11-17.

- **Placement versus code** (E/compare-run6.md:180-192). Each change from run 5's figure to run 6 on the HEAD guide splits into placement at `5334c81a` plus code on the HEAD guide:
  - **Links:** −3 = placement −13 + code +10.
  - **F1:** +4/+2 = placement +3/+1 + code +1/+1.
  - **Catch-all:** −3 = placement −3 + code 0.
- **The interaction term is −3 for links and 0 for the other two.**
  - Under the old guide, code adds 13 links; under the HEAD guide, 10.
  - The difference is edges that are cross-area only under the old guide: 4 added (`cost-read → request-usage-fold`, `request-usage-fold → row-usage`, `row-usage → request-usage-vocabulary`, `request-usage-loader → lineage-membership`) and 1 removed (`terminal-marked-task-cost → row-usage`). 4 − 1 = 3.
  - The edge lists are at E/compare-run6.md:217-247.
- **Directed counts that moved by code** (series, E/compare-run6.md:194-215):
  - Reports → Runs 11 → 13;
  - Web routes → Runs 88 → 90;
  - Agent API → Runs 44 → 45;
  - Runs → LLM 36 → 37; LLM → Runs 29 → 30;
  - Runs → Platform 60 → 61; Wiring → Runs 44 → 45;
  - Reports → Platform 9 → 10; Web routes → Reports 2 → 3;
  - Other → Runs 7 → 6; Runs → Other 4 → 5; Reports → Other 1 → 0.

Knot pairs (two-way area pairs, `a→b / b→a`; E/compare-run6.md:19-33):

| pair | run 5 published (old guide, `5334c81a`) | series `5334c81a` → `d7ceb373` | status |
|---|---|---|---|
| Agent API ↔ LLM | 37/4 | 37/4 → 37/4 | unchanged |
| Agent API ↔ Providers | 20/3 | 20/3 → 20/3 | unchanged |
| Agent API ↔ Runs | 42/10 | 44/10 → **45/10** | +1 code (`proxy-compute → request-usage-loader`); +2 placement |
| Auth ↔ Pages | 14/11 | 14/11 → 14/11 | unchanged |
| Auth ↔ LLM | 4/3 | 4/3 → 4/3 | unchanged (N3) |
| Auth ↔ Providers | 12/1 | 12/1 → 12/1 | unchanged |
| LLM ↔ Providers | 11/4 | 11/4 → 11/4 | unchanged (F3) |
| LLM ↔ Runs | 26/35 | 29/36 → **30/37** | grew (F1) |
| Pages ↔ Runs | 13/8 | 13/8 → 13/8 | unchanged |
| Pages ↔ Other | 8/6 | 8/6 → 8/6 | unchanged |
| LLM ↔ Other | 4/2 | 1/1 → 1/1 | shrank by placement only |
| Other ↔ Runs | 9/15 | 7/4 → **6/5** | shrank by placement (−2/−11); code −1/+1 |

## 3. Findings, severity-ranked, trend-framed

The stable names are run 5's (§11). Severity and trend are measured against run 5.

### Ranking note

F1 ranks first because it is the High knot and the only one that grew by code. The catch-all (N1) and the cost hub (N6) both improved, almost entirely by placement. Run 5 ranked N6 first as the window's largest new item; it drops to third because the guide edit gave it an area and its code shape did not change.

### F1 — `knot:agents-chat<->runs(chat-tools)` · **High** · **grew by code (+1/+1); +3/+1 more on run 5's published figure is placement**

- **Series (HEAD guide):** 29/36 → **30/37** (E/compare-run6.md:32).
- **Code (+1/+1),** both from LIN-4201 (E/compare-run6.md:217-238):
  - LLM → Runs: `lib/model-routing-history.js:11` imports `requireRequestUsageLoader` from `request-usage-loader.js`. It is a guard; the loader itself is injected (`server.js:586`, passed at `:4159`). **By runtime dependency this edge is not new coupling**, so the honest code growth is +0/+1 by runtime and +1/+1 by import.
  - Runs → LLM: `lib/request-usage-fold.js:30` imports `priceRequest` from `model-pricing.js`. This is real: per-request pricing lives in LLM.
- **Placement (+3/+1),** at either commit (E/compare-run6.md:249-281): the guide edit relabelled four existing edges from Other into Runs:
  - `model-pricing → row-usage`;
  - `model-routing-history → lineage-membership`;
  - `model-routing-spend → cost-read`;
  - `cost-read → llm-call-log` (the Runs → LLM one).
- **Cost-family share.** Of the 67 edges in the pair, 11 touch a cost or pricing module: 5 LLM → Runs and 6 Runs → LLM (E/supplementary-figures.txt §S8). The rest of F1 is chat tools, model routing and dispatch, unchanged in shape since run 4.
- **Next run.** PR #2275 (LIN-4226, open) adds `model-routing-history → cost-read`, one more LLM → Runs edge (E/pr-2275-prod-imports.txt).
- **Reading.** F1 still grows, but slowly and at the cost seam. Its fix sits inside LIN-4195, which is still moving (§9).
- **Survey.** Place ledger, LIN-4201 row (`place-ledger.md:32`, E/supplementary-figures.txt §S14): it records "LLM↔Runs +2 edges". That matches the +1/+1 code delta here.

### N1 — `knot:other-features-catch-all(lib first-match)` · **Medium–High as a map (was High), Medium as code** · **improved, 17 → 14, by placement**

- **Placement −3.** `cost-read`, `row-usage` and `lineage-membership` moved to Runs (E/compare-run6.md:48-49).
- **Code, a swap.** `founder-lookup.js` was deleted; `usage-snapshot-intake.js` was added (E/compare-run6.md:46-47).
- **Code, an absorption (second-read).** The swap understates the deletion. `founder-lookup`'s query did not just leave the catch-all: its lineage-identity read (`lineageIdentityOfRows`) moved into `lib/dispatch-store.js:330`, Runs' store hub. It is reached two ways: injected by `server.js:2507` for the kpi-stats path, and imported directly by `lib/workspace-kpi-stats.js:40`, which is the new Reports → Runs edge. So the store now takes a direct Reports caller beside the N9 loader door, and one of its two callers bypasses the injection pattern that N9 credits. The store also gained the Runs → Other edge to `usage-snapshot-intake` (`dispatch-store.js:59`). Low–Medium. Not a follow-up: LIN-4226 / PR #2275 is still reshaping these callers.
- **Members at HEAD** (E/compare-run6.md:45): the **13 run-5 files still unplaced** (`cost-format`, `dashboard-refresh`, `home-pipeline`, `home-row-states`, `home-rows`, `home-view`, `key-state`, `key-state-holders`, `live-anchor`, `ruling-standing`, `subtree-index`, `task-facts-holder`, `task-state`) **plus `usage-snapshot-intake`, which makes 14**.
- **The new member.**
  - `lib/usage-snapshot-intake.js` counts legacy `[usage]` posts. It has no imports and 2 importers: `lib/dispatch-store.js:59` (Runs → Other) and `server.js:42` (E/compare-run6.md:119-124).
  - It is a Runs concern named outside the `request-usage-` pattern, so it fell through to the catch-all. It is a placement gap, not a wrong-way edge.
  - **Survey.** Place ledger, LIN-4203 row (`place-ledger.md:33`): "one new file without a home". Same file.
- **Pairs.** Other ↔ Runs 7/4 → 6/5 on the series; LLM ↔ Other 1/1; Pages ↔ Other 8/6. Other is still in the nine-area knot group (E/compare-run6.md:33-39).
- **Wrong-way code is unchanged:** `task-state.js:22` (→ `render-run-steps`), `home-row-states` (→ `task-page-loader`), `subtree-index` (→ `recommendation-facts`).

### N6 — `hub:cost-read.js` · **Medium, watch (was Medium–High, ranked first)** · **improved on the map; unchanged in code shape; still moving**

- **Placement.** It is now a Runs file.
  - Cross-area importers: 9 from 5 areas → **5 from 4**. The 5 are LLM `model-routing-spend`, Reports `workspace-kpi-stats`, Agent API `routes/proxy-compute`, and Web routes `routes/settings` and `routes/ship-biscuit`.
  - Cross-area outbound: 4 → 2 (`llm-call-log`, `utils/time`). See E/compare-run6.md:102-106.
- **Code.**
  - Same 9 importer files.
  - +1 import (`request-usage-fold`, `lib/cost-read.js:39`, inside Runs).
  - The file grew from 434 to 592 lines (E/supplementary-figures.txt §S0).
  - It is still pure: no store, clock or network (`lib/cost-read.js:31-34`).
- **Shape.** It holds two reads:
  - the worker cost of lineages (`readCost`, `lineageRecords`, `lineageFigureOf`);
  - Harbour's own call cost (`readCalls`, `appCallsOf`, `callsSurfaceOf`; `lib/cost-read.js:518-578`).
  - The second read is why it imports `llm-call-log` (LLM) while model routing imports it back. That two-way reach between Runs and LLM was decided on purpose (LIN-4176, LIN-4179, both Done), so it is recorded and not ticketed.
- **Next run.** PR #2275 adds `kpi-stats` (Reports) and `model-routing-history` (LLM) as importers. That takes cross-area importers 5 → 7 (E/pr-2275-prod-imports.txt; E/external-state-2026-11-04.txt).

### N9 — `door:request-usage-loader` · **healthy, Low** · **new**

- **The one way a cost reader gets request records** (`lib/request-usage-loader.js:1-21`).
  - It is built once from the store (`server.js:586`) and injected into the route factories and the `/kpis` read (`requestRows`, `server.js:2509`).
  - It has 7 importer files: 6 cross-area from 5 areas (LLM `model-routing-history`, Reports `workspace-kpi-stats`, Agent API `routes/proxy-compute`, Web routes `routes/dashboard` and `routes/dashboard-effort`, Wiring `server.js`) plus `run-paragraph-hook` inside Runs.
  - Every importer except `server.js` imports only `requireRequestUsageLoader`, a throw-if-missing guard (`:84-95`).
  - Its only import is `lineage-membership.js`. See E/compare-run6.md:107-112 and E/supplementary-figures.txt §S6.
  - The injection sites are `server.js:586`, `:2509`, `:2579`, `:2590-2591`, `:3233`, `:3259` and `:4159`.
- **The store behind it** has one importer, the intake (E/compare-run6.md:113-118).
- **Reading.** This is the cleanest new way into Runs in the window. The five cross-area import edges outside `server.js` overstate the coupling, because the dependency is passed in at runtime.

### N10 — `map:cost-family-split(pricing LLM, folds Runs)` · **Low–Medium** · **new as named**

- **The cost code spans four areas:**
  - LLM: `model-pricing`, `llm-call-log`, `model-routing-spend`, `model-routing-history`;
  - Runs: `cost-read`, `request-usage-*`, `row-usage`, `lineage-membership`, `session-telemetry`;
  - Other: `cost-format`, `usage-snapshot-intake`;
  - Reports: `workspace-kpi-stats`.
- **Edges.** 11 of F1's 67 edges are cost-family (E/supplementary-figures.txt §S8).
- **A file-level cycle avoided by hand.** `request-usage-fold.js:9-10` says it exists as a separate module because `model-pricing.js:68` imports `row-usage`, so pricing from `row-usage` would be a cycle. The import graph is drawing a cost seam that the guide has no name for.
- **Reading.** This is a guide question (§7, P2), not a code move. Decide it after LIN-4195 closes. File-level cycles are Drift's.

### N8 — `map hygiene: deleted task-cost module still named` · **Low** · **improved (3 → 2 comments); alias unchanged**

- LIN-4203 removed the `lib/runner-kit/runner.mjs:768` comment.
- Two remain: `lib/model-routing-spend.js:5` and `lib/wall-clock-summary.js:97`.
- The dead `task-cost|` alias is still in the Runs pattern (`areas.json:24`), on the line LIN-4201 edited (E/supplementary-figures.txt §S5).

### `map hygiene: workspace- prefix (Auth)` (was `map hygiene: workspace-issues-memo.js`) · **Low** · **unchanged in effect; one near-miss in the window**

- **Renamed to the pattern**, because the item is the pattern, not one file. The old name is kept as an alias in §11.
- `workspace-(?!kpi-stats\.js)[^/]*` puts every `lib/workspace-*` file in Auth unless an earlier area names it.
- `workspace-kpis-cache.js` is in Auth under the old guide and in Reports under the HEAD guide (E/supplementary-figures.txt §S9; E/compare-run6.md:167-171). LIN-4201 had to name it explicitly.
- **Newly noticed, pre-existing:** `lib/workspace-api-mocks.js`, a Web-routes mock builder, is in Auth with 6 importers (all `routes/workspace-api*`). It adds to Web routes → Auth.

### F6 — `knot:browser-window-globals(common.js)` · **Medium** · unchanged

- `window.X =` appears 100 times in `public/` and 52 in `public/common.js` (48 with the strict pattern).
- `/cost-format.js` is still in 6 script lists.
- No `public/` file changed in the window (E/supplementary-figures.txt §S4).

### F2 — `knot:runs<->page-renderers(render-swipe)` · **RETIRED (run 4)**

Still retired. Its successor, Pages ↔ Runs, is 13/8 (E/compare-run6.md:29).

### F3 — `knot:providers->upward` · **Medium** · unchanged

- Providers → LLM 4 and Providers → Agent API 3 at both commits.
- `parentNextOf` (`lib/recommendation-facts.js:226`) is still imported by the linear, jira and local providers (E/supplementary-figures.txt §S6).

### F4 — `knot:runs->agent-api(proxy-preamble)` · **Medium** · unchanged

- 11 importer files, 10 of them cross-area (E/compare-run6.md:125-130).
- `applyDefaultDispatchHarness` is still at `lib/proxy-preamble.js:152`. The LLM importers `model-routing` and `model-routing-harnesses` use only it (LIN-4155).

### F5 — `knot:routes-as-libraries(dashboard)` · **Medium** · unchanged

Route → route file edges: 53 at both commits, 3 of them cross-area (E/supplementary-figures.txt §S2).

### F7 — `knot:dead-import-inflation(routes/proxy.js)` · **Low** · unchanged

- 45 of 96 named `lib/` imports are unused at both commits, by run 4's heuristic (E/supplementary-figures.txt §S3).
- The window changed only the factory's parameter plumbing in `routes/proxy.js` (+2/−2).

### F8 — `knot:production-loads-routes/test.js` · **Low** · unchanged

- `server.js:142` imports `routes/test.js` (run 5: `:140`).
- `server.js:1215` calls `installTestTokenLinearTransport()` (run 5: `:1208`).
- 4 unresolved fixture imports (E/supplementary-figures.txt §S6; E/compare-run6.md:6-9).
- Code Quality 11-04 hands the placement of `routes/test.js` here; it stays F8.

### N2 — `hub:task-page-loader.js` · **Medium** · unchanged, **area corrected**

- 8 importers, 7 cross-area from 4 areas. 20 outbound, 9 cross-area (E/compare-run6.md:143-147).
- **It is a Runs file.** Run 5's table said Pages.
- So its `fmtDuration` import (`lib/task-page-loader.js:50`) is one of three `lib/` Runs → Pages edges, all unchanged (E/supplementary-figures.txt §S7). The other two are `live-console → timeline-zoom` and `task-stack → tree`.

### N3 — `knot:auth->llm(model-routing)` · **Low–Medium** · unchanged

Auth → LLM 4 (E/compare-run6.md:26).

### N4 — `hub:run-controls.js` · **Medium, watch** · unchanged

21 importers, 19 cross-area from 3 areas, 17 of them Web routes (E/compare-run6.md:137-142).

### N5 — `knot:task-model` · **healthy** · unchanged

2 files; in no two-way pair (E/compare-run6.md:96).

### N7 — `door:request-usage-intake` · **Low, healthy** · unchanged

- 3 importers: `routes/dispatch.js`, `routes/proxy-runner.js`, `server.js`.
- Its edge to `lineage-membership` is now inside Runs, by placement (E/compare-run6.md:161-166).

### `hub:tree.js` · watch · unchanged

8 importers, 6 cross-area. The `:189` re-export from `recommendation-facts` is still there (LIN-3922; E/compare-run6.md:131-136).

### Hub movers, run 5 → run 6 (series)

| hub (area) | `5334c81a` cross-area importers | `d7ceb373` | why |
|---|---|---|---|
| `lib/cost-read.js` (Runs) | 5 (9 under the old guide) | 5 | placement; #2275 → 7 |
| `lib/request-usage-loader.js` (Runs) | — | 6 (incl. `server.js`) | code, N9 |
| `lib/utils/time.js` (Platform) | 45 | 46 | code: `request-usage-fold` |
| `lib/model-pricing.js` (LLM) | 3 | 4 | code: `request-usage-fold` |
| `lib/kpi-page.js` (Platform) | 1 | 2 | code: `workspace-kpis-cache` |
| `lib/usage-snapshot-intake.js` (Other) | — | 2 | code, N1 |
| `lib/dispatch-store.js` (Runs) | 7 in (from Agent API, LLM, Other, Reports, Wiring) | 7 in (from Agent API, LLM, Reports, Wiring; Other dropped out) | code: lineage-identity read absorbed (N1), direct import from Reports; outbound 9 → 10 with `→ usage-snapshot-intake` |

Source: E/compare-run6.md:75-77, :84-86, :101-124. Every other hub in run 5's table is unchanged (`proxy-preamble`, `tree`, `run-controls`, `task-page-loader` at E/compare-run6.md:125-147).

## 4. Ways in and rebuild readiness

Only what moved is written here. Entry files are `seams.mjs`'s; readiness is judgement on the measured edges.

- **Runs & dispatch.** 93 of 108 files are entry files (run 5: 89 of 102). Placement added 3 (`cost-read`, `row-usage`, `lineage-membership`) and code added the loader. Internal imports 166 → 187 (E/supplementary-figures.txt §S15).
  - The area still has no narrow way in. It now has a good one for the cost read: a pure read behind an injected loader (N9).
  - **Readiness low–medium, unchanged.** LIN-4226 (#2275) is moving the load into the read's callers' shape. Judge the hub after it merges.
- **Reports & operator tools.** 6 of 8 files are entry files (+`workspace-kpis-cache`, used only by `routes/workspace-kpis.js`; E/compare-run6.md:88).
  - Its reach into Runs grew by code, Reports → Runs 11 → 13 (`workspace-kpi-stats → dispatch-store`, `→ request-usage-loader`).
  - **Readiness medium.** The KPI page now sits behind a cache that is injected and registered in key-state.
- **Other features.** 13 of 14 entry files (+`usage-snapshot-intake`, −`founder-lookup`). Readiness: n/a until the files are placed.
- **LLM, Agent API, Web routes.** The same shape, plus the edges listed in §2. Each gained edges to the loader. Readiness unchanged.
- **LIN-4195 and LIN-4226.** These are the only live rebuild. When #2275 lands, the cost read's importer set should settle, and a cost-area decision (N10, P2) becomes measurable.

## 5. Tool blind spots (as numbers)

- **Parse failures, dynamic imports, unmapped (seams):** 0, 0, 0 at all four runs. **Unresolved relative imports:** 4 at all four runs, all in `routes/test.js` (E/compare-run6.md:3-9).
- **Not read by the tool:**
  - **Browser globals and script lists** (F6).
  - **The runner kit's HTTP post.** LIN-4203 changed `lib/runner-kit/runner.mjs` by +15 / −59 (E/supplementary-figures.txt §S0). The `[usage]` snapshot path is gone, and the one usage wire left is `POST /api/proxy/runner/usage/:id` (`runner.mjs:901`).
  - **The legacy-snapshot counter.** Harbour still accepts `[usage]` posts and counts them (`lib/dispatch-store.js:3736` → `usage-snapshot-intake`). The wire contract is Drift's.
  - **Measurement scripts.** `scripts/lin-4200-*.mjs` import `cost-read`, `request-usage-store`, `-vocabulary`, `row-usage`, `model-pricing`, `lineage-membership`, `kpi-stats` and `read-horizon` directly. They go around the loader door, but they are read-only measurement scripts outside the app (E/supplementary-figures.txt §S10).
  - **Simple Dispatcher.** Still flat CommonJS at `d8d186c0`: `dispatcher.js` has 35 `require(` lines and 0 `import`/`export` lines, and `package.json` has no `"type"` (E/supplementary-figures.txt §S13). It stays outside `seams.mjs`.
- **Change coupling unmapped:** 5273 → 5351. `shallow: false` at both (E/compare-run6.md:283-289).
- **Measurement caveat.** Cochange applies the guide to historical paths, so files deleted long ago (`next-run.js`, `share-*`, `flight-companion-turn.js`) fall into its "Other features". Its Other pairs are not comparable with the seams catch-all (E/supplementary-figures.txt §S12).

## 6. Change coupling beside import coupling

`cochange.mjs --days 60`, both guides, both commits.

- **Overlap.** The windows are 2026-09-05T05:23Z → 11-04T05:23Z and 2026-09-05T17:18Z → 11-04T17:18Z, sharing **59.504 of 60 days (99.17%)**. Of the commits, 846 are shared, 28 dropped out (all dated 2026-09-05) and 8 were added (E/supplementary-figures.txt §S11). **This is not a trend.** The small decreases below come mostly from the 28 commits leaving the window.
- **Totals.** 874 / 400 / 76 pairs → **854 / 392 / 76**, the same under both guides (E/compare-run6.md:283-289).
- **The guide effect on pairs** is ±1–3 on the "Other" pairs at both commits, and −1 on Auth pairs at `d7ceb373` (`workspace-kpis-cache` moving out of Auth). The top pairs are unaffected (E/compare-run6.md:308-310).

Top pairs, HEAD guide; run 5's §6 values in brackets (they reproduce exactly at `5334c81a`; E/compare-run6.md:291-306):

| pair | run 6 (`d7ceb373`) | run 5 | import link? |
|---|---|---|---|
| Browser code + Pages | 140 | (142) | no |
| Runs + Web routes | 110 | (111) | yes |
| Browser code + Web routes | 105 | (107) | no |
| Agent API + Runs | 100 | (101) | yes |
| Pages + Web routes | 99 | (99) | yes |
| Web routes + Wiring | 93 | (95) | yes |
| Pages + Runs | 91 | (92) | yes |
| Browser code + Runs | 85 | (87) | no |
| LLM + Runs | 84 | (85) | yes |
| LLM + Web routes | 77 | (82) | yes |

- **No-link pairs.**
  - Run 5 published 18 of 76 (old guide at `5334c81a`). On the series it is 19 → 20 (E/compare-run6.md:315-319).
  - The two that appear under the HEAD guide are artefacts, not hidden seams:
    - **Agent API + Other (14):** `cost-read` moved out of Other, and the old catch-all members are gone.
    - **Other + Reports (5):** `founder-lookup` was deleted, so `workspace-kpi-stats` no longer imports into Other.
- **Agent API + Reports (13, no link)** is driven by cost and KPI work (`2ee4e600`, `9cc5ff9c`, `46b43b3b`, `30db2052`, …; E/supplementary-figures.txt §S12). `/cost` and the KPI readers change together because both read the cost path in Runs. The coupling is a shared dependency, not a missing seam.
- **Candidate seam: unchanged.** The Browser code pairs are still among the largest and have no import link (F6). The merge-queue reading is run 5's: a change to a page or route is often paired with a `public/` script change. Per-file churn is the Stability Review's.

## 7. Guide proposals (prose only; nothing is edited)

- **P1b — place the catch-all.** **Partly adopted:** 3 of run 5's 17 were placed by LIN-4201, and `founder-lookup` was deleted. **Still stands** for the 14 at HEAD: the 13 remaining run-5 files plus `usage-snapshot-intake`, which belongs with Runs beside `request-usage-*`. A pattern of `(request-usage|usage-snapshot)-…` would do it.
- **P1c — hygiene in the same edit (new).**
  - Drop the dead `task-cost|` alias (N8).
  - Narrow `workspace-(?!kpi-stats\.js)[^/]*` to the Auth files it means, and move `workspace-api-mocks.js` to Web routes.
  - This replaces run 5's separate `workspace-issues-memo` hygiene item.
- **P2 — `tree.js` to Task model; model routing as its own area.** Not adopted; still stands. N10 adds a third option to weigh when LIN-4195 closes: a "Costs & usage" area. The graph supports it (the cost family spans four areas), but it should be measured as a labelled experiment, not assumed.
- **P3 — `experiments/rebuild-[^/]+/` to Reports & operator tools.** Not adopted; still stands. Run 5 found it cosmetic. Stability 11-04 F10 records the same gap: `experiments/` is unclaimed by any area.
- **P1 (run 4's placement of the twelve).** Folded into P1b, as in run 5.

## 8. Existing tickets and the carried items

Checked against code and against Linear state read on 2026-11-04 at about 18:39Z (E/external-state-2026-11-04.txt). None were changed by this report.

| ticket | state | what it covers | this run |
|---|---|---|---|
| LIN-4154 (FU-1) | Backlog, parent LIN-3490 | `fmtDuration` out of `render-run-steps.js` | anchors hold (`:258`; importers `task-state.js:22`, `task-page-loader.js:50`, `render-task-page.js:58`). Note: `task-page-loader` is a Runs file (N2) |
| LIN-4155 (FU-2) | Backlog, parent LIN-3820 | `applyDefaultDispatchHarness` out of `proxy-preamble.js` | anchor holds (`:152`) |
| FU-3 (recorded only) | — | Providers → `recommendation-facts` (`parentNextOf`) | unchanged |
| LIN-3922 | Backlog, unparented | `tree.js:189` re-export | unchanged |
| LIN-3923 | Backlog, unparented | the LLM ↔ Providers knot | unchanged (11/4) |
| LIN-3736 | Backlog, **parent LIN-3449** (run 5 listed it unparented) | `stableStringify`/`hashContext` to plumbing | unchanged (`recap-cache.js:27,94`; a twin at `run-summary-cache.js:32`) |
| LIN-3737, LIN-3738, LIN-3555 | Backlog, unparented | `collectIssueAttachments`; preamble provisioning; `RefResolutionError` | unchanged (`proxy-wire.js:285`, `proxy-ref-resolver.js:80`) |
| LIN-2600 | Backlog, parent LIN-2601 | dead imports in `routes/proxy.js` | 45 by the run-4 heuristic (F7) |
| LIN-4193 | Backlog, parent LIN-3936 | name the cost modules into an area; rename `weekly-budget.js` | 3 of its 4 files placed by LIN-4201. Left: `cost-format` and the rename. Run 5's comment on it was posted (2026-11-04 08:07Z, corrected 08:25Z) |
| LIN-4195 | In Progress | costs rebuild 2 | pieces 0–6 (LIN-4197 to LIN-4203, plus LIN-4212) Done; 4b open |
| LIN-4226 | In Progress, parent LIN-4195 | piece 4b: the cost read loads its records | PR #2275 open; moves N6 (+2 importers) and F1 (+1 LLM → Runs) next run |
| PR #2185 (LIN-4028) | open, last updated 2026-10-30 | `lib/routing-ruling.js` | not on main; would land in the catch-all under the HEAD guide |
| LIN-3720 | Done | the earlier map-only ticket for the catch-all | the catch-all is still 14 |
| LIN-4176, LIN-4179 | Done | one cost read; Harbour calls on it | the reason N6's two reads are not ticketed |

## 9. Follow-ups minted: none

Each candidate was checked against Linear before deciding (searches for `readCalls`, `callsSurfaceOf`, `appCallsOf`, `usage-snapshot-intake`, "Other features catch-all", "workspace- pattern" and "task-cost alias").

1. **Split Harbour's call-cost read out of `cost-read.js`** (N6). This would reverse a recorded decision: LIN-4176 and LIN-4179 (Done) put the calls on the one read on purpose. Not minted.
2. **Place `usage-snapshot-intake` and the remaining catch-all** (N1, P1b/P1c). This is a guide edit, so it is a proposal and not a code move. LIN-4193 already owns the cost files and LIN-3720 was the map ticket. Not minted.
3. **F1's code growth.** It sits inside LIN-4195, which is still moving (LIN-4226, PR #2275). A ticket now would aim at a moving target, as in run 5. Not minted.

Nothing in the window adds a `lib/` → `routes/` import or a new knot pair. Those are the two things that would justify a new seam ticket in a thin window.

## 10. Adversarial Second-Read

**Tier 1.** A wholly separate session (the dispatched `review` stage, session `ff147009`) with no memory of the report-writing run. Read: PR #2276 at head `fdae4eee4ed92ad1c109eaa528c17573dd0d3f06`, against `d7ceb373` / `5334c81a`.

**Question:** *what is the largest item in this window that this report missed or misfiled?*

**Answer.** Before answering, the reader re-ran all eight tool runs (`seams.mjs` × 4 and `cochange.mjs --days 60` × 4). The output is identical to the committed evidence, apart from the `areaMapSource` path string, and both guides are byte-identical. The catch-all's 14 members, F1 30/37, the 13 added and 3 removed cross-area edges, the importer counts for the loader, `cost-read` and `usage-snapshot-intake`, and the no-link pairs (18/19/18/20) all reproduce. Nothing in the report is misfiled by number.

The largest item the report **under-reads** is **`founder-lookup`'s deletion**. The report files it as a catch-all member swap (N1: "code, a swap"). In code, the move was a hub absorption:
- The lineage-identity query (`lineageIdentityOfRows`) moved **into `lib/dispatch-store.js`** (`:330`), Runs' store hub.
- It is now reached **two ways**: injected by `server.js:2507` for the kpi-stats path, and **imported directly** by Reports' `lib/workspace-kpi-stats.js:40`. This is the new `workspace-kpi-stats → dispatch-store` Reports → Runs edge.
- In the same window, `dispatch-store` also gained the Runs → Other edge to `usage-snapshot-intake` (`:59`).
- So the store took on a domain read and a counter. One of its two callers bypasses the injection pattern that the report praises as N9 for the request records.

It is Low–Medium, and it does not change the ranking: F1 stays the top finding. It belongs as one sentence under N1 or §4 (Reports readiness), with the `dispatch-store` absorption noted in the hub-movers table (outbound 9 → 10). It is not a follow-up, because LIN-4226 / PR #2275 is still reshaping these callers. The reading is now recorded under N1, in the hub-movers table and in the §11 ledger.

Adversarial second-read verdict: AGREE
Differed from top finding: YES
Disposition: fixed in place

## 11. Trend ledger

The stable names carry forward from run 5. Delta is against run 5's published figures (old guide at `5334c81a`), with the series figure where the guide matters.

| name | severity | run 5 | run 6 | delta |
|---|---|---|---|---|
| F1 `knot:agents-chat<->runs` | High | 26/35 (series 29/36) | 30/37 | **grew**: code +1/+1 (runtime +0/+1); placement +3/+1 |
| N1 `knot:other-features-catch-all` | Medium–High map / Medium code | 17 files | 14 (13 + `usage-snapshot-intake`) | **improved** by placement (−3); code swap ±1 |
| N6 `hub:cost-read.js` | Medium, watch | 9 in from 5 areas (old guide) | 5 in from 4 areas (Runs) | **improved** by placement; code +1 intra; #2275 → 7 |
| N9 `door:request-usage-loader` | healthy, Low | — | 7 importers, 6 cross-area incl. `server.js` (the rest import the guard only) | **new** |
| N10 `map:cost-family-split` | Low–Medium | — | 11 of F1's 67 edges | **new** |
| `hub:dispatch-store.js` (absorbed lineage read, under N1) | Low–Medium | — | 7 cross-area in; outbound 9 → 10; direct Reports → Runs import at `workspace-kpi-stats.js:40` | **new as read** (second-read) |
| N8 `map hygiene: deleted task-cost` | Low | alias + 3 comments | alias + 2 comments | **improved** (−1 comment) |
| `map hygiene: workspace- prefix (Auth)` (alias: `workspace-issues-memo.js`) | Low | 1 file named | `workspace-kpis-cache` near-miss; `workspace-api-mocks` (6 importers) | renamed; unchanged in effect |
| N7 `door:request-usage-intake` | Low, healthy | 1 intake, 2 doors | same | unchanged |
| F6 `knot:browser-window-globals` | Medium | 52 / 100 | 52 / 100 | unchanged |
| F2 `knot:runs<->page-renderers(render-swipe)` | retired | retired | retired | unchanged |
| F3 `knot:providers->upward` | Medium | 4 | 4 | unchanged |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 11 / 10 | 11 / 10 | unchanged |
| F5 `knot:routes-as-libraries(dashboard)` | Medium | 53 | 53 | unchanged |
| F7 `knot:dead-import-inflation(routes/proxy.js)` | Low | 45 | 45 | unchanged |
| F8 `knot:production-loads-routes/test.js` | Low | 4 unresolved | 4 unresolved | unchanged (`server.js:140→142`, `:1208→1215`) |
| N2 `hub:task-page-loader.js` | Medium | 7 in / 9 out | 7 / 9 | unchanged; **area corrected to Runs** |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 4 | 4 | unchanged |
| N4 `hub:run-controls.js` | Medium, watch | 19 | 19 | unchanged |
| N5 `knot:task-model` | healthy | 2 files | 2 files | unchanged |
| `hub:tree.js` | watch | 6 | 6 | unchanged |
| `wiring: server.js` | Low, watch | Runs 44; Other 8 | Runs 45; Other 8 (swap) | +1 Runs (loader) |
| `hub:render-run-steps.js` (FU-1) | Medium | 2 in / 4 out | 2 in / 4 out | unchanged |

**Change-coupling top pairs** (run 5 values in brackets; the windows overlap 99.17%):

| pair | run 6 | (run 5) |
|---|---|---|
| Browser code + Pages | 140 | (142) |
| Runs + Web routes | 110 | (111) |
| Browser code + Web routes | 105 | (107) |
| Agent API + Runs | 100 | (101) |
| Pages + Web routes | 99 | (99) |
| Web routes + Wiring | 93 | (95) |
| Pages + Runs | 91 | (92) |
| Browser code + Runs | 85 | (87) |
| LLM + Runs | 84 | (85) |
| LLM + Web routes | 77 | (82) |

No-link pairs: 18 (run 5, old guide) → 18 (old guide) / 20 (HEAD guide) of 76.

## Sibling hand-offs

- **Drift & Coherence** (11-04, LIN-4209; the next run is LIN-4232, in progress) owns:
  - the usage wire contract and its restated limits;
  - file-level cycles, including the `model-pricing`/`row-usage` avoidance N10 cites;
  - file-level direction;
  - stale comment text.
  This report cross-links F5 and N8 and does not re-grade them.
- **Code Quality** (11-04, LIN-4207) handed over the placement of `lib/errors.js` and `routes/test.js`:
  - `errors.js` is Platform, a leaf with 63 cross-area importers, and correctly placed (E/compare-run6.md:83);
  - `routes/test.js` is F8.
  Function size stays with Code Quality.
- **Stability** (11-04, LIN-4206) owns churn. Its F10 (`experiments/` unclaimed) is P3 here.
- **Cost tracking** (`cost-tracking-review-2026-11-02.md`, LIN-4126) owns the cost read's correctness. Its `routes/proxy.js:42` dead `buildTaskCost` import was already gone at both commits.
- **Survey** (read only, `origin/claude/cool-rubin-6acj5j` at `2cc0d1fd`):
  - F1 bears on the LIN-4201 row (`place-ledger.md:32`);
  - N1 bears on the LIN-4203 row (`place-ledger.md:33`).
  Neither row is edited.

## Measurement notes

1. **The ticket's mint-time figures all reproduced:** 1249 → 1259, 1275, 12 pairs, a group of 9, F1 29/36 → 30/37, 536 → 540, 4 unresolved, and 874/400/76/5273 → 854/392/76/5351 (E/compare-run6.md).
2. **This run's own beat-1 notes on LIN-4231 said "11 of the 14" catch-all files were unplaced.** The right count is 13 of run 5's 17 plus `usage-snapshot-intake`. That was corrected on the ticket.
3. **`workspace-api-mocks.js` importers are 6 by the edge dumps.** A `git grep -l` gives 8, but two of those are comment mentions.
4. **The F7 heuristic is reproduced from run 4's description** (named `../lib/` imports, identifier not found outside the import statement). It gives 96 named imports and 45 unused at both commits, matching run 5.
5. **PR and Linear states are as read at about 18:39Z.** #2275's CI was still running at that time.
