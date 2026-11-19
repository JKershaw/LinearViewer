# The layer in Harbour: integration design

*Draft 3, 19 Nov: brought into line with the layer as revised on 18–19 Nov, which dropped areas, paths, `blind`, `check`, `same-as`, `checked-at` and `approve-with-notes` (log, "18–19 Nov"); what changed is in §0. Draft 2 carried the recheck's fixes (`checks/recheck.md`), 18 Nov. For John to correct. It follows `integration/plan.md` and rests on the census in `census/C1–C5` (main at `6f6c5d2`), whose row ids (C1-12 and so on) are cited here. The approved design is `layer/design.md`. It is called "the layer" below, with its sections given as §3.1 and so on. Draft 1 was checked by a paper walk, a break reader and a drift reader (`checks/`). This draft answers each of their finds; `checks/answers.md` maps every find to its line here. Every census row is placed in `checks/placement.md`, and `checks/completeness.mjs` confirms it. Marks are as on `situation.md`. Lines with no mark are design, mine until John corrects them.*

## 0. What the census and the checks changed

- **The brief already has one door.** Stage prompts carry no ticket text. They point the worker at `GET /api/proxy/brief/<id>`, and the plan reaches the worker only there (C4-31, C4-34) [checked].
- **A token can't say who is writing.** It doesn't know its dispatch, or its stage for the work stages (C5 §"What a proxy request knows"). simple-dispatcher keeps a held session on its first token, so a follow-up would write under the first step's name (`sd:harbour-token-mcp-server.js:124-140`) [checked]. So `by` comes from the run a write names, not from the token (§2).
- **Ticket text stays a carrier until the last slice that moves it.** Verdicts, plan comments and answers live in comments until their slices land. So the brief keeps today's ticket section until then, rather than dropping it in slice 1 (§3).
- **Order.** The plan moves before verdicts, because a plan-review verdict needs a plan record to rest on.
- **Draft 3, from the revised layer.** Removed: area records and their import, task and lesson paths, part 5's list of areas, the `blind` mark, checks (a verification is a finding with `how`), lessons' `checked-at`, the file-pointer pilot (it fed plan paths), and one set of areas per workspace. Added: who a plan is addressed to (§3), who works the project's pile down and how it shows (§6, §8), and the blind read's reads as a question for John (§11). The checks in `checks/` were run on draft 2; their finds about areas and paths no longer apply, and the rest still stand.

## 1. Where the store lives

- **One collection, `records`, with one document per version:** `{workspace, id, v, kind, op, at, by, via?, reason?, in?, to?, state, ended?, links, fields}`. `workspace` is the `urlKey`, as in the local store (C5-D01). The current record is its highest `v`. Indexes on `{workspace, id, v}` and `{workspace, kind, state, to}`. Nothing is updated in place.
- **The modules,** in a new area named "Records". Everything except the store is pure:
  - `lib/records/kinds.json` holds the kinds and outcome sets as data (§3.2).
  - `lib/records/check.js` is the shape check (§3.3).
  - `lib/records/views.js` computes the views (§3.4).
  - `lib/records/brief.js` builds the brief and its text (§3.5).
  - `lib/records-store.js` reads and writes the collection, built once in `server.js` (C5-D03).
- **How they're built.** They are written fresh from §3, with the round 9 model (`layer/walks/9/model/`) as a reference, not the source. Its test (52 cases) becomes their contract tests.
- **Actors are data, from the place that already declares them.** For Harbour, they are:
  - its 20 stage kinds (`PROMPT_TEMPLATES`, `lib/prompts/stage-kinds.js`) [checked];
  - `leftover`, `autopilot` and `harbour`;
  - each person who belongs to the workspace, named as `person:<accountId>`.

- **`project` is the workspace.** The store is partitioned by workspace, so the `project` addressee, part 5's counts, part 6's open runs and the leftover step's pile each span one workspace. A workspace holding several codebases shares one pile; that stays open until Yap. Another project supplies its own list, as §3.2 says. "John" in the layer is the workspace owner's person actor (`getWorkspaceOwnerAccountId`). *The list grows from the layer's 14 names, read from code rather than `actors.json`. Flagged for John (§11).*
- **Who imports Records:** Agent API (proxy), Runs & dispatch, LLM & prompts (the selector's facts) and the pages. Records imports only Platform. So each slice adds one-way edges into a leaf area and no new mutual pair; the tightest pair, LLM & prompts ⇄ Runs & dispatch at 39/60, is untouched (`census/seams-6f6c5d2.json`) [checked]. The knots to call are in §10.

## 2. How agents reach it: the proxy

- **A router, `routes/proxy-records.js`,** on the existing factory pattern (C5 §C):
  - writes: `POST /records`, `POST /records/:id/revise`, `POST /records/:id/end` and `POST /records/:id/link`;
  - reads: `GET /records/:id[@v]`, `GET /records?…&asOf=` (find, with count) and `GET /tasks/:id/records` (show).

  A refused shape returns 422 with the reason. simple-dispatcher forwards any `/api/proxy/*` path, so it needs no change (break-read, "Checked and held") [checked].
- **Open to every token that may write.** The record routes add no per-stage allowance: any actor may write any kind, as §3.2 says. Today's restricted stamps keep limiting ticket writes, as they do now (C5-C06).
- **Who wrote it is bookkeeping in code.**
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

- **The door stays.** The preamble's "Start from the distilled brief: GET …/brief/<id>?run=<run>" is kept (C4-34), with the run added. Behind it, the brief is built from records (§3.5, parts 1–8) for that run's actor. Its header names the run, so the stage can revise its claims (paper walk B12, recheck 6).
- **"From the ticket", kept until slice 4.** While verdicts, plan comments and answers still live in ticket text, the brief ends with today's distilled brief, built by the same model and cache (C4-35, C4-37). The prompt keeps its "read the description and comment thread" line (C4-31).
  - It changes in two ways, so it doesn't repeat what records hold (recheck 5): it skips comments carrying Harbour's mark (§7), and drops its quote of the ask, which part 1 holds. From slice 2 it also skips the description's plan section.
  - Until slice 4, a stage may still meet a thing twice: as a record, and in the ticket thread it is told to read. Records are the source, and the prompt says so.
  - This is the one path kept on purpose, a temporary ninth part beside the layer's eight. *Flagged for John (§11).* It goes in slice 4, when the last of those carriers has moved. Then:
  - the brief cache, the `formatIssueContext` input to it, and the chat tools' cache reads switch to the records brief (C4-44, `lib/chat-tools.js:290-297`) [checked];
  - the recap becomes `show --task` rendered short.
- **Who a plan is addressed to.** Part 2 gives a plan in full only to the actor it is addressed to (§3.5). The design stage addresses its plan `to: implementation`, the stage that works from it; a breakdown addresses each piece the same way. Plan-review, breakdown and the rest see its first paragraph and id, and a judge reads the whole with one `get`. So nothing is readdressed as the plan moves along.
- **The blind read keeps having no brief** (`lib/proxy-preamble.js:270-276`) [checked]. Blindness is Harbour's, not the store's (§3.2). Its prompt is given the change record's id to judge, and tells it, as today, to read nothing about the task. It writes its verdict and findings through the record routes. As today, its other reads are limited by its prompt, not by a guard (recheck BR5). Whether the record routes should also refuse its other reads is a question for John (§11).
- **Size.** The brief's bytes are reported per slice against today's brief (13–14 Nov) and walk 8's, never gated. The frozen prompt-size test (C4-48) stays.

## 4. Runs, changes and verdicts

- **Run records.**
  - Harbour adds a `run` when a stage row or leftover row is taken (C3-45). Wakes and custom resumes continue the run they resume (§2). The run's id is kept on the dispatch row as `runRecordId`, so the engine row points at the record and the record needs no engine field.
  - On a terminal marker (C3-47), Harbour ends the run `done`, with the marker as its reason (`completed`, `failed`, `aborted`). `[skipped]` ends nothing.
  - The `account` is the run's final text, already sent as `assistant-text` chunks (C3-58).
  - The dispatch row stays the engine's queue, lineage, wake and cost state. The run record is what readers read.
- **Change records.**
  - The implementation stage adds a `change` (`ref` the PR, `head`).
  - A verdict on a change names the head sha its judge read, as the review does today (C3-28). The route first revises the change's `head` to that sha if the record lags, and pins `on` to it. Then it refreshes `head` from the PR's live head through the existing status read (`readPrStatuses`, `lib/close-out-readiness.js:30-45`) [checked]. A push the judge never saw then shows as stale, and nothing is blessed unseen (paper walk B6, recheck 3).
  - An unreadable PR is left as it is, as close-out leaves it today (`:43-44`) [checked].
  - Harbour ends the change `merged` when it records the merge (C1-29).
- **Verdict records** (`judgement`, `outcome`, `reasoning`, `on` the change or plan piece).
  - Harbour's rule that a blind read names exactly the landing changes stays in Harbour's route, as now (`routes/proxy-writes.js:773-787`) [checked]. It is checked against the task's open changes. It is workflow, so it is not part of the store's check.
  - The stale flag replaces `findSha` and `headMoved` (C3-08, C3-09).
  - Today's "Approve — conditional" (`lib/run-closeout-state.js:108`, the review prompt's rule, C3-32) [checked] is written as `approve` plus one finding `to: close-out` per condition, as the layer's outcome set says. Close-out's approval check reads `approve` with its open findings.
- **Every consumer of the classifier reads records instead** (C3 §"Consumers"): close-out, the selector's facts, look-first, run evidence and the measures. The Periodical gate is outside the layer and is kept (C3-23).

## 5. Rulings

- **simple-dispatcher's `DECISION:` and `WITHDRAW:` stay as they are,** and so does the runner kit's `decision` feedback (C2-01–C2-07; `lib/runner-kit/runner.mjs:258-265`) [checked]. When Harbour receives that feedback, it writes a `question` record:
  - `by` the row's stage (§2);
  - `in` the task, `about` the asking run;
  - `to` the owner, or a deciding stage.

  A withdrawal ends it. No other repository changes.
- **What an answer sets off stays Harbour's** (resume, record or dispatch, C2 "Resume"). It is already held on the feedback item that raised the question (C2-09). The answer route finds it through the question's `about` link to the asking run, and uses `record` when no run asked (scan rulings). The question kind is unchanged (John, 19 Nov: "Easy to add later if it's a gap worth closing").
- **An answer is a `decision` record** (`by: person:<accountId>`, `answers` the question), and the question ends `answered`.
  - The browser's existing resume carries out the effect, unchanged (C5-B10).
  - Harbour's answer route refuses a question that has already ended, which keeps the 409 (C2-13). That's a rule in the route, not in the store.
- **The rulings page** shows what is open for the signed-in person: questions and findings, plus records left under an ended task with no parent. Shelving stays as page state, keyed by record id (C2-19). A suggested dismissal becomes a finding to the person, `about` the question. The size ruling becomes a decision `scope`d to the task.

## 6. Wakes

- **The engine's wakes are kept:** up-chain, leftover, CI sweep, person follow-ups (C5-B01–B07, B13).
- **Slice 6, optional.** One rule: a record that is open, `to` a stage or task with a run held waiting on that task, enqueues one follow-up through `enqueueFollowUp`. The compare-and-swap is per (run, record). It skips records written by the waiting run's own children, since the up-chain wake already covers those (break-read 13).
- **Records to `project` wake nothing.** Every brief carries their count (part 5), and stages look them up with `find --to project`. In walk 8, stages ended project records their own work settled [checked: `layer/walks/8/results.md`].
- **The pile is worked down by the leftover step,** as it settles one Waiting entry per build today (C5-A08, `lib/dispatch-leftover.js:152`) [checked]. Each leftover run takes one open `project` record and acts on it, ends it, or hands it on to a task. Nothing else changes in the workflow. In walk 8 the pile grew, 18 added and 7 ended or handed on over three tasks; the count is reported per slice, never gated.

## 7. The tracker

- **Outward, a backup in summary.**
  - Harbour posts one marked comment per verdict, decision and plan version, and at each run's end a line listing what is open in the task.
  - It creates child tickets from child task records.
  - The selector, scan and the kept ticket section skip Harbour's mark, so nothing reads the summaries back (break-read 12).
- **Inward.**
  - A ticket's words become the task's `asked` (§2).
  - Closing a ticket ends its task (C2-27).
  - From slice 4, agents post nothing to the tracker but Harbour's marked summaries. So any unmarked comment is a person's, and becomes a `finding` `by` that person, `to` the task. Before slice 4, agents post as the person (`lib/run-trail.js:216-220`) [checked], so comments can't be told apart. They stay in the kept ticket section (recheck 2).
- **Provider sync is a follow-up,** not part of this design (John, 18 Nov). Making Harbour hold the primary copy, with Linear, Jira and GitHub syncing behind it, would rework the providers. It gets its own design after the slices land, likely alongside the Jira work.

## 8. Pages for people

- **Slice 1:**
  - The task page lists records by kind, with their states and a preview of the brief.
  - It lets a person end, supersede or add records, and add a child task, all `by` their account (paper walk B10).
  - The session page shows the run's account.
  - Home's "Waiting on you" shows what is open for the person.
  - A project page lists the open records addressed to `project`, numbered oldest first, so the pile reads as a queue (John, 19 Nov).
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

**At slice 4,** open loop and scan questions are imported. **At slice 5,** lessons are imported.

## 10. The slices

Each slice is built as a Harbour task through Harbour's own loop. That task runs on the Harbour already deployed, and its own slice takes effect only when it merges and deploys. So each slice's first real use is the task that builds the next one.
- Each slice's prompts tell stages which kinds to write. In slice 1 that's findings, with `how` when the finding is a verification to run. Surveys keep a one-line comment for look-first until slice 3 (C3-14).
- The witness is the test or recorded run that proves a slice works.
- Readings report and never gate (§2 of the layer).

| Slice | Moves | Retires in the same move | Witness | Reading before | Knot |
|---|---|---|---|---|---|
| **1. Store, runs, hand-offs** | Store, routes, run ids and `by`; run and task records; findings (the ledger's not-run items, review and blind-read finds, leftovers, asks to a parent or sibling, finds `to: project`); the leftover step working one `project` record; the brief's record parts; the import; the pages above | Waiting writing and reading (C1-01–C1-11); the `Retires:` conveyor and its 422 (C1-15–C1-22), with the leftover stage now ending one finding; the ledger's item parse and counts (C1-26, C1-28–C1-31); the blind-read classes (C1-34) | Contract tests; walk 8's three tasks replayed through the proxy on a temporary store, seeds ported to the current kinds (a check becomes a finding with `how`; approve-with-notes becomes `approve` plus findings) | Notes bytes and the Waiting count; brief bytes; sessions and cost per task (13–14 Nov) | Four one-way edges into Records. No new pair |
| **2. The plan** | Plan records with `piece` and `to`; breakdown writes child tasks; `asked` on the task record | Plan in the description and its parsers (C4-01–C4-13); the prune and `description/below` (C4-04, C4-19); the copy-down (C4-03); the As-asked seal and guard (C4-14–C4-18, C4-49); snapshots (C4-41, C4-42; Ship Biscuit's before and after reads plan versions instead); the file-pointer pilot, whose input was plan paths (C4-07) | A breakdown and a correction replayed: the child reads its piece, and a correction is a new version | Copied-count drift (trace 6); brief bytes | None new |
| **3. Verdicts and changes** | Verdict and change records; consumers read records; verdict summaries to the tracker | `COMMENT_KINDS` (C3-01–C3-06); the verdict parse and `findSha` (C3-07, C3-08); the blind-read guard's shape half (C3-17); the blind-read words, not the kind (C3-41); `extractVerdict` (C3-19); the comment census test (C3-59); the verdict-comment contracts (C3-27–C3-36) | Close-out and the selector replayed on slice 1's ported walk 8 stores: the same decisions as from the comments | Blind-read results; review round trips | None new |
| **4. Rulings, and the ticket section goes** | Question and decision records from the existing feedback; the rulings page | The predicate and its keyings (C2-08–C2-12); the task-decisions and dismissal stores and the two scripts that import them; answers as comments and `RULING_MARK` (C2-22, C2-23, C3-25); the size ruling's text (C2-43); the brief's ticket section, its cache and model, and the scripts that replay it (§3) | A question raised, shelved, answered and resumed, recorded end to end | Open rulings; time to answer; brief bytes | None new |
| **5. Lessons** | Lesson records (`says`), with the notes' Lessons imported | Notes' Lessons, the pointer and its tests (C5-A01, A03, A06, A13, A14, A16–A18); the prompt readers of the registry path (C5-A04); the notes files | A lesson written in one task is counted in a later task's part 5 and found there with `find --kind lesson --text` | Lessons bytes | None |
| **6. Wakes for open records** (optional) | The rule in §6 | Agents waking each other by hand for hand-offs (C5-B14) | A record to a held run wakes it once | Pause wakes that changed nothing | Records → Runs, one edge |

**Every slice leaves Harbour whole if the next never lands.** Whatever hasn't moved still travels as ticket text, and agents still see it through the brief's kept ticket section until slice 4.

## 11. For John

1. **Decided (18 Nov):** the parked work runs after slice 4, as the first work through the upgraded Harbour. It is read against the 13–14 Nov baselines, reported and never gating. John: "I'm the only user so there's no pressure or rush."
2. **Decided (18 Nov):** provider sync is a follow-up (§7).
3. **Small changes to the approved layer:**
   - the actor list comes from Harbour's stage kinds plus people, not a hand-kept file (§1);
   - a temporary ninth brief part, the ticket section, until slice 4 (§3). **Accepted** (John, 18 Nov: "That's fine. A little temporary scaffolding is ok.")
   - *Withdrawn in draft 3:* part 5 listing every area while a task had no paths. Areas are gone.
   - *Withdrawn (John, 19 Nov):* an `on-answer` field on the question kind. What an answer sets off stays on Harbour's feedback item (§5).
4. **Rulings as their own slice 4,** rather than inside hand-offs as the journey had it. The census shows 50 sites (C2).
5. **Slice 6:** build it, or wait until hand-offs show the need.
6. **Knots.** Records imports nothing back, so none of these makes a new pair, and none changes code inside today's tightest pair beyond its reads. My call is to accept them all, with nothing to tidy first.

   | Slice | Edges into Records |
   |---|---|
   | 1 | Proxy, Runs & dispatch, LLM & prompts (the selector's counts), and Front end (pages) |
   | 2–5 | Only more files along those same four edges |
   | 6 | One edge out of Records, into Runs, for the wake call |

   Slice 6 is the only edge out of Records, and it would make Records ⇄ Runs a new pair unless the wake call is passed in rather than imported. My call is to pass it in.
7. **The blind read's reads (§3).** Today they are limited by its prompt only. Should the record routes also refuse a blind-read run anything but the change it judges and its own records?
8. **The project pile (§6).** The leftover step works one `project` record per build, as it settles one Waiting entry today.
