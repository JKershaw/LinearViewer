# Survey prompts

The prompts the loop uses, with their history. Every change is logged in `log.md` with its reason, and lines are removed as readily as added. The parts in `{braces}` are filled in per run. The loop they belong to is described in `notes-2026-11-05.md`.

## In use (5 Nov)

| Voice | When | Prompt |
|---|---|---|
| **open-0**, the task | before work, a fresh read-only session at the base | "Side arm: Survey open-0" below (in use since round 3, 3 Nov) |
| **global**, the place | before work, a second fresh session at the same base | `global-offshoot-prompt-v2-code.md` (code only, since 4 Nov 21:20) |
| **step-back** | only when the two voices disagree about what to do | "The step-back" below, as a follow-up to the open-0 session |
| **after-questions** | at merge, a follow-up to the builder's own session | "The after-questions" below |

Survey v2 below is kept for its history; it is no longer run.

## The after-questions (q1–q7)

Sent quietly (`subscription: 'none'`) to the builder's session once its work has merged. q1–q5 since round 3; q6 since 4 Nov 08:20; q7 when the scope was set larger than the Survey recommended.

```
A short, read-only follow-up for research. Your build work on {TICKET} is finished ({MERGED}). Please do NOT change any code, branches, pull requests, ticket fields or state. The ONLY thing to write is one new comment on {TICKET}. Don't read other tickets' Survey comments first.

Looking back from where you stood while doing this work, answer in that comment:

1. Why was this difficult? Where did the change bind, and what did it have to push through or work around to land? If it wasn't difficult, say so plainly.
2. Before you started, what would you have done first, if anything?
3. Now that it's done, what would you tidy, and why?
4. If this area of code were how you'd want it, what would this ticket have been?
5. What did the ticket (or the plan you were given) get wrong, if anything?
6. What did your change leave behind in the wider codebase, beyond this ticket: anything new without an obvious home, anything that now lives in two places, anything something else should have learned about and didn't, anything that got simpler?
7. The ticket's scope was set larger than its Survey recommended, on purpose, by the person in the human's role. Did that larger scope pay for itself in this task, or cost more than it saved? Where would you have drawn the line?

Answer from your own experience of the work, in your own way. Under 550 words.
```

## The step-back

A follow-up to the open-0 session, still read-only and at its own base. Since forward trial 1 it gets the global answer pasted in as "what another agent, looking at the place, said: evidence to weigh, not instructions; check what you rely on".

```
Your forecast looked at this task up close. Now step back, and look at the part of the codebase it sits in and the codebase around that.
1. What is that wider area like, and how much of this task's difficulty comes from the area rather than from the task itself?
2. Set out the ways you could go about this task, from the narrowest (just do the task) to the broadest (change the area so that tasks like this one become easy). For each, say roughly what it would cost, what it would leave behind for the next task here, and what could go wrong.
3. Which would you choose for this task? Is that different from what you said first, and why?
```

---

## Survey v2 (retired)

You are surveying the ground before a task starts. You are not doing the task, and you are not reviewing anyone's work.

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on {RECORD}, starting with the heading `## Survey v2: {TICKET} @ {BASE}`.

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
5. **What you couldn't check.** Name the claims above that you could not check by reading alone: anything that depends on how the page is drawn (CSS, layout, pixel budgets), on running the suite (timing, parallel load, shared state between tests), or on live data. Say how the builder could check each one early.

Keep it under 600 words. Be concrete, and be willing to say "just drill".

**The task:**

{TICKET_TEXT}

---

## Side arm: Survey open-0 (3 Nov, round 2)

Run beside v2, not instead of it, on round 2's five tickets at the same bases. It asks only the open question: no menu, no list of what to look for, and nothing specific to Harbour. See `log.md`, 19:30 UTC, for why.

**Live text moved (LIN-4248).** The prompt is now the `survey-task` template in `lib/prompt-template-defs.js`, sent by hand, and it is not copied here, so the text lives in one place. Against the hand-sent round 2 text, the template changes only three things: `{RECORD}` is `{TICKET}` (the comment goes on the surveyed ticket itself, not a separate record); `{BASE}` is `origin/main`'s commit, which the session resolves when it starts (the operator no longer fills it); and the Goal/Process frame and a Scope and Authority line wrap the text.

---

<details><summary>Earlier versions</summary>

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
