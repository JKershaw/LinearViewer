---
title: Does the why-legs-repeat paper hold up?
kind: check
version: 1
date: 2026-09-30
authors: [Claude (LIN-3175)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 72082c5d, kind custom, LIN-3175); effort not recorded in the dispatch item. One bounded session, with no research, plan, review or close-out legs, by the brief's design. Ten in-session subagents of the same tier blind-coded the fresh sample: reader A in five sessions of 16 digests in order, reader B in five in reverse, neither shown the paper, its codes or the other's work. This session re-ran the scripts, drew the sample, settled the readers' disagreements, recounted the kinds, charging and rounds, and wrote the check. It is not the author of the paper, which came from dispatch 185996b3."
grounded_at: 908f76d1 (LinearViewer, origin/main when the check was written, for the anchor's line numbers); 304da17c (origin/main when the paper began; its data were read at that snapshot); simple-dispatcher 3366748; runner logs, oplog and transcripts as the paper's author snapshotted them, 30 Sep 2026, cut at 20:00Z
cites:
  - "docs/papers/harbour/why-legs-repeat.md@304da17c (version 1, LIN-3174) and why-legs-repeat-codes.json; its scripts survey-repeats-census.mjs, -sample.mjs, -codes.mjs, -analyse.mjs, -figures.mjs, each re-run; -fetch.mjs and -digests.mjs re-run for the fresh sample"
  - "docs/papers/harbour/what-doubled-the-dispatches.md@304da17c:193-205 (version 2: 5,520 dispatches by the log's line, 4,803 by the session entered) and survey-check-4.md@304da17c:146-160, :203-231 (36.3 in 14–28 September by the session entered; the 12.8 in no row); scripts/survey-check-4-doubling.mjs (its bucket order)"
  - "docs/papers/harbour/which-rules-pay-codes.json@304da17c and which-rules-pay.md@304da17c:68-83 (the fault clusters)"
  - "lib/prompts/meta-prompt-template.js@908f76d1:210-213 and lib/prompts/autopilot-kickoff.js@908f76d1:469-472 (the plan-review loop bound, LIN-1603, 7f1efdb8, 26 July)"
  - "LIN-3124's, LIN-2934's, LIN-2837's and LIN-2756's comments, read over the workspace proxy 30 Sep 2026 (the paper's author's cache)"
  - "docs/steady-base.md@908f76d1 (point 18, map row 8, the reading of the map, the open questions and the evidence table)"
  - "LIN-3175's description and brief, read over the workspace proxy 2026-09-30"
  - "scripts/survey-check-6.mjs, survey-check-6-sample.mjs, survey-check-6-codes.mjs and survey-check-6-codes.json (this check)"
---

# Does the why-legs-repeat paper hold up?

Its answer holds; five of its secondary claims do not. Every committed script re-runs, and the
census, sample, codes, analysis and both figures reproduce byte for byte from the author's
snapshots. A fresh blind sample of 80 repeats, double-coded with κ 0.89 on the reason, confirms
the headline. 64 of its 71 real repeats are the next round of a send-back loop (90%, against the
paper's 57 of 60). Plan-review repeats find something real and new in 14 of 19 (paper 16 of 22).
Review repeats change production code in 3 of 22 (paper 2 of 14). Close-out repeats change
nothing in 9 of 9 (paper 11 of 11).

What does not hold:

- **The kinds.** The paper says a leg's kind is exact from 29 August. In fact 336 September legs
  were decoded by length. The transcripts' own headers give 320 of them. Seventeen "reviews" were
  custom, design or triage sessions. Sixteen "close-outs" were breakdowns, and one an autopilot,
  a class the paper's own correction does not name. With the headers, the census is 827 repeats
  of 2,252 legs, not 840 of 2,271. August cannot be read this way. It is overstated by roughly
  30–65 repeats, not by "as much as half" of its reviews. A quarter of the fresh sample's August
  close-out repeats followed a breakdown.
- **"None was a duplicate … or a rescue."** The fresh sample holds one close-out launched on a
  ticket already Done and one rescue leg. It also holds five failed launches, where the paper had
  one. All six failures were on 2 September's terminal fault.
- **Later review rounds' faults.** "20 of 21 on three tickets" counts a ticket's rounds across
  its PRs. LIN-3124 shipped in three PRs, and seven of its eight "later-round" faults came from
  the first reviews of its second and third. Counted from the last merge, later rounds hold 13
  real faults, all on three tickets: LIN-2934, LIN-2837 and LIN-2756.
- **"3+ rounds are the large tickets."** Large tickets are the likeliest to take three rounds.
  But 20 of the 33 three-round plan-review tickets and 41 of the 66 review tickets changed fewer
  than 300 production lines or merged nothing.
- **"Rounds past the second follow a ruling."** The count keyword-matched the readers' notes. It
  caught a ticket about the rulings UI. It also missed that the process has required a human
  decision after a second plan-review Request Changes since 26 July. Coded directly, a ruling
  precedes 21 of 30 third planning rounds and 3 of 19 third review or close-out rounds.

**The dispatches.** The 39.4 per correct change and `survey-check-4.md`'s 36.3 differ in two
ways. The 39.4 charges a follow-up to the Issue line the log gives it; the 36.3 charges it to
the session it entered, which is 34.3 for the same population. The 36.3 is also only 14–28
September. The repeats are the same 430 dispatches under either rule: 7.8% by the log's line and
9.0% by the session entered. About 1.9 per correct change of them sit in the 12.8 the map could
not place, 15% of it, not "about a quarter".

The paper is at version 2 in this PR, with this check's author added. Nine lines of
`docs/steady-base.md` change; they are listed below. This check does not edit the anchor.

## Findings

**Every script re-runs, and every number reproduces.** Over the author's snapshots,
`survey-repeats-census.mjs` writes legs, tickets and September's split identical to the author's
census. `-sample.mjs` draws the same 64, `-codes.mjs` merges the same codes, `-analyse.mjs`
writes an identical `analysis.json`, and `-figures.mjs` redraws both SVGs unchanged. Every figure
in version 1's text matches its analysis, with rounding.

| Figure | Version 1 | Checked | Verdict |
|---|---|---|---|
| Legs, repeats, tickets | 2,271; 840; 564 | 2,252; 827; 552 with the headers' kinds; August still overstated by ~30–65 | corrected |
| Review / close-out legs and repeats | 839 / 305; 521 / 108 | 822 / 300; 519 / 100 | corrected |
| Plan and plan-review rows; 201 to 181; August 95 to 97, September 106 to 84 | | reproduce | holds |
| Tickets with no repeat; top tenth's share | 263 of 564; 56 carry 42% | 250 of 552; 55 carry 42% | corrected |
| Median gap, close-out | 0.9 h | 0.8 h | corrected |
| Kinds exact | "from 29 August, 778 legs" | 778 fetched plus 301 by the transcript's header; 186 legs from 29 August are still decoded | corrected |
| Sent back, of real repeats | 57 of 60 | 64 of 71 in a fresh sample; 121 of 131 pooled (92%) | holds |
| Duplicates, rescues, failures | 0, 0, 1 | 1, 1, 5 in the fresh sample; all 6 failures on 2 September | corrected |
| Plan substance; plan-review real and new; review production; close-out nothing | 10/13; 16/22; 2/14; 11/11 | 14/21; 14/19; 3/22; 9/9 fresh. Pooled 24/34, 30/41, 5/36, 20/20 | holds |
| Round 3+ bought substance vs round 2 | 13/26 vs 12/38 | 9/23 vs 20/57 fresh; 22/49 vs 32/95 pooled | holds |
| Later review rounds' real faults on three tickets | 20 of 21 (LIN-3124, -2934, -2837) | 13 of 13 (LIN-2934, -2837, -2756), rounds counted per PR | corrected |
| Findings by round, first / later; production share | 309 / 169; 14% / 20% | 339 / 139; 16% / 16% | corrected |
| Repeats per correct change, September | 3.1 of 39.4 (7.8%) | 3.1 of 39.4 by the log's line (7.8%); 3.1 of 34.3 by the session entered (9.0%) | corrected |
| Share of tokens and session-hours | 10%; 6% (78 h) | 10%; 6% (75 h) | holds |
| Send-back loops' part of the 3.1 | 2.75 | about 2.6 on September's pooled sample | corrected |
| Repeats' part of the 12.8 in no map row | "about a quarter" | 1.9 (15%); the 1.1 in review repeats is row 8's | corrected |
| 3+ rounds by size | "the large ones" | likelier on large tickets; 20 of 33 (plan-review) and 41 of 66 (review) are under 300 lines or unmerged | corrected |
| Review rounds by size (300+) | 99 tickets, 46 one-round, 25 three-plus | 91, 39, 25 | corrected |
| Rounds past the second follow a ruling | 17 of 26 (65%), by keyword | planning 21 of 30, review and close-out 3 of 19, pooled; the loop bound requires the first | corrected |
| Plan-review 3+ rose 10/95 → 21/83; tier 1.94 / 2.13 | | reproduce | holds |

**The kinds: exact where a transcript says so, and a class the paper missed.** The census takes a
leg's kind from the dispatch item a transcript fetched, otherwise from the length of the
bootstrap header. From 29 August only 778 of 1,284 legs have a fetched kind. But every
transcript opens with the header `# LIN-n · kind` itself. In the 1,461 fresh sessions that have
both, the header and the fetched kind agree every time. For the 320 decoded September legs with a
transcript, the header gives:

| Decoded as | Header: same | Header: other kind |
|---|--:|--:|
| Review (146) | 129 | 14 custom, 2 design, 1 triage |
| Close-out (81) | 65 | 15 breakdown, 1 autopilot |
| Plan-review (93) | 93 | — |

`breakdown` and `look-into` have nine letters, like `close-out`, and a breakdown usually runs
on a parent before its children and its own close-out. So a parent's real close-out becomes a
"repeat". The census on the headers' kinds loses 13 repeats and 12 tickets. Five of the repeats
are reviews and eight close-outs, all in September. The paper's Limits line says "all ten
September review repeats, whose kinds are exact, were real". Four of the ten were decoded, but
the prompts the proxy holds confirm all ten as reviews, so the sentence's substance stands.

**August is overstated, but not by half.** August has no transcripts, and the proxy no longer
holds August's prompts (none of the 52 asked for). Two estimates bound it:
- *At September's rates.* 17 of 146 decoded reviews and 16 of 81 decoded close-outs were misread.
  Of those, 5 and 11 sat on a ticket with another leg of the kind, so they made a repeat. Carried
  to the 372 and 232 legs decoded as such before 29 August, that is about 13 review and 30
  close-out repeats.
- *At the samples' rates.* 5 of 22 August review repeats in the two samples followed a triage or
  design session read as review. 4 of 16 August close-out repeats followed a breakdown. That is
  about 35 and 15.

Either way, August's 413 repeats hold roughly 30–65 that are not. The paper's "possibly by as
much as half of August's 148" rests on 4 of 8. One of those 4 was a next-phase review, not a
misread kind. A structural flag, a review launched before the ticket's first implementation leg,
is no substitute. In September it catches 15 of the 17 misread reviews but flags 61 real ones.
The paper's own analysis has 95 such review repeats, 60 of them in September.

**The fresh sample confirms the reasons and the purchases, with a longer tail.** 80 repeats not
in the paper's 64 were drawn at random, 40 in each month (seed 3175). The paper's digest
script built their digests unchanged. Two readers coded them against the paper's rubric,
unchanged, plus one field, `ruling`. They agreed on the reason for 77 of 80 (κ 0.89), on what
the round bought for 77 (κ 0.94), on a new finding for 40 of 44 gate repeats (κ 0.73) and on
the ruling for 77 of 80 (κ 0.89). This session settled the 14 fields in dispute from the
digests; each ruling is in `survey-check-6-codes.json`.

| Why the repeat ran | August (40) | September (40) |
|---|--:|--:|
| A verdict asked for changes | 32 | 32 |
| The previous session failed | 0 | 5 |
| Rescue; mistaken launch on a Done ticket | 0; 1 | 1; 0 |
| Not a real repeat: the earlier leg was a breakdown, triage or design session read as the same kind; a retrospective sweep; a breakdown run as a close-out | 7 | 2 |

The tail is not the paper's "none". One close-out was launched on a ticket already Done and ran
as a verification pass (LIN-1775). One autopilot, logged as a close-out, was part of an
operator-ordered rescue (LIN-971). Five legs, four plans and a close-out, ran again because the
previous session had failed. All five fell on 2 September, when resumes failed on the terminal
substrate. The paper's one failed launch
is from the same morning. No stale re-grounding, added scope or red CI appears in either sample.
What each kind bought agrees with the paper within sampling error:

| Kind | Paper, real repeats | Fresh, real repeats | Pooled |
|---|---|---|---|
| Plan: changed the plan's substance | 10 of 13 | 14 of 21 | 24 of 34 (71%) |
| Plan-review: a new finding; a real one | 20, 16 of 22 | 17, 14 of 19 | 37, 30 of 41 (73%) |
| Review: a new finding; real; production changed | 10, 7, 2 of 14 | 18, 11, 3 of 22 | 28, 18, 5 of 36 (14%) |
| Close-out: changed nothing | 11 of 11 | 9 of 9 | 20 of 20 |

**Is the sample representative of both months?** The census's repeats are 413 in August and
414 in September, alike by kind. September has more third-and-later rounds: 35% against 24%. The
paper's systematic sample over-weights September's third rounds (17 of 32) and August's
plan-reviews (12 of 32, against 23%). The random sample is nearer on both. The two months differ
in the tail, not in the main answer. In August, misread kinds make 7 of 40 sampled "repeats" not
real, against 2 of 40 in September. September carries 2 September's failures. Send-back rounds
are 60 of 61 real August repeats in the two samples, and 61 of 70 in September.

**Later review rounds: counted per PR, the faults move, and the claim narrows.** The paper dates
each of `which-rules-pay-codes.json`'s 478 review findings by the review legs launched on the
ticket before its comment. LIN-3124 went through three PRs on 29 September, each reviewed
afresh. Its PR2 review (09:06Z) and PR3 review (13:44Z) are its second and third review legs.
Seven of its eight real faults came from them. Counting a round from the last merge of a PR
naming the ticket, the later rounds hold 139 findings, 22 production changes and 13 real faults.
LIN-2934 has 8, all on one PR, many of them bugs its own fixes created. LIN-2837 has 4, from the
re-review of 14 September. LIN-2756 has 1. The first rounds hold 339 findings, 53 production
changes and 28 real faults on 16 tickets. Per finding, later rounds still change production code
as often as first ones (16% each). The paper's conclusion, that the tickets which keep failing
review carry what later rounds catch, holds more strongly. Across the census, 15 repeats follow a
merge of an earlier PR on the ticket: 8 reviews, 6 close-outs and a plan-review, all in September.

**The dispatch counts: two charging rules, two windows.**

| Figure | Population | Charging rule | Dispatches per correct change | Repeats |
|---|---|---|--:|--:|
| `why-legs-repeat` v1 | code changes merged 31 Aug–27 Sep, 140 correct | the log's Issue line (a wake from 13 September names the child that woke it) | 39.4 | 3.1 (7.8%) |
| `what-doubled-the-dispatches` v2, :193-195 | the same | the log's line / the session entered | 39.4 / 34.3 | — |
| `survey-check-4`, :160 | 14–28 September merges, 66 correct | the session entered / the log's line | 36.3 / 47.1 | — |
| This check | the paper's population | the session entered | 34.3 | 3.1 (9.0%) |

The 39.4 reproduces exactly. It is `what-doubled-the-dispatches.md`'s second column, the log's
naming. `survey-check-4.md` set the session-entered rule as the one comparable across periods.
The paper's 7.8% takes the rule that gives September its larger denominator. A repeat leg's
dispatches are its launch and the follow-ups rooted in it, so the rule moves none of them: 430
either way on the headers' kinds, 432 on the paper's. Under
`survey-check-4-doubling.mjs`'s bucket order, 155 of the 430 fall in row 8, the review rounds
after the first. Four fall in supervision that acted. About 262 fall in the three rows-less
buckets: first-round legs, kind unread, other stepper beats. That is 1.9 per correct change of
the 12.8 no row explains, or 15%. The paper's "about a quarter" set all 3.1 against the 12.8.

**Convergence: large tickets are likelier to loop, but most loops are not on large tickets.**
The paper's table is right, and on the headers' kinds only the review column's 300+ row moves: 91
tickets, 39 in one round, 25 in three or more. The table leaves out the 0-line and unmerged bands.
Of the 33 tickets with three or more plan-review rounds, 13 changed 300 lines or more, 9 changed
50–299, 3 changed 1–49, 1 changed none and 7 merged nothing. Of 66 with three or more review
rounds, 25 changed 300 or more. The medians (278 against 97 lines for plan-review, 202 against 44
for review) are right, and so is the rise in the three-plus share with size. "Tickets that go
round three or more times are the large ones" is not.

**Rulings: the bound explains the planning rounds, and review rounds mostly have none.** The
paper counted a ruling when either reader's note matched *John, human, operator, ruling, ruled*
or *coordinator*. Read by hand, one of its 17 matches is a ticket about the rulings UI (LIN-2444)
with no ruling before the round. Another is a failed relaunch under a gate-closing ruling that
did not start it (LIN-2437). The claim also misses a mechanism. Since LIN-1603 (26 July) the
planning prompt has said: after a *second* Request Changes from plan-review, stop and escalate to
the human; do not run a third plan-review (`meta-prompt-template.js:210-213`,
`autopilot-kickoff.js:469-472`). So a third planning round is expected to follow a decision. The
fresh sample coded the ruling as its own field:

| Round | Fresh sample, ruling before it | Paper's sample, notes read by hand | Pooled |
|---|--:|--:|--:|
| Second | 6 of 57 | 1 of 38 | 7 of 95 (7%) |
| Third or later, plan and plan-review | 7 of 12 | 14 of 18 | 21 of 30 (70%) |
| Third or later, review and close-out | 2 of 11 | 1 of 8 | 3 of 19 (16%) |

Most third planning rounds follow a ruling. Most third review rounds do not, and in two sampled
cases the autopilot continued past the bound on its own call (LIN-2274, LIN-2754).

**Smaller points.**
- The census's September cost numbers rounds over every ticket's legs, Done or not, while the
  census itself is Done tickets only. 56 of its 432 dispatches are in repeat legs on tickets that
  are not Done. The check's recount matches the 432 only when it numbers rounds the same way.
- 11 repeats launched within ten minutes of the previous leg of their kind, and 12 September
  repeats while the previous leg's transcript was still open (3% of 398). Three were in the fresh
  sample: one re-ran a wedged session and two were ordinary send-back rounds. They bound how many
  launches overlapped; they are not shown to be duplicates.
- Done-only: from 29 August, 53 of 831 legs with a fetched kind are on tickets not Done, 23 of
  them repeats. September's rates are biased down slightly, not up.
- The paper's own analysis flags 95 review repeats whose earlier reviews all ran before the
  ticket's first implementation leg, 60 of them in September. Its Limits line says the
  overstatement is "mostly in August" without using that flag. The headers show the flag is a
  poor test: most of the flagged reviews are real, often of work implemented inside a stepper.

### The lines of `docs/steady-base.md` that change

The lines are at `908f76d1`. This check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | "…`survey-check-5.md` checked `wake-inventory.md` and `browser-flakes.md`; each is now at version 2. `why-legs-repeat.md` is the one paper cited here not yet checked." | …each is now at version 2, and `survey-check-6.md` checked `why-legs-repeat.md`, now at version 2 |
| 96 | "*(`why-legs-repeat.md`, unchecked)*" | *(`why-legs-repeat.md` v2)*. The heading stands |
| 97 | "840 of the 2,271 … legs on Done tickets since 1 August are repeats. In a blind-coded sample (two readers, full agreement), 57 of the 60 real repeats are the next round of a send-back loop; none was a duplicate, a stale re-grounding, added scope or red CI." | 827 of the 2,252 … are repeats, a few dozen fewer in fact (August's kinds are partly misread). In two blind-coded samples (144 repeats, two readers each, κ 0.89–1.00 on the reason), 121 of the 131 real repeats are the next round of a send-back loop; six re-ran a failed session, all on 2 September, one was a mistaken launch and one a rescue; none followed a stale grounding, added scope or red CI |
| 98 | "A repeated plan changes the plan's substance (10 of 13), and a repeated plan-review finds something real and new (16 of 22). A repeated code review mostly checks the fix (production code changed in 2 of 14), and later rounds' real faults sit almost all on three tickets (20 of 21). **A repeated close-out changed nothing (11 of 11).**" | …(24 of 34) … (30 of 41) … (production code changed in 5 of 36), and later rounds' real faults, counted per PR, all sit on three tickets (13 of 13). **A repeated close-out changed nothing (20 of 20).** |
| 99 | "In September the repeats are 3.1 of 39.4 dispatches per correct change (7.8%), 10% of tokens and 6% of session-hours. Tickets taking three or more rounds are the large ones, and most rounds past the second follow a ruling." | In September the repeats are 3.1 dispatches per correct change: 7.8% of 39.4 by the log's line, 9.0% of 34.3 by the session entered; 10% of tokens and 6% of session-hours. Large tickets are the likeliest to take three or more rounds, though most tickets that do are smaller. A ruling precedes 70% of third planning rounds, as the loop bound requires, and 16% of third review rounds |
| 149 | Row 8: "Repeated close-outs changed nothing in 11 of 11; repeated code reviews changed production code in 2 of 14 (`why-legs-repeat`)" | …in 20 of 20; …in 5 of 36 (`why-legs-repeat` v2) |
| 159 | "Repeat legs are only 7.8% of dispatches per change (`why-legs-repeat`)…" | Repeat legs are 8–9% of dispatches per change, by how a follow-up is charged (`why-legs-repeat` v2)… The rest of the line stands |
| 169 | "Repeat legs explain under a quarter of it (`why-legs-repeat`); first-round legs and stepper beats inside sessions are the bulk." | Repeat legs explain about 15% of it, 1.9 of 12.8 per correct change; their other 1.1 is in row 8 (`survey-check-6.md`). First-round legs and stepper beats inside sessions are the bulk |
| 171 | "**Every paper cited here has been checked by a second document except `why-legs-repeat.md`.**…" | Every paper cited here has been checked by a second document; `survey-check-6.md` checked the last, `why-legs-repeat.md` |
| 198 | "(unchecked)" on the `why-legs-repeat` row | (v2), and a row for `survey-check-6`: the independent check of the paper above, and every figure it changed |

Unchanged and confirmed:
- Line 79's "a fifth of them repeats; repeat plan-reviews outnumber first ones" is
  `survey-check-4.md`'s count of the legs in no row, 215 of 979. This check does not move it.
- Line 159's "most repeat plans and plan-reviews earn their keep; repeated close-outs are the
  clear exception", and line 165's question on repeat plan-reviews, stand on the pooled sample.
- Row 8's own lever and its `which-rules-pay` and `fleet-complexity-read` evidence are not this
  paper's and are not re-tested.

## Method

The paper's committed scripts were re-run unchanged in this branch, over copies of its author's
snapshots from the session workspace that made them. The kinds were then recounted from the
transcripts' headers, and the census and analysis re-run on that copy with only the input path
changed.

```sh
# the author's data/survey-doubling, data/survey and data/survey-repeats copied in
node scripts/survey-repeats-census.mjs --out data/check6/census-rerun.json          # diff: identical
node scripts/survey-repeats-sample.mjs --out data/check6/sample-rerun.json          # the same 64
node scripts/survey-repeats-codes.mjs --out data/check6/codes-rerun.json            # identical
node scripts/survey-repeats-analyse.mjs --out data/check6/analysis-rerun.json       # identical
node scripts/survey-repeats-figures.mjs --in data/check6/analysis-rerun.json --out <scratch>   # both SVGs identical
# the headers' kinds
node scripts/survey-check-6.mjs --write-headers                                      # data/check6/transcripts-headers.json
sed "s#data/survey-doubling/transcripts.json#data/check6/transcripts-headers.json#" scripts/survey-repeats-census.mjs > data/check6/census-headers.mjs
node data/check6/census-headers.mjs --out data/check6/census-headers.json
sed "s#data/survey-repeats/census.json#data/check6/census-headers.json#; s#'./survey-rules-timeline.mjs'#'../../scripts/survey-rules-timeline.mjs'#" scripts/survey-repeats-analyse.mjs > data/check6/analyse-headers.mjs
node data/check6/analyse-headers.mjs --out data/check6/analysis-headers.json         # version 2's figures
node scripts/survey-repeats-figures.mjs --in data/check6/analysis-headers.json       # version 2's figures, redrawn
node scripts/survey-check-6.mjs                                                      # decoding, August, charging, rounds by PR, convergence, Done-only
# the fresh sample
node scripts/survey-check-6-sample.mjs                                               # 80, seed 3175
node scripts/survey-repeats-fetch.mjs --cache data/check6/proxy.json --detail data/check6/sample.json
node scripts/survey-repeats-digests.mjs --sample data/check6/sample.json --proxy data/check6/proxy.json --dir data/check6/digests
node scripts/survey-check-6-codes.mjs                                                # after both readers and the adjudication
# the map cross-tab: survey-check-4-doubling.mjs with a tail that reads data/check6/repeat-items.json, --rule paper and --rule root
```

- **Blind sample.** This session drew it and kept the key. Each reader saw the rubric, a brief
  adding the `ruling` field, and 16 digests. The readers did not see the paper, its codes, the
  other reader or any other file. Reader B read each batch in reverse. The 14 disputed fields
  were settled from the digests with both codes in view.
- **Rounds by PR.** Merges are `origin/main` merge commits in both repos whose subject or body
  names the ticket, read by `survey-rules-timeline.mjs`'s `gitCommits`. LIN-3124, LIN-2934,
  LIN-2837 and LIN-2756 were read comment by comment from the author's cache.
- **Rulings.** The paper's 26 third-or-later notes were read by hand. The prompt lines were read
  at `908f76d1`, and their date is from `git log -S`.
- **Proxy.** Reads of the brief, the ticket, 30 tickets' comments and 80 launch prompts, paced
  under the shared limit. August's prompts returned nothing, and the fetch was cut to September
  after the first 20. The only writes are this ticket's comment and status.

## Limits

- **Every reader shares a tier with the author.** The re-runs, readings and blind codes are
  independent of the author's session, not of its model tier. Both samples' readers read the
  same kind of digest, built by the same script, so a heuristic mislabel would mislead both.
- **August's overstatement is an estimate.** It rests on September's misread rates or on 38
  sampled August repeats. The two bounds, about 30 and 65, differ by twice. *Bias:* unknown in
  direction; neither estimate can see a misread first leg on a ticket that has no second.
- **The ruling field is a judgement.** A decision the digest does not show counts as none. An
  autopilot continuing on its own call was coded as no ruling. A reader counting it would raise
  the review share a little.
- **Rounds by PR use merge commits.** A PR closed without merging, or a second PR opened before
  the first merged, still runs its rounds together.
- **The map cross-tab takes `survey-check-4-doubling.mjs`'s bucket order.** Another order moves
  dispatches among rows 1–3, none of which hold repeats.
- **The anchor may move.** The table lists lines at `908f76d1`. A later edit shifts them.

## Next

- **Which Harbour leg kinds share a name length, and what else has the length decode misread?**
  Breakdowns read as close-outs, and custom, design and triage sessions as reviews. List every
  kind name the dispatcher has sent since June with its length, and set each decoded leg in
  earlier papers' censuses (`what-doubled-the-dispatches.md`, `survey-check-4.md`) against the
  kinds that share it. Report which published counts move. This goes into `proposals.md`.
- **Why do third review rounds run without a ruling?** The planning loop has a bound that
  escalates; review's third rounds mostly ran without a decision (3 of 19). Read the prompts'
  review routing and the 16 sampled third review rounds without a ruling, and say what let each
  run.
- The paper's own Next stands, with its figures as corrected in version 2.
