# Spike 4: slice 6 (wakes), with A2 and A3

26 Nov. Read-only. Code at main `5c33e4415` (25 Nov 17:52). Nothing has merged since [shown: `git ls-remote`].
Live reads are saved in the scratchpad, `spike4/`. Marks: **shown** (with a citation) or **unknown**.

## The answer in brief

- A2 and A3 are both still real. Nothing has changed them since 25 Nov.
- They are two different problems. Slice 6 as designed would fix neither.
- A2 comes from an engine rule: a parked stage holds its ticket. The fix is mostly a removal.
- A3 needs something to prompt the asker when the world changes. That's a small ring, not a slice.
- Recommendation: option (a). Put both fixes in the clean-up ticket and drop slice 6 from the plan.

## 1. Still real?

- **A2, yes.** It was last seen on LIN-4342's closing PR, 17:14 to 18:01 on 25 Nov. Three reviews and one blind read were sent beside an open close-out (3a383f3a) [shown: dispatch rows].
  finding-34ab47ef is still `open`, at v1 [shown: record].
- **A3, yes.** No question code has changed since then. question-2fea4d20 was answered by John at 08:25:46 [shown: record v2].
- **The queued notes piling up (19 Nov): unknown whether it still happens.** All 26 wake rows to autopilot 786d5803 on 25 Nov show `completedAt` 18:01, which is when the autopilot ended. So the rows can't tell us when each wake was delivered.
- **Reboot (25 Nov).** Harbour has no way to re-fire a session. Its liveness alarms only advise: "nothing acts on them" (instructions.txt:603) [shown].
  Harbour can't tell a dead session from a busy one, so re-firing belongs to the runner spike, not slice 6.

## 2. How A2 happens in code

1. A fix after an approval moves the head. Close-out must then hand the work back to review rather than merge (`lib/prompt-template-defs.js:805,823`).
   It ends PENDING-EXTERNAL, which parks it [shown: 3a383f3a feedback, "[pending] Not done … handed to review"].
2. A parked stage counts as running (`lib/recent-runs.js:81-96`, `runFact`). So the live wait holds the ticket on it (`lib/run-live-wait.js:64-67`).
   The only exception is a close-out parked on the blind read (`lib/code-routes.js:38-44`). A close-out parked on review gets no such exception.
3. So recommend refuses review with STAGE_IN_FLIGHT and says "adopt the id and watch it; the next step is chosen once it ends" (`lib/proxy-instructions.js:808`).
   But the parked close-out won't end until review has run. That is a circular wait.
4. When review ends, its wake goes to the parent (the autopilot), never to the close-out it unblocks (`lib/dispatch-wake.js:170-230`).
   The next recommendation is close-out. Close-out is "live", so the answer is STAGE_IN_FLIGHT again.
5. There are two ways out. The `kind` override can send review, and a `followUpTo` can resume close-out; both skip the live wait (`run-live-wait.js:24-26`).
   This is how the autopilot "pinned the step itself".
- **Only one producer wakes a parked worker** when the thing it waits on changes: the CI wake sweep, and only for CI (`lib/ci-wake-sweep.js:5-12`) [shown].
  Nothing produces a wake when a verdict is written (enqueue callers: follow-up-dispatch, leftover hook, question-answers, ci-wake-sweep, factory) [shown: grep].

## 3. How A3 happens in code

- An answer or a dismissal resumes the asking run (`lib/question-answers.js:2-27`). That part works: the answer resumed the autopilot at 08:25, row 99437e41 [shown].
- An asker can withdraw its own question. The autopilot did this for question-e7563442 [shown: record].
- **But the asker only acts when it runs.** The LIN-4508 autopilot had no rows between the 05:17 wake and the 08:25 answer [shown: LIN-4560 dispatch rows].
  At about 06:15, d22e7fa carried the change live. That was a merge on another task (LIN-4563), not addressed to the asker. So nothing rang it.
- Every one of these questions was `to` the person, so nothing addressed to the asker changed. A question whose asker has already finished has nobody to ring.
  dec1b780 and a9961da7, both from breakdown, sat 59.9 h until John dismissed them [shown: records].

## 4. One cause or two?

- **They share a theme:** a waiting reader isn't told when what it waits on changes.
- **But the causes differ.**
  - A2 is mostly an engine rule. The live wait blocks the very stage the parked one is waiting for. Even a perfect wake can't send review past STAGE_IN_FLIGHT.
  - A3 is a missing prompt. What changed is the world (a merge, a deploy), not a record addressed to the asker.
- **Slice 6 as designed** (design.md §6) rings when a record is open and `to` a stage or task whose run is held.
  - A2: a clean approve writes nothing `to: close-out`, so nothing rings, and the refusal of review stays.
  - A3: the merge is in another task, so nothing rings.
  - The 19 Nov pile: slice 6 adds follow-ups to the same queue, which delivers only between turns. It would add to the pile.

## 5. Options compared

| | (a) Targeted fixes in the clean-up ticket | (b) Slice 6 as designed, absorbing them |
|---|---|---|
| What | A2: a parked stage no longer holds its ticket. When the selector picks the parked stage's own kind, the dispatch resumes it as a follow-up. A3: when a merge is recorded in the project, ring each run parked on an open question it asked, once, with "re-check your open questions; withdraw any that events have overtaken" | One rule: an open record to a held run's stage or task enqueues one follow-up. A compare-and-swap per (run, record). A new edge from Records into Runs (§11.6) |
| Size | About 2 pieces | 3 to 5 pieces as written. It would need a redesign to catch A2 and A3: with that, about 5 to 7 (slice 4 was 15) |
| What it retires | The blind-read special case in the live wait (`code-routes.js:38-44`, `run-live-wait.js:56-67`). Reviews sent by override beside a parked close-out. The autopilot's hand-written resumes. The hand note. finding-34ab47ef. The step-pinning part of John's standing permission | Agents waking each other by hand for hand-offs (C5-B14). That wasn't seen as a cost this week |
| Risk | Another stage could run beside a parked one (only review is expected there). The follow-up into the parked session can hit the runner's RESUMING race (LIN-4569), as seen 4 times below. A3: one short turn per merge for each parked asker (0 to 2 at a time) | A new producer that misses both observed problems. More rows queue for a reader that is mid-turn. A Records ⇄ Runs pair unless the call is passed in |

**Recommendation: (a).** By John's principles:
- It mostly removes: the blind-read exception becomes the rule.
- It drops a planned slice rather than building one.
- The asker still decides whether a question is stale. Code only decides when to ask it to look.
- Both fixes sit in Runs, which already imports Records, so there is no new pair.

## 6. If slice 6 is wanted anyway

- Rebuild it as a doorbell, not letters. Keep at most one queued wake per parked reader, and make the wake say only "read your brief".
- Ring the reader when a record is written in its task by someone else, or when a change merges in the project.
- It would retire the queued-note pile and the A2/A3 fixes above. About 5 to 7 pieces.
- I don't recommend it now. Readers this week were rung within 0 to 3 minutes whenever the autopilot did it (below). The cost was the refusals and the workarounds, not the wait.

## 7. Witness and readings

- **A2 witness.**
  - Unit: a ticket whose close-out is parked after a hand-back, with an open finding to review, recommends review (not live-wait). After an approving verdict on the head, it recommends close-out as a follow-up to the parked lineage.
  - Live: the next conditional approval goes review → close-out → review → merge with no override and no hand-written resume.
- **A3 witness.**
  - Unit: a recorded merge rings a run parked on its own open question, exactly once.
  - Live: the next overtaken question is withdrawn by its asker before the person answers.
- **Baselines from this week** (my reading of the dispatch rows, `spike4/t-*.json`, `c/*.json`):
  - Reviews sent beside an open close-out: 12, plus 2 blind reads, across the 6 A2 tasks (2 per task).
  - Resumes into a parked close-out written by the autopilot: 14 attempts. 4 were refused by the runner: two "still running (RESUMING)" and two "duplicate-launch".
  - Wait from an approving verdict to the close-out resuming: 0 to 3 min when the autopilot did it (LIN-4568, 4557, 4342). 40 min plus a hand note on LIN-4567 (verdict-45224fdc 14:49, resumed 15:29).
  - Hand steps: LIN-4549 had 2 pins and 1 question to John (0.7 h). LIN-4567 had 1 note.
  - Questions overtaken before they were answered: 4 of 14 since 20 Nov (2fea4d20, dec1b780, a9961da7, c2af1113). 2fea4d20 stayed open about 2 h 10 min after it was overtaken, holding LIN-4560 and LIN-4561.
  - Held-run sit times (20 Nov): median 1.0 h; 17.2 h for records `to: implementation`. Whether that 17.2 h was a missing wake is unknown (`readings/slice-2-after.md:94`).
- **Readings to keep:** override reviews per task; resumes the autopilot writes; verdict-to-resume minutes; time a question stays open after the event that overtook it. Report them, never gate on them.

## 8. Against my prediction

- I predicted (`spikes/expect.md`, item 4) that A2 and A3 would both fit slice 6. They don't fit it as designed.
- The risk I named was right: A2 is a small engine fix that belongs in the clean-up ticket.
- **This changes the plan:** step 4 (slice 6) folds into step 2 (clean-up).

## 9. For John

1. Drop slice 6 from the plan, with A2 and A3 fixed in the clean-up ticket? *Proposed: yes. Reopen it only if records to a parked reader are seen sitting.*
2. What should prompt a parked asker to re-check its question: each merge in the project, or a timer? *Proposed: each merge. It is driven by records and needs no clock.*
3. A parked stage no longer holds its ticket, so review can run beside a parked close-out. *Proposed: yes, as the blind read already does.*
