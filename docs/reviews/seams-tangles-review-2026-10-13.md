# Seams & Tangles Review — 2026-10-13 (baseline)

Task: LIN-3552 · Parent: LIN-3549 (step 3 reads this) · Tool built by: LIN-3550

## 0. What was measured

- **Commit measured:** `6597d6e059fda7d15ada99b29dcc47842f734c98` (`origin/main` at the time of writing; nothing landed since the mint commit).
- **Tool / guide:** `scripts/code-shape/seams.mjs` with the committed `scripts/code-shape/areas.json`, guide passed explicitly. Raw JSON: `docs/reviews/_evidence-2026-10-13/seams-committed-guide.json`.
- **Scope counts (reproduce the mint-time figures exactly):** 429 files; 0 parse failures; 4 unresolved relative imports; 0 non-literal dynamic imports; 0 unmapped files. 63 area-to-area link rows, 897 cross-area import links; **19 two-way pairs**; **one knot group of 9 of the 11 areas** (all but browser code, which has no edges by construction, and `server.js`).
- **The 4 unresolved relative imports:** `routes/test.js:13, 19, 25, 32` → `tests/fixtures/*-harness.js`. They are outside the tool's scope (`tests/`), so they are unresolved by construction, not broken. `routes/test.js` is statically imported by production wiring (`server.js:129`), so four test-fixture modules load in production. That is a production→test dependency; **Drift & Coherence owns it** (cross-link, not re-flagged here). Nothing else in scope imports from `tests/` or `scripts/`.
- **No prior Seams & Tangles report exists** (`docs/reviews/` has none). This report is **the baseline**; nothing is compared. The pre-baseline LIN-3549 prototype numbers (`lib/`-only: two-way pairs 6 → 16, links 79 → 310, different script and scope) are context only and are **not** a delta against this series.
- **Proposal runs** (A, B, C below) use guides written to the scratchpad and **not committed**; evidence JSON is `seams-proposal-run-{A,B,C}.json`. They are labelled guide experiments, never the series.

## 1. Direction assumed

The only written rule is: `server.js` is the composition root and `lib/` never imports `routes/` (LIN-675, `docs/architecture/source-map.md`). **Confirmed at HEAD: 0 `lib/` → `routes/` imports** (grep of `from '../routes…'` in `lib/` returns nothing; the tool's crossings agree).

No other layer order is documented. The direction I assume, grounded in what callers do, not a rule:

`pages / routes → agents & chat → runs & dispatch → LLM client & prompts / providers → plumbing`

with the task model (`lib/tree.js`) and provider-neutral errors at the bottom. A "wrong-way" edge below is one that points up this list.

## 2. Why areas knot while files do not cycle

Drift & Coherence (`drift-coherence-review-2026-10-12.md`) found 0 file-level cycles. Both are true. The knot is **many thin back edges, not thick mutual dependence**: an area pair closes if *any one* file in B imports *any one* file in A. Re-cutting the guide shows how little is holding the knot together (evidence runs):

| Run | Guide change (labelled proposal) | Two-way pairs | Knot group size | Notable result |
|---|---|---|---|---|
| series | committed guide | 19 | 9 | Agent API↔Runs 44/7, Agent API↔LLM 35/4 |
| A | fix mislabels only (`tree` → task model, `proxy-fetch` → transport, `kpi-stats`/`milestone-funnel` → KPI readers) | 18 | 10 | little change: the mislabels are not the main cause |
| B | A + all `routes/*` in one route layer | 16 | 9 | Agent API pair disappears into the route layer; LLM↔Runs 24/12 becomes the heaviest |
| C | B + "Agents & chat orchestration" split out of "LLM & prompts" | 19 | 10 | Agents↔Runs 17/3; LLM↔Runs shrinks to 7/9 |

Reading: the two heaviest series pairs (Agent API↔Runs, Agent API↔LLM) are mostly **the guide mixing a route layer with a lib layer in one area**. Once routes are one layer, the heaviest real tangle is **agent/chat orchestration ↔ runs**. Run C adds pairs because it adds an area, not because code moved. The LIN-3449 coherence loop's batch 3 added links between areas (255 → 310 per LIN-3549) because "one place per decision" often put that place in another area; that is a cross-review tension, not something re-litigated here.

Altitude boundaries: function/file size is Code Quality's; churn and the proxy↔server coupling-by-landings is Stability's; decisions held in several places is Drift's.

## 3. Findings (severity-ranked, uncapped)

Severity: **High** = wrong-way edge with several dependants that blocks rebuilding an area behind a seam; **Medium** = wrong-way edge that is real but narrow, or an invisible seam; **Low** = inflation, labelling, hygiene.

### F1 (High) — Agents/chat ↔ Runs: `chat-tools` fans out into Runs, and three back edges close the pair
In Run C (`seams-proposal-run-C.json`) Agents & chat → Runs is 17 edges, 12 of them from `lib/chat-tools.js` alone (`dispatch-factory`, `dispatch-targets`, `dispatch-terminal`, `live-console`, `loop-supersede`, `observer-sweep`, `pipeline-loops`, `session-summary`, `task-stack`, `unanswered-decisions`, …); the rest come from `audit`, `scan`, `recommendation-*`. Orchestration code sitting inside "LLM & prompts" is most of the LLM→Runs weight (17 of 24 in the series). Runs → Agents has **three** back edges that close the pair: `lib/follow-up-dispatch.js:21` → `chat-tools` (`deriveFollowUpDispatch`, defined at `lib/chat-tools.js:1243`), `observer-state-store` → `recap-cache`, and `task-page-loader` → `brief-cache`. The `follow-up-dispatch` edge is only one of the 16 Runs→LLM edges in the series, so it is not "why" LLM↔Runs stays 24/16 (the others include the right-way `prompt-templates` imports). Moving `deriveFollowUpDispatch` (F-A) removes one back edge and is a step toward the seam; it does **not** by itself open it. Opening it needs the Run C split plus the `recap-cache`/`brief-cache` edges.
*Not to move:* the dispatch-kind vocabulary. `DISPATCH_KINDS` derives from `PROMPT_TEMPLATES` keys, so Runs→prompts is the right direction.

### F2 (High) — Run/ordering logic lives in renderers
- `lib/task-stack.js:32` and `lib/roadmap.js:9` import ordering logic (`sortIssuesForSwipe`, `applyBlockingOrder`) from `lib/render-swipe.js`. Ordering is domain logic stored in a view module.
- `lib/live-console.js` → `lib/timeline-zoom.js` (run logic → page helper).
- `lib/task-page-loader.js` ↔ `lib/render-run-steps.js` (both ways) and `render-task-page` ↔ `task-page-loader`.
- Reverse direction: `lib/render-session.js` → `loop-supersede` / `run-view`; `render-kpis.js` → `weekly-budget` (renderers importing run logic is the right way, listed for completeness).
Pages↔Runs closes 6/8 in the series. One-move fix for the ordering part: move ordering beside `lib/tree.js` (follow-up F-B). The loader↔renderer pair is not promoted (see §6).

### F3 (Medium) — Providers reach upward
- `lib/providers/linear/index.js:30` imports `COUSIN_CAP`, `SIBLING_CAP` from `../../openrouter.js` — two constants, from the LLM client.
- `lib/providers/github/index.js:64` and `lib/providers/jira/index.js:100` import `RefResolutionError` from `lib/proxy-ref-resolver.js` — an error class, from the Agent API area.
Providers should be a low layer; these edges are the whole reason Providers↔Agent API (18/6) and Providers↔LLM (5/1) close. `RefResolutionError` removes two edges for one move (follow-up F-C); the constants move is a single edge and is left as an un-minted finding.

### F4 (Medium) — Routes used as libraries
`routes/dashboard.js` exports `enrichLoop` (line 531) and `sessionIsTerminal` (line 263), imported by `routes/flight-companion.js`, `proxy-flight-companion.js`, `proxy-rulings.js`, `task-chat.js`, `workspace-api.js` and `test.js`. Also `dispatch.js` (`dispatchQueueLimiter`) → `dashboard`, `flight-companion`; `proxy.js` (`commentDedupe`) → `workspace-api`; `flight-companion.js` (`buildCensusSeedText`) → `proxy-flight-companion`. Route files are the top layer; other routes importing them as libraries makes the route layer a web of mutual reach and blocks treating any route as a replaceable entry point. Not promoted (not top 3).

### F5 (Medium) — Browser seam the tool cannot see
`public/` scripts have no imports, so the tool shows no edges. Pages reach browser code by `renderPage({scripts})` strings (31 files under `lib/` and `routes/` mention `scripts:`) and by `window.*` globals; `public/common.js` assigns many `window.*` names (46 matching assignments by a rough grep) and is loaded by most pages. "Not wired by imports" ≠ "isolated": `public/common.js` is a hub that no import graph shows, and a rebuild of browser code must preserve every global. Not promoted; the tool cannot measure it.

### F6 (Low) — Dead-import inflation (LIN-2600)
`routes/proxy.js` carries dead named imports that count as phantom links. The research pass counted **59 dead named imports and 21 wholly-dead sources** with a binding-reference scan (LIN-2600 says 53); my own rough regex re-count gave 51 and 16 and is a lower bound (it treats a name mentioned in a comment as used). I did not reproduce the acorn figure; treat 59/21 as the research's number. Effect: the headline Agent API→Runs 44 is about 35 live and Agent API→LLM 35 is about 26 live. **Not corrected in the series**, per the brief. Already ticketed: **LIN-2600** (Backlog), so noted, not minted. Other wholly-dead sources (research): `workspace-api→task-decisions-store`, `prompt-formatters→completion-signals`, `render-proxy→components/field`, `providers/index→local/index` (possibly a side-effect import).

### F7 (Low) — `routes/test.js` loaded in production
`server.js:129` statically imports `routes/test.js`, which imports `tests/fixtures/*-harness.js` (the 4 unresolved imports). Drift's to own; recorded here only because it is the entire unresolved-import count.

## 4. Mislabels (guide vs. code), kept apart from code findings

- `lib/tree.js` is the task model, not a page (fan-in 15 from 6 areas in the series; it is the second entry file of "server-rendered pages").
- `lib/proxy-fetch.js` is an HTTP_PROXY transport, not the Agent API (5 inbound importers, from LLM and Providers).
- `lib/kpi-stats.js` and `lib/milestone-funnel.js` are KPI readers sitting on run stores; calling them "plumbing" is what makes Platform↔Runs read 6/44. The imports point from KPI readers *up* into run stores, which is the right way for a reader; the *label* is wrong, not the code.
- "LLM & prompts" holds two layers: the model client and prompts, and agent orchestration (`chat-*`, `agent-turn`, `recommend*`, `scan*`, `audit`, `roadmap`, `brief*`).
- Agent API, Auth and Runs each span both `routes/` and `lib/`.
- "Other features" (9 files; catch-all `^lib/`): periodicals, ship-biscuit, flight-companion-gate, report-history-store, task-share and similar. Proposed name: **"Periodicals & reports"** for the periodical/report files, **"Sharing & ship"** for task-share/ship-biscuit; or keep one area named **"Report & share features"**.

## 5. Per-area audit

Entry files are the files other areas import (tool output).

| Area (files) | Way in | Readiness to rebuild behind a seam | What blocks it |
|---|---|---|---|
| Front end: browser code (36) | None by imports; reached through `renderPage({scripts})` and `window.*` | Low, unmeasurable | `public/common.js` global hub (F5) |
| Front end: server-rendered pages (68) | `render.js` (18 importers), `tree.js` (15), `render-pages.js` (10); wide: 44 entry files | Medium | Ordering logic in `render-swipe` (F2); `tree.js` is the task model mislabelled as a page; `account-conflict`/`github-install-flow` → `render-pages` |
| Agent API (proxy) (30) | `proxy-preamble` (7), `proxy-fetch` (5), `proxy-scopes` (4), `proxy-ref-resolver` (3); 12 entry files | Medium | Spans routes and lib; `RefResolutionError` pulled up by Providers (F3); dead-import noise (F6) |
| Runs & dispatch (89) | 78 entry files; no single front door (`runner-owner-gate` 7, `dispatch-factory` 6, `dispatch-terminal` 6) | Low–medium | Largest area, widest door; `chat-tools` back edge (F1); renderer coupling (F2) |
| LLM & prompts (64) | `openrouter` (16), `prompt-templates` (14), `chat-request` (13); 54 entry files | Medium | Two layers in one name; `chat-tools` ↔ Runs (F1) |
| Auth, accounts & workspaces (52) | `workspace.js` (28), `workspace-preferences` (14), `workspace-lookup` (10); 45 entry files | Medium | Auth↔pages 12/15 (pages call auth helpers, auth flows render pages); `workspace-preferences` → `prompt-templates` (LIN-3549) |
| Providers (35) | `providers/registry` (19), `providers/models` (11), `providers/index` (8) — a clear front door | **Highest** | Only the upward reaches in F3 |
| Platform & plumbing (24) | `utils/html` (54), `errors` (42), `utils/time` (34) | High for the true plumbing | `kpi-stats`/`milestone-funnel` mislabelled into it |
| Web routes (21) | `routes/dashboard.js` (3), `flight-companion` (2) | Medium | Routes as libraries (F4) |
| Other features (9) | `periodicals` (7) | High (small) | Catch-all name |
| Wiring (`server.js`, 1) | It is the root | n/a | Statically imports `routes/test.js` (F7) |

**Hub modules** (fan-in from several areas): `lib/utils/html.js` 54, `lib/errors.js` 42, `lib/utils/time.js` 34, `lib/workspace.js` 28, `lib/feature-defaults.js` 22, `lib/providers/registry.js` 19, `lib/render.js` 18, `lib/openrouter.js` 16, `lib/tree.js` 15, `lib/prompt-templates.js` 14. The plumbing hubs are healthy (leaf-like, low fan-out). `workspace.js`, `openrouter.js`, `tree.js` and `prompt-templates.js` are the ones to watch: several areas lean on them and they sit mid-stack.

## 6. Findings not promoted, and follow-up decisions

Not promoted to a ticket: F2's loader↔renderer pair and the `lib/live-console`→`timeline-zoom` edge, the constants half of F3, F4, F5, F6 (LIN-2600 exists), F7 (Drift), `account-conflict`/`github-install-flow` → `render-pages`, `workspace-preferences` → `prompt-templates`, Auth↔pages, and all mislabels (guide edits only).

**Follow-ups (3, each one move, searched for duplicates first — none found; LIN-2433 and LIN-2425 touched `deriveFollowUpDispatch` earlier but are Done and about its derivation, not its location; LIN-3458 is about a display label in `render-swipe`, not ordering):**
- **F-A:** move `deriveFollowUpDispatch` (+ `isLoopTerminal`, `anchorLineageTail`) from `lib/chat-tools.js` into `lib/follow-up-dispatch.js`. Removes one of three Runs→Agents back edges (see F1); a first step, not the whole seam.
- **F-B:** move issue ordering (`sortIssuesForSwipe`, `applyBlockingOrder`) out of `lib/render-swipe.js` to sit beside `lib/tree.js`. Opens the seam: ordering is task-model logic, renderers import it.
- **F-C:** move `RefResolutionError` to a provider-neutral module so `providers/github` and `providers/jira` stop importing the Agent API area.

## 7. Guide proposals (kept apart from code; not committed)

1. Give `lib/tree.js` to a **"Task model"** area (or the Runs area), not pages (Run A).
2. Move `lib/proxy-fetch.js` to plumbing/transport (Run A).
3. Give `kpi-stats.js` and `milestone-funnel.js` a **"KPI readers"** area, not plumbing (Run A).
4. Put every `routes/*` file in one **route layer** area (Run B). This removes the mixed-layer artefact behind the two heaviest series pairs.
5. Split **"Agents & chat orchestration"** out of "LLM & prompts" (Run C).
6. Rename "Other features" (§4).
The guide is a guide, not a rule: no test, check or count enforces it, and `areas.json` is unchanged in this PR.

## 8. Simple Dispatcher

`JKershaw/simple-dispatcher` is **out of remit for the baseline**: the tool reads `server.js`, `lib/`, `routes/`, `public/` ES modules only, and that repo is flat root-level CommonJS (about 123 `require()` calls). A scratch spike by the research pass (a require→import shim and a stated guide) read 38 files, 3 pairs and one group of 4 of 6 areas; that is context only, not a series. Measuring it needs a tool change, so it is recorded as a note on LIN-3549/LIN-3550. This is a tool gap with no ticket.

## 9. Adversarial Second-Read

- **Tier:** 2 (fresh-context sub-agent, no memory of the report-writing turn; given only the report, repo and tool output).
- **Question:** "What is the largest item in this window that this report missed or misfiled?"
- **Reader's answer (condensed, verbatim in substance):** F1 is mis-sized. `chat-tools.js` has 12 edges into Runs; `follow-up-dispatch→chat-tools` is one of three Runs→Agents back edges (the others `observer-state-store→recap-cache`, `task-page-loader→brief-cache`), so F-A "leaves the pair closed". Smaller: Pages↔Providers back edges (`providers/{jira,linear,local}/index.js→tree.js`, `sample-data/mock-data.js→tree.js`) are not in F3 (defensible since `tree` is the task model), and Providers→Runs edges (`pr-state-store→run-evidence`, `run-evidence→github-pr-status`) were not checked. Six cited file:line claims spot-checked: all accurate.
- **Checked and fixed:** I re-read Run C's crossings; the reader is right. F1 and F-A were rewritten above.
- Adversarial second-read verdict: DISAGREE
- Differed from top finding: YES
- Disposition: fixed in place
- Not folded in: the Providers→`tree.js` and Providers↔Runs edges are recorded here as un-promoted observations, unverified beyond the reader's evidence read.

## 10. Trend ledger

Format: `name | kind | severity | delta`. First run, so every delta is `baseline`. Series = committed guide at `6597d6e0`.

```
metric:files-in-scope                      | 429 | baseline
metric:parse-failures                      | 0   | baseline
metric:unresolved-relative-imports         | 4   | baseline
metric:non-literal-dynamic-imports         | 0   | baseline
metric:unmapped-files                      | 0   | baseline
metric:cross-area-import-links             | 897 | baseline
metric:two-way-area-pairs                  | 19  | baseline
metric:knot-group-size(of 11 areas)        | 9   | baseline
metric:lib-to-routes-imports               | 0   | baseline
knot:agents-chat<->runs(chat-tools)        | High   | baseline
knot:runs<->page-renderers(render-swipe)   | High   | baseline
knot:providers->upward(openrouter,ref-resolver) | Medium | baseline
knot:routes-as-libraries(dashboard)        | Medium | baseline
knot:browser-window-globals(common.js)     | Medium | baseline
knot:dead-import-inflation(routes/proxy.js)| Low    | baseline
knot:production-loads-routes/test.js       | Low    | baseline
area:browser-code                          | low-readiness  | baseline
area:server-rendered-pages                 | medium         | baseline
area:agent-api                             | medium         | baseline
area:runs-and-dispatch                     | low-medium     | baseline
area:llm-and-prompts                       | medium         | baseline
area:auth-accounts-workspaces              | medium         | baseline
area:providers                             | highest        | baseline
area:platform-and-plumbing                 | high           | baseline
area:web-routes                            | medium         | baseline
area:other-features                        | high           | baseline
area:wiring-server.js                      | n/a            | baseline
```
