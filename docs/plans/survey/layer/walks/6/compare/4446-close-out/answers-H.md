# Answers H (ticket plus facts): LIN-4446, close-out

Read: `ticket-plus-facts.md` only (the ticket with its comments, then the computed facts) and `questions.md`.

**1. What is addressed to this stage to act on?**
Three findings, all fix-sized and due before merge:
- finding-61 (review): bring PR #2423's body up to date. Add the swipe-viewport leftover retirement under "What changed". Replace "Total: 30 files, +747 / −280" with the `gh pr view 2423` figures (35 files at `1de016f`). In "Not covered", replace "serving tests not run against HEAD" with the reviewer's lib-directory mutation result.
- finding-64 (blind read): in `tests/unit/cost-format-consumers.test.js`, reword the title and comment that say "browser copy's words" to "the shared formatter's words".
- finding-65 (blind read): in `tests/unit/cost-format.test.js`, drop the "parity comparison it used to carry is retired" sentence and the unused `export const TABLE`.

The review's ledger also gives close-out a job: ask John to read slice 1, record his read as a comment on LIN-4446, and only then mark Done. After that comes the merge itself, which "the first slice has landed" needs.
Source: facts §3 (findings 61, 64, 65 "to close-out"); the Review comment's "Fixes for close-out" and "What CI Did Not Prove" item 2.

**2. What is still open on the task, and whose is each item?**
- Close-out: findings 61, 64 and 65 (above), plus merging PR #2423.
- John: check-17, reading the first slice's result before the next slice starts. Nothing shows he has done it.
- Still open in the records but already done in the ticket:
  - findings 47, 48 and 50 are open "to implementation". The work behind them is done: `cost-format.test.js` exists, the CLAUDE.md trim is named in the PR, and the review checked the consumer comments.
  - findings 14, 20 and 31 are open "to review". They are about the observation.js comment-counting method. The plan put that method in the area-note Waiting entry, and the PR counts comment edits separately.
- Close-out should close or answer these six records rather than act on them again. I trust the ticket on the state of the work, because the comments show the work landed. The facts only show that nobody closed the records.
- Area-1 (front-end browser) has 11 open items addressed to it. The blind read's "larger" items are area work, not this task's: the one-module shim design, and the `ship.js`/`ship-biscuit.js` hand-synced copies.
Source: facts §3, §5 and §7 (check-17); the Implementation, Leftovers and Review comments.

**3. The swipe viewport fix beyond the plan: what was decided, and does it hold?**
The reviewer ruled it a sanctioned leftover-step retirement, not an overrun, so it needs no ruling. The rule is `docs/areas/README.md` "One home for each leftover" (LIN-4414). The fix retires the `docs/areas/front-end-pages.md` Waiting entry, and a test failed before the fix. The one condition is that the PR body must mention it (finding-61).
It still holds: verdict-60 stands and rests on change-53@2, which is still current, and nothing later overrides it.
Source: the Review comment's "Scope vs plan"; facts §4 verdict-60.

**4. Does an approval cover the work at its current head?**
Yes, conditionally:
- verdict-60 (review, approve-with-notes) covers PR #2423 at head `1de016f52`. It rests on change-53@2, which the facts do not mark stale.
- The approval is "conditional on close-out discharging the ledger (PR-body fix, John's read)".
- The blind read ("better") is also at `1de016f52`.

Caveat: findings 64 and 65 are test-file edits on the PR branch. Once close-out pushes them, the head moves past what the review approved, so those commits would sit outside the approval.
Source: facts §4 verdict-60 and verdict-63; the Review comment's header and verdict.

**5. How many items are in the "What CI Did Not Prove" ledger, and how many are discharged?**
Three items. One is discharged.
- Discharged: the chart-ordering fix in a real browser. The reviewer discharged it before merge with a Chromium, Chart.js and CSP check.
- Pending: John's read of slice 1, which settles before the ticket closes.
- Not discharged: Safari and Firefox behaviour. It is accepted with a named rollback (revert the merge commit).
Source: the Review comment's "What CI Did Not Prove".

**6. Is John's read a condition for merging, for marking Done, or neither? Has it happened?**
It is a condition for marking Done, not for merging. The review says: "This is not a merge condition: merging is what 'the first slice has landed' asks for." Close-out records his read as a comment before marking Done, and no next slice starts until then. verdict-60's summary lists "John's read" among the conditions, but the review text clearly puts it at Done, not merge.
It has not happened yet: check-17 to John is still open, and no comment records his read.
Source: the Review comment's ledger item 2; facts §7 check-17; facts §4 verdict-60.

**Where the ticket and the facts disagree.** The facts list findings 47, 48 and 50, and findings 14, 20 and 31, as open. The ticket's comments show that work done. On the work, I trust the ticket: the implementation and review comments describe the landed result, and the review checked it. On which records are formally open, I trust the facts. The facts mark verdict-35 STALE (on plan-28@12, now @13). That is consistent with the ticket: verdict-44 superseded it.
