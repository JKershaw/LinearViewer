# Paths and readers: the picture's leaks, causes and needs, walked through the design

*17 Nov. Each row of `picture.md` (peaceful-euler, `fff543172`) §2–§7 against `design.md` round 6, with the line of the design that handles it and the walk that showed it, where one did. Design lines are `design.md` as committed at `6cc7afdbf`. "Shown" cites the walk results file and line; "not shown" means designed but not yet exercised.*

## 1. Directions of travel (picture §2)

| Leak | How the design handles it | Design | Shown |
|---|---|---|---|
| **Down:** a child gets a copy of the parent's plan, errors included | The child links its `piece` to the parent's plan record; no copy. A correction is a revise of that piece, seen by every task linked to it; verdicts and decisions resting on the old version show stale | §3.1 `links` (l.55), brief part 2 (l.106), stale (l.96) | walk 3 results l.40 (departures become a new version of the piece); walk 4 l.32 |
| **Up:** corrections pile beside the source; the prune removes the plan; copied counts drift | Revise the record itself, earlier versions kept, so nothing is pruned away; counts are a view, never typed | versions (l.56), counts (l.97) | walk 4 l.32 (corrections replace), l.45 (S3: no one typed a count) |
| **Across:** no path to other lanes; asks go unanswered; parallel work unaware | A question or finding `to` another task reaches that task's brief; lessons reach any task whose paths overlap; open runs sharing paths are in the brief | `to` (l.54), brief parts 3, 6, 7 (l.107, 110, 111) | walk 4 l.43 (S1: asks reached the lane at every wake); walk 5 l.48 (LIN-4459); same-task runs fixed in round 5 after walk 4 l.46 |
| **Out of the task:** finds go to notes' Waiting lists or "to the person", and stop | A finding `to` an area or to John, with declared ends; the area's open count in every brief that touches it | kinds (l.66), brief part 5 (l.109) | walk 4 l.42 (Waiting entries handed on, traceable); l.47 (S5: the pile shrank when runs looked) |
| **Out of reach:** a check needing John's systems is carried as text, then dropped | A `check` to John, open until someone ends it; owned | kinds (l.67) | walk 4 l.9, l.36 (open at the end, owned) |
| **Retold at every step**, drifting | One record, linked or handed on; the brief carries what is addressed to a stage in full and indexes the rest | brief parts 3, 7 | walk 3 l.28; walk 4 l.33 |
| **Written where no one checks:** notes outside the blind read's diff; nothing reviewed after approval | Area records are queryable by every reader, the blind read included; an approval resting on a moved head shows stale | queries (l.116), stale (l.96) | walk 4 l.35 (stale right at every task's end); notes in the blind read **not shown** |

## 2. Who decides, and who wrote what (picture §3–§4)

| Leak | How the design handles it | Design | Shown |
|---|---|---|---|
| Standing text makes the person's calls; rules collide | A person's standing direction is a `decision` with a `scope` (a task or an area); every decision says who made it | `decision` (l.69), `by` (l.51) | autopilot writing as itself, walk 4 l.38; area scope **not shown** (added round 6) |
| Questions and answers on different tickets; rulings keyed by loop | A `question` to one decider; the `decision` that answers it links `answers`; both in the task | links (l.55), view "answered" (l.95) | walk 3 l.38 (four accounts became one question and one decision) |
| Every comment under one account | `by` on every version, from declared actors | l.51, l.82 | every walk |

## 3. The four causes (picture §6)

| Cause | Answer |
|---|---|
| The only memory is what is written | Still true; what is written is now records with versions, an addressee and an end (§3.1) |
| Rules send things to places with no end | Every kind declares its ends (§3.2 table); an area holds records that end, not a list |
| The sources are frozen by design | Only the person's words are fixed (`asked`, l.64); plans and everything else revise with versions kept |
| No path sideways or back | `to` may name any actor, task or area (l.54); links reach back to the source (l.55) |

## 4. The six needs (picture §7)

| Need | Met by | Shown |
|---|---|---|
| 1. A correction reaches its source | revise (§3.1), piece link | walk 4 l.32 |
| 2. A finding moves once, then ends | `finding` with ends, handed-on | walk 3 l.28, walk 4 l.33 |
| 3. A check reaches the person as something to do | `check` to John | walk 4 l.36 |
| 4. One account of who decided what | `decision` with `by`, `answers` | walk 3 l.38 |
| 5. The outside reader sees everything a change writes, notes included | queries over area records | **not shown** |
| 6. Parallel work learns of each other; a shared place gets answers | open runs (brief part 6), questions to a task | walk 4 l.43; open runs **not shown** since round 5's fix |

## 5. Readers: what each is given

| Reader | Given | Design | Shown |
|---|---|---|---|
| Each stage | the brief (eight parts), then queries | §3.5 (l.104–116) | walks 3–5, every step |
| The blind read | the brief and queries without others' verdicts | l.82 | brief side walk 5 l.44; queries **not shown** (round 6) |
| The autopilot | a brief as an actor on the task | l.82 | walk 4 l.38, l.41 |
| John | what is open and addressed to him (`find --to John`) | view "open for a reader" (l.94) | walk 4 l.40, walk 5 John steps; a page for him **not designed** (§6 l.147) |
| Harbour's code | the fields directly; views | l.118 | not exercised by code |
| The tracker | **not designed** (§6 l.147) | — | — |
| Another project's actors | its own `actors.json` | l.82 | walk 4 S4, S5 (Lighthouse sessions) |

## 6. Not yet shown, collected

Notes in the blind read's view (need 5); a decision scoped to an area; open runs after round 5's fix; blindness in queries; the round 6 write side generally (a `to` on a decision or verdict, a verdict superseded, "needs-discussion"). Not designed: how the tracker shows records; a page for John; waking (mapping §8).
