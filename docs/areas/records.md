# Records

Area notes for `records` in the registry. Format and rules: README.md.

This area is the layer's store (LIN-4493, piece 2 of 5 of LIN-4491; its pages, the checked write path and the importer are
LIN-4494, piece 3): `lib/records/` (the kinds as data, the shape
check, the views, the brief; all pure) and `lib/records-store.js` (the one file that touches the database). Its
proxy router, `routes/proxy-records.js`, stays in Agent API by the registry's first-match rule. The run lifecycle
seam, `lib/run-records.js`, stays in Runs & dispatch by its `run-` pattern.

Records imports only Platform. The tracker read, the askedText reader, STAGE_KINDS, the provider state map's closed
state, the workspace-person reader and the area notes' reader are injected by their callers (routes/proxy.js,
routes/proxy-records.js, routes/task-records.js, routes/project-page.js, server.js, scripts/records-import.mjs).

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
- A person is addressed by the name the tracker shows them, and that name is stored on the account's identity at sign-in
  (`identity.name`, from the viewer's display name, the GitHub login, or the Jira display name; lib/account-session.js
  `establishAccount`). The one reader is lib/workspace-people.js (a member with a named identity on the workspace's
  provider, canonical accounts only). An account that signed in before the name was stored has none until its next
  sign-in, so it cannot be addressed until then; the refusal names the people who can be.
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

- Every writer goes through one checked pipeline, `lib/records/writes.js` (`createRecordWrites`): the proxy routes, the
  signed-in task-page and project-page routes, and the importer. It checks the body, dry-runs the tickets it names, makes
  their tasks only when that is clean, then checks again. A writer passes `by` (its own: a stage kind, `person:<account>`,
  `import`); `by` is never read from a body. A new writer calls the pipeline, never the store's add, revise, end or link directly.
- A write that makes one record and then ends another is two writes. Name the first with `fixedIdOf` (lib/records/refs.js,
  the one derived-id rule) from the second, as make-a-task and supersede do, so a retry after a failed end finds the
  record it made. Imports use the same rule, which holds after an imported record ends. Never hash an id by hand.
- Records stay outside `ruling.rows`. Home's Waiting on you draws the person's records beside the rulings
  (`createWaitingStanding` returns `records`); the count, the badge and the live merge keep reading rulings only.
- Addressing a person needs the account id or the name the tracker shows, and a name read from the tracker often differs
  from how a note writes it. A manifest or note that writes "John" will be refused with the names that work; the
  parked-ticket manifest addresses John as `project` with "For John:" in the words, and says so in its notes.
- A page GET never makes a task. The task page reads its task record by the ticket's claim (`taskForTicket`) and offers
  its add and child-task forms before one exists; the first write through the checked pipeline makes the task
  (routes/task-records.js sends `in: <ticket>`). The project page's actions and the proxy make tasks the same way.
- The importer reads the notes from a git ref given on the command line (never a default: piece 4 deletes the sections),
  and its tests read committed fixtures, since CI checks out at depth 1 (tests/fixtures/records-import/). It reads each
  note with the guard's own reader (`parseNote`, `citedPaths` from lib/prompts/area-note-format.js, injected), so an
  entry the guard counts is an entry the import writes.
