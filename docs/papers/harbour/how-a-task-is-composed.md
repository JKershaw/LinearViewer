---
title: How is a task composed, and does that shape the way it runs?
kind: paper
version: 1
date: 2026-10-11
authors: [Claude (LIN-3463)]
model: claude-sonnet-5-5, Claude Code CLI; effort not recorded in the dispatch item. This is the writing session (LIN-3463, kind implementation). The study it reports was done in an earlier research session on the same ticket.
grounded_at: 15990905
cites: [research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/README.md, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/size-bands.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/composition-stratified.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/composition-by-code.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/composition-agreement.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/model.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/auto-features.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/read-order.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/results/fidelity-summary.txt, research/lin-3463-composition@b2ed3a35:scripts/eval/lin-3463-composition/fidelity/propagation.json, lib/brief.js@15990905:21, lib/brief.js@15990905:32, lib/brief.js@15990905:38, lib/recap-cache.js@15990905:44-86, docs/papers/harbour/ticket-record-and-quality.md@15990905:35, docs/papers/harbour/replay-small-work.md@15990905:50-59, docs/papers/harbour/survey-check-11.md@15990905:52-54, docs/archive/9.html@15990905:235-238, docs/archive/8.html@15990905:201, LIN-3463 (research comment, 2026-10-11), LIN-3449, LIN-3453]
---

# How is a task composed, and does that shape the way it runs?

*Prepared for John Kershaw | October 2026*

**Partly, and the record cannot say how much.** In every band of change size, tickets whose
behaviour was left open ran longer, split more often and went round plan-review more than
tickets whose behaviour was settled. That agrees with your observation. But how much a
ticket decides and how big the change is cannot be pulled apart in this sample, and once PR
size is in the model only size clears zero. So the record is *consistent with* "a settled
task runs better"; it does not show that settling it is what made it run better. Two
sharper results are firmer. What looks like "over-specific" is not too much *how*: it is a
ticket that decides a change without settling what the change does to existing behaviour.
And almost every ticket is written by an agent, not by a person, in places that carry no
guidance on composition.

Of the three directions you named, the record supports the first most (fix the ticket where
it is written), the second a little (the brief loses intent, but the ticket usually wins),
and the third only as a question put to the author, because a bar that reads the text alone
would have passed LIN-3453.

## Findings

**Agents write nearly all task words.** Of 376 tickets first dispatched between 11 September
and 11 October, the coder marked 6 as John's own voice. The rest: 168 written by the Flight
Companion, 141 plan breakdown children, 39 follow-ups, 11 periodical findings, 9 by other
agents and 2 unclear (`results/composition-by-code.txt`). The two big sources have opposite
habits: the companion's prompt carries no guidance on composing a ticket, and the plan
stage and breakdown children deliberately carry the how. The style that worked in LIN-3449's
second batch lives in that one ticket's description, not where tickets are written.

**The surface of the text predicts nothing.** Over 335 Done tickets, split into thirds by
first-dispatch word count, median sessions are 7, 6 and 7. File anchors, line anchors,
question marks, a Done-when, a "Fix:" line and an embedded plan show no gradient either
(`results/auto-features.txt`). This repeats, for runs, what `ticket-record-and-quality.md`
found for reviews: what is written before the review does not predict the review
(`docs/papers/harbour/ticket-record-and-quality.md@15990905:35`).

**A behaviour left open goes with longer runs in every band of change size.** Table 1 takes
the 184 Done work tickets with a joined PR and splits them in thirds by production lines
changed.

| Change size (PR lines) | Behaviour open: n, median sessions, split, plan-review ≥ 2 | Behaviour settled: n, median sessions, split, plan-review ≥ 2 |
|---|---|---|
| 2–197 | 8, 9, 12%, 38% | 53, 6, 2%, 8% |
| 201–602 | 9, 11, 33%, 33% | 52, 7, 8%, 27% |
| 613–30,891 | 15, 30, 40%, 73% | 47, 11, 26%, 47% |

*Table 1. "Settled" is every ticket in the band not coded open. The branch's
`results/size-bands.txt` prints the open rows; the settled rows are the same join with
`open_behaviour == 'no'`, recomputed from the committed `outcomes.json`, `composition/map.json`
and `composition/codes-A-*.json`.*

Among the 119 terminal tickets that John or a companion wrote (breakdown children left out),
behaviour left open gives a median of 11 sessions against 7, a split in 27% against 16%, and
plan-review of two or more in 48% against 28% (`results/composition-stratified.txt`).
Tickets coded as carrying one decision run a median of 7 sessions, split 8% of the time and
need plan-review twice or more in 10%; with three or more decisions the median is 10 to 13.5
and plan-review twice or more is 50–67%.

**But size and composition cannot be separated here.** The number of decisions tracks size:
the median PR is 108 lines for one decision and 654 for five or more, and open-behaviour
tickets are bigger (535 lines against 350; `results/size-bands.txt`). In a regression of log
sessions on the codes plus log PR lines and origin (n = 184, 2,000 bootstraps, R² 0.32),
change size is the only term whose interval excludes zero: ×1.31 sessions per e-fold of lines.
Behaviour open is ×1.20 with a 95% interval of −0.78 to +1.50 in log terms, and how-prescribed
is ×0.91 per level with an interval spanning zero (`results/model.txt`). A behaviour left open
may make the change bigger as well as the run longer, and controlling for size may absorb part
of a real effect. The data agree with your observation in each band; they cannot settle it.

**Prescribing the how does not lengthen runs. It moves the cost.** Fully prescribed tickets
(how = 3) are the cheapest runs in every band: median sessions 5.5, 6 and 9, against 9, 11 and
23 for pointer-only tickets (how ≤ 1; `results/size-bands.txt`). But 100 of the 129 breakdown
children are how = 3, and their planning was paid on the parent, which these counts leave out.
They also go back through code review more often: two or more reviews in 47% (mid) and 71%
(large) of breakdown children against 29% and 38% of authored tickets (same recomputed join
as Table 1). That fits earlier replays, in which a fault written into a description shipped as
directed (`docs/papers/harbour/replay-small-work.md@15990905:50-59`;
`docs/papers/harbour/survey-check-11.md@15990905:52-54`), and the two older cases you named:
the share page built faithfully from prose (`docs/archive/9.html@15990905:235-238`) and
briefs so detailed that two stalled in plan review (`docs/archive/8.html@15990905:201`).

**"Over-specific" means deciding a change without settling its behaviour.** LIN-3453, the
sprawler (29 sessions: 11 of its own and 18 in children, four child tickets), read as settled
to a blind coder. The coded record has it as one decision, behaviour not open, how-prescribed 1
(`composition/codes-A-*.json`). Its text said that the function "returns `null` on junk;
callers that relied on `0` or `NaN` convert at the call site". What it did not settle was what
each kind of caller should then do. The grep it prescribed to bound the work listed 18 sites;
the plan found 28; four plan-review rounds then argued per-site behaviour (LIN-3463 research
comment, 11 October; LIN-3453). The three batch-2 tickets each carried a behaviour line:
LIN-3459 "unchanged", LIN-3460 byte-identical replies, LIN-3461 an enumerated list. They took
4, 8 and 13 sessions (`outcomes.json`). LIN-3461's 13 came from a rescope after your own
decision changed (its title and body disagree), not from how it was composed. So I do not
credit the batch-2 improvement to anything beyond the behaviour line, and one batch is not a
test of it.

**The brief loses intent, mostly toward reopening settled decisions, but the ticket usually
wins.** Agents read both: of 2,843 dispatched sessions, 59% read the brief and then the issue,
35% the issue and then the brief, 4% the issue only (`results/read-order.txt`). Plan,
implementation and research sessions read the brief first in 93–96%, and since the week of
5 October 97% of all sessions do, against 40–50% before. In 60 brief-and-ticket pairs
(132 of the 136 sampled tickets were from September), the primary coder found 27 material, 29
minor and 4 faithful. A second coder, on 15 of the pairs, found 3 material where the first
found 5, agreeing on material-or-not for 13 of 15, so the true rate of material briefs is
uncertain; 27 of 60 is the primary reading, and the second suggests it is high. The loss is
uneven: acceptance is dropped or altered in 25 of 60 briefs (21% of acceptance units dropped,
another 13% altered), and the why is dropped most (32%), while open items are never dropped.
The additions go one way: 35 additions in 23 pairs turn something the ticket settled into an
open question, against 13 added rules, 10 added facts and 5 invented done-conditions
(`results/fidelity-summary.txt`). The brief's own instructions invite it: "surface
contradictions … do not smooth them into false tidiness" and "the most recent and specific
signal wins" (`lib/brief.js@15990905:32`, `:38`), run by a small model, against "include
something only if leaving it out would make a competent agent err" (`:21`). Its cache key
leaves out the project, siblings, blockers and attachments it renders
(`lib/recap-cache.js@15990905:44-86`). In the 27 material pairs traced through their
transcripts, 25 acted on the ticket's version, 1 followed the brief and 1 never reached the
point; the one that followed it deferred work the ticket's own text recommended, because "the
brief itself lists [it] as an open, unresolved question" (LIN-2543, `fidelity/propagation.json`).
About 11 of the 25 were stepper beats whose coordinator prompt put the dropped content back,
so the 1-in-27 may flatter the brief.

## Which direction the record supports

- **(a) Fix the ticket where it is written: the strongest support.** What predicts the run,
  whether behaviour is settled and how many decisions the ticket carries, only the author
  can supply, and agents author 98% of tickets.
- **(b) Change what the agent reads: real, secondary.** Stop the brief opening decided items,
  and resolve the three competing "read first" instructions. Both are cheap. They are unlikely to
  change how tasks run much, because the difference reached the work once in 27 traced cases.
- **(c) Assess before the run: only as a question put to the author.** A bar that reads the
  text alone would have passed LIN-3453, as the blind coder did. The useful question is "what
  existing behaviour changes, and what does each kind of caller then do?".

A bar, **as a sketch and not validated policy**, would ask four things of a ticket: one
decision; behaviour settled in one line (either "unchanged", or each change and what callers
then do); a done-when stated as a property, not as a prescribed measure; the how left open
unless it is known to be right. No part of this has been tried, and it should not be
enforced until a forward trial says whether it helps.

## Method

The population is the 376 tickets (LIN-2800 to LIN-3462) first dispatched between 11 September
and 11 October. Each was read as it stood at its first dispatch, which is the earliest task-history
snapshot, then coded blind to outcome against a rubric written before any join (origin, what
is decided, whether behaviour is open, how much of the how is prescribed, decision count,
asserted facts, acceptance, work type, size guess). Codes were joined to dispatch lineages
(sessions including those of children created after the first dispatch, splits, plan-review and
review counts) and to PR size, recorded as production lines changed. A second coder re-coded 28
tickets. The reading path comes from the 2,843 session transcripts (29 August to 11 October)
headed "LIN-n · kind", recording the order in which each read `/brief` and its ticket. The
brief-fidelity study took 60 pairs of a brief and the ticket source the session fetched, coded
unit by unit, and traced 27 material pairs through their transcripts. The classes the study
bounded are the 17 agent-writing members of the ticket-authoring surfaces (creators: breakdown,
close-out triage, retrospective audit, the periodical run task and findings, the passage
planner, the autopilot's blocking bug, the worker lane, Collective and the generic proxy
catalog; rewriters: plan, research, design, scoping, the close-out prune and the splice/PATCH
mechanics; and review's ledger text, filed at close-out), all entering through
`routes/proxy-writes.js`, and the 12 surfaces that hand an agent an interpretation of the
ticket (listed in the research comment). Scripts, coding rubrics, codes and result files are
on `research/lin-3463-composition` @ `b2ed3a35` under `scripts/eval/lin-3463-composition/`;
the branch's README has the re-run block, which this paper does not copy. Raw ticket text,
briefs and transcripts are not committed and come back from the proxy and the runner machine.
The outcome population is production data, so no source sweep was run.

## Limits

- **Coder agreement is moderate on the codes that matter.** On 28 tickets the second coder
  agreed with the first at κ 0.46 on what was decided and 0.52 on behaviour open (decisions
  0.50, how-prescribed 0.69, origin 0.95; `results/composition-agreement.txt`). The second was
  stricter on "decided". Misses are not random, so the open-versus-settled gap may be larger or
  smaller than shown.
- **Size confounds composition**, as above. R² is 0.32; most variation is unexplained.
- **About 30 days of data.** Dispatch records are kept for about 30 days, so nothing before
  about 10 September is included and lane-worked tickets are absent.
- **The ticket text is the first dispatch, not the filing.** An edit between the two is
  invisible. The brief sample is 132 of 136 September tickets, before the 4 October prompt change.
- **Not checked.** 4 of the 12 interpretation surfaces and the Flight Companion's transcripts;
  three authoring surfaces cannot be bounded from source (custom prompts, the Flight
  Companion's playbook, ad-hoc `POST /issues`).
- **Not independently checked.** Under `standard.md` rule 2 this paper needs a second
  document by someone other than its author. None exists yet, so every figure here is the
  study's and this paper's recomputation, not a second reading.

## Next

- Try the bar forward, on a matched set of new tickets, against size-matched controls from after
  the change (a proposal line).
- Replay a brief that may not open decided items on the 60 pairs and re-measure (a proposal line).
- Resolve the three competing "read first" instructions in the agent's prompt (a proposal line).
- Have someone other than this paper's author check it from the branch, re-running
  `agreement.py` and `fidelity_summary.py`.
