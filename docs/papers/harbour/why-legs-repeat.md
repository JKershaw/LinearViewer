---
title: Why do Harbour's planning, review and close-out legs repeat, and what do the repeats buy?
kind: paper
version: 2
date: 2026-09-30
authors: [Claude (LIN-3174), Claude (LIN-3175)]
model: "Version 1: frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 185996b3, kind custom, LIN-3174), effort high per the runner log. One bounded session, with no research, plan, review or close-out legs, by the brief's design. Four in-session subagents of the same tier coded the sample: reader A and reader B, each split across two sessions of 32 digests, blind to each other. That session wrote the census, the rubric, the adjudication of the seven fields the readers disagreed on, and the paper. Version 2: frontier tier, Claude Code CLI (dispatch 72082c5d, kind custom, LIN-3175), the independent check survey-check-6.md, which re-ran every script, recounted the kinds from the transcripts' own headers, double-coded a fresh sample of 80 and made the corrections below."
revision: "Version 2 corrects, per docs/papers/harbour/survey-check-6.md (LIN-3175): the census takes each September leg's kind from its transcript's header where no fetched item gives it (827 repeats of 2,252 legs, not 840 of 2,271), and says that breakdown sessions decode as close-outs; August's overstatement is estimated, not put at up to half; a fresh blind sample of 80 is pooled with the first 64; later review rounds are counted from the last merge of a PR naming the ticket (13 later-round faults, all on three tickets, not 20 of 21); the cost is given by both charging rules and set against the map's rows; the claims about large tickets and rulings are narrowed to what the data show."
grounded_at: 304da17c (LinearViewer, origin/main when version 1 began); 3366748 (simple-dispatcher, origin/main); runner logs, oplog and local transcripts read 30 Sep 2026 about 20:30Z, cut at 20:00Z. Version 2 on the same snapshots, at 908f76d1
cites:
  - "docs/papers/harbour/survey-check-6.md (the check of version 1) and survey-check-6-codes.json (its fresh sample)"
  - "docs/papers/harbour/survey-check-4.md@304da17c:226-231 (the 979 legs in no map row; repeat plan-reviews outnumber first ones, 84 to 69) and :210 (row 8, review rounds after the first)"
  - "docs/papers/harbour/what-doubled-the-dispatches.md@304da17c (version 2): the kind decoding and September's dispatches per correct change, both charging rules (:193-195); :229-232"
  - "docs/papers/harbour/which-rules-pay.md@304da17c:57-66 (version 2) and which-rules-pay-codes.json@304da17c (483 coded findings on 83 tickets)"
  - "docs/papers/harbour/review-loops.md@304da17c:21-30 (83 of 94 plans sent back; the longest loops ended by a human ruling)"
  - "lib/prompts/meta-prompt-template.js@908f76d1:210-213 and lib/prompts/autopilot-kickoff.js@908f76d1:469-472 (the plan-review loop bound: a second Request Changes escalates to the human; LIN-1603, 7f1efdb8, 26 July)"
  - "docs/papers/harbour/review-consumption.md@304da17c:4-12 (the close-out consumes the review's ledger)"
  - "docs/papers/harbour/close-out-claims.md@304da17c:4-12 (the close-out routes what it cannot finish)"
  - "docs/papers/harbour/wake-inventory.md@304da17c (wakes and relays: the supervision around a leg, not counted here)"
  - "docs/papers/harbour/survey-check-3.md@304da17c (which-rules-pay's recode)"
  - "docs/papers/harbour/why-legs-repeat-codes.json (this paper's rubric, both readers' codes and the adjudication)"
---

# Why do Harbour's planning, review and close-out legs repeat, and what do the repeats buy?

A leg repeats because a gate asked for changes. 827 of the 2,252 plan, plan-review, review
and close-out sessions on Done tickets since 1 August are repeats, a few dozen fewer in fact,
because some of August's earlier legs were triage, design or breakdown sessions whose kind
could not be read. Two samples of repeats, 64 drawn systematically and then 80 at random, were
each coded by two readers who did not see each other's codes. Of the 131 that are real repeats, 121 (92%)
are the next round of a send-back loop. Six ran again because the previous session failed, all
on 2 September's terminal fault. One close-out was launched by mistake on a ticket already Done,
and one leg was part of a rescue. None followed a stale grounding, added scope or red CI. What a
repeat buys depends on its kind. A repeated plan changed the plan's substance in 24 of 34. A
repeated plan-review raised something real that no earlier round had in 30 of 41. A repeated
review changed production code in 5 of 36. Later review rounds do catch real faults, but all 13
in `which-rules-pay.md`'s codes sit on three tickets. A repeated close-out changed nothing in
20 of 20: it re-checks a hold after the fix has landed. In September the repeats cost 3.1
dispatches per correct change: 7.8% of 39.4 counted by the log's Issue line, 9.0% of 34.3
charged to the session entered. They took 10% of the tokens and 6% of the session-hours. Large
tickets are the likeliest to go round three or more times, but most tickets that do are not
large. A ruling by John or a coordinator precedes most third planning rounds, as the loop
bound requires, and few third review rounds.

![Legs per active ticket by week, first against repeat, per kind; why the sampled repeats ran, and what that round changed](figures/why-legs-repeat/legs-by-week.svg)

## Findings

**Repeats are a third of all legs, and a half of plan-reviews.** Every fresh session of the four
kinds on a ticket that is Done now, launched 1 August to 30 September, in both repos:

| Kind | Legs | Repeats | Share |
|---|--:|--:|--:|
| Plan | 529 | 226 | 43% |
| Plan-review | 382 | 201 | 53% |
| Review | 822 | 300 | 36% |
| Close-out | 519 | 100 | 19% |
| All | 2,252 | 827 | 37% |

August's review and close-out rows are too high; see Limits. Repeat plan-reviews outnumber first
ones, 201 to 181, as `survey-check-4.md` found for September's unexplained legs (84 to 69). In
August the two are level, 95 repeats to 97 first ones; in September repeats lead, 106 to 84. By
repo the share is about the same: LinearViewer 564 of 1,612 legs (35%, 404 tickets),
simple-dispatcher 109 of 301 (36%, 73 tickets). The 15 tickets that merged into both repos
repeated 61 of 107 (57%). The 60 tickets that closed without a merge repeated 93 of 232 (40%).

**Repeats bunch on a few tickets, and they follow quickly.** 250 of the 552 tickets (45%) had no
repeat. The tenth of tickets with the most repeats (55) carry 42% of them, up to 18 on one
ticket. A repeat usually starts within the hour after the last leg of its kind. The median gap is
0.4 hours for plans and plan-reviews, 0.6 for reviews and 0.8 for close-outs. 84% of plan
repeats and 85% of plan-review repeats start within the hour. So the loop turns in about the time one leg takes: a
leg's median session runs 8 to 9 minutes.

**Nearly every repeat is the next round of a send-back.** The first sample is every 13th repeat
by launch time, 64 on 61 tickets, 32 in each month. The second, drawn by `survey-check-6.md`, is
80 others at random, 40 in each month, on 67 tickets.

| Why the repeat ran | First sample (64) | Second sample (80) |
|---|--:|--:|
| A verdict asked for changes (plan-review, review or close-out hold) | 57 | 64 |
| The plan was revised after a spike or a human instruction | 2 | 0 |
| The previous session failed | 1 | 5 |
| A rescue after a failure, or a launch on a ticket already Done | 0 | 2 |
| Not a real repeat: an earlier leg of the "same" kind was triage, design or breakdown, or the leg reviewed the next phase or re-reviewed a Done ticket | 4 | 9 |
| Staleness, added scope, red CI | 0 | 0 |

121 of the 131 real repeats are send-back rounds (92%, Wilson 95%: 87–96%): 57 of 60 in the
first sample and 64 of 71 in the second. In the first, the two readers gave the same reason for
all 64 (Cohen's κ 1.00); in the second for 77 of 80 (κ 0.89). The six failed launches were all
on 2 September, on LIN-971, LIN-2437 and LIN-2442, when resumes failed on the terminal
substrate. Of the 20 real close-out repeats, 17 followed an earlier close-out's hold. One followed
a close-out that failed, one was part of the rescue that day, and one was launched on a Done
ticket. That is the close-out working as
`review-consumption.md` and `close-out-claims.md` describe it: it reads the ledger, holds on what
is undischarged, and closes once it has been fixed.

**A ruling precedes most third planning rounds, and few third review rounds.** Since 26 July the
process bounds the planning loop: a second Request Changes from plan-review escalates to the
human rather than run a third pass (LIN-1603). The second sample coded a ruling directly: a
decision by John, the operator or a coordinator answering an escalation, between the previous
leg and this one. It found one before 7 of 12 third-or-later plan and plan-review rounds, and
before 2 of 11 third-or-later review and close-out rounds. Second rounds had one in 6 of 57. The
first sample's notes, read by hand, give 14 of 18 and 1 of 8. Pooled, a ruling precedes 21 of 30
third planning rounds (70%) and 3 of 19 third review or close-out rounds (16%). The rulings are
of the kind "a human go-ahead for one more pass", "a coordinator allowed one final revision under
a hard stop", and a carve or re-order of the work. `review-loops.md` found that the window's two
longest loops ended in a human ruling. In these samples a ruling is also what starts most third
planning rounds. Third review rounds mostly run without one.

**What a repeat buys depends on its kind.** Of the 131 real repeats in the two samples:

| Kind | Changed the plan's substance or production code | Only wording or tests | Nothing |
|---|--:|--:|--:|
| Plan (34) | 24 | 6 | 4 |
| Plan-review (41) | 22 | 8 | 11 |
| Review (36) | 5 | 14 | 17 |
| Close-out (20) | 0 | 0 | 20 |
| All (131) | 51 (39%) | 28 (21%) | 52 (40%) |

The two samples agree kind by kind: plans 10 of 13 and 14 of 21, plan-reviews 11 of 22 and 11 of
19, reviews 2 of 14 and 3 of 22, close-outs 0 of 11 and 0 of 9. A repeated plan is the revision
that answers the send-back, so it nearly always changes the plan. A repeated review mostly checks
the fix. It raised something new in 28 of 36 and something real in 18, but only 5 led to a
production change. Round three and later bought substance at least as often as round two did, 22
of 49 against 32 of 95 (all 144).

**Plan-review's second round usually finds something the first missed, and it is usually real.**
37 of the 41 sampled plan-review repeats raised a finding no earlier round had (90%). 30 of those
were real (73% of the 41, 58–84%): a new defect or gap that the next revision or the
implementation fixed. Examples: an
inverted premise; a predicate that can never be reached because it compares a string with a
Date; a class wrongly excluded by a hand-drawn bound; a cancellation witness the plan claimed
but that did not exist. The rest were non-blocking notes.

**Later review rounds find real faults, but on three tickets.** `which-rules-pay-codes.json`
follows 478 review findings on 83 recent Done tickets to what each changed. By the round that
raised them, counted from the last merge of a PR naming the ticket, so that the first review of a
ticket's second PR is a first round:

| Review round | Findings | Tickets | Changed production code | Real faults | Tickets with a real fault |
|---|--:|--:|--:|--:|--:|
| First | 339 | 76 | 53 (16%) | 28 | 16 |
| Second or later | 139 | 34 | 22 (16%) | 13 | 3 |

Per finding, a later round is no emptier than the first. But LIN-2934 and LIN-2837, two of the
clusters `which-rules-pay.md` names, hold 12 of the later rounds' 13 faults, and LIN-2756 the
other. Most of LIN-2934's were bugs that its own fixes had created. A count by ticket also puts
LIN-3124's eight faults in later rounds. Seven came from the first reviews of its second and third
PRs, and the eighth from a re-review run inside a session, which is not a leg. So
the samples' picture and this one agree. The typical review repeat checks the fix and changes no
production code. The few tickets that keep failing review carry all of what later rounds catch.

**Large tickets are the likeliest to take three or more rounds, but most that do are not large.**
The number of rounds per ticket, by production lines the ticket changed:

![Rounds of plan-review and review per Done ticket, by production lines changed](figures/why-legs-repeat/convergence.svg)

| Production lines | Plan-review tickets | One round | Three or more | Review tickets | One round | Three or more |
|---|--:|--:|--:|--:|--:|--:|
| 1–49 | 32 | 10 | 3 (9%) | 130 | 110 (85%) | 5 (4%) |
| 50–299 | 77 | 19 | 9 (12%) | 196 | 103 (53%) | 30 (15%) |
| 300+ | 35 | 2 | 13 (37%) | 91 | 39 (43%) | 25 (27%) |

The table leaves out tickets with no production lines or no merge. Counting them, 20 of the 33
tickets with three or more plan-review rounds changed fewer than 300 production lines or merged
nothing (7 merged nothing), and so did 41 of the 66 with three or more review rounds. Two
plan-review rounds is the norm: 117 of 184 tickets (64%), with 34 in one and 33 in three or
more. For tickets that converged in one plan-review round the median change is 97 production lines;
for those that took three or more it is 278. For review the medians are 44 and 202. The first plan
comment is a little longer on tickets that went round more. On the 86 plan-reviewed tickets whose
comments were read, its median is 282 words for one round, 343 for two and 408 for three or
more. Tier separates little. By the writer tier in the commit trailers, frontier-written tickets averaged 1.94 plan-review rounds (36
tickets) and mid-written 2.13 (89). For review it was 1.58 against 1.62. Nearly every
implementation leg ran at mid tier, so the implementer's tier cannot be compared. Tickets touching both
repos averaged 3.0 plan-review rounds (11 tickets), and `lib` tickets 2.24 (58). Three or more
plan-review rounds rose from 10 of 95 tickets that began in August to 21 of 83 that began in
September.

**In September the repeats are 3.1 dispatches per correct change.** September's correct code
changes (140, both repos) took 5,520 dispatches counted by the log's Issue line, 39.4 each, or
4,803 charged to the session each entered, 34.3 each. That is `what-doubled-the-dispatches.md`'s
population and its two rules, re-run on the same day. 430 of them are repeat legs or follow-ups
into them under either rule: review 155, plan 121, plan-review 110, close-out 44. That is 7.8% by
the log's line and 9.0% by the session entered. Over the 1,391 fresh Claude Code sessions still
on disk, repeats hold 10% of tokens (1.7 of 17.2 billion, cache reads included) and 6% of
session-hours (75 of 1,298). A repeat costs about what a first leg of its kind costs: median
tokens and minutes are within a quarter of each other for every kind. Carrying September's sampled
reasons to the census, send-back loops account for about 2.6 of the 3.1. Against the steady-base
map, the 1.1 in review repeats sit in row 8 (review rounds after the first). About 1.9 sit in the
12.8 per correct change that `survey-check-4.md` put in no row: 15% of it.

## Method

**Population.** Every fresh session of kind plan, plan-review, review (the implementation review)
or close-out that simple-dispatcher launched from 1 August to 30 September 20:00Z, on a ticket
that is Done now, in either repo. A leg belongs to the ticket its own `Issue:` line names. Its
kind is exact where a local transcript fetched the dispatch item (778 legs), or where the
transcript's own bootstrap header `# LIN-n · kind` names it (a further 301 September legs; the
header matches the fetched kind in all 1,461 fresh sessions that have both). Transcripts begin on
29 August at 19:15Z. Otherwise the kind is decoded from the length of the bootstrap prompt's
header (1,173 legs, 1,157 of them in August). A leg is a *repeat* when an earlier fresh session of
the same kind ran on the same ticket, at any date. Follow-ups into a leg, such as stepper beats
and wakes, count as its dispatches but are not legs. The repo is the one whose `origin/main`
merges name the ticket (`survey-model-git.mjs`). The ticket list and states were paged over the
proxy on 30 September.

**Samples and coding.** The first sample is every 13th repeat by launch time, starting from the
7th: 64 of 840 in version 1's census, fixed before any ticket was read. The second is 80 other
repeats, 40 at random from each month (`survey-check-6-sample.mjs`, seed 3175). Each was read
from a digest holding the ticket's legs, its comments (headings and verdicts labelled by
`survey-rules-timeline.mjs`'s reader) and its commits in both repos by file class. The digest
also carries the repeat's own launch prompt, where the proxy still holds it (September only: 32
of 64 and 40 of 80). Two readers coded every digest against a rubric fixed before any digest was
read. Neither saw the other's codes, and reader B read in reverse order. The second sample's
readers also coded `ruling`, and did not see the first sample or this paper. Disagreements were
settled from the digests (7 and 14); each ruling and its reason is in
`why-legs-repeat-codes.json` and `survey-check-6-codes.json`. The first sample's rulings were
counted from its readers' notes, read by hand.

**Convergence.** A ticket's rounds of a gate are its fresh legs of that kind, at any date.
Size is the production lines changed over the ticket in either repo. Area and writer tier come
from `survey-model-git.mjs`, and the implementer's tier from the launch model of the first
implementation leg. Plan length is the word count of the first comment whose heading reads as a
plan. It is measured on every third census ticket by number, the tickets whose comments were
fetched.

**Findings by review round.** `which-rules-pay-codes.json` records, for each of its 483 coded
findings, the comment that raised it. The comment's time, set against the ticket's review legs
launched since the last merge of a PR naming the ticket (`origin/main` in both repos), gives the
round. All 478 review findings were dated this way; the five close-out findings are left out.

**Cost.** September's dispatches per correct change are `what-doubled-the-dispatches.md`'s, on the
same day's runner snapshot and scorecard: 140 correct code changes, 5,520 dispatches by the log's
line and 4,803 by the session entered. A dispatch is in a repeat when it is a repeat leg, or a
follow-up whose root is one. The map rows are `survey-check-4-doubling.mjs`'s bucket order.
Tokens are input, output, cache write and cache read, counting each API message once. Hours run
from a session's first transcript line to its last.

```sh
node scripts/survey-doubling-runner.mjs; node scripts/survey-doubling-transcripts.mjs
node scripts/survey-model-git.mjs --since 2026-05-01 --out data/survey-doubling/git.json
# data/survey/scorecard.json from survey-scorecard.mjs (a same-day copy was used)
node scripts/survey-repeats-fetch.mjs                 # the ticket list and states (proxy, 4.5 s a call)
node scripts/survey-repeats-census.mjs                # version 1's census and September's cost
node scripts/survey-repeats-sample.mjs --n 64         # the first sample
node scripts/survey-repeats-fetch.mjs --detail data/survey-repeats/sample.json --every 3
node scripts/survey-repeats-digests.mjs               # one reading digest per sampled repeat
node scripts/survey-repeats-codes.mjs                 # merges both readers and the adjudication
# version 2: the headers' kinds, the second sample, the rounds by PR, both charging rules
node scripts/survey-check-6.mjs --write-headers       # then the census and analysis on that copy, as survey-check-6.md shows
node scripts/survey-check-6-sample.mjs; node scripts/survey-check-6-codes.mjs; node scripts/survey-check-6.mjs
node scripts/survey-repeats-figures.mjs --in data/check6/analysis-headers.json
```

## Limits

- **August's review and close-out counts are too high.** A six-letter kind decodes as review,
  but triage, design and custom sessions share the length. A nine-letter kind decodes as
  close-out, and so do breakdown and look-into sessions. In September the headers show 17 of 146
  decoded reviews and 16 of 81 decoded close-outs were other kinds, 15 of those breakdowns;
  correcting them removed 13 repeats. August has no transcripts. At September's rates, about 13
  of August's 148 review repeats and 30 of its 58 close-out repeats are not real. By the samples'
  rates, 5 of 22 sampled August review repeats and 4 of 16 close-out repeats followed a misread
  leg, which would be about 35 and 15. So August's census overstates repeats by roughly 30 to 65
  of 413, not by half of its reviews. The reasons are unaffected, because such repeats are set
  apart.
- **A ticket's rounds run across its PRs.** The first review of a ticket's second PR counts as a
  repeat. 15 of the 827 repeats follow a merge of an earlier PR on the ticket, all in September.
- **Only fresh sessions are legs.** A revision done by resuming the plan session, or a review
  round run as a stepper beat inside one session, is not counted as a repeat. This biases the
  census down.
- **Cheap-tier sessions are missing.** Their kind cannot be read, so no cheap-tier leg is in the
  census. If cheap-tier legs repeat more, or less, than the others, the count misses it either way.
- **Done tickets only.** Tickets still open or cancelled are left out. So are the loops that never
  converged, which biases the rounds per ticket down. Since 29 August, 53 of 831 legs with a
  fetched kind are on tickets not Done, and 23 of them are repeats.
- **The readers share the author's tier and read the same digest.** Agreement shows the readers
  were consistent, not that they were right. The digest labels verdicts by a heuristic, and a
  mislabel would mislead both readers alike. This leans towards "changes requested", the reason a
  verdict label makes easiest to see. The first sample over-weights September's third and later
  rounds (17 of 32, against 35% of the census's September repeats). The second, drawn at random
  within each month, is nearer the census but not identical: third and later rounds are 15%
  against 24% in August and 42% against 35% in September.
- **What a round "bought" is judged from the digest.** A production change credited to a finding
  is the readers' reading of the commit subjects and comments, so it can err either way.
- **Tokens and hours exist for September's Claude Code sessions only.** Hours include waiting
  inside a session, and cache reads dominate the tokens. The shares compare like with like, but
  the absolute figures are not a bill.
- **Plan length is on a third of tickets**, and on only 11 that passed plan-review in one round.

## Next

- **Does a second plan-review round find what the first missed, or what the revision
  introduced?** Of 41 sampled plan-review repeats, 30 found something real and new. For each,
  read revision 1 and say whether the finding was already there to be seen, or came in with the
  change the first round asked for. The two call for different remedies, and this paper cannot
  tell them apart.
- **Why did three or more plan-review rounds rise from 11% to 25% of tickets between August and
  September**, when size and tier did not move as much? Read September's three-round tickets
  against August's for scope, plan length and the rulings that ended them.
- **What does a close-out repeat check that the review round before it has not?** All 20 sampled
  close-out repeats changed nothing. Say how often the second close-out's verification repeats the
  re-review that ran just before it.
