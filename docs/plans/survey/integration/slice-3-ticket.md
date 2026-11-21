**Title:** Layer slice 3: verdicts and changes as records; guessing verdicts from comments goes

**Repository:** JKershaw/LinearViewer (Harbour). simple-dispatcher needs no change: it forwards any `/api/proxy/*` path.

**What this is for.** A review's verdict is a comment today. Harbour finds it by guessing:
- **Which comment:** 15 places read comments to work out which one is a verdict, through three separate parsers (census C3).
- **Which commit:** `findSha` pulls it from the comment's prose: the first sha labelled as the head, or else any hex string.
- **What came after:** nothing records that the work moved on, so a push no judge saw can merge as approved.

**How it shows up today, on slice 2 itself.** The close-outs on LIN-4502, LIN-4504 and LIN-4505 all made commits after the review approved, and nobody re-read them. LIN-4499's close-out says it plainly in its own comment: "nobody reviews these after the approval". Its blind read read PR #2478 at `9c7aac662`. Close-out then pushed `558ed3f18` and merged that.

**After this slice,** verdicts and changes are records. A change record holds a PR and its head, and each new head is a new version. A verdict is `on` the version its judge read. When a later push moves the change on, the verdict shows as stale wherever it is read, including after close-out's own commits. Close-out, the selector and the pages read the records, not the comments.

**What slice 2 left to build on** (main at `bc0535b5c`):
- Runs carry their task (0 of 21 since 20 Nov 15:09 had none). Plans are records, with one marked summary comment per plan version.
- The store already knows `verdict` and `change`: their fields, the outcome sets, the stale flag, and the brief's "what stands" part. Nothing in code writes or reads them yet. Reviews have written three verdicts and one change by hand. That change (PR #2471) is still open although the PR merged on 20 Nov, because nothing ends a change.
- Plan-review's verdict is still a comment. Slice 2 marks a plan review as owed with an open finding to plan-review, which an Approve ends.

**What we want.** The design's slice 3 row is the how, read with §4 (runs, changes, verdicts), §3 (the blind read) and §7 (the tracker). In short:
- Implementation writes a change record for its PR and head.
- Plan-review, review and the blind read write their verdicts as records, `on` the plan piece or change version they read. A verdict is pinned to the head its judge read, and the head is then refreshed from the PR.
- "Approve — conditional" becomes `approve` plus one finding to close-out per condition.
- Harbour ends a change `merged` when it records the merge.
- Everything that reads verdicts from comments reads records instead:
  - close-out, which keeps refusing when the head has moved, now reading the stale flag;
  - the blind-read route;
  - the selector's facts and the stage-router rule (C3-39);
  - the autopilot kickoff (C3-40);
  - look-first;
  - the plan and breakdown prompts that read a plan-review verdict (C3-37);
  - `ci-wake`, with change heads refreshed at each verdict write (C3-57);
  - run evidence and its box on the session and task pages (C3-42);
  - the measures: round trips, churn, follow-on ratio (C3-24), the effort readout and the stability scripts.
- The revision brief retires, as `checks/placement.md` says (C3-18): its reasoning reaches the next stage through the brief's "what stands" part. It isn't on the slice table, so this line states it.
- People still see each verdict in the tracker, as one marked summary comment.
- **Retired in the same move:**
  - the comment classifier, `COMMENT_KINDS`, and its readers (C3-01–C3-06);
  - the verdict parse and `findSha` (C3-07, C3-08), and `headMoved`, which the stale flag replaces (§4);
  - `extractVerdict` (C3-19);
  - the blind-read guard's shape half (C3-17). The rule that a blind read names exactly the landing's PRs stays in the route, checked against the task's open changes;
  - the blind read's words, but not its kind (C3-41);
  - the comment census test (C3-59);
  - the verdict-comment contracts: the plan-review, review, close-out, blind-read, audit and survey formats (C3-27–C3-36), and with them the surveys' one-line comment kept for look-first (§10).

  The design's slice table lists the code sites for each, with lines in `census/C3-verdicts-runs.md`.

**Carried forward.**
- **The `isEmptyStatement` defect** (finding-76683071, open to the project). A pre-cutover ledger with items can read as empty, so the gate says "none open". It lives in the verdict parse this slice retires. End the finding when the parse goes.
- **The three pins LIN-4499's close-out restored** to the comment census test (finding-53246d24) go with that test, unless what they pin outlives the classifier.

**Not in this slice:** rulings, `RULING_MARK` and the brief's ticket section (slice 4); lessons (slice 5); a guard on the blind read's reads (it stays prompt-only, as John agreed; this slice counts them instead). The Periodical gate is outside the layer and stays (C3-23).

**Witness:** close-out and the selector replayed on slice 1's ported walk 8 stores (`tests/fixtures/walk-8/`), reaching the same decisions they reach from the comments. In walk 8's LIN-4469, the commit pushed after the review, which no review saw, shows the verdict as stale.

**Readings before it lands** (reported after, never a gate):
- blind-read results, and review round trips;
- from this slice on: blind-read queries for anything beyond the change it judges and its own records, from the query log;
- as in slices 1–2: records addressed to a held run, and how long each sat (slice 2's reading: median 1.0 h, and 17.2 h for those addressed to implementation).

**Done when**
- implementation writes a change record per PR, and plan-review, review and the blind read write verdicts as records, each `on` the version it read;
- a commit pushed after a verdict, close-out's included, shows that verdict as stale on the task page and in the brief;
- a merged PR's change record ends `merged`;
- close-out, the selector, the run-evidence box and the measures read records, and nothing reads a comment to find a verdict or its commit;
- `COMMENT_KINDS`, the verdict parse, `findSha`, `headMoved`, `extractVerdict`, the guard's shape half, the comment census test and the verdict-comment contracts are gone;
- the replay passes through the proxy, and the readings are reported;
- Harbour still works for every route that hasn't moved yet.

**Two questions for John.** He hadn't answered them when this was filed, so raise them as rulings when you reach them, and keep building the rest meanwhile. The driving session's suggestions are given with each.
1. **Close-out's own commits.** Close-out already refuses when the head has moved after the approval, and that refusal carries over onto the stale flag. The open case is close-out's own fix commits, which make the approval stale. Should merging then wait for a quick re-review of the new head? It costs a run per task. *Suggested: yes; it closes the unreviewed-commit gap seen on LIN-4502, 4504, 4505 and 4499.*
2. **Verdicts already in comments** on open tasks. With no import, an open task reviewed by comment has no verdict record at cutover, so it would need a re-review before close-out. Import those verdicts once (as slice 2 did for plans), or re-review as each task comes up? *Suggested: import once, following slice 2's plan import.*

**Open (engineering, for the builder):** whether the LIN-4499 deadlock (the engine wouldn't send the blind read while close-out was open, and close-out can't merge without one) lives in the reads this slice moves. Slice 2's plan-review stand-in finding asks for a review and the verdict is the review's answer, so the two don't double; keep or move it as the standing answers say.

**Where to read:** `docs/plans/survey/integration/design.md` and `docs/plans/survey/layer/design.md` at their commit, `claude/cool-rubin-6acj5j@92838c5cf` (the copies on main are the same).

**John's answers to questions that came up in earlier slices:**
- Retire everything the design's slice table lists for this slice. Don't keep slimmer versions of retired things.
- If something else depends on what's retired, move it onto the right data rather than keeping the old thing.
- Production is reachable: use `railway ssh` into the harbour-cat container (`railway run` can't reach the database). Never print the production environment.
- If you need the fleet paused for a cutover, say so; the driving session sets and clears it.
- The design stage writes no plan record; plan and plan-review keep running.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
