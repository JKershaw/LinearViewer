# Rebuild-wave rationale diff — LIN-3825 evidence

Grounding: LinearViewer `76fc3e91`. Counter: `comprehension-debt-rationale-count.mjs`; raw output: `comprehension-debt-rationale-count.out.jsonl` (the script ran twice and produced identical output).

## Counting method
- The rebuild PRs are squash commits (one parent), so "first parent vs merge" is `<sha>^` vs `<sha>`.
- For each changed `lib|routes/**/*.js` or `lib/**/*.mjs` file, `acorn` (`onComment`) yields the comments at both revisions.
- **Comment lines** = lines spanned by comments. **LIN refs** = distinct `LIN-\d+` in comments, **pooled per commit** (a ref moved between files in the same commit is not dropped).
- **Dropped** = in the pooled before-set, not in the after-set. **Gone from HEAD** = also absent (word-bounded) from `lib routes public` at HEAD, so no reason for it is cited anywhere. "Gone from HEAD" is a lower bound on harm, not a proof: a ref can survive elsewhere for an unrelated reason.
- Limits: counts comments, not meaning. A reworded reason with its ref kept counts as retained. Pooled counts cover every changed file in the commit, so they differ from per-module counts quoted in the research for multi-file commits (e.g. `a9f81290`, `0eb4a2d1`).

## Result (16 commits; 14 modules/tickets)
| Commit | Ticket | Files | Comment lines | LIN refs | Dropped | Gone from HEAD | Verdict |
|---|---|---|---|---|---|---|---|
| `4ee0a2c7` | LIN-3578 pipeline-loops | 1 | 979→421 | 51→34 | 18 | LIN-2187 | Low residue (N9). The paper's "17" is the net after LIN-3384 was added |
| `1f8010a0` | LIN-3579 render cluster | 5 | 1517→1042 | 104→98 | 7 | none | retained elsewhere; not individually re-read (reader, not re-derived) |
| `b3bdccaf` | LIN-3580 dispatch-factory | 2 | 802→609 | 40→40 | 1 (LIN-1094) | none | clean; stale pointer (N10) |
| `16e7ae77` | LIN-3590 task-page-loader | 1 | 290→367 | 11→11 | 0 | — | clean |
| `91fca7dd` | LIN-3591 kpi-stats | 1 | 425→445 | 25→25 | 0 | — | clean |
| `a9f81290` | LIN-3703 /kpis page | 8 | 2045→1930 | 136→136 | 2 (LIN-1958, 2404) | none | clean; kept/changed/dropped rows in `docs/plans/kpis-public-design.md` |
| `d2d7d818` | LIN-3592 dispatch routes | 4 | 1857→1940 | 131→132 | 0 | — | clean |
| `2e8cba6e` | LIN-3611 dispatch-entrance | 1 | 704→731 | 84→85 | 0 | — | refs kept; open questions unmarked (N2) |
| `603853c5` | LIN-3596 workspace-api | 2 | 1495→1514 | 106→107 | 1 (LIN-772) | none | the "none dropped" claim was false; reason survives at `routes/workspace-api.js:1159-1161` |
| `06ec62b7` | LIN-3569 proxy-reads | 1 | 282→173 | 21→20 | 4 | none | GitHub redirect-gap note lost (N11) |
| `350242d5` | LIN-3573 writes/rulings | 3 | 986→975 | 55→54 | 3 | LIN-1976, LIN-871 | Low (N12): a "not LIN-1976" disambiguation and a research cite for `attachmentCreate`; behaviour unchanged |
| `65969467` | LIN-3566 render-roadmap | 1 | 87→100 | 3→6 | 0 | — | clean |
| `0eb4a2d1` | LIN-3706 plan-allowance | 9 | 2962→3194 | 183→185 | 0 | — | clean |
| `74e5e2ca`, `e7f7bd57`, `269a6189` | LIN-3565/3557/3556 Jira ADF codec | 1 each | 356→382; 273→318; 457→273 | 6→7; 4→4; 5→4 | 0; 0; 1 (LIN-2378) | none | clean (codec comments are refs-light) |

## Reading
12 of 14 modules drop no ref that is gone from HEAD. The two with refs gone from HEAD are pipeline-loops (1) and proxy-writes (2), both Low. Whether a *reason* survived each dropped ref was only read for the cases named in the verdict column. No test, script or CI step enforces this (see report N4).
