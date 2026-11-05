# Run 7 beat 1 comparison (from evidence JSON; one guide, blob 642e9405, for both commits)

Baseline `d7ceb373444f9efbc027656132352d247535aa5e` (run 6's measured commit) → measured `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` (origin/main).

## Scope and tool limits (seams.scope)
| commit | files | parseFailures | nonLiteralDynamicImports | unmappedFiles | unresolvedRelativeImports |
|---|---|---|---|---|---|
| d7ceb373 | 540 | 0 | 0 | 0 | 4 |
| 2eb73ae0 | 543 | 0 | 0 | 0 | 4 |

## Headline
| commit | cross-area links (sum) | link rows | knot pairs | groups (sizes) | Other files | F1 LLM→Runs / Runs→LLM | lib→routes edges | edge-dump cross-area (witness) |
|---|---|---|---|---|---|---|---|---|
| d7ceb373 | 1259 | 68 | 12 | 9 | 14 | 30/37 | 0 | 1259 |
| 2eb73ae0 | 1269 | 68 | 12 | 9 | 16 | 31/37 | 0 | 1269 |

## Knot pairs (a→b / b→a)
| pair | d7ceb373 | 2eb73ae0 |
|---|---|---|
| Agent API ↔ LLM | 37/4 | 37/4 |
| Agent API ↔ Providers | 20/3 | 20/3 |
| Agent API ↔ Runs | 45/10 | 45/10 |
| Auth ↔ server-rendered pages | 14/11 | 14/11 |
| Auth ↔ LLM | 4/3 | 4/3 |
| Auth ↔ Providers | 12/1 | 12/1 |
| server-rendered pages ↔ Other features | 8/6 | 9/8 |
| server-rendered pages ↔ Runs | 13/8 | 13/8 |
| LLM ↔ Other features | 1/1 | 1/1 |
| LLM ↔ Providers | 11/4 | 11/4 |
| LLM ↔ Runs | 30/37 | 31/37 |
| Other features ↔ Runs | 6/5 | 6/5 |

Knot groups:
- d7ceb373: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]
- 2eb73ae0: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]

## Directed area links that differ
| link | d7ceb373 | 2eb73ae0 | Δ |
|---|---|---|---|
| server-rendered pages → Other features | 8 | 9 | +1 |
| LLM → Runs | 30 | 31 | +1 |
| Other features → server-rendered pages | 6 | 8 | +2 |
| Other features → Platform | 1 | 2 | +1 |
| Reports → Runs | 13 | 14 | +1 |
| Web routes → Other features | 3 | 6 | +3 |
| Wiring → Other features | 8 | 9 | +1 |

## Catch-all ("Other features") members
- d7ceb373 (14; seams says 14): cost-format.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-standing.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js
- 2eb73ae0 (16; seams says 16): cost-format.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-settled.js, ruling-standing.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js, waiting-section.js
- code delta: −[] +[lib/ruling-settled.js, lib/waiting-section.js]

## Area file counts, internal imports, entry files
| area | files B | files H | internal B | internal H | entry B | entry H |
|---|---|---|---|---|---|---|
| Agent API | 32 | 32 | 45 | 45 | 13 | 13 |
| Auth | 64 | 64 | 115 | 115 | 57 | 57 |
| browser code | 43 | 44 | 0 | 0 | 0 | 0 |
| server-rendered pages | 91 | 91 | 287 | 286 | 53 | 55 |
| LLM | 78 | 78 | 68 | 68 | 69 | 69 |
| Other features | 14 | 16 | 6 | 6 | 13 | 15 |
| Platform | 25 | 25 | 2 | 2 | 23 | 23 |
| Providers | 36 | 36 | 40 | 40 | 31 | 31 |
| Reports | 8 | 8 | 3 | 3 | 6 | 6 |
| Runs | 108 | 108 | 187 | 187 | 93 | 93 |
| Task model | 2 | 2 | 1 | 1 | 2 | 2 |
| Web routes | 38 | 38 | 31 | 31 | 22 | 22 |
| Wiring | 1 | 1 | 0 | 0 | 0 | 0 |

Entry-file changes per area (path(importers:fromAreas)):
- **Front end: server-rendered pages**: +lib/question-card.js(1:Other features); +lib/task-page-href.js(1:Other features)
- **Other features**: +lib/ruling-settled.js(3:Web routes); +lib/waiting-section.js(2:server-rendered pages+Wiring)
- **Platform & plumbing**: ~lib/utils/html.js(73:server-rendered pages+LLM+Web routes → 74:server-rendered pages+LLM+Other features+Web routes)
- **Runs & dispatch**: ~lib/cost-read.js(5:Agent API+LLM+Reports+Web routes → 7:Agent API+LLM+Reports+Web routes)

## Files added / removed in scope
- added: lib/ruling-settled.js, lib/waiting-section.js, public/home-placement.js; removed: none
- `lib/ruling-settled.js` → area **Other features**. Importers (3): routes/dashboard-rulings.js [Web routes], routes/workspace-api-issue-write.js [Web routes], routes/workspace-api-scan.js [Web routes]. Imports (0): none.
- `lib/waiting-section.js` → area **Other features**. Importers (2): lib/render.js [server-rendered pages], server.js [Wiring]. Imports (3): lib/question-card.js [server-rendered pages], lib/task-page-href.js [server-rendered pages], lib/utils/html.js [Platform].
- `public/home-placement.js` → area **Front end: browser code**. Importers (0): none. Imports (0): none.

## File-level cross-area edges added / removed by code
Added (10):
- lib/kpi-stats.js → lib/cost-read.js  [Reports → Runs]
- lib/model-routing-history.js → lib/cost-read.js  [LLM → Runs]
- lib/render.js → lib/waiting-section.js  [server-rendered pages → Other features]
- lib/waiting-section.js → lib/question-card.js  [Other features → server-rendered pages]
- lib/waiting-section.js → lib/task-page-href.js  [Other features → server-rendered pages]
- lib/waiting-section.js → lib/utils/html.js  [Other features → Platform]
- routes/dashboard-rulings.js → lib/ruling-settled.js  [Web routes → Other features]
- routes/workspace-api-issue-write.js → lib/ruling-settled.js  [Web routes → Other features]
- routes/workspace-api-scan.js → lib/ruling-settled.js  [Web routes → Other features]
- server.js → lib/waiting-section.js  [Wiring → Other features]

Removed (0):

Intra-area edges: 785 → 784 (added 0, removed 1).
- added: none
- removed: lib/render.js → lib/question-card.js

## Change coupling (cochange --days 60, same guide)
| commit | window | changes | touching 2+ areas | pairs | unmapped | shallow |
|---|---|---|---|---|---|---|
| d7ceb373 | 2026-09-05T17:18:18.000Z → 2026-11-04T17:18:18.000Z | 854 | 392 | 76 | 5351 | false |
| 2eb73ae0 | 2026-09-06T06:00:24.000Z → 2026-11-05T06:00:24.000Z | 851 | 390 | 76 | 5416 | false |

Shared window: 59.471 of 60 days (99.12%).

Top 15 pairs at 2eb73ae0 (with d7ceb373, Δ, import link at 2eb73ae0):
| pair | 2eb73ae0 | d7ceb373 | Δ | import link? |
|---|---|---|---|---|
| browser code + server-rendered pages | 140 | 140 | 0 | no |
| Runs + Web routes | 111 | 110 | +1 | yes |
| browser code + Web routes | 102 | 105 | -3 | no |
| Agent API + Runs | 101 | 100 | +1 | yes |
| server-rendered pages + Web routes | 98 | 99 | -1 | yes |
| Web routes + Wiring | 93 | 93 | 0 | yes |
| server-rendered pages + Runs | 92 | 91 | +1 | yes |
| browser code + Runs | 86 | 85 | +1 | no |
| LLM + Runs | 84 | 84 | 0 | yes |
| Runs + Wiring | 82 | 81 | +1 | yes |
| server-rendered pages + Wiring | 81 | 79 | +2 | yes |
| Agent API + Web routes | 74 | 75 | -1 | yes |
| LLM + Web routes | 73 | 77 | -4 | yes |
| browser code + Wiring | 71 | 72 | -1 | no |
| Agent API + LLM | 61 | 63 | -2 | yes |

All pairs whose count moved:
- Runs + Web routes: 110 → 111
- browser code + Web routes: 105 → 102
- Agent API + Runs: 100 → 101
- server-rendered pages + Web routes: 99 → 98
- server-rendered pages + Runs: 91 → 92
- browser code + Runs: 85 → 86
- Runs + Wiring: 81 → 82
- server-rendered pages + Wiring: 79 → 81
- LLM + Web routes: 77 → 73
- Agent API + Web routes: 75 → 74
- browser code + Wiring: 72 → 71
- Agent API + LLM: 63 → 61
- browser code + LLM: 48 → 44
- Agent API + Wiring: 47 → 46
- Agent API + browser code: 45 → 43
- LLM + Wiring: 39 → 38
- Platform + Web routes: 36 → 35
- Agent API + Platform: 35 → 34
- Agent API + server-rendered pages: 33 → 34
- server-rendered pages + Other features: 30 → 31
- Other features + Web routes: 30 → 29
- Other features + Runs: 29 → 31
- Other features + Wiring: 28 → 27
- browser code + Other features: 27 → 28
- Reports + Runs: 26 → 27
- LLM + Platform: 23 → 22
- Providers + Runs: 22 → 21
- Reports + Wiring: 20 → 21
- Providers + Web routes: 19 → 18
- LLM + Providers: 17 → 16
- server-rendered pages + Reports: 16 → 17
- Reports + Web routes: 16 → 17
- Agent API + Other features: 14 → 12
- LLM + Other features: 14 → 11
- Agent API + Reports: 13 → 14
- LLM + Reports: 12 → 13

No-link pairs: d7ceb373 20 of 76; 2eb73ae0 20 of 76.
- at 2eb73ae0: browser code + server-rendered pages (140); browser code + Web routes (102); browser code + Runs (86); browser code + Wiring (71); browser code + LLM (44); Agent API + browser code (43); Auth + browser code (29); browser code + Other features (28); browser code + Platform (27); Agent API + Reports (14); browser code + Providers (13); browser code + Reports (13); Agent API + Other features (12); Other features + Reports (5); browser code + Task model (3); Agent API + Task model (2); Auth + Task model (2); Providers + Reports (2); Task model + Web routes (2); Task model + Wiring (1)
