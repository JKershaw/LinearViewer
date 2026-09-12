---
title: Why does a plan go round plan-review more than once?
version: 2
date: 2026-09-12
authors: [Claude, John Kershaw]
model: claude-opus-5, claude-code, effort high (the study, LIN-2800); this edition rewritten by hand
grounded_at: 33c524d9
cites: [lib/plan-review-round-trips.js@33c524d9:21-24, routes/dashboard.js@33c524d9:141, lib/effort-readout.js@33c524d9:70-75, simple-dispatcher/config.js@135991f:62, simple-dispatcher/config.js@135991f:548, LIN-2800 (2026-09-12)]
---

# Why does a plan go round plan-review more than once?

Because the gate is not judging the design. Over the thirty days to 12 September 2026,
plan-review approved a plan first time in 11 of 94 cases. Every send-back we read asked for
one more member of a list the plan had already built, and none asked for a different design.
The loops cost about a third of all session time. Resuming the original session instead of
starting a fresh one would recover about one percent of it.

## Findings

**Plan-review loops. Review mostly does not.** Of 94 tickets that reached plan-review, 83
were sent back at least once and 33 went round twice or more; one went five times. Of 247
that reached review, 53 were sent back and 9 twice or more.

**A send-back asks for a member, not a design.** We read every send-back on three tickets,
eight verdicts, and classed each by what it asked for. Four asked for a member missing from
an enumeration the plan had built. Two asked the plan to reconcile with work landed under the
same grounding commit. One named an unhandled case, one a claim that failed on re-derivation.
None asked for a different design, and two verdicts say so themselves. None needed code to
answer. The window's two longest loops ended by a human ruling, not by approval.

**The loops are a third of the time.** Across 329 tickets and 1,994 sessions, the split by
leg class:

| Leg | Session time | Cost |
|---|---|---|
| First pass | 69% | 62% |
| Gate (plan-review, review) | 20% | 30% |
| Re-pass after a gate | 11% | 9% |

**A resume would save little.** The 108 implementation re-passes took 49 hours. The part of
each before its first edit, which a resumed session would skip, is 6 to 11 hours, about one
percent of the window. It is feasible: 88% of re-passes begin inside the hour the dispatcher
holds a finished session open. The loop is the expense, not the re-grounding.

**One instrument is wrong.** The round-trips module's header says a plan can only go round
once; 33 went round more. The effort read-out reads the last 200 dispatch rows, which is about
half a day, so it cannot see a thirty-day window at all.

## Method

Population: every Done or Canceled ticket with a dispatch lineage in the window, a census from
LIN-1700 up and a one-in-five sample below. Each session in a lineage is a leg. Plan-review and
review legs are gates. A kind seen again after its gate is a re-pass. Autopilot, wake, custom
and periodical legs are orchestration and excluded. A verdict is a heading line containing
"Verdict" with approve, request changes or needs discussion near it, attributed to the gate
leg running when it was posted. The reader was hand-checked against 137 comments with no
disagreement. Resume feasibility is the gap from a re-pass's dispatch back to the previous
implementation leg's end, against the dispatcher's hold and retention bounds.

```sh
B="$HARBOUR_LOCAL_BASE/api/proxy"   # sleep 1.05 between calls; the proxy caps at 60/min
# population: page every issue, keep Done/Canceled
curl -sG "$B/issues?limit=250" --data-urlencode "after=$CURSOR"
# per ticket: completedAt and comments (verdicts); per in-window ticket: the lineage
curl -s "$B/issues/$KEY";  curl -s "$B/issues/$KEY/cost"
# per implementation re-pass: rows and heartbeats, for the prefix before the first edit
curl -s "$B/dispatch?issueIdentifier=$KEY&limit=100";  curl -s "$B/dispatch/$ROW_ID"
```

## Limits

Verdict counts are within about ten percent: a looser anchor raised plan-review send-backs
from 126 to 160. 81 of 410 in-window tickets have no lineage and are invisible here. Dollars
are the priced subset only; 119 tickets report none. Nothing here says whether the loops are
worth it. A gate that sends back 88% of plans and finds a real missing member each time may be
the cheapest part of the pipeline, and these queries cannot tell that from ceremony.

## Next

Re-run this method on or after 2026-09-26, once LIN-1871's class-not-member rule has been in
the templates for two weeks, and compare first-pass approval and rounds per ticket before and
after.
