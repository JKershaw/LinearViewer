# Answers, Reader T (ticket): LIN-4446, close-out

Read: `ticket.md` and `questions.md` in this folder. Nothing else.

1. **What is addressed to this stage to act on?**
   - Review "Fixes for close-out", fix 1: update the PR #2423 body before merge. Add the swipe viewport leftover-step retirement under "What changed", update the "Total: 30 files, +747 / −280" figures (35 files at `1de016f`), and in "Not covered" replace the "serving tests were not run against HEAD" line with the reviewer's mutation result.
   - Ledger item 2: ask John to read the slice's result, record his read as a comment on LIN-4446 before marking Done, and dispatch no next slice until then.
   - Merge, since the verdict is "Approve, conditional on close-out discharging the ledger".
   - The Blind read (15:14:31) also lists two fix-sized items: the test-title wording in `cost-format-consumers.test.js`, and the `cost-format.test.js` header sentence plus the unused `export const TABLE`. It does not address them to close-out by name.
   - Source: Review comment 15:11:29 ("Fixes for close-out", "What CI Did Not Prove", "Verdict"); Blind read 15:14:31.

2. **What is still open, and whose is each item?**
   - PR body fix: close-out.
   - Merge: close-out.
   - John's read of slice 1: John reads it. Close-out asks him and records the read before Done.
   - Blind-read fix-sized items (test title, `cost-format.test.js` header and export): the ticket names no owner. Can't tell whose they are.
   - Blind-read larger items (a general shim design; `ship.js` and `ship-biscuit.js` mirrors): the ticket names no owner. They look like area-note material. Can't tell more.
   - The next slice is blocked until John has read this one.
   - Source: Review 15:11:29; Blind read 15:14:31; plan step 8.

3. **The swipe viewport fix: what was decided, and does it still hold?**
   - The reviewer ruled it a sanctioned leftover-step retirement under `docs/areas/README.md` "One home for each leftover" (LIN-4414), not an overrun, so it needs no ruling.
   - The PR body must mention it (fix 1).
   - Nothing after the review reverses this, so it still holds. The Blind read does not raise it.
   - Source: Review "Scope vs plan" and fix 1; Leftovers comment 15:06:53 ("Retires: …").

4. **Does an approval cover the work at its current head?**
   - Yes, conditionally. The review approved head `1de016f523f…` ("Approve, conditional on close-out discharging the ledger"), and the Blind read is at the same `1de016f52`.
   - The ticket shows no later commit, so as far as the ticket shows, that is still the head.
   - The PR body edit does not change the head. Any commit made to apply the Blind-read fixes would move the head past the approved one.
   - I can't confirm the live PR head from the ticket alone.
   - Source: Review header and Verdict; Leftovers comment (head `1de016f…`); Blind read "Read:" line.

5. **"What CI Did Not Prove" ledger: how many items, how many discharged?**
   - 3 items, 1 discharged.
   - Item 1 (real Chart.js, shim and CSP ordering) was "Discharged before merge" by the reviewer's browser check.
   - Item 2 (John's read) is not done yet. It is due after deploy and before the ticket closes.
   - Item 3 (non-Chromium browsers) is not discharged. It is covered only by a named rollback: revert the merge commit.
   - Source: Review "What CI Did Not Prove".

6. **Is John's read of slice 1 a condition for merging, for marking Done, or neither? Has it happened yet?**
   - It is a condition for marking Done, not for merging. The review says: "This is not a merge condition", and the read is recorded as a comment before Done.
   - It is also a condition for starting the next slice.
   - It has not happened. No comment on the ticket records John's read.
   - Source: Review ledger item 2; As asked "Done when"; plan step 8.
