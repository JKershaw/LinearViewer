## Scope: size of the move (LIN-4178 @ `10b2c82f`)

**Size:** consolidate the decision this task touches. **Decided by:** the standing policy (err larger). There are no cuts to the ask. The size record is in the description under `## As asked`.

**Re-ground.** `git log --since=2026-11-03T23:02Z` is empty. Every reference in the ticket still holds at HEAD:

- `kpi-stats.js:449-460`, `:454`, `:488`
- `workspace-kpi-stats.js:147`
- `dispatch-lineage.js:187`
- `terminal-marked-task-cost.js:68`
- `weekly-budget.js:26`
- `run-view.js:252`
- `render-workspace-kpis.js:150`
- `pipeline-loops.js:360`
- `routes/dashboard.js:691`

**What the code shows, and why it changes what "done" means**

1. **The S11 golden is not today's `/kpis`.** The harness calls `computeTerminalMarkedTaskCost([...corpus.history, ...corpus.queue], now)` (`tests/fixtures/cost-replay/harness.js`, the S11 line). That is every stored row, with no 30-day fetch. Production goes through `loadDispatchHistory` with the read horizon (`kpi-stats.js:1063-1073`). So in the golden, the four straddlers `st`, `so`, `nss` and `cg` get their true start and fall out of the window.
   - I ran it at HEAD with the same corpus:

     | Input | Priced tickets | Cost |
     | -- | -- | -- |
     | Unwindowed (the golden) | 9 | $74.28 |
     | Windowed, as production fetches | 11 | $79.88 |

     The hand-built in-window lineage sets differ by exactly those four.
   - Against this golden, W2/W6 ("same lineage set as the golden", "equal except (b) and note 1") and "S11 keeps exactly today's population" cannot both hold. Matching the golden would mean true-start dating for `/kpis`, which is B1, rejected, and out of scope without John.
   - The note-1 case (`so`) is not in the golden's S11 population at all.
   - S12's golden *is* windowed (find fallback with the `since` filter), so S11 and S12 goldens disagree on population today. That matters for W4's S12 = S11 check.
2. **The replay feeds shapes production never produces (both Surveys; confirmed).**
   - `readCost` folds `readRowUsage(member.feedback)` only. KPI rows on Mongo carry `usageEntry` and no `feedback`, and the fake collection has no `aggregate`.
   - Real loop records carry `lineageId`/`historyStatus`, with no `status` or `rootItemId`. `groupLineageMembership` would drop every loop.
   - Wired as written, the replay stays green while production S11/S12 price nothing and S13 withholds everything.
3. **The $0 fixes sit below the renderers.**
   - S12's zero comes from `|| 0` in `workspace-kpi-stats.js`, and it also feeds the chart.
   - S13's `fmtUsd` in `render-run-steps.js:270` returns null for `usd <= 0`, so a complete $0 renders blank. `run-view.test.js` pins it.

**The size, in short.** First, make the replay use production shapes for S11/S12/S13 and re-take those three goldens at `9e397e6b`. Run the note-2 assertion there, and stop and report if it fails. Then do the asked wiring, with:

- one founder query shared with the store's;
- one successor join instead of two;
- the unknown-day fix in the data, with the chart taught about null;
- the day bucket moved home and `weekly-budget.js` gone;
- `formatUsd` in the touched renderers;
- the source map updated.

The aggregation emitting the read's shape (a rebuild) is not this piece.

**For LIN-4176 (the builder posts it when changing course).** The plan's "goldens are a true before" fails for S11/S12/S13. They will be re-taken at the same baseline with production shapes. That is a harness fix and changes no rule.

**Notes for the builder**

- Change (b) also moves T, components, `anchoredIdentifiers` and the shares. Name them under (b).
- S12's day axis starts later than the fetch horizon. Today a lineage whose fetched start falls in that gap is not counted, and it must stay that way. Add the case to the corpus.
- Note 1 is yours to decide, and with the re-taken golden it is visible either way.
- `mongod` is present on this machine for the timing.
