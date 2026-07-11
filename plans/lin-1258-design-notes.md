# LIN-1258 — Bounded feed hydration for touched-task `done` (Axis B)

Branch: `lin-1258-bounded-feed-hydration`  •  Base HEAD: `30f6e200ca831a5ebfef6ee4dc51a236c59cb54d`  •  main tip: `30f6e20`

## Root cause — CONFIRMED at HEAD (no correction)

`git log --since=<ticket createdAt 2026-07-11T16:14:19.151Z> -- routes/dashboard.js public/observation.js lib/observation-sessions-store.js lib/pipeline-loops.js` → **empty**. None of the named surfaces changed since the ticket was written, so the ticket's line refs still hold.

Verified in my own tree:
- `buildSessionPayload` (`routes/dashboard.js:468`) calls `deriveSessionStatus({ terminal, stale, hasError, waiting })` at **L506–511** — `taskDone` is omitted, so it defaults `false`. The comment at L501–505 states the no-Linear cost contract explicitly. → feed always emits `taskDone=false`.
- `deriveSessionStatus` (`routes/dashboard.js:225`): `if (terminal) return hasError ? (taskDone ? 'done-with-warning' : 'error') : 'done'` (L227). **`taskDone` only changes the outcome when `terminal && hasError`.**
- Hydration is drill-in-only: client `ensureHydration` (`public/observation.js:899`) iterates `s.tasksTouched`, guarded by the one-way `hydrationFetched` Set (L905–906) — **never re-fetched** within the page session. It hits `GET /api/dashboard/hydrate/:wsUrlKey/:identifier` (`routes/dashboard.js:1353`) which uses `fetchIssueContext` and reports Done via `issue.state.type === 'completed'`.
- `done-with-warning` is currently **client-owned**: `warnedSessions` Set (L84), populated at L917 when `s.terminal && s.status === 'error' && isDoneState(data.state)`; `displayStatus` (L156) re-derives `error → done-with-warning` from it. `isDoneState` = `state.type === 'completed'` (L148).
- `tasksTouched` (`lib/pipeline-loops.js:525–530`): distinct issue identifiers, **seed first**, then first-seen order.

**Conclusion:** the feed always sends `taskDone=false`; touched-task done-state is hydrated only on drill-in and never re-fetched. Collapsed/feed card can never show `done-with-warning`, and a later Linear change is never picked up. Root cause held — no correction.

## Design decisions

### Eligibility gate — `terminal === true && hasError === true`
Tighter than the ticket's "terminal, non-done". Rationale from `deriveSessionStatus` L227: `taskDone` is consulted **only** on the `terminal && hasError` branch. A terminal non-error session is already `done` (hydrating it changes nothing); a non-terminal session never consults `taskDone`. So the exact set where a real `taskDone` can flip the outcome is the errored-terminal sessions (pre-hydration `status === 'error'`). Gating on that is both minimal and the natural cost bound.

### Cap N = 5 eligible sessions per poll
Bounds Linear reads to ≤5/poll regardless of feed size. `done-with-warning`-eligible (terminal+error) sessions are rare on a normal feed, so 5 covers the visible collapsed error cards in one poll. At the ~5s cadence that is ≤~60 reads/min worst case — an order of magnitude under the 60/min proxy budget, and far lower in steady state because of the TTL cache. **Cache-misses are prioritized within the cap**, so each poll makes progress; a backlog of >5 errored sessions fills progressively over subsequent polls (acceptable — these are terminal, not time-critical). This progressive fill is a deliberate, logged bound (no silent truncation).

### Per-session read scope — seed task only (`tasksTouched[0]`)
One Linear read per eligible session, against the seed task (seed-first per pipeline-loops L528). Keeps the N bound meaning "N sessions" not "N×tasks". Matching the client's any-touched-task OR semantic (L903/917) across *all* touched tasks is a noted possible follow-up, not V1.

### TTL cache — 60s, keyed by `${wsUrlKey}::${identifier}`
In-process TTL cache (mirrors `lib/sessions-feed-cache.js` shape) storing the resolved touched-task done-state per task id. Sits **under** the existing sessions-feed output cache (LIN-617): when the feed cache refreshes and re-runs `mergeSessions`, eligible tasks are served from this task cache instead of re-reading Linear every ~5s. TTL 60s ⇒ ≤1 real Linear read per eligible task per minute (12× reduction vs per-poll), while a newly-Done task surfaces on the collapsed card within ≤60s. Done is sticky (a Done task stays Done), so 60s freshness is ample. **This is how the no-Linear-per-poll cost contract is respected.**

### `done-with-warning` ownership — SERVER-side (single source of truth)
Feed a real `taskDone` (seed task's done-state, from the TTL cache) into the existing `deriveSessionStatus` param inside `buildSessionPayload`, so the server emits `status: 'done-with-warning'` directly on the feed. `deriveSessionStatus` stays the **one** place the `terminal && hasError && taskDone` rule is computed — signature unchanged (`taskDone` param already exists), so this does **not** create a double source.

Client reconciliation (no duplication):
- `displayStatus` already passes a server `done-with-warning` through unchanged (it only *upgrades* `error→done-with-warning`, never rewrites `done-with-warning`). So a server-owned upgrade renders correctly with no client change.
- The drill-in `warnedSessions` path self-defers: its guard is `s.status === 'error'` (L917) and `displayStatus`'s is also `s.status === 'error'` (L157). Once the server sends `done-with-warning`, `s.status` is no longer `'error'`, so neither client path re-runs the rule. The client upgrade therefore survives **only** as a residual fallback for sessions the bounded hydration didn't reach this poll (cap overflow / hydration unavailable). No double count, no re-derivation of the rule client-side for hydrated sessions.

### Implementation shape (for the build beat — NOT done yet)
`buildSessionPayload` is sync/pure today. Plan: `mergeSessions` (async) does the bounded hydration around the build —
1. build/inspect sessions, select eligible (`terminal && hasError`), cap at N (cache-miss first);
2. `await` `fetchIssueContext(token, seedTask)` for the selected, via the 60s task-TTL cache (`getWorkspaceAccessToken` + `fetchIssueContext` are already injected deps at `routes/dashboard.js:397`);
3. pass the resolved `taskDone` into `buildSessionPayload` (new optional `taskDone`/lookup arg; default false keeps every other call site byte-identical), which forwards it to `deriveSessionStatus`.
Keeps `deriveSessionStatus` and `buildSessionPayload`'s purity intact; the only new async is in `mergeSessions`, which is already async.

### Axis independence vs LIN-1257 / Axis A — CONFIRMED
- `deriveSessionStatus` is the one shared join; I consume its **existing** `taskDone` param and do **not** change its signature or logic.
- No Axis A (session-state freshness) code path is touched; no shared mutable state is introduced (the task-TTL cache is new and Axis-B-only).
- No ordering dependency: the change works whether or not LIN-1257 ships. → axis-independent.

## Beat status
GROUND & DESIGN complete. No code fix written, no PR, not Done. Next beat: implement per the shape above + tests.
