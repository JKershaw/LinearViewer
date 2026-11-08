## This piece's slice of the plan

**KPI path onto the read: S11 public** `/kpis` **cost per finished task, and S12 workspace KPIs cost per day.**

* Add the **raw-collection adapter** for the founder lookup, batched **per** `urlKey` \[N4\], because `{urlKey, rootItemId}` is the index and an `{$in}` without `urlKey` scans. The rows come from the Mongo projection in `lib/kpi-stats.js:449-460` / `loadDispatchHistory` `:488`. The workspace call is at `lib/workspace-kpi-stats.js:147`.
* **The founder lookup stays on the KPI path \[N3\]** for the issue, not the start. Time it on a seeded store, since the aggregation here has timed out before (LIN-3002). If it is too slow, restrict it to anchors whose earliest fetched member has a `followUpTo` (already projected, `kpi-stats.js:454`), proven by W2. Never fall back to the fetched window for the issue.
*
