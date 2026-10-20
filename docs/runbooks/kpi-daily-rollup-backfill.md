# Runbook: backfill the KPI daily rollup (LIN-3724)

The daily job (`kpi-daily-rollup`, `lib/kpi-daily-rollup.js`) rewrites only the
days still inside the 30-day read horizon. This backfill writes the days that
have already left it. **Run it only with John's approval.** Nothing in the PR
that added this runbook was run against production.

The script is `scripts/backfill-kpi-daily-rollup.mjs`, a thin CLI over
`runBackfill`. It is a dry run unless `--write` is given.

## Steps

1. **Create the history index** (with John's approval; not built at boot because boot awaits every index and this one covers all of `dispatch-history`):

   ```js
   db['dispatch-history'].createIndex({ urlKey: 1, dispatchedAt: 1 })
   ```

   Without it the script exits 3 (`index missing: see runbook`) before reading anything.

2. **Plan only.** Prints the workspaces, each one's oldest day and the query count, then stops:

   ```
   MONGODB_URI=<set in your shell> node scripts/backfill-kpi-daily-rollup.mjs --plan-only
   ```

3. **Dry run.** One query per workspace and day on the wider audit window; writes nothing. Prints rows per workspace, oldest day, days flagged "short lookback" and the loss figure:

   ```
   MONGODB_URI=<set in your shell> node scripts/backfill-kpi-daily-rollup.mjs
   ```

4. **Write**, over a day range (UTC, inclusive):

   ```
   MONGODB_URI=<set in your shell> node scripts/backfill-kpi-daily-rollup.mjs --write --from YYYY-MM-DD --to YYYY-MM-DD
   ```

   `--from`/`--to` must lie between the oldest workspace's oldest day + 1 and the day before the first in-horizon day; otherwise the script refuses (exit 4). A re-run rewrites the same rows.

## What to read in the output

- **Oldest day**: skipped, named "possibly partial" (its lineages may have started before the data does).
- **Short lookback**: days within `ROLLUP_LOOKBACK_DAYS` (7) of a workspace's oldest day; their read window starts before the data does.
- **Loss figure**: lineages counted differently under the 7-day lookback and the 30-day audit lookback. It is a **lower bound**: losses older than the audit lookback are not seen. Revisit `ROLLUP_LOOKBACK_DAYS` against it.
- A backfill for day D equals the job's last write exactly only when run at `now = start(D) + 30d`. The job's real last write for D was about a day earlier, so the two differ only if a row of the lineage was dispatched in that last day.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done |
| 1 | Failed (error class only is printed) |
| 2 | Neither `MONGODB_URI` nor `HARBOUR_DATA_DIR` is set |
| 3 | The `{ urlKey: 1, dispatchedAt: 1 }` index is missing |
| 4 | `--from`/`--to` refused (not a day, out of range, or `from` after `to`) |
