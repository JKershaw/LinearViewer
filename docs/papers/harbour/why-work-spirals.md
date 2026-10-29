---
title: Why does Harbour's work spiral instead of converging?
kind: paper
version: 1
date: 2026-10-29
authors: [the LIN-4020 implementation session, for John]
model: claude-haiku-5-5 in Claude Code, by dispatch lineage; effort not recorded in the dispatch
grounded_at: a11e1f8d
cites: [LIN-4020 (research notes 29 Oct 09:22Z; brief and implementation plan), LIN-4009 (comments 26 Oct 15:45Z–19:01Z), lib/prompt-template-defs.js@a11e1f8d:300-302, lib/prompt-template-defs.js@a11e1f8d:580-586, lib/prompt-template-defs.js@a11e1f8d:829-831, lib/prompt-template-defs.js@a11e1f8d:801-802, lib/recommendation-facts.js@a11e1f8d:398-445, docs/runbooks/improvement-cycles.md@a11e1f8d:85, docs/archive/9.html@a11e1f8d, docs/papers/harbour/review-loops.md@a11e1f8d, docs/papers/harbour/how-process-changes-land.md@a11e1f8d:74-77, docs/papers/harbour/model-choice.md@a11e1f8d:152-161, docs/papers/harbour/coherence-as-it-grows.md@a11e1f8d:14, docs/papers/harbour/how-the-charter-got-complicated.md@a11e1f8d, docs/papers/harbour/flow-and-convergence.md@a11e1f8d]
---

# Why does Harbour's work spiral instead of converging?

Most of the spiral is one loop, and it runs before any code is written: the plan and plan-review pass the same enumeration back and forth. The stage templates tell research to name every class a ticket touches and bound it, tell the plan to work from those classes, and tell plan-review to send back any class that is wrongly bounded. Concepts such as "blue" or "which run is waiting" have no sharp edge in code, so each round finds one more member, and each member is written into the shared description that the next stage reads. The loop code counts a falling number of blocking findings as convergence and grants more rounds, so a count that keeps finding members can look like progress. Three things amplify the loop: code shape makes some bounds hard to draw, stage output accumulates in one description, and operator rules are added and rarely removed. The record supports this engine and these amplifiers. It does not test whether a different model would avoid the loop, or whether changing only the loop would make it converge.

**Labels.** *checked* means I re-read the claim against the source at `a11e1f8d`, the record, or the paper I cite. *not checked* means the claim comes from the research comment, from one reader, or from John's account, and I did not re-read it. Times are record times (`createdAt`, UTC).

## Findings

**1. The engine is an enumerate-bound-reject loop, and the templates set it running.** Research must name the classes a task touches, bound them, and list their members. The template says that "the classes you name here are what the plan, and the review that follows, will be held to" (`lib/prompt-template-defs.js@a11e1f8d:580-586`). The plan must "work from research's classes" (`:302`). Plan-review's first check says that "missed classes are **Request Changes**", and that a plan is sent back "only for a missing or wrongly-bounded class" (`:829-831`). The same check says that "arguing a bound converges; discovering members one at a time do not." A send-back that asks for one more member is therefore a valid send-back, and the next round has a longer list to hold the plan to. The record of send-backs bears this out: `review-loops.md` read eight verdicts on three tickets and found each asked for one more member of a list the plan had built, and none asked for a different design. *Checked* for the template text and its dates: "Audit the Layers" was added on 27 June (`7e7029f9`) and "Name the Classes" on 12 September (`eb7be9c4`), both found by `git log -S`. *Checked* for the eight verdicts, as the paper reports them. *Checked* for LIN-4009 (finding 3). *Not checked* for the other tickets in the research's coded set.

**2. The loop code reads a flat count of one as convergence.** `reviewLoopConverging` (`lib/recommendation-facts.js@a11e1f8d:415`) counts a plan as converging when its last two Request Changes verdicts show a lower blocking count, or when both show one. Once the review count reaches the bound of three (`:398`), a converging plan gets rounds up to a ceiling of five (`:406`); a plan that is not converging stops for a person. The rule was added on 18 October, after the bound had stopped five converging plans that day (`docs/runbooks/improvement-cycles.md@a11e1f8d:85`). The consequence is that a loop can read as narrowing while it keeps finding members of one concept. Two verdicts of one blocking finding say the plan misses things at the same rate, not that it is closing in. *Checked* for the code, the runbook line and the rule's wording. *Checked* against LIN-4009, where the bound was reached and a person chose to continue (finding 3). *Not checked* for the research's reading of the Oct 23–26 tickets, which is one reader's coding.

**3. LIN-4009 is the clean worked case, and each round found a member.** Its brief said "Use your judgement on the how", and that sentence is still in the ticket's description (*checked*). Plan-review returned Request Changes five times on 26 October, at 15:56, 16:05, 16:14, 16:34 and 16:41Z (*checked*). The first round said of the blue class: "None of these is a fill, so Done-when still holds" (*checked*, 15:56:11Z; the sentence that follows, which the research quotes, was not re-read). By the fourth, the reviewer's objection was that the focus-ring class was "bounded by the symbol `var(--blue`, not by the colour", so it missed the focus token (*checked*, 16:41Z). At 16:14Z the count reached three. The autopilot's own note says the engine would have returned the plan as blocked. A ruling resolved at 16:30Z chose one more review, as its recommendation proposed, and put the plan at about 40k (*checked*, 16:30:41Z and 16:31:12Z). A second ruling at 17:14Z, at the five-review ceiling, chose one more revision and implementation with no sixth review (*checked*, 17:14:42Z). After the build, the post-build review found a link in the browser's default blue, `rgb(0,0,238)` in light mode, which no class bound had listed (*checked*, 18:34:03Z). The PR merged, and close-out was filed at 19:01Z (*checked*). The research's further figures, a 1.7 KB brief and a plan that grew from 13 KB to 45 KB, were not re-read: the record holds a pre-prune description of 56,570 characters, and the ticket is now pruned to about 3,000.

**4. What separated fast from slow tickets was whether plan-review fired.** The research coded twelve tickets. Four had no plan-review and finished in 40 to 65 minutes: LIN-3986, LIN-4003, LIN-3992 and LIN-3995. Its correction to the ticket matters here. The ticket said that questions answered before launch separated them, but LIN-3975, LIN-3977 and LIN-3983 also had John's answers before launch, so that is not the separator. What decides it is the plan's own line: the plan template gates plan-review on whether the plan says "plan-review due: yes" (`lib/prompt-template-defs.js@a11e1f8d:801-802`), and the planner writes that line. This paper therefore does not repeat the ticket's simplification. The planner's judgement that a ticket needs several sessions is the switch. *Checked* for the gate and the planner's line. *Not checked* for the twelve-ticket coding and its counts.

**5. Three amplifiers keep the loop fed.** The first is code shape. `coherence-as-it-grows.md` reports that 46% of plan-review send-backs are about code shape, up from 22% in July to 47% in October, because scattered decisions make a class's edge genuinely hard to find (*checked*, the paper's figure as printed; the underlying data was not re-run). The second is the shared description. Each stage writes its output into the one ticket description, and the next stage treats it as the contract. LIN-4009's later verdicts refer to "the description's `## Implementation Plan`" at each revision (*checked*), so a plan revised four times is read as four layers of contract. The third is that rules are added and not removed. `how-process-changes-land.md` counts adds outnumbering removals about six to one across the process changes it measured, and none stated a condition for retiring it (*checked*, its text at lines 74–77). `flow-and-convergence.md` makes the general case: the part of a fleet that is counted but not limited grows (*checked* against its abstract; the essay's body was not re-read). These amplifiers do not start the loop. Without the enumeration rule, they would have no bound to push against.

**6. The record against John's account.** John's words on 29 October, from the ticket, were: "My gut feeling is the agents too prescritivly following too prescriptive rules through too prescriptive pipeline stages" (*checked*, the ticket's description). Set against the record:

| John's claim | What the record shows | Label |
|---|---|---|
| Agents follow prescriptive rules through prescriptive stages | Supported and locatable: the class rules in findings 1 and 4, and the loop code in finding 2. | *checked* |
| Tickets are dense and long | By the time code runs, yes: LIN-4009's description ran to 56,570 characters before pruning. But the growth is stage output, and length does not predict outcome: `ticket-record-and-quality.md` finds the record's size predicts nothing about first-pass approval, and `how-a-task-is-composed.md` finds median sessions of 7, 6 and 7 across thirds of 335 tickets. | *checked* (papers' figures as printed) |
| Written one way, read another | Supported, in a specific form. Research writes an exploration, and the template makes it binding: "what the plan, and the review that follows, will be held to". | *checked* |
| Model: Anthropic's 5-series does this, OpenAI's would not | Not testable from this record. There is no OpenAI comparison. The tier evidence is on Opus 5 and Sonnet 5, and `model-choice.md` finds the rise in dispatches per change at both tiers after 12 July, which is not a tier effect. The research also cites Anthropic's own published guidance on over-applied emphasis; that was not re-fetched. | *checked* for the record; *not checked* for the guidance |
| Over-complicated, with edge cases, and moving fast without checking | Half. Edge enumeration is the engine, and the plan's checking is heavy. It checks the enumeration rather than the outcome. The defect that mattered in LIN-4009 came from the post-build review, not from any class bound. | *checked* |
| Harbour assumes tasks are correct | Supported in the archive: "Harbour executes the words it is given rather than holding the intent behind them" (`docs/archive/9.html`). | *checked* |
| The 29 October operator session | Not in the record. This paper quotes it only as John's account and does not treat it as evidence. | *not checked* |

**7. The timeline.** Dates the paper relies on:

| Date (2026) | Event | Label |
|---|---|---|
| 27 June | "Audit the Layers" added to research: coverage, not speed (`7e7029f9`). | *checked* |
| 12 September | "Name the Classes" added (`eb7be9c4`). `review-loops.md` reports 11 of 94 plans approved first time. | *checked* |
| Early October | Stage templates rebuilt. The meta-prompt goes; the class rules stay. | *not checked* (research) |
| 18 October | LIN-3651 adds the narrowing rule to the loop bound, after the bound had stopped five converging plans. | *checked* |
| 26 October | LIN-4009: plan-review 15:56Z; count reaches three 16:14Z; ruling to continue 16:30Z; ceiling ruling 17:14Z; post-build review 18:34Z; close-out 19:01Z. | *checked* |
| 29 October | LIN-4020 created 08:32Z; research comment 09:22Z. | *checked* |

## Method

The research comment is the main source. I re-read the stage template and the loop code at `a11e1f8d`, where `origin/main` still stands, and checked that the cited lines hold. I ran `git log -S` on each rule to date it. I read LIN-4009's comments and rulings through GET requests on the Workspace API, and I searched `docs/archive/9.html` for the quoted sentences with an exact-string match. I read the cited papers' figures in their text. Nothing was changed except this paper and its three companion edits, and no model was called.

The LIN-4009 evidence is its comments and rulings as the Workspace API returned them at this check. The twelve-ticket coding stands as the research recorded it. The class of looping tickets has no sweep here: the members are in production data, not in the source tree, so the earlier counts in the papers stand in for them.

## Limits

- LIN-4009 shows the mechanism, not its rate. The bound and the ceiling each stopped the plan, and a person chose to continue past each: the rulings were recorded through the autopilot, and the choices in them were the person's.
- The record cannot test a different model. It has no OpenAI comparison, and its tier data is Opus 5 and Sonnet 5. The 12 July step shows the cost rise was not a tier effect, but it is one step and does not isolate the model.
- The record cannot test whether changing only the loop would converge. The engine is the best-supported account, not a demonstrated one.
- The population of looping tickets is not bounded. The twelve-ticket coding is one reader's, and the papers' counts come from earlier windows.
- The 29 October operator session is John's account and is not in the record.
- The line numbers were checked at `a11e1f8d`. They will drift as the files change.
- A paper is meant to be checked by a second document. This one is not yet checked, so its findings are unchecked by a second reader.

## Next

- Does research that informs the plan without binding it shorten the plan-review loop on tickets that carry research classes? Compare rounds, sessions and later-found faults with the same kind of ticket under the current rule.
- Does plan-review judged against the ticket's intent and Done-when, rather than against class completeness, converge in fewer rounds, and does it still catch what a class bound caught?
- Does a convergence measure other than blocking count tell a converging plan from one that keeps finding members, and would it have stopped LIN-4009 before the fourth review?
