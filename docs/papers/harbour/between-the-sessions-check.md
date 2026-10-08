---
title: Does "The Cost Lives Between the Sessions" report its sources correctly?
kind: check
version: 1
date: 2026-10-01
authors: [Claude (LIN-3196)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 36897e21, kind custom, LIN-3196); effort not recorded in the dispatch item. The same session that wrote the essay, so a self-check, not an independent one. No in-session subagents. Every figure was read at its source with grep and by reading the passage; nothing was re-run."
grounded_at: 0a25d367 (LinearViewer, origin/main), the commit the essay's branch was cut from
cites:
  - "docs/papers/harbour/between-the-sessions.md (version 1, LIN-3196, as it stood before this check's corrections and after them)"
  - "docs/steady-base.md@0a25d367:33,54"
  - "docs/papers/harbour/steady-base-menu.md@0a25d367:46,52,144,189,207,353,411,446,453-466,512-515"
  - "docs/papers/harbour/growth-atlas.md@0a25d367:18,23,35"
  - "docs/papers/harbour/model-choice.md@0a25d367:17-18,26-30,160"
  - "docs/papers/harbour/what-doubled-the-dispatches.md@0a25d367:26-27"
  - "docs/papers/harbour/reliability-baseline.md@0a25d367:14-22"
  - "docs/papers/harbour/why-throughput-halved.md@0a25d367:88-91 and survey-check-3.md@0a25d367:33-34"
  - "docs/papers/harbour/fleet-complexity-read.md@0a25d367:29,31,128-162"
  - "docs/papers/harbour/where-the-effort-goes.md@0a25d367:39,63,73"
  - "docs/papers/harbour/what-supervisors-do.md@0a25d367:18-30,145-146"
  - "docs/papers/harbour/where-judgement-happens.md@0a25d367:76"
  - "docs/papers/harbour/wake-inventory.md@0a25d367:25,57"
  - "docs/papers/harbour/held-or-fresh.md@0a25d367:16,24"
  - "docs/papers/harbour/starting-context.md@0a25d367:30-37,73,141"
  - "docs/papers/harbour/what-hides-between-sessions.md@0a25d367:15-27,189-191,315 and what-hides-between-sessions-register.json@0a25d367 (WAIT-2026-10-01)"
  - "docs/papers/harbour/survey-check-10.md@0a25d367:55,293-303"
  - "docs/papers/harbour/prototype-concepts.md@0a25d367:33"
  - "docs/papers/harbour/replay-small-work.md@0a25d367:28,50,182-184 and survey-check-11.md@0a25d367:31-60"
  - "docs/papers/harbour/proportional-process-backtest.md@0a25d367:35-45"
  - "docs/papers/harbour/cost-mix.md@0a25d367:38-46,51,145,219"
  - "docs/papers/harbour/paid-where-written-check.md@0a25d367 (what it re-read in fleet-complexity-read.md)"
  - "docs/papers/standard.md@0a25d367:68-99 (the essay form and rule 2)"
  - "LIN-3181 root-cause comment 8889a40c-76f5-402d-876e-01e71e85f17c and LIN-3188 description, read over the workspace proxy on 2026-10-01"
---

# Does "The Cost Lives Between the Sessions" report its sources correctly?

After the corrections below, yes on every figure; and the argument goes a little further than its
evidence in two places, which the essay now says. Every number in the essay was read at the paper
that measured it, not at the anchor that summarises it, and every one matches. The first draft got
twelve things wrong. None was a wrong number taken from a source. They were a figure cited to the
summary rather than the paper, a quotation given to the wrong speaker, and readings that went
slightly past what the source says. Each is fixed in the essay's version 1 as merged. The essay's
title claim, that the cost lives between sessions, is a reading of several overlapping
measurements, and no paper sums them. The essay says so, and this check adds a line to
`proposals.md` asking for the sum.

This is a self-check. The session that wrote the essay wrote it, and an independent reader would
likely find more. The companion essay's own self-check found every figure matched; its independent
check then changed eleven (`paid-where-written-check.md` version 2).

## Findings

### The figures

**Every figure matches its source.** Each sentence with a number, a quotation or an attribution was
read at the passage below.

| Essay's claim | Source, at 0a25d367 | |
|---|---|---|
| Product code about 2,800 lines a week since June; test lines 10.6×, comment lines 7.1×; fleet machinery fastest | `growth-atlas.md` v2 :35, :23, :18 | ✓ |
| 26 papers and 13 checks in 29 September–1 October, one session each | `steady-base-menu.md` v2 :411 | ✓ |
| Dispatches per correct change rose about 2.5× at 12 July: frontier 7.9 → 18.6, mid 8.1 → 21.0 | `model-choice.md` v2 :26-30, :160 | ✓ |
| Whole-life hours about the same at either tier | `model-choice.md` v2 :17-18 (2.9–3.0 against 3.2–3.3 h) | ✓ |
| Bugs after merge 5.4 → 13.7 per 100 merged PRs in the main repository; 5.7 without review residue, level with June | `reliability-baseline.md` v2 :14-20 | ✓ |
| LIN-3133: one identifier into two factories, 8 lines inert, 41 queue items, an hour; implementation 0.6%, supervisor 59%; 13% by output tokens | `fleet-complexity-read.md` :128-162 | ✓ (version 1 source; see below) |
| Supervision 35% of weighted tokens; 77% mechanical; about 27% of the fleet's tokens | `where-the-effort-goes.md` v2 :39; `what-supervisors-do.md` v2 :20, :29 | ✓ |
| At least half of a standalone change's cost does not depend on size | `cost-mix.md` v2 :51 | ✓ |
| 1,614 wakes, 35% of September's, relayed re-arms; 97% quiet | `wake-inventory.md` v2 :25 | ✓ (of 4,602) |
| The pending note comes from the completion check and wakes the parent | `wake-inventory.md` v2 :57 (S4, the `[pending]` post) | ✓ |
| Fresh sessions flat at about 11; wakes 8 in late July → 18 in late September | `what-doubled-the-dispatches.md` v2 :26-27 (10.6–11.5; 8.0 → 18.0) | ✓ |
| Orientation 6–26%; re-finding 4.9–12.1% of all tokens; 85% of repeated file reads unchanged | `starting-context.md` v2 :73 (5.8–25.8%), :34, :141 | ✓ |
| Credential died about 7 s after minting; 30 s cache; re-selected; reported transient and retryable; 203 rejections; reads hit as often as writes | LIN-3181 root-cause comment, §§1–3 | ✓ |
| "Don't park on one 401 … retry over 10–15 minutes"; kept it quiet for 10 hours | `what-hides-between-sessions.md` v2 :189-191 | ✓ |
| The credential lived about eleven hours until John signed in again | `survey-check-10.md` :298-303; anchor decisions, 1 October | ✓ (11 h life; 10 h onset to filing) |
| The circle: one supervisor on a second ticket, that ticket on its parent, a passage leg on the first; 35 minutes; broken by the Flight Companion | register row WAIT-2026-10-01; LIN-3188 description | ✓ (62 min by a second count, `survey-check-10.md` :298-301) |
| 107 incidents since June; 92 invisible to one session; median 16 h, 3 h where timed | `what-hides-between-sessions.md` v2 :15-18 | ✓ |
| Who found them: supervisors 28, workers 26, John 19, reviews and measurements 13, Flight Companion 9, code 3 | `what-hides-between-sessions.md` v2 :19-20 | ✓ |
| Six rules caught 9 of 19 scored, median 5 h before filing; under a minute of CPU a month, no model tokens; LIN-3181 alarmed 1.5 h after onset instead of 10 | `what-hides-between-sessions.md` v2 :21-27 | ✓ |
| "Each layer was locally right in both cases; the problem was only visible across sessions"; John: "this class is what the prompts grew to catch" | LIN-3188 description | ✓ (attribution corrected; see below) |
| Earlier fixes worked on their targets; implementation about a quarter of tokens | anchor :33; `where-the-effort-goes.md` v2 :73 | ✓ |
| 22 of 25 supervisor failures mechanical, 21 bugs in code; a session failed milliseconds after its wake | `what-supervisors-do.md` v2 :145-146 (27 ms, LIN-2511) | ✓ |
| Judgement: judging a report and writing the next beat about a fifth of the bill; decisions cluster at the gates and in the making | `what-supervisors-do.md` v2 :18-19; `where-judgement-happens.md` v2 :76 | ✓ |
| Conductor in the runner and dispatch code; detectors outside the processes they watch, one alarm to a decider | `steady-base-menu.md` v2 :144 (M3), :189 (M21) | ✓ |
| 3 in 20 to 19 in 20 on a small model | `prototype-concepts.md` v2 :33 | ✓ |
| Relay of fresh sessions 0% (−17% to +9%) | `held-or-fresh.md` v2 :24 | ✓ |
| Replay: 13 small low-risk tickets, pre-registered; 4.1%, 5.4% at matched tiers; 5–10% lean harness; 18–24% today's habits | `replay-small-work.md` v2 :8; `survey-check-11.md` :31-38 | ✓ |
| One fleet session's orientation exceeds a whole replay session | `replay-small-work.md` v2 :182-184 (77k bootstrap, 115k; legs 20–56k) | ✓ |
| All 43 real faults review found in the last 100 reviewed tickets were in changes of 50+ production lines; 23 small changes | `cost-mix.md` v2 :41-42, :145 | ✓ |
| About seven real credential bugs that CI missed | `fleet-complexity-read.md` :31 | ✓ |
| Back-test: six rules, 1,282 changes; 13–18% of hours; 36 real faults in the text rule's light group; 2 in 100 | `proportional-process-backtest.md` v2 :35-45 | ✓ |
| Sizing worth about 1.1–1.2× | `cost-mix.md` v2 Options 1 and 4; anchor "What this implies" | ✓ |
| 39 documents, 187,711 words, 164 scripts, four charging rules, two censuses, 12 → 17 rows, wrong figures for about an hour twice | `steady-base-menu.md` v2 :411, :453-460; `survey-check-12.md` §5 | ✓ |
| About 20 of 24 documents checked before the sixth wave corrected; most moved sizes moved down | `survey-check-10.md` :55; `steady-base-menu.md` v2 :446 | ✓ |
| Replay v1 read about a twenty-fifth and no worse; 8 of 13 descriptions carried what shipped; two of three shared faults in them; two of four verdicts better → worse; registered 5 / 1 / 7 | `survey-check-11.md` :46-60; `replay-small-work.md` v2 :50 | ✓ |
| The menu checked after merge; its top ×2.44 → ×2.38 | `steady-base-menu.md` v2 :463-466 | ✓ |
| Credential work about a tenth; 2.5× at three times cheaper; about 10× if free | `cost-mix.md` v2 :40, :219 (2.5; 10.3, or 9.7 at the list ratio) | ✓ |
| Whole menu ×1.57–2.38, ×1.49–2.10 with credential work held; only the whole menu reaches 2×; about 10% visible to code by class | `steady-base-menu.md` v2 :46-52, :144 | ✓ |
| Transcripts begin 31 August; evidence kept 30 days; September's shares high | `steady-base-menu.md` v2 :512-515; anchor :54 | ✓ |
| Escape share 1.1% → 3.1% without finder rows | `why-throughput-halved.md` v3 :88-91; `survey-check-3.md` :33-34 | ✓ |
| Rules written knowing the incidents | `what-hides-between-sessions.md` v2 :315 | ✓ |
| A trial able to see a doubled escape rate takes about 40 weeks plus 30 days | `steady-base-menu.md` v2 :350-354 | ✓ |
| A held supervisor's wake costs about 0.11 of its accumulated context | `held-or-fresh.md` v2 :16 | ✓ |

**One figure rests on a source no check has covered.** The 0.6% comes from
`fleet-complexity-read.md`, the only source in the set at version 1, with no header and no check
of its own. `paid-where-written-check.md` re-read its 41 queue items, the hour, the 10–20 minutes
and the seven credential bugs, but not the token table. The essay says so and gives the 13% by
output tokens beside it. The share is in the audit's own cost units, which weight cache reads at
0.1. The supervisor's long, re-read context is what makes implementation's share small.

**No figure is in currency.** Every cost is a ratio, a share of weighted tokens, dispatches or
hours. A search for currency symbols in the essay finds none.

### What the first draft got wrong

The draft was read against every source above before this check was filed, and twelve things
changed. All are in the merged version 1.

| Draft said | Source says | Now |
|---|---|---|
| Ten figures cited to the anchor, `docs/steady-base.md` | `standard.md` rule 2: an essay's figure "is read at its source, not taken second-hand from another document"; the brief asks for each figure cited to its paper | Each is cited to the paper that measured it; the anchor is cited only for the two things it alone states |
| John said "each layer was locally right in both cases…" | LIN-3188's description says it; "John's observation" is the next sentence | Attributed to the commissioning ticket, with John's own sentence quoted after it |
| "A ticket's supervisor waited on a child ticket" | The register: LIN-2884's autopilot waited on LIN-3142, which waited on its parent; the Go leg waited on LIN-2884. Nothing says LIN-3142 is LIN-2884's child | "Waited on a second ticket" |
| "The cycle ran 203 times" | 203 rejections, some of them concurrent requests 0.1–0.2 s after a 503 | "The tracker refused it 203 times" |
| "107 incidents of cross-session failure patterns" | 107 incidents, 101 of them in the nine patterns | "107 incidents of this kind" |
| "At least half of a September change's cost" | "standalone change" | "standalone" added |
| Judgement "at the review gates and in the making, about a fifth of the bill" | Two sources: the fifth is of the supervision bill (`what-supervisors-do.md`); the gates and makers are per ticket (`where-judgement-happens.md`) | Split into two clauses, one per source |
| "If review catches nothing on small changes" | Review caught a real fault on about 2 in 100 small changes from June to September (`cost-mix.md` :43-44) | "Rarely catches anything", and the 0 of 23 marked as a small sample |
| The replay's first reading: "a twentieth as much" | Version 1 of the replay read about a twenty-fifth (`survey-check-11.md` :46) | "About a twenty-fifth" |
| "The share of correct changes that later escaped" | The share of merged tickets with a named escape | "Merged tickets with a bug later traced to them" |
| Opening: "the cost per change rose about two-and-a-half-fold" | The step is in dispatches per correct change (`model-choice.md` v2 :26-30); there is no token series before September (anchor :54) | "The agent sessions it took to land a correct change rose about two-and-a-half-fold" |
| "Nothing in any layer's instructions can see the problem" | Supervisors found 28 of the 107 incidents and workers 26; agents inside the work do notice, late | "No layer doing the work can see the problem from where it stands", and section 4 now says who found them and how late |

### The argument

**The centre holds on the evidence it cites.** Each of the four seams is measured, each is
cross-session by the source's own account, and the remedy's three parts are each the expedition's
own recommendation. The ceiling is the bound's and the menu's, quoted at their checked values.

**The title claims more than any one measurement shows.** "The cost lives between the sessions"
rests on adding wakes (29% of September's tokens), orientation (6–26%), re-finding (4.9–12.1%)
and repeat legs (10%), which overlap, plus lost-wake idle in hours. No paper sums them once. The
largest single cost line in the audit of three tickets, the supervisor's own growing context, is
paid inside one session. The essay now says both in section 8. Its failures claim is better
supported than its cost claim: 92 of 107 incidents invisible to any one session is a direct
measurement. A proposal for the sum goes to `proposals.md` with this check.

**The two-and-a-half-fold step is in dispatches, not spend.** The ticket's words were "cost per
change". The essay now says sessions per correct change in its opening and dispatches in section 2.
There is no token series before September (anchor point 9), so the step cannot be restated in
tokens, and a dispatch late in September carries more context than one in July. The step measures
process, not money.

**"Quality held" holds on the baseline's measure, not on every measure.** The share of merged
tickets with a bug traced to them roughly tripled from June, without finder rows, from a low base.
The two measures differ in population and months. The essay gives both.

**The remedy's first part is the least tested.** Code holding the sequence is supported by a
mechanical share (a codebook's reading), a prototype on a small model, and detector scores written
with hindsight. The plumbing it would move is where 21 of 25 supervisor failures already are. The
essay says the plumbing moves rather than vanishes. It cannot say whether more code in the seams
means fewer failures there or more.

## Method

Each sentence of the draft that carries a number, a quotation or an attribution was listed and read
against the passage it cites, at 0a25d367, by `grep -n` for the figure and then by reading the
surrounding paragraph. Where the draft cited the anchor, the figure was traced to the paper the
anchor names and read there. The tracker sources, LIN-3181's root-cause comment and LIN-3188's
description, were read over the workspace proxy on 1 October 2026. The circle's three parties were
read from the register's row. Nothing was re-run: no script, query or measurement.

## Limits

- **A self-check.** The author checked its own essay in the same session, with the same reading of
  each source in mind. *Bias:* toward confirmation, on readings more than on numbers. The companion
  essay's self-check found nothing; its independent check changed eleven figures and seven readings.
- **Second-hand checks inherited.** Every figure is read at a version 2 paper, whose own check
  re-ran its scripts. This check re-ran none. *Bias:* an error both a paper and its check missed
  passes here too.
- **The tracker sources are one reading each.** The RCA comment is one session's reading of server
  logs; LIN-3188's description is a ticket's framing. *Bias:* small for the figures, which
  `what-hides-between-sessions.md` and `survey-check-10.md` also carry.
- **Merged without a review leg.** Like the papers and the companion essay, this essay and check are
  merged on green CI by the brief's design, with no recorded review approval.

## Next

One line goes to `proposals.md` in this PR: **how much of the fleet's cost and idle time sits at
the handoffs between sessions, counted once?** It is the measurement the essay's title rests on and
that no paper has made. An independent check of the essay, of the kind
`paid-where-written-check.md` gave the first essay, would be the next document about this one.
