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
- `dispatch-history` has no index on `dispatchedAt` alone (`lib/db-indexes.js`); the `urlKey` index leads. A workspace-scoped read uses it, and the date range is a residual filter. A cross-workspace day read would scan.
- A lineage's rows span days, and an abort is harvested from the row it targets before grouping (`groupDispatchLineages`, `lib/dispatch-lineage.js`). A one-day read of rows cannot set a status alone. `status`/`statusMs` are set per lineage; `statusMs` can be null.
- The public view floors small counts (`PUBLIC_COUNT_FLOOR = 5`) and classifies every numeric leaf in `PUBLIC_LEAF_REGISTRY`; a test fails on an unclassified leaf. `lib/kpi-stats.js` is the privacy boundary: counts and app-defined labels only.
- `docs/plans/kpis-public-design.md:52` says "No new collection read".
- `HarbourCharts` (`public/chart-helpers.js`) will expose `draw`, `sparkline` and `numbersTable` after LIN-3710/3711. It has no toggle, and the public page shows no running total.
- `daily.done` is introduced by the public trend-chart ticket (LIN-3710). It is not in the code at the commit above, so this note refers to it by the rule that ticket sets (see Lineage rule), not by a line number.

## Decisions

### 1. Schema

**Decision.** A new collection `kpi-daily-rollup`, one record per workspace per UTC day: `{ urlKey, day, done, failed, aborted, dispatches }`. `day` is `YYYY-MM-DD` (UTC). The four counts are non-negative integers. Nothing else: no ids, no text, no actor.

**Reason.** Counts only keeps the collection inside the privacy boundary: it holds what the KPI pages already compute, at day grain. A running total is a prefix sum over these rows, so no other field is needed. Growth is one small row per active workspace per day.

**Indexes.** Unique `{ urlKey: 1, day: 1 }` (this is the idempotence key, and also serves the workspace read). A plain `{ day: 1 }` serves the public sum across workspaces. Both get a `reason` entry in `lib/db-indexes.js` in the build ticket.

**Retention.** Kept for life, like the evidence stores; no TTL and no evictor. The 30-day figures stay on the read horizon (out of scope here).

**Field meanings.** `done`/`failed`/`aborted` count lineages whose final status is that status and whose `statusMs` falls on `day`. `dispatches` counts dispatch rows (not lineages, abort rows excluded) whose `dispatchedAt` falls on `day`, the same meaning as `totals.dispatches`.

### 2. When the job runs, and when a day is final

**Decision.** A scheduler job `kpi-daily-rollup`, registered with `scheduler.register` beside the existing jobs in `server.js`, `intervalMs` 1 hour, `leaseMs` 10 minutes. Each run recomputes **yesterday and the day before (UTC)** for every workspace, and also today as a provisional row. A day is **final** once it is more than 48 hours old, i.e. no run will ever rewrite it after that. Today's row is provisional and the pages never include it in a total.

**Reason.** A lineage's status can arrive late (an abort, or a terminal marker written after the day ends), so recomputing the last two completed days absorbs late statuses. An hourly cadence keeps the lag small and costs one bounded read per workspace per run. The scheduler's lease gives the once-per-interval guarantee across instances. Excluding the provisional day from totals means a total never changes after it is shown, except by the 48-hour settle.

**Stated limit.** A status that lands more than 48 hours after its `statusMs` day (a backdated terminal marker) is not picked up by the hourly job. The operator can re-run the backfill for that day; the upsert makes this safe.

### 3. Idempotence

**Decision.** The write is an upsert on `{ urlKey, day }` with `$set` of the four counts. It never uses `$inc`.

**Reason.** The job recomputes the whole day from source each time, so the result is a function of the source rows, not of how often it ran. A re-run, a lease overlap, two instances racing, or a backfill over days the job already wrote all converge on the same row. The unique index makes a duplicate record impossible; a concurrent upsert that loses the race retries once as an update.

### 4. Lineage rule

**Decision.** Count `done`, `failed` and `aborted` on the UTC day of the lineage's `statusMs`, the same rule as the public `daily.done`. A lineage with `statusMs === null` is **not counted** in any of the three. Therefore, for any 30-day window, `sum(rollup.done)` over all workspaces equals `sum(daily.done)` on the public page.

**Reason.** One rule for both sources is what makes the total and the trend agree; counting on the dispatch day instead would shift counts across days and break the equality. A null `statusMs` has no day to belong to, and guessing one would make the figures differ from the public page.

**History each run reads.** To settle the lineages whose `statusMs` falls on day D, the run reads that workspace's rows with `dispatchedAt` in `[start(D) − 30 days, end(D))` through `loadDispatchHistory` with the upper bound added (see Backfill), then runs `groupDispatchLineages` over them and keeps lineages with `statusMs` in D.

**Why bounded.** The window is 31 days wide and workspace-scoped, so it is the same size of read as the existing 30-day workspace KPI read, run for two days per hour. It is not all history. A lineage whose first row was dispatched more than 30 days before its status day is split by the window, so its status can still be right (terminal rows are later) but its `earliest` is not; the counts use only `status`/`statusMs`, so that does not matter. This matches the public page's own 30-day horizon, which is why the equality in the first paragraph holds.

**Open question (recorded, default kept).** If a lineage can be dispatched before the 30-day lead and still reach its terminal row on D with an abort harvested from a row outside the window, the window would miss the abort. Today's public figures have the same limit, so the default is to match them. The build ticket adds a characterization test for it.

### 5. Backfill

**Decision.** `scripts/backfill-kpi-daily-rollup.mjs`, an operator script. `--dry-run` is the default; writing needs `--write` and is never the default.

- It walks **one workspace and one day per query**, from the day of the oldest record found up to yesterday. It never reads all history in one query.
- Each query is `loadDispatchHistory(dispatchHistory, { since, until, urlKey })`, where `until` is new: the build ticket adds an optional `until` to `loadDispatchHistory` and `dispatchHistoryPipeline`, giving `dispatchedAt: { $gte: since, $lt: until }`. With `until` absent nothing changes, and the existing reads stay as they are (see Reads pin). The window for day D is `[start(D) − 30 days, end(D))`, the same as the job.
- Finding the oldest record: for each workspace, one query `find({ urlKey }).sort({ dispatchedAt: 1 }).limit(1)` with a projection of `dispatchedAt` only. It prints this per workspace and the overall oldest.
- The dry-run prints, per workspace and day, the row it would write, a total, and the oldest record found. It makes no write.
- It reuses the same pure function as the job to turn rows into the four counts, so the job and the script cannot differ.

**Runbook step.** The operator runs the dry-run first, reads the oldest record and the planned rows, then approves the write by re-running with `--write`. The script does not write without that flag. Nothing in this PR runs it; the build ticket records the dry-run output as "not run" until the operator runs it against production.

**Reason.** Day-sized, workspace-scoped queries use the `urlKey` index, keep memory flat and avoid the timeout hazard. Defaulting to a dry-run makes the first run a read-only preview that also answers the unverified question of how far back history goes.

### 6. Privacy class of the public total

**Decision.** The public total is the sum across all workspaces of `rollup.done` (and the same for the other counts if later drawn). It is published as a new leaf, e.g. `outcomes.doneTotalDaily[]` and `outcomes.doneRunningTotal`, classed in `PUBLIC_LEAF_REGISTRY` as **OPEN**, the same class as `daily.done` and the other `outcomes.*` leaves: "dispatch lineages across every workspace; not tied to a person". The public view has no `urlKey` and no per-workspace figure. The per-workspace figure appears only on the workspace KPI page, which is already scoped to one workspace's members.

**Reason.** The public total is a many-lineage count across all workspaces, which is why the existing `outcomes.*` leaves are not floored; summing the same counts over a longer period does not describe a person. The registry test then fails if the leaf is missing, as it does for any other.

**`docs/plans/kpis-public-design.md:52`.** It says "No new collection read". The build ticket must update that line (the new read is the small rollup collection, not dispatch history, and still not a read of dispatch history). **This PR does not change it**, because nothing reads the new collection yet.

### 7. Labels

**Decision.** Both pages label a total "since its oldest rolled-up day", with the date, e.g. "Tasks finished since 3 Mar 2026 (its oldest rolled-up day)". Never "since launch" or "since connecting".

**Reason.** The true start of history is unknown until the dry-run reports the oldest record, and rows before LIN-3163 may be evicted. "Oldest rolled-up day" is true by construction. The start date is read from the data (`min(day)`), so the label is correct whatever the operator's backfill reached. Page strings stay in the page code (see the toggle).

### 8. Gap or zeros

**Decision (final).** A missing early period shows as a **gap**, not zeros, with a caption naming the start date ("No data before 3 Mar 2026"). Within the rolled-up range, a day with no row is a true zero (the job writes a row for each workspace day it computed, including all-zero days for workspaces that existed).

**Reason.** Zeros before the start would claim that nothing finished when we simply have no record, and would make the total look flat where it is unknown. A gap with a caption is accurate. This confirms the ticket's default.

### 9. Reads pin

**Decision.** `tests/unit/kpi-stats-reads-pin.test.js` pins every store read of `collectKpiStats`. In the build ticket:

- The existing `dispatchHistory` `aggregate` and `find` entries (the 30-day `$match` on `dispatchedAt`) **do not change**, because `until` is optional and absent from those calls. They are the proof that the public page keeps reading what it read.
- One new read is added: the rollup collection, a bounded `find` on `{ day: { $gte: ... } }` with a projection of `{ day, done, failed, aborted, dispatches }` (no `urlKey` in the public read). The `NAMES` list and both snapshots (aggregate path and find fallback path) gain that entry.
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

- `lib/kpi-daily-rollup.js` (new): pure `rollupCounts(rows, day)` over `groupDispatchLineages`; `runKpiDailyRollup({ ... })` for the job; the upsert.
- `lib/kpi-stats.js`: optional `until` in `loadDispatchHistory`/`dispatchHistoryPipeline`; rollup read; new public leaf and its `PUBLIC_LEAF_REGISTRY` entry.
- `lib/workspace-kpi-stats.js`: the workspace's rollup read.
- `lib/db-indexes.js`: the two indexes, each with a `reason`.
- `server.js`: `scheduler.register` for `kpi-daily-rollup`.
- `scripts/backfill-kpi-daily-rollup.mjs` (new).
- `public/chart-helpers.js`: `rateTotalToggle`; the two chart modules that use it.
- `scripts/code-shape/areas.json`: a pattern for each new production file, in the same PR, checked to land in its owning area and not "Other features". Run `node scripts/code-shape/seams.mjs . <commit>` at the base and final commit and report the area-pair count both times.
- Docs: `docs/plans/kpis-public-design.md:52`; `docs/architecture/source-map.md` (module, job roster entry, collection); the backfill runbook. CLAUDE.md: nothing.

**Tests.**

- `rollupCounts`: a lineage counted on its `statusMs` day; null `statusMs` not counted; an abort harvested from a row outside the day; two lineages on one day.
- Idempotence: running the job twice, and job then backfill, leave one row per `{urlKey, day}` with equal counts.
- Equality: the last 30 days of the public total equal `sum(daily.done)` on a seeded payload.
- Registry: the new leaf is classified (the existing walk test fails without it); the public payload carries no `urlKey`.
- Reads pin: the single new entry, and unchanged existing entries.
- Backfill: default is dry-run and writes nothing; `--write` writes; the oldest record is printed; every query is bounded on both sides.
- Toggle: default rate; switching; `destroy()` leaves no listeners; no toggle without `total`; cost chart has none.
- Run `npm run test:unit`; leave e2e to CI.

**Order.**

1. `until` on `loadDispatchHistory` with tests, and confirm the pin is unchanged.
2. `rollupCounts` and the upsert, with the lineage and idempotence tests.
3. Indexes, then the scheduler job.
4. The backfill script, dry-run first. The operator runs the dry-run on production and approves the write; this is a human step, not run by the build.
5. The reads and the public leaf with its registry class; update the pin; update `kpis-public-design.md:52`.
6. The workspace page read.
7. `rateTotalToggle` together with the first real total on `/kpis` and the workspace page, with labels and the gap caption.
8. Docs: `source-map.md`, the runbook.

## Open questions

- Scheduler slot (hourly) and the 48-hour settle are my choices; the source did not name them. Change them if the operator prefers a daily slot.
- The 30-day lead for settling a lineage matches the public horizon; a longer lead would need a bigger read and is not proposed.
- The `until` bound is `dispatchedAt < end(D)` (a day-end, half-open bound). The source did not fix this; it is the simplest two-sided range.
- The `rateTotalToggle` signature is an example, not a confirmed API.
- How far back production history goes is unverified; the dry-run answers it.

## Not in this PR

Any code, test or config change; cost, merge times and other charts; a TTL change; changing the 30-day horizon for existing figures; any production read or write.
