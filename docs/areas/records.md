# Records

Area notes for `records` in the registry. Format and rules: README.md.

This area is the layer's store (LIN-4493, piece 2 of 5 of LIN-4491): `lib/records/` (the kinds as data, the shape
check, the views, the brief; all pure) and `lib/records-store.js` (the one file that touches the database). Its
proxy router, `routes/proxy-records.js`, stays in Agent API by the registry's first-match rule. The run lifecycle
seam, `lib/run-records.js`, stays in Runs & dispatch by its `run-` pattern.

Records imports only Platform. The tracker read, the askedText reader, STAGE_KINDS and the workspace-person reader
are injected by their callers (routes/proxy.js, server.js).

## Lessons

- A version write is a unique-key insert, not a read-then-write: `{urlKey, id, v}` (lib/db-indexes.js) is what
  makes two writers of one version collide. MangoDB does not enforce `_id` uniqueness without an index, so a claim
  that must be atomic (a ticket's task, `records-refs`) is keyed on its own unique index, not on `_id`.
- A run record is written from the dispatch row's own id and lineage (`rootItemId`, else its own id), the same
  lineage lib/run-lineage.js reads. Every version of a run is kept: a resume reopens it as a new `open` version.
- The query log has no TTL index (lib/db-indexes.js bans them). Its rows carry `expiresAt`, and the hourly cleanup
  removes them (lib/hourly-cleanup.js). Retention is 90 days; piece 5's readings need at least that.

## Waiting

- Person addressing: `to` and `by` name `person:<accountId>`, and a person's name resolves through an injected
  workspace-person reader that does not exist yet (nothing maps a tracker assignee name to an account). Until the
  mapping is settled on LIN-4491, a name or a `person:` id is refused with the names that work, and no person is
  listed among them. Cites `lib/records/check.js` (`resolveTo`) and `routes/proxy-records.js` (the injected `listPeople`).
- A run's end is written by `lib/records-store.js` (`endRun`), called from the seam in `lib/run-records.js` on the
  dispatch store's terminal markers. A row that closes without a marker (halt sweeps, reapers, expiry) does not end
  its run yet, so its run stays open and accepts writes until a later bookkeeping seam ends it.
- The current version of each record is found by reading the workspace's versions and reducing them in code. That
  is simple and correct at this size; a `current` flag or an aggregation is the change if it grows. Cites
  `lib/records-store.js` (`snapshots`, `index`) and `lib/records/views.js`.
