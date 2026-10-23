# Runbook: build the deferred indexes (LIN-3811)

`lib/db-indexes.js` declares every index in two tiers.

- **boot** (the default): small and unique correctness indexes. `ensureIndexes` builds them before `app.listen` on every boot.
- **deferred**: indexes on large, lifetime-retained collections (`dispatch-history`, `proxy-events`, `foreman-status`) and the held `owner-credentials {urlKey}` (LIN-2954). Declared, never built by the server. After `listen` the server only **reports** their state. They are built by `scripts/apply-deferred-indexes.mjs` and nothing else, so merging and deploying change nothing on prod and deploy order does not matter.

There is no environment flag that builds them automatically, on purpose.

## When to run

Once after a deploy that adds deferred specs, at a quiet time, with John's recorded yes. A build reads the whole collection. The script is idempotent: it skips a spec whose key already exists (under any name), so a re-run is safe.

## Steps

1. **Read the state.** The deploy log carries one line after `listen`:

   ```
   [db-indexes] deferred: 2 built, 3 pending (dispatch-history:dispatchedAt_1_urlKey_1, ...)
   ```

   `unknown` is appended when an index list could not be read (a `listIndexes` error other than "namespace not found"). Unknown is never counted as built.

2. **Plan** (the default; writes nothing). Prints built, pending or unknown per spec:

   ```
   MONGODB_URI=<set in your shell> node scripts/apply-deferred-indexes.mjs
   ```

   This also answers whether `urlKey_1_dispatchedAt_1` is already on prod from the old backfill runbook.

3. **Apply**, all pending specs or one (`<collection>:<name>`). Each build logs its start and finish:

   ```
   MONGODB_URI=<set in your shell> node scripts/apply-deferred-indexes.mjs --apply
   MONGODB_URI=<set in your shell> node scripts/apply-deferred-indexes.mjs --apply --only dispatch-history:urlKey_1_dispatchedAt_1
   ```

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | done (plan printed, or every requested build finished or was already built) |
| 1 | a build failed, or `--plan` found an unreadable index state |
| 2 | neither `MONGODB_URI` nor `HARBOUR_DATA_DIR` is set |
| 4 | unknown `--only` |

## Not run in CI

The tests cover the script against a MangoDB tmpdir only. No prod build or `explain` was run when this landed.
