# Slice 2: what slice 1 hands forward

*Started 19 Nov. Items picked up while slice 1 runs, to go into the slice 2 draft for John. The draft itself is written once slice 1 lands, from what it really left.*

## To include (John's rulings)

1. **Retire the frozen Waiting-list reader.**
   - **Where it stands:** LIN-4495's cutover (PR #2468, merged 21:26 on 19 Nov as e942c1031) removed the Waiting lists. It kept a frozen copy of their reader, commented "only for the one-off import", with no end date. The stability scripts now use it too.
   - **The rule it breaks:** a kept path says when it goes.
   - **What to do:** once LIN-4496's live import has run, remove the reader and move the stability scripts onto the records store.
   - **Ruled by John,** 19 Nov ~21:35: option (a), add it to the slice 2 draft.

## Follow-ups from LIN-4495's close-out (morning, John)

The ruling `lin4495-postdeploy-gate` (21:47, 19 Nov) was answered "accept" on my proposal. These items were moved out of LIN-4495 to keep the run going:

2. **Re-run review on six legacy-held tasks:** LIN-4463, 4452, 4441, 4028, 3357, 2422 (finding-5ddda62d).
   - This needs someone with a dispatch grant.
   - LIN-4463 and LIN-4441 are paused lanes, so John decides when they move.
3. **The signed-in task-page and log check:** look for "open findings not read" (finding-0cc5a636). It needs a signed-in page and server logs.
4. **The `isEmptyStatement` defect** (finding-76683071): a pre-cutover ledger that has items can read as empty, so the gate says "none open". LIN-4495's own ledger hits it.
   - Fix it before relying on the gate for older tickets.
   - Check whether it touches LIN-4496.

## The six re-review verdicts (22:28–22:36, 19 Nov; John's to act on)

- LIN-4463: Request Changes. It waits for John to restart the paused lane.
- LIN-4452: Approve, conditional on John's live Jira check.
- LIN-4441 (paused lane): Request Changes, back to implementation.
- LIN-4028: Request Changes. PR #2185 conflicts with main.
- LIN-3357: Request Changes. The ticket stays parked.
- LIN-2422: Approve, conditional. John's hold still blocks the merge.

No follow-on dispatches were made. LIN-4495 was marked Done at 22:58.

## Waiting on John from LIN-4496 (noted 23:29, 19 Nov)

- **The live Waiting import:** per LIN-4496's survey, it connects straight to the production database, which no agent can reach. Not checked in code. It creates the seven safety tasks, which must not move without John.
- **Two questions a review raised outside the rulings list:** keeping the hold for old reviews, and the Home badge count.

## How tidies like this are handled

A judgement call, not a rule (John, 19 Nov). Tidying as we go, a small standalone task, or waiting until the end can each be right, depending on the case. Keeping the running slice going matters most. John expects much of this to sort itself out once the upgrade is done.
