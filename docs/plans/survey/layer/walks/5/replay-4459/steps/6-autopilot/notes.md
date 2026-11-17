# Notes: 6-autopilot (task-113)

**Written (all `in` task-113):**
- question-151, to review: should the `FEEDBACK_ENTRY_KINDS` re-export removal, with its 8 repointed imports and the flipped lin-4455 assertion, be part of this piece? `about` change-143, finding-150, finding-81; `on` change-143@2.
- finding-152, to review: Lessons under 6,144 bytes still to confirm; `on` decision-124@1.
- finding-153, to implementation: rebase if LIN-4458 merges first; `about` task-112; `on` decision-116@1.
- run-154 (autopilot), `on` change-143@2, finding-150@1, finding-147@1; ended `done`.
Nothing revised, closed or handed on. finding-147 and finding-150 stay open for review.

**Looked up:** `get` change-143, finding-147, finding-150, to confirm the head and what leftover had already raised. `show --task` to check for duplicates. `find --text` for "6,144", "LIN-4458", "FEEDBACK_ENTRY_KINDS" and "rebase", to see whether these were already recorded. Only finding-81 (ended) and finding-150 touch the re-export, and neither raises the test assertion or the PR body.

**Refusals:** none.

**Relied on outside brief/queries:** live GitHub state: PR mergeable, the 8 CI check names passing at 7424cfb, the 8-import count, the lin-4455 test assertion text, and the PR body's retire list and the ticket's Approach list. None of this is in the store. I also relied on LIN-4459 description snapshots, which showed no change.

**Carried but unneeded:** task-82's full `asked`, John's rulings (decision-120/121/122), decision-119's long LIN-4448 table, decisions 115/117/135/141, and lesson-8/lesson-11.

**Couldn't place:** "PR open/mergeable, CI green" as a standalone verified fact. I folded it into the run account.
