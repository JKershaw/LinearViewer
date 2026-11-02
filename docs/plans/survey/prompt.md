# Survey prompt

The current version of the Survey's prompt. Every change is logged in `log.md` with its reason, and lines are removed as readily as added. The parts in `{braces}` are filled in per run.

---

## Survey v1

You are surveying the ground before a task starts. You are not doing the task, and you are not reviewing anyone's work.

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on {RECORD}, starting with the heading `## Survey v1: {TICKET} @ {BASE}`.

**Where to stand.** Check out {BASE} in a scratch worktree (`git worktree add /tmp/survey-{TICKET} {BASE}`) and read the code there. The task is below, as it read before work began. Don't look at anything after {BASE}: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits. You may read anything in the repo at {BASE}, including `docs/reviews/` (the periodicals' reports) and `docs/papers/`.

**Answer these:**

1. **Where will this change bind?** Name the specific places its diff will have to push through or work around to land: a decision held in several places, tests that pin today's shape, callers that keep a seam where it is, a split between browser and server, and the test harness itself (state shared between tests, slow or flaky suites, missing seams). Name causes, with file paths. "This file is messy" is a mood, not a cause.
2. **Why will that make it difficult?** Or say plainly that it won't. Narrow tasks often land fine even in tangled code.
3. **The menu.** For each option, say what it would buy this task and what it would cost:
   - **Just drill.** Do the task as written. This is a legitimate answer and is often the right one. Name every copy of each decision you found that drilling would leave unchanged: a copy left behind is the commonest escaped defect in this codebase.
   - **A small tidy first.** Small in scope but complete: if it gathers anything, the copies are deleted in the same change.
   - **Consolidate the decision this task touches.** One owner, copies deleted.
   - **Theseus the area.** Free the seam, consolidate, rebuild.

   Then recommend one, in a sentence.
4. **Predict the task, run as you recommend.** How many plan-review rounds? List the pieces you'd expect it to split into, prerequisites included. Which files will it end up touching? Is there anything you'd expect to bite later?

Keep it under 600 words. Be concrete, and be willing to say "just drill".

**The task:**

{TICKET_TEXT}

---

<details><summary>Earlier versions</summary>

## Survey v0

You are surveying the ground before a task starts. You are not doing the task, and you are not reviewing anyone's work.

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on {RECORD}, starting with the heading `## Survey v0: {TICKET} @ {BASE}`.

**Where to stand.** Check out {BASE} in a scratch worktree (`git worktree add /tmp/survey-{TICKET} {BASE}`) and read the code there. The task is below, as it read before work began. Don't look at anything after {BASE}: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits. You may read anything in the repo at {BASE}, including `docs/reviews/` (the periodicals' reports) and `docs/papers/`.

**Answer these:**

1. **Where will this change bind?** Name the specific places its diff will have to push through or work around to land: a decision held in several places, tests that pin today's shape, callers that keep a seam where it is, a split between browser and server, tooling. Name causes, with file paths. "This file is messy" is a mood, not a cause.
2. **Why will that make it difficult?** Or say plainly that it won't. Narrow tasks often land fine even in tangled code.
3. **The menu.** For each option, say what it would buy this task and what it would cost:
   - **Just drill.** Do the task as written. This is a legitimate answer and is often the right one.
   - **A small tidy first.** Small in scope but complete: if it gathers anything, the copies are deleted in the same change.
   - **Consolidate the decision this task touches.** One owner, copies deleted.
   - **Theseus the area.** Free the seam, consolidate, rebuild.

   Then recommend one, in a sentence.
4. **Predict the task, run as you recommend.** How many plan-review rounds? Will it split into prerequisite tickets, and how many? Roughly how long will it take? Which files will it end up touching? Is there anything you'd expect to bite later?

Keep it under 600 words. Be concrete, and be willing to say "just drill".

**The task:**

{TICKET_TEXT}

</details>
