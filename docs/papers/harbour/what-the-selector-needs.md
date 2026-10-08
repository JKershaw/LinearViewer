---
title: What is the stage selector given, and what does it actually need to choose correctly?
kind: paper
version: 1
date: 2026-10-08
authors: [Claude (LIN-3372)]
model: "Research: Claude Code CLI dispatched by simple-dispatcher, notes in the LIN-3372 research comment (8 Oct 2026, 21:27Z); the replay and ablation calls ran on openai/gpt-5.6-sol, the workspace's router model, at temperature 0 (about $12). Paper: Claude Sonnet 5.5, Claude Code CLI, dispatch 6141d232 (kind implementation, LIN-3372). The paper re-reads the research branch's recorded results; it ran no new model calls."
grounded_at: a3b946a5 (LinearViewer, origin/main, 8 Oct 2026; the selector as it stood on the day of the misroutes). Evidence at research/lin-3372-selector-context@c691aa52
cites:
  - "research/lin-3372-selector-context@c691aa52:scripts/eval/lin-3372-selector-context/ (README.md, harness.mjs, points.mjs, runs/*.json, corpus/*.json, gate/*/report.md, fixes-experiment.patch)"
  - "lib/stage-router.js@a3b946a5:23-34 (SELECTOR_RULES) and :83 (buildRouterPrompt)"
  - "lib/openrouter.js@a3b946a5:788-789 (SELECTOR_COMMENTS, SELECTOR_COMMENT_CAP), :814 (formatSelectorView), :880-884 (buildSelectorArgs, leaf gate)"
  - "lib/recommendation-facts.js@a3b946a5:285 (assembleTrailFacts), :309 (plan facts), :358 (ledger line), :393 (formatNodeFactsBlock), :405 (PLAN_HEADING), :444 (condensePlan)"
  - "lib/providers/linear/index.js@a3b946a5:1010 (parent: id, identifier, title, state), :1204 (noDescend)"
  - "routes/workspace-api.js@a3b946a5:987, :1324, :1394 and routes/proxy.js@a3b946a5:1624 (the routed surfaces)"
  - "scripts/eval/jev-routing-eval.mjs (arm 3, openai/gpt-5.6-sol, K=3, 92 fixtures): the gate LIN-3300 used"
  - "LIN-3372 (description and research comment, 8 Oct 2026); LIN-3300 comment (5 Oct 2026 08:20); LIN-3294 (3 Oct, the brief-writer comparison, not the selector eval)"
---

# What is the stage selector given, and what does it actually need to choose correctly?

**The selector is given more than it needs and less than it should, and cutting is not the
fix.** A call carries a median 11.9k characters (p90 28k, most 48k). Fifty-seven percent is
fixed stage descriptions and rules, 24% the description, 12% the newest three comments and 4%
facts computed in code. Those facts decide the routes that went wrong on 8 October. The
description's late sections were not unseen: the hypothesis was tested and is refuted. The
misroutes come from four shapes in the facts and the stage descriptions, and a fifth effect,
the model splitting at temperature 0 wherever two signals disagree. Cropping the description
or limiting comments saves 7–10% of the prompt and fixes none of them. Four small fixes, each
at its cause, do (82 of 90 decision points right, against 39 of 90 on main), and they pass the
existing gate. They are the recommendation for the next ticket; this paper changes no code.

## Findings

**1. The selector's input is small, mostly fixed, and the parent's description is not in it.**
Over the 92 eval fixtures the prompt is 11.9k characters at the median. Stage descriptions are
6.5k of every prompt. Rules are 1.9k. The description as shown is 0.65k at the median but up to
35k; comment bodies 0.95k median, 8.4k most; trail and node facts 0.54k median, 1.1k most. On
the 8 October points the prompts were 11.9k to 43.9k characters, about 3k to 11k tokens. Code
cuts two things: a `## Implementation Plan` over 3,000 characters is condensed (each subsection's
lead up to 400 characters, the whole session-fit section, and every line about session fit,
plan-review due or a revision), and comments are the newest three, each capped at 2,000
characters, plus the latest ruling and the latest person's comment wherever they sit. Everything
else in the description is shown whole. A task's **parent arrives as identifier, title and state
only**; its description never reaches the selector. All four routed surfaces build the same
context.

**2. "Late sections of long descriptions go unseen" is refuted.** Deleting the whole description
changed no route on P1–P7, P10, P11 or P12 (`runs/descNone.json`). On LIN-3357 and LIN-3358 the
deciding lines (`plan-review due: yes`, the session-fit line) are inside the condensed plan, at
line 213 of a 368-line prompt, and the model quotes them when it does choose `plan-review`.
Cropping the description's middle to its first and last 3k made LIN-3356's close-out worse: 10 of
12 answers became `retrospective-audit`, against 14 of 14 `close-out` with the full description.

**3. Four shapes in the facts and stage descriptions, not length, produced the misroutes.**
Each was replayed at the moment of decision on the router model (counts pooled over valid
batches on main):

- **S1, defer against plan-review timing (LIN-3357, LIN-3358).** The plan created its children
  before its own plan-review, and `defer` (rule 4) is checked before `plan-review` (rule 8), so
  the parent defers: 3 of 90 right after revisions. The FC's "plan" on these tickets was not the
  parent's answer. The parent said `defer`; the descent into LIN-3358's child LIN-3364 then said
  `plan` (4 of 6), the last hop of the descent.
- **S2, a leaf whose plan lives on its parent (LIN-3354, LIN-3355, and the LIN-3364 hop).** The
  leaf reads "Implementation plan: none" and routes to `plan`: 35 of 60 right. The plan is in the
  parent's description, which the selector never sees.
- **S3, conditional Approve read as a fix round (LIN-3356).** "ledger: 4 item(s), 4 not
  discharged", with the review's findings in the comments, reads as work to do: 5 of 30 right.
- **S4, merged but not Done (LIN-3356 while the close-out runs).** "Merged" reads as
  `retrospective-audit` though the task is In Progress: 2 of 18 right.

**LIN-3340 did not reproduce** (66 of 66 right). The first LIN-3357 point (P1) stays wrong in
every variant because the FC's own ruling said the plan was accepted; its gold is arguable.

**4. Wavering is the model splitting at temperature 0.** Where two signals disagree, identical
prompts give split answers, and the split moves between batches (LIN-3354 gave `implementation`
5 of 18 in one batch and 10 of 12 in another). "Asked twice within seconds, two answers" is this.
Comparisons therefore have to run their arms concurrently, and one batch of K=3 says little about
a boundary fixture.

**5. Little is safe to cut, and it saves little.** On the 92 fixtures, K=2 per variant, run
concurrently:

| variant | right | mean prompt characters |
|---|---|---|
| main | 159/184 (86.4%) | 15,608 |
| no description | 150/184 (81.5%) | 11,906 |
| description cropped to its first and last 3k | 161/184 (87.5%) | 14,007 |
| newest comment only | 163/184 (88.6%) | 14,531 |

The description decides terse tickets (LIN-1892, FIX-830-neg, SYN-10, 12, 14, 23 fail without it).
The cropped and comment-limited variants are within noise on the corpus but save 10% and 7%, and
cropping made a known case worse (finding 2). Removing the facts fixes P2–P6 and P8–P9 and breaks
P11–P12: the facts decide, both ways. Hiding comment bodies breaks P8 and P9 (a spike's PR link has
no explanation). So no cut is recommended. Nor is there "plenty of safe context": the part that
decides is the 4% of facts, and the 57% fixed text is the stage vocabulary.

**6. Four fixes, each at its cause, repair the points and hold the gate.**

| fix | cause | points alone | main |
|---|---|---|---|
| b | `defer`'s "Not when" names `plan-review` when the task's own plan is due one (S1) | 30/30 | 3/90 |
| c | a leaf with no plan reads its parent's plan as its plan; providers pass the parent's description (S2) | 24/24 | |
| d | under an approving review the ledger reads "left for close-out to discharge" (S3) | 12/12 | |
| g | `retrospective-audit`'s "Not when" adds "merged but not Done (`close-out`)" (S4) | 18/18 | |

Together on the 15 points: **82/90 against 39/90 on main**, same batch. On the gate
(`scripts/eval/jev-routing-eval.mjs` arm 3, `openai/gpt-5.6-sol`, K=3, 92 fixtures, arms
concurrent), b+c+d+g scored 241/276 against main's 240/276, 82 fixtures right by majority against
80, and none that main gets right goes wrong. That meets LIN-3300's rule. Rejected variants:
plan facts on nodes (no effect); withholding `retrospective-audit` from the options, which fixed
S4 but cost HAR-697 (1/9); a "Done: no" fact, which did not fix S4. Routing cost is unchanged
(input tokens within 1%).

## Method

The harness rebuilds the exact routing prompt for a ticket as it stood at a past moment:
comments and the task's dispatch runs cut at that time, and description, state and child states
from the task-history snapshot taken at the next dispatch. It is `buildSelectorArgs` line for
line plus ablation knobs; with no knobs all 19 rebuilt prompts are byte-identical to the
library's. There are 15 decision points (P1–P12b, timed from comment and dispatch timestamps)
and 4 descent hops; gold is what the FC then dispatched. Calls use the workspace's router model at
temperature 0 with the same request body as `getRecommendation`. Ablations ran on the points
(K=4–6) and on the corpus, graded by the eval's own `gradeAnswer`. Candidate fixes lived in a
scratch worktree behind env toggles (`fixes-experiment.patch`; with toggles off the prompt
snapshots pass unchanged). The gate ran twice, main and fix concurrently. The population of
selector builders is closed by `grep -rn buildRouterPrompt lib routes` (only `openrouter.js` and
the snapshot test).

## Limits

- **The gate cannot see S1, S2 or S4.** None of the 92 fixtures has those shapes, so the gate shows
  only that the fixes cost nothing elsewhere. The 82/90 on the decision points is the evidence they
  fix the misroutes, and those 15 points were the ones the fixes were designed against.
- **The FC's own transcript is unavailable** (`GET /flight-companion/transcripts` returns 0), so
  which hop and call order the FC saw is inferred from replay.
- **K is small and the model is noisy.** Boundary fixtures (HAR-697, SYN-12, SYN-15, SYN-22) need
  K≥6; a main-against-main gate moved 3 calls. The two fixtures that flipped to right are within
  that scale.
- **The corpus ablation is K=2** and within noise; it supports "not worth cutting", not "cutting
  is harmful".
- **Replay is of the 8 October code.** LIN-3364 changed the run outcomes afterwards but left
  `blocked` reading as "waiting on a person"; later changes are not assumed.
- **The router model is one model.** A different router would split differently.
- **LIN-3340 did not reproduce**, so its two-answer behaviour is unexplained by this paper.

## Next

The recommendation becomes the next ticket: ship b, c, d and g, and in the same change add the
15 points as eval fixtures, pay the prompt-size freeze, and re-run the gate at K≥6 on the boundary
fixtures. The selector-change pins that ticket must update are the
`tests/fixtures/stage-router-prompts/` snapshots, `tests/unit/prompt-size-budget.test.js` (its
source-byte freeze fails on the patch), a `scripts/prompt-template-change-log.md` row, and
`docs/architecture/prompt-system.md`. Fix c touches Linear, Jira and Local providers; GitHub and
GitHub Projects have no hierarchy, so it is inert there. This paper itself updates none of them.
One line goes into `proposals.md`: whether the fixed 57% of the prompt (the stage descriptions) is
what makes the model split where signals disagree.
