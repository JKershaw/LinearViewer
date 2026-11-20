**Title:** Layer slice 2: the plan as versioned records; the prune and the copy-down go

**Repository:** JKershaw/LinearViewer (Harbour). simple-dispatcher needs no change: it forwards any `/api/proxy/*` path.

**What this is for.** A task's plan is text in its ticket description, under `## Implementation Plan`. Three things go wrong with that:
- **Down:** the breakdown copies the plan's files, approach and tests into each child. Wrong premises reached children this way in three of the 15 Nov traces.
- **Up:** the plan is never corrected where it stands. Corrections pile up beside it as comments. One copied count read 26, 25, 23, 22 and 12 across a parent's comments.
- **Lost:** at close-out the prune cuts the description back. In one trace it removed the plan that seven children pointed to.

**How it shows up today, on slice 1 itself.** LIN-4491's plan lives in its long description. The breakdown copied parts of it into each of its five children. When the plan turned out wrong in places, the corrections went in as comments on the parent. The plan text itself never changed, and the children kept their copies.

**After this slice,** the plan is records. Each piece of a plan is one plan record, addressed to the stage that works from it. A child task points at its piece and reads it in its brief; nothing is copied. A correction is a new version of that piece. Readers see the current one; earlier versions are kept, so nothing needs pruning or snapshotting.

**What slice 1 left to build on** (PRs #2464, #2465, #2467, #2468 and #2469; main at `0d56aabdf`):
- The store already holds every kind, including `plan` and the `piece` link, and the brief already has its plan part. Nothing writes a plan record yet.
- Tasks are made from tickets. Today a task's `asked` is copied from the description's sealed `## As asked` block.
- Every write goes through one checked path (`lib/records/writes.js`). A person can already add a child task on the task page.
- The brief is served at today's door, `GET /api/proxy/brief/<id>?run=`, built from records, with today's ticket section after it.

**What we want.** The design's slice 2 row is the how, read with §2 (tasks from tickets), §3 (who a plan is addressed to; the kept ticket section) and §7 (the tracker). In short:
- The design stage writes its plan as plan records. The breakdown writes each piece, addressed to implementation, and each child as a task record with its `piece`. Other stages see a piece's first paragraph and id, and read the rest with one `get`. Harbour makes the child tickets from those records.
- A correction revises the piece, with its reason. Every child's next brief shows the new version.
- A task made from a ticket takes the ticket's words as its `asked` when it is made (design §2). That is fixed once written, so no seal is needed.
- People still see the plan in the tracker, as one marked summary comment per plan version. The brief's kept ticket section skips the description's plan section.
- **Retired in the same move:**
  - the plan in the description, and every reader of it;
  - the prune, and `description/below`;
  - the copy-down;
  - the `## As asked` seal and its guard;
  - task snapshots, fully: Ship Biscuit, their only other reader, moves onto the work that got done first (LIN-4500);
  - the file-pointer pilot, which fed on plan paths.

  The design's slice table lists the code sites for each.

**Carried from slice 1 (John's ruling, 19 Nov).** The frozen Waiting-list reader (`lib/records/waiting-import.js`) was kept "only for the one-off import", with no end date. The stability scripts now use it too. Once LIN-4496's live import has run, remove the reader and the import script that uses it, and move the stability scripts onto the records store. The import (finding-4519465a on LIN-4491) is agent work: production is reachable through the Railway CLI on John's machine. If it hasn't run by the time the rest of this slice is ready, land the rest and leave this one step open.

**Not in this slice:** verdicts and changes (slice 3); rulings, and removing the brief's ticket section (slice 4); lessons (slice 5). Slice 1's follow-ups, which are agent work on LIN-4491 except the signed-in page check, which is John's: the live import and the production readings. The six re-reviewed tasks wait for John.

**Witness:** a breakdown and a correction replayed through the proxy on a temporary store. Each child reads its piece in its brief. A correction is a new version that the child's next brief shows, with the old one kept. Walk 8's stores, ported in slice 1 (`tests/fixtures/walk-8/`), hold plan records to start from.

**Readings before it lands** (reported after, never a gate):
- copied-count drift (the 15 Nov trace where one count drifted);
- brief bytes, against slice 1's readings (LIN-4491, 19 Nov) and 13–14 Nov;
- as in slice 1: records addressed to a stage or task with a held run, and how long each sat. This one needs production, and slice 1's first reading is with John (finding-8fef4f19).

**Done when**
- a plan is records: stages write and correct it there, and no stage writes a plan into a ticket description;
- a breakdown child points at its piece and reads it in its brief, with no plan text copied in, and a correction reaches it as a new version;
- nothing prunes a description, and `description/below`, the As-asked seal and guard, snapshots and the file-pointer pilot are gone;
- the frozen Waiting-list reader is gone, or, if the import hasn't run, that one step is left open;
- the replay passes through the proxy, and the readings are reported;
- Harbour still works for every route that hasn't moved yet.

**Where to read:** `docs/plans/survey/integration/design.md` and `docs/plans/survey/layer/design.md` at their commit, `claude/cool-rubin-6acj5j@92838c5cf` (the copies on main are the same).

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
