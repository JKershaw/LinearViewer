# Key: LIN-4446, close-out (started 2026-11-13T15:14:56Z)

State at that moment: eight comments, ending with the Review (15:11:29) and the Blind read (15:14:31). PR #2423 is open, not merged, at head `1de016f523f…` (two commits: `24de9abc9` the slice, `1de016f52` the leftovers), with CI green. The ticket is In Progress. The description still carries the revised plan (`plan-review due: no`). John's read (15:39:21) has **not** happened yet.

## 1. What is addressed to this stage to act on?

**Answer:**
- The review's "Fixes for close-out" (one fix, PR body, before merge). Add the swipe viewport leftover retirement and its witness `tests/unit/render-swipe.test.js`. Update the totals (the body says 30 files, +747/−280, but there are 35 files at `1de016f`). Replace the "serving tests not run against HEAD" gap with the reviewer's M8 mutation evidence.
- The review's ledger: ask John to read the result, and record his read on the ticket before marking Done.
- Merge and deploy.
- The blind read's two fix-sized items. Reword the "browser copy" title and comment in `cost-format-consumers.test.js`. In `cost-format.test.js`, drop the false "parity comparison it used to carry" sentence and the unused `export const TABLE`.
- Its two larger items: the module-to-global bridge, and the hand-synced `ship.js`/`ship-biscuit.js` copies.

**Source:** Review 15:11:29, "Fixes for close-out" and "What CI Did Not Prove" (real/10-review.md); Blind read 15:14:31 (real/11-blind-read.md).

## 2. What is still open on the task, and whose is each item?

**Answer:**
- PR body fix, merge and deploy: close-out's.
- Blind-read fix-sized items: close-out's.
- Blind-read larger items (needing a design decision, and lib leaves first): Waiting entries in the front-end-browser area note, for a later slice.
- John's read of slice 1: John's. Close-out asks for it, and no next slice starts until it is recorded.
- Non-Chromium behaviour: unverified. It is accepted with a named rollback (revert the merge commit).
- Not open: the chart deferral with real Chart.js, shim and CSP. The reviewer's Chromium check discharged it.

**Source:** Review 15:11:29 ledger and fixes; Blind read 15:14:31.

## 3. The PR also carries a swipe viewport fix beyond the plan. What was decided about it, and does it still hold?

**Answer:** The review ruled it a sanctioned leftover-step retirement under LIN-4414 ("One home for each leftover"), not an overrun, so it needs no ruling. It retires the `docs/areas/front-end-pages.md` Waiting entry on `lib/render-swipe.js`'s `user-scalable=no`. The decision holds, but the PR body must still name it (review fix 1).

**Source:** Leftovers comment 15:06:53 (`Retires:` line, real/9-leftover.md); Review 15:11:29 "Scope vs plan".

## 4. Does an approval cover the work at its current head?

**Answer:** Yes, conditionally. The review's verdict is "Approve, conditional on close-out discharging the ledger", given at head `1de016f523f46a006c20a4e89717157422b3207b`, which is still the head, with CI green on it. Any commit close-out adds (fixes) moves the head past what was reviewed and needs CI again. The plan approval (14:36:13) covers the plan, not the PR.

**Source:** Review 15:11:29 (head, CI, Verdict); Blind read 15:14:31 ("at `1de016f52`").

## 5. How many items are in the review's "What CI Did Not Prove" ledger, and how many are already discharged?

**Answer:** 3 items, 1 discharged: the chart deferral, checked in the reviewer's real-browser run. 2 remain: John's read (human-only), and non-Chromium behaviour (unverified, with a named rollback).

**Source:** Review 15:11:29 "What CI Did Not Prove".

## 6. Is John's read of slice 1 a condition for merging, for marking Done, or neither, and has it happened yet?

**Answer:** It is not a merge condition: merging is what "the first slice has landed" asks for. The review asks close-out to get John's read and record it as a comment before marking Done, and no next slice may start until then. It has not happened at this moment. No comment from John exists, and his relayed read came later, at 15:39:21.

**Source:** Review 15:11:29, ledger item 2 and Verdict ("ledger item 2"); As asked "Done when"; comments up to 15:14:31.
