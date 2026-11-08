## Goal
You are looking at a codebase as a place, before a task starts. The task below is not your job, and you are not reviewing anyone's work. Your job is the codebase's side of the question: what this task will do to the place it lands in.

## Scope and Authority

- This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.

## Process

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-998, starting with the heading `## Survey global: LIN-998 @ 973a8ec77`.

**Where to stand.** Run `git fetch origin` and resolve `origin/main` to its commit. Name that commit's first 9 characters as 973a8ec77 in the heading, and check it out in a scratch worktree (`git worktree add /tmp/survey-global-LIN-998 973a8ec77`) to read the code there. Don't look at anything after 973a8ec77: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**What to read.** The code, its tests, and the docs that explain how to use and change it. Don't read reviews, audits or other reports written about the codebase's shape, or the maps and tools that produce them: form your view as you would in a codebase that keeps none.

**The questions:**
1. Where in the codebase will this task land, and what is that part of the place like now? Is it getting better or worse, by what you can see?
2. Done the obvious way, what would this task do to the place? What would it add, move, tangle, leave without a home, or leave in two places (a second copy of something the codebase already has)? What else in the codebase would have to learn about what it adds or removes (lists, registries, inventories, docs), and would anything notice if it didn't?
3. What would leave the place better than it is now, at a cost this task could carry? And what would be better still, but is not this task's to carry?

Answer in your own way, from what you find. Under 500 words.

**The task:**

Auto-populate Brief and Recap on section open

## As asked

Currently we open these sections and then click to generate the output. The Context section auto populates - can we make Brief and Recap populated on section open too.

---

* **Page:** `https://projects.jkershaw.com/workspace/linearviewer/`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Mobile Safari/537.36`

![](https://uploads.linear.app/a8c4b5e3-5392-42fb-884e-086f691fa0b8/c8e954d3-1fee-47e8-8dc0-2000bea73cb2/2579554a-82d0-4c7b-9f61-8076569dcf3d)

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.