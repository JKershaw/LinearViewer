# The layer in Harbour: integration design

*Draft 2, 18 Nov, for John to correct. It follows `integration/plan.md` and rests on the census in `census/C1–C5` (main at `6f6c5d2`), whose row ids (C1-12 and so on) are cited here. The approved design is `layer/design.md`. It is called "the layer" below, with its sections given as §3.1 and so on. Draft 1 was checked by a paper walk, a break reader and a drift reader (`checks/`). This draft answers each of their finds; `checks/answers.md` maps every find to its line here. Every census row is placed in `checks/placement.md`, and `checks/completeness.mjs` confirms it. Marks are as on `situation.md`. Lines with no mark are design, mine until John corrects them.*

## 0. What the census and the checks changed

- **The brief already has one door.** Stage prompts carry no ticket text. They point the worker at `GET /api/proxy/brief/<id>`, and the plan reaches the worker only there (C4-31, C4-34) [checked].
- **A token can't say who is writing.** It doesn't know its dispatch, or its stage for the work stages (C5 §"What a proxy request knows"). simple-dispatcher keeps a held session on its first token, so a follow-up would write under the first step's name (`sd:harbour-token-mcp-server.js:124-140`) [checked]. So `by` comes from the run a write names, not from the token (§2).
- **Ticket text stays a carrier until the last slice that moves it.** Verdicts, plan comments and answers live in comments until their slices land. So the brief keeps today's ticket section until then, rather than dropping it in slice 1 (§3).
- **Order.** The plan moves before verdicts, because a plan-review verdict needs a plan record to rest on.

## 1. Where the store lives

- **One collection, `records`, with one document per version:** `{workspace, id, v, kind, op, at, by, via?, reason?, in?, to?, state, ended?, links, fields}`. `workspace` is the `urlKey`, as in the local store (C5-D01). The current record is its highest `v`. Indexes on `{workspace, id, v}` and `{workspace, kind, state, to}`. Nothing is updated in place.
- **The modules,** in a new area named "Records". Everything except the store is pure:
  - `lib/records/kinds.json` holds the kinds and outcome sets as data (§3.2).
  - `lib/records/check.js` is the shape check (§3.3).
  - `lib/records/views.js` computes the views (§3.4).
  - `lib/records/brief.js` builds the brief and its text (§3.5).
  - `lib/records-store.js` reads and writes the collection, built once in `server.js` (C5-D03).
- **How they're built.** They are written fresh from §3, with walk 7's model as a reference, not the source. The model's 16 checks become their contract tests.
- **Actors are data, from the place that already declares them.** For Harbour, they are its stage kinds (`PROMPT_TEMPLATES`, 20 kinds, `lib/prompts/stage-kinds.js`) [checked], plus `autopilot`, `harbour`, and each person who belongs to the workspace, named as `person:<accountId>`. Another project supplies its own list, as §3.2 says. "John" in the layer is the workspace owner's person actor (`getWorkspaceOwnerAccountId`).
- **Who imports Records:** Agent API (proxy), Runs & dispatch, LLM & prompts (the selector's facts) and the pages. Records imports only Platform. So each slice adds one-way edges into a leaf area and no new mutual pair; the tightest pair, LLM & prompts ⇄ Runs & dispatch at 39/60, is untouched (`census/seams-6f6c5d2.json`) [checked]. The knots to call are in §10.

## 2. How agents reach it: the proxy

- **A router, `routes/proxy-records.js`,** on the existing factory pattern (C5 §C):
  - writes: `POST /records`, `POST /records/:id/revise`, `POST /records/:id/end` and `POST /records/:id/link`;
  - reads: `GET /records/:id[@v]`, `GET /records?…&asOf=` (find, with count) and `GET /tasks/:id/records` (show).

  A refused shape returns 422 with the reason. simple-dispatcher forwards any `/api/proxy/*` path, so it needs no change (break-read, "Checked and held") [checked].
- **Open to every token that may write.** The record routes add no per-stage allowance: any actor may write any kind, as §3.2 says. Today's restricted stamps keep limiting ticket writes, as they do now (C5-C06).
- **Who wrote it is bookkeeping in code.**
  - A dispatch's id is allocated before its prompt is finalised, which reverses today's order (`lib/dispatch-factory.js:14-20`) [checked]. The preamble then names the run: "your run: <id>".
  - A signalled follow-up carries its own prompt, so its own id (`sd:dispatcher.js:371`) [checked].
  - A write sends `run: <id>`. Harbour checks that row is live and in the token's workspace, and takes `by` from that row's stage. It uses the resolution that already exists: the row's own kind, or for a wake, custom resume or leftover, the parent's stage (`stampForWakeParent`, `stampForFollowUp`, `lib/item-stage-stamp.js`) [checked].
  - A write with no run, from a person's copy token or the UI, is `by` the token's or session's account: `person:<accountId>`.
  - `via` is kept only for real relays: an import or a scan.
- **Tasks are found or made by tracker id.** A `to` or `in` naming a ticket (for example `LIN-4451`) resolves to its task record. If the ticket has none yet, Harbour creates one from the tracker: `ref`, `asked`, and `in` the parent's task when the ticket has a parent. A hand-off to a sibling not yet dispatched therefore lands (paper walk B5).

## 3. How a stage gets its brief

- **The door stays.** The preamble's "Start from the distilled brief: GET …/brief/<id>" is kept (C4-34). Behind it, the brief is built from records (§3.5, parts 1–8) for the calling run's actor. Its header names the caller's own run, so the stage can revise its claims (paper walk B12).
- **"From the ticket", kept until slice 4.** While verdicts, plan comments and answers still live in ticket text, the brief ends with today's distilled brief, built by the same model, cache and code (C4-35, C4-37). The prompt keeps its "read the description and comment thread" line (C4-31). This is the one path kept on purpose. It goes in slice 4, when the last of those carriers has moved. Then:
  - the brief cache, the `formatIssueContext` input to it, and the chat tools' cache reads switch to the records brief (C4-44, `lib/chat-tools.js:290-297`) [checked];
  - the recap becomes `show --task` rendered short.
- **The blind read keeps having no brief** (`lib/proxy-preamble.js:270-276`) [checked]. Its prompt is given the change record's id to judge. It writes its verdict and findings through the record routes. The layer's `blind` flag hides others' verdicts and judges' accounts from its queries (§3.2).
- **When a task has no `paths` yet,** part 5 lists every area of the workspace with its open count: 13 lines for Harbour. The first stage that names files (survey-task, scoping or plan) sets the task's `paths`, and its prompt says so. *This adds to the layer's part 5. Flagged for John (§11).*
- **Size.** The brief's bytes are reported against walk 7's per slice, never gated. The frozen prompt-size test (C4-48) stays.

## 4. Runs, changes and verdicts

- **Run records.**
  - Harbour adds a `run` when a stage row is taken (C3-45). Wake, custom resume and leftover rows take their resolved stage (§2). Its id is kept on the dispatch row as `runRecordId`, so the engine row points at the record and the record needs no engine field.
  - On a terminal marker (C3-47), Harbour ends the run `done`, with the marker as its reason (`completed`, `failed`, `aborted`). `[skipped]` ends nothing.
  - The `account` is the run's final text, already sent as `assistant-text` chunks (C3-58).
  - The dispatch row stays the engine's queue, lineage, wake and cost state. The run record is what readers read.
- **Change records.**
  - The implementation stage adds a `change` (`ref` the PR, `head`).
  - Before any verdict is written `on` a change, the record route reads the PR's live head through the existing status read (C3-09) and revises `head` if it moved. A verdict therefore rests on the head it judged, and a stale flag that shows later is real (paper walk B6).
  - Harbour ends the change `merged` when it records the merge (C1-29).
- **Verdict records** (`judgement`, `outcome`, `reasoning`, `on` the change or plan piece).
  - Harbour's rule that a blind read names exactly the landing changes stays in Harbour's route, as now (`routes/proxy-writes.js:773-787`) [checked]. It is checked against the task's open changes. It is workflow, so it is not part of the store's check.
  - The stale flag replaces `findSha` and `headMoved` (C3-08, C3-09).
- **Every consumer of the classifier reads records instead** (C3 §"Consumers"): close-out, the selector's facts, look-first, run evidence and the measures. The Periodical gate is outside the layer and is kept (C3-23).

## 5. Rulings

- **simple-dispatcher's `DECISION:` and `WITHDRAW:` stay as they are,** and so does the runner kit's `decision` feedback (C2-01–C2-07; `lib/runner-kit/runner.mjs:258-265`) [checked]. When Harbour receives that feedback, it writes a `question` record:
  - `by` the row's stage (§2);
  - `in` the task, `about` the asking run;
  - `to` the owner, or a deciding stage.

  A withdrawal ends it. No other repository changes.
- **The question keeps today's per-answer effect** (resume, record or dispatch, C2 "Resume"), as a field `on-answer`. *This adds to the layer's question kind. Flagged for John (§11).*
- **An answer is a `decision` record** (`by: person:<accountId>`, `answers` the question), and the question ends `answered`.
  - The browser's existing resume carries out the effect, unchanged (C5-B10).
  - Harbour's answer route refuses a question that has already ended, which keeps the 409 (C2-13). That's a rule in the route, not in the store.
- **The rulings page** shows what is open for the signed-in person: questions, checks and findings, plus records left under an ended task with no parent. Shelving stays as page state, keyed by record id (C2-19). A suggested dismissal becomes a finding to the person, `about` the question. The size ruling becomes a decision `scope`d to the task.

## 6. Wakes

- **The engine's wakes are kept:** up-chain, leftover, CI sweep, person follow-ups (C5-B01–B07, B13).
- **Slice 6, optional.** One rule: a record that is open, `to` a stage or task with a run held waiting on that task, enqueues one follow-up through `enqueueFollowUp`. The compare-and-swap is per (run, record). It skips records written by the waiting run's own children, since the up-chain wake already covers those (break-read 13).
- **Areas wake nothing.** Their records reach the next task whose paths overlap them, through part 5 and `find --to`.

## 7. The tracker

- **Outward, a backup in summary.**
  - Harbour posts one marked comment per verdict, decision and plan version, and at each run's end a line listing what is open in the task.
  - It creates child tickets from child task records.
  - The selector, scan and the kept ticket section skip Harbour's mark, so nothing reads the summaries back (break-read 12).
- **Inward.**
  - A ticket's words become the task's `asked` (§2).
  - A person's later comment becomes a `finding` `by` that person, `to` the task, when Harbour next reads the ticket.
  - Closing a ticket ends its task (C2-27).
- **Which direction the sync leads in,** with the tracker as backup or Harbour holding the primary copy, is John's call (§11).

## 8. Pages for people

- **Slice 1:**
  - The task page lists records by kind, with their states and a preview of the brief.
  - It lets a person end, supersede or add records, and add a child task, all `by` their account (paper walk B10).
  - The session page shows the run's account.
  - Home's "Waiting on you" shows what is open for the person.
- **Slice 3:** the run-evidence box.
- **Slice 4:** the rulings page.
- **Slice 5:** lessons on the task page.

Counts come from `find --count`.

## 9. What is already in flight

The fleet is paused [checked: journey].

**At slice 1, a one-off import:**
- **Area records** come from `docs/areas/areas.json`. Its regex patterns are turned into the whole-segment prefixes the layer matches, checked by hand once for 13 areas (paper walk B4). From then on the area records are Harbour's source. A unit test checks that each pattern still matches its record's paths, so the measuring tools that read `areas.json` at past commits stay true.
- **111 Waiting entries** become `finding`s, `in` and `to` their area, `via: import`, each with its note line.
- **The seven safety entries,** tagged "Security Review" (`grep`: 7 across 5 notes, paper walk) [checked], become seven task records under one parent task. John: "a code collection of tasks to run through the improved loop" (asks.md:227).
- **The parked tickets** (LIN-4416, LIN-4210, and the paused lanes LIN-4441, LIN-4445 and LIN-4463) are filled into records after the fact, as walk 1 did, so they restart from records.

**At slice 4,** open loop and scan questions are imported. **At slice 5,** lessons are imported.

## 10. The slices

Each slice is built as a Harbour task through Harbour's own loop. So each slice's first real use is the task that builds the next one, running on the slices already landed. The witness is the test or recorded run that proves a slice works. Readings report and never gate (§2 of the layer).

| Slice | Moves | Retires in the same move | Witness | Reading before | Knot |
|---|---|---|---|---|---|
| **1. Store, runs, hand-offs** | Store, routes, run ids and `by`; run, task and area records; findings and checks (the ledger's not-run items, review and blind-read finds, leftovers, asks to a parent or sibling); the brief's record parts; the import; the pages above | Waiting writing and reading (C1-01–C1-11); the `Retires:` conveyor and its 422 (C1-15–C1-22), with the leftover stage now ending one finding; the ledger's item parse and counts (C1-26, C1-28–C1-31); the blind-read classes (C1-34) | Contract tests; walk 7's three tasks replayed through the proxy on a temporary store | Notes bytes and the Waiting count; brief bytes; sessions and cost per task (13–14 Nov) | Four one-way edges into Records. No new pair |
| **2. The plan** | Plan records with `piece`; breakdown writes child tasks; `asked` on the task record | Plan in the description and its parsers (C4-01–C4-13); the prune and `description/below` (C4-04, C4-19); the copy-down (C4-03); the As-asked seal and guard (C4-14–C4-18, C4-49); snapshots (C4-41, C4-42; Ship Biscuit's before and after reads plan versions instead) | A breakdown and a correction replayed: the child reads its piece, and a correction is a new version | Copied-count drift (trace 6); brief bytes | None new |
| **3. Verdicts and changes** | Verdict and change records; consumers read records; verdict summaries to the tracker | `COMMENT_KINDS` (C3-01–C3-06); the verdict parse and `findSha` (C3-07, C3-08); the blind-read guard's shape half (C3-17); the blind-read words, not the kind (C3-41); `extractVerdict` (C3-19); the comment census test (C3-59); the verdict-comment contracts (C3-27–C3-36) | Close-out and the selector replayed on walk 7: the same decisions as from the comments | Blind-read results; review round trips | None new |
| **4. Rulings, and the ticket section goes** | Question and decision records from the existing feedback; the rulings page | The predicate and its keyings (C2-08–C2-12); the task-decisions and dismissal stores and the two scripts that import them; answers as comments and `RULING_MARK` (C2-22, C2-23, C3-25); the size ruling's text (C2-43); the brief's ticket section, its cache and model, and the scripts that replay it (§3) | A question raised, shelved, answered and resumed, recorded end to end | Open rulings; time to answer; brief bytes | None new |
| **5. Lessons** | Lesson records with `paths` and `checked-at` | Notes' Lessons, the pointer and its tests (C5-A01–A06, A16–A18), and the notes files | A lesson flagged when a change touches its paths, then found in brief part 7 | Lessons bytes | None |
| **6. Wakes for open records** (optional) | The rule in §6 | Agents waking each other by hand for hand-offs (C5-B14) | A record to a held run wakes it once | Pause wakes that changed nothing | Records → Runs, one edge |

**Every slice leaves Harbour whole if the next never lands.** Whatever hasn't moved still travels as ticket text, and agents still see it through the brief's kept ticket section until slice 4.

## 11. For John

1. **When does the parked work run:** after slice 1, or after all the slices? It is read against the 13–14 Nov baselines and reported, never gating.
2. **The tracker:** a backup in summary with Harbour holding the primary copy (§7), or the other way round?
3. **Two small additions to the approved layer:**
   - part 5 lists every area while a task has no paths (§3);
   - the question kind gains `on-answer`, keeping today's three effects (§5).
4. **Rulings as their own slice 4,** rather than inside hand-offs as the journey had it. The census shows 50 sites (C2).
5. **Slice 6:** build it, or wait until hand-offs show the need.
6. **Knots:** each slice adds only one-way edges into Records, and no new pair. My call is to accept them all, with nothing to tidy first.
