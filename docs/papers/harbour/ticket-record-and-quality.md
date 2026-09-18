---
title: Could the way tickets are written and updated be simplified without losing output quality?
version: 1
date: 2026-09-18
authors: [Claude, John Kershaw]
model: claude-fable-5-1, Claude Code on the web, effort default; an interactive session over the read-scope proxy rather than a dispatch, so no lineage record exists; the later-bug hand-read is the author's own
grounded_at: bf718323 (LinearViewer)
cites: [lib/prompt-template-defs.js@bf718323:188, lib/prompt-template-defs.js@bf718323:311, lib/prompt-template-defs.js@bf718323:577, lib/prompt-template-defs.js@bf718323:893, lib/prompt-template-defs.js@bf718323:924, lib/prompt-template-defs.js@bf718323:1061-1074, lib/prompt-template-defs.js@bf718323:1187-1196, docs/papers/harbour/review-loops.md (v2, 2026-09-12), docs/papers/harbour/cheap-implementer.md (v6, 2026-09-14), docs/papers/harbour/plain-language.md (v1, 2026-09-13), docs/papers/harbour/writing-length.md (v2, 2026-09-12), docs/papers/harbour/never-worked-pile.md (v1, 2026-09-12), LIN-2516 (implementation review comment 08261320, 2026-09-04), LIN-2551 and LIN-2553 (descriptions, 2026-09-05), LIN-2611 and LIN-2705 (descriptions), LIN-2787 (description, 2026-09-11), LIN-2487 (close-out comment, 2026-09-05), LIN-2896 (snapshots, 2026-09-18), PR #1151 to PR #1500 (landings on main, 2026-08-19 to 2026-09-18)]
---

# Could the way tickets are written and updated be simplified without losing output quality?

Yes, most of it could. Across the 184 tickets filed between 31 August and 18 September 2026
that reached Done, the size of the record written about a ticket has no measurable relation to
whether its work passes review or holds up afterwards. Split the trail written before the
review into thirds, and the first-pass approval rate is 66%, 68% and 64%, while the median
cost goes from $13 to $79. Lane tickets, closed with two comments of about 560 words between
them, show the same rate of later-found defects as gated tickets carrying seven to sixteen
thousand words. What the reviewer measurably uses is the problem statement, the acceptance
criteria and the file anchors. Keep those, and the ticket can lose the plan it embeds and
prunes, the eleven per cent of words in which the machinery narrates itself, and probably the
plan-review gate.

## Findings

**A Done ticket carries about 6,400 words of record and 7 words per changed line.** The 184
Done tickets hold 1.53 million words: a median 643 words of description at HEAD and 5,775
words across a median 7 comments. Joined to their pull requests, that is 7.2 words of record
per line changed; 11.6 for a plan-gated ticket, 9.6 for a review-gated one, 2.2 for a lane
ticket. The description is rewritten a median 4 times before close-out (plan-gated 8, one
ticket 17) and peaks at 1,880 words before the prune brings it back to 775; a plan-gated
description peaks at 5,816. The close-out template's prune (`lib/prompt-template-defs.js:1194`)
has run on 26% of Done tickets; 30% still carry an `Implementation Plan` at HEAD.

**What is written before the review does not predict the review.** Of 111 Done tickets with a
review verdict, 38 were sent back first time. No feature of the writing moves that rate; the
one gradient is the size of the change.

| Split of the 111 reviewed tickets | n | sent back first time | median cost |
|---|---|---|---|
| Comments before the first review: light ≤1,645 words | 38 | 34% | $13 |
| middle | 37 | 32% | $41 |
| heavy >5,004 words | 36 | 36% | $79 |
| Peak description ≤1,018 words / middle / >3,789 | 38 / 37 / 36 | 37% / 41% / 25% | $13 / $43 / $75 |
| Problem statement ≤455 words / middle / >670 | 38 / 37 / 36 | 32% / 49% / 22% | $35 / $47 / $45 |
| Acceptance section present / absent | 78 / 33 | 37% / 27% | $47 / $37 |
| Research leg ran / did not | 36 / 75 | 31% / 36% | $48 / $37 |
| Plan-review gate passed through / not | 31 / 80 | 32% / 35% | $89 / $34 |
| PR ≤400 lines / >400 lines | 19 / 62 | 21% / 44% | $18 / $59 |

Even the size gradient fades inside one pipeline shape: among review-gated tickets alone,
those with medium PRs were sent back 6 times in 17 and those with large PRs 14 times in 39.
Who filed the ticket matters more than how much was written: tickets routed from a review or
close-out were sent back 22% of the time at a median $13, tickets with no stated origin 47%
at $49, consistent with `cheap-implementer.md`'s finding on bake-off tickets.

**The plan gate costs the most and changes the least.** 32 of 36 first plans were sent back,
the same 89% `review-loops.md` measured a week earlier; each plan-review verdict runs 1,821
words and the gate is 11% of all words written. Plan-gated tickets needed 1.2 human rulings
each against 0.3 for review-gated ones, cost $89 against $34, and their implementations were
then sent back at the same rate as everyone else's, 32% against 35%; on large PRs, 50% against
36%. One number runs the other way: plan-gated tickets show 1 later-found miss in 36 against 8
in 80 review-gated, which this method cannot separate from the gate selecting larger, later,
more-watched tickets.

**A lane gets the same quality on a fifth of the words.** 37 Done tickets were worked inside a
multi-ticket lane: a claim comment and a close-out, 563 words median, no lineage of their own,
PRs of 292 lines that all touch tests. A review still happens: every one of the 37 close-outs
describes one, 23 record an Approve, but it is a paragraph inside the close-out, not a
1,700-word verdict comment (LIN-2487's close-out is typical). Later-found misses: 3 of 37 lane
tickets against 8 of 80 review-gated. All three lane misses (LIN-2522, LIN-2523, LIN-2527) were
caught by the parent's implementation review (LIN-2516 comment `08261320`) and filed as
LIN-2551 and LIN-2553, so the lane's gate is the parent's review, not none. Lanes select small
work: 25 of the 37 are breakdown children.

**The reviewer reads the problem, the acceptance and the anchors.** Where the description has
an acceptance section, 81% of reviews cite it; where it has none, 39% find something to call
acceptance. 109 of 111 reviewed descriptions carry file anchors and 99% of those files are named
again by the implementation or the review. These are exactly the parts the prune is told never
to remove (`lib/prompt-template-defs.js:1195`). The description's written core is load-bearing.
What swells it, and is then pruned, is the plan and research written into it by the templates
(`:188`, `:577`).

**Eleven per cent of the words are the machinery narrating itself, and none of it repeats.**
Autopilot and runner comments (run summaries, verb-override notes, cross-checks, voyage logs)
are 345 of 1,557 comments and 142,000 words. 128 beat-completion comments carry another
135,000 words, though those are a stepped run's stage output delivered in instalments rather
than narration about it. 32% of all comments open by stating the commit they re-grounded at. The record
is not padded by copying: for every kind of comment, at least 91% of its six-word sequences
appear nowhere earlier on the ticket. The length is new prose each time, so simplifying it
means dropping kinds of comment, not de-duplicating them.

**Quality, by rubric.** The sub-question was what the output quality is, by several rubrics.

| Rubric | Reading |
|---|---|
| Tickets filed in the cohort that reached Done | 184 of 471 (39%); 283 open, 246 never touched |
| First implementation review: Approve | 73 of 111 (66%); rounds mean 1.7, max 4 |
| First plan review: Approve | 4 of 36 (11%); rounds mean 2.1 |
| Human rulings and notes needed | 85, on 51 of 184 Done tickets |
| Follow-ups filed per Done ticket | 2.2 (403 in all) |
| Median cost, review-gated / plan-gated | $34 / $89; 1.3 / 2.5 session-hours |
| PR landings on main, 30 days | 318; median 316 lines in 4 files; 86% touch tests; 0 reverts |
| Cost per changed line (priced, joined) | $0.03 |
| Later-found misses against Done tickets | 13 of 184 (7%): 9 defects, 2 shipped inert, 2 false close-out claims |

The 13 misses are the sharpest quality reading here. Two are work that shipped and never took
effect: LIN-2515's login-expired detector sat behind a driver whose capture returned null
(LIN-2611), and LIN-2631's per-turn cost accumulation summed one contributor, a production
no-op (LIN-2705). Two are close-outs recording a false claim about the label catalogue
(LIN-2773 and LIN-2775, found by LIN-2787). Nine of the 13 had passed an implementation review;
four of those had been round three times. Review rounds did not prevent the misses, and the
miss with the largest record behind it, LIN-2641, carried 34,000 words.

## Method

Population: every ticket LIN-2440 to LIN-2910, filed 31 August to 18 September 2026, read at
read scope through the workspace API proxy on 18 September: `GET /api/proxy/issues/LIN-n` for
description, state, dates, labels, parent and comments; `/cost` for the dispatch lineage (kind,
model, effort, cost, duration per session); `/snapshots` for every archived version of the
description. Trashed issues excluded. Pull requests: every first-parent commit on `origin/main`
since 2026-08-19 whose subject is a merge or a squash of `#n`, with `git diff --numstat` for
size and files; a ticket joins its PRs by the LinearViewer PR URLs and `PR #n` mentions in its
record (simple-dispatcher PRs noted but not sized).

Pipeline shape, per Done ticket: **plan-gated** if any comment is a plan-review verdict;
**review-gated** if any is a review verdict; **lane** if a lane-claim comment or a close-out
with no lineage; **direct** if worked sessions but no verdict; **by-hand** otherwise. Comment
kind is assigned from the first line by ordered rules (review, plan, autopilot, runner, human,
lane-claim, close-out, plan-review, implementation, research, and so on), with body markers
(`### Plan Review Verdict`, `What CI Did Not Prove`, a PR link) as fallback. A verdict is
`Request Changes`, `Needs Discussion` or `Approve` in a review or plan-review comment. The trail
before the first review verdict is the predictor; the verdict is the outcome. The description
splits at the first stage heading (Implementation Plan, Research, Shipped, Scope Assessment,
Strategy Framing, Session fit) into a problem part and stage artifacts. Novelty is the share of a
comment's six-word sequences absent from the description and every earlier comment.

Later-found misses: every Bug ticket in the cohort created after a Done ticket completed whose
description names that ticket or its PR, 45 pairs, each hand-read against a rubric written
before reading: **defect** if the bug's text says the Done ticket's change introduced, exposed
or left unhandled the fault; **inert** if the shipped change did not take effect; **record** if
the close-out recorded a false claim; **context** if named as precedent, timeline or example.
32 were context. The rubric and every verdict are in the session's `later-bugs-hand.json`.

```sh
B=https://harbour.cat/api/proxy   # sleep 1.05 between calls; 60/min cap
for n in $(seq 2440 2910); do curl -s -H "Authorization: Bearer $T" $B/issues/LIN-$n; done
# for each Done or Canceled ticket:   $B/issues/LIN-$n/cost     $B/issues/LIN-$n/snapshots
git log origin/main --first-parent --since=2026-08-19 --format='%H|%s' \
  | grep -E 'Merge pull request #[0-9]+|\(#[0-9]+\)$' \
  | while IFS='|' read h s; do git diff --numstat $h^1 $h; done
```

## Limits

The cohort is 18 days of filings, so a ticket closed late in the window has had little time to
be blamed by a later bug: the 7% miss rate is a floor, and the shapes closed latest, which are
the gated ones, are the most under-counted. A miss is only visible if someone filed a Bug and
named the ticket; a defect fixed quietly, or blamed on nothing, is not here. Lane tickets are
small by selection, so their equal miss rate is on easier work. The comparison of shapes is
observational: the gate is applied to bigger tickets, and this method cannot say what those
tickets would have done without it. The classifier reads first lines; 92 comments (5% of
words) stayed unclassified, and a review whose heading names its implementation may have been
read as one. Cost is the worker sessions the lineage prices; a lane ticket's cost sits on its
lane's anchor and reads as zero here. The hand-read of 45 pairs was one author's, against the
standard's rule that a paper is checked by a second paper. Nothing here says whether the words
are worth it to a human reader; only that the machine's verdicts and the later bugs do not
respond to them.

## Next

Run the controlled version: dispatch the same twenty small tickets once through a lane and
once through the review-gated pipeline, and count later-found misses at thirty days. Drop the
autopilot and runner narration and the beat-completion comments for a fortnight and re-run
this method: if first-pass approval and the miss rate hold, the eleven per cent is free. Read
ten 1,700-word reviews against their close-outs and mark which sentences the close-out actually
consumed. Follow the 46 Done tickets with no snapshot: was the description never rewritten, or
did the archive miss them?
