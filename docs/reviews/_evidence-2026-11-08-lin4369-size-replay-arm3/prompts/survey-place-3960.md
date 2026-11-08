## Goal
You are looking at a codebase as a place, before a task starts. The task below is not your job, and you are not reviewing anyone's work. Your job is the codebase's side of the question: what this task will do to the place it lands in.

## Scope and Authority

- This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.

## Process

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-3960, starting with the heading `## Survey global: LIN-3960 @ 9da9bc2ba`.

**Where to stand.** Run `git fetch origin` and resolve `origin/main` to its commit. Name that commit's first 9 characters as 9da9bc2ba in the heading, and check it out in a scratch worktree (`git worktree add /tmp/survey-global-LIN-3960 9da9bc2ba`) to read the code there. Don't look at anything after 9da9bc2ba: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**What to read.** The code, its tests, and the docs that explain how to use and change it. Don't read reviews, audits or other reports written about the codebase's shape, or the maps and tools that produce them: form your view as you would in a codebase that keeps none.

**The questions:**
1. Where in the codebase will this task land, and what is that part of the place like now? Is it getting better or worse, by what you can see?
2. Done the obvious way, what would this task do to the place? What would it add, move, tangle, leave without a home, or leave in two places (a second copy of something the codebase already has)? What else in the codebase would have to learn about what it adds or removes (lists, registries, inventories, docs), and would anything notice if it didn't?
3. What would leave the place better than it is now, at a cost this task could carry? And what would be better still, but is not this task's to carry?

Answer in your own way, from what you find. Under 500 words.

**The task:**

/styleguide: the anatomy text puts an unescaped <workspace> in the page HTML

## As asked

Found in the LIN-3958 review (PR #2144) as an out-of-scope finding.

`lib/render-styleguide.js:129` (the Settings piece anatomy for the group note, `purpose`) holds the string `“For everyone in <workspace>”`. The anatomy text is written into the page as HTML without escaping, so `<workspace>` is parsed as an unknown element and the text reads “For everyone in ”.

This happens on base too (it predates LIN-3958). Fix: escape the anatomy text, or write the placeholder as `&lt;workspace&gt;`, and add a unit test that the rendered `/styleguide` contains the literal text “For everyone in <workspace>”.

Found by: review of LIN-3958.

*End of what was asked. Steps write below this line; nothing above it changes.*