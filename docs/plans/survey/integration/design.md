# The layer in Harbour: integration design

*Draft, 18 Nov, for John to correct. It follows `integration/plan.md` and rests on the census in `census/C1–C5` (main at `6f6c5d2`), whose row ids (C1-12 and so on) are cited here. The approved design is `layer/design.md`. It is called "the layer" below, with its sections given as §3.1 and so on. Marks are as on `situation.md`. Lines with no mark are design, mine until John corrects them.*

## 0. What the census changed

Expectations were in `expect.md`, committed before the census. Five of them were wrong, and the design below follows the census, not the guesses:
- **The brief already has one door.** Stage prompts carry no ticket text. They point the worker at `GET /api/proxy/brief/<id>`, and the plan reaches the worker only there (C4-31, C4-34, C4-38) [checked]. So the layer's brief replaces what sits behind that door, and `generatePrompt` hardly changes.
- **A proxy token does not know its dispatch.** It doesn't know its stage either, for the work stages (implementation, review, close-out) (C5 §"What a proxy request knows") [checked]. For `by` to come from the caller's credential, the dispatch mint has to record both.
- **"Not run" is a parsed ledger,** not loose prose. It has a discharge read made by regex (C1-23, C1-26) [checked].
- **Verdicts have three value parsers, not one classifier** (C3-07, C3-05, C3-19). The only tie to a version is a sha regexed from the review prose (C3-08) [checked].
- **Rulings are wider than I guessed.**
  - There's no ruling record: a question is feedback on a dispatch row, raised by simple-dispatcher's `DECISION:` scan (C2-01–C2-10).
  - It carries nine keyings (C2 §"Keying").
  - Each answer is held twice: a comment, and a stamp written after it on a best-effort basis (C2 §"Loose ends") [checked].

## 1. Where the store lives

- **One collection, `records`, with one document per version:** `{scope, id, v, kind, op, at, by, via?, reason?, in?, to?, state, ended?, links, fields}`. `scope` is the workspace's `urlKey`, as in the local store (C5-D01). The current record is its highest `v`. An index on `{scope, id, v}` and one on `{scope, kind, state, to}` serve the open view. Nothing is updated in place, so every version is kept with no array that grows.
- **The modules,** in a new area named "Records". Everything except the store is pure, as CLAUDE.md asks:
  - `lib/records/kinds.js` holds the kinds, actors and outcome sets as data (§3.2).
  - `lib/records/check.js` is the shape check (§3.3).
  - `lib/records/views.js` computes open, answered, stale, counts, overlap and "under an ended task" (§3.4).
  - `lib/records/brief.js` turns records into a brief, plus its text rendering (§3.5).
  - `lib/records-store.js` does reads and writes on the collection, built once in `server.js` and passed down like the other stores (C5-D03).
- **They are ported from the walk 7 model** (`layer/walks/7/model/layer.mjs`, 296 lines). Its test (16 checks) becomes the contract tests for these modules.
- **Who imports it.** The proxy (Agent API), the pages, and Runs & dispatch (for run and task records). The Records area imports only Platform. Today's tightest pair is LLM & prompts ⇄ Runs & dispatch, at 39/60 (`census/seams-6f6c5d2.json`) [checked]. The design adds no import between those two. Each slice's knots are listed in §10 for John to call.

## 2. How agents reach it: the proxy

- **A router, `routes/proxy-records.js`,** built on the existing factory pattern (C5 §C, "New endpoint"). It mirrors the model's commands:
  - writes: `POST /records`, `POST /records/:id/revise`, `POST /records/:id/end` and `POST /records/:id/link`;
  - reads: `GET /records/:id[@v]`, `GET /records?kind=&in=&area=&path=&to=&state=&text=&count=&asOf=`, `GET /tasks/:id/records` (show) and `GET /brief/:id` (§3).
- **Write gate.** Each write is an op in `STAGE_WRITE_OPS` (C5-C06). Restricted stamps (blind read, one-comment) get only the record writes their stage needs. A refused shape returns 422 with the reason, as the model's exit code 2 did.
- **Who wrote it comes from the credential, never from the body.** The dispatch mint (C5-C07) records the run's item id and its stage on the token row. `validateToken` then sets `req.proxyItemId` and `req.proxyStage` (C5-C03).
  - A write's `by` is the stage's actor.
  - Its run is the item id's run record.
  - `via` is the token label for a relay, such as the autopilot writing for a child.
  - In the UI, a signed-in person writes as `john`. Harbour's own writes are `by: harbour`.
  - This is the one change to the token model.
- **Instructions.** `GET /api/proxy/instructions` and `docs/proxy-integration.md` describe the records routes (C5-C10). The text the stage templates carry shrinks, since the routes explain themselves.

## 3. How a stage gets its brief

- **The door stays.** The preamble's "Start from the distilled brief: GET …/brief/<id>" is kept (C4-34). Behind it, `GET /api/proxy/brief/:id` builds the brief from records with `lib/records/brief.js` (§3.5, parts 1–8) for the calling actor (`req.proxyStage`). It is deterministic, cached by nothing, and sized in bytes in its own reply.
- **No model smooths it at first.** Walk 7's stages worked from the deterministic brief. Smoothing stays possible (§3.5) and would be added only if a slice's reading shows it's needed.
- **The recap** (`GET /recap`, used by the autopilot and the Flight Companion, C4-39, C4-43) becomes `show --task` rendered short. It reads states and counts, with no model.
- **Prompt text.** The pass-by-reference line, "read the current description and comment thread" (C4-31), becomes "start from the brief; the records are the source, look up the rest". The frozen prompt-size test (C4-48) stays, and this edit lowers it. The brief itself is not covered by that test, which is true today as well (C4 §4). Its size is reported per slice against walk 7's figures, never gated.
- **While the plan is still ticket text (slices 1 and 2),** brief part 2 is filled by today's model distillation of the description's plan section alone. This is a kept path, named here, and it goes in slice 3.

## 4. Runs, changes and verdicts

- **Run records are written by Harbour from what the engine already sees:**
  - When a dispatch row is taken (C3-45), `add run` goes in the task with its `stage`.
  - The stage revises its own run's `claims` through the proxy once it knows its paths.
  - When the terminal marker lands (C3-47), Harbour ends the run as `done` with `account`. The account is the run's final text, already sent as `assistant-text` chunks (C3-58), joined in order.
  - The dispatch row stays the queue and the engine's state (lineage, wakes, cost). The run record is what readers read. They hold different things, so this is not a second copy.
- **Change records.** The implementation stage adds a `change` with the PR's `ref` and `head`. Harbour revises its `head` wherever it already reads the live PR head: the close-out state (C3-09) and the CI sweep (C3-57). Staleness then works as in §3.4.
- **Verdict records.** Plan review, review and blind read write a `verdict` through the proxy, with `judgement`, `outcome`, `reasoning`, and `on` the change or plan piece at its version.
  - The shape check replaces the proxy's blind-read guard (C3-17).
  - The stale flag replaces `findSha` and `headMoved` (C3-08, C3-09).
- **Each consumer of the classifier reads records instead** (C3 §"Consumers"):
  - Close-out reads the review verdict's outcome and staleness, and whether a blind read is on record for the change.
  - The selector's facts read verdicts and runs.
  - The look-first step reads whether a survey run has ended.
  - The run-evidence pages read the verdict fields.
  - The measures (round trips, churn, effort, blind-read stability) read verdict records.
  - The Periodical gate is not part of the layer and is kept as it is (C3-23).

## 5. Rulings

- **A question is a record** (`asks`, `options`, `recommended`, `if-unanswered`; `to: john` or a deciding stage), `in` the task, `about` the asking run.
  - Agents write it through the proxy, like any hand-off.
  - A scan writes the same record (C2-17).
  - simple-dispatcher's `DECISION:` and `WITHDRAW:` protocol (C2-01–C2-05) goes in the same slice, a change in that repository.
- **An answer is a decision record** (`by: john`, `answers` the question), and the question ends `answered`.
  - No comment is posted as the carrier; the tracker gets a summary (§7).
  - "Answered elsewhere" is the store's version check, so the 409 shape (C2-13) can stay.
- **Resuming.** When a question ends, Harbour wakes the asking run if it is parked waiting (C3-51). Otherwise the next stage finds the decision in brief part 4.
  - Today's three effects (resume, record, dispatch) become one rule: wake the asker if it is waiting.
  - This is a change from today, flagged for John (§11).
- **The rulings page** shows the open view `to: john` for questions, checks and findings. That's John's whole to-do list, which today has no home for checks (C1 "Corrections", E3).
  - **Shelving** stays as page state keyed by record id (C2-19).
  - **A suggested dismissal** becomes a finding `to: john`, `about` the question.
  - **The size ruling** (C2-43) becomes a decision with `scope` set to the task.

## 6. Wakes

- **Kept as they are:** up-chain wakes, the leftover wake, the CI sweep and person follow-ups (C5-B01–B07, B13). They belong to the engine.
- **One new rule.** After a record is written, if it is open and its `to` is a stage or task with a run parked waiting on that task, Harbour enqueues one follow-up to that run through the existing `enqueueFollowUp`. It uses a compare-and-swap per (run, record), and never fires for a record the run wrote itself.
- **A record `to` an area wakes nothing.** It reaches the next task whose paths overlap that area, through brief parts 5 and 7.
- **Sideways asks** become records `to` another task. If that task has a parked run, the rule wakes it. Otherwise they wait in its brief. That replaces agents waking each other by hand with `followUpTo` (C5-B14) for hand-offs.
- **Slice 6 is optional** (§10). Hand-offs reach their readers through the brief without it.

## 7. The tracker

- **Written outward, as a summary.**
  - Harbour posts one marked comment per verdict or decision, and one per plan version, rendered from the record.
  - It creates child tickets from child task records, so the tracker's tree matches.
  - Nothing reads these back.
- **Read inward:** a new ticket's words become the task record's `asked` at its first dispatch, and closing a ticket ends its task (C2-27, kept and pointed at records).
- **Tasks Harbour hasn't seen yet** get a task record at first dispatch: `ref` is the ticket's id, `asked` is the As-asked block or the description, `paths` are blank until a stage sets them.

## 8. Pages for people

Each slice finishes where its change shows up:
- Slice 1 updates the task page (records by kind with states, a brief preview with its bytes) and the session page (the run's account).
- Slice 2 updates the run-evidence box.
- Slice 4 updates the rulings page.
- Slice 5 shows lessons and areas on the task page.

Counts come from `find --count --as-of`. No new page.

## 9. What is already in flight

The fleet is paused, so no route runs old and new side by side for live work [checked: lanes paused, journey].
- **Waiting entries.** At slice 1, a one-off import writes each of the 118 Waiting entries (C1-03) as a `finding` `in` and `to` its area, `by: harbour`, `via: import`, with the note line it came from.
- **The seven safety findings** go in the same import. Each is `to: john`, or to its area if John says so.
- **Open rulings.** At slice 4, open loop and scan questions are imported as question records.
- **The paused lanes** (LIN-4441, LIN-4445 and LIN-4463) and LIN-4416 and LIN-4210 are filled into records after the fact, as walk 1 did, before they restart as the first real work.
- **Lessons** are imported at slice 5.

## 10. The slices

For each slice the table gives: what it moves, what it retires in the same move, what it keeps, the witness (the test or recorded run that proves it), the reading taken before it lands, and any knot. Census rows are placed in full in Appendix A.

| Slice | Moves | Retires | Kept for now | Witness | Before-read | Knot to call |
|---|---|---|---|---|---|---|
| **1. Store, brief, hand-offs** | Records store, proxy routes, `by` from the token, run and task records, the brief from records, findings and checks (the ledger's not-run items, review and blind-read finds, leftovers, asks to a parent). Import (§9) | Waiting writing and reading (C1-01–C1-11), the `Retires:` conveyor and its 422 (C1-15–C1-22), the ledger's item parse and counts (C1-26, C1-28–C1-31), the blind-read classes (C1-34), the brief model as brief input (C4-35) and its cache (C4-37 brief) | The leftover stage (C1-12–C1-14): it now ends one finding. The plan part of the brief (§3), until slice 3. The recap model, swapped in this slice | Contract tests (the model's 16 checks); walk 7's three tasks replayed through the proxy on a temporary store | Notes bytes and Waiting count; brief bytes (walk 7); sessions and cost per task (13–14 Nov) | Proxy → Records and Runs → Records: new edges, no new pair |
| **2. Verdicts, changes, runs read** | Verdict and change records; consumers read records; the tracker summary for verdicts | `COMMENT_KINDS` and `commentKindOf` (C3-01–C3-06), `parseRunLedger`'s verdict and `findSha` (C3-07, C3-08), the blind-read guard and words (C3-17, C3-41), `extractVerdict` (C3-19), the comment census test (C3-59), the verdict-comment contracts (C3-27–C3-36) | The Periodical gate (C3-23); the engine's run facts (C3-44–C3-54) | Close-out and the selector replayed on walk 7's tasks give the same decisions as on the comments | Blind-read results; review round trips | Pages → Records |
| **3. The plan as versioned state** | Plan records with `piece` links; child tasks written by breakdown; `asked` on the task record | Plan in the description and its parsers (C4-01–C4-13), the prune and `description/below` (C4-04, C4-19), the copy-down (C4-03), the As-asked seal and its guard (C4-14–C4-18, C4-49), snapshots (C4-41, C4-42), the brief's kept plan part | The selector's condensed view, if routing still reads ticket text (C4-21); else retired | A breakdown and a correction replayed: the child reads its piece, and a correction is a new version with no copy left behind | Copied-count drift (trace 6); brief bytes | LLM & prompts → Records, if the selector reads plans |
| **4. Rulings** | Question and decision records; the rulings page on the open view; SD's protocol | The predicate and its keyings (C2-08–C2-12), the task-decisions and dismissal stores (C2-16, C2-20), answers as comments and `RULING_MARK` (C2-22, C2-23, C3-25), SD's `DECISION:`/`WITHDRAW:` (C2-01–C2-05), the size ruling text (C2-43) | Shelving, rekeyed (C2-19); the closer (C2-27) | A question raised, shelved, answered and resumed, end to end, with the page recorded | Open rulings; time to answer | Front end → Records |
| **5. Lessons and areas** | Lesson records with `paths` and `checked-at`; area records | Notes' Lessons, the pointer and its tests (C5-A01–C5-A06, C5-A16–C5-A18), the notes files | `areas.json` as the one source of area paths, read by the code-shape tools (C5-A19, C5-A20). Area records are written from it at boot (§11) | A lesson flagged when a change touches its paths; a stage finds it in brief part 7 | Lessons bytes (near cap, C5 §A) | None expected |
| **6. Wakes for open records** (optional) | The rule in §6 | Agents waking each other by hand for hand-offs (C5-B14) | All engine wakes | A record to a parked run wakes it once | Pause wakes that change nothing (`wake-inventory.md`) | Records → Runs (one edge, the wake call) |

**Every slice leaves Harbour whole if the next one never lands.**
- After slice 1, verdicts are still read from comments and the plan from the description, as today.
- After slice 2, the plan is still ticket text, behind the brief's kept part.

**The only paths kept on purpose** are the brief's plan part (it goes in slice 3) and the recap model (it goes in slice 1). Every other old route is deleted in its own slice.

## 11. For John

1. **Rulings get one rule for resuming:** wake the asker if it is waiting. Today's resume, record and dispatch effects go (§5).
2. **Area paths:** `areas.json` stays their one source, and area records are derived from it (§10, slice 5). The other way round, records as the source, would mean the code-shape tools read the store.
3. **Who the safety findings are addressed to** at import: `john` or their areas (§9).
4. **Slice 6:** build it, or wait until hand-offs show the need.
5. **Rulings as their own slice 4,** rather than inside hand-offs as the journey had it. The census shows 50 sites and a second repository (C2).
6. **Knots,** per slice in §10: tidy before, tidy after, or accept. My reading is that none needs tidying first.

## Appendix A: where each census row goes

*Retire* means deleted in that slice. *Change* means kept but pointed at records in that slice. *Keep* means unchanged, with the reason.

**C1 (hand-offs)**
- **Retire in slice 1:**
  - 01–11: Waiting entries (05 keeps its Lessons cap until slice 5; 09 and 10 are rewritten to write findings).
  - 15–22: the leftover prompt, spellings, checker, refusal, instructions, review check, close-out lines and their tests.
  - 26: the item parse; the verdict part goes in slice 2.
  - 34: the blind-read classes.
- **Change in slice 1:**
  - 12–14: the leftover stage ends a finding.
  - 23–25: the review and close-out prompts write checks and findings.
  - 28–32: counts and pages read records.
  - 37: an ask is a finding to the parent.
  - 38: look before adding.
- **Slice 2:** 27 (`readTrail`), 33 (follow-on ratio), 35 (blind-read shape), 36 (comment kinds).
- **Slice 4:** 39–41.
- **Keep:**
  - 42–47, run proposals: an owner's Apply or Decline on a chat turn, which is workflow, not a hand-off.
  - 48, the up-chain wake: engine.

**C2 (rulings)**
- **Slice 4, all rows except the following:**
  - 13: kept, as the 409 shape.
  - 19: kept, rekeyed to record ids.
  - 21: changed, as store wiring.
  - 27: kept, ends records.
  - 44: already gone.
  - 45–50: tests, replaced.

**C3 (verdicts and runs)**
- **Retire in slice 2:** 01–08, 17, 18 (the request-changes reasoning arrives in brief part 4), 41, 59.
- **Change in slice 2:**
  - 09, 10, 12–16, 19, 22, 24, 39, 40, 42, 43: they read records.
  - 27–37: the prompts write verdict records.
  - 57: the CI sweep also revises the change's head.
  - 60, 61: tests.
- **Slice 1:** 11 (counts from records), 55 (the session page shows the run's account).
- **Slice 4:** 20 (the ruling label), 25.
- **Keep:**
  - 21: routes.
  - 23, 38: Periodicals, outside the layer.
  - 26: the provider.
  - 44–54, 56: engine and cost. 46 and 47 gain the run-record write in slice 1.
  - 58: transport for the account.

**C4 (the plan and the brief)**
- **Slice 1:**
  - 20: stops feeding the brief. It's kept for scan and task chat, which read the ticket itself.
  - 31, 34: wording.
  - 35–40, 45, 46: the brief and recap from records.
  - 37: the brief cache is retired.
- **Retire in slice 3:** 01–19, 41, 42, 49, and the brief's kept plan part.
- **Change in slice 3:** 07 (the pilot takes plan paths from records), 21–23 (the selector's plan facts from records), 32 (surveys quote `asked`).
- **Keep:**
  - 24–30: `generatePrompt` and its callers.
  - 33: custom prompts.
  - 43, 44: pointers to the same door.
  - 47: scan and chat.
  - 48: the budget, lowered in slice 1.
  - 50: tests, replaced per slice.

**C5 (lessons, areas, wakes, the proxy, stores)**
- **Slice 1:** A05 (the Waiting parse), A07, A08 (Waiting part), A09, A10, A11 (Waiting part), A12, A15 (Waiting part), A21 (counts from records).
- **Slice 5:** A01–A04, A06, A08 (Lessons part), A11 (Lessons part), A13, A14, A15 (Lessons part), A16–A18.
- **Keep:**
  - A19 and A20: `areas.json` as the source (§11.2).
  - B01–B09, B13 and B15: engine.
  - B14: kept, but slice 6 replaces its use for hand-offs.
  - C01–C13: the proxy, extended in slice 1 (C03, C04 and C07 for the item id and stage; C06 and C10 for the record ops and their instructions).
  - D01–D05: the pattern the store uses.
- **Slice 4:** B10–B12.
