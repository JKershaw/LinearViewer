# Run 9 comparison (from evidence JSON; one guide, blob 642e9405, for both commits)

Baseline `af55cb737ec4e63919bac65558b35498ede3d290` (run 8's measured commit) → measured `90542b2c79016d2a1d64f75cb5d3e9037080eae7` (origin/main).

## Scope and tool limits (seams.scope)
| commit | files | parseFailures | nonLiteralDynamicImports | unmappedFiles | unresolvedRelativeImports |
|---|---|---|---|---|---|
| af55cb73 | 544 | 0 | 0 | 0 | 4 |
| 90542b2c | 544 | 0 | 0 | 0 | 4 |

## Headline
| commit | cross-area links (sum) | link rows | knot pairs | groups (sizes) | Other files | F1 LLM→Runs / Runs→LLM | lib→routes edges | edge-dump cross-area (witness) |
|---|---|---|---|---|---|---|---|---|
| af55cb73 | 1271 | 69 | 12 | 9 | 17 | 31/37 | 0 | 1271 |
| 90542b2c | 1272 | 69 | 12 | 9 | 17 | 31/37 | 0 | 1272 |

## Knot pairs (a→b / b→a)
| pair | af55cb73 | 90542b2c |
|---|---|---|
| Agent API ↔ LLM | 37/4 | 37/4 |
| Agent API ↔ Providers | 20/3 | 20/3 |
| Agent API ↔ Runs | 45/10 | 45/10 |
| Auth ↔ server-rendered pages | 14/11 | 14/11 |
| Auth ↔ LLM | 4/3 | 4/3 |
| Auth ↔ Providers | 12/1 | 12/1 |
| server-rendered pages ↔ Other features | 9/8 | 9/8 |
| server-rendered pages ↔ Runs | 13/8 | 13/8 |
| LLM ↔ Other features | 2/1 | 2/1 |
| LLM ↔ Providers | 11/4 | 11/4 |
| LLM ↔ Runs | 31/37 | 31/37 |
| Other features ↔ Runs | 6/5 | 6/5 |

Knot groups:
- af55cb73: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]
- 90542b2c: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]

## Directed area links that differ
| link | af55cb73 | 90542b2c | Δ |
|---|---|---|---|
| server-rendered pages → LLM | 36 | 37 | +1 |

## Catch-all ("Other features") members
- af55cb73 (17; seams says 17): cost-format.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-settled.js, ruling-standing.js, stage-writes.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js, waiting-section.js
- 90542b2c (17; seams says 17): cost-format.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-settled.js, ruling-standing.js, stage-writes.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js, waiting-section.js
- code delta: −[] +[]

## Area file counts, internal imports, entry files
| area | files B | files H | internal B | internal H | entry B | entry H |
|---|---|---|---|---|---|---|
| Agent API | 32 | 32 | 45 | 45 | 13 | 13 |
| Auth | 64 | 64 | 115 | 115 | 57 | 57 |
| browser code | 44 | 44 | 0 | 0 | 0 | 0 |
| server-rendered pages | 91 | 91 | 286 | 286 | 55 | 55 |
| LLM | 78 | 78 | 68 | 68 | 69 | 69 |
| Other features | 17 | 17 | 6 | 6 | 16 | 16 |
| Platform | 25 | 25 | 2 | 2 | 23 | 23 |
| Providers | 36 | 36 | 40 | 40 | 31 | 31 |
| Reports | 8 | 8 | 3 | 3 | 6 | 6 |
| Runs | 108 | 108 | 187 | 187 | 93 | 93 |
| Task model | 2 | 2 | 1 | 1 | 2 | 2 |
| Web routes | 38 | 38 | 31 | 31 | 22 | 22 |
| Wiring | 1 | 1 | 0 | 0 | 0 | 0 |

Entry-file changes per area (path(importers:fromAreas)):
- **LLM & prompts**: ~lib/periodicals.js(7:Agent API+Runs+Wiring → 8:Agent API+server-rendered pages+Runs+Wiring)

## Files added / removed in scope
- added: none; removed: none

## File-level cross-area edges added / removed by code
Added (1):
- lib/render.js → lib/periodicals.js  [server-rendered pages → LLM]

Removed (0):

Intra-area edges: 784 → 784 (added 0, removed 0).
- added: none
- removed: none

## Change coupling (cochange --days 60, same guide)
| commit | window | changes | touching 2+ areas | pairs | unmapped | shallow |
|---|---|---|---|---|---|---|
| af55cb73 | 2026-09-06T19:02:28.000Z → 2026-11-05T19:02:28.000Z | 875 | 391 | 76 | 5746 | false |
| 90542b2c | 2026-09-07T11:12:59.000Z → 2026-11-06T11:12:59.000Z | 891 | 393 | 76 | 6220 | false |

Shared window: 59.326 of 60 days (98.88%).

Top 15 pairs at 90542b2c (with af55cb73, Δ, import link at 90542b2c):
| pair | 90542b2c | af55cb73 | Δ | import link? |
|---|---|---|---|---|
| browser code + server-rendered pages | 137 | 137 | 0 | no |
| Runs + Web routes | 112 | 112 | 0 | yes |
| Agent API + Runs | 107 | 105 | +2 | yes |
| browser code + Web routes | 100 | 100 | 0 | no |
| server-rendered pages + Web routes | 96 | 96 | 0 | yes |
| server-rendered pages + Runs | 94 | 92 | +2 | yes |
| Web routes + Wiring | 92 | 92 | 0 | yes |
| LLM + Runs | 89 | 87 | +2 | yes |
| browser code + Runs | 87 | 87 | 0 | no |
| Runs + Wiring | 82 | 82 | 0 | yes |
| server-rendered pages + Wiring | 80 | 80 | 0 | yes |
| Agent API + Web routes | 75 | 75 | 0 | yes |
| LLM + Web routes | 74 | 74 | 0 | yes |
| browser code + Wiring | 70 | 70 | 0 | no |
| Agent API + LLM | 66 | 64 | +2 | yes |

All pairs whose count moved:
- Agent API + Runs: 105 → 107
- server-rendered pages + Runs: 92 → 94
- LLM + Runs: 87 → 89
- Agent API + LLM: 64 → 66
- server-rendered pages + LLM: 41 → 43
- Agent API + server-rendered pages: 34 → 36

No-link pairs: af55cb73 19 of 76; 90542b2c 19 of 76.
- at 90542b2c: browser code + server-rendered pages (137); browser code + Web routes (100); browser code + Runs (87); browser code + Wiring (70); browser code + LLM (45); Agent API + browser code (44); Auth + browser code (29); browser code + Other features (28); browser code + Platform (27); Agent API + Reports (14); browser code + Providers (13); browser code + Reports (13); Other features + Reports (5); browser code + Task model (3); Agent API + Task model (2); Auth + Task model (2); Providers + Reports (2); Task model + Web routes (2); Task model + Wiring (1)
