# Answers, Reader S (store): LIN-4447 lane at LIN-4459 close-out, 2026-11-13T17:04:57Z

Read: `brief.txt`, `questions.md`, `model/BUILD-NOTES.md`. Queried `store.json` with `model/layer.mjs` (`show --task task-82|task-112|task-113`, `find --to area-1`, `--in area-1`, `--to John`, `--to task-83`, `--text …`, `get` on plan-88/plan-91 versions, questions 85/86/148, findings 28/64/65/81/146/166/167, runs 142/149/155). I did not read area-notes.md, ticket.md or key.md.

## 1. What is still open across the lane, and whose
- **LIN-4447 (task-82)**, the parent: open. Its one open item is **finding-146, addressed to John**: an unparked stage whose follow-up posts `[blocked]` still holds the live-stage wait. Should a blocked follow-up release it? (Posted on LIN-4447, d3553049.)
- **LIN-4458 (task-112, piece 2)**: open. The store holds nothing in it beyond the task itself, so I can't tell its progress or who holds it.
- **LIN-4459 (task-113, piece 4)**: open, at close-out. PR #2432 (change-143, head 7424cfb8f) is open and not merged. Addressed to **close-out**: check-156 (the LIN-4448 addition, before merge), check-157 (CI green on the exact merged commit, rebasing if LIN-4458 or LIN-4465 lands first), check-158 (monitor cost after deploy, rollback is to revert), check-159 (post-deploy production observation), finding-161 (add the `FEEDBACK_ENTRY_KINDS` bullet to the PR body's Retires), finding-164 and finding-165 (fix-sized blind-read tidies). **question-148** is open and addressed to **LIN-4448 (task-83)**.
- **LIN-4460 (piece 1)**: not a task record in the store. decision-117 says it is blocked by LIN-4459 (and waits on piece 2 too).
- Still to come by the plan: piece 8 (plan-95, simple-dispatcher, "later") and the repeat of piece 0's area read after the last piece (plan-87; decision-119 calls it LIN-4462's read).
- Area-level, belonging to **Runs (area-1)**: finding-139, finding-166, finding-167.
- Done: LIN-4453, LIN-4454, LIN-4455, LIN-4456, LIN-4457 (tasks 107–111).
- Source: `show --task task-82/113/112`, `find --to John`, `find --to area-1`, decision-117.

## 2. Asks to LIN-4448 (A14), and what is still owed
- **question-86** (from design, the three seam moves): **answered "agree"** in decision-119 (comment 08c9c898), with a correction that lists the Runs files LIN-4448 edits (LIN-4465 edits comments in `lib/recent-runs.js` and collides with LIN-4459). The seam moves stand.
- **question-148** (the renewed ask, LIN-4448 comment 0510ffe0, posted at 16:42 after the build): **open, no reply**. Its if-unanswered says the move stands on decision-119, but the PR waits for a reply before merging.
- **Still owed before merge (check-156):** tell LIN-4448 about the `lib/prompts/runner-kickoff.js` import change, meaning the `FEEDBACK_ENTRY_KINDS` re-export drop, and about the LLM-note Waiting entry that change retires (finding-81). The renewed ask mentions neither. Then either LIN-4448 replies to confirm, or close-out records that 08c9c898 already covers the move and that runner-kickoff changes only an import path with prompt bytes unchanged.
- Source: question-86, question-148, decision-119, check-156, finding-81, run-142, run-155.

## 3. Piece 4's way of finding a parked stage's terminal
- **Plan (plan-91 v2, approved by verdict-102):** pass `runFact` the lineage's rows and resolve the terminal with `resolveFollowUpRoot` and `heldWakeHolderOf`, with the callers handing the rows over.
- **Overridden by decision-145** (implementation, recorded on LIN-4447 d3553049). It reads the store's shared lineage instead: `listHistory({ withLineage: true })`, where `deriveLineageFields` supplies the wire outcome through one batched read. The helpers walk up from a follow-up, one row at a time and asynchronously, so they would have been a second definition of what ended. decision-144 confirms that held-wake holders share the `rootItemId`. Scope stays the same: only a stage parked `[pending]` on its own row is judged by its lineage.
- **What stands:** decision-145. Review agreed with the departure (verdict-162), and lesson-8 was revised to match ("read it batched, never with a walk per row").
- Source: plan-91, verdict-102, decision-144, decision-145, verdict-162, lesson-8.

## 4. Waiting entries in the Runs & dispatch note
- **18 now.** The note entries are the records addressed to area-1 with no `in`: findings 20–27 and 29–37 are open (17). finding-28 is still on main because PR #2432 has not merged. If the PR merges, finding-28 leaves and finding-64 (the claim compare-and-set note, moved from LLM) arrives, so the count is still 18.
- The brief's "21 open addressed to it" also counts finding-139, finding-166 and finding-167. Those were filed to the area by survey-place and blind-read, and the store doesn't show them as entries in the note. I can't tell whether close-out is meant to add 166 and 167 as Waiting entries.
- **Original entries settled by the lane:**
  - Landed: Waiting 19 (LIN-4454), 2, 4 and 11 (LIN-4455), 8 (LIN-4456) and 9 (LIN-4457), all in plan numbering. My source is each Done task's done-when and its "landed" end. The store holds no ended entry records for these.
  - This lane's own: Waiting 14, the `runFact` row-only read (finding-28). It is ended "settled in PR #2432 … awaits merge", so it is not yet on main.
  - On the LLM side, finding-65 and finding-81 are ended by the same unmerged PR.
- Source: `find --to area-1`, `find --in area-1`, finding-28/64 versions, tasks 108–111, decision-125.

## 5. John's standing decisions; anything awaiting him
- **decision-120:** no new GitHub reads on the recommend path or the ladder lane. The fact gets added later if a stuck case shows up.
- **decision-121:** "Harbour is a passenger" covers both a person's Done and an outside merge.
- **decision-122:** change both repos so the copies are gone, which puts simple-dispatcher in scope.
- From the ask: settle engineering questions yourself, and send only John's calls to him; piece sizes vary, leaning larger.
- **Awaiting him:** finding-146 (open, to John, on LIN-4447). Should a blocked follow-up release an unparked stage? Nothing else on LIN-4447 is addressed to John.
- Source: decisions 120–122, questions 84/85/97, finding-146, brief part 1.

## 6. Is LIN-4460 still held for John?
- **No.** plan-88 v2 said "Merge held on R1 and the recommend-path ruling". v3 (15:34:58) removed the hold ("*Hold:* none … piece 1 merges on its own review like any other piece") once John ruled.
- **What it still waits on:** LIN-4458 (piece 2, for `readTrail`) and LIN-4459 (piece 4, which moves the live-wait module that `blindReadStep` imports), per decision-117. Then its own review. decision-119 also notes that LIN-4466 (LLM piece 2) edits `lib/run-closeout-state.js`, so whichever lands second rebases.
- Source: plan-88 versions 1–3, decision-117, decision-119.
