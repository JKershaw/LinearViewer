---
title: Does the system run out of tasks, or generate them forever?
version: 1
date: 2026-09-12
authors: [Claude]
model: claude-opus-5, claude-code; the dispatch lineage for LIN-2826 (kind `research`) stamps no model or effort
grounded_at: 4a8656cf
cites: [docs/papers/harbour/tasks-generate-tasks.md@4a8656cf, LIN-2826 (2026-09-12), LIN-2817 (2026-09-12), LIN-2569, LIN-1721, LIN-1601]
---

# Does the system run out of tasks, or generate them forever?

Neither, on the number that answers it. Define the **root-task ratio**: collapse every
breakdown tree to one unit — a ticket plus every ticket a plan carved out of it, at any depth
— and count, per unit, how many further units name it or one of its members as the ticket that
produced them. Over the same sixty days as `tasks-generate-tasks.md`, 1,484 tickets collapse to
1,340 units and the ratio is **0.74**. Below one, so the population as a whole decays rather
than runs away. But the mean is carried by a quarter of the units: three in four cause nothing,
and a unit that reaches Done causes **1.52**. Work that is actually done is above replacement;
the number is under one only because most of what is filed is never touched.

## Findings

**The ratio is 0.74, and the collapse is not what puts it under one.** 986 causation links
across 1,340 units. Collapsing breakdown trees moves the number very little: with no collapse
at all it is 0.76, and under a deliberately over-eager collapse — every child of a ticket
labelled `kind:epic` treated as a carve, 1,113 units — it is 0.71. The gap between this and the
2.1 of `tasks-generate-tasks.md` is not the phases and sessions; it is that 2.1 counted every
ticket created against only the tickets closed, while this counts causation per task existing.

**Three in four units cause nothing, and a tenth cause three quarters of everything.** The
median unit causes zero. 1,007 of 1,340 caused none, 333 caused at least one, and 133 caused
three or more. The top decile of units accounts for 73% of all 986 links; the largest single
unit, LIN-1721, accounts for 35. The distribution is not a system where each task begets
roughly one more — it is a flat field with a few generators standing in it.

**Being worked is the switch.** Units that reached Done cause 1.52 each; units that did not
cause 0.18. 47% of Done units caused nothing against 95% of the rest. That is the same shape
`tasks-generate-tasks.md` found at ticket level (1.12 for worked tickets) and it is sharper
here: on units, worked work is comfortably above replacement. The population ratio sits below
one because 786 of the 1,340 units never reached Done inside the window, not because generation
is contained.

**Close-outs generate more than reviews, and people generate least.** The mean decomposes by
what produced the new unit:

| Generating kind | Links | Per unit |
|---|---|---|
| Close-out | 454 | 0.34 |
| Review or plan-review | 263 | 0.20 |
| Other pass (research, validation, incident, passage) | 199 | 0.15 |
| Human | 70 | 0.05 |

Close-out alone is nearly half the ratio. A human filing a ticket is a twentieth of it.

**The trees are small; 29 of them hold all the collapsing.** 144 carve edges absorbed 144
tickets: 127 into 29 multi-ticket units rooted inside the window, 17 into 4 units rooted before
it and dropped with them. Sixteen of those 29 roots carry `kind:epic`. The largest is LIN-2569 at 19 tickets. Against
1,340 units, breakdown is a rare shape, not the bulk of the tracker — which is why collapsing
it changes the ratio by two hundredths. It is not idle, though: 80 of the 986 links are held by
a carved member rather than by its root, and without the collapse they would be credited to a
phase ticket instead of to the task it belongs to.

## Method

Population: the same sixty days as `tasks-generate-tasks.md`, 2026-07-14 to 2026-09-12 —
identifiers LIN-1325 through LIN-2810, 1,484 tickets (LIN-2173 and LIN-2174 do not resolve).
That paper established that identifier order and creation order agree across the whole
workspace, so the window is taken on identifiers; the count reproduces its 1,484 exactly.

**The collapse rule.** A ticket is a *carve* of its parent when it has a parent link **and** its
first 400 characters announce the carve: `phase N`/`phase X`, `S1`…, `session N`, `step N of`,
`sub-issue of`, `subtask of`, `plan item`, `owner of item`, `carved from/out of`, `split
from/out of`, `breakdown of`, `breakdown pass`, `scope copied from the parent`, or `of/per the
LIN-nnnn plan|breakdown`. Both halves are required: a parent link alone is not a carve, because
follow-ups routed out of a close-out are routinely filed under the same parent (LIN-2704 under
LIN-751). Carve edges are followed transitively, so a unit is a root ticket and its whole carved
subtree at any depth. A unit whose root lies before the window is dropped.

**The ratio.** A unit's *generating ticket* is, for its root ticket, the parent link when the
root is not itself a carve, else the first `LIN-nnnn` in the opening 400 characters — the
attribution rule of `tasks-generate-tasks.md`. Unit A caused unit B when B's generating ticket
is any member of A and A ≠ B. The ratio is the mean of those counts over all units.

**Generating kind** is read from the caused unit's root, first 900 characters, as an ordered
rule set — close-out, review, human, other — with the `kind:review-residue` and `kind:follow-up`
labels as fallbacks. The four kinds partition the 986 links, so the column sums to the mean.
Outcome is the root ticket's state type: `completed` is Done.

```sh
B="$HARBOUR_LOCAL_BASE/api/proxy"   # sleep 1.1 between calls; the proxy caps at 60/min
curl -sG "$B/issues?limit=250" --data-urlencode "after=$CURSOR"   # 12 pages, 2,769 issues,
                                                                 # carries description + parent
curl -s "$B/issues/LIN-2810"        # createdAt, to fix the window edge
```

## Limits

The collapse under-reaches. 34 of the 44 in-window `kind:epic` tickets have parent-linked
children, but only 16 collapsed, because the other children do not announce the carve in their
opening; those children stand as units of their own and some of the links counted as causation
are really a plan dividing itself. That biases the ratio upward, and the over-eager sensitivity
above puts the size of the bias at about 0.03.

Attribution sees only what a ticket says about itself. 209 units name no generating ticket at
all and count as caused by nothing, which biases the ratio down; descriptions rewritten at
close-out (LIN-2203, LIN-2665 open with a shipped notice) lose their origin the same way. In the
other direction, a collector ticket used as the parent of a class of findings — LIN-1721 — is
credited with causing each of them, and the top decile's 73% share means a handful of such
tickets move the mean.

Causation is counted only inside the window, so units filed near its end have had no time to
produce and 0.74 is a floor on that account. Canceled tickets carry no completion timestamp, so
the Done/not-Done split reads 27 canceled units as not Done. Nothing here says whether a unit
that caused nothing should have caused something, and no number here bears on whether any
particular filing was right.

## Next

Re-read this on or after **2026-11-11**, after the scope-and-filing ruling has been in force for
sixty days: the same method, the same collapse rule, the window 2026-09-12 to 2026-11-11, and
report the ratio, the Done split, and the close-out row against 0.74, 1.52 and 0.34. The
comparison that matters is the Done ratio, not the population one — the population number can
fall while generation is unchanged, simply by less work being picked up.
