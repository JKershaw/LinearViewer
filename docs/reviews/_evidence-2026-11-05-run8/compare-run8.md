# Run 7 beat 1 comparison (from evidence JSON; one guide, blob 642e9405, for both commits)

Baseline `2eb73ae07fb7297fc0fa057a6198aa8cbe901558` (run 6's measured commit) → measured `af55cb737ec4e63919bac65558b35498ede3d290` (origin/main).

## Scope and tool limits (seams.scope)
| commit | files | parseFailures | nonLiteralDynamicImports | unmappedFiles | unresolvedRelativeImports |
|---|---|---|---|---|---|
| 2eb73ae0 | 543 | 0 | 0 | 0 | 4 |
| af55cb73 | 544 | 0 | 0 | 0 | 4 |

## Headline
| commit | cross-area links (sum) | link rows | knot pairs | groups (sizes) | Other files | F1 LLM→Runs / Runs→LLM | lib→routes edges | edge-dump cross-area (witness) |
|---|---|---|---|---|---|---|---|---|
| 2eb73ae0 | 1269 | 68 | 12 | 9 | 16 | 31/37 | 0 | 1269 |
| af55cb73 | 1271 | 69 | 12 | 9 | 17 | 31/37 | 0 | 1271 |

## Knot pairs (a→b / b→a)
| pair | 2eb73ae0 | af55cb73 |
|---|---|---|
| Agent API ↔ LLM | 37/4 | 37/4 |
| Agent API ↔ Providers | 20/3 | 20/3 |
| Agent API ↔ Runs | 45/10 | 45/10 |
| Auth ↔ server-rendered pages | 14/11 | 14/11 |
| Auth ↔ LLM | 4/3 | 4/3 |
| Auth ↔ Providers | 12/1 | 12/1 |
| server-rendered pages ↔ Other features | 9/8 | 9/8 |
| server-rendered pages ↔ Runs | 13/8 | 13/8 |
| LLM ↔ Other features | 1/1 | 2/1 |
| LLM ↔ Providers | 11/4 | 11/4 |
| LLM ↔ Runs | 31/37 | 31/37 |
| Other features ↔ Runs | 6/5 | 6/5 |

Knot groups:
- 2eb73ae0: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]
- af55cb73: [Agent API, Auth, server-rendered pages, LLM, Other features, Providers, Reports, Runs, Task model]

## Directed area links that differ
| link | 2eb73ae0 | af55cb73 | Δ |
|---|---|---|---|
| Agent API → Other features | 0 | 1 | +1 |
| LLM → Other features | 1 | 2 | +1 |

## Catch-all ("Other features") members
- 2eb73ae0 (16; seams says 16): cost-format.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-settled.js, ruling-standing.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js, waiting-section.js
- af55cb73 (17; seams says 17): cost-format.js, dashboard-refresh.js, home-pipeline.js, home-row-states.js, home-rows.js, home-view.js, key-state-holders.js, key-state.js, live-anchor.js, ruling-settled.js, ruling-standing.js, stage-writes.js, subtree-index.js, task-facts-holder.js, task-state.js, usage-snapshot-intake.js, waiting-section.js
- code delta: −[] +[lib/stage-writes.js]

## Area file counts, internal imports, entry files
| area | files B | files H | internal B | internal H | entry B | entry H |
|---|---|---|---|---|---|---|
| Agent API | 32 | 32 | 45 | 45 | 13 | 13 |
| Auth | 64 | 64 | 115 | 115 | 57 | 57 |
| browser code | 44 | 44 | 0 | 0 | 0 | 0 |
| server-rendered pages | 91 | 91 | 286 | 286 | 55 | 55 |
| LLM | 78 | 78 | 68 | 68 | 69 | 69 |
| Other features | 16 | 17 | 6 | 6 | 15 | 16 |
| Platform | 25 | 25 | 2 | 2 | 23 | 23 |
| Providers | 36 | 36 | 40 | 40 | 31 | 31 |
| Reports | 8 | 8 | 3 | 3 | 6 | 6 |
| Runs | 108 | 108 | 187 | 187 | 93 | 93 |
| Task model | 2 | 2 | 1 | 1 | 2 | 2 |
| Web routes | 38 | 38 | 31 | 31 | 22 | 22 |
| Wiring | 1 | 1 | 0 | 0 | 0 | 0 |

Entry-file changes per area (path(importers:fromAreas)):
- **Other features**: +lib/stage-writes.js(2:Agent API+LLM)

## Files added / removed in scope
- added: lib/stage-writes.js; removed: none
- `lib/stage-writes.js` → area **Other features**. Importers (2): lib/prompt-template-defs.js [LLM], lib/proxy-preamble.js [Agent API]. Imports (0): none.

## File-level cross-area edges added / removed by code
Added (2):
- lib/prompt-template-defs.js → lib/stage-writes.js  [LLM → Other features]
- lib/proxy-preamble.js → lib/stage-writes.js  [Agent API → Other features]

Removed (0):

Intra-area edges: 784 → 784 (added 0, removed 0).
- added: none
- removed: none

## Change coupling (cochange --days 60, same guide)
| commit | window | changes | touching 2+ areas | pairs | unmapped | shallow |
|---|---|---|---|---|---|---|
| 2eb73ae0 | 2026-09-06T06:00:24.000Z → 2026-11-05T06:00:24.000Z | 851 | 390 | 76 | 5416 | false |
| af55cb73 | 2026-09-06T19:02:28.000Z → 2026-11-05T19:02:28.000Z | 875 | 391 | 76 | 5746 | false |

Shared window: 59.457 of 60 days (99.09%).

Top 15 pairs at af55cb73 (with 2eb73ae0, Δ, import link at af55cb73):
| pair | af55cb73 | 2eb73ae0 | Δ | import link? |
|---|---|---|---|---|
| browser code + server-rendered pages | 137 | 140 | -3 | no |
| Runs + Web routes | 112 | 111 | +1 | yes |
| Agent API + Runs | 105 | 101 | +4 | yes |
| browser code + Web routes | 100 | 102 | -2 | no |
| server-rendered pages + Web routes | 96 | 98 | -2 | yes |
| server-rendered pages + Runs | 92 | 92 | 0 | yes |
| Web routes + Wiring | 92 | 93 | -1 | yes |
| browser code + Runs | 87 | 86 | +1 | no |
| LLM + Runs | 87 | 84 | +3 | yes |
| Runs + Wiring | 82 | 82 | 0 | yes |
| server-rendered pages + Wiring | 80 | 81 | -1 | yes |
| Agent API + Web routes | 75 | 74 | +1 | yes |
| LLM + Web routes | 74 | 73 | +1 | yes |
| browser code + Wiring | 70 | 71 | -1 | no |
| Agent API + LLM | 64 | 61 | +3 | yes |

All pairs whose count moved:
- browser code + server-rendered pages: 140 → 137
- Runs + Web routes: 111 → 112
- browser code + Web routes: 102 → 100
- Agent API + Runs: 101 → 105
- server-rendered pages + Web routes: 98 → 96
- Web routes + Wiring: 93 → 92
- browser code + Runs: 86 → 87
- LLM + Runs: 84 → 87
- server-rendered pages + Wiring: 81 → 80
- Agent API + Web routes: 74 → 75
- LLM + Web routes: 73 → 74
- browser code + Wiring: 71 → 70
- Agent API + LLM: 61 → 64
- browser code + LLM: 44 → 45
- Agent API + browser code: 43 → 44
- Other features + Runs: 31 → 33
- Other features + Web routes: 29 → 30
- Agent API + Other features: 12 → 14
- LLM + Other features: 11 → 13

No-link pairs: 2eb73ae0 20 of 76; af55cb73 19 of 76.
- at af55cb73: browser code + server-rendered pages (137); browser code + Web routes (100); browser code + Runs (87); browser code + Wiring (70); browser code + LLM (45); Agent API + browser code (44); Auth + browser code (29); browser code + Other features (28); browser code + Platform (27); Agent API + Reports (14); browser code + Providers (13); browser code + Reports (13); Other features + Reports (5); browser code + Task model (3); Agent API + Task model (2); Auth + Task model (2); Providers + Reports (2); Task model + Web routes (2); Task model + Wiring (1)
