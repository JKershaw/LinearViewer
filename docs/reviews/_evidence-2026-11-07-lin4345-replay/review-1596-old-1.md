## Review — LIN-1596

Reviewed head `8963dd0` (PR #1018 squash-merged; branch commit `63ea33ff`). 7 files, +707/−14.

CI: green on PR #1018 at `63ea33ff` (run 30210714098: unit, E2E shards 1–4, `ci-success`), as the ticket records. I also re-ran `tests/unit/kpi-stats.test.js` and `tests/unit/render-kpis.test.js` at HEAD: 52/52 pass, and the MangoDB aggregate path runs without falling back (no `aggregation failed` warning).

### Scope vs plan
The plan matches what changed on disk: the 7 planned files and no others, with `lib/dispatch-terminal.js` and the card/section primitives left untouched. The plan left one choice open, and the implementer took it: the headline sits outside `.kpi-cards`, so e2e stays at 11 cards and goes from 9 to 10 chart boxes. The implementer also introduced a 30-day headline window against a 28-day trend span, which is named and documented. Nothing went beyond the plan.

The code does what the settled metric says. Rows are harvested before grouping, abort rows are dropped after attribution, and the lineage key is `rootItemId || _id`, which matches `_archiveItem` and the `addFeedback` reconcile. The latest terminal by timestamp wins, `[skipped]` lineages are dropped, the denominator counts resolved lineages only, and buckets use the earliest dispatch. Per-row harvesting followed by lineage max-by-timestamp gives the same result as proxy.js's lineage-then-F1 ordering (LIN-1470) on the cases I traced: a later follow-up `[done]` beats an earlier abort, a later abort beats an earlier done, and an earlier abort never overrides its own target's later `[done]`. Privacy holds: only integers, day keys and ratios are emitted.

### Regression check
`git log -30` over the changed files. The fix from `ea7abb5` (never project raw `feedback[]`) is intact in the code: `$project` lists no `feedback`. I confirmed this with a probe that captures the docs the production pipeline returns (none has a `feedback` key). `ca0fc04` (privacy of the note field on emit) is untouched. Nothing is reverted or re-applied. The ticket paths have no commits since the ticket was created other than this one.

### Mutation checks (each reverted; tree clean afterwards)
| Mutation | Result |
|---|---|
| Keep `abort:true` rows | 5 red |
| Skip harvest attach | 3 red |
| Group by `_id` instead of `rootItemId` | 5 red |
| Count `[skipped]` | 3 red |
| Bucket on latest dispatch, not earliest | 1 red |
| First terminal wins instead of last | 4 red |
| Append abort blindly (no F1 guard) | 1 red (find path only) |
| Window 50d instead of 30d | 1 red |
| Render: always link / drop section `id` / headline inside `.kpi-cards` | 1 red each |
| **Production `$project` adds `feedback: 1`** (the raw read that caused the timeout comes back) | **all green** |
| **Production pipeline throws** (`$regexMatch` changed to a bogus operator, so it silently falls back to `find({})`) | **all green**, including "derives the outcome slices in-DB" and the parity test |

**Finding F1: the two load-bearing claims for success criterion 6 are not pinned.** The test "projection returns no raw feedback array" runs a hand-copied pipeline inline, not `loadDispatchHistory`, so it cannot see a change to the production projection. The aggregate-path tests and the parity test pass through the `find({})` fallback whenever the pipeline throws. Parity is then trivially true, because both sides run the find path. The plan said this risk was mitigated because "any operator problem surfaces in CI against real MangoDB". As shipped, it doesn't: it surfaces only as a `console.warn` that no test asserts. The production code is correct today. The guard the ticket claims is what's missing. I prototyped the fix below; it turns both mutations red and passes unmutated.

### Isolated, or one of a class?
- **The outcome metric is isolated.** `/kpis` is the only instance-wide outcome rate. The other terminal-seam consumers (`routes/proxy.js`, `pipeline-loops.js`, `session-telemetry.js`, `wall-clock-summary.js`) derive per-item status or timing, not a rate.
- **Class "aggregate load with a silent unbounded `find({})` fallback"**: `loadDispatchHistory` (fixed here, now warns) and `loadProxyBins` (`lib/kpi-stats.js`, a bare `catch {}` that falls back to a find over `proxyEvents`, the highest-volume log). `loadProxyBins` is **outside**: this ticket bounded only the dispatch-history read (success criterion 6). Close-out should file it as a follow-up: "`loadProxyBins` falls back silently to a full `proxyEvents` read; add the same warn and a no-fallback test."

### What CI Did Not Prove
1. **Inside (success criterion 6, the plan's named fallback risk).** The production projection carries no raw `feedback[]`, and the aggregate path really runs rather than falling back. Not pinned (F1). **Before the merge:** close-out applies fix F1 below, then re-runs the two mutations above (add `feedback: 1` to `$project`; rename `$regexMatch`). Each must go red.
2. **Inside (success criterion 6).** The pipeline (`$last` as an array operator, `$regexMatch` with `^\s*\[...\]` and `i`) runs on **production MongoDB**, not just MangoDB. CI's kpi-stats tests use MangoDB only. The `mongo:8.0` service in `.github/workflows/test.yml` exists but no kpi test uses it. `$last` on arrays needs MongoDB 4.4 or later. **Before the merge:** confirm the production MongoDB is 4.4 or later (`db.version()`), or have close-out add a case to `tests/unit/mongo-smoke.test.js` that runs `collectKpiStats` with the F1 no-fallback wrapper against the CI service. **Named monitor after deploy:** within one cache cycle (60s) of the first `/kpis` hit, the server log must show `KPI stats collected in Nms` and **no** `kpi-stats: dispatch-history aggregation failed` or `KPI stats collection slow` line. The first fires on exactly the silent-fallback failure. No pre-production check can show production-sized timings. **Rollback:** revert `8963dd0`. It persists no data and changes no schema, so it is fully reversible.
3. **Inside (success criterion 4).** Clicking the headline lands on the evidence chart. The e2e test returns early when `rate === null`, and CI's fresh `./data` per shard, with no seeded terminal markers and a 60s stale-while-revalidate cache, will usually take that branch. The click assertion is therefore probably not exercised. The unit test pins that `href` matches the section `id`. **Before the merge:** manual repro on an instance with at least 1 resolved lineage (a `taken` history row with a `[done]` feedback entry dispatched in the last 28 days). Click the percentage: the URL gains `#kpi-outcome-evidence` and the "work landed · weekly" box is in view with bars, not "no data yet".
4. **Inside (the "As asked" block; the narrowing).** "What fraction of merges were zero-touch" and "link each headline number to the evidence behind it" for the other 11 cards are in the ask and not delivered. Scoping split them out, but no person has agreed, and the split tickets were never filed. Per LIN-2825, filing would not discharge them anyway. **Settled only by the ruling below**: done here, or dropped with the reason.

### Fixes for close-out (after the ruling)
- **F1 (required), `tests/unit/kpi-stats.test.js`, aggregate suite.**
  1. Add a helper `noFallback(col)`. It returns `{ aggregate: p => ({ toArray: async () => { const d = await col.aggregate(p).toArray(); seen.push(...d); return d; } }), find: () => { throw new Error('fallback raw read used'); } }` and exposes `seen`.
  2. Wrap `collections.dispatchHistory` with it in "derives the outcome slices in-DB…" and on the aggregated side of the parity test.
  3. Replace the hand-copied-pipeline "projection returns no raw feedback array" test with one that drives `collectKpiStats` through `noFallback`. It asserts `seen.length > 0`, `seen.every(d => !('feedback' in d))`, `Object.keys(d.terminalEntry).sort()` equals `['message','timestamp']` wherever present, and that no `BULKY-HEARTBEAT-PAYLOAD` appears in `JSON.stringify(seen)`.
  4. Verify with the two mutations in ledger item 1.
- **F2 (recommended; discharges ledger item 2 before the merge), `tests/unit/mongo-smoke.test.js`.** Seed `outcomeSeed()`-equivalent rows into a real-Mongo `dispatchHistory` and run `collectKpiStats` with the F1 wrapper (empty stand-ins for the other collections). Assert done 2, failed 1, aborted 1, resolved 4, total 6, rate 0.5.
- **F3, `lib/render-kpis.js` `renderHeadlineCard`.** The percentage is rounded twice: `rate` is already rounded to 3dp, then `Math.round(rate*100)`. 49/76 = 64.47% shows as **65%**. Compute the displayed value as `Math.round((done / resolved) * 100)` when `resolved > 0`. Add a render-test case with `done: 49, resolved: 76, rate: 0.645` that expects `>64%</a>`.
- **F4, `lib/render-kpis.js` `renderHeadlineCard`.** The 30d/28d gap reopens the plan's "no link to an empty chart" rule. If every resolved lineage is 28–30 days old, `rate` is non-null but `sum(weeklyResolved) === 0`, so the anchor points at "no data yet". Render the anchor only when `rate !== null && (weeklyResolved || []).some(n => n > 0)`, with a matching render test.
- **F5, the visual baseline (named in the plan).** Regenerate `tests/screenshots/pages/kpis-{desktop,mobile}.png` via `npx playwright test --config=playwright.visual.config.js tests/visual/pages-screenshots.spec.js -g kpis`.
- **File (outside):** the `loadProxyBins` silent-fallback follow-up described above.

### DECISION
No ruling covers this; the ticket's comments are all stage-authored. **Do you agree that LIN-1596 closes on the outcome-rate headline (with its weekly trend and its own evidence link), with two parts of the ask explicitly dropped from this ticket?**
- *What fraction of merges were zero-touch*: dropped because Harbour has no merge data and no human-touch signal, so it needs research and probably new data capture.
- *Link each headline number to the evidence*, for the other 11 cards: dropped as separate UI work. Several cards (workspaces, users, sessions) have no chart that substantiates them yet.

The alternative is doing either here. **Recommendation: agree to both drops.** Neither can be done well inside this ticket without a new design. Close-out can then open them as fresh tickets for the requester, so the asks are not lost.

### Verdict
`Needs Discussion`

What was asked: *"what fraction of dispatches end [done] vs [failed]/[aborted] … trend up … put at the top … link each headline number to the evidence behind it"*. The outcome-rate headline, its done/failed/aborted slices, the weekly trend, the top placement and one evidence link are met, and the logic is verified and mutation-checked. The work is narrowed in two places no person has agreed to: zero-touch merges, and evidence links on the other headline numbers. Next action: the ruling above. Then close-out applies F1–F5 and discharges ledger items 1–3.
