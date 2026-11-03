# Seams & Tangles Review — 2026-11-03 (run 4, delta vs the 2026-10-23 run)

Task: LIN-4152 · Parent: LIN-3549 · Previous: `seams-tangles-review-2026-10-23.md` (LIN-3832, run 3) · Tool: `scripts/code-shape/seams.mjs` (unchanged since `5b32864e`), `scripts/code-shape/cochange.mjs` (first reported run, LIN-3860)

Review-only: no code, config, guide or doc edits beyond this report and `docs/reviews/_evidence-2026-11-03/`. The guide is proposed against, not edited.

**Headline: a substantive window, not a quiet one. Two knots grew, one closed, one retired, and the catch-all regrew.** The High finding is unchanged in place but larger: **LLM & prompts ↔ Runs & dispatch went from 23/23 to 27/34** (F1). Model routing and the decision panel (LIN-3962, LIN-3833, LIN-3853/3857) added 11 Runs→LLM and 4 LLM→Runs edges, and none were removed. Under the HEAD guide, **"Other features" holds 12 files** (up from 2 at `5b32864e`) and forms three new pairs, with Runs (6/12). A labelling list places all 12 files in existing areas; three of them carry the real wrong-way edges (N1). F2 (`render-swipe`) is **closed** and its name is retired: the task-ordering edges went to `task-order.js` and `graph-features.js` (LIN-3554). Two former knots closed: Pages↔LLM and Pages↔Providers. Change coupling is reported for the first time: the Browser code pairs are the largest, and 19 of 76 pairs have no import link either way. Two follow-ups are recommended (one-move, purpose-parented); a third is recorded only.

## 0. What was measured

- **Commits.** Measured: `015aa4c6acbc008d7fa73c32beec1528b7f59511` (origin/main, the mint commit; 0 commits since mint at the time of the run). Baseline: `5b32864e14ec02b3c258fa3cf8cc7807eaf0bbb7` (the 10-23 measured commit; 194 commits back). Both tools read committed git objects only.
- **Scope at HEAD (`015aa4c6`):** 528 files read (462 at `5b32864e`); 0 parse failures; 0 non-literal dynamic imports; 0 unmapped files; **4 unresolved relative imports**, all in `routes/test.js`: lines 14, 20, 26 and 33 import `tests/fixtures/{local,github,github-projects,jira}-harness.js` (Drift's, see §5). `lib/` → `routes/` imports: **0** (`git grep` at HEAD, relative `../routes/` and `./routes/` forms).
- **Evidence:** `docs/reviews/_evidence-2026-11-03/` (README there lists every command). Four seams runs (code × guide), four cochange runs (`--days 60`), two labelled guide experiments with their seams runs, the unmapped breakdown, and file-level edge dumps. All eight standard runs reproduce byte-for-byte from the committed guide copies.
- **Number witness:** the headline figures were recomputed from `docs/reviews/_evidence-2026-11-03/*.json` and checked against this report by a throwaway script kept outside the repo (206 figures, 206 found in the report). The check is text presence, not cell placement.

## 1. The four runs: guide effect vs code movement

The series is **the HEAD guide at both commits** (`areas-015aa4c6.json`), as in 10-23. The old guide (`areas-5b32864e.json`, the 10-23 guide) is the guide-effect control.

| code \ guide | old guide (`5b32864e`) | HEAD guide (`015aa4c6`), the series |
|---|---|---|
| `5b32864e` | 462 files · 973 links · 11 pairs · group 7 | 462 · **976** · 11 · group 9 |
| `015aa4c6` | 528 · 1241 · 14 · group 8 | 528 · **1227** · **12** · group 9 |

- **Guide effect, apart from code.** At `5b32864e` the HEAD guide adds **+3** links (973 → 976) and the knot group grows 7 → 9 through `Task model` and `Other features` transit, with no new pair (the new Task model area, which 10-23's guide proposal anticipated, holds `graph-features.js` and `task-order.js`). At `015aa4c6` the HEAD guide is **−14** links (1241 → 1227) and **−2** pairs (14 → 12): it places 16 of the 28 files the old guide left in the catch-all.
- **Code movement, on the series (HEAD guide, 976 → 1227, +251).** Pairs 11 → 12 (new: Other↔Runs, Pages↔Other, LLM↔Other); group 9 → 9 with the same members. Pages↔LLM and Pages↔Providers close as two-way pairs (see F-ledger).
- **Code movement, on the old guide (973 → 1241, +268)** is reported as the control: 11 → 14 pairs, group 7 → 8. Both runs agree on the direction of every knot below.
- **Trend note for the ledger.** The 10-23 "cross-area links" figure (973) was measured under the old guide. The run-4 baseline is 976 under the HEAD guide. Comparing 973 with 1227 mixes guide effect (+3) and code movement (+251); use 976 → 1227.

Per-link movement under the series (directed cross-area imports, `5b32864e` → `015aa4c6`, HEAD guide), the largest rises:

| from → to | 5b | HEAD | Δ |
|---|---|---|---|
| Web routes → Runs | 45 | 85 | +40 |
| Web routes → Auth | 45 | 67 | +22 |
| Web routes → LLM | 63 | 82 | +19 |
| Pages → Platform | 59 | 79 | +20 |
| Web routes → Platform | 39 | 54 | +15 |
| Pages → LLM | 15 | 36 | +21 |
| Runs → LLM | 23 | 34 | +11 |
| Runs → Other | 0 | 12 | +12 |

Web routes growth is partly the `routes/workspace-api.js` split into `routes/workspace-api-*.js` sub-routers (LIN-3872/3876/3877/3883/3893/3894): the split files now make **123** outbound cross-area imports from 10 files, against **73** from the single `routes/workspace-api.js` at `5b32864e`. The sub-routers are composition; see F5 for what is not. **Pages → LLM:** 20 of the 21 new file edges go to `model-routing*`, `llm-jobs` or `openrouter` (verified); the 21st is `agent-onboarding` (LIN-4085). See F1.

**Knot pairs, HEAD guide series** (two-way area pairs; `a→b / b→a` counts of cross-area file imports; `5b` is `5b32864e` code under the same guide):

| pair (a ↔ b) | 5b | HEAD | status |
|---|---|---|---|
| Agent API ↔ LLM | 33/2 | 37/4 | grew |
| Agent API ↔ Providers | 19/3 | 20/3 | grew (+1) |
| Agent API ↔ Runs | 42/9 | 42/10 | grew (Runs→Agent API, F4) |
| Auth ↔ Pages | 12/15 | 14/11 | changed both ways |
| Auth ↔ LLM | 2/3 | 4/3 | grew (N3) |
| Auth ↔ Providers | 12/1 | 12/1 | unchanged |
| LLM ↔ Providers | 11/1 | 11/4 | grew (F3, `parentNextOf`) |
| LLM ↔ Runs | 23/23 | 27/34 | grew (F1) |
| Pages ↔ Runs | 7/8 | 13/8 | grew (F2 successor, §2) |
| Pages ↔ Other | — | 2/6 | new (N1) |
| LLM ↔ Other | — | 1/1 | new (N1) |
| Other ↔ Runs | — | 6/12 | new (N1) |
| *Pages ↔ LLM* | *15/1* | *closed* | closed: LLM→Pages 1 → 0 |
| *Pages ↔ Providers* | *26/3* | *closed* | closed: Providers→Pages 3 → 0 (LIN-3921) |

Twelve pairs at HEAD (eleven at `5b`, minus the two closed plus three new). The knot group is nine areas at both commits: Agent API, Auth, Pages, LLM, Other, Providers, Reports, Runs, Task model.

## 2. Findings, severity-ranked, trend-framed

Stable names are those of 10-23 §9. Where a name no longer fits, it is kept and its descriptor changed, or it is retired with the replacement named. Severity and trend are against 10-23.

### F1 — `knot:agents-chat<->runs(chat-tools)` · **High** · **grew**, 23/23 → 27/34

- **Series numbers (HEAD guide):** LLM & prompts ↔ Runs & dispatch, LLM→Runs **27** (was 23), Runs→LLM **34** (was 23). Nothing removed: 4 new LLM→Runs and 11 new Runs→LLM file edges, 0 removed in this pair.
- **Where the new edges come from (verified by `git log -S` on each import, earliest window commit; approximate by construction):**
  - Runs→LLM, 11 edges. **LIN-3962** (`dfeabc20`, one decision panel for Models and Home): 5 (`routes/dispatch.js` → `model-routing`, `model-routing-history`, `model-routing-spend`, `openrouter-catalog`, `should-mock-ai`). **LIN-3833** (`8ecce6bc`): 3 (`routes/dispatch.js` → `llm-jobs`; `task-mode-store.js` and `task-page-loader.js` → `prompt-templates`). **LIN-3853** (`68eec35a`): 1 (`dispatch-factory.js` → `llm-jobs`). **LIN-3857** (`eb97e996`): 1 (`dispatch-factory.js` → `model-routing.js`). **LIN-3875** (`a279a9b6`): 1 (`session-materializer-precompute.js` → `chat-request.js`).
  - LLM→Runs, 4 edges: `chat-tools.js` → `dispatch-session-read.js`; `model-routing-edit.js` → `dispatch-validation.js` (`validateOpaqueDispatchField`, `MAX_NAME_LENGTH`); `model-routing-validate.js` → `dispatch-validation.js`; `model-routing-spend.js` → `task-cost.js` (`buildTaskCost`).
- **Re-read at `015aa4c6`:** `lib/model-routing-validate.js:9`, `lib/model-routing-spend.js:18` and `lib/model-routing-edit.js:17` carry the imports above; `dispatch-factory.js:49` imports `applyDefaultDispatchHarness` from `proxy-preamble`.
- **Reading.** Model routing is the single front door for every LLM job's model choice (12 cross-area importers from 6 areas, per the research), and it is filed under LLM while it reads Runs' validation constants and `buildTaskCost`. The knot is the placement, not a wrong-way call per se. **Experiment P2** (model routing as its own area) moves the edges without removing them: LLM→Runs 24, Model routing→Runs 3 (sum 27); Runs→LLM 30, Runs→Model routing 4 (sum 34). The total is the same. P2 relabels; it does not reduce F1. No follow-up in this run targets F1 directly: FU-2 removes an Agent API import from model routing, which is one of F1's Runs→Agent edges, not an LLM↔Runs edge.
- **Not re-flagged:** the `observer-state-store → recap-cache` and `task-page-loader → brief-cache` back edges (F1 of 10-23, LIN-3736, not landed). `task-page-loader.js:62` still imports `brief-cache` (LLM) — now one of the Runs→LLM edges above.

### F2 — `knot:runs<->page-renderers(render-swipe)` · **RETIRED** (was High)

- **Closed.** `lib/render-swipe.js` has one importer at HEAD: **`server.js:160`** (`renderSwipePage`, `orderIssuesForSwipe`). The 10-23 importers (`render-ship`, `render-swim`, `roadmap`, `task-stack`) no longer import it. The ordering and flattening moved to `lib/task-order.js:8` ("Moved out of render-swipe.js (LIN-3554) so a page is not the…") and `lib/graph-features.js:4` ("Relocated from lib/render-swipe.js"). `routes/proxy.js:65` now imports `lib/providers/index.js` directly, with the comment "LIN-3554: task-stack no longer reaches the barrel via render-swipe".
- **Replacement** (the Pages↔Runs knot is still there, under a new name): `knot:runs<->pages(task-page-loader, routes-in-runs)` · **Medium** · **grew** 7/8 → **13/8**. Pages→Runs growth goes through the `run-view` view model (`render-landing.js:52`, `render-run-steps.js:21`, `render-session.js:33` import `run-view.js`), which is the intended direction. The real remaining back edges are `task-state.js:21` and `task-page-loader.js:50` (below).
- **Reading.** The name is retired because its subject moved, not because the pair closed: Pages↔Runs still has 13/8 edges.

### F3 — `knot:providers->upward(openrouter,ref-resolver,proxy-wire)` · **Medium** · **relocated, and grew in one place**

- **Pages → Providers closed.** Providers→Pages **3 → 0** (LIN-3921 relocated the edges). Pages→Providers 26 → 24, the right direction.
- **Providers → LLM grew 1 → 4.** Three of the four are `parentNextOf` from `lib/recommendation-facts.js` (verified at `lib/recommendation-facts.js:226` export; imported at `lib/providers/linear/index.js:29`, `lib/providers/jira/index.js:104`, `lib/providers/local/index.js:40`). The fourth is the 10-23 `linear/index.js → openrouter` edge. **The research note named the symbol correctly as `parentNextOf` (not `selectFocusSubtask`); the three new edges are LIN-3921 then LIN-4039.** The three provider index files each import `parentNextOf` from `recommendation-facts`, so the edge is a shared helper living in LLM's file. FU-3 records it (recorded only, §8).
- **Providers → Agent API**, the 10-23 `proxy-ref-resolver`/`proxy-wire` edges (LIN-3555, LIN-3737): 3 at both commits, not landed.

### F4 — `knot:runs->agent-api(proxy-preamble)` · **Medium** · **grew**, 9 → 11 importer files

- **Two counts, both correct, different definitions.** All importer files (including Agent API's own, as 10-23 counted): **9 → 11** across the same four areas. Cross-area only (what `entryFiles` reports): **8 → 10**, from three areas (LLM, Runs, Web routes). The grep at `015aa4c6` finds 11 files importing `proxy-preamble.js` (`chat-tools`, `dispatch-entrance`, `dispatch-factory`, `follow-up-dispatch`, `model-routing-harnesses`, `model-routing`, `wake-credential`, `routes/collective`, `routes/dispatch`, `routes/proxy` (Agent API), `routes/workspace-api-feedback`). Two more mentions, in `lib/ownerless-token-policy.js:5` and `lib/prompts/autopilot-kickoff.js:308`, are comments only.
- **Re-read of the anchors at `015aa4c6`:** `lib/proxy-preamble.js:152` (`export function applyDefaultDispatchHarness`); `lib/model-routing.js:26`, `lib/model-routing-harnesses.js:21`, `lib/dispatch-factory.js:49`, `lib/wake-credential.js:21`, each importing it. `wake-credential.js` is in **Runs** under both guides (the `wake-[^/]*` Runs pattern matches first), so it is a Runs→Agent API edge.
- **Reading.** Still the same edge: Runs-side code reaching into Agent API's preamble for a dispatch default. LIN-3738 (the preamble move) is not landed. FU-2 is the smaller move (below).

### F5 — `knot:routes-as-libraries(dashboard)` · **Medium** · **grew**, route→route 26 → 53

- **Measured:** file-level edges from `routes/*` to `routes/*`: 26 at `5b32864e`, **53 at `015aa4c6`**. The top targets are now `routes/workspace-api-steps.js` (7 importers), `routes/dashboard-session-state.js` (6), `routes/dashboard.js` (3). Logic is moving into `routes/dashboard-session-state.js`, which is the F5 concern in its own right: a route file that other routes import as a library.
- **Composition, not a finding:** the `routes/workspace-api-*.js` sub-routers (LIN-3872/3876/3877/3883/3893/3894) are composition under `routes/workspace-api.js`, which mounts them. The `routes/proxy.js` → sub-router pattern (`provider-auth-routers.js`) is the same and is not counted. Only route→route **library** imports (a route importing another route's logic, not its router) are F5.

### F6 — `knot:browser-window-globals(common.js)` · **Medium** · **grew**, tool-blind

- `window.X =` in `public/common.js`: **48 → 52** (10-23's pattern `window\.[A-Za-z_]* *=`, reproduced at both commits; a stricter `=[^=]` pattern gives 44 → 48). Across all of `public/`: 82 → 99. Non-minified `public/` scripts: **40 → 42**. `scripts:` wiring files in `lib/` and `routes/`: 33 → 32.
- **Vendor libs moved to a server owner.** DOMPurify, marked and Chart.js are served from `node_modules` by `lib/vendor-assets.js` (Platform), at the same URLs. The third-party globals now have a server owner; `lib/vendor-assets.js:48` `statSync`s the three files at boot (a boot-time failure point, not an import edge). Still not visible to the import graph.

### F7 — `knot:dead-import-inflation(routes/proxy.js)` · **Low** · **shrank slightly**, not reproduced to the research's figure

- The research gave 65 → 59 for named `lib/` imports never used in the file body. My heuristic (named imports from `../lib/` in `routes/proxy.js`, identifier not found outside the import statement) gives **51 → 45**. Different definitions (the research's may count default and namespace imports, or multi-line forms differently); the direction holds. Reported as the measured figure; the research's figure is not used in the ledger.
- Ticket LIN-2600 still Backlog (§7).

### F8 — `knot:production-loads-routes/test.js` · **Low** · **unchanged**

- `server.js:139` imports `createTestRoutes, installTestTokenLinearTransport` from `./routes/test.js`; `server.js:1199` calls `installTestTokenLinearTransport()`, with the comment "LIN-3798: the fake `test-token` never leaves the process (routes/test.js)". The production→test-fixture half belongs to Drift (§5). The route-as-library half is F5's.

### New findings in this window

#### N1 — `knot:other-features-catch-all(home/task-facts)` · **High as a map, Medium as code** · **new**

- **Size:** the HEAD guide's `^lib/` catch-all holds **12 files** at `015aa4c6` (the old guide gave 28 at the same commit; at `5b32864e` the HEAD guide had 2). The files, verified by enumerating the HEAD guide's first-match over the 528 in-scope files: `dashboard-refresh.js`, `home-pipeline.js`, `home-row-states.js`, `home-rows.js`, `home-view.js`, `lineage-membership.js`, `live-anchor.js`, `row-usage.js`, `ruling-standing.js`, `subtree-index.js`, `task-facts-holder.js`, `task-state.js`. Added 2026-10-30 to 11-02 by LIN-4016, 4024, 4069, 4114, 4118, 4134 and 4147 (per research). **None of those PRs edited the guide.** Open PR #2185 (LIN-4028) adds `lib/routing-ruling.js` as a **13th** file (per research; not re-checked against the PR). LIN-4040 (In Progress, Home UI round 3) is editing these files right now.
- **New pairs:** Pages↔Other **2/6**, LLM↔Other **1/1**, Other↔Runs **6/12**. Other→Runs is the largest.
- **Labelling vs real wrong-way code** (research §4, re-read at the cited lines):
  - *Labelling* (belongs to an existing area under any sensible guide): to Runs `row-usage`, `lineage-membership`, `live-anchor`, `ruling-standing`; to Task model `task-facts-holder`, `subtree-index`, `home-row-states`, `task-state`; to Pages `home-view`, `home-rows`, `home-pipeline`, `dashboard-refresh`.
  - *Real wrong-way code* (remains under P1 and P2; three files carry it, `task-state.js`, `home-row-states.js` and `subtree-index.js`, verified by their outbound cross-area edges): **`lib/task-state.js:22`** and **`lib/task-page-loader.js:50`** import `fmtDuration` from `./render-run-steps.js` (a renderer; `fmtDuration` is defined at `lib/render-run-steps.js:257`). `lib/task-state.js:21` imports `run-view.js`, which is Runs: Task model pointing up into Runs. `home-row-states.js` imports `task-page-loader.js` and `ruling-standing.js`. `lib/subtree-index.js` imports `recommendation-facts.js` (LLM) for `compareByIdentifier`.
- **Experiment P1 (labelled experiment; not an edit to `areas.json`).** Placing the 12 files by the labelling list above gives: Pages↔Task **5/2**, Runs↔Task **4/3**, LLM↔Task **2/1**; still **12 pairs**, group **8**. The research's expected P1 figures reproduce exactly. P1 removes the catch-all (the map is cleaner) and leaves the real wrong-way code in place (the `fmtDuration` edges and the `task-state` → Runs edges are now Task→Pages and Task→Runs). **How much is labelling:** the labelling list covers all 12 files; three of them (`task-state`, `home-row-states`, `subtree-index`) carry the wrong-way edges. Read: the catch-all accounts for the new pair *count* (3 pairs), but the *tangle* sits in those three files and in the `fmtDuration` edge.

#### N2 — `hub:task-page-loader.js` · **Medium** · **new as a hub**

- **Cross-area importers 2 → 7**, from four areas at HEAD (Pages, Other, Web routes, Wiring). **Outbound cross-area imports 3 → 9**, reaching **5 areas**: `render-run-steps` (Pages), `prompt-templates` and `brief-cache` (LLM), `task-state`, `subtree-index`, `ruling-standing` (Other), `providers/state-map` (Providers), `read-horizon` and `utils/time` (Platform). Verified from the file-level edge dump (`edges-code-*.json`).
- **Why it is a hub.** Its outbound edges include the back edges in N1 (`fmtDuration` from `render-run-steps`, and `task-state`), and its importers are in Pages, Other, Web routes and Wiring. It is not among the top ten by importer count (§3), but it is the most *bidirectional* new node: 7 importers and 9 outbound cross-area edges.

#### N3 — `knot:auth->llm(model-routing)` · **Low–Medium** · **new**

- Auth → LLM **2 → 4** (file edges, verified). At `5b32864e`: `workspace-preferences.js` → `openrouter.js` and → `prompt-templates.js`. At HEAD those two remain, and two are new: `workspace-preferences.js` → `model-routing.js` and `workspace-change-log.js` → `model-routing.js`. So the new Auth→LLM edges are both the workspace settings reading model routing. Cross-link: Drift (decisions held in several places).

#### N4 — `hub:run-controls.js` · **Medium** · **new hub**

- `lib/run-controls.js` (Runs & dispatch): **19 cross-area importers from 3 areas** (Other, Web routes, Wiring). It did not exist at `5b32864e`. Its outbound cross-area edges are 3. Its placement in Runs is right; the finding is that the catch-all and the route/wiring layers reach into it. Watch, not a finding.

#### N5 — `knot:task-model` (the new area) · **healthy**

- Task model holds two files at HEAD (`lib/task-order.js`, `lib/graph-features.js`; `task-state.js` and `tree.js` are not in it under the HEAD guide). Its outbound cross-area imports go only down to Providers (**Task→Providers 3**, matrix). It is in the knot group only by transit around a cycle: Task→Providers (3), Providers→LLM (4), LLM→Task (2). It is in no two-way pair. **Area:** healthy.

### The four 10-23 ledger rows that moved

- **F1 Agent-API/Runs LLM pair** — see F1.
- **Pages↔LLM** (15/1 at `5b32864e` under the HEAD guide) — **closed**: LLM→Pages **1 → 0**. Pages→LLM **15 → 36** with nothing removed: 20 of the 21 added go to model routing, `llm-jobs`, `openrouter-catalog` or `openrouter` from Settings › Models and the decision panel (LIN-3855, LIN-3952, LIN-3962); the 21st is `render-landing → prompts/agent-onboarding` (LIN-4085). That is a legitimate one-way dependency; the size reflects where model routing is filed.
- **Pages↔Providers** (26/3) — **closed** by LIN-3921: Providers→Pages **3 → 0**.
- **Tree.js** (10-23 hub watch, 5 importers) — **6** importers; and a finding of its own: `lib/tree.js` imports `providers/state-map.js` and `providers/models.js` (Providers) **and re-exports `selectFocusSubtask`, `computeFrontierFacts`, `compareByIdentifier` from `./recommendation-facts.js`** at line 189 (LLM). The research said "imports only Providers"; that is wrong. The re-export is the LIN-3922 item, and it is the reason experiment P2 puts `tree.js` in Task model (Task↔LLM 2/1).

### Measurement notes (where the research did not hold when re-read)

These are stated plainly and handled in the report as shown.

1. **F4 counts.** The research's "9 → 11, still from 4 areas" is the all-importer count, including Agent API's own files. The cross-area count is 8 → 10 from 3 areas. Both are reported (F4).
2. **P2 F1 figure.** The research said "F1 reads 25/28 under P2". Measured: LLM↔Runs **24/30** under P2, and **27/34** when Model routing's Runs edges are added back in (the total does not change). The 25/28 figure is not reproduced; the report uses the measured values.
3. **F7.** The research gave 65 → 59 (dead named imports in `routes/proxy.js`). My heuristic gives 51 → 45. Not reproduced (F7).
4. **`tree.js`.** "Imports only Providers" was wrong; it re-exports from `recommendation-facts.js` (LLM) at `lib/tree.js:189` (above).
5. **Providers→LLM 1 → 4.** Verified: the 1 at `5b32864e` is `providers/linear/index.js` → `openrouter.js`, which stays; the three new edges are `parentNextOf` from `recommendation-facts` in the linear, jira and local index files. Reported as "+3 via parentNextOf, LIN-3921/LIN-4039" (F3).
6. **LIN-3952 vs LIN-3962.** The research's correction (LIN-3962 is the largest source of Runs→LLM edges, 5; LIN-3833 next, 3) **holds**. The `routes/dispatch.js → openrouter-catalog` edge is LIN-3962 (`dfeabc20`), not LIN-3952.
7. **`window.X =` count.** The research's 48 → 52 holds with the 10-23 pattern (F6); a stricter pattern gives a smaller number.
8. **Unmapped root files.** The research estimated "root files about 17". Measured: 11 at the repo root, plus `.github` 2, `content` 1 and `plans` 1 (§6).
9. **F2 (render-swipe).** Holds: one importer left at `server.js:160`.
10. **The LIN-3554 / 3755 / 3754 / 3917 ticket states** are as the research recorded (Done). They are checked against the code where it touches the seam (render-swipe, task-order) but ticket state was not re-read in Linear for this report.

## 3. Hubs

Cross-area importers (file-level, HEAD guide), top of the list. `5b32864e` in brackets.

| hub (own area) | cross-area importers (5b) | areas | note |
|---|---|---|---|
| `lib/utils/html.js` (Platform) | 73 (56) | 3 | a leaf (no cross-area outbound) |
| `lib/errors.js` (Platform) | 62 (44) | 7 | a leaf (`node:crypto` only); size is Code Quality's |
| `lib/utils/time.js` (Platform) | 42 (38) | 7 | leaf |
| `lib/workspace.js` (Auth) | 36 (27) | 6 | 1 outbound cross-area |
| `lib/providers/state-map.js` (Providers) | 26 (22) | 9 | watch (10-23 watch list), leaf |
| `lib/openrouter.js` (LLM) | 22 (17) | 7 | 2 outbound; watch (F3 endpoint) |
| `lib/render.js` (Pages) | 20 (18) | 4 | 9 outbound to 5 areas |
| **`lib/run-controls.js` (Runs)** | **19 (—)** | 3 | **new this run (N4)** |
| `lib/read-horizon.js` (Platform) | 18 (under 14) | 7 | not in the 5b top ten |
| `lib/chat-request.js` (LLM) | 18 (14) | 4 | |

Other named hubs, cross-area importers (5b → HEAD): `lib/task-page-loader.js` **2 → 7** (N2); `lib/proxy-preamble.js` **8 → 10** (F4); `lib/recommendation-facts.js` **1 → 5** (F3, `parentNextOf`); `lib/tree.js` **5 → 6** (§2); `lib/render-run-steps.js` **1 → 2** cross-area (N1; its four importers at HEAD are `render-session.js`, `render-task-page.js`, `task-page-loader.js`, `task-state.js`); `lib/task-state.js` — new file, 5 cross-area importers at HEAD; `lib/prompt-templates.js` 14 → 17.

Watch list: `lib/providers/state-map.js` 22 → 26 (now 9 areas; the highest "reach" hub in the graph); `lib/workspace.js` 27 → 36; `lib/openrouter.js` 17 → 22.

## 4. Ways in and rebuild readiness

Readiness is judgement on the measured edges; there are no scores. Each line gives the area's delta from 10-23 and what stops a rebuild behind a seam.

- **Front end: browser code** — no import edges (F6, tool-blind). Readiness unchanged: any rebuild is blocked by window globals (52 in `common.js`), not by imports. Its change coupling is the largest in the window (§8).
- **Front end: server-rendered pages** — *changed*: Pages↔LLM and Pages↔Providers closed; Pages→Runs grew through `run-view` (the intended direction); Pages↔Other is new (2/6). Readiness: medium. What stops a rebuild: `render-run-steps` is imported by `task-page-loader` and `task-state` (FU-1).
- **Agent API (proxy)** — *unchanged shape, larger reach*: the way into Agent API is the `routes/proxy*` family and `proxy-preamble`. The preamble is still the Runs-side dependency (F4, FU-2). Readiness: medium.
- **Runs & dispatch** — *grew*: the LLM knot (F1) and the new `run-controls` hub (N4). Readiness: low–medium. What stops a rebuild: model routing reaches in for validation and cost (F1).
- **LLM & prompts** — *grew*: model routing is filed here and reads up into Runs and Agent API (F1, F4); `recommendation-facts` is now reached from Providers and Other (F3, N1). Readiness: medium.
- **Task model** — *new area, healthy* (N5). Readiness: high for what it holds; it has two files.
- **Auth, accounts & workspaces** — *grew*: Auth→LLM 2 → 4 (N3). Readiness: medium.
- **Providers** — *relocated*: Pages→Providers closed; Providers→LLM grew 1 → 4 through `parentNextOf` (F3). Readiness: the highest-reach area in the graph (`state-map`, 9 areas). Medium–low.
- **Platform & plumbing** — *unchanged*, leaf-heavy (`errors`, `utils/time`, `utils/html`). Readiness: high (leaf hubs cannot knot; size is Code Quality's).
- **Reports & operator tools** — *unchanged*: Reports→Runs 10 (was 11), Reports→Auth 5. Readiness: high (7 files).
- **Web routes** — *grew*: the `workspace-api` sub-router split is composition; route→route library imports 26 → 53 (F5). Readiness: medium–low (route files are imported by routes).
- **Wiring (server.js)** — *grew in edges, same shape*: Wiring→Runs 39 → 41, Wiring→Auth 46 → 47, Wiring→Platform 13 unchanged. `server.js:160` is now the only `render-swipe` importer (F2 retired).
- **Other features** — *new as a catch-all, 12 files* (N1). Readiness: n/a until the files are placed (P1).

## 5. Tool blind spots (as numbers)

- **Parse failures:** 0 of 528 (HEAD); 0 of 462 (5b).
- **Dynamic imports:** 0 non-literal (both).
- **Unmapped files (seams):** 0 (both, HEAD guide).
- **Unresolved relative imports:** **4**, all in `routes/test.js`: line 14 (`tests/fixtures/local-harness.js`), 20 (`github-harness.js`), 26 (`github-projects-harness.js`), 33 (`jira-harness.js`). Production code importing test fixtures — Drift's half of F8.
- **Not read by the tool:** browser globals and `scripts:` wiring in `public/` (F6: 52 `window.X =` in `common.js`, 99 across `public/`, 42 non-minified scripts, 32 `scripts:` files); scheduler jobs in `server.js` (not import edges); text contracts with no import edge (`harbour-token-format` mirrored in `lib/secret-scan.js` and `lib/runner-kit/runner.mjs`, Drift's); Simple Dispatcher (CommonJS, out of the tool's reach; `dispatcher.js` has 34 `require(` and 0 `import` in the workspace copy, 33 in 10-23's count; not built).
- **`experiments/rebuild-rung7/`** (second-read finding, verified): 25 files, **+35,752 / −23** lines in the window, of which 33,486 added lines are tracked generated output under `replay/work/`. `seams.mjs` scopes to `lib/`, `routes/`, `public/` and `server.js`, so the subtree is invisible to the import graph. `scripts/code-shape/areas.json` claims only `^experiments/replay-kit/` among experiments paths, so the subtree is unmapped. The tests in `tests/unit/lin3880-replay-ai-coverage.test.js:19` import from it. Only the tool's exclude list (`scripts/code-shape/code-shape-lib.mjs:17`, `replay/(pinned|work)`) knows it is noise. Cochange counts files, not lines, so it shows up only as file counts (§6).
- **`scripts/pipeline-churn.mjs`** (LIN-3891) is mapped to Runs by the guide but outside `seams.mjs`'s scope, so the two tools see different file sets under one guide (the research's note; verified by the unmapped breakdown in §6).

## 6. Change coupling — first reported run (baseline)

**This is the first reported change-coupling section. The HEAD figures (`015aa4c6`, `--days 60`, HEAD guide) are the baseline the next run measures against. `5b32864e` (same guide, same `--days`) is a reference point only, not a prior report.**

Figures (`cochange-code-015aa4c6-guide-015aa4c6-days60.json`):

- Changes in the window: **899** (window 2026-09-03 → 2026-11-02); **398** touch two or more areas; **76** pairs; **5123** distinct unmapped files; not shallow.
- At `5b32864e` (window 2026-08-24 → 2026-10-23): 808 changes, 343 multi-area, 74 pairs, 4575 unmapped.
- The windows share about 50 of their 60 days; the movement below is not a clean before/after.

**Unmapped 5123, by top-level directory** (`cochange-015aa4c6-unmapped-by-topdir.json`, same window and guide; its total equals cochange's `unmappedFiles`): `docs` **2875** (`docs/reviews` 2430, `docs/papers` 374, `docs` top-level files 27, others 44), `tests` **1287**, `experiments` **560**, `scripts` **347**, `prototypes` 39, root files 11, `.github` 2, `content` 1, `plans` 1. So the unmapped count is documents (mostly review reports) and tests; whether the guide should claim tests is a **proposal**, not an edit (§7). Within `experiments` (560 files), `experiments/rebuild-rung7/` is the largest single block in the window: 25 files, +35,752 added lines, 33,486 of them tracked `replay/work/` output (second-read finding, §5).

**Top pairs at HEAD, with the `5b32864e` value in brackets:**

| # | pair | changes (5b) | import link either way? |
|---|---|---|---|
| 1 | Browser code + Pages | **140** (103) | **no** |
| 2 | Runs + Web routes | 108 (79) | yes |
| 3 | Browser code + Web routes | **106** (78) | **no** |
| 4 | Pages + Web routes | 98 (69) | yes |
| 5 | Agent API + Runs | 97 (78) | yes |
| 6 | Web routes + Wiring | 93 (71) | yes |
| 7 | Pages + Runs | 88 (57) | yes |
| 8 | Browser code + Runs | **84** (58) | **no** |
| 9 | LLM + Runs | 82 (63) | yes |
| 10 | LLM + Web routes | 81 (72) | yes |

**What moved most (HEAD vs 5b):** Browser + Pages +37; Pages + Runs +31; Runs + Web routes +29; Pages + Web routes +29; Browser + Web routes +28; Browser + Runs +26; Runs + Wiring +25; Pages + Wiring +25.

**Pairs with no import link (candidate seams).** At HEAD, **19 of 76 pairs** have no `seams.mjs` link in either direction. Twelve of the 19 involve Browser code (its pairs are the clearest "coupling the imports do not show", F6 seen from the change side): Browser+Pages 140, Browser+Web routes 106, Browser+Runs 84, Browser+Wiring 74, Browser+LLM 49, Agent API+Browser 45, Auth+Browser 29, Browser+Platform 28, Browser+Other 26, Browser+Providers 13, Browser+Reports 13, Browser+Task model 3. The other seven: Agent API+Reports 11, Other+Reports 5, Agent API+Task model 2, Auth+Task model 2, Providers+Reports 2, Task model+Web routes 2, Task model+Wiring 1. At `5b32864e` the figure is 24 of 74.

**Reading (prose, no scores).** The Browser code pairs have no import edges by construction (F6). The non-browser no-link pairs are small (≤ 11 changes each) and involve Reports and Task model, which are small areas; none is a candidate seam worth a ticket on this evidence. Whether any pair is a reason merges queue behind each other is not something these numbers show, and nothing here is read as a cause.

**Caveats** (as the tool and the reading require):
- The two windows share about 50 of 60 days, so the movement is directional.
- One squash-merged PR is one change; large UI rounds (LIN-4040 and the Home rounds) inflate every pair they touch. The Browser+Pages 140 is partly this.
- Wiring is the single file `server.js`.
- The guide claims `scripts/pipeline-churn.mjs` for Runs, and among experiments paths only `experiments/replay-kit/`. `experiments/rebuild-rung7/` is claimed by no area, so its files count as unmapped in cochange and are invisible to `seams.mjs`.
- Nothing in this section is a score, a threshold, or enforced.

## 7. Guide edits vs guide proposals

**Edits made in this review: none.** `scripts/code-shape/areas.json` is untouched; the diff against `origin/main` contains only this report and its evidence.

**Experiments (labelled; the guide is not edited):**

- **P1 — catch-all placed** (`areas-proposal-P1-catchall-placed.json`): the 12 catch-all files placed by the labelling list (N1). Result: 1210 cross-area links, 12 pairs, group 8; Pages↔Task 5/2, Runs↔Task 4/3, LLM↔Task 2/1. Removes the catch-all; the real edges move, they do not disappear.
- **P2 — tree.js → Task model, model routing its own area** (`areas-proposal-P2-plus-tree-and-model-routing.json`): 1235 cross-area links, 16 pairs, group 10. LLM↔Runs 24/30 with Model routing↔Runs 3/4 (combined 27/34, unchanged); Task↔LLM 2/1. P2 shows the knot is placement, not a fix (F1).

**Proposals (nothing enforces them, nothing is edited):**

1. **Retire the "Other features" catch-all** (10-23 proposal, still apply). P1 is the proposal's test; it makes the map cleaner and leaves the wrong-way edges visible (N1).
2. **Route `tree.js` through a single layer** (or retire its re-export; LIN-3922). Move `tree.js` to Task model (P2).
3. **Give model routing its own area** (P2), with its LLM→Runs edges made explicit rather than hidden inside LLM.
4. **Split "LLM & prompts"** (10-23 proposal, still applies): model routing and recommendation facts are the two halves that read as different layers.
5. **P3, unmeasured (second-read finding):** map `^experiments/rebuild-[^/]+/` to "Reports & operator tools", the same place as `experiments/replay-kit/`, and measure the cochange delta in a later run. Not run here, so its effect on the pair counts is unknown.
6. **Hygiene, recorded only, not ticketed:** stop tracking `experiments/rebuild-rung7/replay/work/` (gitignore it and `git rm --cached`). The `pinned/` copy is intentional per that subtree's README, so leave it.
7. **Tests in the guide** — whether the guide should claim `tests/` for change coupling is a proposal. Not adopted here; the unmapped breakdown (§6) shows the size (1287 files in the window).

## 8. Existing tickets and follow-ups

**Existing tickets (state per the research comment; not re-read in Linear for this report; each checked against the code where it touches the seam):**

| ticket | finding | state (research) | in code at `015aa4c6` |
|---|---|---|---|
| LIN-3736 | F1 hashing helpers / `task-page-loader → brief-cache` | Backlog | not landed (`task-page-loader.js:62` still imports `brief-cache`) |
| LIN-3737 | F3 `collectIssueAttachments` | Backlog | not landed |
| LIN-3738 | F4 `proxy-preamble` (the preamble move) | Backlog | not landed |
| LIN-3555 | F3 `RefResolutionError` | Backlog | not landed |
| LIN-2600 | F7 dead imports in `routes/proxy.js` | Backlog | not landed (F7: 51 → 45 measured) |
| LIN-3554 | F2 `render-swipe` ordering | Done | landed (F2 retired) |
| LIN-3755 (under LIN-3754) | Auth↔Pages `findWorkspaceByUrlKey` | Done | per research |
| LIN-3917 / LIN-3921 | Providers→Pages (`parentNextOf`) | Done | Providers→Pages 0 (landed) |
| LIN-3922 | `tree.js` re-export of `recommendation-facts` | Backlog | not landed (cross-link FU-3) |
| LIN-3962 / LIN-3833 / LIN-3853 / LIN-3857 | new Runs→LLM edges | Done | the edges are in (F1) |
| LIN-4040 | Home UI round 3, editing the catch-all files | In Progress | active (N1) |
| LIN-4106 | edits importers of `task-state.js` | In Progress | land FU-1 after it |
| LIN-4153 | Drift (decisions held in several places) | In Progress | cross-link only |
| PR #2185 (LIN-4028) | adds `lib/routing-ruling.js` (13th catch-all file) | Open | not re-checked |

**Follow-ups recommended** (one move each; the ticket numbers are filled in beat 3):

- **FU-1 — `LIN-4154`, parent LIN-3490 (charter, In Progress).** Move `fmtDuration` out of `lib/render-run-steps.js` (defined at `:257`) into a plumbing module, so `task-state.js:22` and `task-page-loader.js:50` stop importing a renderer. **Acceptance:** no non-page, non-route file imports `render-run-steps`; the rendered output is byte-unchanged; the Runs→Pages count falls by one (`task-page-loader`) and the Other→Pages count falls by one (`task-state`). **Anchors:** `lib/render-run-steps.js:257`, `lib/task-state.js:22`, `lib/task-page-loader.js:50`, `lib/render-task-page.js:58`. **Why it is worth a ticket:** the one real wrong-way edge that is small, independent, and has a precedent (LIN-3837) that landed under LIN-3490. **Land after LIN-4106** (it edits `task-state` importers). *Unvalidated idea:* `lib/utils/time.js` with a transitional re-export.
- **FU-2 — `LIN-4155`, parent LIN-3820 (charter, Todo; "every LLM use routed from one place").** Move the default-harness rule (`applyDefaultDispatchHarness`, `lib/proxy-preamble.js:152`) out of `proxy-preamble` so model routing stops importing Agent API. **Acceptance (as planned):** `lib/model-routing.js` (`:26`) and `lib/model-routing-harnesses.js` (`:21`) no longer import `proxy-preamble.js`: the all-importer count goes **11 → 9**. Note the ticket must decide `dispatch-factory.js:49` (it imports `applyDefaultDispatchHarness` and `DEFAULT_DISPATCH_HARNESS`): if it moves too the count is **11 → 8**; `wake-credential.js:21` imports other symbols from the preamble and stays. Behaviour unchanged. **Anchors:** `lib/proxy-preamble.js:152`, `lib/model-routing.js:26`, `lib/model-routing-harnesses.js:21`, `lib/dispatch-factory.js:49`, `lib/wake-credential.js:21`. *Unvalidated idea:* a Platform module imported by those four. Link as *related* to LIN-3738, not a duplicate: moving the whole preamble into Runs would turn these edges into F1 edges, so this is the smaller, safer move.
- **FU-3 — recorded in this report only, not minted.** Providers → `recommendation-facts` (`parentNextOf`, three edges): no single clean move (putting the picker in Task model creates a Providers↔Task model pair). Cross-link LIN-3922. Not minted: nothing small to ask for.

**Minted this run: 0 so far** (beat 3 mints FU-1 and FU-2). Duplicate search was done in research against LIN-3490, LIN-3820, LIN-3736/3737/3738/3555/2600, LIN-4008 and LIN-4040; no duplicate found. Run 3 showed purpose-parented seam moves land (LIN-3754 pulled LIN-3554/3755/3917; LIN-3490 pulled LIN-3837/3921) and unparented ones (LIN-3736, 3737, 3738, 3555, 2600, 3922) did not; that held again: the two follow-ups are purpose-parented, and the unparented backlog is untouched.

## 9. Sibling hand-offs

- **Drift & Coherence (LIN-4153, In Progress):** decisions held in several places — model routing decisions, task facts, `liveOnAnchor` / LIN-3843, the `harbour-token-format` text contract (mirrored in `lib/secret-scan.js` and `lib/runner-kit/runner.mjs`), `stableStringify` copies; and the production→test-fixture imports (F8's `routes/test.js:14,20,26,33`). Not re-flagged here.
- **Code Quality (2026-10-20):** function size. `lib/errors.js` (62 cross-area importers, 24 exports at HEAD) is a leaf hub; its size is Code Quality's.
- **Stability (2026-10-21):** churn and per-file change counts. The change-coupling section here is per pair of areas, not per file.
- **Simple Dispatcher** (`JKershaw/simple-dispatcher`): still outside the tools (CommonJS). Drift claims its cross-repo contract; no tool built here.

## 10. Adversarial Second-Read

- **Tier:** 2 (fresh-context general-purpose sub-agent, not a fork; given only the report path, the evidence directory and the repo root, with no top finding, research or plan).
- **Question:** "What is the largest item in this window (the 194 commits from `5b32864e14ec02b3c258fa3cf8cc7807eaf0bbb7` to `015aa4c6acbc008d7fa73c32beec1528b7f59511`) that this report missed or misfiled? Check against the source, not just the report; name the item, the evidence (file:line / commits) and what you would change."
- **Reader's answer (verbatim):**

> **Answer: the rung-7 replay subtree, `experiments/rebuild-rung7/`, is the largest item in the window that the report misses.** The report never names it, and the guide and seams tool both leave it out.
>
> **Size (git, `5b32864e..015aa4c6`)**
> - `experiments/rebuild-rung7/`: 25 files, +35,752 / −23 lines. Non-docs insertions in the whole window are 131,340, so this is about 27% of them.
> - The largest commit in the window is `ea4c6f88` (LIN-3880), at +35,041 lines. The next largest is `9f7acff7` (LIN-3846) at +4,011, so this one commit is about nine times bigger. `53250f12` (LIN-3934) adds 969 more.
> - Most of the volume is generated replay output committed to git: `experiments/rebuild-rung7/replay/work/` is 13 files and +33,486 lines. That includes six 4,673-line `routes/workspace-api.js` copies and a 5,442-line `report.json`.
>
> **Why the report misses it**
> - The report has no mention of rung-7, replay, rebuild, LIN-3880, LIN-3934 or LIN-3881. Those terms return zero hits in `docs/reviews/seams-tangles-review-2026-11-03.md`.
> - It appears only as part of "`experiments` 560" in the unmapped file counts (§6, line 225). That is a file count, so a 35k-line subtree shows up as one of many files.
> - `seams.mjs:15` scopes to `^(lib|routes|public)/` plus `server.js`, so the tool cannot see it. The §5 blind-spot list does not name it.
> - The §6 caveat at line 252 says the guide's "`experiments/` patterns" are invisible to seams. The guide only claims `^experiments/replay-kit/` (`scripts/code-shape/areas.json:45`). Nothing claims `rebuild-rung7`, so it is unmapped.
> - The tooling already knows the subtree is noise. `scripts/code-shape/code-shape-lib.mjs:17` excludes `replay/(pinned|work)`, and `code-shape-lib.test.mjs:18-22` pins that. The report does not mention it.
>
> **Misfiling**
> - It is an operator experiment that replays `routes/workspace-api.js`. Its natural home is beside `experiments/replay-kit/` under "Reports &amp; operator tools", but the guide pattern is too narrow to catch it.
> - `tests/unit/lin3880-replay-ai-coverage.test.js:19` imports from `experiments/rebuild-rung7/replay/lib/fakes.mjs`. A test now depends on an experiment directory, and tests are unmapped too.
>
> **What I would change in the report**
> 1. Add a §5 blind-spot bullet and a §6 paragraph. State that `experiments/rebuild-rung7/` is +35,752 lines in 25 files (about 27% of window insertions), that 33,486 of those lines are tracked `replay/work/` output, and that cochange counts files, not lines.
> 2. Correct the §6 caveat. Only `experiments/replay-kit/` is claimed among experiments paths, and `rebuild-rung7` is claimed by no area.
> 3. Add a labelled proposal, P3: map `^experiments/rebuild-[^/]+/` to "Reports &amp; operator tools", run it like P1 and P2, and report the cochange delta. Do not edit `areas.json`.
> 4. Add a hygiene follow-up, not a seam ticket: stop tracking `experiments/rebuild-rung7/replay/work/` (gitignore it and `git rm --cached`). The `pinned/` copy is intentional per the subtree README, so leave it.
>
> **Limits**
> - I did not run P3, so the cochange effect of remapping is unmeasured.
> - I did not check how many of the 560 unmapped experiments files fall in the 60-day window versus the 194-commit window. My 35,752 figure is the 194-commit window.
>
> **Checked and correct**
> - N1 (the "Other features" catch-all holds 12 files at HEAD): I recomputed first-match over `git ls-files lib routes public server.js` and got the same 12 files the report lists.

- **Judgement (lead reviewer, checked against the source):** the item is real. `git diff --numstat 5b32864e..015aa4c6 -- experiments/rebuild-rung7` gives 25 files, +35,752 / −23; `experiments/rebuild-rung7/replay/work` accounts for +33,486 of those; the report does not name rung-7, replay, LIN-3880 or LIN-3934 (grep returns none); `scripts/code-shape/areas.json` claims only `^experiments/replay-kit/` among experiments paths; `scripts/code-shape/code-shape-lib.mjs:17` excludes `replay/(pinned|work)`; `tests/unit/lin3880-replay-ai-coverage.test.js:19` imports from the subtree. The reader's 27% denominator and the 131,340 total were not re-verified here. Its scope is unmapped file volume, not an area knot, and it does not change any area finding (no pair or knot moves on this evidence). Disposition: fixed in place. Changes made: a §5 blind-spot bullet, the §6 unmapped note and caveat (also corrected a stale `(§9)` cross-reference to `(§7)`), proposals P3 (unmeasured) and the hygiene item in §7 (recorded only, not ticketed), and a ledger row. Not done: P3 was not run, and no ticket was minted for the hygiene item.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place

## 11. Trend ledger

Format: `name | kind | severity | delta vs 10-23`. Series = HEAD guide at both commits. Names are the 10-23 §9 names; rows marked **new** are new this run; **retired** names are kept so the next run can compare mechanically.

```
metric:files-in-scope                      | 528 (HEAD) / 462 (5b)  | -          | 462 -> 528 (+66; the new files are the window's)
metric:parse-failures                      | 0                     | -          | unchanged
metric:unresolved-relative-imports         | 4                     | -          | unchanged (routes/test.js:14,20,26,33)
metric:non-literal-dynamic-imports         | 0                     | -          | unchanged
metric:unmapped-files                      | 0                     | -          | unchanged
metric:cross-area-import-links(HEAD guide) | 1227 (976 at 5b)      | -          | 976 -> 1227 (+251 code; +3 guide effect at 5b)
metric:two-way-area-pairs(HEAD guide)      | 12 (11 at 5b)         | -          | 11 -> 12 (new: Other<->Runs, Pages<->Other, LLM<->Other)
metric:knot-group-size(of 13 areas)        | 9                     | -          | 9 -> 9 (same members at both commits)
metric:experiments-rebuild-rung7 (unmapped, not measured by seams) | 25 files, +35,752 | new | second-read finding; 33,486 added lines are tracked replay/work output
metric:lib-to-routes-imports               | 0                     | -          | unchanged
knot:agents-chat<->runs(chat-tools)        | High                  | grew       | 23/23 -> 27/34 (F1; LLM/Runs+model routing)
knot:runs<->page-renderers(render-swipe)   | n/a                   | RETIRED    | 7/8 -> closed (server.js:160 only); replaced by knot:runs<->pages(task-page-loader, routes-in-runs)
knot:runs<->pages(task-page-loader, routes-in-runs) | Medium       | new name   | 7/8 -> 13/8 (the successor to F2; through run-view)
knot:providers->upward(openrouter,ref-resolver,proxy-wire) | Medium | relocated | Providers->Pages 3 -> 0; Providers->LLM 1 -> 4 (+3 parentNextOf, LIN-3921/4039)
knot:runs->agent-api(proxy-preamble)       | Medium | grew       | all importers 9 -> 11; cross-area 8 -> 10 (F4)
knot:routes-as-libraries(dashboard)        | Medium | grew       | route->route file edges 26 -> 53 (F5)
knot:browser-window-globals(common.js)     | Medium | grew, tool-blind | window.X= 48 -> 52 (public/ 82 -> 99)
knot:dead-import-inflation(routes/proxy.js)| Low    | shrank     | 51 -> 45 measured (research 65 -> 59 not reproduced)
knot:production-loads-routes/test.js       | Low    | unchanged  | server.js:139, :1199; routes/test.js:14,20,26,33
knot:pages<->llm                           | closed | closed     | LLM->Pages 1 -> 0 (Pages->LLM 15 -> 36 one-way)
knot:pages<->providers                     | closed | closed     | Providers->Pages 3 -> 0 (LIN-3921)
knot:other-features-catch-all(home/task-facts) | High (map) / Medium (code) | new | 12 files; Other<->Runs 6/12, Pages<->Other 2/6, LLM<->Other 1/1 (N1)
knot:auth->llm                             | Low-Medium | new        | Auth->LLM 2 -> 4 (N3)
hub:task-page-loader.js                    | Medium | new        | cross-area importers 2 -> 7; outbound 3 -> 9 reaching 5 areas (N2)
hub:run-controls.js                        | watch  | new        | 19 cross-area importers from 3 areas (N4)
hub:tree.js                                | watch  | changed    | 5 -> 6 importers; re-exports recommendation-facts (LLM) at :189
hub:providers/state-map.js                 | watch  | grew       | 22 -> 26 (9 areas)
hub:errors.js                              | leaf   | grew       | 44 -> 62 cross-area importers (7 areas); a leaf, cannot knot
hub:utils/html.js                          | leaf   | new in top | 56 -> 73 (3 areas)
hub:openrouter.js                          | watch  | grew       | 17 -> 22 (7 areas; F3 endpoint)
area:task-model                            | healthy | new        | 2 files; out only to Providers (3) (N5)
area:browser-code                          | n/a (tool-blind) | unchanged | change coupling is the largest in the window (140, 106, 84)
area:server-rendered-pages                 | medium | changed    | Pages<->LLM and Pages<->Providers closed; Pages<->Other new
area:agent-api                             | medium | unchanged  | F4 preamble still the Runs-side dependency
area:runs-and-dispatch                     | low-medium | changed | F1 grew; run-controls hub (N4)
area:llm-and-prompts                       | medium | changed    | model routing filed here; recommendation-facts reached from Providers and Other
area:auth-accounts-workspaces              | medium | changed    | Auth->LLM 2 -> 4 (N3)
area:providers                             | medium-low | relocated | highest-reach hub (state-map, 9 areas); Pages->Providers closed
area:platform-and-plumbing                 | high   | unchanged  | leaf hubs (errors, utils/time, utils/html)
area:reports-and-operator-tools            | high   | unchanged  | Reports->Runs 10 (was 11)
area:web-routes                            | medium-low | grew   | route->route library imports 26 -> 53 (F5); workspace-api split is composition
area:other-features                        | n/a    | new (catch-all) | 12 files (N1), was 2 at 5b
area:wiring-server.js                      | n/a    | grew edges | Wiring->Runs 39 -> 41; render-swipe importer left only at :160
```
