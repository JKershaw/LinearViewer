# Look-first: another ticket's PR doesn't make a fresh ticket look started

## What this is for

On 19 Nov at 13:37, LIN-4492's close-out posted a note on its sibling LIN-4493. The note quoted LIN-4492's PR #2464. Fifteen minutes later LIN-4493 was dispatched for the first time. It was fresh: an As-asked block, no plan, no size, no runs, no PR of its own. It skipped survey-task, survey-place and scoping and went straight to implementation.

The cause is look-first's `has a PR` check. It counts every PR URL in any comment, whichever ticket the PR belongs to. The same thing happened twice before and went unexplained: LIN-4439 on 12 Nov and LIN-4469 on 13 Nov. Each time a sibling's note quoted that sibling's PR. That is 3 of the 80 first dispatches since 8 Nov (`docs/plans/survey/integration/checks/lin-4493-intent.md`).

The check is there to leave work already in flight alone. LIN-4370 approved it as "any ticket with a plan is untouched", and a ticket with PRs of its own was treated the same way. When the check was built (PR #2370), the wider match was accepted as a rare filing-comment risk with the selector as fallback. But the selector can never offer the Surveys, so a ticket that falls through skips look-first for good.

## What we want

A fresh ticket gets the look-first sequence even when a comment mentions or quotes another ticket's PR. A PR that belongs to the ticket itself, one it opened or landed, still means the work is in flight, and the sequence stays off.

## Done when

- A test with the 19 Nov shape gets survey-task: a fresh leaf with a comment quoting another ticket's PR.
- A ticket whose own PR is on the trail still gets no look-first step.
- PR #2370's choice 4 (the gate counts any PR URL on the trail) is retired.

Every change names what it retires. Questions: settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
