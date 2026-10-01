---
title: Taken together, what did the steady-base expedition find, and what is the menu of changes John can choose from?
kind: paper
version: 2
date: 2026-10-01
authors: [Claude (version 1, LIN-3194), Claude (version 2 corrections, LIN-3195), for John Kershaw]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 9f3f13bd, kind custom, LIN-3194); the dispatch item carries no effort field. One bounded session with no research, plan, review or close-out legs and no in-session subagents, by the brief's design. No new measurement: every figure is read from a cited paper at version 2 or later, or is arithmetic over such figures and says so."
revision: "Version 2 corrects statements per docs/papers/harbour/survey-check-12.md (LIN-3195). (1) F1 by class is 10%, not 10–14%: the 14% needs code to know in advance which wakes change nothing, so S1 is ×1.19–1.26 and no stack's low end uses 14%. (2) Tracker chores sit 58% in supervisor sessions, so lighter legs (M12) is 12.3–13.9% of what F1 leaves, not 10–15%. (3) M13 is 5.2% × 0.4–0.8 = 2.1–4.2% of fleet tokens, not 1–3%; close-out has run at the cheap tier since 25 September. (4) M17 is 1.23×, an 18.7% cut (survey-check-9). (5) M8's upper end, M11 above 1.7%, M14's 0.2 and M10's 1.5–2% have no source. The whole menu is ×1.57–2.38, ×1.49–2.10 with credential work held. (6) M15 (held-or-fresh C) and M36 (where-judgement 4) were omitted and are added; prototype-concepts E is a correctness option at a cost, not a not-recommended saving. (7) Part 1: escapes rose about threefold without finder rows; the four-times claim that did not survive was the mid-tier ratio. Re-finding is 4.9–12.1% of all tokens. (8) Part 4: the scorecard's ×1.3 floor is in dispatches or hours per correct change, not in tokens; the trial figures and Step 0 are restated. (9) Costs are in weighted tokens, not currency."
grounded_at: 01277614 (LinearViewer, origin/main); 3366748 (simple-dispatcher, origin/main). Read on 1 October 2026. Version 2 at 264d13f8, with the chores split from LIN-3189's token snapshot.
cites:
  - "docs/steady-base.md@01277614:11-137 (the findings, points 1–26), :139-153 (what this implies), :155-168 (how we will measure it), :179-210 (the map, rows 1–17), :216-226 (open questions), :228-269 (the evidence)"
  - "docs/papers/harbour/cost-mix.md@01277614:70-81 (September's budget by kind of change), :216-234 (the bound), :242-257 (the fixed part), :259-268 (split families), :318-332 (Options 1–6)"
  - "docs/papers/harbour/how-process-changes-land.md@01277614:48-71 (the history), :100-122 (half-finished), :126-145 (accretion), :167-176 (trial modes), :189-246 (the charging rules), :356-363 (Options 1–6)"
  - "docs/papers/harbour/held-or-fresh.md@01277614:324-333 (Options A–D)"
  - "docs/papers/harbour/where-judgement-happens.md@01277614:191-204 (Options 1–5)"
  - "docs/papers/harbour/starting-context.md@01277614:64-69 (role shares), :217-238 (Options A–E)"
  - "docs/papers/harbour/step-overlap.md@01277614:354-368 (Options A–E)"
  - "docs/papers/harbour/prototype-concepts.md@01277614:38-49 (what a paper and a check cost), :213-232 (Options A–G)"
  - "docs/papers/harbour/what-hides-between-sessions.md@01277614:340-358 (Options A–E)"
  - "docs/papers/harbour/replay-small-work.md@01277614:276-287 (Options 1–2)"
  - "docs/papers/harbour/what-supervisors-do.md@01277614:20-29 (77% mechanical; about 27% of fleet tokens)"
  - "docs/papers/harbour/wake-inventory.md@01277614:28-29 (18.9 and 14.9 wakes per correct change)"
  - "docs/papers/harbour/why-legs-repeat.md@01277614:179-190 (repeats: 3.1 dispatches per correct change, 10% of tokens, 44 of 430 close-outs)"
  - "docs/papers/harbour/which-rules-pay.md@01277614:125-129 (the mutation check's rounds)"
  - "docs/papers/harbour/model-choice.md@01277614:44-62 (tier is not the lever)"
  - "docs/papers/harbour/measuring-throughput.md@01277614:27-30, :161-166 (what the scorecard detects)"
  - "docs/papers/harbour/proportional-process-backtest.md@01277614:113-118 (light work is not already cheaper for its size)"
  - "docs/papers/harbour/survey-check-7.md, survey-check-8.md, survey-check-9.md, survey-check-10.md, survey-check-11.md@01277614 (what the fifth and sixth waves' checks changed)"
  - "docs/papers/proposals.md@01277614 (the open questions, ranked in Part 5)"
  - "scripts/survey-menu-analyse.mjs and scripts/survey-menu-figures.mjs (this paper's arithmetic and charts)"
  - "LIN-3194 (2026-10-01)"
  - "docs/papers/harbour/survey-check-12.md (LIN-3195: the independent check; scripts/survey-check-12.mjs)"
---

# Taken together, what did the steady-base expedition find, and what is the menu of changes John can choose from?

The expedition found that Harbour's cost rose while its quality held, and that the cost sits in
the process around each change rather than in the change: supervision that observable state
could decide, wakes that change nothing, sessions finding their bearings, and a full pipeline run
on work that review rarely faults. Model tier is not the lever. The menu that follows merges the
anchor's seventeen map rows and the Options sections of nine papers into 18 token-sized options,
7 sized in hours, 11 enablers and 6 things not to do, with every overlapping saving counted once.
Added as if nothing overlapped, the options' top figures come to 132% of the budget, more than the
whole. Counted once per cost factor and multiplied across factors, the stacks John can build run
from ×1.05 (the quick, reliability-neutral wins) through ×1.19–1.26 (the plumbing code can see
today) to ×1.57–2.38 for the whole menu. Only that last stack reaches 2×, and only in the upper part
of its range: it needs the deterministic conductor to take most of the 27% of fleet tokens that
supervision spends on bookkeeping, a lighter path for small work, and lighter legs everywhere, each
near the high end of its checked size. Applied on the same footing as `cost-mix.md`'s bound, with
credential work held at today's cost, the whole menu's top is ×2.1 against the bound's ×2.5. So
John's 2× is reachable on the evidence, but it is not comfortable, and the one figure it turns on,
how much of the supervision cycle code can decide, is the one the expedition did not measure. Each
option below carries its size as a range, its risk, its trial design and charging rule, its effort,
its dependencies, a finish line and a retirement condition; Part 4 recommends a landing order, and
Part 5 ranks what is still unknown, with the scorecard's charging rule and census as the
prerequisite for all of it.

![The menu: each option's size against its risk to correctness, with the stack that reaches 2× marked](figures/steady-base-menu/menu-size-vs-risk.svg)

## Findings

### 1. What we found, in one page

**The cost rose while quality held, and it rose around the change, not in it.** Net product code
has held near 2,800 lines a week since the fleet started on 1 June; test lines grew 10.6×,
production comments 7.1×, a unit-suite CI pass 8–10×, and the fleet's own machinery fastest of all
(`growth-atlas.md` v2; anchor point 1). Escaped defects did not move: LinearViewer's September
without review residue is 5.7 per 100 merged PRs against 5.4 in June, and simple-dispatcher's 27.3
is within noise of its June (`reliability-baseline.md` v2 §Findings; anchor point 5). June was a
different regime, not a lost level: a correct change kept its size, and most of the fall from 113
to 65 merged tickets a week is fewer tickets, the rest a lower correct-and-complete share
(`why-throughput-halved.md` v3; point 11).

**Where the cost sits.** September's 3.6B weighted tokens, both repos, child-named
(`cost-mix.md` v2 §Findings, the mix table): proxy, dispatch and fleet machinery 27.1% (about 10
points of it rulings, Flight Companion and scan work); work that merged no change of its own 22.5%
(parents 13.0%, unmerged 4.6%, no ticket 4.9%); docs and tests 18.0%, of which the survey papers
10.0%; credentials and auth 9.7%; simple-dispatcher's own production code 8.2%. By layer, the
supervision layers take 35% of weighted tokens (`where-the-effort-goes.md` v2 §Findings), and 77%
of that is steps fully determined by observable state, about 27% of the fleet's tokens; a blind
recode puts the mechanical share at 86% (`what-supervisors-do.md` v2 §Findings; `survey-check-2.md`).
Implementation is about 24%. A change of a few lines still costs about 4.2M weighted tokens, ten
dispatches and an hour; a change of a few hundred lines costs two to three times that, so at least
half of a standalone change's cost is fixed and the linear fit puts the size-independent share
near nine-tenths (`cost-mix.md` v2 §Findings, the fixed part; `survey-check-9.md`).

**What raised it.** Fresh sessions per correct change have been flat at about 11 since August;
wakes went 8, 10, 16 and 18 per correct change by the session entered, or 29 by the child the log
names (`what-doubled-the-dispatches.md` v2 §Findings; `survey-check-4.md`). On the wake inventory's
cohort that is 18.9 wakes per correct change by the child and 14.9 by the session entered, 6.9 and
3.4 of them changing nothing (`wake-inventory.md` v2 §Findings). 31% of wakes change nothing and
are 25% of the supervision bill; 35% of all wakes are a supervisor relaying its own "still waiting"
upward, 97% of those quiet (`what-supervisors-do.md` v2; `wake-inventory.md` v2). A held
supervisor's wake costs a few thousand tokens plus 0.11 of its accumulated context, so the cost
of holding rises with history; a fresh one reads 116–238k tokens to its first decision after a
62–82k bootstrap (`held-or-fresh.md` v2 §Findings). Orientation before a session's first productive
call is 6–26% of tokens, and re-finding what an earlier session on the ticket read is 4.9–12.1% of
all tokens (`starting-context.md` v2 §Findings). Repeat legs are 3.1 dispatches per correct change, 7.8% by
the log's line and 9.0% by the session entered, and 10% of tokens (`why-legs-repeat.md` v2
§Findings).

**What was ruled out.** Cheaper implementers: a correct, complete change costs about the same
whole-life hours at frontier (2.9–3.0 h) and mid tier (3.2–3.3 h), and the step at 12 July raised
dispatches per correct change about two-and-a-half-fold at every tier (`model-choice.md` v2
§Findings). A lighter path as a large lever: light work is not already cheaper for its size, and the
most a lighter process can save is what the light groups cost now, 13–18% of hours and 21–30% of
dispatches (`proportional-process-backtest.md` v2 §Findings), about 1.1–1.2× in correct work per
budget (`cost-mix.md` v2 §Options). Starting every judgement step fresh: the relay as proposed is 0%
(−17% to +9%) while fresh sessions orient as they do today (`held-or-fresh.md` v2 §Options D).
Writing less: ticket text is 1.3–2.4% of carried context (`step-overlap.md` v2 §Options E). More
effort for a change's size does not go with fewer wrong changes within any class (`cost-mix.md` v2
§Findings, the curve). And the claim that mid-tier changes escape four times as often did not
survive re-derivation (`model-choice.md` v2); without finder rows the escape share rose from 1.1% to
about 3% after July, not to 7.1% (`survey-check-3.md`).

**The ceiling.** Holding credential work at today's cost, everything else three times cheaper
gives 2.5×, ten times cheaper 5.3×, free about 10×. Holding fleet machinery too, the ceiling is
2.7×, or about 3.7× if its rulings and Flight Companion work need not stay rigorous
(`cost-mix.md` v2 §Findings, the bound; `survey-check-9.md`). Cost-mix's own options 1–4 come to
1.7–1.8× together, not their product, because they cut the same spend. Reliability is steady, so
the baseline is clean: this is cost removal, not a quality fix, and the scorecard will say if that
is wrong (anchor, what this implies).

### 2. The menu

Every candidate from the anchor's map rows 1–17 and the nine papers' Options sections, merged.
Version 2 adds two the first version left out, M15 and M36; M15 fills a number version 1 skipped.
Where two options are one lever measured twice they appear once, with both measurements cited.
Sizes are shares of September's fleet weighted tokens, both repos, as the cited paper states them;
"derived" marks a range this paper computed from checked figures, which is not itself checked. The
cost factor names the pool an option draws on; options in one factor overlap and are counted once
in Part 3. Repo says where the change would be built: LinearViewer (LV), simple-dispatcher (SD) or
both. The charging rule follows `how-process-changes-land.md` v2 §Findings 5: pooled or lineage
spread for savings that land above a ticket, session entered for savings inside its own sessions.

**Factor F1, supervision plumbing: tokens in supervisor sessions that observable state decides.**
Measured by the pooled scorecard (hours and tokens per correct change) with lineage spread beside
it; the session-entered rule is blind to it and reads zero.

| # | Option (map row or paper option) | Repo | Size | Risk to correctness | Trial | Effort | Depends on | Finish line | Retire if |
|---|---|---|---|---|---|---|---|---|---|
| M1 | **Stop waking parents for "still waiting"** (map 1; `held-or-fresh` v2 A; `where-judgement` v2 1) | both: SD delivers, LV mints in `addFeedback` | 5.7% by the class code can see (`held-or-fresh` v2 §Options A); quiet wakes are 7–10% of dispatches per change, by charging rule (`what-doubled` v2) | Low–medium: lost wakes are the most common supervisor failure (15 of 25; 11 of 15 lost in the runner's delivery), and 27 were lost in September by the wait graph (`wake-inventory` v2; `what-hides` v2). Code must still pass the 39% of progress wakes that lead somewhere | Shadow, then cutover between passages; pooled | S–M | M22 (a truthful completion post) and a lost-wake detector first | Relayed re-arms stop reaching parents; the old prose path deleted | Lost-wake incidents or hours waiting rise on the scorecard |
| M2 | **The passage layer's bookkeeping in code** (map 2; the Runner part of `held-or-fresh` v2 A) | LV (Runner prompt, passage routes); SD delivery | 4.1% of the month's fleet tokens; 5–15% during passages (anchor row 2); the passage layer is 8–15% of dispatches per change by rule (`what-doubled` v2) | Low: the Runner keeps its role, only its polling moves | As M1, measured across a passage | M | M1's delivery path | The Runner is invoked only on events that need judgement | Its wakes per worker event (3.0 inside a passage) do not fall |
| M3 | **A deterministic conductor for the supervision cycle**: completion gate, re-arming, restating, liveness clocks and detectors in the runner and dispatch code; contains M1, M2, M5 and the detectors M21 (map 3; `prototype-concepts` v2 B; `what-hides` v2 A in mechanism) | both | 10% by class, 14% if code could tell which wakes change nothing, up to 27% if every mechanical supervision token moves, about 30% on the blind recode's 86% (`held-or-fresh` v2 §Options A; `what-supervisors-do` v2 §Findings; `survey-check-2`). The 14% is sized by outcome, which code cannot see in advance (`survey-check-7`), so only the 10% is reachable on today's evidence. How much of the answering is already in code is unmeasured (anchor point 3) | Medium: the largest change; the plumbing moves rather than vanishes, and 21 of 25 supervisor failures on record were bugs in that plumbing (`what-supervisors-do` v2) | Shadow mode on one role's gate until 1,000 paired decisions agree (under a week fleet-wide, where about 1,450 follow-ups arrive a week; longer for one role), cutover as a before-and-after between passages, old path deleted in the same series (`how-process-changes-land` v2 §Options 3); pooled | L, in slices | M1, M2 landed; the charging rule and census chosen (Part 5) | No supervisor prompt asks a model to answer the completion gate, re-arm or poll; the slices' switches deleted | Agreement under the shadow's bound, or the correct rate or lost-wake count moves against the baseline at a slice |
| M4 | **A lean relay: judgement steps start fresh from a small handoff**, mechanical steps in code (map 16; `held-or-fresh` v2 B; `prototype-concepts` v2 C) | both | −9% to −19%, overlapping M1–M3 (`held-or-fresh` v2 §Options B: a further −5 points on top of A at a 20k handoff, −9 at none, 0 at about 40k; at a 60k handoff no better than A by class, `survey-check-7`. The 21k break-even belongs to the relay as proposed, option D) | Medium: the handoff must carry verdicts, plan text, code and a done-and-answered list, since a planner given only the record re-proposed done work for about half its nodes (tag-two); one recovery on record needed held memory (LIN-2078) | Sandbox replay of 20 acted wakes first (`held-or-fresh` v2 §Next), then one role behind the scorecard; pooled | L | M3; the replay's result | One role runs as a relay with the handoff under 40k tokens | Tokens per judgement step above the held cost, or send-backs and escapes rise |
| M15 | **Start fresh instead of resuming cold** once a session holds more than about 100–155k tokens (`held-or-fresh` v2 C; missing from version 1) | SD | About −1.9% alone, −0.8% on top of A, which already sends the 95 cold resumes that changed nothing to code; inside M4 (`held-or-fresh` v2 §Options C; `survey-check-7`) | Medium, as M4: memory that lives only in a run is lost (LIN-2078) | Inside M3's or M4's trial; pooled | S | M1 | Cold resumes above the threshold start fresh, by a rule in code | Tokens per correct change or send-backs rise |
| M5 | **Rule-class calls in code**: escalate at the loop bound, retry once after a harness failure, proceed when a blocker is Done, merge on green where the brief says so (`where-judgement` v2 2) | both | Under 1% of ticket cost (0.6% in these cycles), inside M3; removes the engine's 9 misroutes on 6 tickets | Low, if the rule reads current state: every engine misroute came from a stale hold comment | Inside M3's shadow; session entered | S | Nothing | Each rule has a test and the matching prompt line is removed | Overrides of the engine per ticket rise |
| M6 | **Lighter orchestration of split families**, parents at half their spend (`cost-mix` v2 2) | LV | 1.1× alone, 1.2× with a light lane; parent-only spend is 13% of the budget and a family costs 1.8× its children's standalone equivalent (`cost-mix` v2 §Findings). Its mechanical part is inside M3; what remains is the parent's judgement, which the papers say to keep (`where-judgement` v2 5). Derived: 0–6.5% | Low to moderate: parents hold the cross-child checks | Family spend over children's standalone equivalent, monthly; lineage spread | M | M3 (to see what is left after the bookkeeping goes) | A family costs under 1.4× its children's standalone equivalent | Escapes on children of split families rise |

**Factor F2, legs that need not run.** Savings inside a ticket's own sessions; session entered,
with lineage spread as a check.

| # | Option | Repo | Size | Risk | Trial | Effort | Depends on | Finish line | Retire if |
|---|---|---|---|---|---|---|---|---|---|
| M7 | **A child of an approved plan does not plan again** (map 15; `step-overlap` v2 A) | LV | 1–3%; ceiling 3.9% of tokens, 4.3% weighted. Half the implemented children of a planned parent ran their own plan, a third their own plan review | Medium: plan review's real finds all came in repeat rounds, and none of 24 sampled children carried the inherited "plan-review due: no" line; what a child's own plan changes is unmeasured (Part 5) | Holdout by lineage, 4 weeks; session entered | S | The proposals.md question on what children's plans change | Planned children run a plan only when their slice has drifted, by a rule in code | Escapes on split families rise, or plan-review send-backs on children rise |
| M8 | **Stop review and close-out rounds that change nothing**: close-out finishes wording and test-only items; text-only fixes do not re-trigger review (map 8; `fleet-complexity-read` §5.4) | LV | Derived about 1%, upper end unsized: repeated close-outs changed nothing in 20 of 20 and are 44 of 430 repeat dispatches, repeats hold 10% of tokens, so about 1% (`why-legs-repeat` v2 §Findings); the mutation check led about 36 of 88 extra legs, 97 test-or-wording changes, unsized in tokens (`which-rules-pay` v2 §Findings) | Low: CI still gates, and a repeated code review changed production code in only 5 of 36 | Holdout by lineage; session entered. Rounds per ticket and the correct rate | S | Nothing | A text-only fix merges without a review round; a close-out never repeats on its own hold | Escapes on tickets whose last round was skipped |
| M34 | **Give the periodicals the alarm log** instead of a search for runtime faults (`what-hides` v2 C) | LV | Up to 3.1% of September's tokens per batch spent where no cross-session instance was found first; 0 first finds of the nine patterns | Low: their code-quality findings are untouched | Periodical findings naming a runtime incident, per batch | S | M21 | Each periodical reads the alarm log before any search | Runtime findings per batch fall |

**Factor F3, tokens per session.** Measured per role from transcripts, which see shifts the
scorecard cannot (`starting-context.md` v2 §Findings gives the per-role baseline); session entered.

| # | Option | Repo | Size | Risk | Trial | Effort | Depends on | Finish line | Retire if |
|---|---|---|---|---|---|---|---|---|---|
| M9 | **Stop the bootstrap summary** for the roles that still run it (map 13; `starting-context` v2 A) | SD (`NO_BOOTSTRAP_KINDS`, a partial rollout 46 days old, `how-process-changes-land` v2 §Findings 2) | 3.0% in its own turns plus up to 2.4% carried: up to about 5% (`survey-check-8`) | Low: the task prompt arrives either way | Before and after per role, two weeks each, on tokens to first productive call | S | Nothing | Every kind launches without a bootstrap and the switch is deleted | Orientation per role rises above today's, or the correct rate per role falls |
| M10 | **A short file pointer between sessions on one ticket**: the earlier sessions' read and edited files with the commit they were read at, and the plan's named paths at the top of the implementation prompt; never a maintained map or wiki (map 14; `starting-context` v2 B, C, D; `prototype-concepts` v2 A) | LV | Unsized: the 1.5–2% in the anchor's row 14 and `prototype-concepts` v2 A cite each other, and no paper derives it. Bounded by re-finding at 4.9–12.1% of tokens; C 0.1–2% and D about 1.4% sit inside that bound (`survey-check-8`). One probe cut a task from 51 turns to 18 (LIN-2115) | Low for implementation and close-out; medium for reviews, since a reviewer steered to the implementer's files may not look elsewhere, and that independence is what catches faults (`which-rules-pay` v2) | Ten tickets with a prior session, every second implementation prompt (`prototype-concepts` v2's trial table); tokens and calls to first edit; review findings per round | S–M | Nothing | The pointer is generated by code from the record, not written by a session | Repeat-read share does not fall, or review findings per round fall |
| M11 | **Answer deterministic research questions with a tool**: callers and readers of a symbol at a commit, a path's commits, PRs and dispatches (`starting-context` v2 E) | LV | At most about 1.7%: research legs are 5.3% of tokens, and search and history are 32% of their result tokens (`starting-context` v2 E said perhaps 1–2%; `survey-check-8` calls it a ceiling) | Low: the answers are facts at a commit; a stale index misleads | Research legs' calls and tokens per leg; plan-review send-backs on research-fed plans | M | Nothing | Research prompts name the tool and stop asking for the search | The send-back rate rises |
| M12 | **Lighter legs everywhere**: fewer tracker reads and writes per leg, prompt and brief passed inline, a turn budget per leg kind (map 17; `replay-small-work` v2 2) | both | 14.6% alone: tracker calls are 24.7% of tokens and remote work 4.4%, and halving them saves 14.6% (`survey-check-11`). 58% of the tracker tokens are in supervisor sessions (`survey-check-12`), so after F1 it is 13.9% of what is left with F1 at 10% and 12.3% with F1 at 27%. It also overlaps the bootstrap (M9) by an unmeasured amount (`survey-check-11`) | Low for reads; moderate for writes, since later legs, relays, rescues and the scorecard read what earlier legs wrote (`step-overlap` v2) | Per-leg turns and tokens by kind from transcripts, monthly (`survey-replay-chores.mjs`); correct changes a week unchanged; session entered | M | M3, so that the chores it would cut are not the ones code has already taken | Each leg kind has a turn budget and a named list of the tracker writes it must make | The record a relay or rescue needs is missing on any ticket, or the correct rate falls |
| M13 | **Close-out at a cheaper tier**, with a frontier step for the open questions (`where-judgement` v2 3; `prototype-concepts` v2 F) | LV routing | 2–5% of ticket cost (close-out's 6% × 0.4–0.8); close-out is 5.2% of fleet tokens, so derived 2.1–4.2% of the fleet's, before the frontier step it keeps, which is not costed (`survey-check-7`: leans high). Close-out has run at the cheap tier since 25 September, without the eval (`model-choice` v2), so part of this may already be in October's figures. 17 of close-out's 23 consequential decisions were calls a rule or a cheaper step could make | Medium: a cheaper close-out that misreads a ledger lets an undischarged item through | A frozen fixture eval first, three runs per arm (M33); then close-out holds overturned | S | M33 | The eval agrees on holds and Done decisions; the routing row changed | Any undischarged item passes a cheap close-out |
| M14 | **The plan states what it adds to the research and cites the rest** (`step-overlap` v2 B) | LV | Under 1% of a four-step ticket's tokens: a quarter of a plan's units restate the research, about 440 words at the median plan | Low: a cited finding stays checkable | Plan words per ticket; plan-review rounds | S | Nothing | The plan prompt asks for additions and citations | Plan-review rounds rise |

**Factor F4, which changes get the full process.** Savings inside a ticket's own sessions;
session entered, with lineage spread beside it. The light group must be classified by the paths
actually touched, never by ticket text, which routes large, faulty changes light
(`proportional-process-backtest.md` v2 §Findings).

| # | Option | Repo | Size | Risk | Trial | Effort | Depends on | Finish line | Retire if |
|---|---|---|---|---|---|---|---|---|---|
| M16 | **A light lane for small, non-credential changes**: one implementer, one review, one close-out, chosen by a path check in code (map 7; `cost-mix` v2 1; `replay-small-work` v2 1; the backtest's M3 rule) | both | 8–12% of tokens, 1.08–1.14× (`replay-small-work` v2 §Options 1; `cost-mix` v2 §Options 1); at most 13–18% of hours and 21–30% of dispatches (`proportional-process-backtest` v2). On the work itself the replay cost 4.1% of the originals' session tokens, 5–10% in a lean harness with chores priced, 18–24% with today's per-leg habits | Medium: the light group escapes at 2.0 in 100 (0.9–4.6); review caught a real fault on 8 of the backtest's 328 small low-risk changes, 11 of 15 findings at plan review, which the lane would lose; correctness without hindsight is unmeasured, since 8 of 13 replayed descriptions carried what shipped (`survey-check-11`) | The forward trial in `proposals.md`: new M3-light tickets routed by path to the lane in the fleet's own harness, from the description as filed; escapes and named fixes at 30 days against 2.0 in 100, tokens per correct change in the 1–49 band, which shows first; about 400 lane changes to see a doubling of the escape rate; holdout by lineage, session entered | M | The scorecard's charging rule; M9 and M12 shape what a lean leg costs in production | The lane runs by a path rule in code with no per-ticket choice | Lane escapes exceed 2.0 in 100 by their interval, or review findings per lane change show the lost plan-review catches shipping |
| M17 | **Size the gates to the change**: keep today's process for credentials, auth, migration, security and 300+ line changes; halve the rest. Contains M16 (`cost-mix` v2 4; `fleet-complexity-read` §5.1) | both | 1.23× on the whole budget from halving the 0–299-line changes, an 18.7% cut; 1.5× only if the papers', parents' and unmerged spend halve too (`survey-check-9`) | Moderate: the 50–299 band holds 11 of 43 real catches and escapes at 2.1 in 100 (1.1–3.9) on `reliability-baseline` v2's terms | Catches per 100M review tokens by band (today 0 at 0–49); escapes by band; holdout by lineage | M | M16 running for its first eight weeks | Every ticket's gate set is chosen by a path-and-size rule in code | Catches in the 50–299 band fall while its escapes rise |

**Sized in hours or friction, not tokens.** These do not enter Part 3's multiples. They change
hours per correct change, red-CI rounds and idle time, which the scorecard also tracks.

| # | Option | Repo | Size | Risk | Trial | Effort | Finish line | Retire if |
|---|---|---|---|---|---|---|---|---|
| M18 | **Make the flaky browser specs robust**, never skip (map 5; `browser-flakes` v2) | LV | 38 red PR runs, 54 re-runs, about 3 runner-hours of re-runs; seven specs carry every flake; three causes read from source | None: flakes hide real failures | CI red-E2E attempts per week, and first-attempt pass rate on green runs (80% of sampled greens passed only on retry) | S–M | No spec retries on a green run for four weeks | n/a: a fix |
| M19 | **Retire census pins for an import-graph check** (map 6; `test-estate` v2; `fleet-complexity-read` §5.5) | LV | About 18 tickets since June exist to repair or bump a pin, about five pure bumps; bumps match catches | Low: the import graph still guards drift | Pin-bump tickets per month | S | No census pin remains | A drift the pin would have caught escapes |
| M20 | **Loosen text pins on prompt prose**, keep the branch pins (map 9; `test-estate` v2) | LV | Prose pins caught 3 of 19 deleted lines; branch pins kill mutants | Low, if branch pins stay | Pin edits per prompt change | M | Prose pins removed; branch pins listed | A prompt-branch regression ships |
| M21 | **Run the cross-session detectors live, outside the processes they watch**: shared-error bursts and stopped or circular waits, one alarm to a person or the Flight Companion (`what-hides` v2 A; inside M3's liveness clocks) | both, outside the dispatcher | Hours, not tokens (under 1%): 42 hours of supervisors waiting on lost wakes in September, and the overnight freezes; the 165 hours of stalls are already caught in code after 60 minutes. The two rules caught 7 of 19 incidents on record, 0–9.3 hours sooner, a median of about 5 (`survey-check-10`) | Low, if alarms never act on their own; alarm fatigue (16 of 42 burst alarms were 4xx request mistakes), so a duration or harm threshold | Shadow run for four weeks logging alarms only, read weekly against the tracker (`proposals.md`) | M | Alarms acted on per week; median hours from onset to filing falls from about 16 | Fewer than half of alarms are real after the threshold |
| M22 | **Make the runner's completion post tell the truth**: retry a failed terminal post and write `hook.done_posted` only on success (`what-hides` v2 B) | SD | 23 failed terminal posts logged as posted since July, 8 in September | Positive | Lost terminal posts per month to zero | S | Zero in a month | n/a: a fix |
| M23 | **An alarm for duplicate launches** (`what-hides` v2 E) | SD | 0.15% of tokens, 5 pairs a month | Low | Duplicate pairs per month | S | Zero in a month | n/a |
| M36 | **Retry service faults inside the tools sessions use**, with the duplicate guard in the tool (`where-judgement` v2 4; missing from version 1) | both | Not sized: 47 auth flaps, outages and host faults on 20 of 36 tickets, each costing a step that re-reads its context | Low, if the duplicate guard holds | Proxy error retries per ticket; duplicate writes | S | Retries live in the tool, not in prompts | A duplicate write ships |

**Enablers and landing rules.** No saving of their own; they make the savings measurable or
keep them from un-landing.

| # | Option | Repo | What it does | Source |
|---|---|---|---|---|
| M24 | **Keep the evidence for the project's lifetime**, phase C remaining | LV | Enables every before-and-after read; in progress, LIN-3157 | map 10 |
| M25 | **Freeze prompt sizes; new lessons land as code first** | both | Stops the ratchet: adds outnumber removals about six to one (2:1 to 21:1); rule text is 3–5% of carried context, so the cost is in what the rules make agents do | map 11; `how-process-changes-land` v2 §Findings 3 |
| M26 | **Every process change names its read and its retirement before it lands** | both | 2 of 27 changes were measured before and after by design, 0 named a retirement condition, 5 measured-before changes never got their after-read | `how-process-changes-land` v2 §Options 1 |
| M27 | **One process change at a time, between passages, with nothing else in its four weeks** | both | Makes ×2 visible in four weeks a side; every past change shared its window with 5–16 others | §Options 2 |
| M28 | **Shadow mode for the mechanical supervision rows**, cutover and deletion in the same series | both | Agreement on 1,000 decisions in under a week; the saving is read at cutover | §Options 3 |
| M29 | **Holdout by lineage for ticket-level changes** | both | Sees ×1.8–2.7 in dispatches and ×1.5–1.9 in hours in four weeks, the high ends when whole lineages are assigned together, inside a ticket's own sessions | §Options 4 |
| M30 | **Burn down what is half-finished before a new trial** | both | 47 items in process code (21 switches, 19 dual paths, 7 parked experiments), 100 open follow-ups and 114 review-residue tickets at a median 53 days | §Options 5 |
| M31 | **Report the pooled headline and one per-change rule side by side** | both | Prevents a saving above the ticket reading as zero, or the 13 September log change reading as a step | §Options 6 |
| M32 | **Check a Harbour paper before it merges, not after** | LV | About 20 of the 24 documents checked before the sixth wave had a load-bearing claim corrected after merge; a check is about a third of a checked paper | `prototype-concepts` v2 §Options D |
| M33 | **A per-step fixture eval, three runs per arm, before a step changes tier** | LV | Enables M13 without the scorecard's eight-week wait | §Options F |
| M35 | **Retire vigilance text where a detector takes over** | both | Inside M25; only after M21 has run a month, since a defence's worth is invisible until removed | `what-hides` v2 §Options D |

**Already done**, as ordinary tickets on 30 September: the four idling test files (map 4,
LIN-3158: serial unit suite 266 s to 175 s), simple-dispatcher's hygiene (map 12, LIN-3160) and
the unit flakes (part of map 5, LIN-3159).

**Not recommended, on the papers' own evidence:** the relay as proposed with today's orientation
(`held-or-fresh` v2 D: 0%, −17% to +9%); plan review re-deriving less (`step-overlap` v2 C: at most
2%, and its finds are new); writing less for tokens' sake (`step-overlap` v2 E); a graph-structured
research leg (`prototype-concepts` v2 G: a median 1.44× the tokens); switching model tiers as the
cost lever (`model-choice` v2), although close-out already moved to the cheap tier on 25 September
(M13); and any lighter plan review or review on the strength of the judgement paper
(`where-judgement` v2 5: gates and makers make 158 of 260 consequential decisions). A
reader-and-inference pass on every check (`prototype-concepts` v2 E) is not a saving, but the
source does not advise against it: it is a correctness option at a cost, for John to weigh beside
M32.

**One lever measured twice.** `held-or-fresh` v2's option A and `where-judgement` v2's option 1
are the same change, over the fleet and per ticket, and both sit inside map rows 1–3
(`survey-check-7`). The prototype papers' options A, B and C are map rows 14, 3 and 16, and `step-overlap` v2's option D
is M10 again. `held-or-fresh` v2's option C (M15) sits inside B and D, so inside M4. The
detectors (M21) overlap row 3 in mechanism, not in tokens (`survey-check-10`). The lean lane (M16)
is lighter legs (M12) taken to its limit on a fifth of the work (`replay-small-work` v2 §Options).
`cost-mix` v2's option 3, cutting the fixed part by half everywhere, is not a separate option: it is
what F1 and F3 together would do.

### 3. How the options combine

Within a factor, options draw on one pool, so their savings overlap and count once: M1 and M2 are
inside M3, M4 and M15 overlap M1–M3, M17 contains M16, and M10's three forms share the re-finding
bound. Across factors the multiples multiply, because each later factor's share is spread over what
the earlier factor leaves: removing a supervisor's mechanical steps also removes the bootstrap and
the tracker reads those steps carried, so adding the shares would count them twice. Multiplying
assumes the later factor's share is the same in what the earlier one removes as in what it leaves.
For lighter legs that is not so: 58% of the tracker tokens sit in supervisor sessions, which are 37%
of the budget (`survey-check-12`), so M12 enters each stack at its share of what F1 leaves, 13.9%
with F1 at 10% and 12.3% with F1 at 27%. Each factor's multiple is 1 ÷ (1 − its saved share),
assuming the same correct output, as `cost-mix.md` v2's bound does. The arithmetic is in
`scripts/survey-menu-analyse.mjs`.

| Stack | Members | F1 | F2 | F3 | F4 | Multiple (multiplied) | If added | Credential work held |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| S0 Quick and reliability-neutral | M9, M10, M14, and the hours items | – | – | 4.5–8% | – | ×1.05–1.09 | ×1.05–1.09 | ×1.04–1.08 |
| S1 The plumbing code can see | S0 + M1, M2, M5, M7, M8 | 10% | 2–4% | 4.5–8% | – | ×1.19–1.26 | ×1.20–1.28 | ×1.17–1.23 |
| S1+ with proportionality | S1 + M16, M17 | 10% | 2–4% | 4.5–8% | 8–18.7% | ×1.29–1.55 | ×1.32–1.69 | ×1.26–1.47 |
| S2 The conductor | S0 + M3 (with M21), M7, M8 | 10–27% | 2–4% | 4.5–8% | – | ×1.19–1.55 | ×1.20–1.64 | ×1.17–1.47 |
| S3 The conductor with proportionality | S2 + M16, M17 | 10–27% | 2–4% | 4.5–8% | 8–18.7% | ×1.29–1.91 | ×1.32–2.36 | ×1.26–1.75 |
| S4 The whole menu | S3 + M12, M13, M11, M4 | 10–27% | 2–4% | 21.5–26.2% | 8–18.7% | ×1.57–2.38 | ×1.71–4.15 | ×1.49–2.10 |

![How the options combine: each stack's multiple against 2× and the bound](figures/steady-base-menu/stacks-vs-bound.svg)

**Which stacks reach 2×.** Only S4, and only in the upper part of its range. Its low end, ×1.57,
is what the menu gives if code routes only the wakes it can tell apart by class (10%), small work
goes light at the replay's lower estimate, and lighter legs save their share of what is left. Its
top, ×2.38, needs the conductor to take every one of the 27% of tokens that supervision spends on
mechanical steps, the gates sized to the change at survey-check-9's 1.23×, and every per-session
option at the top of its range. On the blind recode's 86% mechanical share the conductor's ceiling
is about 30% and S4's top ×2.47. The square root of S4's two ends is about ×1.9, and putting every
member at the middle of its range gives the same. That is a midpoint of assumed ranges, not an
estimate: no paper weighs how likely each end is, and the ends that matter most, F1 above 10% and
F4's lane, are the two the evidence has not measured. S3, the conductor with proportionality but
without lighter legs, tops out at ×1.91; S1+, the plumbing code can see today plus proportionality,
at ×1.55. So the gap between "reachable on today's class-visible evidence" and 2× is the
conductor's unmeasured ceiling (Part 5, question 2).

**Against the bound.** `cost-mix.md` v2 holds credential work at today's cost and cuts everything
else; three times cheaper gives 2.5×. The stacks above cut mechanical overhead on credential
tickets too, which keeps their gates but not their bookkeeping, so they are not strictly below the
bound. On the bound's footing, with the 9.7% of credential spend held entire, the whole menu's top
is ×2.10 and its low end ×1.49. Three times cheaper everywhere else is a 67% cut of the other 90.3%;
the whole menu's top is a 58% cut. The plausible top is therefore a little under the bound, and it
clears 2× only if every structural row delivers near its high end. The bound's ceiling with nothing
but credential work held is 10.3, or 9.9 at the list-price tier ratio (`survey-check-9`). Cost-mix's
own options 1–4 at 1.7–1.8× already include the structural rows, as its option 3 (half the fixed
part, 1.3×); the menu's larger figure comes from sizing those rows above half, at F1 and F3
together cutting 29–46% of the budget.

**What adding would have said.** Added as if nothing overlapped, the whole menu's shares come to
76% at the top and the multiple to ×4.15, and the token options' individual high ends sum to 132%
of the budget. That is the arithmetic behind the fifth wave's warning that its options do not add.

### 4. A landing order

Principles from `how-process-changes-land.md` v2 §Findings 4 and §Options: each change gets a
number before, a read date after and a retirement condition (M26); one change at a time, with
nothing else in its four weeks (M27); the losing arm deleted on a date (M29); the shadow's cutover
and the old path's deletion in one series (M28). The source does not discuss running independent
groups side by side; the order below does, and says where that departs from M27. What the
scorecard can see, all in dispatches or hours per correct change: a before-and-after sees ×2.1 on
the weekly ratio at four weeks a side (×2.8 dispatches, ×2.0 hours per change) and about ×1.6–1.7 at
eight; a holdout sees ×1.8–2.7 in dispatches and ×1.5–1.9 in hours at four weeks, the high ends when
changes under one supervisor move together, as they do when whole lineages are assigned; the
smallest any design sees within eight weeks is about ×1.33, in hours, by holdout, and only if
changes are independent (`measuring-throughput.md` v2 §Findings; `how-process-changes-land.md` v2
§Findings 4; `survey-check-9`). So no option under about a 23% cut in hours or dispatches per correct
change is visible to the scorecard by any design, and under about 40% by a before-and-after. The
menu's sizes are shares of weighted tokens, and no paper has given the scorecard a detection floor in
weighted tokens; a token saving can be a larger or smaller share of dispatches or hours (the lane's
8–12% of tokens is 21–30% of dispatches). The order below pairs each group with the instrument that
can see it. This is a recommendation; John decides.

**Step 0, before any change is measured: one charging rule and one census.** Reconcile the two
censuses of the same runner logs (47.1 against 33.6 dispatches per correct change for code changes
merged 14–28 September, by the child named), then adopt a rule per candidate kind as in
`how-process-changes-land.md` v2 §Findings 5, and report pooled beside it (M31). Finish M24's phase
C. Burn down the half-finished items (M30): each removal is its own change, and there are 47 in
process code plus 100 follow-ups and 114 review-residue tickets, so this takes weeks, not days.
Land Group A. Then freeze the baseline: four weeks of the scorecard with nothing landing, in the
same passage state as the after-windows will be. The census and the rule are measurement and can
be settled during V1; the frozen baseline cannot, since the passage era costs more (pooled, 48.4 dispatches per correct
change from 13 September, when the passage layer went live, against 25.8 in the month before,
`how-process-changes-land.md` v2; M2's 5–15% during passages) and Group B's
after-windows fall between passages. Step 0 is achievable, but as a sequence of some weeks, not one
freeze run alongside V1.

**Group A, now, as ordinary tickets, read by their own instruments.** M22 (truthful completion
post), M18 (browser flakes), M19 and M20 (pins), M9 (stop the bootstrap and delete the switch), M10
(the pointer, on ten tickets), M14, M23, M25 (the freeze), M36. They land before the baseline freezes. None changes how the fleet works, each
is reliability-neutral or positive, and each has a finish line that is a count reaching zero or a
per-role token read from transcripts. Expect ×1.05–1.09 in tokens and a visible fall in red-CI
rounds and idle hours; the scorecard will not see the tokens, and should not be asked to.

**Group B, the structural series, between passages.** M1 in shadow, then M2, then M3 in slices,
with M21's detectors as the liveness half of M3 and M5 inside it. Each slice: shadow for a week
on about 1,450 follow-ups until agreement is bounded, cut over as a before-and-after between
passages, delete the prose path in the same PR series, read pooled and lineage-spread at four
weeks. F1 alone is ×1.11 from the class-visible slices and up to ×1.37 if the conductor reaches
its ceiling (S1 and S2 also hold Groups A and C). Both are below a before-and-after's ×1.6–1.7 at
eight weeks, so Group B is read on per-role tokens, wakes per correct change and the shadow's
agreement, with the scorecard as a guard on correctness rather than as the measure of the saving.
M4 (the relay) and M15 wait for M3 and for the sandbox replay in Part 5. M5's rules are in M3's
shadow, read with the series.

**Group C, ticket-level, in parallel with Group B, on a different rule.** M16's forward trial as
a holdout by lineage, session entered. Session entered is largely blind to Group B's savings
(`how-process-changes-land.md` v2 §Findings 5's table), so C's read is mostly clean of B. The
reverse is not: Group B's pooled read includes C's treated arm. So start C, and each addition to it,
outside every Group B before or after window, and expect each B cutover to shrink C's measured
effect, because the lane also drops supervision legs that B makes cheaper. Running them side by
side departs from M27; the alternative is to run them in turn, which roughly doubles the calendar. M8 and M7 in the same holdout, M7 after
the proposals question on children's plans is answered. M17 after M16's first eight weeks. Expect
×1.08–1.14 in tokens from the lane, which is below any design's detection floor fleet-wide; the
lane's own measure is tokens per correct change in the 1–49 band and its escape rate against 2.0 in
100, which needs about 400 lane changes to see a doubling. The backtest's light group was about 19
changes a week from June to September, so with half routed to the lane that is about 40 weeks, plus
the 30-day escape lag.

**Group D, after Group B lands.** M12 (lighter legs), because what a leg must still write depends
on what the conductor reads; M13 after M33's fixture eval; M6 once the parent's bookkeeping has
gone and what is left can be seen; M11 and M34 whenever convenient. M35 a month after M21.

**What this order buys.** A, B and C together are S3 at ×1.29–1.91 in tokens, landed within about
three months if each lands whole; the lane's correctness read takes most of a year. D takes the stack to S4. The order puts the reliability-neutral and the
largest changes first, keeps every altitude (the decision of 30 September), and leaves the
correctness question of the light lane to a trial with a written finish line rather than to a
backtest.

### 5. What we still don't know

Ranked by how much the answer moves the menu. The first is the prerequisite for measuring any of
the rest; all are in `proposals.md`, where the detail of each sits.

1. **Which charging rule, and which census.** Two censuses of the same runner logs give 47.1 and
   33.6 dispatches per correct change by the child named for the same fortnight
   (`survey-check-9`), and the census moves September's wakes per correct change by about a third in
   one count (29 against 18) and about a fifth in another (18.9 against 14.9). Until one
   census and a rule per candidate kind exist, no per-change saving can be read fairly.
2. **How much of the supervision cycle code can decide.** The conductor's size runs from 10% by
   class to 27% if every mechanical token moves; "much of the answering is already in code, how
   much unmeasured" (anchor point 3). The replay of September's gate replies and quiet-wake cycles
   against the runner's own state, counting how many a reader of that state would have written
   identically, is the single measurement that decides whether 2× is in reach.
3. **Which deliveries into a held supervisor code can tell are quiet in advance.** 938 quiet
   wakes, 4.5% of fleet tokens, are indistinguishable by class from the ones that act
   (`survey-check-7`). This is the gap between 10% and 14% in F1, and every stack's low end now
   assumes it stays shut.
4. **Is a lean lane as correct without hindsight.** The replay cannot say; the forward trial can
   (`survey-check-11`). This gates M16 and M17, the whole of F4.
5. **How many steps a fresh session takes to reach a held supervisor's decision**, from the
   record and a short handoff, in a sandbox. This decides whether M4 adds anything to M3.
6. **What a child's own plan changes against the parent's slice**, and whether its plan review
   finds something real. This decides M7's risk.
7. **Does a session handed the plan's named paths reach its first edit cheaper, at the same
   correctness**, and is a reviewer re-reading the implementer's files checking independently or
   re-finding. Together these set M10's size and its risk to review independence.
8. **Can a signal visible before review tell the fleet-machinery changes whose review catches a
   real fault from those whose review catches nothing.** This decides whether the ceiling is 2.7×,
   3.7× or 10×.
9. **Does the scorecard's weighted unit hide September's change of frontier price row**, and how
   many weighted tokens is one point of the weekly meter. Both bear on the instrument every
   option is read by.
10. **Would a mid- or cheap-tier close-out make the same holds and filings as a frontier one.**
    M13's fixture eval.
11. **What the added supervision buys**, tickets flown under a Runner against a lone autopilot at
    fixed size and risk; and **how many of the wakes a worker event sends up the stack change what
    any supervisor does**. These would turn M2's "5–15% during passages" into one number.
12. **Did LIN-2323's second read ever disagree, and should its sunset have retired it.** Small, but
    the first test of M26's retirement rule on a real case.

### 6. A note on method

**How the research ran.** Thirty-nine documents in three days, 29 September to 1 October: 26
papers and 13 checks, 187,711 words, with 164 scripts added under `scripts/survey-*` and
`scripts/steady-base-*` before this paper (19,347 lines; the script's count of 19,511 adds one per
file) and the anchor rewritten through 13 commits, 10 of them the research's own, to 9,479 words
(`scripts/survey-menu-analyse.mjs`, from git). Each paper was one bounded session with no research,
plan, review or close-out legs, with in-session subagents for parallel reading and blind coding,
followed by one independent check in the same form; 25 of the 26 papers are at version 2 or later.
A one-session paper cost a median 4.5M weighted tokens and a check 6.2M; a check's share per
checked paper is about 2.95M, a third of a checked paper's 8.1M. The papers were 10.0% of
September's weighted tokens (`prototype-concepts.md` v2 §Findings;
`cost-mix.md` v2 §Findings). A Lighthouse study costs about the same per piece in weighted tokens
(`survey-check-10`). Version 1 ran the same way: one session, no subagents, two scripts, and no
new measurement beyond arithmetic over checked figures and a count of the archive from git.
Version 2 adds one measurement from its check, where the tracker chores sit.

**What the checks changed.** Every committed script re-ran and nearly every printed number
reproduced; the corrections were in what the numbers were taken to mean. About 20 of the 24
documents checked before the sixth wave had a load-bearing claim corrected (`survey-check-10`), and
the sixth wave's three papers and this one were corrected too. The corrections fall into six
kinds, each more than once:

- **Attribution.** Finder rows and review residue counted as escapes (`survey-check`,
  `survey-check-3`); commit trailers naming the finisher as the implementer; wakes charged to the
  child from 13 September reading as a doubling (`survey-check-4`); a July undercount read as a
  doubling at every size.
- **Sizing by what code cannot see.** Quiet wakes to code sized by outcome at −14%, routed by
  class −10% (`survey-check-7`); the rule class at 12% by the first reader, 2–4% by two fresh
  readers on the same nine tickets.
- **Double counting.** A fresh step's first decision charged twice in the relay model, turning
  +2% into 0% (`survey-check-7`); 0.9 points of re-fire tokens inside map row 1 (`survey-check-10`).
- **Hindsight.** Two of the three faults the lean replay "shared" with the full process were
  written into the descriptions it read; replayed from the pre-implementation text, two of four
  verdicts moved from better to worse (`survey-check-11`).
- **Comparisons not like for like.** A price-row change read as multi-session work costing 1.7×
  per weighted token (`survey-check-10`); two censuses of the same logs compared as if they were
  one (`survey-check-9`); a per-ticket ratio (77%) read as a saving (`survey-check-4`).
- **Figures stated high.** Of the fifth and sixth waves' option sizes the checks moved, most moved
  down (−14% to −10%; 4–5% to 1.4%; 1.5× to 1.2×; 9 of 19 to 7 of 19) and one up (the bootstrap 3%
  to 5%). Counts of findings moved down as well (about 90 real alarms to about 40; 23 of 24 to 20
  of 24). Earlier checks moved two findings up (the mechanical share 77% to 86%, `survey-check-2`;
  the dispatch step 2× to 2.5×, `survey-check-4`). This paper's own check moved its stacks down at
  the top and its M13 up (`survey-check-12`).

**Where the process drifted.** Towards complication: four charging rules where the brief asked
which of two to adopt, and two unreconciled censuses of one log; 164 scripts for 39 documents, so
that "every script re-runs" is a sentence in every check; a map that grew from 12 rows to 17 and
papers whose Options sections re-measure one lever under new names, which this paper has had to
merge. Towards overconfidence: option sizes printed to the point and corrected downward more often
than up; findings quoted into the anchor at version 1 while their checks were still running
(`survey-check-3`), so that the anchor carried wrong figures for about an hour, twice; a replay whose headline
rested on hindsight until a check re-ran it from the earlier text. The checks caught these because
they were independent of the authors and read the sources rather than the papers. The lesson the
papers themselves draw, in `prototype-concepts.md` v2 §Options D and `how-process-changes-land.md`
v2 §Options 1, is to check before merge and to write the read and the retirement condition before
a change lands. This paper was checked after it merged, as the others were, which is the
ordering it says is wrong; its check moved the whole menu's top from ×2.44 to ×2.38 and its
class-visible stack from ×1.34 to ×1.26.

## Method

**Sources.** `docs/steady-base.md` at 01277614 and every document in its evidence table except
the "Earlier" row: 39 documents, listed with word counts in `data/survey-menu/menu.json`. Every
figure is read from a paper at version 2 or later (version 3 for `why-throughput-halved.md`),
or from a check, and cites paper and section. Only `fleet-complexity-read.md` is at version 1, with
no header; it is cited beside a version 2 source for M8, M17 and M19, which map rows 8, 7 and 6
already carry.

**The menu.** Each option is a row in `scripts/survey-menu-analyse.mjs` with its size as the cited
paper's range, its risk in the paper's own words on a five-step scale (none or positive, low,
low–medium, medium, high), its factor, and its source. Four ranges are derived from checked figures
and are marked so: M6 (0–6.5%, overlap with M3 unknown), M8 (44 of 430 × 10% ≈ 1%, plus the
unsized mutation rounds), M12 (14.6% alone, entered at its share of what F1 leaves, from
`survey-check-12`'s split of the tracker chores), M13 (close-out's 5.2% of fleet tokens × the
0.4–0.8 a cheaper tier saves). M10's 1.5–2% is carried as the anchor states it and is unsized.

**The stacks.** Within a factor, the union is the largest option that contains the others (F1:
M3 at 10–27%, with M1 and M2 as its class-visible 10%; the 14% if code could tell quiet wakes in
advance enters no stack; F4: M17 at 8–18.7% containing M16) or the sum of the pools (F2: M7 and M8;
F3: M9, M10, M11, M12, M13, M14, of which M12 and M9 overlap by an unmeasured amount, so F3's sum is
an upper end). A stack's multiple is the product over its factors of
1 ÷ (1 − share), at the low and high end of every member's range. "If added" is 1 ÷ (1 − the sum
of shares). "Credential work held" applies the stack to the 90.3% of the budget outside the
credential class, with that 9.7% held at today's cost, the footing of `cost-mix.md` v2's bound.

**The archive count.** From git at 01277614 (re-run at 264d13f8, the count includes this paper's
own two scripts, 166): the documents named in the anchor's evidence table,
their frontmatter versions and dates, word counts from the files, scripts matching
`scripts/survey-*.mjs` and `scripts/steady-base-*.mjs` with the date of the commit that added
each, and the commit count on `docs/steady-base.md`.

```sh
node scripts/survey-menu-analyse.mjs          # data/survey-menu/menu.json: the menu, the stacks, the archive count
node scripts/survey-menu-figures.mjs          # docs/papers/harbour/figures/steady-base-menu/
```

No proxy call was made for this paper beyond reading its own ticket and brief. Version 2's
tracker split is `survey-check-12.md`'s, from `survey-replay-chores.mjs` run over every ticket in
LIN-3189's token snapshot (`scripts/survey-check-12.mjs` gives the steps).

## Limits

- **The sizes are the papers', with their limits.** Every range here inherits the limits of the
  paper it cites: one month of tokens (transcripts begin 31 August), a survey wave and a passage
  both running in September, and escapes that are floors. *Bias:* the September budget is heavier
  in papers and parents than a quiet month, so the shares F1 and F4 draw on are, if anything, high
  for a month with no passage and no survey; the multiples run high with them.
- **The factors are a reading, measured only in part.** `survey-check-12` measured where the
  tracker chores sit by session kind, not by step: it assumes the conductor removes them in
  proportion to the supervisor tokens it removes. The overlap of mechanical supervision with
  orientation and the bootstrap, and of lighter legs with the bootstrap, is unmeasured.
  *Bias:* if the conductor's steps carry more than their share of the chores, M12's top is lower
  still; the "if added" column is the no-overlap bound.
- **Four ranges are derived here** (M6, M8, M12, M13), and checked in `survey-check-12`. *Bias:* M8's
  1% is a lower end because the mutation rounds are unsized; M13's 2.1–4.2% is high because the
  frontier step it keeps is not costed, and part of it may already have landed on 25 September.
- **The multiples assume the same correct output.** As in `cost-mix.md` v2, a cut that moves
  catches into escapes is invisible to the arithmetic. *Bias:* every multiple is a best case; the
  risk column is the only place that cost appears.
- **"Risk to correctness" is the paper's wording mapped to five steps by one reader.** *Bias:*
  options whose papers wrote "low to medium" or "moderate" are placed by judgement; a different
  reader would move a few by one step, not more.
- **Hours-sized options do not enter the multiples.** M18–M23 and M36 change hours per correct change
  and idle time, which the scorecard counts separately. *Bias:* the stacks understate what the
  menu does to hours.
- **Both repos are pooled.** Every fleet-wide share covers both repos' workspaces; only the
  credential, simple-dispatcher and escape figures are per repo. *Bias:* none in direction; a
  per-repo menu would need per-repo token shares, which `cost-mix.md` v2 gives only for
  simple-dispatcher's own class (8.2%).
- **The ranking in Part 5 is one reader's.** It orders proposals by how far the answer moves the
  stacks, which rewards questions about F1. *Bias:* questions about correctness (4, 8) may deserve
  the top place on John's measure rather than on this paper's.
- **The archive count is a census of the anchor's table, not of everything written.** Scripts are
  counted by name pattern and may include a few written for earlier papers under the same prefix;
  164 is all that match before this paper, every one added on or after 29 September; the pattern
  misses one `.cjs` helper. *Bias:* the script count is exact for the pattern and may be high for
  the expedition by a handful.
- **The scorecard's detection floors are in dispatches and hours, the sizes in weighted tokens.**
  No paper converts one to the other. *Bias:* unknown in direction; Part 4 reads each group on its
  own instrument for that reason.

## Next

The research stage closes with this paper and its check. New questions go to `proposals.md`.
Version 1 put one line there: whether the menu's cost factors overlap as assumed. `survey-check-12`
answered its tracker part by session kind; the line now asks for the rest, by step, so that the
stack arithmetic can be checked rather than reasoned. The check re-ran both scripts, re-read every
cited range against its source and moved no option's risk step.
