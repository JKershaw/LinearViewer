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
  lineage lib/run-lineage.js reads. Every version of a run is kept: a resume or a wake reopens it as a new `open`
  version (a wake reopens the run it wakes, as a custom resume does: LIN-4493 review, gap 3).
- A run ends when its row stops being live: its terminal marker; an abort row's `[aborted]`, which ends the run of
  the row it targets (`abortTo`), since the target never receives that marker as its own feedback; or its closure
  by a bookkeeping stamp (the lineage closer, the ticket closer, an operator's stamp), which ends it as the
  lineage's terminal status or `aborted`. A `handed-on` closure ends nothing: the successor carries the run on.
  The hooks are in lib/dispatch-store.js (`takeItem`, `addFeedback`, `_closeRows`, `stampBookkeeping`), and each
  is witnessed through the real store in tests/unit/lin-4493-run-lifecycle.test.js.
- Reads are by the indexed fields. A write reads only the records it names (`versionsOf`, `lookup`), and a find
  picks candidates by `{urlKey, kind, state, to}` or `{urlKey, in}` and reduces each to its current version
  (`find`). A write's body is checked as a dry run before any ticket is made, so a refused body makes no task.
- The query log has no TTL index (lib/db-indexes.js bans them). Its rows carry `expiresAt`, and the hourly cleanup
  removes them (lib/hourly-cleanup.js). Retention is 90 days; piece 5's readings need at least that.
- A record id can have a ticket's shape (`finding-12345678` when its hex is all digits; a run id such as `row-12345`). A
  ticket identifier is an upper-case team key and a number, so `looksLikeTicket` reads only that shape; a record id that
  exists is never read as a ticket either (`checkWrite`).
  `routes/proxy-records.js` resolves a reference against the records first and sends only the rest to the tracker; a
  new reference path must do the same, or a valid record is refused as an unreadable ticket.
- A new collection is inventoried three times: `INVENTORY` in `lib/account-erasure.js`, `COLLECTION_CLASSES` in
  `tests/unit/urlkey-holders.test.js`, and the dry-run's `URLKEY_SOURCES` (`scripts/dry-run-urlkey-duplicates.mjs`).
  The second is the one a local run of the area's tests misses; CI's full suite caught it.

## Waiting

- Person addressing: `to` and `by` name `person:<accountId>`, and a person's name resolves through an injected
  workspace-person reader that does not exist yet (nothing maps a tracker assignee name to an account). Until the
  mapping is settled on LIN-4491, a name or a `person:` id is refused with the names that work, and no person is
  listed among them. Cites `lib/records/check.js` (`resolveTo`) and `routes/proxy-records.js` (the injected `listPeople`).
- The brief still reads the workspace's whole history (`snapshots`, `index`, `currentAt`) to compose its parts. It is
  pure and correct at this size, and piece 4 wires it behind the brief route; the change then is to read the parts
  through `find` and `lookup`. Cites `lib/records-store.js` and `lib/records/brief.js`.
