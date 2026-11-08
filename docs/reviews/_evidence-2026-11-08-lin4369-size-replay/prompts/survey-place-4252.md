## Goal
You are looking at a codebase as a place, before a task starts. The task below is not your job, and you are not reviewing anyone's work. Your job is the codebase's side of the question: what this task will do to the place it lands in.

## Scope and Authority

- This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.

## Process

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-4252, starting with the heading `## Survey global: LIN-4252 @ 29f14bf6e`.

**Where to stand.** Run `git fetch origin` and resolve `origin/main` to its commit. Name that commit's first 9 characters as 29f14bf6e in the heading, and check it out in a scratch worktree (`git worktree add /tmp/survey-global-LIN-4252 29f14bf6e`) to read the code there. Don't look at anything after 29f14bf6e: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**What to read.** The code, its tests, and the docs that explain how to use and change it. Don't read reviews, audits or other reports written about the codebase's shape, or the maps and tools that produce them: form your view as you would in a codebase that keeps none.

**The questions:**
1. Where in the codebase will this task land, and what is that part of the place like now? Is it getting better or worse, by what you can see?
2. Done the obvious way, what would this task do to the place? What would it add, move, tangle, leave without a home, or leave in two places (a second copy of something the codebase already has)? What else in the codebase would have to learn about what it adds or removes (lists, registries, inventories, docs), and would anything notice if it didn't?
3. What would leave the place better than it is now, at a cost this task could carry? And what would be better still, but is not this task's to carry?

Answer in your own way, from what you find. Under 500 words.

**The task:**

Client unit tests get one fake DOM that can repaint (tidy first, before LIN-4246)

## As asked

## Goal

The browser code's unit tests have one small fake DOM with a home, good enough to repaint a page and see which nodes survive. Then a claim about what a repaint keeps can be witnessed in a unit test, not only in a slow end-to-end spec.

## Context

* `tests/unit/lin-4010-home-opened-task.test.js` runs `public/prompt-section.js` in a vm against a string-based fake. `querySelector` returns null, and there's no node identity, `replaceWith`, input value or focus, so it can't see whether a repaint kept a card.
* `tests/unit/lin-4242-waiting-merge.test.js` has its own hand-written parser and fake DOM.
* Client tests elsewhere stub `querySelector` selector by selector.
* "Shared test fakes with a home" has been named by five tickets (LIN-4177, LIN-4178, LIN-4241, LIN-4242, LIN-4048). Both Surveys of LIN-4246 named this gap as the reason its call-site witness would need a 180 s E2E spec.

## This step

A tidy, done first as its own task: one fake DOM, in a shared test-helper home, used by the two suites above, with the second fake deleted in the same change. It models what a repaint needs: node identity, `replaceWith` and `innerHTML`, an input's value, focus and `document.activeElement`. No production code changes.

**Not this ticket:** LIN-4246's witness (it comes next, on this fake); moving other client tests onto it; splitting `prompt-section.js`.

## Done when

* One fake DOM, with a home that other client tests can find, and the second copy gone.
* Both suites pass on it with the same test names and counts as before.
* Each thing the fake models has its own small test, so the fake itself can't silently pass.

## Report back

What the fake models, and what it deliberately doesn't. What moved. What had to learn about it.

*End of what was asked. Steps write below this line; nothing above it changes.*