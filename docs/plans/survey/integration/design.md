# The layer in Harbour: integration design

*Slice 4 revision, 22 Nov: §3, §5, §7, §9, §10 and §11 items 9 and 10 now say what slice 4 does (item 10 holds the LIN-4529 plan's departures, added on main in P1), as agreed with John that day; where this differs from the earlier text, this is the plan. Agreed by John on 19 Nov ("Excellent, looks good to me"), after reading the doc copy with its why and per-slice scenes; step 1 is done. Draft 3, 19 Nov: brought into line with the layer as revised on 18–19 Nov, which dropped areas, paths, `blind`, `check`, `same-as`, `checked-at` and `approve-with-notes` (log, "18–19 Nov"); what changed is in §0. Draft 2 carried the recheck's fixes (`checks/recheck.md`), 18 Nov. For John to correct. It follows `integration/plan.md` and rests on the census in `census/C1–C5` (main at `6f6c5d2`), whose row ids (C1-12 and so on) are cited here. The approved design is `layer/design.md`. It is called "the layer" below, with its sections given as §3.1 and so on. Draft 1 was checked by a paper walk, a break reader and a drift reader (`checks/`). This draft answers each of their finds; `checks/answers.md` maps every find to its line here. Every census row is placed in `checks/placement.md`, and `checks/completeness.mjs` confirms it. Marks are as on `situation.md`. Lines with no mark are design, mine until John corrects them.*

## Why: what leaks today, and what each slice fixes

Today Harbour's stages pass free text appended to tickets, comments and area notes. Text written with no end grows, every reading is a fresh parse that can drift, and with no addressee every reader is handed the whole history. The layer gives each hand-off a writer, an addressee, a state and an end, so it reaches one reader and stops when it's done. (The doc copy draws this as a before and after.)

The moments below are from the 15 Nov traces (`picture` §2, peaceful-euler) and the census; each slice exists to stop one of them.

| Leak | What happened | Fixed by |
|---|---|---|
| Out, into notes | Larger finds go to an area note's Waiting list, where they stop. The notes grew from 10.6 KB to 88.8 KB in six days; 111 Waiting entries are open; seven safety findings sat only in notes | Slice 1: a find is a record addressed to someone, or to the project backlog |
| Out, to the person | Trace 4: the same items went "to the person" two days running, and stopped in a closing comment both times | Slice 1: a finding `to: John` shows on his pages until he ends it |
| Out of reach | A check that needed John's systems passed through six places in trace 1 and nine comments in trace 3, "recorded as not run" each time | Slice 1: one finding with `how`, addressed to John |
| Across | Trace 6: three asks from another lane, posted on LIN-4448's parent, got no reply; the lane went ahead on silence | Slice 1: an ask is a finding to the task, in that task's next brief |
| Down | The breakdown copies the plan's files, approach and tests into each child; wrong premises arrived this way in traces 2, 3 and 5 | Slice 2: a child reads its piece of the plan, and a correction is a new version every reader sees |
| Up | The parent's plan is never edited; corrections pile beside it. A copied count read 26, 25, 23, 22 and 12 (trace 6), and the prune removed the plan seven children pointed to | Slice 2: one plan record, revised in place, every version kept |
| Judgements guessed from prose | 15 places read comments to guess which one is a verdict, and on which commit (C3) | Slice 3: a verdict is a record pinned to the head its judge read; a later push shows as stale |
| One ruling, nine keys | The same ruling is keyed by loop, task, session, row, shelf, browser, comment, size text and stamp (C2) | Slice 4: a question record, answered by a decision record |
| Retold at every step | Each stage restated the ones before; in trace 5 a concern went round a loop and gained a claim no source supports | Every slice: the brief carries what is addressed to you, an index of the rest, and `get` |
| Broadcast | In trace 1, each of seven sessions began by caching 63,000 to 97,000 tokens | The brief: what is addressed to the reader in full, the rest as one line each |

**A reader earns its place by serving a decision or hand-off that still matters.** Records carry the facts that support that work. A retirement list tells us where to look. Keep the needed behaviour and remove readers whose job has gone away.

**Why each slice deletes the old route in the same move:** 9 of the 27 process changes since June are still half-finished, and the process code holds 21 switches that keep an old path or leave a new one off, and 19 old paths kept beside new ones (`docs/papers/harbour/how-process-changes-land.md:20-24`) [checked]. Kept paths stay.

## 0. What the census and the checks changed

- **The brief already has one door.** Stage prompts carry no ticket text. They point the worker at `GET /api/proxy/brief/<id>`, and the plan reaches the worker only there (C4-31, C4-34) [checked].
- **A token can't say who is writing.** It doesn't know its dispatch, or its stage for the work stages (C5 §"What a proxy request knows"). simple-dispatcher keeps a held session on its first token, so a follow-up would write under the first step's name (`sd:harbour-token-mcp-server.js:124-140`) [checked]. So `by` comes from the run a write names, not from the token (§2).
- **Ticket text stays a carrier until the last slice that moves it.** Verdicts, plan comments and answers live in comments until their slices land. So the brief keeps today's ticket section until then, rather than dropping it in slice 1 (§3).
- **Order.** The plan moves before verdicts, because a plan-review verdict needs a plan record to rest on.
- **Draft 3, from the revised layer.** Removed: area records and their import, task and lesson paths, part 5's list of areas, the `blind` mark, checks (a verification is a finding with `how`), lessons' `checked-at`, the file-pointer pilot (it fed plan paths), and one set of areas per workspace. Added: who a plan is addressed to (§3), the project backlog and its page (§6, §8), and the API shape from the review (§2). A fresh recheck found nine more places out of line, all fixed (`checks/recheck-3.md`). A doc copy for John's read: https://claude.ai/artifact/62y2rpauvpedF8NRS4FqYh. The checks in `checks/` were run on draft 2; their finds about areas and paths no longer apply, and the rest still stand.

## 1. Where the store lives

- **One collection, `records`, with one document per version:** `{workspace, id, v, kind, op, at, by, via?, reason?, in?, to?, state, ended?, links, fields}`. `workspace` is the `urlKey`, as in the local store (C5-D01). The current record is its highest `v`. Indexes on `{workspace, id, v}` and `{workspace, kind, state, to}`. Nothing is updated in place.
- **The modules,** in a new area named "Records". Everything except the store is pure:
  - `lib/records/kinds.json` holds the kinds and outcome sets as data (§3.2).
  - `lib/records/check.js` is the shape check (§3.3).
  - `lib/records/views.js` computes the views (§3.4).
  - `lib/records/brief.js` builds the brief and its text (§3.5).
  - `lib/records-store.js` reads and writes the collection, built once in `server.js` (C5-D03).
- **How they're built.** They are written fresh from §3, with the round 9 model (`layer/walks/9/model/`) as a reference, not the source. Its test (52 cases) becomes their contract tests.
- **No actor list is kept** (John, 19 Nov). What the names are for decides what is checked:
  - `by` is filled by code from the run (§2), or is the signed-in person, so no write can get it wrong and it is not checked.
  - `to` must name a reader Harbour can brief, or the hand-off is lost. Harbour checks it at the write against what it already declares: a task, `project`, one of its 20 stage kinds (`lib/prompts/stage-kinds.js`) [checked] or `leftover`, or a person in the workspace. Writers name a person as the workspace shows them ("John"); Harbour stores their account, `person:<accountId>`.
  - A miss is refused with the names that would work. A new stage needs no second edit. Renaming a stage strands open records to the old name, so a rename carries a one-off migration.
- **`project` is the workspace.** The store is partitioned by workspace, so the `project` addressee, part 5's counts, part 6's open runs and the project's backlog each span one workspace. A workspace holding several codebases shares one pile; that stays open until Yap.
- **Who imports Records:** Agent API (proxy), Runs & dispatch, LLM & prompts (the selector's facts) and the pages. Records imports only Platform. So each slice adds one-way edges into a leaf area and no new mutual pair; the tightest pair, LLM & prompts ⇄ Runs & dispatch at 39/60, is untouched (`census/seams-6f6c5d2.json`) [checked]. The knots to call are in §10.

## 2. How agents reach it: the proxy

- **A router, `routes/proxy-records.js`,** on the existing factory pattern (C5 §C):
  - writes: `POST /records`, `POST /records/:id/revise`, `POST /records/:id/end` and `POST /records/:id/link`;
  - reads: `GET /records/:id[@v]`, `GET /records?…&asOf=` (find, with count) and `GET /tasks/:id/records` (show).

  A refused shape returns 422 with the reason. simple-dispatcher forwards any `/api/proxy/*` path, so it needs no change (break-read, "Checked and held") [checked].
- **The body, for agents** (`checks/api-review.md`). Input encoding only; the store holds what the layer's §3 says.
  - A write is flat JSON: `{"kind":"finding","in":"LIN-4451","to":"review","says":"…","how":"…","about":"change-5","run":"<id>"}`. Links may sit beside the fields or under `links`, as one id or a list. `in` and `to` take task ids or ticket ids.
  - `on` takes a bare id, pinned to that record's current version; a change is pinned to the head its judge read (§4).
  - Ending a record already in that end returns it unchanged.
  - A refusal (422) names every problem in one response, each with what would work: the kind's fields, or which kind a field belongs to; the valid outcomes or ends; the `to` names.
- **Open to every token that may write.** The record routes add no per-stage allowance: any actor may write any kind, as §3.2 says. Today's restricted stamps keep limiting ticket writes, as they do now (C5-C06).
- **Who wrote it is bookkeeping in code.** Why it matters: a build's held session also runs its leftover step, on the same token; without the run, the leftover's findings would be filed as implementation's.
  - Every place that makes a dispatch row with a prompt allocates the row's id before the prompt is finalised. Today the id is made inside `addItem` (`lib/dispatch-store.js:755`), after the prompt (`lib/dispatch-factory.js:14-20`) [checked]. The places are the dispatch factory and the wake builder (`lib/dispatch-wake.js:85-102`, `lib/wake-credential.js`) [checked].
  - The preamble names the run: "your run: <id>". The id is also recorded on the bootstrap token at mint, and the working token inherits it through `parentTokenId`.
  - A signalled follow-up carries its own prompt, and so its own id, into the held session (`sd:dispatcher.js:371`, `sd:hook.js:1212-1215`) [checked].
  - Writes and queries send `run: <id>`. Harbour accepts it only if that run's record is open and its row is in the same dispatch lineage as the token's row. A session's follow-ups and wakes stay in one lineage (`rootItemId`). So a stage can't write as a stage in another session (recheck 1).
  - `by` is that row's stage, as an actor: its kind, or `leftover` for the leftover row.
  - A wake or custom resume doesn't start a new run. It continues the run of the session it resumes, found through `resolveFollowUpRoot`, as `stampForWakeParent` already walks (`lib/item-stage-stamp.js:51-55`) [checked]. That avoids a short run per wake (recheck 4, 9).
  - A dispatch token that names no run is refused. Only a token with no dispatch writes with no run: a person's copy token, or the UI. Those write `by` the account: `person:<accountId>`.
  - `via` is kept only for real relays: an import or a scan.
  - Queries are logged with the run or account that asked, as the layer's §3.5 says.
- **Tasks are found or made by tracker id.** A `to` or `in` naming a ticket (for example `LIN-4451`) resolves to its task record. If an open ticket has none yet, Harbour creates one from the tracker: `ref`, plus `in` the parent's task (made the same way, up the ticket's own tree).
  - A task made from a ticket gets the ticket's words as `asked`, child or not, as the layer keeps a person-written child's words (§3.2). From slice 2, a breakdown writes its children as task records with a `piece` and no `asked`.
  - A closed ticket is refused with the reason.
  - A hand-off to a sibling not yet dispatched therefore lands (paper walk B5).

## 3. How a stage gets its brief

- **The door.** The brief is built from records (§3.5, parts 1–8) for the run the dispatch credential names. Its header names the run, so the stage can revise its claims (paper walk B12, recheck 6). Until slice 4 the record parts were built only when the caller passed `?run=`, and no prompt said to; from slice 4 no parameter is needed. A row with no run (the autopilot coordinator) and a person's copy token read the task's brief, as a person's copy does.
- **"From the ticket", until slice 4.** Until slice 4 the brief ended with a model-written distilled brief of the ticket and its comments, a temporary ninth part (John, 18 Nov: "A little temporary scaffolding is ok"). Slice 4 removes it:
  - the distilled brief (`generateBrief`), its system prompt, its model operation and the `brief-cache` collection;
  - the recap's model summary (`generateRecap`), its system prompt and the `recap-cache` collection; the recap becomes the task's records, shown short;
  - the scripts and tests that replay either, except recorded history;
  - the description's plan-section skip (`textWithoutPlan`) and what serves only it;
  - the stage prompts' "read the current description and comment thread" line (`formatDiscussionReference`).

  The task page, the session view, the in-app brief route and the chat tools (`get_brief`, `get_recap`) read the records brief.
- **`asked` stays.** The task's `asked` is the ticket as filed, quoted as part 1. From slice 4, editing a description reaches no stage: a correction goes in as a comment (a person's finding, §7) or a decision.
- **Who a plan is addressed to.** Part 2 gives a plan in full only to the actor it is addressed to (§3.5). The `plan` stage writes the plan (John's ruling of 20 Nov, LIN-4504 comment d1d5ab31: `design` writes no plan record and routing stays design → plan → plan-review) and addresses it by its session fit: `to: implementation` when one session can build it, `to: breakdown` when it needs several (LIN-4503's rule, `lib/records/check.js`). A breakdown addresses each piece `to: implementation`. A review is asked for with a finding `to: plan-review` about the plan, which an Approve ends (LIN-4504). Plan-review, breakdown and the rest see its first paragraph and id, and a judge reads the whole with one `get`. So nothing is readdressed as the plan moves along.
- **The blind read keeps having no brief** (`lib/proxy-preamble.js:270-276`) [checked]. Blindness is Harbour's, not the store's (§3.2). Its prompt is given the change record's id to judge, and tells it, as today, to read nothing about the task. It writes its verdict and findings through the record routes. As today, its other reads are limited by its prompt, not by a guard (recheck BR5). No route guard for now (John, 19 Nov: it may not need to be watertight to do its job). Slice 3's readings count, from the query log, blind-read queries for anything but the change it judges and its own records; a guard is added only if blind reads are seen wandering.
- **Size.** The brief's bytes are reported per slice against today's brief (13–14 Nov) and walk 8's, never gated. The frozen prompt-size test (C4-48) stays.

## 4. Runs, changes and verdicts

- **Run records.**
  - Harbour adds a `run` when a stage row or leftover row is taken (C3-45). Wakes and custom resumes continue the run they resume (§2). The run's id is kept on the dispatch row as `runRecordId`, so the engine row points at the record and the record needs no engine field.
  - On a terminal marker (C3-47), Harbour ends the run `done`, with the marker as its reason (`completed`, `failed`, `aborted`). `[skipped]` ends nothing.
  - The `account` is the run's final text, already sent as `assistant-text` chunks (C3-58).
  - The dispatch row stays the engine's queue, lineage, wake and cost state. The run record is what readers read.
- **Change records.**
  - The records say what work belongs to a task and what its judge saw. A project that uses PRs records its own PR and head as evidence. A PR cited for context stays a reference. Git-free close-out is outside Slice 3.
  - A verdict on a change names the head sha its judge read, as the review does today (C3-28). The route first revises the change's `head` to that sha if the record lags, and pins `on` to it. Then it refreshes `head` from the PR's live head through the existing status read (`readPrStatuses`, `lib/close-out-readiness.js:30-45`) [checked]. A push the judge never saw then shows as stale, and nothing is blessed unseen (paper walk B6, recheck 3).
  - Briefs and pages show recorded state. Refresh external state where it affects a decision. A merge uses the exact reviewed head, and close-out hands back for review if it pushes a commit of its own. An unreadable PR leaves the record as it is.
  - Harbour ends the change `merged` when it records the merge (C1-29).
- **Verdict records** (`judgement`, `outcome`, `reasoning`, `on` the change or plan piece).
  - Harbour's rule that a blind read names exactly the landing changes stays in Harbour's route, as now (`routes/proxy-writes.js:773-787`) [checked]. It is checked against the task's open changes. It is workflow, so it is not part of the store's check.
  - The stale flag replaces `findSha` and `headMoved` (C3-08, C3-09).
  - Today's "Approve — conditional" (`lib/run-closeout-state.js:108`, the review prompt's rule, C3-32) [checked] is written as `approve` plus one finding `to: close-out` per condition, as the layer's outcome set says. Close-out's approval check reads `approve` with its open findings.
- **The remaining consumers read records** (C3 §"Consumers"): close-out, the selector, look-first, run evidence and readings with a current use. Keep the pre-cutover readings as evidence. The Periodical gate is outside the layer and is kept (C3-23).

## 5. Rulings

- **Agents ask through the records API** (John, 22 Nov), as they write findings: a `question` record, `in` the task, `to` the person or a deciding stage, with `asks`, `options` and `recommended`. Its writer and asking run come from the run (§2). A run may ask as many questions as it needs, and withdraws one by ending it `withdrawn`.
  - Harbour's path from `decision` feedback to a ruling retires, in this order (LIN-4529 plan D9; §11 item 10). (1) Harbour's ask and answer routes land, with the stage prompts and the autopilot manual teaching "ask by record, then end `BLOCKED:`". (2) simple-dispatcher stops teaching and scanning `DECISION:` and `WITHDRAW:`, in its own pull request, after (1) deploys. (3) Harbour retires the feedback path and refuses stale decision feedback with a 422 naming `POST /api/proxy/records`. A stale `DECISION:` is refused, not converted: no translator. A session parked `BLOCKED:` after asking is held by simple-dispatcher's own rule, so the hold needs no new code there.
  - Workers can ask a question at every point of the change.
- **An answer is a `decision` record** (`by: person:<accountId>`, `answers` the question), and the question ends `answered`. It holds the chosen option (`answer`) and the person's own words (`words`), both when both are given. At least one is required, and each is stored exactly as written: never trimmed, and over the limit the write is refused naming the limit, never truncated (LIN-4529 plan D1).
  - One answer route serves the Rulings page, the task page card and Home.
  - The answer resumes the asking run when that run can be resumed (§11 item 10). Its prompt carries the question, the chosen option and the person's words, in that order. A resumable run is resumed once: a retry after a partial failure completes what is missing and never doubles.
  - A run that was stopped stays stopped, and the page says it wasn't resumed, as today. The decision stands in the task for the next stage to read.
  - The per-ruling effect choice (resume, record, dispatch) retires. With the scan gone, an answer always goes back to the run that asked.
  - The answer route refuses a question that has already ended, which keeps the 409 (C2-13).
- **Dismissing** ends the question `withdrawn`, `by` the person, with the reason "dismissed". If the asking run is waiting, it resumes, told the question was dismissed. A stopped or gone run is not resumed, as for an answer. It is the same on every surface. The false-escalation measure counts dismissed questions.
- **The rulings page** shows what is open for the signed-in person: questions and findings, plus records left under an ended task with no parent. Shelving retires (John, 22 Nov: unused), and so does the scan (John, 22 Nov: never really used). A suggested answer or dismissal is a finding to the person, `about` the question, written through `/records`.
- **The size of the move** is a decision on the task, kept fuzzy (John, 6 and 8 Nov; 22 Nov). Scoping settles it under the standing policy (err larger) with a sentence of why. Only when it would cut part of the ask, or judges the ticket the wrong work, does it ask the person, and that work waits for the answer. The `## Size of the move` section, its fixed shape and list of sizes, its guard and its vocabulary module retire.
- **Retired in slice 4:**
  - the unanswered-decisions predicate and its keyings (C2-08–C2-12);
  - the `task-decisions`, `dismissal-suggestions` and `shelved-rulings` stores, and the two scripts that import `TaskDecisionsStore`;
  - the agents' rulings route and its suggest routes, and the `/rulings?includeResolved` instructions;
  - answers as comments, `RULING_MARK`, `isRuling` and the `decision-answer` stamp (C2-22, C2-23, C3-25);
  - the scan, with its routes, page and fingerprint.

  The `harbour-comments` ledger is kept and widened, not retired (LIN-4529 plan D4): it is the only record of which comments Harbour's own writers posted, and §7 needs exactly that.

  Every reader moves onto question and decision records: the ticket closer, the observer sweep, the KPIs, session and Home row states, account erasure and the chat tools.

## 6. Wakes

- **The engine's wakes are kept:** up-chain, leftover, CI sweep, person follow-ups (C5-B01–B07, B13).
- **Slice 6, not built for now** (John, 19 Nov: likely not needed, or a later optimisation if found useful). Slice 1's readings count records addressed to a stage or task that had a held run, and how long each sat before that run saw it; slice 6 is filed only if that shows hand-offs sitting. Until then, agents' hand-waking stays (C5-B14). If built, it is one rule: a record that is open, `to` a stage or task with a run held waiting on that task, enqueues one follow-up through `enqueueFollowUp`. The compare-and-swap is per (run, record). It skips records written by the waiting run's own children, since the up-chain wake already covers those (break-read 13).
- **Records to `project` wake nothing.** Every brief carries their count (part 5), and stages look them up with `find --to project`. In walk 8, stages ended project records their own work settled [checked: `layer/walks/8/results.md`].
- **The pile is a backlog, surfaced for John to decide when to act** (John, 19 Nov). No task has to finish it: the leftover step no longer settles one entry per build (C5-A08, `lib/dispatch-leftover.js:152`) [checked], and stages end project records only when their own work settled one, as in walk 8. John works the backlog from the project page (§8), by making a record a task, declining it, or starting a separate Harbour process over it when he chooses. In walk 8 the pile grew, 18 added and 7 ended or handed on over three tasks; the count is reported per slice, never gated.

## 7. The tracker

- **Outward, a backup in summary.**
  - Harbour posts one marked summary per verdict, decision and plan version, and at each run's end a line listing what is open in the task. Every such post, from Harbour's own writers, goes through one helper that also records it in the `harbour-comments` ledger; the three `createComment` sites call that helper (plan D4). Where the tracker takes a client-chosen comment id, the record is written before the post, so a lost record cannot make a Harbour post look human; otherwise it is written after the post, with retries and a loud log. A comment posted with the owner's key outside Harbour looks like the owner's, and the ledger cannot know that: the real fix is an app actor behind provider sync (§7, the follow-up).
  - It creates child tickets from child task records.
  - **From slice 4, stage runs write no comments.** What a stage's comment carried goes into records: the run's account, the findings it ends and why, its change record and its verdict. Close-out's CI state and the tickets it closed go into its account; the blind read's `Read:` line goes into its verdict. The autopilot coordinator, which has no run, puts its wrap-up in its final message. The write stamps' comment allowances go. Stages still change ticket state, descriptions where scoping writes them, and relations.
- **Inward.**
  - A ticket's words become the task's `asked` (§2).
  - Closing a ticket ends its task (C2-27).
  - **A person's comment** written after slice 4's cutover reaches its task once, as a `finding` `by` its actual author, `to` the task, and so reaches the next stage through the brief. One reader, `lib/comment-ingest.js`, is the only code that decides authorship. A comment is a person's when it is newer than the workspace's cutover instant (set once per workspace at the boot of the deploying version, so comments between deploy and first read are not lost), its id is not in the ledger, and its author's tracker user id equals a workspace person's `trackerUserId`. Each ingested comment writes a finding with `via: comment` and `fixedId` `fixedIdOf('finding', 'comment', commentId)`, so a second pass is a no-op. It runs wherever Harbour already reads a ticket's comments to decide what happens next (the recommendation context and the dispatch seat), so the selector and look-first read the finding and not the text. Not covered: comment edits and deletions after ingestion, and wakes into a held session (the finding waits for the next dispatch; waking is §6). The finding's ender is set in P5 (LIN-4529 plan). Not a person's: Harbour's summaries, comments from before the cutover (historical context; they can include agent posts), and comments Harbour's own runs post through the proxy, such as a Periodical's report. A comment whose author Harbour can't place is left out, never credited to the owner.
  - The authorship text rules retire (`isRuling`, `opensAsAgentNote`, `isPersonComment`, `isAgentActivity`, `reportsLandedWork`, selector rule 1's text). Their readers read a person's findings and decisions in the task.
  - The blind read's comment check (`refusedByBlindRead`) retires. The rule that a blind read names exactly the landing changes already holds on its verdict.
  - The Periodical gate is outside the layer and stays as it is.
- **Provider sync is a follow-up,** not part of this design (John, 18 Nov). Making Harbour hold the primary copy, with Linear, Jira and GitHub syncing behind it, would rework the providers. It gets its own design after the slices land, likely alongside the Jira work.

## 8. Pages for people

- **Slice 1:**
  - The task page lists records by kind, with their states and a preview of the brief.
  - It lets a person end, supersede or add records, and add a child task, all `by` their account (paper walk B10).
  - The session page shows the run's account.
  - Home's "Waiting on you" shows what is open for the person.
  - A project page lists the open records addressed to `project`, numbered oldest first, as a backlog (John, 19 Nov). From it a person makes a record a task or declines it.
- **Slice 3:** the run-evidence box.
- **Slice 4:** the rulings page.
- **Slice 5:** lessons on the project page.

Counts come from `find --count`.

## 9. What is already in flight

The fleet is paused [checked: journey].

**At slice 1, a one-off import:**
- **111 Waiting entries** become `finding`s `to: project`, `via: import`, each with its note line. The note's name stays in the finding's text, so nothing the entry said is lost.
- **`docs/areas/areas.json` is not imported.** It stays as the code-shape kit's and the tests' map of Harbour's own source (C5-A19, A20), which is Harbour's tooling, not the layer's.
- **The seven safety entries,** tagged "Security Review" (`grep`: 7 across 5 notes, paper walk) [checked], become seven task records under one parent task. John: "a code collection of tasks to run through the improved loop" (asks.md:227).
- **The parked tickets** (LIN-4416, LIN-4210, and the paused lanes LIN-4441, LIN-4445 and LIN-4463) are filled into records after the fact, as walk 1 did, so they restart from records.

**At slice 4, nothing is imported** (John, 22 Nov). Before the old stores go, any ruling still open, slice 4's own included, is answered; shelved ones are ignored. **At slice 5,** lessons are imported.

## 10. The slices

Each slice is built as a Harbour task through Harbour's own loop. That task runs on the Harbour already deployed, and its own slice takes effect only when it merges and deploys. So each slice's first real use is the task that builds the next one.
- Each slice's prompts tell stages which kinds to write. In slice 1 that's findings, with `how` when the finding is a verification to run. Surveys keep a one-line comment for look-first until slice 3 (C3-14).
- The witness is the test or recorded run that proves a slice works.
- Readings report and never gate (§2 of the layer).

### Each slice, in practice

1. **Hand-offs.** *Today:* the review lists outside finds in a ledger comment; close-out reads it and writes them into an area note's Waiting list; a later leftover must name one in a `Retires:` line, or it sits. *After:* the review writes a finding `to: close-out`, or `to: project`; close-out sees it in full in its brief and ends it when done. In walk 8 (LIN-4450), a leftover ended a project finding its own commit had settled.
2. **The plan.** *Today:* the breakdown copies the plan into each child's description; a correction lands as a comment on the parent, and the children keep the old text. *After:* each child points at its piece; a correction is a new version of that piece. In walk 8 (LIN-4446), the first plan-review verdict showed stale on the revised plan and cleared when it was superseded.
3. **Verdicts.** *Today:* close-out and the selector read comments and guess which one is the verdict, and on which commit. *After:* the review writes a verdict pinned to the change's head. In walk 8 (LIN-4469), a commit pushed after the review, which no review saw, showed as stale, as the real reviewer had said.
4. **Rulings.** *Today:* an agent's `DECISION:` becomes a ruling keyed nine ways, and John's answer is posted as a comment. *After:* the agent asks through the records API; John's answer is a decision record, and the asking session resumes with the question, his option and his words.
5. **Lessons.** *Today:* lessons live in the area notes, and prompts are told to read the notes. *After:* a lesson is a project record; every brief says how many hold and how to search them.

| Slice | Moves | Retires in the same move | Witness | Reading before | Knot |
|---|---|---|---|---|---|
| **1. Store, runs, hand-offs** | Store, routes, run ids and `by`; run and task records; findings (the ledger's not-run items, review and blind-read finds, leftovers, asks to a parent or sibling, finds `to: project`); the brief's record parts; the import; the pages above | Waiting writing and reading (C1-01–C1-11); the `Retires:` conveyor and its 422 (C1-15–C1-22), and the leftover step's duty to settle one entry; the ledger's item parse and counts (C1-26, C1-28–C1-31); the blind-read classes (C1-34) | Contract tests; walk 8's three tasks replayed through the proxy on a temporary store, seeds ported to the current kinds (a check becomes a finding with `how`; approve-with-notes becomes `approve` plus findings) | Notes bytes and the Waiting count; brief bytes; sessions and cost per task (13–14 Nov). From this slice on: records to a stage or task with a held run, and how long each sat (for slice 6) | Four one-way edges into Records. No new pair |
| **2. The plan** | Plan records with `piece` and `to`; breakdown writes child tasks; `asked` on the task record | Plan in the description and its parsers (C4-01–C4-13); the prune and `description/below` (C4-04, C4-19); the copy-down (C4-03); the As-asked seal and guard (C4-14–C4-18, C4-49); snapshots (C4-41, C4-42; Ship Biscuit's before and after reads plan versions instead); the file-pointer pilot, whose input was plan paths (C4-07) | A breakdown and a correction replayed: the child reads its piece, and a correction is a new version | Copied-count drift (trace 6); brief bytes | None new |
| **3. Verdicts and changes** | Verdict and change records; consumers read records; verdict summaries to the tracker | `COMMENT_KINDS` (C3-01–C3-06); the verdict parse and `findSha` (C3-07, C3-08); the blind-read guard's shape half (C3-17); the blind-read words, not the kind (C3-41); `extractVerdict` (C3-19); the comment census test (C3-59); the verdict-comment contracts (C3-27–C3-36) | Close-out and the selector make the required decisions on record fixtures. A moved head requires re-review, and cited PRs stay outside the landing. Keep frozen results and document deliberate differences. | Blind-read results; review round trips. From this slice on: blind-read queries beyond the change and its own records | None new |
| **4. Rulings, and the ticket section goes** | Questions and decisions written through the records API; the rulings page; the brief from records alone; a person's comments as findings (§3, §5, §7) | The predicate and its keyings; the three ruling stores and their scripts; the feedback-to-ruling path, and simple-dispatcher's `DECISION:`/`WITHDRAW:` teaching; answers as comments and `RULING_MARK`; the scan; the size section and its guard; the brief's ticket section and the recap's model summary, with caches, models and replay scripts; the authorship text rules; the blind read's comment check | The first suitable task after deployment: a question asked, answered with an option and a qualifying sentence, and resumed with all three; a person's comment reaching the next stage's brief | Open rulings; time to answer; brief bytes | None new |
| **5. Lessons** | Lesson records (`says`), with the notes' Lessons imported | Notes' Lessons, the pointer and its tests (C5-A01, A03, A06, A13, A14, A16–A18); the prompt readers of the registry path (C5-A04); the notes files | A lesson written in one task is counted in a later task's part 5 and found there with `find --kind lesson --text` | Lessons bytes | None |
| **6. Wakes for open records** (held: filed only if slice 1's count shows the need) | The rule in §6 | Agents waking each other by hand for hand-offs (C5-B14) | A record to a held run wakes it once | Pause wakes that changed nothing | Records → Runs, one edge |

**Where the documents live** (John, 19 Nov). The full record (log, walks, census, checks) stays on `claude/cool-rubin-6acj5j`, kept for review. Tickets cite it by branch and commit. Main gets only what it needs: slice 1's pull request adds `layer/design.md` and `integration/design.md`, and a later slice that changes the design updates them in its own pull request.

**Every slice leaves Harbour whole if the next never lands.** Whatever hasn't moved still travels as ticket text, and agents still see it through the brief's kept ticket section until slice 4.

## 11. For John

1. **Decided (18 Nov):** the parked work runs after slice 4, as the first work through the upgraded Harbour. It is read against the 13–14 Nov baselines, reported and never gating. John: "I'm the only user so there's no pressure or rush."
2. **Decided (18 Nov):** provider sync is a follow-up (§7).
3. **Small changes to the approved layer:**
   - **Agreed (John, 19 Nov):** no actor list; `by` comes from code, and `to` is checked against what Harbour can brief, people named as the workspace shows them (§1). The layer page now says so (§3.1–3.3).
   - a temporary ninth brief part, the ticket section, until slice 4 (§3). **Accepted** (John, 18 Nov: "That's fine. A little temporary scaffolding is ok.")
   - *Withdrawn in draft 3:* part 5 listing every area while a task had no paths. Areas are gone.
   - *Withdrawn (John, 19 Nov):* an `on-answer` field on the question kind. What an answer sets off stays on Harbour's feedback item (§5). *Superseded 22 Nov:* an answer always resumes the run that asked (item 9).
4. **Agreed (John, 19 Nov): rulings as their own slice 4,** rather than inside hand-offs as the journey had it. The census shows 50 sites (C2). The in-between state (rulings on their page, findings in "Waiting on you") is accepted, since slices are built one after another with no other work running. John sees rulings as ripe for a Theseus rebuild later.
5. **Agreed (John, 19 Nov): slice 6 waits.** Slice 1 measures records sitting for a held run; slice 6 is filed only if that shows the need.
6. **Agreed (John, 19 Nov): accept the knots as a tax; later work tidies properly** ("Make it work, then make it good"). Records imports nothing back, so none of these makes a new pair, and none changes code inside today's tightest pair beyond its reads. Rulings get a Theseus after slice 4, on what is left (the page, shelving, the browser resume); before it would rebuild code slice 4 deletes.

   | Slice | Edges into Records |
   |---|---|
   | 1 | Proxy, Runs & dispatch, LLM & prompts (the selector's counts), and Front end (pages) |
   | 2–5 | Only more files along those same four edges |
   | 6 | One edge out of Records, into Runs, for the wake call |

   Slice 6 is the only edge out of Records, and it would make Records ⇄ Runs a new pair unless the wake call is passed in rather than imported. My call is to pass it in.
7. **Agreed (John, 19 Nov): the blind read stays prompt-only,** as today; slice 3 counts its queries beyond its change from the query log (§3).
8. **Agreed (John, 19 Nov): the project pile is a backlog,** surfaced on the project page for John to act on when he chooses, by hand or with a separate Harbour process. No task is required to work it (§6).
9. **Agreed (John, 22 Nov): slice 4's departures from the earlier text.** Agents ask through the records API rather than `DECISION:`; an answer resumes the run that asked when it can be resumed (item 10), with no per-ruling effect; dismissing means dismissed; shelving and the scan retire; the size of the move is a plain decision with no formal section; nothing is imported; stage runs write no comments, and a person's comment becomes their finding (§3, §5, §7, §9).
10. **Departures in the LIN-4529 plan (not John's rulings; for John to see).** The plan is `plan-420acea4` (records), read against this design. Each is stated where the design says it.
    - The `harbour-comments` ledger is kept and widened, not retired (§5, §7; plan D4). Its reason: §7 needs it to tell Harbour's own posts from a person's.
    - An answer on a stopped run does not revive it. The answer route's follow-up is server-originated, so the stopped-run guard (LIN-4080) refuses it. The reply box, which sends a person's forced follow-up, is untouched and can still revive a run. If John meant the reply box too, that is a one-line change (plan §2.2).
    - A session past its 7-day resume window cannot be woken, so its answer stands on the task for the next stage to read; the page says no session is left (plan D2, D3).
    - A kickoff row may start a run, so a coordinator can ask and be resumed the same way. This reverses LIN-4492's "kickoffs start no run" for that one kind (plan D2). P2a confirms from the autopilot kickoff prompt and manual that the coordinator does ask.
    - The brief's part 1 keeps the heading `## As asked` for the person's words, so the stage prompts keep their vocabulary (plan D6).
