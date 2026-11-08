## Scope: LIN-4178 @ 10b2c82f

**Size:** consolidate the decision this task touches, set by the standing policy. Three cuts to the ask need one ruling (below). The size record is in the description under `## Size of the move`.

**Staleness check.** The ticket was written right after `10b2c82f` (LIN-4177, piece 1) merged. Since then, `git log --since=2026-11-03T21:00Z` over every referenced path shows only `10b2c82f` itself. The "grounding commits" line names `9e397e6b`, but the work starts from `10b2c82f`. Every line reference in the ticket still matches HEAD.

**What the code shows (each finding checked by running the code on the fixture corpus, with no repo change)**

1. **The read prices nothing on KPI rows.** `lib/cost-read.js` `lineageRecords` folds `readRowUsage(member.feedback)`, and `missingCanChangeFigure` reads `member.feedback` too. The production KPI rows come from the `$project` at `lib/kpi-stats.js:449-460`, which carries `usageEntry` and no `feedback`. I fed the corpus in that shape, and all 18 hand-built lineages read `no-usage`. The parent plan said the fold would be `readUsageEntry(usageOf(row))`, "which serves both row shapes". Piece 1 did not do that. Done now requires the read to take usage from either shape. `usageOf` in `lib/dispatch-lineage.js:41` already does that.
2. **The S11 golden is not today's `/kpis`.** `tests/fixtures/cost-replay/harness.js` calls `computeTerminalMarkedTaskCost([...corpus.history, ...corpus.queue], now)` over the whole corpus. Production fetches only `dispatchedAt ≥ horizon` (`kpi-stats.js:488`, `:631`). So in the golden, the straddlers' true founders are present and their true start is outside the window. `st`, `so`, `cg` and `nss` are all left out, which is exactly the B1 population the plan rejected.
   - golden: `pricedTicketCount 9, pricedTicketCostUsd 74.28, unknownHarnessShare 0.857`
   - production fetch, at HEAD, in both the raw and the projected shape: `11, 79.88, 0.824`

   W6 cannot be met against this golden without silently changing `/kpis`. S12's golden does go through the 30-day `find` (only the raw shape), and S13's per-group figures are valid for today's fold.
3. **(b) is invisible in S11's published numbers on the corpus.** I credited `st-2` to LIN-42 and S11's output did not change: LIN-42 and LIN-99 both stay in T, and both are priced. W2's "credited to LIN-42" therefore has to be proven by a test-side listing of moved lineages.
4. **S12's window edge is in the corpus already.** P's earliest fetched member (29.99 days ago) is before the S12 axis start (floored day-29 midnight). So today P is not in S12 at all: the golden shows `perDay[29] = 0`. Reading "earliest in-window member" against S12's own axis would add $7 to today. Settled: keep the fetched-start rule.
5. **S13 loops.** Real loop records (`lib/pipeline-loops.js` `_loopRecord`) have `loopId`, `lineageId` and `historyStatus` (null for live rows), but no `status`, `rootItemId` or `id`. The harness's `sessionLoops` makes up `status`. Membership in the read needs `status === 'taken'`, so real loops would give no members. S13 also has its own `$0` blank: `fmtUsd` returns null for `usd <= 0` (`lib/render-run-steps.js:270`), as well as `lineageCost` (`lib/run-view.js:257`).
6. **S12's zero is made in the data.** It comes from `|| 0` in `lib/workspace-kpi-stats.js` (`perDay`). It also feeds the chart (`public/workspace-kpis.js:127-130`), so a fix in the renderer alone leaves a zero bar.
7. **Note 2 holds at HEAD**, on both the windowed and the whole fetch (4020/4020 and 4016/4016, nothing on one side only).
8. **Founder-lookup timing is doable.** `mongod` and `mongosh` are installed on this machine.

**Note 1, settled: apply.** A done opencode straddler (`so`) is priced today from its in-window delta alone and counted as fully priced. That is a silent partial. The movement is named as "(d) also reaches S11: a done opencode straddler's component is no longer priced".

**Ruling needed: three cuts to the ask**
- W4 "S1 = S13's group figures": equal for lineages both surfaces read whole. `so` differs by design (S1: incomplete; S13: $1.10 from all its loops) and is listed with its reason.
- W6 / W2 "equals the golden" for S11: compared instead against S11's before, recorded again at `9e397e6b` through the production fetch.
- (b) "… credited to its founder's issue … Nothing else": also allows the priced-ticket count, T-based shares and lane-landed tickets to move, when each is listed and comes solely from the moved issue.

Recommendation: agree all three. The alternatives either change piece 1's S1, window the run page, or leave `/kpis` gated on a before that was never true.
