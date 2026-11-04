# Seams & Tangles Review — 2026-11-04 (run 5, delta vs the 2026-11-03 run)

Task: LIN-4208 · Parent: LIN-3549 · Previous: `seams-tangles-review-2026-11-03.md` (LIN-4152, run 4) · Tools: `scripts/code-shape/seams.mjs` and `scripts/code-shape/cochange.mjs`, both unchanged in the window (last touched by LIN-3881, `856d8ae6`).

Review-only: no code, config, guide or doc edits beyond this report and `docs/reviews/_evidence-2026-11-04/`. The guide is proposed against, not edited.

**Headline: a thin window, and the one thing that matters is placement hiding growth.** The "Other features" catch-all regrew from 12 to 17 files (N1). Five of the seventeen are new code, and the committed map shows them only as one unlabelled area. On a placed map the window adds 29 cross-area links and no new knot pair, and the knot group stays at nine areas (eight once the catch-all is placed). **LLM & prompts ↔ Runs & dispatch (F1) gained three real edges on a placed map** (28/34 → 29/36). On the committed guide that pair total is unchanged at 61, because one edge was replaced by another (`task-cost.js` → `cost-read.js`), not removed. **The window's largest item is a new hub, `lib/cost-read.js`** (N6: 9 cross-area importers from 5 areas, and bidirectional reach into Runs and LLM). It sits inside the catch-all, which is why the committed map does not name it. It is in flight under LIN-4195, so it is ranked first and watched, not ticketed. Change coupling is bounded by the window: about 58 of 60 days are shared with run 4's window, and the biggest movers moved by +4. No follow-up tickets are minted. The one ticket-side action is a comment on LIN-4193, which already covers part of the catch-all.

## 0. What was measured

- **Commits.** Baseline `015aa4c6acbc008d7fa73c32beec1528b7f59511` (run 4's measured commit). Measured `5334c81a7207b9f2cc85ca429a2c6b18e1635c0e` (origin/main at measurement; 15 commits in the window, `015aa4c6..5334c81a`). Both tools read committed git objects only.
- **Scope.** At `015aa4c6`: 528 files, as run 4. At `5334c81a`: **536 files**, +8 net (nine files added: five catch-all members, `request-usage-intake.js`, `request-usage-store.js`, `workspace-issues-memo.js`, and `public/cost-format.js`; one deleted: `lib/task-cost.js`). Production diff `lib routes public server.js`: 77 files, +2,674 / −991.
- **Tool limits, every run.** 0 parse failures; 0 non-literal dynamic imports; 0 unmapped files (seams); **4 unresolved relative imports**, all in `routes/test.js` (`tests/fixtures/{local,github,github-projects,jira}-harness.js`, see F8). `lib/` → `routes/` imports: **0** (tool links and `git grep`, both commits).
- **Evidence.** `docs/reviews/_evidence-2026-11-04/` (its README lists every command). Both guide copies, eight standard runs (seams and cochange, each code × guide), two labelled guide experiments (P1b and P3, §7), the file-level edge dumps, and the scripts that derive the figures in this report (`hub-and-edge-figures.py`, `file-edge-diff.py`).
- **Two guides, one difference.** The guide changed once in the window: `request-usage-[^/]*` was added to "Runs & dispatch" (LIN-4198, `9cc5ff9c`). The series below uses the HEAD guide at both commits, as runs 3 and 4 did. The old guide (`015aa4c6`'s) is kept as the guide-effect control.

## 1. Changes since run 4 (first)

1. **N1, the catch-all, grew from 12 to 17 files.** Five files were added by code in the window: `lib/cost-read.js` (434 lines, LIN-4177/4178/4179), `lib/cost-format.js` (LIN-4177/4179), `lib/founder-lookup.js` (LIN-4177), `lib/key-state.js` and `lib/key-state-holders.js` (LIN-4168). The run-4 twelve are all still there. The guide was edited once, and not for these files, so all five fall through to the catch-all. **Code: five new files.** Severity stays High as a map, Medium as code.
2. **F1, LLM & prompts ↔ Runs & dispatch, gained three real edges on a placed map and reads −1 +1 on the committed guide.** Placement and code are separate here (§3, F1). Severity High.
3. **New hub: `lib/cost-read.js`.** Nine cross-area importers from five areas; four outbound cross-area edges to Runs, LLM and Platform. It replaced `lib/task-cost.js` (deleted, Runs). In flight under LIN-4195 and LIN-4201 (Todo), which rethreads every caller through `RequestUsageStore.listForAnchors`. Watch only.
4. **New door: `request-usage-intake`.** One intake with two doors (`routes/dispatch.js:65`, intra-Runs; `routes/proxy-runner.js:48`, Agent API → Runs) and wiring at `server.js:134`. The runner kit's post is HTTP and outside the import graph. Healthy.
5. **F6, browser globals, +1.** `window.CostFormat` in `public/cost-format.js`; `window.X =` in `public/` 99 → 100; in `public/common.js` still 52. The browser mirror of `lib/cost-format.js` is Drift's; the global and its script-list wiring are F6.
6. **Wiring grew in edges, not shape.** `server.js` gained cross-area imports to Runs (41 → 44), Other (5 → 8) and Auth (47 → 48). These are composition edges for the new intake, key-state and founder-lookup. Low.
7. **Map hygiene (new).** `lib/workspace-issues-memo.js` (a 30 s issue-set cache, LIN-4168) lands in Auth through the over-broad `workspace-(?!kpi-stats\.js)[^/]*` pattern. Low.
8. **Carried ticket LIN-4154 is unblocked.** Its precondition, LIN-4106 landed first, is met (`300c811f`, Done). The anchors hold: `lib/task-state.js:22`, `lib/task-page-loader.js:50`, `lib/render-task-page.js:58` import `render-run-steps.js`, and `fmtDuration` is now at `lib/render-run-steps.js:258`. Ticket state: Backlog.

Unchanged: F2 (retired in run 4, still retired), F3, F4, F5, F7, F8, N2, N3, N4, N5, the `tree.js` hub, and Pages ↔ Runs (13/8). Every one of these is in §8 with its run-4 values.

## 2. Four-run table and the guide effect

Seams, nine areas in the knot group at each run, 12 two-way pairs at each run.

| code \ guide | old guide (`015aa4c6`) | HEAD guide (`5334c81a`), the series |
|---|---|---|
| `015aa4c6` (run 4 baseline) | 528 files · 1227 links · 12 pairs · group 9 · Other 12 | **identical** (the guide edit names files that do not exist yet) |
| `5334c81a` | 536 · 1262 · 12 · 9 · Other 19 | 536 · **1262** · 12 · 9 · Other **17** |

- **Guide effect, apart from code.** The HEAD guide moves `request-usage-intake.js` and `request-usage-store.js` from the catch-all into Runs. Total links (1262) and the pair set (12) do not change, but the direction counts do: Agent API → Runs 41 → 42, Runs → LLM 34 → 35 under the HEAD guide, LLM ↔ Other 4/3 → 4/2. The catch-all is 19 files under the old guide and 17 under the HEAD guide.
- **Code movement, on the series (HEAD guide, 1227 → 1262, +35).** No pair opened or closed. The directed counts that moved, largest first: Pages → Other 2 → 8, Runs → Other 12 → 15, Other → Runs 6 → 9, Wiring → Other 5 → 8, LLM → Other 1 → 4, Wiring → Runs 41 → 44, Web routes → Other 3 → 6, Runs → LLM 34 → 35, LLM → Runs 27 → 26 (a replacement, §3 F1). Almost all of the Other rows are catch-all membership (N1), not new coupling between two real areas.
- **Trend note for the ledger.** Run 4's 1227 / 12 / 9 reproduces exactly at `015aa4c6` under the HEAD guide. Use 1227 → 1262 (+35) for this run.

Knot pairs, HEAD guide (two-way area pairs; `a→b / b→a`):

| pair | run 4 (`015aa4c6`) | run 5 (`5334c81a`) | status |
|---|---|---|---|
| Agent API ↔ LLM | 37/4 | 37/4 | unchanged |
| Agent API ↔ Providers | 20/3 | 20/3 | unchanged |
| Agent API ↔ Runs | 42/10 | 42/10 | unchanged on the series; 43/10 → 44/10 on a placed map (N7) |
| Auth ↔ Pages | 14/11 | 14/11 | unchanged |
| Auth ↔ LLM | 4/3 | 4/3 | unchanged (N3) |
| Auth ↔ Providers | 12/1 | 12/1 | unchanged |
| LLM ↔ Providers | 11/4 | 11/4 | unchanged (F3) |
| LLM ↔ Runs | 27/34 | **26/35** | grew, placement hides it (F1) |
| Pages ↔ Runs | 13/8 | 13/8 | unchanged (§8) |
| Pages ↔ Other | 2/6 | **8/6** | grew (N1, placement) |
| LLM ↔ Other | 1/1 | **4/2** | grew (N1, placement) |
| Other ↔ Runs | 6/12 | **9/15** | grew (N1, placement) |

## 3. Findings, severity-ranked, trend-framed

Stable names are those of run 4 §11. Severity and trend are against run 4.

### Ranking note

The findings are ranked by what changes the dependency graph, not by where the file sits. N6 (`cost-read.js`) is the window's largest item: it is the one new node that reaches into two areas and is reached from five, and no area owns it. N1 (the catch-all) is the map frame that holds it and the twelve older tangles; it is High as a map. F1 is the largest change to an existing knot. The order below is N6, N1, F1, then the rest.

### N1 — `knot:other-features-catch-all(lib first-match)` · **High as a map, Medium as code** · **worsened, 12 → 17 files**

- **Size.** Under the HEAD guide's first-match, the catch-all holds 17 files at `5334c81a`: the run-4 twelve (`dashboard-refresh`, `home-pipeline`, `home-row-states`, `home-rows`, `home-view`, `lineage-membership`, `live-anchor`, `row-usage`, `ruling-standing`, `subtree-index`, `task-facts-holder`, `task-state`) and the five new ones (`cost-format`, `cost-read`, `founder-lookup`, `key-state`, `key-state-holders`). The count was checked by enumerating the guide's first-match over `git ls-tree`: 12 and 17, matching the tool.
- **Placement vs code.** Two things grew, and they should not be read as one.
  - *Code:* five new files, all added in the window (LIN-4168, 4177, 4178, 4179). Each is real.
  - *Map:* the pair counts. Pages ↔ Other, LLM ↔ Other and Other ↔ Runs are the only pair deltas in this run, and they exist because the catch-all is a single area. The placed map (P1b, §7) shows the same edges re-labelled as Runs, Platform and Task model; the 12-pair, group-8 shape is the same at both commits.
- **Pairs, placed and unplaced.** Under P1b the catch-all is empty at both commits and the three Other pairs disappear into Pages ↔ Task model (5/2), Runs ↔ Task model (4/3) and LLM ↔ Task model (2/1). The wrong-way code is still the three files run 4 named:
  - `lib/task-state.js:21–22`: imports `run-view.js` (Runs) and `fmtDuration` from `render-run-steps.js` (a renderer). Still there (LIN-4154).
  - `lib/home-row-states.js`: imports `task-page-loader.js` (Pages-side) and `ruling-standing.js`.
  - `lib/subtree-index.js`: imports `recommendation-facts.js` (LLM) for `compareByIdentifier`.
- **New in-window reach.** `lib/cost-format.js` has seven importers: six Pages renderers (`render-effort-readout`, `render-kpis`, `render-run-steps`, `render-settings`, `render-workspace-kpis`, and `components/decision-panel`) and `ship-biscuit.js` (LLM). It is a leaf (no outbound edges), so it cannot knot, and it is the browser mirror's source (Drift). `lib/cost-read.js` is the reach-in hub, §4.
- **Reading.** The catch-all is a guide problem first. LIN-3720 (Done; its title is "decide the area for the 12 lib/ files still in 'Other features'") is the earlier map-only ticket for these files, and at HEAD the guide still puts the 17 in Other. LIN-4193 (Backlog) covers four of the seventeen (`cost-read`, `cost-format`, `row-usage`, `lineage-membership`) and the `weekly-budget` rename (§8).

### F1 — `knot:agents-chat<->runs(chat-tools)` · **High** · **grew, hidden by the catch-all: 27/34 → 26/35 on the series, 28/34 → 29/36 on a placed map**

- **Series (HEAD guide).** LLM → Runs 27 → 26; Runs → LLM 34 → 35.
- **Placement (−1 on LLM → Runs).** `lib/model-routing-spend.js` imported `buildTaskCost` from `lib/task-cost.js` (Runs). LIN-4177 (`10b2c82f`) deleted `task-cost.js` and its caller now imports `lib/cost-read.js`, which the HEAD guide files in Other. The edge was replaced, not removed: it is a file-level replacement and a filing change at the same time. This is the −1.
- **Code, on the placed map (P1b, both commits).** LLM ↔ Runs 28/34 → 29/36 (62 → 65 edges, the +3 below):
  - LLM → Runs +1: `model-routing-history.js → lineage-membership.js` (LIN-4177, `10b2c82f`).
  - Runs → LLM +1: `request-usage-intake.js → model-pricing.js` (LIN-4198, `9cc5ff9c`). Also visible on the HEAD guide (Runs → LLM 34 → 35).
  - Runs → LLM +1 under P1b: `cost-read.js → llm-call-log.js` (LIN-4179, `72305215`). On the HEAD guide it is Other → LLM (1 → 2), which is why the series does not show it as Runs → LLM.
- **Reading.** Model routing and the cost read reach across LLM and Runs, as in run 4. The real growth is two edges in the Runs → LLM direction and one in the other, all attributed by `git log -S` on each import (the other new cross-area edges in this report are not attributed). No follow-up targets F1 directly: the cost read is in flight under LIN-4195, and a ticket now would aim at a moving target.

### N6 — `hub:cost-read.js` · **Medium–High, watch, ranked first** · **new**

- *Why it ranks first.* It is the only new file in the window that imports from two areas and is imported from five, so it creates bidirectional reach (Runs ↔ Other, LLM ↔ Other) that the committed map cannot attribute to any area. Its placement is contestable: under the committed guide it is Other (so Other → LLM 1 → 2 is `cost-read → llm-call-log`), and under P1b it is Runs (Runs → LLM +1 by the same edge). Either filing is a map choice; neither makes the edge go away.

- Nine cross-area importers from five areas: `effort-readout`, `model-routing-spend`, `run-view`, `terminal-marked-task-cost`, `weekly-budget`, `workspace-kpi-stats` (Reports), `routes/proxy-compute` (Agent API), `routes/settings`, `routes/ship-biscuit` (Web routes). Outbound: `dispatch-terminal.js` and `session-telemetry.js` (Runs), `llm-call-log.js` (LLM), `utils/time.js` (Platform).
- It is bidirectional with Runs, as `task-cost.js` was. Its replacement is in flight: LIN-4200 (In Progress, the measure-before-switch gate) and LIN-4201 (Todo, the records-first cutover that threads `requestRows` through every caller). Expect `request-usage-store`'s importers to grow from one to about seven next run.
- **Not a finding yet.** Judge it as a map fact after LIN-4201 lands. No ticket.

### N8 — `map hygiene: deleted task-cost module still named` · **Low** · **new**

- `scripts/code-shape/areas.json:24` (the "Runs & dispatch" pattern) still lists `task-cost|`, a module deleted by LIN-4177. It matches nothing now. Harmless to the counts, but a reader of the guide will think the module exists.
- Five `lib/` comments still cite the deleted `lib/task-cost.js`: `dispatch-lineage.js:4` and `:76`, `model-routing-spend.js:5`, `wall-clock-summary.js:97`, and `runner-kit/runner.mjs:768`. Two test files keep the old name in prose or filename: `tests/unit/task-cost.test.js` (it now tests the fixture adapter over `cost-read`) and the gate-prose test's describe title (`lin-2253-instructions-cost-gate-prose.test.js:67`). The gate test reads `lib/cost-read.js` and passes.
- No live import of the deleted module remains (`git grep` at `5334c81a`). Proposal: when cost-read is placed, drop `task-cost|` from the pattern in the same edit (§7). Comment hygiene is Drift's (decisions held in several places) and is not ticketed here.

### N7 — `door:request-usage-intake` · **Low, healthy** · **new**

- One intake (`lib/request-usage-intake.js`), two doors (`routes/dispatch.js:65` intra-Runs; `routes/proxy-runner.js:48`, the one cross-area door, Agent API → Runs), and `server.js:134` for wiring. The store has one importer, the intake.
- The Agent API → Runs crossing is the one new Agent API → Runs file edge in the window. The `proxy-compute.js → task-cost.js` edge it replaced went to Other (`cost-read.js`) on the committed guide, so the series count is flat at 42. On the placed map Agent API ↔ Runs goes 43/10 → 44/10. It is a deliberate door, not a tangle.
- *Correction to the grounding:* `routes/dispatch.js` is in Runs, so its edge is intra-area. Only `proxy-runner` crosses.

### F6 — `knot:browser-window-globals(common.js)` · **Medium** · **grew by one, tool-blind**

- `window.X =` in `public/common.js`: 52 → 52 (the pattern `window\.[A-Za-z_]* *=`; the stricter `=[^=]` gives 48 → 48). Across `public/`: 99 → 100, the +1 being `window.CostFormat` in `public/cost-format.js`.
- `/cost-format.js` is in the script lists of six renderers (`render-flight-companion`, `render-observation`, `render-swipe`, `render-task-page`, `render-workspace-kpis`, `render.js`), which the import graph cannot see. The mirror itself, held in step by `tests/unit/cost-format-parity.test.js`, is Drift's.

### F2 — `knot:runs<->page-renderers(render-swipe)` · **RETIRED (run 4)**

Unchanged: `server.js:162` is the only importer. The Pages ↔ Runs pair is 13/8 and is carried as the successor name in §8.

### F3 — `knot:providers->upward(openrouter,ref-resolver,proxy-wire)` · **Medium** · unchanged

- Providers → LLM 4 (three `parentNextOf` edges from `lib/recommendation-facts.js`, plus `linear/index.js → openrouter`). Providers → Agent API 3 (LIN-3555, LIN-3737 not landed).
- `recommendation-facts.js` has five cross-area importers, as in run 4. FU-3 is recorded only (§8).

### F4 — `knot:runs->agent-api(proxy-preamble)` · **Medium** · unchanged

- 11 importer files, 10 cross-area: `chat-tools`, `dispatch-entrance`, `dispatch-factory`, `follow-up-dispatch`, `model-routing-harnesses`, `model-routing`, `wake-credential`, `routes/collective`, `routes/dispatch`, `routes/proxy`, `routes/workspace-api-feedback`. Same files as run 4.
- `applyDefaultDispatchHarness` is still at `lib/proxy-preamble.js:152`. FU-2 (LIN-4155, Backlog) is one day old, too early to judge the purpose-parent theory. The new Agent API → Runs edge in N7 is a different edge.

### F5 — `knot:routes-as-libraries(dashboard)` · **Medium** · unchanged

- `routes/*` → `routes/*` file edges: 53 at both runs (run 4's definition). The top targets are unchanged: `routes/workspace-api-steps.js`, `routes/dashboard-session-state.js`, `routes/dashboard.js`.

### F7 — `knot:dead-import-inflation(routes/proxy.js)` · **Low** · unchanged

- Named `lib/` imports in `routes/proxy.js` never used in the file body (the run-4 heuristic): 45 at `015aa4c6` and 45 at `5334c81a` (96 named imports at each). Run 4's 51 → 45 was 5b32864e → 015aa4c6; the window does not move it. LIN-2600 (Backlog, unparented) still stands.

### F8 — `knot:production-loads-routes/test.js` · **Low** · unchanged

- `server.js:140` imports `createTestRoutes, installTestTokenLinearTransport` from `./routes/test.js` (run 4: `:139`); `server.js:1208` calls `installTestTokenLinearTransport()` (run 4: `:1199`). The four unresolved fixture imports in `routes/test.js` are unchanged. Production → test-fixture half belongs to Drift.

### N2 — `hub:task-page-loader.js` · **Medium** · unchanged

- Cross-area importers 7 (Pages, Other, Web routes, Wiring); outbound cross-area 9 to five areas. Its back edges are the N1 reach (`render-run-steps`, `task-state`).

### N3 — `knot:auth->llm(model-routing)` · **Low–Medium** · unchanged

- Auth → LLM 4 (`workspace-preferences.js → openrouter.js, model-routing.js, prompt-templates.js`; `workspace-change-log.js → model-routing.js`). Cross-link: Drift.

### N4 — `hub:run-controls.js` · **Medium, watch** · unchanged

- 19 cross-area importers from three areas (Other, Web routes, Wiring); placement in Runs is right.

### N5 — `knot:task-model` · **healthy** · unchanged

- Two files (`task-order.js`, `graph-features.js`). Outbound cross-area only to Providers (3). In no two-way pair.

### Hub and reach figures, run 4 → run 5

| hub (area) | run 4 (cross-area importers) | run 5 | note |
|---|---|---|---|
| `lib/utils/html.js` (Platform) | 73 | 73 | leaf |
| `lib/errors.js` (Platform) | 62 | 63 | leaf |
| `lib/utils/time.js` (Platform) | 42 | 45 | leaf |
| `lib/workspace.js` (Auth) | 36 | 36 | 1 outbound |
| `lib/providers/state-map.js` (Providers) | 26 | 26 | leaf; the highest-reach hub |
| `lib/openrouter.js` (LLM) | 22 | 22 | 2 outbound |
| `lib/read-horizon.js` (Platform) | 18 | 19 | leaf |
| `lib/chat-request.js` (LLM) | 18 | 18 | |
| `lib/prompt-templates.js` (LLM) | 17 | 17 | |
| `lib/run-controls.js` (Runs) | 19 | 19 | N4 |
| `lib/proxy-preamble.js` (Agent API) | 10 cross (11 all) | 10 cross (11 all) | F4 |
| `lib/task-page-loader.js` (Pages) | 7 in / 9 out | 7 in / 9 out | N2 |
| `lib/tree.js` (Pages) | 6 | 6 | re-export at `:189` (LIN-3922) |
| `lib/recommendation-facts.js` (LLM) | 5 | 5 | F3 |
| `lib/render-run-steps.js` (Pages) | 2 in | 2 in; **out 3 → 4** (new edge to `cost-format.js`) | N1, FU-1 |
| `lib/cost-read.js` (Other) | — | **9 in** | N6 (new) |
| `lib/cost-format.js` (Other) | — | 7 in | N1 (new) |

## 4. Ways in and rebuild readiness

Only what moved is written here. Readiness is judgement on the measured edges; there are no scores.

- **Runs & dispatch — shape unchanged, one new cross-area hub read through.** The cost read is the new reach-in (N6), in flight. Door: `request-usage-intake` is one entry with two doors (N7). Readiness: low–medium, as run 4.
- **Other features (catch-all) — 17 files, not a feature.** Readiness: n/a until the files are placed (P1b). The five new files are not a seam; the twelve are the run-4 tangles.
- **Front end: server-rendered pages — one new edge set to Other, to `cost-format`.** Six renderers import the formatter. Readiness: medium, unchanged.
- **Wiring (server.js) — grew in edges, same shape.** Composition for the new intake, key-state and founder-lookup. Watch, not a finding.
- **Everything else.** Agent API, Auth, Providers, Platform, Reports, Task model and Web routes gained or lost only the file edges listed by `file-edge-diff.txt` (the complete added/removed list, 44 added and 11 removed file edges, of which the cross-area ones are all accounted for in §2 and §3).

## 5. Tool blind spots (as numbers)

- **Parse failures:** 0 of 528 (`015aa4c6`); 0 of 536 (`5334c81a`).
- **Dynamic imports:** 0 non-literal (both).
- **Unmapped files (seams):** 0 (both, HEAD guide).
- **Unresolved relative imports:** 4 at both commits, all in `routes/test.js` (lines 14, 20, 26, 33 of that file).
- **Not read by the tool:** browser globals and script-list wiring in `public/` and the renderers (F6: 52 `window.X =` in `common.js`, 100 across `public/`, `/cost-format.js` in six script lists); `server.js` scheduler and key-state wiring (`createKeyState` / `registerKeyStateHolders` at `server.js:167–168`, visible only as two import edges); the runner kit's HTTP post to the intake (`lib/runner-kit/runner.mjs:34`, a cross-process edge, Drift's wire contract); Simple Dispatcher (out of the tool's reach by design, see below).
- **Simple Dispatcher.** Still flat CommonJS: `dispatcher.js` has 35 `require(` and 0 `import`/`export` lines; `package.json` has no `"type"` field. Read directly from the workspace copy, not built.
- **Change coupling unmapped:** 5123 at `015aa4c6` and 5273 at `5334c81a` (HEAD guide, `--days 60`). `shallow: false` at both. The unmapped count rose by 150 over the window; I did not break that rise down by directory. The P3 experiment in §7 removes 418 of them and changes nothing else.

## 6. Change coupling beside import coupling

`cochange.mjs --days 60`, HEAD guide, both commits. The two windows are 2026-09-03 → 11-02 (`015aa4c6`) and 2026-09-05 → 11-04 (`5334c81a`): **about 58 of 60 days are shared**, so the delta is bounded by overlap and should not be read as a trend.

- Totals: 899 / 398 / 76 pairs at `015aa4c6` → **874 / 400 / 76 pairs** at `5334c81a`. Changes touching 2+ areas: +2.
- **No-link pairs: 19 → 18 of 76**, 12 of them Browser code. The pair that left the list is Other + Reports: `workspace-kpi-stats → cost-read` and `→ founder-lookup` are now real import links (Reports → Other, 0 → 2). That is a change-coupling candidate becoming an explicit import.

Top pairs, run 5 (run 4 in brackets; run 4 values reproduce run 4 §6):

| pair | run 5 | run 4 | import link? |
|---|---|---|---|
| Browser code + Pages | 142 | 140 | no |
| Runs + Web routes | 111 | 108 | yes |
| Browser code + Web routes | 107 | 106 | no |
| Agent API + Runs | 101 | 97 | yes |
| Pages + Web routes | 99 | 98 | yes |
| Web routes + Wiring | 95 | 93 | yes |
| Pages + Runs | 92 | 88 | yes |
| Browser code + Runs | 87 | 84 | no |
| LLM + Runs | 85 | 82 | yes |
| LLM + Web routes | 82 | 81 | yes |

- **Biggest movers, +4 each:** Agent API + Runs, Pages + Runs, Other + Runs, Other + Web routes.
- **Candidate seam, stated as prose and not enforced.** The Browser code pairs (with Pages, Web routes and Runs) are among the largest pairs in the list and have no import link, because the browser code has no import edges (F6). Those pairs are the coupling the import graph cannot show: a change to a server-rendered page or API route is often paired with a change to a `public/` script. That is a plausible reason merges queue behind each other, and it is the browser seam in another form. This report does not measure it further. Per-file churn belongs to the Stability Review.
- **Agent API + Runs (101) is the second-largest pair with an import link**, after Runs + Web routes (111). It grew by 4 with the new door (N7).

## 7. Guide proposals and labelled experiments

Nothing is adopted. Each is measured as an experiment, and none edits `scripts/code-shape/areas.json`.

- **P1b — place the 17 catch-all files (measured).** The run-4 P1 placement of its twelve files, plus the five new ones: `cost-read` and `founder-lookup` to Runs; `cost-format`, `key-state` and `key-state-holders` to Platform.
  - Catch-all: 0 files at both commits. Pairs 12 at both, group 8 at both.
  - Cross-area links: 1210 → 1239 (+29). The HEAD guide gives +35. The 6-link difference between the two deltas is measured but not attributed edge by edge.
  - F1 on this map: LLM ↔ Runs 28/34 → 29/36. Agent API ↔ Runs 43/10 → 44/10. Pages ↔ Task model 5/2, Runs ↔ Task model 4/3, LLM ↔ Task model 2/1 at both.
  - *Reading.* P1b removes the catch-all and leaves the wrong-way code in place. The proposal is one map edit, not a code move. It is the same proposal run 4 made, now with the new files named. The `workspace-issues-memo.js` hygiene item is a separate map edit (§1, item 7).
- **P3 — map `experiments/rebuild-[^/]+/` to Reports & operator tools (measured, cosmetic).** Unmapped files in cochange: 5123 → 4705 at `015aa4c6`, 5273 → 4855 at `5334c81a` (−418 each). Pairs: three pairs +1 (Reports + Runs 25 → 26, LLM + Reports 11 → 12, Agent API + Reports 12 → 13). Seams is unaffected (`experiments/` is outside its scope). Reading: the rebuild experiments land almost entirely on their own, so P3 tidies a count and does not reveal a seam. Not a candidate seam; not escalated.
- **Hygiene — stop tracking `experiments/rebuild-rung7/replay/work/`.** Not re-measured here beyond a count: 13 tracked files in `experiments/rebuild-rung7/replay/work/` at `5334c81a`. Recorded, not ticketed (run 4 §5).
- **Tests-in-guide.** Not measured in this run. Carried from run 4 as a proposal.

## 8. Existing tickets and the carried items

Checked against code and Linear state, read 2026-11-04. None were changed by this report.

| ticket | state | what it covers | this run |
|---|---|---|---|
| LIN-4154 (FU-1) | Backlog, parent LIN-3490 | `fmtDuration` out of `render-run-steps.js` | unblocked (LIN-4106 Done); anchors hold |
| LIN-4155 (FU-2) | Backlog, parent LIN-3820 | `applyDefaultDispatchHarness` out of `proxy-preamble.js` | anchors hold; too early to judge the purpose-parent theory |
| FU-3 (recorded) | — | Providers → `recommendation-facts` (`parentNextOf`), linked to LIN-3922 and LIN-3923 | unchanged; recorded only |
| LIN-3922 | Backlog | `tree.js` re-export of the focus-child picker | unchanged (`tree.js:189`) |
| LIN-3923 | Backlog | decide the LLM ↔ Providers knot | unchanged (11/4) |
| LIN-3736, 3737, 3738, 3555 | Backlog, unparented | hashing helpers; `collectIssueAttachments`; preamble; `RefResolutionError` | nothing moved in code |
| LIN-2600 | Backlog, parent LIN-2601 | 53 dead named imports in `routes/proxy.js` | still 45 by the run-4 heuristic (F7) |
| LIN-4193 | Backlog, parent LIN-3936 | name the cost modules into an area; rename `weekly-budget.js` | covers 4 of the 17 catch-all files plus the rename; a comment is proposed below |
| LIN-4195 | In Progress, parent LIN-3936 | costs rebuild 2: one record per model request | in flight; owns `cost-read.js` (N6) |
| LIN-4200 | In Progress, parent LIN-4195 | piece 3: measure records vs snapshots | in flight |
| LIN-4201 | Todo, parent LIN-4195 | piece 4: records-first cutover | in flight; rethreads every caller of `cost-read` |
| PR #2185 (LIN-4028) | open, last updated 2026-10-30 | adds `lib/routing-ruling.js` | not on main; would be an 18th catch-all file |
| LIN-3720 | Done | titled "decide the area for the 12 lib/ files still in 'Other features'" | the guide still places the files in Other at HEAD |
| LIN-4040, LIN-4106 | Done | UI round 3 | out of scope here |

**Follow-up comment on LIN-4193 (posted, not a ticket).** LIN-4193 covers four of the seventeen catch-all files. Its better-scoped version is the whole catch-all: place the 17 (P1b) in one map edit, plus `workspace-issues-memo.js` in an area pattern. This is a comment on the existing ticket, so no duplicate is minted (§9).

## 9. Follow-ups minted: none

- **Zero new tickets.** F1's new edges and the `cost-read` hub are inside LIN-4195, which is in flight, and LIN-4201 rethreads every caller next. A ticket now would aim at a moving target.
- The catch-all's fix is a guide edit (P1b), which is a proposal, not a code move. LIN-4193 already exists under a purpose-parent (LIN-3936), so the better-scoped move is the comment in §8. A LIN-3720-style map ticket is the fallback only if LIN-4193's owner declines.
- Whether the new work is worth a ticket would depend on a new `lib/` → `routes/` import (research and this run: 0) or a new knot pair (none). Neither is present.

## 10. Adversarial Second-Read

- **Tier:** Tier 2 (a fresh-context general-purpose sub-agent with no memory of the report-writing turn). It was given the repository, the window (`015aa4c6..5334c81a`), the two tools, and only the question below. It was not given this report's conclusions. It formed its answer from the diff first and read the report second.
- **Question:** "What is the largest item in this window that a seams-and-tangles review would need to report, and that a report would be likely to have missed or misfiled?"
- **Reader's answer (cold, from the diff and source):** the new `lib/cost-read.js` (434 lines). It falls to the `^lib/` catch-all, has nine importers across five areas (Runs, LLM, Reports, Agent API, Web routes), and imports back into LLM (`llm-call-log.js:33`) and Runs (`dispatch-terminal`, `session-telemetry`). The committed map shows an LLM ↔ Other pair plus a bidirectional Runs ↔ Other reach-in that no single area owns. Secondary: the deleted `task-cost` alias in the Runs pattern (`areas.json:24`) and four comments that still cite `lib/task-cost.js`. The reader's confidence was moderately high on placement and counts, lower on the ranking.
- **Reader on the report:** the report covers the item as N6 and inside N1, and its counts (9 `cost-read` importers, 7 `cost-format` importers, 17 catch-all files) match. But the report ranked the catch-all first and the hub "Medium, watch", its P1b proposal treats the placement as settled, and it omitted the stale `task-cost` references. The reader also noted that §10 was an unfilled placeholder.
- **Verdict: DISAGREE.** The reader's answer differs from the report's top-ranked finding: the report led with the catch-all, and the reader's largest item is the hub inside it.
- **Differed from top finding: YES.** The reader's answer (`cost-read`) differs from the report's top-ranked finding (N1, the catch-all as a whole), before this fix.
- **Disposition: fixed in place.** Changes made: N6 (`cost-read`) is now ranked first, with its placement stated as contestable and not as settled; a ranking note explains the order; N8 (stale `task-cost` alias and comments) is added as a Low map-hygiene finding; the headline names the hub as the window's largest item; this section replaces the placeholder. The reader's four-comment count is corrected to five in `lib/`, and two test names are added. I did not verify the reader's "four comments" claim beyond `git grep`; the five listed here are from that grep.

## 11. Trend ledger

Stable names carry forward from run 4. Delta is against run 4 (`015aa4c6`). Severity as in the findings.

| name | severity | run 4 | run 5 | delta |
|---|---|---|---|---|
| N1 `knot:other-features-catch-all` | High map / Medium code | 12 files; Other↔Runs 6/12; Pages↔Other 2/6; LLM↔Other 1/1 | 17 files; 9/15; 8/6; 4/2 | **worsened** (placement and code, §3) |
| F1 `knot:agents-chat<->runs` | High | 27/34 | 26/35 (placed: 28/34 → 29/36) | **grew, hidden by catch-all** |
| N6 `hub:cost-read.js` | Medium–High, watch (ranked first) | — | 9 in, 5 areas | **new** (in flight, LIN-4195) |
| N8 `map hygiene: deleted task-cost` | Low | — | `task-cost\|` alias in Runs pattern; 5 `lib/` comments | **new** |
| N7 `door:request-usage-intake` | Low, healthy | — | 1 intake, 2 doors | **new** |
| F6 `knot:browser-window-globals` | Medium | 52 / 99 | 52 / 100 | +1 (`window.CostFormat`) |
| F2 `knot:runs<->page-renderers(render-swipe)` | retired | retired | retired | unchanged |
| F3 `knot:providers->upward` | Medium | Providers→LLM 4 | 4 | unchanged |
| F4 `knot:runs->agent-api(proxy-preamble)` | Medium | 11 / 10 | 11 / 10 | unchanged (new Agent API→Runs door on the placed map, N7) |
| F5 `knot:routes-as-libraries(dashboard)` | Medium | 53 | 53 | unchanged |
| F7 `knot:dead-import-inflation(routes/proxy.js)` | Low | 45 | 45 | unchanged |
| F8 `knot:production-loads-routes/test.js` | Low | 4 unresolved | 4 unresolved | unchanged (`server.js:139`→`:140`, `:1199`→`:1208`) |
| N2 `hub:task-page-loader.js` | Medium | 7 in / 9 out | 7 / 9 | unchanged |
| N3 `knot:auth->llm(model-routing)` | Low–Medium | 4 | 4 | unchanged |
| N4 `hub:run-controls.js` | Medium, watch | 19 | 19 | unchanged |
| N5 `knot:task-model` | healthy | 2 files | 2 files | unchanged |
| `hub:tree.js` | watch | 6 | 6 | unchanged |
| `map hygiene: workspace-issues-memo.js` | Low | — | in Auth | **new** |
| `wiring: server.js` | Low, watch | 41 → 44 Runs; 5 → 8 Other | | grew in edges, same shape |
| `hub:render-run-steps.js` (FU-1) | Medium | 2 in / 3 out | 2 in / 4 out | out +1 (`cost-format`) |

**Change-coupling top pairs (run 4 values in brackets):** Browser code + Pages 142 (140); Runs + Web routes 111 (108); Browser code + Web routes 107 (106); Agent API + Runs 101 (97); Pages + Web routes 99 (98); Web routes + Wiring 95 (93); Pages + Runs 92 (88); Browser code + Runs 87 (84); LLM + Runs 85 (82); LLM + Web routes 82 (81). No-link pairs 19 → 18 of 76.

## Measurement notes (where the research did not hold when re-read)

1. **The research said "`routes/dispatch.js` → Runs edge (intake door) is an Agent API / Web routes → Runs edge".** `routes/dispatch.js` is in Runs; the edge is intra-area. Only `proxy-runner` crosses.
2. **The research's F1 figure after the placed map (28/34 → 29/36) reproduced.** The HEAD-guide figure (26/35) also reproduced. Both are reported.
3. **The research's Agent API ↔ Runs under P1b (43/10 → 44/10) reproduced.** It is 42/10 on the HEAD guide, because the `task-cost` → `cost-read` replacement in `proxy-compute.js` moves its edge from Runs to Other and the new `proxy-runner → intake` edge offsets it.
4. **The research's change-coupling figures reproduced exactly (899/398/76/5123 → 874/400/76/5273).**
5. **Run 4's F7 heuristic is reproduced at 45 for `015aa4c6`.** Its 51 is for `5b32864e`, not for this window.
6. **`server.js` scheduler wiring** was not separately measured; the report says only what the import graph shows.
7. **LIN-3720's content** was not read; the report cites only its title and state (Done), and that the guide still places the files in Other at HEAD.
8. **Server anchors moved.** The render-swipe importer is at `server.js:162` (run 4 cited `:160`), `createKeyState()` at `server.js:3279` with `registerKeyStateHolders` at `:3280` (import at `:167–168`), `installTestTokenLinearTransport()` at `:1208`.

