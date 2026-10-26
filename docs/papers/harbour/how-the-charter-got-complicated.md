---
title: How did the charter's work get complicated?
kind: paper
version: 1
date: 2026-10-26
authors: [the LIN-4007 implementation session, for John]
model: by dispatch lineage; tiers named in the text, ids withheld per the ticket's rule
grounded_at: 323ce171
cites: [LIN-4007 (comments 14:05:25–14:05:38Z; research comment 14:13:24Z), LIN-4006 (retro, 123867bd), LIN-3490, LIN-3833 (comments 25 Oct 09:16–17:05Z), LIN-3975 (paused 14:06Z), LIN-3977, LIN-3983, LIN-3952, docs/reviews/charter-retro-2026-10-26/, docs/reviews/ui-design-gap-review-2026-10-26/]
---

# How did the charter's work get complicated?

Mostly the pipeline's own text, not John's words or the operator's. At launch the five main UI tickets gave an
implementer 17,000 to 19,000 characters; John's choices and words were at most 10% of that, the operator's
text 18% to 34%. By the first implementation dispatch the same tickets had grown to 81,000 to 151,000
characters, 76% to 87% of it pipeline text (research, plan, plan review, review). The record, read at
14:20Z, holds 102,000 to 224,000. Whether that made the work harder cannot be separated from model, scope
and period. The record does show that the tickets with the most rounds were open-ended page builds with
mid-run changes, and that the long router moves, which were mostly Sonnet, took one implementation each. LIN-3975
was paused by its autopilot at 14:06Z; anything after that is out of scope.

## Findings

**1. John's requests were short, and each became a ticket, a brief, a ruling or a retro input.** Sixteen
requests of his changed the work in the record (evidence §1). The first at 23 Oct 09:28Z ("Happy for this to all
be bundled into a Charter if that makes things simpler.") became LIN-3490. On 26 Oct at 07:18Z he asked for a
review because he suspected "tickets have become bloated and contain far more rules than I intended"; that
became the operator's reviews and then the retro, LIN-4006, which he proposed at 07:52Z and asked to have filed and dispatched at 08:49Z.
At 13:07Z he wrote the process question this paper answers ("my gut feeling is this just added an appended to every
ticket"), and at 13:10Z asked "Perhaps a Paper/essay?". At 14:00Z he asked for the transcript to be filed
as an attachment. His choices reached the tickets as ruling options he picked, not as prose: LIN-3833 has eight
rulings, and the record shows his words only as the operator's relays.

**2. Most of what an implementer read was pipeline text, and the operator's share was largest at launch.** The
five tickets, by character share (evidence §2):

| Ticket | At launch: chars (John, operator) | At first dispatch: chars (pipeline) | Now: chars (pipeline) |
|---|---|---|---|
| LIN-3833 Home | 17,005 (10%, 18%) | 103,760 (82%) | 164,826 (86%) |
| LIN-3975 Task page | 18,713 (2%, 25%) | 150,867 (87%) | 224,086 (85%) |
| LIN-3977 Live Console | 18,589 (1%, 19%) | 126,637 (83%) | 161,494 (83%) |
| LIN-3983 Observation | 18,370 (2%, 19%) | 99,411 (81%) | 165,918 (83%) |
| LIN-3952 Models | 19,192 (0%, 34%) | 81,447 (76%) | 102,202 (77%) |

"At launch" is the description without its pipeline sections plus the comments before the first pipeline comment.
The UI session wrote the briefs for LIN-3975, LIN-3977 and LIN-3983 (the operator's part 3 log: "UI session files a design
BRIEF = the ticket"); LIN-3952 came "from John's review via other session"; LIN-3833's author is not in the record,
and its shares are not estimated. The later share is lower for LIN-3977 and LIN-3983 because their plans were
pruned after Done (LIN-3983 went from 69,195 to 17,405 characters), so their first-dispatch figures are a floor.

**3. The flywheel made tickets and rulings out of its stages, and most of what it made was follow-up.** The
retro's index holds 1,107 runs: implementation 174, review 168, plan 154, custom 143, close-out 138, autopilot 135,
plan review 118, research 49 (evidence §3). Edge cases became research classes, plans written into the
description, plan-review findings, implementation decisions that went to John as rulings (20 across the five
UI tickets), review fix rounds, close-out follow-up tickets, and operator "unwedge" tickets (LIN-3986,
LIN-4003). Of the 42 non-umbrella Done tickets under the charter's roots, 24 changed what a user of a kept page
sees or removed code; 17 kept the pipeline moving; one was not needed; 23 are open. A single reader coded these
from titles, so the split is a count, not a checked figure.

**4. Long tickets did not clearly make the work harder, and the record cannot say what did.** Measured at launch
(evidence §4):

- Haiku on short tickets (6,000 to 13,000 characters, four tickets): one implementation each, one review each.
- Haiku on the five UI tickets (17,000 to 19,000 characters): two to six implementations, two to eight plan-review
  sessions, one to eight rulings each.
- Long router moves (15,000 to 47,000 characters, six tickets): one implementation each and no rulings. Five were
  Sonnet; one was Haiku.
- A short Sonnet ticket, LIN-3849 (8,400 characters), had four plan-review sessions.

Length, model, scope and period move together, and the router moves are not a clean Haiku comparison. This agrees with
`ticket-record-and-quality.md` (record size predicts nothing for first-pass approval) and with
`how-a-task-is-composed.md` (size and composition cannot be separated). The record supports one candidate
mechanism, open-ended outcomes with mid-run changes, and does not test it.

**5. The roles.** John set the goal ("simplify the code, unify the UI, and update the pages"), and on the Haiku choice wrote
"Haiku was intentional" (25 Oct 07:05Z, in the operator's log). He made the rulings that were his to make, and on 25 Oct at 19:40Z gave the operator "authority to rule on obvious things to keep things moving".
The operator launched the moves, wrote the rules blocks, predictions and scores, passed eight rulings on
overnight, moved items between tickets, relayed John's answers, and wrote the reviews and the retro's inputs. Its own
pause note records that it over-steered: "opinionated pre-fills", "passed 8 rulings on", and "a dozen mid-flight
comments". The UI session wrote the three briefs and the follow-up tickets. Its own account, in the UI review's
"How the gap arose", is that the briefs were written from surveys of the old pages, not the prototypes; that
reviews compared each build with its ticket and never with the prototype; and that fresh-reader checks pushed
tickets toward testable wording rather than layout.

**6. What would have kept it simple.** Three principles, not a ticket list. Settle the goal, the finish line and the
layout once, before launch, from the prototype, and do not append to a live ticket during the run. Make the
standing permission for rulings explicit and bounded, so a question does not wait for John and does not
quietly become a policy. Judge a ticket by what the implementer carries at launch, not by its final size, which
mostly records the rounds that followed.

## Method

The evidence file is `how-the-charter-got-complicated-data/evidence.md`. The inputs were the six transcript comments on LIN-4007, copied byte for byte (`how-the-charter-got-complicated-transcript/`),
the research comment of 14:13Z, the retro and the UI review, and the ticket record read through the Workspace API
at 14:20Z with GET requests only. `fetch.py` writes the derived CSVs; `classify.py` assigns the classes and cut points
without network access. Descriptions were split at their headings; comments were classed by opening line. The
served-the-goal coding is one reader's, from titles at the 07:45Z index. Each quotation from John was found with
`grep -F` in the transcript files. No ticket, ruling or code was changed, and no model call was made.

## Limits

- The turn-by-turn record before 26 Oct 07:17Z was not kept. John's turns from 23 Oct 09:40Z to 24 Oct 18:50Z,
  and on 25 Oct daytime, survive only as the operator's quotes. Words he gave in other sessions (UI, Costs,
  observer) are not in the record.
- Cut 2 undercounts pipeline text for Done tickets, whose plans were pruned.
- The record cannot separate model, length, scope and period, so no effect of Haiku is claimed.
- LIN-3833's brief author, and the share of any ticket's text that came from John in his own words, are not known.
  His relayed choices are counted as John's; his verbatim words are a fraction of the figure.
- The index is as of 07:45Z: it finds 22 direct children of LIN-3490, against 24 at 14:10Z in the research.
- First-pass review verdicts and start-to-merge hours are not measured here; session time is.
- Transcript comment 4 contains one model identifier as the operator wrote it. The transcript is committed as
  given, as the ticket asks. The ticket also asks that repository files carry no model identifiers, so this is
  flagged for John.

## Next

- Ten UI pages briefed with their prototype and a finish line before launch, against ten briefed as the five above
  were: count implementation sessions, plan-review rounds and rulings per ticket (`proposals.md`).
- A second reader for the served and process-only coding, on a sample of twenty tickets.
