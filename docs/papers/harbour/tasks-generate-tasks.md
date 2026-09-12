---
title: How do tasks generate tasks, and at what rate?
version: 1
date: 2026-09-12
authors: [Claude]
model: claude-opus-5, claude-code; the dispatch lineage for LIN-2817 (kind `research`) stamps no model or effort
grounded_at: 1cbf41a6
cites: [docs/papers/harbour/efficiency-levers.md@1cbf41a6, docs/papers/harbour/review-loops.md@1cbf41a6, LIN-2817 (2026-09-12), LIN-1989, LIN-2644, LIN-2660]
---

# How do tasks generate tasks, and at what rate?

Mostly out of gates and close-outs, and faster than they are closed. Over the sixty days to
12 September 2026 the tracker gained 1,484 tickets and closed 701 — 2.1 created for every one
closed, above 1.3 in every week of the window. Five in six of the new tickets name the ticket
that produced them. A generated ticket that actually gets worked produces 1.12 tickets of its
own, so the chain replaces itself and a little more. The relief is that most generated tickets
are never worked: 52% are still sitting in Backlog or Todo, and close-out follow-ups and review
findings are 63% of that pile.

## Findings

**Creation runs at about twice closure, every week.** 1,484 tickets created against 701 closed.
By week the ratio is 2.07, 2.05, 3.04, 3.26, 2.73, 1.32, 1.87, 2.01, 1.98. The two weeks that
come closest to parity are the two with the heaviest closing, not the two with the lightest
filing.

**Five in six new tickets name their parent event.** 1,269 of 1,484 carry a parent link or open
by naming the ticket and the pass that produced them. Classed by that opening:

| Generating event | Tickets | Per generating ticket | Never worked |
|---|---|---|---|
| Review or plan-review | 410 | 2.05 | 57% |
| Close-out | 340 | 1.95 | 74% |
| Breakdown or plan | 237 | 4.84 | 31% |
| Human filing | 96 | 1.34 | 40% |
| Other agent pass (validation, incident, passage) | 78 | 1.54 | 40% |
| Research pass | 22 | 1.00 | 32% |
| No stated origin | 301 | — | 45% |

A breakdown expands hardest but files work that gets done; a review or a close-out expands less
and files work that mostly does not. The close-out figure of 1.95 sits either side of the one
number already written down — 19 remediation tickets producing 30 follow-ups, 1.58, in the lane
run of 23 August (`efficiency-levers.md`, triage row).

**The branching factor is 1.12, and that is the sustainability number.** Of the 1,269 generated
tickets, 580 were worked. Those 580 produced 652 further tickets inside the window: 1.12 each,
with 45% of them producing at least one. Work that is picked up therefore replaces itself. The
chain does not run away only because the other 689 generated tickets were never picked up at
all.

**Half of everything filed is never worked, and it is not a recency effect.** 770 of the 1,484
are still in Backlog or Todo, at a median age of 28 days. Taking only the tickets created in the
window's first fortnight, all of them now at least 46 days old, the rate is the same: 178 of
346, 51%. In that aged cohort close-out follow-ups are 70% never worked and review findings 75%.
Neither is waiting its turn; it is the steady state.

**Two paths make almost two thirds of the stranded work.** Close-out follow-ups contribute 250
never-worked tickets and review findings 235 — 485 of 770. Close-out follow-ups sit longest, a
median 32 days against 27 for review findings and 28 overall. Priority is not the discriminator
it was read as: only 74 of the 770 carry no priority at all. The third path, breakdown, files 237
tickets and strands 73 of them, and those sit longest of all at a median 43 days, because a
breakdown's unstarted phases are parked by design.

**Read by hand, the filings are reviews restating their own findings.** Thirty tickets drawn at
random from the window, classed against six classes fixed before reading: 10 review finding, 8
other, 6 breakdown, 3 scope deferred, 3 class sibling, 0 doc drift. The three class siblings —
LIN-1989, LIN-2644, LIN-2660, each filed because a check enumerated a class and found the same
defect at a second site — are all three still unworked. The eight in "other", each a problem
stated on its own terms with no generating event, are all eight worked or closed. What a ticket
says about where it came from predicts whether anyone will do it.

## Method

Population: every issue in the workspace, 2,762, paged whole; the window is the sixty days to
the dispatch of LIN-2817, 2026-07-14T11:01Z to 2026-09-12T11:01Z, by `createdAt`. Identifier
order and creation order agree exactly across all 2,762, so LIN-1325 is the first in-window
ticket. Closed means a `completedAt` inside the window.

Creation is attributed from the parent link first, then from the first 900 characters of the
description, matched against a fixed ordered rule set — close-out, review, breakdown or plan,
human, research, other agent pass — with the `kind:review-residue` and `kind:follow-up` labels
as fallbacks and a parent link as the last one. The generating ticket is the parent if there is
one, else the first `LIN-nnnn` in the opening 400 characters. Never worked means a state type of
`backlog` or `unstarted`; on a sample of 60 Backlog and 39 Todo tickets, `/cost` reports no
dispatch lineage for 60 of 60 and 37 of 39.

The hand sample is 30 tickets drawn with a fixed seed, read in full, and classed as scope
deferred, review finding, class sibling, doc drift, breakdown or other. The classes were fixed
from the brief before any ticket was opened.

```sh
B="$HARBOUR_LOCAL_BASE/api/proxy"   # sleep 1.05 between calls; the proxy caps at 60/min
curl -sG "$B/issues?limit=250" --data-urlencode "after=$CURSOR"   # page the whole workspace
curl -s "$B/issues/$KEY"            # createdAt, completedAt, state, parent, relations, comments
curl -s "$B/issues/$KEY/cost"       # noLineage + workerSessions, for the never-worked check
```

## Limits

The creator field is the same person on every ticket, so attribution is only as good as what a
ticket says about itself. Hand-checking the generating-event class on the same 30 tickets, the
rule set agreed 22 times; the eight misses all ran one way, reading a human filing or a research
pass as a review or as no stated origin, so review is over-counted and human filing under-counted
here. A ticket filed by a session that says nothing about its origin is invisible as a generated
ticket and lands in the 301 with no stated origin, which biases every expansion figure downward.

Second-generation counts see only children filed inside the window, so tickets created near its
end have had no time to produce and the 1.12 is a floor. Canceled tickets carry no completion
timestamp anywhere in the API — 143 workspace-wide, 29 of them in-window — so the closure count
is Done-only and the 2.1 ratio is, by that much, an overstatement. Nothing here says whether a
never-worked ticket should have been worked, and these queries cannot tell a correctly shelved
finding from a dropped one.

## Next

Read the never-worked pile itself rather than its origins: take the 485 close-out and review
tickets still unworked at 60 days and say, by hand on a sample, how many describe a defect that
is still present at HEAD. That separates debt from filings that time has already discharged.
