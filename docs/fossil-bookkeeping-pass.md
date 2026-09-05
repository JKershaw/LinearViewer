# Retiring fossil dispatch rows (the fossil bookkeeping pass)

The operator command behind **LIN-2633**: `scripts/fossil-pass-lin2633.js`. It retires
ancient silent and blocked dispatch history rows so the observer census stops
reporting them as if they were alive.

This is a **ruling-gated, dry-run-first** command. It is not a route, not
autopilot-reachable, and has no import site in the app — an operator runs it by hand,
against a database an ordinary agent session cannot reach.

## What problem it solves

313 loops silent since as far back as 2026-08-01 sat in the census as if alive
(LIN-2114 comment `a3a7b02e`). LIN-2619 stopped them dominating the attention list by
ranking and collapsing them into a count; this pass **retires** them, so "nothing looks
dead" becomes a true sentence and the observer starts from a clean fleet.

## What it writes, and what it deliberately does not

It writes exactly one field, on the history row, via one narrow store method
(`DispatchQueueStore.stampBookkeeping`):

```
bookkeeping: { at: <Date>, by: <operator label|null>, reason: 'fossil-pass-lin2633' }
```

**`status` is never touched.** Twelve readers key on a history row's `status`, and the
rejected first draft — reusing `status: 'expired'` — would have been a *two-sided*
reclassification: `'expired'` sits in `NO_ATTEMPT_STATUSES` but not `IN_FLIGHT_STATUSES`
(`lib/plan-review-round-trips.js:152` / `:159`), so every stamped row would have flipped
from in-flight to no-attempt in the LIN-1963 instrument. A stamped row keeps
`status: 'taken'` and stays right-censored exactly as before — pinned by the
pinned-reader tests in `tests/unit/plan-review-round-trips.test.js`,
`tests/unit/pipeline-loops.test.js` and `tests/unit/periodical-runs.test.js`.

The one surface whose behaviour changes is `classifyLoop`
(`lib/observer-sweep.js`): a stamped row classifies `resolved`, the same lane an
operator-cancelled row lands in. It therefore leaves the `silent`/`blocked` gate,
drops out of the census attention list, and increments `lanes.resolved`.

The stamp **is** the audit entry — there is no separate audit array (a second array
would have the same zero-reader problem `trimHistory` already has).

## The exact criterion

A row is eligible only if **every** one of these holds. They are ANDed, never ORed, so
each can only shrink the eligible set:

1. It is a `taken` **history** row — never a live/queued row, and never a
   `cancelled`/`expired` one (those are already resolved).
2. It is **not already stamped**. The pass is idempotent; the store's own filter
   (`{ bookkeeping: null }`) re-enforces this at the write, so a second run is a no-op
   even against a concurrently-changing corpus.
3. It is **not terminal** — no `[done]`/`[failed]`/`[aborted]`/`[skipped]` marker, via
   the same `deriveTerminalStatus` derivation `foldPeriodicalRuns` uses.
4. `classifyLoop` puts it in the **`silent` or `blocked`** lane.
5. It is **not superseded** — no other loop names it via `followUpTo`. This is an
   explicit check: a superseded row classifies `silent`, *not* `unknown`
   (`tests/unit/observer-sweep.test.js:341`), so `classifyLoop` does not exclude it.
6. **Age gate:** `now - loopLastActivityMs(loop) > FOSSIL_AGE_MS` (7 days, strict `>`).
   This is the *identical function, record and comparison* the census itself gates on
   (`buildSweepPayload`), so agreement with the census is an identity rather than a
   coincidence at a shared constant. `FOSSIL_AGE_MS` is imported from
   `lib/observer-sweep.js`, never redefined.
7. **Independent second age gate:** `now - ownRawLastActivityMs(loop) > FOSSIL_AGE_MS`
   over the row's **own raw `feedback[]`, any kind, unfiltered**. This exists because
   `loopLastActivityMs`'s telemetry and lineage components are heartbeat-filtered
   (`parseHeartbeats` skips `kind: 'decision'`), so a row whose most recent activity is
   `[blocked]`, a decision entry or an `[evidence]` line contributes *nothing* to gate 6
   and would look ancient to it. `blocked` is roughly half the target population and a
   blocked row's defining feedback is exactly such a marker, so this is not a corner case.
8. **No live queue sibling** shares its `sessionGroupId` — belt-and-suspenders for the
   historical paths that do not set `followUpTo` reliably. A row whose own
   `sessionGroupId` is null matches no sibling (nullness is not a wildcard).

**Eligibility requires proof of silence.** The selection asks "can I prove this row is
silent?", never "did I fail to find evidence it is alive?" — the second phrasing degrades
to "stamp everything" the moment a read fails. So a row whose activity cannot be
established as a finite instant, or one carrying an unparseable timestamp, is treated as
**live** and left alone; and a workspace whose read rejects stamps **nothing** for that
workspace while the others still proceed.

## Running it

```bash
# DRY RUN — the default. Reads, reports, writes nothing.
node scripts/fossil-pass-lin2633.js

# The write pass. Only on John's own recorded yes (see the gate below).
node scripts/fossil-pass-lin2633.js --execute --by "<operator label>"
```

It uses the same `MONGODB_URI` / `HARBOUR_DATA_DIR` convention as `server.js`, and the
same `import.meta.url` guard as `scripts/repair-account-merge-lin2233.js`, so importing
the module has no side effect — no database connection, no write. The report goes to
**stdout** and progress logging to **stderr**, so `> report.md` captures just the report.

**It needs production database access that an ordinary agent session does not have.**
`MONGODB_URI` is absent from this repo's `.env`, which is exactly why the work is split:
LIN-2653 built and tested the command (writing no production data), LIN-2654 is the
operator-run production dry run, and LIN-2655 is the authorized write pass.
`scripts/scan-mis-mirrored-workspaces-lin1981.js` is the standing precedent for a merged
operator script that has never been run for the same reason.

## The gate — read this before `--execute`

The write pass runs **only** on John's own recorded yes, relayed by the runner. The
sequence is fixed:

1. Run the dry run. Post its report on LIN-2654.
2. Park BLOCKED with a `DECISION` block whose single question is
   "run the pass as reported: yes / no".
3. Only on John's own recorded yes, run `--execute`. Then verify the census.

A later approval is **not** retroactive authorization for an earlier run, and dry-run
access is not authorization to write. If the dry run would stamp any live or terminal
row, stop and report — that is the wind-down trigger, not something to work around.

## Reading the report

The report is paste-ready. It reconciles by construction: would-stamp plus
would-not-touch equals loops examined, and the bucket and lane columns each sum to the
would-stamp total.

* **By age bucket**, on `now - loopLastActivityMs`: `7-10d`, `10-14d`, `14-21d`,
  `21-30d`, `>30d`.
  **`>30d` should be empty.** The history TTL (`historyTtl`, 30 days) and the loop
  lookback (`LOOKBACK_MS`, 30 days) both bound the readable band, so a row older than
  that is already pruned or already outside the read. A non-empty `>30d` bucket is a
  **finding about one of those two bounds** — the report flags it inline — not a set of
  rows to stamp. Investigate before proceeding.
  For the same reason, expect **fewer than 313**: the census's "silent since 2026-08-01"
  rows were 35 days old as of 2026-09-05 and are already pruned.
* **By lane**: `silent` / `blocked`, from `classifyLoop` before the bookkeeping branch.
* **Would not touch**, itemised by *which* gate rejected each row: `not-taken`,
  `already-stamped`, `terminal`, `not-silent-or-blocked`, `superseded-by-follow-up`,
  `lineage-alive`, `own-row-recent-activity`, `live-session-group-sibling`,
  `inconclusive-activity`. Each row carries exactly one reason, so the counts partition
  the corpus. Every reason has a one-line legend in the report itself.
* The exact criterion applied, the HEAD sha, and any workspace whose read failed.

The itemised rejection reasons are the point of the dry run: they are what lets an
operator sanity-check the pass against the real corpus, which no fixture can substitute
for. In particular, a named residual is worth looking for — a sibling that is actively
running but has atypically posted no heartbeat *and* has no `sessionGroupId`-linked queue
entry is not independently guarded beyond gates 7 and 8.

## Where the stamp is visible afterwards

* `classifyLoop` / the census (`lib/observer-sweep.js`) — the stamped row moves to
  `lanes.resolved` and leaves the attention list.
* The Loop record (`lib/pipeline-loops.js`) and every history read through
  `_formatHistoryItem` — `listHistory`, `getItemStatus`.
* `GET /workspace/:urlKey/api/dispatch/history` (session auth) returns `listHistory`
  wholesale, so it carries the field.

It is **not** exposed on the consumer proxy surfaces: `GET /api/proxy/dispatch` and
`GET /api/proxy/dispatch/{id}` each build their response from an explicit field
allowlist that does not include `bookkeeping`. That absence is deliberate — nothing in
the agent-facing contract needs the stamp, and adding it would widen a wire contract for
no consumer. See the note in `docs/proxy-integration.md`.
