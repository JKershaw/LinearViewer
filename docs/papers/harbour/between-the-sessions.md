---
title: The Cost Lives Between the Sessions
kind: essay
argument: In a careful multi-agent system the cost and the failures gather between sessions, where no single agent can see them — wakes that relay "still waiting", sessions re-reading what the last one read, an error healed every thirty seconds for hours, agents waiting on each other in a circle — and because every layer is locally right, no layer's instructions can fix it; the remedy has a shape (code holds the sequence and watches the seams while models keep the judgement, work runs lean with one independent reader, and process is sized to the change), the research that found this drifted the same way and was caught the same way, by independent readers, and the risky work that must keep its rigour bounds the gain at about 2× if the whole menu lands and about 10× at the ceiling.
version: 1
date: 2026-10-01
authors: [Claude (LIN-3196)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 36897e21, kind custom, LIN-3196); effort not recorded in the dispatch item. One bounded writing session with no research, plan, review or close-out legs and no in-session subagents, by the brief's design. Commissioned by John Kershaw on 1 October 2026 as the closing essay of the steady-base expedition and the companion to paid-where-written.md. No new measurement: every figure is read from a checked source, and the companion check, between-the-sessions-check.md, was written by this same session."
sources:
  - "docs/steady-base.md@0a25d36703dbd812f942cdc481de051ddab262ea:33,54 (the anchor: earlier fixes; evidence kept for 30 days)"
  - "docs/papers/harbour/steady-base-menu.md@0a25d367 (version 2): §1, §2 (M3, M21), §3, §4 Group C, §6, Limits"
  - "docs/papers/harbour/survey-check-12.md@0a25d367 (the menu's independent check)"
  - "docs/papers/harbour/growth-atlas.md@0a25d367 (version 2)"
  - "docs/papers/harbour/model-choice.md@0a25d367 (version 2) and what-doubled-the-dispatches.md@0a25d367 (version 2)"
  - "docs/papers/harbour/reliability-baseline.md@0a25d367 (version 2); why-throughput-halved.md@0a25d367 (version 3) and survey-check-3.md@0a25d367"
  - "docs/papers/harbour/fleet-complexity-read.md@0a25d367 (version 1, no header)"
  - "docs/papers/harbour/where-the-effort-goes.md, what-supervisors-do.md and where-judgement-happens.md@0a25d367 (each version 2)"
  - "docs/papers/harbour/wake-inventory.md and held-or-fresh.md@0a25d367 (each version 2)"
  - "docs/papers/harbour/starting-context.md@0a25d367 (version 2)"
  - "docs/papers/harbour/what-hides-between-sessions.md@0a25d367 (version 2), what-hides-between-sessions-register.json@0a25d367 and survey-check-10.md@0a25d367"
  - "docs/papers/harbour/prototype-concepts.md@0a25d367 (version 2)"
  - "docs/papers/harbour/replay-small-work.md@0a25d367 (version 2) and survey-check-11.md@0a25d367"
  - "docs/papers/harbour/proportional-process-backtest.md@0a25d367 (version 2)"
  - "docs/papers/harbour/cost-mix.md@0a25d367 (version 2) and survey-check-9.md@0a25d367"
  - "docs/papers/harbour/paid-where-written.md@0a25d367 (version 2) and paid-where-written-check.md@0a25d367"
  - "LIN-3181 root-cause comment 8889a40c-76f5-402d-876e-01e71e85f17c (1 October 2026), read over the workspace proxy"
  - "LIN-3188 description (1 October 2026), read over the workspace proxy"
---

# The Cost Lives Between the Sessions

*What three days of measuring a careful agent fleet found, and what the measuring did to itself*

Prepared for John Kershaw | October 2026

A system made of many careful agents does not fail where any one of them is looking. Each session
reads its instructions, does its part well and hands on. The waste and the failures gather in the
handoffs. A supervisor is woken to be told that nothing has changed, and it says so to its own
supervisor. A session re-reads the files the session before it read. An error is healed by a retry,
again and again, for a whole night. Three agents wait on each other in a circle. Every layer is
locally right, and so no layer doing the work can see the problem from where it stands, let alone
fix it. In the one system measured here, the agent sessions it took to land a correct change rose
about two-and-a-half-fold at one step while quality held. The cost rose around the change, not in
it.

The remedy has a shape. Code holds the sequence and watches the seams, and models keep the
judgement. Work runs lean, with one independent reader. Process is sized to the change. And the
research that found all this drifted the same way, for the same reason, and was caught by the same
remedy: a reader standing outside the work.

## 1 A careful fleet

Harbour is a small software project whose work is done mostly by AI coding agents. Its tasks live in
an ordinary issue tracker. A long-running agent session, a *supervisor*, takes a ticket and sends it
through a pipeline of shorter sessions: research, a plan, a review of the plan, implementation, a
code review, and a close-out that merges the work. Supervisors can sit above supervisors: a ticket's
own supervisor reports to an epic's, and since mid-September a *passage runner* has flown whole
sequences of tickets above them both. When a session below finishes, pauses or gets stuck, a message
goes up the chain and *wakes* the supervisor waiting on it. One person, John Kershaw, owns the
project and rules on what the agents cannot settle.

The fleet started on 1 June. In late September John asked whether the process was overcomplicated or
the tasks really took this long. Over 29 September to 1 October the fleet answered with 26 papers
and 13 independent checks of them, each written in a single session
[[2]](#2-the-menu-and-its-check).

## 2 Around the change, not in it

The part of the work that changes the product barely moved. Net product code has held at about 2,800
lines a week since June. Everything around it grew: test lines 10.6-fold, production comment lines
7.1-fold, and the fleet's own dispatch and supervision code fastest of all
[[3]](#3-the-growth-atlas).

The process grew in steps, not just in lines. At 12 July, the number of agent sessions and
follow-ups dispatched per correct change, the fleet's measure of process cost, rose about
two-and-a-half-fold. It did so whether a frontier-tier model wrote the change (7.9 to 18.6) or a
mid-tier one (8.1 to 21.0). The model was not the cause. A correct change costs about the same
whole-life working hours at either tier [[4]](#4-model-tier-and-the-step). Quality, on the measure
the project chose as its baseline, did not move. Bugs reported after merge rose on paper, from 5.4
to 13.7 per 100 merged pull requests in the main repository. But once the faults the fleet's own
reviews found in *older* code are set aside, September stood at 5.7 per 100, level with June
[[5]](#5-reliability).

The smallest example is the starkest. One ticket threaded a single identifier into two factories,
eight lines that did nothing at runtime. It took 41 queue items and an hour. Implementation, the
session that wrote the code, was 0.6% of its weighted tokens. The supervisor driving it took 59%
[[6]](#6-the-fleet-complexity-read). Across the fleet the picture is milder but the same.
Supervision takes 35% of the fleet's weighted tokens, and 77% of that goes to steps that observable
state fully decides: taking delivery of a wake, reading a row, answering a completion gate, noting
progress. That is about 27% of everything the fleet spends, before any judgement is made
[[7]](#7-effort-and-supervision). At least half of a September standalone change's cost does not
depend on its size [[17]](#17-the-bound).

## 3 Four seams

Four kinds of cost and failure recur in the record. Each sits at a handoff between sessions.

**Wakes that relay "still waiting".** When a child session is waiting on something outside itself,
its completion check posts a *pending* note, and the note wakes its parent. The parent usually has
nothing to do but wait too, so it re-arms, and its own note wakes *its* parent. In September, 1,614
wakes, 35% of them all, were a supervisor relaying its own "still waiting" upward, and 97% of those
changed nothing [[8]](#8-the-wake-papers). Fresh sessions per correct change have been flat at about
11 since August, while wakes per correct change went from 8 in late July to 18 in late September.
The growth is in this plumbing, not in the work [[4]](#4-model-tier-and-the-step).

**Sessions re-reading what the last one read.** Orientation, the reading a session does before its
first useful act, is 6–26% of September's weighted tokens. Within it, re-finding what an earlier
session on the same ticket had already read is 4.9–12.1% of all tokens, and 85% of the repeated file
reads were of files that had not changed in between [[9]](#9-starting-context).

**A dead credential, healed every thirty seconds.** On the evening of 30 September a credential for
the issue tracker died about seven seconds after it was minted, and stayed stored where the proxy
looks first. Every thirty seconds the proxy's cache expired, the next call picked the dead
credential, the tracker refused it, and the proxy swapped in a good one, reporting the failure as
transient and retryable. The tracker refused it 203 times, and reads were hit as often as writes
[[10]](#10-the-dead-credential). Every agent that met it saw a call that worked on retry, which is
exactly what its instructions told it to expect: "Don't park on one 401 … retry over 10–15 minutes".
Applied in every session, that rule is what kept the fault quiet for ten hours before anyone filed
it, and the credential lived about eleven hours until John signed in again
[[11]](#11-what-hides-between-sessions).

**Three agents waiting on each other in a circle.** On 1 October one ticket's supervisor waited on a
second ticket, the second ticket waited on its parent, and a passage leg waited on the first ticket.
Each wait was reasonable. The leg sat idle for 35 minutes until the Flight Companion, an agent
session that watches the fleet alongside John, noticed and broke the cycle
[[11]](#11-what-hides-between-sessions).

The last two are not curiosities. The tracker holds 107 incidents of this kind since June. 92 of
them were invisible to any single session that met them, and they surfaced a median of 16 hours
after they began, or 3 hours where the record times the onset. Six simple rules, run over data the
system already held, caught 9 of the 19 incidents they could be scored on, a median of five hours
before anyone filed them, for under a minute of computer time a month and no model tokens at all. On
the dead credential, a rule would have alarmed 1.5 hours after onset instead of 10
[[11]](#11-what-hides-between-sessions).

## 4 Why no layer sees it

In each case every layer did what it was told, and what it was told was sensible. A child should
report that it is waiting. A supervisor should pass on what it hears. A new session should check the
code rather than trust a summary. An agent should not give up on one authentication error. The
ticket that commissioned the last wave of research put it in one line: "Each layer was locally right
in both cases; the problem was only visible across sessions." John added that this class of failure
"is what the prompts grew to catch" [[12]](#12-the-commission).

This is why the obvious fixes did not bend the curve. The project had already moved implementation
to cheaper models and cut the number of tasks it generated, and both worked on what they targeted.
But implementation is about a quarter of the fleet's tokens, and the cost sits in supervision and
checking, which are paid per ticket, per session and per wake, not per line changed
[[1]](#1-the-anchor) [[7]](#7-effort-and-supervision). Nor do more instructions help. The companion
essay argued that a rule written as prose is paid on every run [[13]](#13-the-companion-essay). A
rule cannot watch a seam either. It lives inside one session, and the seam is not there. The
vigilance the prompts ask for sees each instance and never adds them up. The incidents were found in
the end: supervisors found 28, the workers that hit them 26, John 19, reviews and measurements 13,
the Flight Companion 9 and code 3, a median of 16 hours after they began
[[11]](#11-what-hides-between-sessions). Agents in the work do notice, one instance at a time and
late. Something has to add the instances up, and the question is whether that is a person, an agent
or a program, and how soon it looks.

The failure record agrees. Of the 25 supervisor failures on record, 22 were in mechanical actions,
not in judgement, and 21 were bugs in code: lost wakes, stale state, a session failed milliseconds
after it was woken [[7]](#7-effort-and-supervision). Judgement, by contrast, is concentrated. Inside
supervision, judging a worker's report and writing the next step is about a fifth of the bill, and
across a ticket the decisions that change its outcome cluster at the review gates and in the making
[[7]](#7-effort-and-supervision).

## 5 The shape of a remedy

**Code holds the sequence and watches the seams; models keep the judgement.** The mechanical part of
supervision, the waiting, re-arming, polling, restating and answering of completion gates, can be
held by a deterministic conductor in the runner and dispatch code, which already hold the answers.
The supervisor keeps its judging and its next step. The detectors that would have caught the dead
credential and the circle belong in the same code, running outside the processes they watch, raising
one alarm to someone who decides [[2]](#2-the-menu-and-its-check). The project's prototypes point
the same way: holding the sequence in code around one narrow model call took a small model from 3
successes in 20 to 19 in 20 on its task [[14]](#14-the-prototypes). This is not free. The plumbing
moves rather than vanishes, and since most supervisor failures are already bugs in plumbing code,
moving more of it into code means more code that has to be right. Nor is starting every judgement
step in a fresh session the answer: while fresh sessions orient as they do today, a relay of fresh
sessions costs about the same as holding one open (0%, with a range of −17% to +9%)
[[8]](#8-the-wake-papers).

**Lean work plus one independent reader.** Thirteen small, low-risk tickets already done were
replayed, under a pre-registered design, by one implementer, one review and one close-out. They cost
4.1% of the original sessions' tokens, or 5.4% with the models' tiers matched: about a twentieth
[[15]](#15-the-lean-replay). In production, with the pull request, CI and tracker chores priced in,
a lean harness would cost about 5–10% of today's; with today's per-session habits it would be
18–24%. The weight is in each session's harness and habits, not in the model: one fleet session's
orientation is larger than a whole replay session. And the one reader matters. Across the last 100
reviewed tickets, all 43 real faults that review found were in changes of 50 production lines or
more, though only 23 of those tickets were small, too few to be sure [[17]](#17-the-bound). On a
large credential migration, review found about seven real bugs that the automated tests had missed
[[6]](#6-the-fleet-complexity-read). One independent reader where it counts is not the same thing as
five rounds of review everywhere.

**Process sized to the change.** If review rarely catches anything on small changes, small changes
could take a lighter path. A back-test of six size-and-risk rules over 1,282 past changes found the
most a lighter path could save is what the light work costs now, 13–18% of working hours. It also
found a trap: a rule that reads only the ticket's text routed large, faulty changes light, with 36
real faults caught in that light group. Classification has to use the paths a change actually
touches [[16]](#16-the-back-test). Sizing is a real lever but a smaller one than it first looked. On
the whole budget it is worth about 1.1–1.2 times as much correct work [[17]](#17-the-bound).

## 6 The research drifted the same way

The research that found the drift between sessions drifted between sessions too. Each paper was one
bounded session, and each was careful. Together, in three days, they made 39 documents and 187,711
words. They added 164 scripts. They produced four rules for charging a cost to a change where the
brief had asked which of two to adopt, and two censuses of the same log that did not agree. The map
of options grew from 12 rows to 17, and later papers re-measured one lever under new names until the
final paper had to merge them. And figures were quoted into the project's anchor document at version
1 while their checks were still running, so that the anchor carried wrong figures for about an hour,
twice [[2]](#2-the-menu-and-its-check). Each paper was locally right.

The independent checks caught it, and for the same reason the detectors catch the dead credential:
they stood outside the sessions they read, and they read the sources rather than the papers. About
20 of the 24 documents checked before the sixth and last wave had a load-bearing claim corrected. In
the last two waves, most of the option sizes the checks moved, they moved down
[[2]](#2-the-menu-and-its-check).

The lean replay is the sharpest case. Its first version read the result as a lean pipeline costing
about a twenty-fifth as much and no worse on ordinary small work. Its check found hindsight in the
verdicts. Eight of the thirteen ticket descriptions the replay worked from already carried what had
shipped, and two of the three faults it "shared" with the full process were written into them.
Re-run from the text as it stood before implementation, two of four verdicts moved from better to
worse. By the verdict it had registered in advance, the replay was 5 better, 1 equivalent and 7
worse [[15]](#15-the-lean-replay). Cheap is proven. Correct is not yet.

The final paper, the menu of options, was checked after it merged, as all the others were. Its own
method note says that is the wrong order. Its check moved the whole menu's top from ×2.44 to ×2.38
[[2]](#2-the-menu-and-its-check).

## 7 The ceiling

The risky work sets the bound. Credential and authentication work is about a tenth of the budget,
and it is where review earns its keep. Hold that work at today's rigour and make everything else
three times cheaper, and the fleet does 2.5 times as much correct work for the same budget. Make
everything else free, and it does about 10 times as much. No process change can beat that ceiling
without touching the work where review pays [[17]](#17-the-bound).

The menu the expedition ended with is well inside it. Every option combined, with overlapping
savings counted once, comes to ×1.57–2.38 more correct work for the budget, or ×1.49–2.10 with
credential work held at today's cost. Only the whole menu reaches 2×, and only in the upper part of
its range. Its top needs the conductor to take nearly all of the 27% that supervision spends on
mechanical steps. Today's evidence supports code taking about 10% of the fleet's tokens: the wakes
it can tell apart by class. How much of the supervision cycle code can really decide is the one
figure the expedition did not measure [[2]](#2-the-menu-and-its-check).

That is the honest shape of the result. About 2× if the whole menu lands; about 10× as the hard
ceiling; and the difference between them is the rigour the project has decided to keep.

## 8 What the evidence does not show

It is one system, young, measured over one month of complete token records; session transcripts
begin on 31 August, and older evidence had been deleted after thirty days [[1]](#1-the-anchor).
September also ran a research wave and a passage at once, which makes the shares the remedy draws
on, if anything, high [[2]](#2-the-menu-and-its-check). Costs here are weighted tokens, dispatches
and hours, never money.

"Quality held" holds on one measure. On another, the share of merged tickets with a bug later traced
to them rose from 1.1% in June to 3.1% in the later weeks, once the faults the fleet's own reviews
found in older code are set aside [[5]](#5-reliability). The two measure different populations over
different months. Neither shows quality collapsing, and neither is a clean null.

The small ticket's 0.6% is from the one source in the set that is still at version 1, an independent
audit of three tickets. The share is of weighted tokens, which count the supervisor's long, re-read
context heavily. By output tokens, implementation was 13% [[6]](#6-the-fleet-complexity-read).

The detectors' scores have hindsight of their own: the rules were written knowing the dead
credential and the circle [[11]](#11-what-hides-between-sessions). The conductor's size is
unmeasured. The lean lane's correctness is unknown until a forward trial runs, and the expedition
estimates that a trial able to see a doubling of escapes would take most of a year
[[2]](#2-the-menu-and-its-check). And not all of the cost is between sessions. A held supervisor's
cost grows with its own history, about 0.11 of its accumulated context per wake, which is a cost
inside one session [[8]](#8-the-wake-papers). Nor does any paper add the between-session costs into
one share counted once: wakes, orientation and re-finding overlap, and the title of this essay is a
reading of several measurements, not one of them.

The argument could be wrong in a way anyone can observe. If the conductor lands and hours per
correct change do not fall, the mechanical share was not where the cost was. If a lean lane runs and
more of its changes turn out faulty than the 2 in 100 at which small, low-risk work escapes today
[[16]](#16-the-back-test), the full process was buying correctness the papers could not see.

Finally, this essay was written the way the papers were: one session, no review leg, merged on green
CI by the brief's design, with a check written by the same session. Its check is a self-check, and
an independent reader would do better.

## Annotated reading list

Every figure above comes from Harbour's own record, and each is read at the paper that measured
it. Each source is a measurement of that one system, and every paper here has been checked by a
second document, except where the entry says so.

### 1 The anchor

Harbour. *Harbour steady base: proportional effort, measured.* `docs/steady-base.md`, as of
1 October 2026.

The expedition's summary of its 26 findings, each as its check corrected it. It is cited only for
what no single paper states: that the earlier fixes worked on their targets without bending the
curve, and that evidence was kept for thirty days. It is a synthesis, not a measurement.

[steady-base.md](../../steady-base.md)

### 2 The menu and its check

Harbour. *Taken together, what did the steady-base expedition find, and what is the menu of changes
John can choose from?* `steady-base-menu.md`, version 2, 1 October 2026; and *Does the steady-base
menu hold up?* `survey-check-12.md`.

The closing paper: the archive count, the menu, the detectors, the stacks and their multiples, the
trial timescale, and the method note on where the research drifted. Its check re-ran its scripts,
corrected the stacks to ×1.57–2.38 and showed that only 10% of supervision is visible to code by
class today. The stacks assume the same correct output; nothing in them prices a lost catch.

[steady-base-menu.md](steady-base-menu.md) · [survey-check-12.md](survey-check-12.md)

### 3 The growth atlas

Harbour. `growth-atlas.md`, version 2.

Product code at about 2,800 lines a week, and the growth of tests, comments and the fleet's own
machinery around it. It supports the shape of the growth; it does not say what caused it.

[growth-atlas.md](growth-atlas.md)

### 4 Model tier and the step

Harbour. `model-choice.md`, version 2; `what-doubled-the-dispatches.md`, version 2.

The two-and-a-half-fold step at 12 July at both tiers, the whole-life hours per correct change,
flat fresh sessions and the growth in wakes. Why fresh sessions rose between 5 and 12 July is
unexplained, and September's figures are provisional until their 30-day windows close.

[model-choice.md](model-choice.md) · [what-doubled-the-dispatches.md](what-doubled-the-dispatches.md)

### 5 Reliability

Harbour. `reliability-baseline.md`, version 2; `why-throughput-halved.md`, version 3, as corrected
by `survey-check-3.md`.

Bugs per 100 merged pull requests with and without review residue, and the share of merged tickets
with a bug traced to them, with and without the rows that name a reviewing ticket. They support
"level with June" for the main repository only; the dispatcher repository's rise is only partly
explained, and the second measure roughly tripled from a low base.

[reliability-baseline.md](reliability-baseline.md) · [survey-check-3.md](survey-check-3.md)

### 6 The fleet complexity read

Harbour. *Is the fleet overcomplicated? A read of three landed tickets.*
`fleet-complexity-read.md`, 29 September 2026.

An independent audit of three tickets: the eight-line change and its token shares, and the
credential migration's seven review catches. It is three tickets, at version 1 with no header and
no check of its own; `paid-where-written-check.md` re-read some of its figures, and the anchor
cites it. The 0.6% is not among the figures re-read.

[fleet-complexity-read.md](fleet-complexity-read.md)

### 7 Effort and supervision

Harbour. `where-the-effort-goes.md`, `what-supervisors-do.md` and `where-judgement-happens.md`,
each version 2.

Supervision's 35%, its 77% mechanical share and about 27% of fleet tokens, the 25 supervisor
failures, implementation's quarter, and where judgement changes outcomes. The mechanical share
rests on a codebook that calls gate replies and fetches mechanical; a blind recode put it higher.

[what-supervisors-do.md](what-supervisors-do.md) · [where-judgement-happens.md](where-judgement-happens.md)

### 8 The wake papers

Harbour. `wake-inventory.md` and `held-or-fresh.md`, each version 2.

The 1,614 relayed re-arms and their quietness, the cost of a held supervisor's growing context, and
the relay of fresh sessions at 0%. The relay is a model over September's wakes, not a trial.

[wake-inventory.md](wake-inventory.md) · [held-or-fresh.md](held-or-fresh.md)

### 9 Starting context

Harbour. `starting-context.md`, version 2.

Orientation and re-finding across 2,015 September sessions. The ranges are wide because "the first
productive call" can be defined several ways; "unchanged" sees only the ticket's own edits and the
main branch's commits.

[starting-context.md](starting-context.md)

### 10 The dead credential

LIN-3181, root-cause comment, 1 October 2026.

The thirty-second cycle, the 203 rejections and reads hit as often as writes, read from the
server's logs. It is one incident's diagnosis, not a checked paper; `survey-check-10.md` matched
the anchor's reading of it. The fix is a separate ticket.

### 11 What hides between sessions

Harbour. `what-hides-between-sessions.md`, version 2, and its register; checked in
`survey-check-10.md`.

The 107 incidents, the 92 invisible to one session, the six detector rules and what they would have
caught, the retry rule, and the circular wait. The check confirms eleven hours as the credential's
life and ten as onset to filing, and notes the circle's idle is 35 minutes by the register and 62
by a second count. The rules were written knowing the incidents they are scored on.

[what-hides-between-sessions.md](what-hides-between-sessions.md) · [survey-check-10.md](survey-check-10.md)

### 12 The commission

LIN-3188, description, 1 October 2026.

The framing of the cross-session failures quoted in section 4, with John's observation. A ticket
description, not a measurement.

### 13 The companion essay

Harbour. *Every Fix Is Paid Where It Is Written.* `paid-where-written.md`, version 2.

The expedition's first essay: prose rules are paid on every run. This essay adds that prose cannot
watch a seam. Its independent check found the first essay's asymmetry weaker than it claimed, and
that finding applies here too: code is also read on every run.

[paid-where-written.md](paid-where-written.md)

### 14 The prototypes

Harbour. `prototype-concepts.md`, version 2.

John's prototype concepts read against the levers. The 3-in-20 to 19-in-20 result is one
development comparison on a small model, tuned on its task; it gives a direction, not a size.

[prototype-concepts.md](prototype-concepts.md)

### 15 The lean replay

Harbour. `replay-small-work.md`, version 2; *Does the replay-small-work paper hold up?*
`survey-check-11.md`.

The pre-registered replay, its cost, and the hindsight its check found. It supports "cheap is
proven, correct is not yet", and nothing stronger.

[replay-small-work.md](replay-small-work.md) · [survey-check-11.md](survey-check-11.md)

### 16 The back-test

Harbour. `proportional-process-backtest.md`, version 2.

Six size-and-risk rules, committed before any outcome was read, run over 1,282 past changes. It
supports the 13–18% ceiling, the 2 in 100 and the trap of classifying on ticket text. It is a
back-test: it cannot say what a lighter path would have missed in the future.

[proportional-process-backtest.md](proportional-process-backtest.md)

### 17 The bound

Harbour. `cost-mix.md`, version 2; `survey-check-9.md`.

Where the budget goes by kind of change, the size-independent part of a change's cost, review
catches by size, and the bound on correct work per budget with credential work held. The bound
assumes the same correct output, so a cut that moves catches into escapes is invisible to it.

[cost-mix.md](cost-mix.md) · [survey-check-9.md](survey-check-9.md)

## Next

One line goes to `proposals.md` with this essay. **How much of the fleet's cost and idle time sits
at the handoffs between sessions, counted once?** The papers size wakes, orientation, re-finding,
repeat legs and lost-wake idle separately, and they overlap. This essay's title rests on reading
them together. A step-level census of September's transcripts that assigns each weighted token and
each idle hour to one of "inside a session's own work" or "at a handoff" would confirm or shrink it.

The two measurements the menu depends on are already there: how much of the supervision cycle a
reader of the runner's own state would have answered identically, which decides whether 2× is in
reach, and the forward trial of a lean lane, which decides whether cheap is also correct.
