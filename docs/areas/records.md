# Records

Area notes for `records` in the registry. Format and rules: README.md.

This area is the layer's store (LIN-4493, piece 2 of 5 of LIN-4491; its pages, the checked write path and the importer are
LIN-4494, piece 3): `lib/records/` (the kinds as data, the shape
check, the views, the brief; all pure) and `lib/records-store.js` (the one file that touches the database). Its
proxy router, `routes/proxy-records.js`, stays in Agent API by the registry's first-match rule. The run lifecycle
seam, `lib/run-records.js`, stays in Runs & dispatch by its `run-` pattern.

Records imports only Platform. The tracker read, the tracker port (LIN-4503, built over a provider by
lib/records-tracker.js), the askedText reader, STAGE_KINDS, the provider state map's closed state, the workspace-person
reader and the area notes' reader are injected by their callers (routes/proxy.js, routes/proxy-records.js,
routes/task-records.js, routes/project-page.js, routes/dispatch.js, server.js).

## Lessons

- A version write is a unique-key insert, not a read-then-write: `{urlKey, id, v}` (lib/db-indexes.js) is what
  makes two writers of one version collide. MangoDB does not enforce `_id` uniqueness without an index, so a claim
  that must be atomic (a ticket's task, `records-refs`) is keyed on its own unique index, not on `_id`.
- A run record is written from the dispatch row's own id and lineage (`rootItemId`, else its own id), the same
  lineage lib/run-lineage.js reads. Every version of a run is kept: a resume or a wake reopens it as a new `open`
  version (a wake reopens the run it wakes, as a custom resume does).
- A run ends when its row stops being live: its terminal marker, an abort row's `[aborted]` (which ends the run it
  targets, `abortTo`), or a bookkeeping stamp (lineage closer, ticket closer, operator), which ends it as the lineage's
  terminal status or `aborted`. A `handed-on` closure ends nothing. Hooks: lib/dispatch-store.js (`takeItem`,
  `addFeedback`, `_closeRows`, `stampBookkeeping`), witnessed in tests/unit/lin-4493-run-lifecycle.test.js.
- A person is addressed by the name the tracker shows, stored at sign-in as `identity.name` (lib/account-session.js
  `establishAccount`) and read by lib/workspace-people.js (canonical accounts with a named identity). An account that
  signed in before the name was stored cannot be addressed until its next sign-in; the refusal names who can be. A note
  writing "John" is refused if the tracker spells it otherwise: address by `person:<accountId>` (LIN-4505).
- Reads are by the indexed fields. A write reads only the records it names (`versionsOf`, `lookup`), and a find
  picks candidates by `{urlKey, kind, state, to}` or `{urlKey, in}` and reduces each to its current version
  (`find`). A write's body is checked as a dry run before any ticket is made, so a refused body makes no task.
- The query log has no TTL index (lib/db-indexes.js bans them): rows carry `expiresAt`, and the hourly cleanup removes
  them after 90 days (lib/hourly-cleanup.js).
- A record id can have a ticket's shape (`finding-12345678`, `row-12345`). `looksLikeTicket` reads only an upper-case
  team key and a number, and a record id that exists is never read as a ticket (`checkWrite`). A new reference path
  resolves against the records first and sends only the rest to the tracker, or a valid record is refused as unreadable.
- A new collection is inventoried three times: `INVENTORY` in `lib/account-erasure.js`, `COLLECTION_CLASSES` in
  `tests/unit/urlkey-holders.test.js`, and the dry-run's `URLKEY_SOURCES` (`scripts/dry-run-urlkey-duplicates.mjs`).
  The second is the one a local run of the area's tests misses; CI's full suite caught it.

- Every writer goes through one checked pipeline, `lib/records/writes.js` (`createRecordWrites`): the proxy routes and the
  task-page and project-page routes. It checks the body, dry-runs the tickets it names, makes their
  tasks only when that is clean, then checks again. `by` is the writer's own (a stage kind, `person:<account>`,
  `import`, `harbour`), never read from a body; a new writer calls the pipeline, never the store's add, revise, end or link.
- Outward steps run after a record persists, through one injected `tracker(ctx)` port (lib/records-tracker.js),
  never on a dry run or an import. A child ticket is made only when the parent's children read whole (`capped === false`;
  unknown fails closed) and no child carries the task's mark (lib/records/ticket-stub.js); a mark another task holds is
  refused, not taken. A plan's or verdict's summary is one comment per version, never retried; `isSummaryBody` is the one mark.
- A route test that writes a child task or a plan injects a tracker (tests/helpers/fake-records-tracker.js), or it
  reaches the network and the hermetic run fails. Censuses read `git ls-files`: stage a new file before running them.
- A write that makes one record and then ends another is two writes. Name the first with `fixedIdOf` (lib/records/refs.js,
  the one derived-id rule) from the second, as make-a-task and supersede do, so a retry after a failed end finds the
  record it made. Imports use the same rule, which holds after an imported record ends. Never hash an id by hand.
- Open questions have one reader, `openQuestionsFor` (lib/open-questions.js, LIN-4532): the rulings feed, its count and
  badge, and the cards call it. Other records stay out: Home draws them
  (`createWaitingStanding` `records`) on page load only, uncounted.
- A page GET never makes a task. The task page reads its task record by the ticket's claim (`taskForTicket`) and offers
  its add and child-task forms before one exists; the first write through the checked pipeline makes the task
  (routes/task-records.js sends `in: <ticket>`). The project page's actions and the proxy make tasks the same way.
- Imported records (LIN-4505) keep `via: import` and their fixed ids: never re-import or re-id them; the importer is gone.
- A records reading has one caller per surface, and an injected alias hides a caller from a search by name: the
  session page reads evidence through `readRunEvidenceFn` (`routes/dashboard.js`), missed the store at LIN-4495, and
  every session page read "not measured". Search the aliases too, and keep a missing store reading "not measured",
  never zero, so a missed caller shows instead of passing.
- A verdict rests on the head its judge read: `heads` pins it before the refresh (`pinVerdictToHeads`). A merge
  revises the head (`recordChangeMerged`), so a PR merged after an unseen push is in `staleUrls` but not
  `movedUrls`: re-review on that.
- A task written with a ticket `ref` claims that ticket (`lib/records/writes.js`), as `ensureTask` does; else the ticket's
  references make a second task. A ticket's task id has one rule, `ticketTaskIdOf` (`lib/records/refs.js`). A revise that changes a claimed `ref` is refused (422).
- A decision's `answer` and `words` are stored as written, never trimmed. Part 3 shows a question
  only to its addressee; part 4 (lib/records/brief.js) adds the question a decision answers.
