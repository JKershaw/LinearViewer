# Key: lane LIN-4447 (Runs & dispatch), at LIN-4459's close-out, 2026-11-13T17:04:57Z

Moment: just after LIN-4459's blind read (17:04:26Z) and the start of its close-out (LIN-4459 snapshot 299ad5e0, 17:05:16Z). PR #2432 is **not merged** yet (that happens at 17:12:49Z). The close-out's LIN-4448 note (b564445b, 17:06:52Z), its comment (17:29Z), PR #2434 and everything on LIN-4447 after 16:42:22Z (4e4c23c6 onward) come **later** and do not count.

Sources: LIN-4447 = parent description (unchanged from the 15:35Z snapshot to the end) and comments; LIN-4459 = its comments; LIN-4448 = its comments; area notes = `area-notes.md` as committed then.

---

## 1. What is still open across the lane, and whose is each item?

**Answer.**
- **LIN-4459 (piece 4), in close-out (the close-out stage owns it):** PR #2432 is approved with conditions but not merged. The close-out still has to discharge review db296654's ledger: (a) add the `FEEDBACK_ENTRY_KINDS` re-export bullet to the PR's `## Retires`; (b) LIN-4448 coordination, see Q2; (c) CI green on the exact commit merged, rebasing if LIN-4458 or LIN-4465 lands first; (d) record the latency monitor and rollback; (e) run the post-deploy real-world check, or record it as "not yet observed". The blind read's two fix-sized items (garbled test header, two `blocked` mappings in `runFact`) are open too.
- **LIN-4458 (piece 2), being built (its build session):** its engineering calls are posted (44101230, 16:42Z) but no PR is open yet.
- **LIN-4460 (piece 1):** blocked by LIN-4458 and LIN-4459. **LIN-4461 (piece 8, simple-dispatcher):** blocked by LIN-4460, and gets its own plan when it starts. **LIN-4462 (repeat area read):** blocked by LIN-4461.
- **LIN-4447 (the parent):** In Progress. One finding is left for a person, with no ticket: a stage that is not parked and is blocked by a follow-up still reads as running and holds the wait (d3553049, "Finding, left for a person").
- **Not open:** LIN-4453 (piece 0) is Done. Pieces 3, 5, 6 and 7 (LIN-4454 to LIN-4457) have landed: their entries are in the area notes.

**Shown:** LIN-4459 review db296654 ("Fixes for close-out", "What CI Did Not Prove") and blind read (17:04:26Z); LIN-4447 Breakdown 49b291c4 (blocking graph), 44101230, d3553049; area notes.

## 2. Which asks has this lane made to LIN-4448 (A14), and were they answered?

**Answer.**
1. **The three seam moves** (classifier home, live-wait move with no shim, `blindReadStep` reading the decision): posted on LIN-4448 at 13:36Z (d3ba7421). **Answered: agree to all three**, in 08c9c898 (15:39Z). Corrected in 097a3442 (15:55Z), which lists the Runs files LIN-4448 edits. One of them: LIN-4465 edits comments in `lib/recent-runs.js`, which collides with LIN-4459.
2. **LIN-4458's renewed classifier ask, plus the census boundary** (LIN-4448 1a2e7cba, 16:42Z): **no reply yet.** LIN-4458 is not waiting for one.
3. **LIN-4459's renewed live-wait ask** (LIN-4448 0510ffe0, 16:42Z, posted after the build): **no reply yet.**

**Still to do:** the close-out must tell LIN-4448 about the `runner-kickoff.js` import change and the LLM-note entry that change retires (not posted at this moment). Then either LIN-4448 confirms, or the close-out records that 08c9c898 ("whichever of us lands second changes only the import path") covers it.

**Shown:** LIN-4448 d3ba7421, 1a2e7cba, 0510ffe0; LIN-4447 08c9c898, 097a3442, 44101230; LIN-4459 review db296654.

## 3. Piece 4's method for a parked stage's terminal: overridden? What stands?

**Answer.** Yes, it was overridden. The approved plan, plan-review note 5 and LIN-4459's ask all said to resolve the terminal through the store walks `resolveFollowUpRoot` / `heldWakeHolderOf`. LIN-4459 departed from this (LIN-4447 d3553049, 16:42Z) and reads the store's batched lineage instead: `listHistory({ withLineage: true })`, through `deriveLineageFields`. The reason: the walks go up, per row, while a parked stage needs the outcome of the follow-ups below it. Review db296654 agreed with the departure. **What stands now:** the batched `withLineage` read. Only a stage parked `[pending]` on its own row takes its lineage's end.

**Shown:** LIN-4447 Implementation Plan (piece 4) and plan review 12619798 note 5; LIN-4447 d3553049; LIN-4459 review db296654. The area notes Lesson ("read it batched … never a walk per row … LIN-4459") also reflects it.

## 4. How many Waiting entries stand in the area now, and which did this lane settle?

**Answer.** **18** Waiting entries. Not 20, which is the starting count the description still states. Not 20 with PR #2434's two entries either, since those are not written yet.
- **Settled from the original 20:** #2, #4 and #11 (LIN-4455); #8 (LIN-4456); #9 (LIN-4457); #19 (LIN-4454).
- **#14** (`runFact` row-only, LIN-4392) is settled in LIN-4459's PR #2432, which is approved but not merged. The PR swaps that entry for the moved claim compare-and-set note (`lib/run-live-wait.js`), so the count stays 18 on either side of the merge.
- On the LLM side, the PR also removes the two live-wait entries and the `runner-kickoff.js` `FEEDBACK_ENTRY_KINDS` entry.
- The lane also **added** four entries: the LIN-4453 area-read heading entry, the LIN-4455 `mayCarryWake` entry, the LIN-4456 `refusesHermeticToken` entry and the LIN-4457 figure-rule entry.

**Shown:** area notes `## Waiting` (count the bullets); LIN-4447 Design comment 6efb91fa (the numbered list of 20) and Breakdown 49b291c4 (which piece settles which); LIN-4459 review db296654 ("Retires / Settles Waiting").

## 5. What has John decided for the lane that still holds?

**Answer.**
- **The passenger rule.** "If I choose to do something, Harbour is a passenger."
- **R1, both** (cf8f5ed6): a person's Done **and** an outside merge each outrank the gate.
- **The one agreed cut** (90c9f8a4): accept no new GitHub reads on the recommend path or the ladder lane, and add the fact later if a stuck case shows up.
- **simple-dispatcher in scope** (830a4864): "Yes, change both repos so the copies are gone", which became piece 8, LIN-4461.
- **Piece sizes** vary and err larger.

All three rulings were answered at 15:33Z. **Nothing is waiting for John:** "Nothing is held for a ruling any more." The piece-0 sampling question was settled as an engineering call (e6ca12b3), not by John. Waiting #10 is likewise an engineering call (dc7461eb).

**Shown:** LIN-4447 As asked; Design `Rulings` in the description; comments 90c9f8a4, cf8f5ed6, 830a4864, 9bfb9aa5; LIN-4447 rulings (three resolved at 15:33Z).

## 6. Is LIN-4460 still held unmerged for John? If not, what does it wait on?

**Answer.** **No.** Its title ("merge held for John") and the Breakdown (49b291c4, "PR held unmerged for John") are out of date. John answered the rulings at 15:33Z, and 9bfb9aa5 removed the merge hold. What it waits on now:
- the build order: it is blocked by LIN-4458 and LIN-4459, neither merged yet;
- a recorded review Approve on its PR;
- piece 0's baseline on the ticket, which is already met (LIN-4453 is Done).

**Shown:** LIN-4447 9bfb9aa5; the description ("With these answered, LIN-4460's merge hold is released. Its PR still needs a recorded review Approve, and piece 0's baseline (LIN-4453, Done) must be on the ticket before it merges."); Breakdown 49b291c4 (blocked by 4458, 4459).
