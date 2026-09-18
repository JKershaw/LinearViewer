---
title: Could the way tickets are written and updated be simplified without losing output quality?
version: 2
date: 2026-09-18
authors: [Claude, John Kershaw]
model: claude-fable-5-1, Claude Code on the web, effort default; an interactive session over the read-scope proxy rather than a dispatch, so no lineage record exists; version 2 rewritten by hand the same day after `what-the-reviews-checked.md` checked the miss list and a classifier fault was found
grounded_at: bf718323 (LinearViewer)
cites: [lib/prompt-template-defs.js@bf718323:188, lib/prompt-template-defs.js@bf718323:311, lib/prompt-template-defs.js@bf718323:577, lib/prompt-template-defs.js@bf718323:893, lib/prompt-template-defs.js@bf718323:924, lib/prompt-template-defs.js@bf718323:1061-1074, lib/prompt-template-defs.js@bf718323:1187-1196, docs/papers/harbour/what-the-reviews-checked.md (v1, 2026-09-18, PR #1501), docs/papers/harbour/review-loops.md (v2, 2026-09-12), docs/papers/harbour/cheap-implementer.md (v6, 2026-09-14), docs/papers/harbour/plain-language.md (v1, 2026-09-13), docs/papers/harbour/writing-length.md (v2, 2026-09-12), docs/papers/harbour/never-worked-pile.md (v1, 2026-09-12), LIN-2516 (implementation review comment 08261320, 2026-09-04), LIN-2551 and LIN-2553 (descriptions, 2026-09-05), LIN-2611 (description), LIN-2631 (close-out comment 426683fb, 2026-09-05), LIN-2787 (description, 2026-09-11), LIN-2487 (close-out comment, 2026-09-05), LIN-2896 (snapshots, 2026-09-18), PR #1151 to PR #1500 (landings on main, 2026-08-19 to 2026-09-18)]
---

# Could the way tickets are written and updated be simplified without losing output quality?

Yes, most of it could. Across the 184 tickets filed between 31 August and 18 September 2026
that reached Done, the size of the record written about a ticket has no measurable relation to
whether its work passes review or holds up afterwards. Split the trail written before the
review into thirds, and the first-pass approval rate is 66%, 68% and 64%, while the median
cost goes from $13 to $79. Lane tickets, closed with two comments of about 560 words between
them, shipped no defect that the pipeline's own review did not catch, against seven genuine
later-found misses among the 121 gated tickets carrying seven to fourteen thousand words. What
the reviewer measurably uses is the problem statement, the acceptance criteria and the file
anchors. Keep those, and the ticket can lose the plan it embeds and prunes, the tenth of its
words in which the machinery narrates itself, and probably the plan-review gate.

## Findings

**A Done ticket carries about 6,400 words of record and 7 words per changed line.** The 184
Done tickets hold 1.53 million words: a median 643 words of description at HEAD and 5,775
words across a median 7 comments. Joined to their pull requests, that is 7.2 words of record
per line changed; 9.5 for a plan-gated ticket, 9.7 for a review-gated one, 2.4 for a lane
ticket. The description is rewritten a median 4 times before close-out (plan-gated 8, one
ticket 17) and peaks at 1,880 words before the prune brings it back to 775; a plan-gated
description peaks at 5,322. The close-out template's prune (`lib/prompt-template-defs.js:1194`)
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
| Plan-review gate passed through / not | 36 / 75 | 33% / 35% | $80 / $31 |
| PR ≤400 lines / >400 lines | 19 / 62 | 21% / 44% | $18 / $59 |

Even the size gradient fades inside one pipeline shape: among review-gated tickets alone,
those with medium PRs were sent back 6 times in 16 and those with large PRs 12 times in 35.
Who filed the ticket matters more than how much was written: tickets routed from a review or
close-out were sent back 22% of the time at a median $13, tickets with no stated origin 47%
at $49, consistent with `cheap-implementer.md`'s finding on bake-off tickets.

**The plan gate costs the most and changes the least.** 42 of 46 first plans were sent back,
the same nine in ten `review-loops.md` measured a week earlier; each plan-review verdict runs
1,759 words and the gate is 13% of all words written. Plan-gated tickets needed 1.0 human
rulings each against 0.3 for review-gated ones, cost $80 against $31 among tickets that reached
a review, and their implementations were then sent back at the same rate as everyone else's,
33% against 35%; on large PRs, 50% against 34% at $112 against $43. Nor did the gate buy fewer
later-found misses: four of the seven genuine misses below are on plan-gated tickets (4 of 46)
against three on review-gated ones (3 of 75). This method cannot separate the gate's effect
from its selecting bigger, riskier tickets, and the counts are small.

**A lane gets the same quality on a quarter of the words.** 33 Done tickets were worked inside a
multi-ticket lane: a claim comment and a close-out, 557 words median, no lineage of their own,
PRs of 234 lines that all touch tests. A review still happens: every one of the 33 close-outs
describes one, 20 record an Approve, but it is a paragraph inside the close-out, not a
1,700-word verdict comment (LIN-2487's close-out is typical). Three lane tickets (LIN-2522,
LIN-2523, LIN-2527) shipped defects, and all three were caught by the parent's implementation
review (LIN-2516 comment `08261320`) and filed as LIN-2551 and LIN-2553 before anyone else found
them, so the lane's gate is the parent's review, not none. No lane ticket has a genuine
later-found miss. Lanes select small work: 21 of the 33 are breakdown children.

**The reviewer reads the problem, the acceptance and the anchors.** Where the description has
an acceptance section, 81% of reviews cite it; where it has none, 39% find something to call
acceptance. 109 of 111 reviewed descriptions carry file anchors and 99% of those files are named
again by the implementation or the review. These are exactly the parts the prune is told never
to remove (`lib/prompt-template-defs.js:1195`). The description's written core is load-bearing.
What swells it, and is then pruned, is the plan and research written into it by the templates
(`:188`, `:577`).

**A tenth of the words are the machinery narrating itself, and none of it repeats.**
Autopilot and runner comments (run summaries, verb-override notes, cross-checks, voyage logs)
are 336 of 1,557 comments and 133,000 words. 128 beat-completion comments carry another
135,000 words, though those are a stepped run's stage output delivered in instalments rather
than narration about it. 32% of all comments open by stating the commit they re-grounded at. The
record is not padded by copying: for every kind of comment, at least 91% of its six-word
sequences appear nowhere earlier on the ticket. The length is new prose each time, so
simplifying it means dropping kinds of comment, not de-duplicating them.

**Quality, by rubric.** The sub-question was what the output quality is, by several rubrics.

| Rubric | Reading |
|---|---|
| Tickets filed in the cohort that reached Done | 184 of 471 (39%); 283 open, 246 never touched |
| First implementation review: Approve | 73 of 111 (66%); rounds mean 1.7, max 4 |
| First plan review: Approve | 4 of 46 (9%); rounds mean 1.9 |
| Human rulings and notes needed | 84, on 50 of 184 Done tickets |
| Follow-ups filed per Done ticket | 2.3 (423 in all) |
| Median cost, review-gated / plan-gated | $31 / $67; 1.3 / 2.2 session-hours |
| PR landings on main, 30 days | 318; median 316 lines in 4 files; 86% touch tests; 0 reverts |
| Cost per changed line (priced, joined) | $0.03 |
| Later Bug tickets naming a Done ticket | 13 of 184; 6 were the review's own filed residue |
| Genuine later-found misses | 7 of 184 (4%): 4 defects, 1 shipped inert, 2 false close-out claims |

The seven misses are the sharpest quality reading here, and the second paper's check changed
their shape. Version 1 counted thirteen; `what-the-reviews-checked.md` read the reviews behind
them and found six were the review's own output, named in its ledger and filed or dropped in
terms, LIN-2631's inert cost accumulation among them (its close-out ticked the criterion as
*"inert in production"*, comment `426683fb`, and John accepted it on the record). Of the seven
that remain, one shipped inert unseen: LIN-2515's login-expired detector sat behind a driver
whose capture returned null (LIN-2611), its host witness written on the ledger and routed
instead of run. Two were outside every class a review named and visible only on the running
page; two were inside a class the review named and swept short; two are close-out claims about
the label catalogue that nobody read (LIN-2773 and LIN-2775, found by LIN-2787). Six of the
seven had passed a review, three after three rounds, and the miss with the largest record
behind it, LIN-2641, carried 34,000 words and five plan-review rounds. The second paper prices
every catch that would have worked below one review round.

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
kind is assigned from the first line by ordered rules (plan-review, close-out, review, plan,
autopilot, runner, human, lane-claim, implementation, research, and so on), with body markers
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
Version 2 adds **routed**, from the second paper: the Done ticket's own review or close-out
named the fault and filed or dropped it in terms. 32 pairs were context and 6 routed. The rubric
and every verdict are in the session's `later-bugs-hand.json`.

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
be blamed by a later bug: the 4% miss rate is a floor, and the shapes closed latest, which are
the gated ones, are the most under-counted. A miss is only visible if someone filed a Bug and
named the ticket; a defect fixed quietly, or blamed on nothing, is not here. Lane tickets are
small by selection, so their clean record is on easier work. The comparison of shapes is
observational: the gate is applied to bigger tickets, and this method cannot say what those
tickets would have done without it. The classifier reads first lines, and version 1 got two
rules wrong: a plan review whose heading lacked the word "verdict" was read as a plan, and a
close-out whose first line named the runner was read as narration; correcting them moved ten
tickets into the plan-gated shape and is why version 1's shape counts differ from these. 92
comments (5% of words) remain unclassified. Cost is the worker sessions the lineage prices; a
lane ticket's cost sits on its lane's anchor and reads as zero here. Version 1's hand-read of
the 45 pairs was one author's and over-counted misses by six; the second paper is the check the
standard asks for, and its verdicts are adopted here. Nothing here says whether the words are
worth it to a human reader; only that the machine's verdicts and the later bugs do not respond
to them.

## Next

Run the controlled version: dispatch the same twenty small tickets once through a lane and
once through the review-gated pipeline, and count later-found misses at thirty days
(LIN-2914). Drop the autopilot and runner narration and the beat-completion comments for a
fortnight and re-run this method: if first-pass approval and the miss rate hold, the tenth is
free (LIN-2915). Read ten 1,700-word reviews against their close-outs and mark which sentences
the close-out actually consumed (LIN-2911). Follow the 46 Done tickets with no snapshot: was
the description never rewritten, or did the archive miss them (LIN-2913)? The second paper's
own Next, a reader for the close-out and a terminal class check, stands beside these.
