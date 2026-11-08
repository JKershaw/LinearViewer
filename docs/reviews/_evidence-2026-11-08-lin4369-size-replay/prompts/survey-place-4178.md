## Goal
You are looking at a codebase as a place, before a task starts. The task below is not your job, and you are not reviewing anyone's work. Your job is the codebase's side of the question: what this task will do to the place it lands in.

## Scope and Authority

- This is a reading pass. If the ticket is aimed at a symptom of something deeper, say so.

## Process

**This is read-only.** Don't change code, branches, pull requests, tickets or Linear state. Your only output is one comment on LIN-4178, starting with the heading `## Survey global: LIN-4178 @ 10b2c82fb`.

**Where to stand.** Run `git fetch origin` and resolve `origin/main` to its commit. Name that commit's first 9 characters as 10b2c82fb in the heading, and check it out in a scratch worktree (`git worktree add /tmp/survey-global-LIN-4178 10b2c82fb`) to read the code there. Don't look at anything after 10b2c82fb: no later commits, tickets, comments or reports. You're forecasting, so the future is off limits.

**What to read.** The code, its tests, and the docs that explain how to use and change it. Don't read reviews, audits or other reports written about the codebase's shape, or the maps and tools that produce them: form your view as you would in a codebase that keeps none.

**The questions:**
1. Where in the codebase will this task land, and what is that part of the place like now? Is it getting better or worse, by what you can see?
2. Done the obvious way, what would this task do to the place? What would it add, move, tangle, leave without a home, or leave in two places (a second copy of something the codebase already has)? What else in the codebase would have to learn about what it adds or removes (lists, registries, inventories, docs), and would anything notice if it didn't?
3. What would leave the place better than it is now, at a cost this task could carry? And what would be better still, but is not this task's to carry?

Answer in your own way, from what you find. Under 500 words.

**The task:**

Costs rebuild 1.2: /kpis, workspace KPIs and the run page on the cost read

## As asked

Piece 2 of 3 of **LIN-4176** (Costs rebuild 1: one cost read that every surface asks). Read the scope, research and the full approved plan in **LIN-4176's description** (`## Implementation Plan`, revised 3 Nov). Read its comment trail too, especially the Approve verdict's builder notes 1 and 2 (comment `6645f289-b9a5-4dd7-a5d2-8c7ec9170fd8`). Lands after piece 1, which provides `lib/cost-read.js`, the fixture corpus and the goldens.

**Starting point.** LIN-4176's approved plan is this piece's starting point. Follow it. Where the code shows it wrong, change course and say so in a comment on LIN-4176.

## This piece's slice of the plan

**KPI path onto the read: S11 public** `/kpis` **cost per finished task, and S12 workspace KPIs cost per day.**

* Add the **raw-collection adapter** for the founder lookup, batched **per** `urlKey` \[N4\], because `{urlKey, rootItemId}` is the index and an `{$in}` without `urlKey` scans. The rows come from the Mongo projection in `lib/kpi-stats.js:449-460` / `loadDispatchHistory` `:488`. The workspace call is at `lib/workspace-kpi-stats.js:147`.
* **The founder lookup stays on the KPI path \[N3\]** for the issue, not the start. Time it on a seeded store, since the aggregation here has timed out before (LIN-3002). If it is too slow, restrict it to anchors whose earliest fetched member has a `followUpTo` (already projected, `kpi-stats.js:454`), proven by W2. Never fall back to the fetched window for the issue.
* **S11 keeps exactly today's population:** done, not skipped, with a member in the window. The component rule, the public count floor and 2dp stay in `lib/terminal-marked-task-cost.js` / `kpi-stats` as population logic, and call the read's fold. The privacy rule stays: no identifier crosses `kpi-stats.js`.
* **S12 keeps today's day bucket:** the day of the lineage's earliest *in-window* member. This is a named display rule, not fixed here.
* **Incomplete rule on S11 (review note 1):** decide whether it applies and name the choice either way. The reviewer recommends applying it, because today a done opencode straddler is folded from its in-window deltas only and counted as `fullyPriced`, an undercount shown as complete. If you apply it, add the public movement to the change list as "(d) also reaches S11: a done opencode straddler's component is no longer priced", and allow exactly that difference in W6. Piece 1's corpus has the fixture case. If you exempt S11 instead, record the silent partial under "Left, and why" on LIN-4176.

**Run and session page: S13** (`lib/run-view.js`, session loops from `routes/dashboard.js:691`). Grouping by `rootItemId ?? loopId` (`lib/pipeline-loops.js:360`) stays a display decision. Only the per-group figure and the total come from the read. Fix the display: a complete `$0` shows `$0.00`, not "not reported"; an unpriced or unreadable lineage still withholds; the total shows only when complete.

**Delete in this change:** `joinCostLineages` (`lib/dispatch-lineage.js:187`), `reduceLineageCost` (`lib/terminal-marked-task-cost.js:68`), `windowedSpend`'s reduce (`lib/weekly-budget.js:26`), and `run-view`'s `lineageCost` (`lib/run-view.js:252`). Fix S12's all-unpriced-day `$0.00` (`lib/render-workspace-kpis.js:150`). Use piece 1's `formatUsd` wherever these renderers format a figure they touch.

## Change list this piece may show in the replay

* (b) On S11/S12, the same lineage set, but a straddler's ticket is credited to its founder's issue. The replay lists every lineage whose issue moves on the public path.
* (d) S12 no longer shows `$0.00` for an all-unpriced day; S13 shows a complete `$0.00`; S11 incomplete per your note-1 decision.
* Nothing else.

## Testing

* **W2**, KPI part: S11/S12 select the same lineage set as the golden; the straddler's ticket is credited to LIN-42; S12 puts it in the golden's day bucket.
* **W5**, S13/S12 part (tries the softened guard): an unpriced lineage and an unreadable lineage still show "not reported"; a complete 0 shows `$0.00`; an all-unpriced S12 day is not `$0.00`; `formatUsd(null/undefined)` never returns a dollar figure.
* **W6** `/kpis` unchanged: the replay of `computeTerminalMarkedTaskCost` and the public block equals the golden except (b) credits and, if taken, the note-1 movement. **Assert what is true today (review note 2):** the cost card's lineage set equals the outcome rate's lineages that have at least one `taken` member, and no lineage is in the cost set but not the outcome set. The outcome grouping also keeps never-ran lineages (`lib/dispatch-lineage.js:137-160`). Run this assertion at HEAD first. `kpi-stats-pins` and the privacy assertion stay green.
* **W4**, this piece's part: S1 = S13's group figures; S12's period sum = S11's per-lineage costs over the same lineages; S5's 30-day total = S12's 30-day sum over the lineages both count \[N5\]. The replay lists any lineage one counts and the other does not, with its reason.
* **W9**, for S11/S12/S13: every replay difference is on the change list.
* The founder-lookup timing on the seeded store is reported in the PR.

**Done when:** S11, S12 and S13 read from `cost-read`; the four copies above are deleted; the S12 and S13 display fixes are in; the note-1 decision is made and named; W2 (KPI part), W4 (part), W5 (part), W6 and W9 (part) are green; the lookup timing is in the PR.

Session fit: fits one session

Plan-review due: no — covered by LIN-4176's approving plan-review (comment 6645f289-b9a5-4dd7-a5d2-8c7ec9170fd8, rev 2)

Grounding commits: Harbour `main` `9e397e6b` (tidy 5 at `46b43b3b`); runner `5379817`. Re-grounded at breakdown on 3 Nov; nothing has moved since.

*End of what was asked. Steps write below this line; nothing above it changes.*