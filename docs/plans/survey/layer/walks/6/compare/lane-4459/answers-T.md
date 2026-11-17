# Answers, Reader T (ticket), lane LIN-4447 at LIN-4459's close-out, 2026-11-13T17:04:57Z

Read only `ticket.md` (LIN-4459 with its comments, LIN-4447 with its description and comments to 17:04:57Z, and the Runs & dispatch area note) and `questions.md`.

**One inconsistency to flag first.** The area note is headed "as committed on main before 17:04:57Z", but it already carries LIN-4459's changes: the `runFact` Waiting entry is gone, the claim compare-and-set entry is there marked "Moved from the LLM & prompts note by LIN-4459", and the lineage Lesson names LIN-4459. Every LIN-4459 comment, the last at 17:04:26, says PR #2432 is still open and not merged. I can't tell from the ticket whether #2432 had merged by 17:04:57. My answers take it as open, which is what the ticket says, and note where the area note differs.

## 1. What is still open across the lane, and whose is each item

- **LIN-4459 (piece 4), close-out stage (this one).** PR #2432 is open and mergeable at head `7424cfb8f`, with CI green. The review (17:01:55) says "Approve, conditional on close-out discharging the ledger". Close-out owns:
  - (a) Fix 1: add the `FEEDBACK_ENTRY_KINDS` re-export bullet to the PR body's `## Retires`.
  - (b) Tell LIN-4448 about the `runner-kickoff.js` import change and the LLM-note entry it retires. Then either get a reply that confirms, or record that 08c9c898 already covers it.
  - (c) Before the merge: CI green on the exact commit merged. Rebase if LIN-4458 or LIN-4465 lands first, and keep lin-4392's LIN-4459 block green.
  - (d) After the deploy: watch for one real parked-then-blocked or parked-then-skipped ticket. If none turns up, record "not yet observed". The named monitor is the "Lineage recompute lost its compare-and-set" `console.error` plus recommendation latency. The rollback is reverting the merge commit.
  - The blind read (17:04:26) also left two fix-sized items in Runs: the garbled header and stale `dispatch-store.js:95` citation in `session-run-transcript-entries.test.js`, and the two `blocked`→`WAITING_ON_A_PERSON` mappings in `runFact`. It left two larger items: the outcome words now have two homes (`run-live-wait.js` and `recent-runs.js`), and a parked stage is dated by its park time, which needs a store change.
  - The builder flagged one finding "for a person": a stage that is not parked but is blocked by a follow-up still holds the wait (LIN-4447 comment 16:42:08). It has no owner yet.
- **LIN-4458 (piece 2, one trail pass).** Open, in progress. Characterization tests and engineering calls are posted (16:42:22). The LIN-4459 review warns "if LIN-4458 merges first", so it has not merged. Owner: the LIN-4458 builder.
- **LIN-4460 (piece 1, close-out decision).** Not done. It is blocked by LIN-4458 and LIN-4459. Its merge needs a recorded review Approve. Owner: its builder (Runs).
- **LIN-4461 (piece 8, simple-dispatcher).** Not started. It waits on LIN-4460, and its plan is set at its own start. Owner: Runs.
- **LIN-4462 (piece 0 repeat, the after-reads).** Not started. It waits on LIN-4461.
- **Done or landed:** LIN-4453 (piece 0) is Done, per the parent description. LIN-4454, 4455, 4456 and 4457 look landed, because their Lessons and settled entries are in the area note. LIN-4455 had PR #2427, and LIN-4459 removes the re-export it left. The ticket never states these four tickets' statuses directly.

Read: LIN-4459 comments 16:42 to 17:04; LIN-4447 Breakdown (14:02), Rulings (15:34), LIN-4458 comment (16:42:22) and LIN-4459 departure (16:42:08); the area note.

## 2. Asks to LIN-4448 (A14), and what LIN-4459 still has to tell it

- **The three seam moves** (classifier home in `run-trail.js`; live-wait to `run-live-wait.js` with no shim; `blindReadStep` reading `closeOutDecision`). Posted by the Unblock comment (13:37). **Answered** "agree to all three" at 15:39 (08c9c898). A correction followed at 15:55 (097a3442): LIN-4448's pieces edit more Runs files, including LIN-4465's comments in `recent-runs.js`, which collide with LIN-4459. The seam moves were unchanged.
- **LIN-4458's renewed ask** (1a2e7cba, about 16:42, adding the census boundary). The ticket shows no reply, and the builder said he would not wait for one.
- **LIN-4459's renewed ask** (0510ffe0, posted 16:42, after the build). **No reply** as of the 17:01 review.
- **Still to tell LIN-4448 before the merge:** the PR also changes `lib/prompts/runner-kickoff.js` to import `FEEDBACK_ENTRY_KINDS` from the leaf `lib/dispatch-feedback-kinds.js`, and so retires the LLM-note Waiting entry from LIN-4455's blind read. Then one of two things: LIN-4448 replies to confirm, or close-out records that 08c9c898 ("whichever of us lands second changes only the import path") covers the move. That record must say the runner-kickoff change touches only an import path and leaves the prompt bytes unchanged (`runner-kickoff.test.js`).

Read: LIN-4447 comments 13:37, 15:39 and 15:55; the review on LIN-4459 (17:01, "Before starting" bullet and "What CI Did Not Prove").

## 3. How piece 4 finds the terminal of a stage parked `[pending]`

- **The approved plan** (with reviewer note 5): pass the lineage's unfiltered rows to `runFact`, and resolve the terminal with `resolveFollowUpRoot` and `heldWakeHolderOf` before filtering and the `HISTORY_ROWS` window.
- **Overridden by the builder** in LIN-4447 comment 16:42:08 (d3553049). The reasons: those helpers are async store walks, one row at a time, and they go up, while a parked stage needs its descendants. The callers are pure and synchronous. A second walk would be a second definition of "ended".
- **What stands now:** `loadRecentRuns` asks `listHistory({ withLineage: true })`, which is one batched lineage read through `deriveLineageFields`. `runFact` takes the lineage word (`blocked`, `skipped` or a terminal) only for a row that is parked `[pending]` and has no terminal of its own. A stage that is not parked stays as before. The review agreed with the departure and checked that follow-ups inherit `rootItemId` (`dispatch-factory.js:724`). The area Lesson now says: read it batched with `withLineage`, never with a walk per row.

Read: LIN-4447 Implementation Plan piece 4, reviewer note 5 (13:57) and comment 16:42:08; LIN-4459 review (17:01); the area note Lessons.

## 4. Waiting entries in the Runs & dispatch note now, and which originals this lane settled

- **18 Waiting entries** stand in the note as given. Thirteen are original entries: 1, 3, 5, 6, 7, 10, 12, 13, 15, 16, 17, 18 and 20. Five are new: the claim compare-and-set entry moved in from LLM, the area-read entry (LIN-4453), the cost-read-calls figure rule (LIN-4457), `mayCarryWake` (LIN-4455) and `testTransport` (LIN-4456).
- **Original entries settled so far (seven):**
  - 2, 4 and 11: halt modes, release wording and feedback kinds, by LIN-4455.
  - 8: `dispatch-factory` provider name, by LIN-4456.
  - 9: the `cost-read.js` split, by LIN-4457.
  - 19: `dispatchModelOf`, by LIN-4454. Its entry is gone and the Lesson no longer names it.
  - 14: the `runFact` row-only read, by LIN-4459. The note shows it removed, but PR #2432 is open per the ticket, so it is settled on the branch and not yet merged (see the flag at the top).
- On A14's side, LIN-4459 also removes the two live-wait entries and the `runner-kickoff.js` `FEEDBACK_ENTRY_KINDS` entry from the LLM note.

Read: the area note Waiting section, matched against the Design's table of 20 entries (13:32) and the Breakdown's accounting (14:02).

## 5. What John has decided that still holds, and whether anything waits on him

Decided, and still holding (all 13 Nov, about 15:33Z):

- **R1 passenger scope:** "Both: a person's Done and an outside merge" (cf8f5ed6).
- **The recommend-path cut:** "Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up" (90c9f8a4).
- **R2:** "Yes, change both repos so the copies are gone" (830a4864). simple-dispatcher is in scope as piece 8, LIN-4461.
- **Standing words in As asked:** "Harbour is a passenger", and piece sizes vary, "erring larger".
- Waiting 10 (pre-cutover paragraphs) was made an engineering call, not John's.

Waiting on him: **nothing formally.** The plan says "Nothing is held for a ruling any more", and the piece 0 sampling question was settled as an engineering call (14:22). Loose ends that are not open rulings:

- LIN-4457 notes that the Runs-vs-LLM placement of `cost-read-calls.js` is open, saying "if John rules for LLM", and "not blocking".
- Waiting entry 12 (wake policy) waits on John once the shadow has a read.
- The LIN-4459 finding on stages that are not parked is "left for a person", but no ruling was raised.

Read: LIN-4447 comments 15:33 to 15:34, the Rulings section of the plan, comments 14:19, 14:22 and 15:09.

## 6. Is LIN-4460 still held unmerged for John?

**No.** The Breakdown (14:02) marked it "PR held unmerged for John", but the rulings comment at 15:34 removed the R1 merge hold once John answered.

It still waits on:
- LIN-4458 and LIN-4459 landing first (its blocked-by, from the Breakdown);
- a recorded review Approve on its own PR;
- piece 0's baseline being on the ticket before it merges. That is already met: LIN-4453 is Done and both `## Area read` reports were posted at 14:24.

It also has a rebase collision to expect with LIN-4466, which edits `run-closeout-state.js` (097a3442). I can't tell whether its build or PR has started.

Read: LIN-4447 Breakdown (14:02), comment 15:34, the Rulings paragraph in the Design section, and comments 14:24 and 15:55.
