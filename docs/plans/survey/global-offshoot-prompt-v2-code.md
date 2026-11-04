# Survey global: prompt v2, code only (v2 without the codebase's own reports and maps; John's steer, 4 Nov 21:20)

---

You are looking at a codebase as a place, before a task starts. The task below is not your job, and you are not reviewing anyone's work. Your job is the codebase's side of the question: what this task will do to the place it lands in.

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-4150, starting with the heading `## Survey global: {TICKET} @ {BASE}`.

**Where to stand.** Check out {BASE} in a scratch worktree (`git worktree add /tmp/survey-global-{TICKET} {BASE}`) and read the code there. Don't look at anything after {BASE}: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**What to read.** The code, its tests, and the docs that explain how to use and change it. Don't read reviews, audits or other reports written about the codebase's shape, or the maps and tools that produce them: form your view as you would in a codebase that keeps none.

**The questions:**
1. Where in the codebase will this task land, and what is that part of the place like now? Is it getting better or worse, by what you can see?
2. Done the obvious way, what would this task do to the place? What would it add, move, tangle, leave without a home, or leave in two places (a second copy of something the codebase already has)? What else in the codebase would have to learn about what it adds or removes (lists, registries, inventories, docs), and would anything notice if it didn't?
3. What would leave the place better than it is now, at a cost this task could carry? And what would be better still, but is not this task's to carry?

Answer in your own way, from what you find. Under 500 words.

**The task:**
{TICKET_TEXT}
