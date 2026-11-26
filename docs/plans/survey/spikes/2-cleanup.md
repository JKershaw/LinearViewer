# Spike 2: the clean-up ticket

Read-only, 26 Nov. Code: LinearViewer main 5c33e4415, simple-dispatcher (SD) main d692ac7.
Live records read through the proxy (GET only). Each claim is **shown** (with where) or **unknown**.

## 1. Hand-back findings with no owner (finding-145b1665)

- **Already fixed. Shown.** LIN-4521 added a line to the review contract:
  "Read the open findings `to` `review` ... On Approve, end each" (`lib/prompts/stage-kinds.js:429`).
  The brief shows them in full under "Addressed to it" (`lib/records/brief.js:102`).
- **Live, shown:** 66 findings to review were ever written. 0 are open. 65 were ended by review,
  each citing its verdict, and 1 by close-out (finding-d3318a88).
- The finding is dated 22 Nov 19:28, before the first hand-back was written (22 Nov 23:08).
- **Smallest change:** no code. End finding-145b1665 `done`, citing stage-kinds.js:429 and the count.
- **Overlap:** the hand-back list is what item 3 needs: the list of fixes a re-review checks.

## 2. Edited piece plans owe no fresh plan review

- **Real in code. Shown.** A plan review is only owed for a task's *own* plans; pieces are left out
  (`lib/records/plan-facts.js:93,99-104`). The selector says so: "No plan review is owed (a piece of
  an approved parent plan included)" (`stage-kinds.js:342`). A child may revise its own piece
  (`lib/prompt-template-defs.js:317`).
- **Rare in practice. Shown:** 46 piece plans. 41 are still v1. 5 were revised, all on LIN-4513
  (slice 3), on 21–22 Nov. 4 of the 5 were edited with the person's token, applying John's rulings;
  1 was edited by breakdown, also for a ruling. No child has ever revised its own piece. No plan-review
  verdict is on any piece.
- **The safety net exists. Shown:** review judges against the person's words (`asked`) of the task
  and each parent, not the piece (`brief.js:76-83`; the review template opens on that block).
- **Smallest change:** none. Rule-shaped re-review of a piece would mostly re-review John's own
  rulings, which is friction (the donut). Drop it from the ticket. Reopen only if a child revises
  its piece and review misses the drift. **Unknown:** whether that will ever happen.

## 3. A1: a re-review adds a new condition each round

- **Still real. Shown.** On LIN-4549 (24 Nov), re-reviews at 11:35 and 11:46 each added one new
  "inside" condition of the same idiom (finding-0a8be5dd, finding-86bab069).
- It went on after the ruling. On LIN-4342 (25 Nov) there were 4 approvals in 40 minutes. The
  re-review at 17:25 added finding-a3c7edb1 ("same class as finding-08caa94e"); the one at 17:41
  added finding-8f306133 ("same class as finding-a3c7edb1").
- Across all tasks: 44 of the 53 reviewed tasks had 2 or more review verdicts, and 18 had 3 or more (shown, verdict records).
- **Why John's ruling didn't reach them. Shown:** decision-5dbdf161 is `in` LIN-4546's task, with
  no `scope`. A brief only carries decisions in its own task, or ones scoped to `project` or a parent
  (`brief.js:114-117`). No live decision is scoped to project (0 of 21).
- **Mechanism. Shown:** every review gets the same full prompt. Two parts of it re-open the work:
  - the class search: "Search for the pattern itself ... an inside sibling becomes a finding to
    close-out" (`prompt-template-defs.js:697-699`), where "inside" is broad: "the list is evidence of
    the class, not its edge" (`:706`);
  - the contract tells a re-review to "judge the commits each lists **with the change**"
    (`stage-kinds.js:429`), meaning the whole change again.
  Each new condition needs a commit, and the commit makes the approval stale (`:805`).
  So the next round runs the class search again.
- **Smallest change:** rewrite that one existing sentence in `stage-kinds.js:429` in John's words.
  A review that close-out handed back judges whether the listed commits meet the conditions they
  answer. Anything new and small is a finding to project, not a new condition.
  This is a judgement in an existing line, not a new rule or check. Prompt size is frozen
  (`tests/unit/prompt-size-budget.test.js`), so the few bytes need a reason recorded or an offset.
- **Not chosen:** scoping John's decision to `project` would cost no code, but every stage's brief
  would then carry it. A code gate on re-reviews would be a rule written in code (the donut).
- **Witness:** the next real hand-back, on any task. Its re-review should end with no new finding to
  close-out, only findings to project. Count it from records: the findings to close-out written by
  review after the first approve (LIN-4549 had 2, LIN-4342 had 2).
- **Retires:** the review rounds that add conditions, and the autopilot quoting John's ruling by hand.
- **Overlap with finding-34ab47ef / slice 6:** this cuts the number of rounds. Each round avoided
  is one less close-out⇄review deadlock. But it does not fix the deadlock: close-out still parks, and
  review is still refused STAGE_IN_FLIGHT. That stays in slice 6.
- **A larger option, John's call:** if close-out's commits for review's own conditions did not make
  the approval stale (the LIN-4521 ruling, reversed), then the hand-back, the re-review loop and most of
  34ab47ef's deadlock would all go together. Too big for a clean-up ticket.

## 4. Raw secrets in old feedback rows (finding-ce6e4602)

- **Reads are already masked. Shown.** These all mask with the same masker:
  - the raw API read (`routes/proxy-dispatch.js:108`, LIN-4560);
  - the run page and Dispatch history (`lib/dispatch-transcript.js:44`, `lib/sessions-view.js:73`);
  - intake, before storing (`lib/dispatch-store.js:4042`, LIN-4556).
  The finding's "raw API read" is out of date.
- **What's left. Shown:** rows from before LIN-4556 still hold their text unmasked in the database.
  **Unknown:** whether any other reader shows that text unmasked. About 30 modules read `feedback`,
  most only for counts and markers. Examples: run-summary, chat-tools, dashboard-feed.
- **How many rows: unknown.** 28,419 dispatch rows in total. Through the proxy I can only see masked
  text. A masked field reads `[redacted]`, so before-intake rows with one are rows that still hold a
  secret. In a sample of 35 older rows (LIN-4513, 6,777 entries) none had one. SAMPLE2. That is not a count.
- **Smallest safe backfill:** one script with a dry run first, like `scripts/dry-run-owner-backfill.mjs`:
  - run each stored message/url/urlLabel through `maskFeedbackFields`, the function the read uses;
  - count the rows and entries that change, printing only ids and rule ids;
  - rewrite only the fields that change, and only after John's go.
  It is a production data operation, and agents have no production access (notes D16), so a person
  runs it. If the dry run counts 0, end the finding with that count and stop.
  **Unknown:** a key split across two stored chunks. The read path does not catch it either.
- **Retires:** remembering to mask on every new reader of old rows.

## 5. The reaper can delete a record with words still queued (finding-c93ea0bb)

- **Still real on SD main. Shown.** Both record reapers delete the session without checking
  `outbox.hasQueued` (`reapers.js:3409-3431` for BLOCKED, `:3540-3556` for terminal).
  The outbox never bumps `updatedAt` (no write in `assistant-text-outbox.js`). A missing token is
  retried forever (`:370-374`, `:364`).
- **How serious. Shown:** the reapers wait 7 days of no activity (`config.js:597`). So words are only
  lost if Harbour or the token is missing for a week. When that happens, no oplog line is written.
- **Smallest change:** drop the words loudly. Inside each reaper's existing `updateState` mutator, a
  record with queued words still goes, but first logs `assistant-text.reaped` with the count.
  Keeping the record instead would bring back the growth LIN-3585 removed, since a no-token retry
  never ends.
- **Witness:** an SD unit test (`npm test`): a terminal record and a BLOCKED record, each idle past
  the window with words queued. Both are reaped, and each writes the oplog line with its count.
- **Where it belongs:** the reaper file is shared with notes C10–C13 (resume race, leaked windows,
  restart). If those become their own SD ticket, this item should go with them.

## Also: finding-554005cc

This is a person's check: John looks at the transcript on a real phone, in light and dark mode.
It has no code. It stays addressed to John, and he ends it when he has looked. Not part of the ticket.

## What changes the plan

- Item 1 is already done. Item 2 is real but has never been needed; drop it. Neither needs a build.
- Item 3 is the core of the ticket. It is one sentence, but it needs a runtime witness.
- Item 4 is a person's production step after a dry run, not a build.
- Item 5 may fit an SD runner ticket better.
- The close-out⇄review deadlock (34ab47ef) stays in slice 6. Item 3 makes it happen less often.

## The ticket's outcomes

1. **A re-review checks only the fixes for the conditions it set; anything new and small goes to
   project** (John, decision-5dbdf161). Why: approvals keep going stale and each round adds a
   condition (LIN-4549, LIN-4342), and the ruling only reached one task. Witness: the next real hand-back.
2. **Old feedback rows are counted, and masked if any hold a secret.** A dry run gives the count,
   John decides on the rewrite. Why: reads are masked now, but the stored text is not.
3. **No queued words disappear silently when a record is reaped** (SD). Why: a lost run's words
   should leave a trace. Unless this goes with an SD runner ticket.
4. **Findings that the work has overtaken are ended with the evidence:** finding-145b1665 (fixed by
   LIN-4521; 0 of 66 open) and the piece-plan item (5 of 46 revised, all John's rulings).
   Why: the project pile should only hold live work.
