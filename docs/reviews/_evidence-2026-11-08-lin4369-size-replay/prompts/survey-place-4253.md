## Goal
You are looking at a codebase as a place, before a task starts. The task below is not your job, and you are not reviewing anyone's work. Your job is the codebase's side of the question: what this task will do to the place it lands in.

## Scope and Authority

- This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.

## Process

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-4253, starting with the heading `## Survey global: LIN-4253 @ 29f14bf6e`.

**Where to stand.** Run `git fetch origin` and resolve `origin/main` to its commit. Name that commit's first 9 characters as 29f14bf6e in the heading, and check it out in a scratch worktree (`git worktree add /tmp/survey-global-LIN-4253 29f14bf6e`) to read the code there. Don't look at anything after 29f14bf6e: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**What to read.** The code, its tests, and the docs that explain how to use and change it. Don't read reviews, audits or other reports written about the codebase's shape, or the maps and tools that produce them: form your view as you would in a codebase that keeps none.

**The questions:**
1. Where in the codebase will this task land, and what is that part of the place like now? Is it getting better or worse, by what you can see?
2. Done the obvious way, what would this task do to the place? What would it add, move, tangle, leave without a home, or leave in two places (a second copy of something the codebase already has)? What else in the codebase would have to learn about what it adds or removes (lists, registries, inventories, docs), and would anything notice if it didn't?
3. What would leave the place better than it is now, at a cost this task could carry? And what would be better still, but is not this task's to carry?

Answer in your own way, from what you find. Under 500 words.

**The task:**

A stage's traits (offered as a next step, read-only) are declared once on its template (tidy first, before LIN-4251)

## As asked

## Goal

A stage's traits are declared once, on its template: whether it is offered as a next step, and whether it is read-only. Everything that asks reads that one declaration: the stage selector, the router's refusal, the task page's "Another step" list and the dispatch preamble. Then changing a trait is a one-line edit to the template.

## Context

* LIN-4248 (`29f14bf6e`) added two hand-only, read-only stages. "Hand-only" is now a name list (`EXCLUDED_FROM_AI_RECOMMENDATION`, `lib/prompt-templates.js`) beside the template's missing `route`. "Read-only" is a second name list (`SURVEY_KINDS`, `lib/proxy-preamble.js`), and the kind literals are copied in three test files.
* Two independent blind reads of that merge both scored it "mixed" for exactly this: it followed the per-kind pattern without reducing it.
* LIN-4251 is waiting to make four more stages read-only (look-into, context, retro, triage). Today that means extending a hand-kept list.

## This step

A tidy, done first as its own task, with **no behaviour change**: every kind's dispatched prompt stays byte-identical on every entry path. The traits live on the template definitions. The two name lists are derived from them or deleted, and the copied literals in tests read the traits. A template that doesn't declare its traits fails a test.

**Not this ticket:** changing what any stage is told (LIN-4251 does that next, on top of this); folding the other per-kind tables (leads, grounding, buckets, completion signals) into the template. Name in the report what folding those would take, without doing it.

## Done when

* Before and after, every kind's rendered dispatch prompt is byte-identical on every entry path, and the router's byte-pinned fixtures are unchanged.
* No hand-kept list of stage names remains for "offered" or "read-only".
* A missing trait fails a test.

## Report back

Where each trait now lives, who reads it, what was deleted, and what folding the remaining per-kind tables would take.

*End of what was asked. Steps write below this line; nothing above it changes.*