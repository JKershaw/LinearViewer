# KPI daily rollup: running totals and the rate/total toggle (LIN-3712)

Status: design note, for operator approval. Docs only; the build is a separate ticket filed after approval.
Builds on LIN-3710 (public `/kpis` trend charts) and LIN-3711 (workspace KPI page trend charts).
Checked at Harbour origin/main `8f39afd8`.

## Why

`/kpis` and each workspace KPI page want a running total of tasks finished, with history past 30 days, without an unbounded read. John, 20 Oct: "some of the cumulative charts might be better as rates rather than totals (or we can toggle between)." The two trend-chart tickets build the rate side only. This note designs the data behind the total side and the toggle.

## What is true now

- The 30-day limit is a read horizon, not storage (`lib/read-horizon.js:1-13`). Evidence stores are kept for life since LIN-3163, so old `dispatch-history` rows may exist. Rows from before LIN-3163 may already have been evicted in production. **Unverified**; only the backfill dry-run can tell us.
- An unbounded history read is the known hazard: the ~67 MB read behind the timeout (`lib/kpi-stats.js`, LIN-3002).
- `loadDispatchHistory(dispatchHistory, { since, urlKey })` is the bounded, projected read. It has a lower bound and an optional `urlKey`, and no upper bound.
- `dispatch-history` has `{ urlKey: 1 }` and `{ dispatchedBy: 1, dispatchedAt: 1 }` but no index that bounds `urlKey` plus a `dispatchedAt` range (`lib/db-indexes.js`; the hazard is described at `lib/db-indexes.js:25-28`). A workspace-scoped range read uses the `urlKey` index and applies the date range as a residual filter, so it examines every row the workspace has ever dispatched, even though the projection keeps the result small. A sort on `dispatchedAt` for one workspace is a blocking sort over its whole history. **A range read is index-bounded only once `{ urlKey: 1, dispatchedAt: 1 }` exists**; the build ticket adds it (decision 1).
- Follow-up and wake rows inherit `rootItemId` (`lib/dispatch-store.js:34`), so a lineage often gets new terminal markers days after its first one, and `status`/`statusMs` come from the **latest** terminal across all of its rows. A day's figure can therefore change after the day ends, for as long as later rows can still move the latest terminal.
- A lineage's rows span days, and an abort is harvested from the row it targets before grouping (`groupDispatchLineages`, `lib/dispatch-lineage.js`). A one-day read of rows cannot set a status alone. `status`/`statusMs` are set per lineage; `statusMs` can be null.
- The public view floors small counts (`PUBLIC_COUNT_FLOOR = 5`) and classifies every numeric leaf in `PUBLIC_LEAF_REGISTRY`; a test fails on an unclassified leaf. `lib/kpi-stats.js` is the privacy boundary: counts and app-defined labels only.
- `docs/plans/kpis-public-design.md:52` says "No new collection read".
- `HarbourCharts` (`public/chart-helpers.js`) will expose `draw`, `sparkline` and `numbersTable` after LIN-3710/3711. It has no toggle, and the public page shows no running total.
- `daily.done` is introduced by the public trend-chart ticket (LIN-3710). It is not in the code at the commit above, so this note refers to it by the rule that ticket sets (see Lineage rule), not by a line number.

## Decisions

### 1. Schema

**Decision.** A new collection `kpi-daily-rollup`, one record per workspace per UTC day: `{ urlKey, day, done, failed, aborted, dispatches }`. `day` is `YYYY-MM-DD` (UTC). The four counts are non-negative integers. Nothing else: no ids, no text, no actor.

**Reason.** Counts only keeps the collection inside the privacy boundary: it holds what the KPI pages already compute, at day grain. A running total is a prefix sum over these rows, so no other field is needed. Growth is one small row per active workspace per day.

**Indexes.** Two, each with a `reason` entry in `lib/db-indexes.js` in the build ticket:

- On `kpi-daily-rollup`: unique `{ urlKey: 1, day: 1 }`. It is the idempotence key and also serves the workspace read. The public read groups every row by `day` (decision 9), so it needs no `day` index.
- On `dispatch-history`: **`{ urlKey: 1, dispatchedAt: 1 }`**. Without it, the backfill's per-day, workspace-scoped reads (and any workspace-scoped horizon read) examine the workspace's whole history through the `urlKey` index (see What is true now). With it, every range read and the "oldest record" probe (`sort({ dispatchedAt: 1 }).limit(1)`) are index-bounded. The existing workspace KPI read (`urlKey` plus a residual `dispatchedAt` filter) benefits too, but changing it is out of scope here.

**Retention.** Kept for life, like the evidence stores; no TTL and no evictor. The 30-day figures stay on the read horizon (out of scope here).

**Field meanings.** `done`/`failed`/`aborted` count lineages whose final status is that status and whose `statusMs` falls on `day`. `dispatches` counts dispatch rows (not lineages; abort rows included) whose `dispatchedAt` falls on `day`, the same meaning as `totals.dispatches` (`windowedDispatchDocs.length` in `lib/kpi-stats.js`, which counts every history row in the window). Queue rows are not in `dispatch-history` until they are taken or expire, so the rollup's `dispatches` for today and the most recent days is provisional and settles on the hourly rewrite (decision 2).

### 2. When the job runs, and when a day is final

> **Superseded by LIN-3724 (part A build).** The job still ticks hourly but gates on a marker doc `{ _id: 'last-complete-day', through }` and scans once per UTC day. It reads `[start(first) - L, now)` with `ROLLUP_LOOKBACK_DAYS` L = 7, so follow-up rows dispatched before the day a lineage finishes are seen, and rewrites days `first..today`. Today's row is a snapshot. See `lib/kpi-daily-rollup.js`.

**Decision.** A scheduler job `kpi-daily-rollup`, registered with `scheduler.register` beside the existing jobs in `server.js`, `intervalMs` 1 hour, `leaseMs` 10 minutes. Each run makes **one** instance-wide read, exactly the one the public page makes: `loadDispatchHistory(dispatchHistory, { since: readHorizonStart(now) })`, so `[readHorizonStart(now), now)`. It partitions the rows by `urlKey`, groups each workspace's rows once with `groupDispatchLineages`, and `$set`s **every UTC day inside that horizon** for that workspace from that one grouping, through the shared function `rollupCountsByDay(rows, { from, to })` (also used by the backfill). Only whole days are written as settled values; today's row is written too but is provisional and the pages never include it in a total. **A day is final when it leaves the 30-day horizon**, not after a fixed number of hours: until then every hourly run rewrites it.

**Reason.** `status`/`statusMs` come from the latest terminal marker across a lineage's rows, and follow-up rows arrive days after the first terminal. A day's count is therefore only settled once no later row can still change it, and the only bound we have on "later rows" is the read horizon the public figures themselves use. Reading the same range with the same grouping and the same `statusMs` rule as the public `daily.done` makes the equality with it hold by construction (decision 4), and it is one bounded read per run, not one per workspace and not several. Taking the workspaces from the rows read means the job needs no workspace list, so it never runs a lifetime `distinct('urlKey')`. A workspace with no rows in the horizon gets no row, which decision 8 treats as a zero inside the rolled-up range. The scheduler's lease gives the once-per-interval guarantee across instances.

**Frozen day, not frozen at end of day.** A rule that settles day D from rows dispatched up to the end of D is wrong. A lineage that reaches `done` on D and again on D+5 would be counted on D (rows up to end(D)) and again on D+5, but the public `daily.done` counts it once, on D+5. The settle window for D must extend past D.

**Stated limits.**

- A lineage whose next terminal is recorded after day D has left the horizon is counted twice: once on D and once on the later day. D freezes at the last run with `readHorizonStart(now) ≤ start(D)`, which is about `start(D) + 30 days`, so this covers a terminal as little as about 29 days after a terminal late on D, and a follow-up row dispatched inside the window that terminates after the freeze. The public figures cannot see the earlier terminal either, so this is a limit of the horizon, not of the rollup.
- Rows dispatched before the horizon are not read, so a lineage's abort harvested from a row outside the window is missed. The public figures have the same limit; the default is to match them. The build ticket adds a characterization test for it.
- A run that falls behind (job down for days) leaves days inside the horizon at their last value; the next run corrects every day still inside it. A day that left the horizon while the job was down is repaired by the backfill over just that range, with `--from`/`--to` (decision 5).

### 3. Idempotence

**Decision.** The write is an upsert on `{ urlKey, day }` with `$set` of the four counts. It never uses `$inc`.

**Reason.** The job recomputes the whole day from source each time, so the result is a function of the source rows, not of how often it ran. A re-run, a lease overlap, two instances racing, or a backfill over days the job already wrote all converge on the same row. The unique index makes a duplicate record impossible; a concurrent upsert that loses the race retries once as an update.

### 4. Lineage rule

**Decision.** Count `done`, `failed` and `aborted` on the UTC day of the lineage's `statusMs`, the same rule as the public `daily.done`. A lineage with `statusMs === null` is **not counted** in any of the three. Because the job reads the same range and groups the same way as the public page, for any 30-day window the days written by the latest run satisfy `sum(rollup.done)` over all workspaces `= sum(daily.done)` on the public page (to within the hour since the last run).

**Reason.** One rule, one read range and one grouping for both sources is what makes the total and the trend agree. Counting on the dispatch day instead would shift counts across days. A null `statusMs` has no day to belong to, and guessing one would make the figures differ from the public page.

**History each run reads.** One instance-wide read per run over `[readHorizonStart(now), now)`, the same call the public page makes, partitioned by `urlKey` in memory. It runs once an hour and is bounded by the last 30 days of dispatch history, not its lifetime. It is not all history. (The per-day backfill reads are workspace-scoped and rely on the `{ urlKey: 1, dispatchedAt: 1 }` index, decision 5.)

**A lineage that terminates twice.** A lineage that reaches `done` on D and again on D+5 is counted **once, on D+5**, because the grouping sees both terminals and `statusMs` is the latest. While D is inside the horizon, D's row is rewritten without it. This is the case the build ticket's equality test must include.

### 5. Backfill

> **Superseded by LIN-3724 (part A build).** One query per workspace and day over `[start(D) - L, start(D) + 30d)`; the `{ urlKey: 1, dispatchedAt: 1 }` index is created by hand in the runbook (`docs/runbooks/kpi-daily-rollup-backfill.md`), not at boot, and the script exits 3 if it is missing. The backfill equals the job's last write exactly only when run at `now = start(D) + 30d`; the job's real last write for D happened about a day earlier, so the two differ only if a row of the lineage was dispatched in that final day.

**Decision.** `scripts/backfill-kpi-daily-rollup.mjs`, an operator script. `--dry-run` is the default; writing needs `--write` and is never the default. Optional `--from YYYY-MM-DD` and `--to YYYY-MM-DD` (UTC days, inclusive) limit the walk to that day range, so a repair after job downtime does not re-walk all history. `--from` defaults to each workspace's oldest record day and `--to` to the day before the job's first whole day; `--from` after `--to` is an error, and a day outside the allowed range is refused rather than clamped.

The backfill must reproduce what the job would have written when day D left the horizon. The job's last write of D is from the last run in which D is wholly inside the horizon, which reads rows dispatched in `[start(D), start(D) + 30 days)`. So the window for D **extends past D**; it does not stop at `end(D)`.

- It walks **one workspace and one day per query**, from the day of the oldest record found up to the day before the job's first whole day (days still inside the horizon are the job's, and it overwrites them anyway). It never reads all history in one query.
- For day D the query is `loadDispatchHistory(dispatchHistory, { since: start(D), until: min(start(D) + 30 days, now), urlKey })`. `until` is new: the build ticket adds an optional `until` to `loadDispatchHistory` and `dispatchHistoryPipeline`, giving `dispatchedAt: { $gte: since, $lt: until }`. With `until` absent nothing changes and the existing reads stay as they are (see Reads pin). The range is index-bounded **because** the build ticket adds `{ urlKey: 1, dispatchedAt: 1 }` (decision 1); without it this query would examine the workspace's whole history.
- It calls the same shared `rollupCountsByDay` as the job on the rows read, and keeps only day D, so the job and the script cannot differ.
- Finding the oldest record: per workspace, `find({ urlKey }, { projection: { dispatchedAt: 1 } }).sort({ dispatchedAt: 1 }).limit(1)`. This is an index-ordered single-document probe on `{ urlKey: 1, dispatchedAt: 1 }`, not a blocking sort. It must not be run until that index exists. The script prints the oldest per workspace and overall.
- The dry-run prints, per workspace and day, the row it would write, a total, and the oldest record found. It makes no write.

**Runbook step.** The operator runs the dry-run first, reads the oldest record and the planned rows, then approves the write by re-running with `--write`. Nothing in this PR runs it; the build ticket records the dry-run output as "not run" until the operator runs it against production. The operator also checks the index build has finished before the dry-run.

**Reason.** Per-day, workspace-scoped queries are cheap and memory-flat **only with the compound index**; with only the `urlKey` index they would each scan the workspace's lifetime history, which is the failure `lib/db-indexes.js:25-28` warns about. The 30-day forward window costs about 30 times the day's rows per query but stays bounded, and it is the price of settling follow-up terminals correctly. Defaulting to a dry-run makes the first run a read-only preview that also answers the unverified question of how far back history goes.

### 6. Privacy class of the public total

**Decision.** The public total is the sum across all workspaces of `rollup.done` (and the same for the other counts if later drawn). It is published as a new leaf, e.g. `outcomes.doneTotalDaily[]` and `outcomes.doneRunningTotal`, classed in `PUBLIC_LEAF_REGISTRY` as **OPEN**, the same class as `daily.done` and the other `outcomes.*` leaves: "dispatch lineages across every workspace; not tied to a person". The public view has no `urlKey` and no per-workspace figure. The per-workspace figure appears only on the workspace KPI page, which is already scoped to one workspace's members.

**Reason.** The public total is a many-lineage count across all workspaces, which is why the existing `outcomes.*` leaves are not floored; summing the same counts over a longer period does not describe a person. The registry test then fails if the leaf is missing, as it does for any other.

**`docs/plans/kpis-public-design.md:52`.** It says "No new collection read". The build ticket must update that line (the new read is the small rollup collection, not dispatch history, and still not a read of dispatch history). **This PR does not change it**, because nothing reads the new collection yet.

### 7. Labels

**Decision.** Both pages label a total "since its oldest rolled-up day", with the date, e.g. "Tasks finished since 3 Mar 2026 (its oldest rolled-up day)". Never "since launch" or "since connecting".

**Reason.** The true start of history is unknown until the dry-run reports the oldest record, and rows before LIN-3163 may be evicted. "Oldest rolled-up day" is true by construction. The start date is read from the data (`min(day)`), so the label is correct whatever the operator's backfill reached. Page strings stay in the page code (see the toggle).

### 8. Gap or zeros

**Decision (final).** A missing early period shows as a **gap**, not zeros, with a caption naming the start date ("No data before 3 Mar 2026"). Within the rolled-up range, a day with no row is a true zero (the job writes a row for each day in the horizon for every workspace that has dispatch rows in the horizon, including all-zero days among them; a workspace with no rows in the horizon gets no row, and reads as zero within the rolled-up range).

**Reason.** Zeros before the start would claim that nothing finished when we simply have no record, and would make the total look flat where it is unknown. A gap with a caption is accurate. This confirms the ticket's default.

### 9. Reads pin

**Decision.** `tests/unit/kpi-stats-reads-pin.test.js` pins every store read of `collectKpiStats`. In the build ticket:

- The existing `dispatchHistory` `aggregate` and `find` entries (the 30-day `$match` on `dispatchedAt`) **do not change**, because `until` is optional and absent from those calls. They are the proof that the public page keeps reading what it read.
- One new read is added, with an exact shape. A running total "since its oldest rolled-up day" needs every day, so there is no lower bound. On the aggregate path it is `kpiDailyRollup.aggregate([{ $group: { _id: '$day', done: { $sum: '$done' }, failed: { $sum: '$failed' }, aborted: { $sum: '$aborted' }, dispatches: { $sum: '$dispatches' } } }, { $sort: { _id: 1 } }])`: no `$match`, and no `urlKey` in the output, so no per-workspace row crosses into the privacy boundary. On the find-fallback path it is `kpiDailyRollup.find({}, { projection: { _id: 0, day: 1, done: 1, failed: 1, aborted: 1, dispatches: 1 } })` summed by day in JS (still no `urlKey`). The `NAMES` list and both snapshots gain exactly that entry on the matching path.
- The read is bounded by the collection's size, one row per workspace per day, and that growth is stated here, not hidden. If it ever matters, the follow-up is a second rollup grain (one row per day), not a lower bound that would break "since its oldest rolled-up day".
- The workspace page's read is `{ urlKey }`-scoped on the same collection; it is covered by the workspace page's own test, not this pin.

**Reason.** The pin exists to catch any unplanned change to what the page reads. The only planned change is the one new, small read, so exactly that entry is added and nothing else moves. A change to the existing dispatch-history entries would mean `until` leaked into the page reads, which the pin is there to catch.

## The rate/total toggle

**Function.** `HarbourCharts.rateTotalToggle(container, { rate, total, initial = 'rate' })`, in `public/chart-helpers.js`. (The signature is an example; the build ticket confirms it.)

- `rate` and `total` are callbacks or chart specs the caller supplies for each mode; the toggle only switches which is drawn and returns a `{ set(mode), destroy() }` handle. `destroy()` removes its listeners and its DOM, so a page re-render leaves nothing behind.
- It holds **no page strings**: button labels, the "since its oldest rolled-up day" caption and the gap caption come in from the page, so the helper stays presentation-only and the privacy boundary stays in `lib/kpi-stats.js`.
- Default is **rate**. The chosen mode may be kept in `sessionStorage` wrapped in try/catch; the chart renders correctly without it.
- A chart with no `total` renders no toggle.

**Used by.** `done-daily` on `/kpis` and "Tasks done per day" on the workspace page, with the total read from the rollup and labelled per decision 7.

**Rule lifted.** The public ticket's "no running total, no toggle" rule is lifted for these two charts only. Every other chart stays as it is.

**Cost.** `cost` stays rate-only. It has no rollup and no toggle.

**Sequencing.** The build ticket adds the toggle **in the same PR as the first real total**, not before: a toggle with no total to switch to is a dead control.

## Build ticket outline

One ticket, one PR, after the operator approves this note.

**Files.**

- `lib/kpi-daily-rollup.js` (new): pure `rollupCountsByDay(rows, { from, to })` over `groupDispatchLineages`, shared by the job and the backfill; `runKpiDailyRollup({ ... })` for the job (one instance-wide horizon read per run, partitioned by `urlKey`); the upsert.
- `lib/kpi-stats.js`: optional `until` in `loadDispatchHistory`/`dispatchHistoryPipeline`; the public rollup `aggregate` (decision 9); new public leaf and its `PUBLIC_LEAF_REGISTRY` entry.
- `lib/workspace-kpi-stats.js`: the workspace's rollup read.
- `lib/db-indexes.js`: unique `{ urlKey: 1, day: 1 }` on `kpi-daily-rollup`, and `{ urlKey: 1, dispatchedAt: 1 }` on `dispatch-history`, each with a `reason`.
- `server.js`: `scheduler.register` for `kpi-daily-rollup`.
- `scripts/backfill-kpi-daily-rollup.mjs` (new).
- `public/chart-helpers.js`: `rateTotalToggle`; the two chart modules that use it.
- `scripts/code-shape/areas.json`: a pattern for each new production file, in the same PR, checked to land in its owning area and not "Other features". Run `node scripts/code-shape/seams.mjs . <commit>` at the base and final commit and report the area-pair count both times.
- Docs: `docs/plans/kpis-public-design.md:52`; `docs/architecture/source-map.md` (module, job roster entry, collection); the backfill runbook. CLAUDE.md: nothing.

**Tests.**

- `rollupCountsByDay`: a lineage counted on its `statusMs` day; null `statusMs` not counted; an abort harvested from a row outside the day; two lineages on one day.
- **Follow-up terminal:** a lineage that reaches `done` on D and again on D+5 (a follow-up row), and one that is `failed` on D and `done` later, are each counted once, on the later day. A same-day-only seed would pass under the wrong design, so this case is required.
- Idempotence: running the job twice, and job then backfill, leave one row per `{urlKey, day}` with equal counts.
- Equality: the last 30 days of the public total equal `sum(daily.done)` on a seeded payload that includes the follow-up-terminal lineages above.
- Job window: one instance-wide horizon read per run, the same call as the public page, partitioned by `urlKey`; no `distinct` or other lifetime read.
- Registry: the new leaf is classified (the existing walk test fails without it); the public payload carries no `urlKey`.
- Reads pin: the single new entry, and unchanged existing entries.
- Backfill: default is dry-run and writes nothing; `--write` writes; `--from`/`--to` limit the walk to that inclusive day range, and `--from` after `--to` fails; the oldest record is printed; every query is bounded on both sides and its window extends past D; the backfill output for a day that left the horizon equals the job's last write for it.
- Toggle: default rate; switching; `destroy()` leaves no listeners; no toggle without `total`; cost chart has none.
- Run `npm run test:unit`; leave e2e to CI.

**Order.**

1. `until` on `loadDispatchHistory` with tests, and confirm the pin is unchanged.
2. `rollupCountsByDay` and the upsert, with the lineage (including follow-up terminal) and idempotence tests.
3. Indexes (including `{ urlKey: 1, dispatchedAt: 1 }`), then the scheduler job.
4. The backfill script, dry-run first. The operator runs the dry-run on production and approves the write; this is a human step, not run by the build.
5. The reads and the public leaf with its registry class; update the pin; update `kpis-public-design.md:52`.
6. The workspace page read.
7. `rateTotalToggle` together with the first real total on `/kpis` and the workspace page, with labels and the gap caption.
8. Docs: `source-map.md`, the runbook.

## Open questions

- Scheduler slot (hourly) is my choice; the source did not name it. A day is final when it leaves the 30-day horizon (revised after review; the earlier 48-hour settle double-counted follow-up terminals). Change the slot if the operator prefers a daily one.
- The settle window is the public horizon (30 days). A longer one would need a bigger read and is not proposed; the stated limits in decision 2 follow from it.
- The backfill window for day D is `[start(D), start(D) + 30 days)`, half-open. The source did not fix this; it reproduces the job's last write.
- Gap versus zeros: decided as a gap with a caption (decision 8); recorded here because the source left it open.
- The `rateTotalToggle` signature is an example, not a confirmed API.
- How far back production history goes is unverified; the dry-run answers it. It is a human step in the build ticket.

## Not in this PR

Any code, test or config change; cost, merge times and other charts; a TTL change; changing the 30-day horizon for existing figures; any production read or write.
