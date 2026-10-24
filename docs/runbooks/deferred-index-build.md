# Runbook: build the deferred indexes (LIN-3811)

`lib/db-indexes.js` declares every index in two tiers.

- **boot** (the default): small and unique correctness indexes. `ensureIndexes` builds them before `app.listen` on every boot.
- **deferred**: indexes on large, lifetime-retained collections (`dispatch-history`, `proxy-events`, `foreman-status`) and `owner-credentials {urlKey}`. Declared, not built at boot, so a build never holds a deploy. After `listen` the server **reports** their state and, once, 60 s later, **builds** any still-pending one in the background (`scheduleDeferredIndexBuild`, LIN-3865, reusing the script's `applyDeferredIndexes`). It is not awaited, so neither boot nor `/health` waits; a failure is logged and retried on the next boot, never looped; graceful shutdown cancels a build that has not started. `scripts/apply-deferred-indexes.mjs` remains as the manual tool.

There is no environment flag to turn the server build on or off, on purpose. LIN-3865 supersedes LIN-3811's script-only rule on John's 24 Oct words (agents create the indexes, no separate sign-off); the `owner-credentials` hold (LIN-2954) no longer applies.

## When to run

Normally never by hand: the server builds a newly declared deferred spec after the deploy that adds it. Run the script to build or check without waiting for a deploy (it is how the first production build was run), or when the server's build failed. A build reads the whole collection, online on MongoDB 8. The script is idempotent: it skips a spec whose key already exists (under any name), so a re-run is safe.

## Steps

1. **Read the state.** The deploy log carries one line after `listen`:

   ```
   [db-indexes] deferred: 2 built, 3 pending (dispatch-history:dispatchedAt_1_urlKey_1, ...)
   ```

   `unknown` is appended when an index list could not be read (a `listIndexes` error other than "namespace not found"). Unknown is never counted as built.

   On production, run the script from the app service over `railway ssh -p <project> -e production -s harbour-cat -- '<one single-quoted command>'`, so `MONGODB_URI` expands remotely (see `docs/operator-execution.md`; never `env` or `railway variables`).

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

The tests cover the script against a MangoDB tmpdir only. No `explain` was run. The first prod build was run by hand with this script over `railway ssh` (LIN-3865); the server's own build is covered by unit tests against MangoDB only.
