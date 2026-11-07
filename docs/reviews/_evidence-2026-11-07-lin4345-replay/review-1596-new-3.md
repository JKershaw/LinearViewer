## Review — LIN-1596

Reviewed head `8963dd0`, the squash of PR #1018 (branch head `63ea33ff`). It touches 7 files: `lib/kpi-stats.js`, `lib/render-kpis.js`, `public/kpis.js`, `public/kpis.css`, `tests/e2e/kpis.spec.js`, `tests/unit/kpi-stats.test.js` and `tests/unit/render-kpis.test.js`.

CI: green on `63ea33ff` (run 30210714098: unit, E2E shards 1–4, `ci-success`), as the ticket records. I re-ran it locally too: `kpi-stats` + `render-kpis` unit tests 52/52, and `tests/e2e/kpis.spec.js` 8/8.

### Summary

The engineering is good. It matches the plan, and every rule it encodes is pinned by a test that goes red when that rule is removed. Two problems stop a plain approval:

1. **Two parts of what was asked were cut by the scoping stage, not by the person, and nothing tracks them.** These are the zero-touch merge rate and evidence links on the other headline numbers. The implementation comment says the split-out tickets "remain unfiled here as agreed", so no ticket exists for either. That needs the person's agreement (see Verdict).
2. **The aggregate-path tests cannot tell whether the production pipeline actually runs.** If the pipeline throws, the code falls back to the raw `find({})` and every test stays green. This is a test fix close-out can make (ledger item 3).

### Scope against plan

The change matches the plan's surface list file for file. There are no unplanned files, and `lib/dispatch-terminal.js`, `lib/components/*` and `lib/dispatch-store.js` are untouched, as planned. The plan left two choices open, and the implementation made both and recorded them:
- The headline sits outside `.kpi-cards`, so the e2e card count stays 11 and the chart-box count goes from 9 to 10.
- The headline uses a 30-day window but the trend covers 28 days, so a lineage aged 28–30 days counts in the headline but not in any weekly bucket. This is documented at both constants.

One small change from the plan, with no effect: it uses `findTerminalFeedback` rather than `deriveTerminalStatus`, because it needs the entry's timestamp for last-marker-wins across a lineage. It is the same seam, unchanged.

Staleness: `git log --since=2026-07-26T15:36:33Z HEAD^` over every file the ticket names, plus `lib/components`, returns nothing. The plan was current when implemented.

### Regression check

`git log --oneline -30` over the 7 files. The commits that matter:
- **`ea7abb5` (/kpis timeout fix).** The fix still holds. `feedback` is never projected: the in-DB `$map` → `$filter` → `$last` returns at most one `{message, timestamp}` per row. I checked this against a **real `mongod` 8.2.4** (details under item 1): no row came back with a `feedback` key, and the bulky heartbeat payload did not leak. The `try/catch` fallback now logs a `console.warn` instead of failing silently, as the plan required.
- **`ca0fc04` / `86cf230` (LIN-1540 privacy boundary).** Still holds. `dispatchOutcomes` emits only integers, ratios and `YYYY-MM-DD` keys. The extended leak test checks that a marker's free-text tail and `urlKey` stay out of the stats.
- **`6ac845f` (LIN-859 Card/Section primitives).** Used through their existing `body` and `attrs` slots. No change to the primitives.

No reverted change is re-applied.

### Gap analysis (success criteria and cross-cutting concerns)

| # | Criterion | Where it's met | Status |
|---|---|---|---|
| 1 | Headline above the volume cards, with done/failed/aborted slices | `renderHeadlineCard`, placed before `.kpi-cards`; e2e checks label and slices | Met |
| 2 | Coverage sub-label `N of M resolved · 30d` | `.kpi-headline-coverage`; unit + e2e | Met |
| 3 | Weekly trend inside the window | `chart-outcome-trend`, 4 buckets keyed on the lineage's earliest dispatch, `n =` in the tooltip | Met |
| 4 | Number links to its evidence | `href="#kpi-outcome-evidence"`, id on the section wrapper (not the canvas), no anchor when `rate === null` | Met. See item 4: CI may only have run the empty branch |
| 5 | Per lineage, abort rows ignored but their aborts honoured, `[skipped]` excluded | Order: harvest per row → attach → drop abort rows → group | Met, and mutation-checked |
| 6 | Renders within the router timeout; no raw `feedback[]` | In-DB derivation | Not proven at production scale (items 1, 2). The test claiming to guard it is weak (item 3) |
| 7 | No `urlKey`, prompt or issue content exposed | Leak test extended | Met |
| 8 | Unit coverage on both load paths, incl. abort-row and follow-up-lineage cases | Present | Present, but the aggregate path only *appears* covered (item 3) |

All nine cross-cutting concerns in the plan are handled in code. CC1/CC2 (ordering and the F1 guard), CC3 (both `[skipped]` exclusions), CC4/CC5 (one key, one pass) and CC7 (anchor on the wrapper) each have a test that fails under mutation. CC8 (a queued follow-up after a resolved row still counts as resolved) is the accepted simplification and is documented.

### Mutation checks (LIN-2274)

Every mutation was reverted, and the tree is clean.

| Mutation | Result |
|---|---|
| Don't attach the harvested abort (`findTerminalFeedback(feedback)`) | 3 red |
| Keep `abort: true` rows | 5 red |
| Keep `[skipped]` lineages | 3 red |
| Group per row (`String(row._id)`) | 5 red |
| Earliest terminal wins instead of latest | 4 red |
| Bucket on latest dispatch instead of earliest | 1 red |
| Drop `attrs: id=…` from `renderChartBox` | 1 red |
| Render the anchor even when `rate === null` | 1 red |
| **Make `loadDispatchHistory`'s `aggregate()` throw** (`throw` as the first statement in the `try`) | **0 red, 38/38 green.** The warn fired 8 times. Every "aggregation path, real MangoDB" test, including **parity**, silently ran through the raw-`find` fallback. The "projection returns no raw feedback array" test never calls production code: it re-types the pipeline inline, so it would stay green even if production projected `feedback: 1`. This is a finding (item 3). |
| Throw in the e2e click branch, run against the empty e2e DB | Green: the branch did not run. With 3 seeded history rows it went red, so it runs only when data exists (item 4). |

### Manual verification

I seeded a local MangoDB data dir with three history rows (one `[done]`, one `[failed]`, one unresolved) and drove `/kpis` at 412px width. The headline reads `50%` / `of dispatched work landed · 30d` / `done 1 · failed 1 · aborted 0` / `2 of 3 dispatches resolved · 30d`. It sits above the card grid with no horizontal overflow. Clicking it lands on `#kpi-outcome-evidence` with the `work landed · weekly` box in view. The full kpis spec passed 8/8 against the seed. I removed the seed and the data dir afterwards.

Minor, non-blocking: on the bar chart, a week where everything failed (0%) draws no bar, so it looks the same as a week with no data (`null`). Only the tooltip, or its absence, tells them apart.

### Isolated, or one of a class?

The class is "consumers of the terminal-marker seam that derive outcomes". `harvestAbortedTargets` is used by `routes/proxy.js`, `lib/pipeline-loops.js` and now `lib/kpi-stats.js`. `routes/dashboard.js`, `lib/session-telemetry.js`, `lib/wall-clock-summary.js` and `lib/chat-tools.js` read terminal markers without the harvest pair. Those are per-session state and timing views, which belong to LIN-1257's class rather than this ticket's /kpis headline. **Outside.** I have not confirmed any of them is a defect, so this review asks for no ticket.

Within this ticket's own class, the in-DB marker derivation is the first use of `$regexMatch`, `$filter` or `$last` anywhere in `lib/`, `routes/` or `server.js`. Item 1 exists for that reason.

Separately: `dispatchByWeek`'s 5-week span against the 30-day TTL leaves its oldest bucket under-filled. Scoping and the plan both noted this and said not to fix it here. **Outside.** Close-out files it if no ticket exists.

### What CI Did Not Prove

1. **Production MongoDB accepts the new `$project`.** *Inside* (criterion 6; a claim this change depends on). CI runs the pipeline only against MangoDB. The workflow's `mongo:8.0` service is used only by `mongo-smoke` and `add-feedback-atomic`, not by the KPI tests. The array form of `$last` needs MongoDB ≥ 4.4 and `$regexMatch` needs ≥ 4.2. If production rejects either, the code drops back to the unbounded read that `ea7abb5` removed. **My partial check:** I ran `collectKpiStats` against a local `mongod` 8.2.4, seeded with production-shaped rows (`Date` timestamps, an entry with no message, a bare-string entry, `[Complete]` with leading spaces, an abort row, a two-row lineage). No fallback warn fired, the output matched the find path exactly, and the projected rows had no `feedback` key. What that run can't show is the production server version. **Route:** after deploy, confirm the production `MONGODB_URI` server is ≥ 4.4 (`db.version()`). **Named monitor:** the server log line `kpi-stats: dispatch-history aggregation failed, falling back to a raw read`, which must never appear. **Named rollback:** revert the squash commit for PR #1018. That is reversible: no stored data, no migration.
2. **`/kpis` still fills within the router timeout on a production-sized `dispatch-history`.** *Inside* (criterion 6). The per-row regex scan is far more expensive than `$size`. On a local synthetic set of 20k rows × ~100 feedback entries, the new projection took ~1.2 s against ~0.2 s for the old `$size`-only one (about 5–6×), and the raw `find` took 3.0 s. That is well inside 30 s, but it is not production data. **Route:** after deploy, read the cold-fill timing in the `KPI stats collected in Nms` log line. **Named monitor:** the existing `KPI stats collection slow: Nms` warn (over 5000 ms). The 60 s stale-while-revalidate cache means only a cold boot waits on this read. **Named rollback:** same commit revert as item 1.
3. **The aggregate-path tests do not prove the aggregate path ran.** *Inside* (criteria 6 and 8: "both aggregate and non-aggregate paths" and "no raw `feedback[]`"). See the throw mutation above. **Route: before the merge. Close-out makes this fix** in `tests/unit/kpi-stats.test.js`:
   - (a) In the `collectKpiStats (aggregation path, real MangoDB)` suite, make `realCollections` return `dispatchHistory` wrapped so `find()` throws (`find() { throw new Error('aggregate path must not fall back to find') }`), with `aggregate` and `countDocuments` passed through to the real collection. Then those tests, including parity, can only pass via the pipeline.
   - (b) Rewrite `projection returns no raw feedback array, only the single derived entry` to stop re-typing the pipeline. Wrap the real collection's `aggregate` so it records what its `toArray()` returns, call `collectKpiStats(collections, { now: NOW })`, and run the existing assertions on the recorded rows: no `feedback` key, `terminalEntry` keys exactly `['message','timestamp']`, `BULKY-HEARTBEAT-PAYLOAD` absent.
   - **Check that settles it:** put `throw new Error('x')` as the first line inside `loadDispatchHistory`'s `try`. At least the parity, in-DB-slices and projection tests must go red. Then revert.
4. **Clicking the headline lands on its evidence (criterion 4) in a real browser.** *Inside.* The e2e test returns early when `rate === null`, which is the case on a fresh, empty e2e DB. Whether CI's shard actually ran the click depends on ordering and the 60 s KPI cache. **Discharged:** I verified it at this head against a seeded DB (Manual verification above). The e2e assertion still can't guarantee it on every CI run, because there is no test route that seeds `dispatch-history`.
5. **Visual baseline.** *Inside* (a test artefact this change shifts). `tests/visual/pages-screenshots.spec.js` (`kpis`) will differ, and it runs only under `playwright.visual.config.js`, not in CI. **Route: before the merge.** Run `npx playwright test -c playwright.visual.config.js -g kpis --update-snapshots`, check the new snapshot shows the headline above the cards and the `work landed · weekly` box, and commit it.
6. **The live headline covers enough work to mean something.** *Inside* (criterion 2: why the coverage label is mandatory). `[ended·unconfirmed]` and still-running lineages fall out of `resolved`, and no production data has been seen yet. **Route: after deploy.** Read the live `N of M dispatches resolved · 30d`. If N/M is low, the plan's named trigger applies, and close-out files a ticket against the shared seam (`TERMINAL_FEEDBACK_REGEX` does not map `[ended·unconfirmed]`). That ticket would be outside: a separate problem in the shared seam.

### Verdict

**Needs Discussion**

The ask, sentence by sentence:

1. *"…this page counts activity, not outcomes."* Met: the page gets its first outcome metric.
2. *"Everything here is a volume metric — actions, dispatches, notes."* Met: the headline is a ratio, deliberately kept out of the volume grid.
3. *"…what fraction of dispatches end [done] vs [failed]/[aborted], **and what fraction of merges were zero-touch**."* **Partly met.** The done/failed/aborted fraction ships, per lineage, with slices. The zero-touch fraction does not. Scoping split it out because Harbour has no merge data and no human-touch signal, which I confirmed: `humanContinued` does not appear in `lib/`, `routes/` or `server.js`, and `lib/providers/github/client.js:108,125` filters out PRs.
4. *"The work-funnel and step-outcomes charts presumably hold this, but it's not headlined."* Met: they don't hold it (`funnel.completed` is a different signal), and the new number is headlined.
5. *"'X% of dispatched work landed **without human touch**, trend up' is the KPI…"* **Partly met.** "X% landed" and the weekly trend ship. "Without human touch" does not, for the same reason as sentence 3. The shipped label does not overclaim: it says "of dispatched work landed".
6. *"That's the one I'd put at the top — and… link **each** headline number to the evidence behind it."* Top: met. Linking: met only for the new headline. The other 11 cards were split out by scoping.

Sentences 3, 5 and 6 were narrowed by the scoping stage, not by the person or an answered ruling, and the split-out work is not filed anywhere.

**Question for the person:** Do you accept LIN-1596 shipping only the done/failed/aborted outcome rate and its own evidence link? That would mean explicitly dropping two parts from this ticket:
- the zero-touch rate, because no data source exists, and its first question is whether "zero-touch" means *merged with no human involvement* or *finished with no human-initiated follow-up*;
- evidence links on the other 11 cards, which are separate UI work with no data dependency.

Each would be carried as new work by its own ticket, filed by close-out: zero-touch to `research`, the 11-card links to `plan`.

**My recommendation: yes, drop both with those reasons.** The shipped metric stands on its own and is honestly labelled. The zero-touch half cannot be built until a signal exists. Holding a working headline back for either part gains nothing.

If you agree, this becomes **Approve — conditional on close-out discharging the ledger**. Close-out would make the item 3 test fix and the item 5 re-baseline before the merge, run the item 1, 2 and 6 post-deploy steps, and file the two split-out tickets and the outside `dispatchByWeek` span ticket after checking none already exists. If you want either part done here, it goes back to `research` (zero-touch) or `implementation` (links) on this ticket.
