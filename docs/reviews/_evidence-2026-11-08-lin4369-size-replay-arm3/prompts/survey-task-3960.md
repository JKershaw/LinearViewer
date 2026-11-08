## Goal
You are looking at the ground before a task starts. You are not doing the task, and you are not reviewing anyone's work.

## Scope and Authority

- This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.

## Process

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-3960, starting with the heading `## Survey open-0: LIN-3960 @ 9da9bc2ba`.

**Where to stand.** Run `git fetch origin` and resolve `origin/main` to its commit. Name that commit's first 9 characters as 9da9bc2ba in the heading, and check it out in a scratch worktree (`git worktree add /tmp/survey-open-LIN-3960 9da9bc2ba`) to read the code there. The task is below, as it read before work began. Don't look at anything after 9da9bc2ba: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**The question:** why will this be difficult, and what, if anything, would you do first?

Answer in your own way, from what you find. Under 500 words.

**The task:**

/styleguide: the anatomy text puts an unescaped <workspace> in the page HTML

## As asked

Found in the LIN-3958 review (PR #2144) as an out-of-scope finding.

`lib/render-styleguide.js:129` (the Settings piece anatomy for the group note, `purpose`) holds the string `“For everyone in <workspace>”`. The anatomy text is written into the page as HTML without escaping, so `<workspace>` is parsed as an unknown element and the text reads “For everyone in ”.

This happens on base too (it predates LIN-3958). Fix: escape the anatomy text, or write the placeholder as `&lt;workspace&gt;`, and add a unit test that the rendered `/styleguide` contains the literal text “For everyone in <workspace>”.

Found by: review of LIN-3958.

*End of what was asked. Steps write below this line; nothing above it changes.*