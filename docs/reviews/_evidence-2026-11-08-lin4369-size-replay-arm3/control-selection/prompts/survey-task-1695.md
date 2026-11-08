## Goal
You are looking at the ground before a task starts. You are not doing the task, and you are not reviewing anyone's work.

## Scope and Authority

- This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.

## Process

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-1695, starting with the heading `## Survey open-0: LIN-1695 @ b3cba5d39`.

**Where to stand.** Run `git fetch origin` and resolve `origin/main` to its commit. Name that commit's first 9 characters as b3cba5d39 in the heading, and check it out in a scratch worktree (`git worktree add /tmp/survey-open-LIN-1695 b3cba5d39`) to read the code there. The task is below, as it read before work began. Don't look at anything after b3cba5d39: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**The question:** why will this be difficult, and what, if anything, would you do first?

Answer in your own way, from what you find. Under 500 words.

**The task:**

Increase goal text limit for autopilot dispatch

## As asked

When we dispatch to autopilot we can give it a goal can you ensure that the goal text is actually quite generous really there's not any reason why we should keep it fairly low as its instructions to the auto pilot so we can be very generous here.

---

* **Page:** `https://harbour.cat/workspace/linearviewer/`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36`

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.