# Answers: Reader H (ticket plus facts), lane LIN-4447 at LIN-4459's close-out, 2026-11-13T17:04:57Z

Read: `ticket-plus-facts.md` only (the LIN-4459 ticket and comments, the parent LIN-4447 description and comments, the area notes, and the computed facts in sections 3 to 7).

## 1. What is still open across the lane, and whose

**LIN-4459 itself (PR #2432, head 7424cfb8f, open and unmerged).** Review approved on condition that close-out discharges the ledger (verdict-162). Open items, all addressed to close-out (facts §3):
- **check-156 (close-out, then LIN-4448):** tell LIN-4448 about the `runner-kickoff.js` import change and the LLM-note entry it retires. Then either get LIN-4448's reply or record that 08c9c898 already covers it.
- **check-157 (whoever merges):** CI green on the exact commit merged. Rebase if LIN-4458 or LIN-4465 lands first.
- **check-158 (a person, after deploy):** watch production for the lineage-recompute compare-and-set error and proxy-route latency. The rollback is reverting the merge commit.
- **check-159 (a person, after deploy):** observe one real parked `[pending]` stage whose lineage blocked or skipped. If there is none yet, record "not yet observed".
- **finding-161 (close-out):** add the `FEEDBACK_ENTRY_KINDS` re-export bullet to the PR body's `## Retires`.
- **finding-164 (close-out):** fix the garbled header comment and stale citation in `session-run-transcript-entries.test.js`.
- **finding-165 (close-out):** one local `blocked`→`WAITING_ON_A_PERSON` mapping in `runFact`.
- **Larger blind-read findings, for the Runs area or later work:** finding-166 (outcome words split between `run-live-wait.js` and `recent-runs.js`) and finding-167 (a parked stage ended by its lineage is dated by its park, not by the lineage's end).
- **Left for a person (comment d3553049):** a stage that is not parked, blocked by a follow-up, still reads as running and holds the wait.
- **question-148 (LIN-4448's to answer):** unanswered.

**Siblings:**
- **LIN-4453 (piece 0): Done.** Both area reads were posted 14:24 (parent description).
- **LIN-4454, 4455, 4456, 4457 (pieces 3, 5, 6, 7): appear landed.** This is inferred from the area notes on main: the FEEDBACK_KINDS, cost-read-calls and testTransport entries are there, and the `dispatchModelOf` entry is gone. No status line says so outright.
- **LIN-4458 (piece 2): in progress (builder's).** Its 16:42 engineering-calls comment is the latest. Its Waiting entries are still in the note.
- **LIN-4460 (piece 1): open.** It is blocked by 4458 and 4459, and its PR needs a recorded review Approve (see Q6).
- **LIN-4461 (piece 8, simple-dispatcher): not started.** Blocked by 4460.
- **LIN-4462 (piece 0 repeat): not started.** Blocked by 4461.
- **LIN-4447 (parent):** stays open until all of the above are done. Its Done-when also needs the after-read.

The areas carry 21 open items addressed to Runs and 23 to LLM & prompts (facts §5).

## 2. Asks made to LIN-4448 (A14), and whether each was answered

1. **The three seam moves (Unblock comment, 13:37):** one classifier in `run-trail.js`, the live-wait move with no shim, and `blindReadStep` reading `closeOutDecision`. **Answered 15:39: agree to all three** (08c9c898, decision-119). It was corrected at 15:55 (097a3442) with the full list of Runs files LIN-4448 edits. LIN-4465 edits comments in `recent-runs.js` and collides with LIN-4459. The moves are still agreed.
2. **LIN-4458's renewed ask (comment 1a2e7cba)**, adding the census boundary: **no reply shown.** LIN-4458 said it is not waiting on one.
3. **LIN-4459's renewed ask (0510ffe0 / question-148)**, posted at 16:42, after the build: **unanswered.**

**Still to tell LIN-4448 before the merge (check-156):** the PR also drops the store's `FEEDBACK_ENTRY_KINDS` re-export. This repoints `lib/prompts/runner-kickoff.js` to the leaf `lib/dispatch-feedback-kinds.js` and retires the LLM-note Waiting entry on `runner-kickoff.js`. Close-out posts that. Then either LIN-4448 confirms, or close-out records the fallback: 08c9c898 covers it, and the runner-kickoff change is only an import path with the prompt bytes unchanged.

## 3. How piece 4 finds a parked stage's terminal: overridden?

**Yes, overridden.**
- **What the plan said:** pass `runFact` the lineage rows before filtering, and resolve the terminal with `resolveFollowUpRoot` and `heldWakeHolderOf`. Its callers hand the rows over.
- **What stands:** the store's shared lineage read. `listHistory({ withLineage: true })` gives each row its wire outcome from `deriveLineageFields`, in one batched read. `runFact` takes the lineage word (`blocked`, `skipped` or a terminal word) only for a row parked `[pending]` that has no terminal of its own.
- **Why:** the helpers are async walks, one row at a time, that go up, while a parked stage's ending sits below it.
- **How it was validated:** with real store writes, a ci-wake `custom` row and a held-wake holder both share `rootItemId` (decision-144).
- **Where it is recorded:** decision-145 [stands], LIN-4447 comment d3553049. The review agreed (verdict-162). The Runs Lesson now reads "read it batched … never a walk per row".

## 4. Waiting entries in the Runs note now, and which originals the lane has settled

**18 Waiting entries** stand, counted from the area-notes snapshot.
- **13 originals remain:** 1, 3, 5, 6, 7, 10, 12, 13, 15, 16, 17, 18 and 20.
- **5 are newer:** the claim compare-and-set entry moved in from the LLM note, the `## Area read` landing entry (LIN-4453), the `cost-read-calls.js` figure rule (LIN-4457), `mayCarryWake` (LIN-4455) and the `testTransport` link (LIN-4456).

**Originals settled by the lane so far:**

| Original entry | Piece | Ticket |
| -- | -- | -- |
| 2, halt modes | 5 | LIN-4455 |
| 4, release wording | 5 | LIN-4455 |
| 11, feedback kinds | 5 | LIN-4455 |
| 8, provider name check | 6 | LIN-4456 |
| 9, cost-read split | 7 | LIN-4457 |
| 19, `dispatchModelOf` | 3 | LIN-4454 |
| 14, `runFact` row-only | 4 | LIN-4459 |

That is 7 of the 20. Entry 14 is settled in PR #2432 and is truly gone from main only when that PR merges.

**Caveat:** the snapshot is headed "as committed on main", yet it already shows LIN-4459's own edits (the `runFact` entry gone, the compare-and-set entry moved in) while the ticket says the PR is unmerged. I trust the ticket on the merge state. The count is 18 either way: with the PR unmerged, the `runFact` entry is in and the compare-and-set entry is out.

## 5. What John has decided that still holds, and anything waiting on him

All three rulings were made 13 Nov at 15:33. All stand (decisions 120, 121, 122):
- **R1, passenger scope: "Both: a person's Done and an outside merge".**
- **Recommend path and ladder:** "Accept: no new GitHub reads on the recommend path or ladder lane; add the fact later if a stuck case shows up". The one cut is agreed.
- **R2, simple-dispatcher:** "Yes, change both repos so the copies are gone". This makes piece 8 (LIN-4461) part of the lane.

Standing framing from the ask also holds: "if I choose to do something, Harbour is a passenger", and piece sizes vary, erring larger.

**Nothing is waiting on a ruling from him.** The plan says "Nothing is held for a ruling any more".
- Piece 0's sampling question was settled as an engineering call (14:22), not put to John.
- Waiting 12 (wake policy) is John's only once the shadow has a read. That is not yet ripe.
- LIN-4459's "not parked but blocked" finding is flagged "for a decision", but it is not raised as a ruling.

## 6. Is LIN-4460 still held unmerged for John?

**No.** The breakdown (14:02) said "PR held unmerged for John", but the 15:34 comment and the parent description release that hold once the rulings were answered.

LIN-4460 still waits on:
- **A recorded review Approve on its PR.** I can't tell from my material whether its PR exists yet.
- **Piece 0's baseline on the ticket.** This is met: LIN-4453 is Done and both area reads are posted.
- **The breakdown's ordering:** blocked by LIN-4458 (it consumes `readTrail`) and by LIN-4459 (`blindReadStep` imports the moved live-wait module).
- **A rebase, if LIN-4466 lands first.** LIN-4466 edits `run-closeout-state.js`.

## Where the ticket and the facts disagree

- **Area notes vs ticket on whether LIN-4459 is merged** (Q4). I trust the ticket and the facts' open checks (check-157 is still about a rebase before merge): PR #2432 is unmerged. The notes snapshot appears to include the branch's edits.
- **Breakdown vs later comments on the LIN-4460 hold** (Q6). The later comment, the description and decision-121 win.
- **decision-119's "only Runs file" line.** It is superseded by its own v2 correction (097a3442), which the facts include.
