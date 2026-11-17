# Walk 3: what the design predicts, written before looking

*Written 17 Nov from `design.md` round 3 (`83db519`), before the round 3 model is in use or anything is seeded, replayed or played. Each line is a prediction [my reading]; afterwards each is marked **held**, **failed** or **can't tell**, with why. Misses that deterministic code or a full build would absorb are listed, not scored (design §5).*

*How it runs: the three tasks as in walk 2, each stage a fresh agent with its brief, its real output and its kinds, now allowed `get`, `find` and `show`. The six scenes (`situations/scenes.md`) are each played by one agent acting as each actor in turn, so they test containment and routing, not whether a brief is enough.*

## LIN-4450, the control against walk 2

1. **Retelling stops.** The empty-fence defect, the live check and the bulk-path gap are one open record each at any moment, joined by links or hand-ons; at most one duplicate in the whole task (walk 2: three of each).
2. **Stages look things up.** At least half the stages run a query; what they look up is mostly records from the index.
3. **The place is addressable.** "Not this task's" findings go to the providers area by its id; nothing goes to an unknown name; no second providers area.
4. **Briefs shrink below walk 2 at every stage,** and from scoping on are smaller than the child ticket that stage saw. Survey-task's under 9,000 characters; close-out's under 15,000. Reported, not scored.
5. **Stale is right.** Review's and blind read's verdicts show stale after close-out moves the head, and don't go stale at merge. The breakdown's decision shows stale through the chain once implementation revises piece 1.
6. **Open counts are honest.** Close-out's brief carries 12 or fewer open records.
7. **The leftover writes as a declared stage** and ends the area entry it settled, with the reason.

## LIN-4472: a question, the autopilot, and an answer elsewhere

8. **Scoping's question goes to John,** with options, a recommendation and an if-unanswered default, as the real ruling had.
9. **The autopilot has no place.** It is not a declared stage or person, so its attempt to settle the question is refused. *Why it matters:* in Harbour it really decides things; the design hasn't said what it is.
10. **The build goes ahead with the question open,** seeing it in its index and acting on the if-unanswered default, and says so.
11. **John's answer ends the question,** wherever he gives it, as the one decision on it. Four accounts (ruling, autopilot comment, parent note, John's answer on the child) become one question and one decision.

## LIN-4455: a tidy under autopilot

12. **The area's Waiting 2, 4 and 11 are ended** by the stage that settled them, each with the reason.
13. **The departures become a new version of piece 5.**
14. **The autopilot's run summary has nothing to write:** what it retells is already in the records, and `show` gives it. If it writes, it is refused (as in 9) or it duplicates.

## The six scenes

15. **S1, lanes on silence.** Each ask is an open question to LIN-4448's task with an if-unanswered default. LIN-4459's merge on silence is recorded as acting on that default, and the question stays open, not consent. *But* nothing brings the asks to anyone during the night unless LIN-4448's next stage runs: no waking. Half.
16. **S2, the withdrawn ruling.** If the builder's "merge waits on it" rests `on` the question, it shows stale after the withdrawal. If it only links `about`, the false line stays: `about` carries no state. I expect the second. A break if so.
17. **S3, the copied count.** No actor types the count; each runs `find`. No two can disagree.
18. **S4, the double claim.** Ids don't collide (the layer allocates them). But the second session doesn't learn the first is writing the same study unless it looks for open runs: there is no rule or view for overlapping claims. A break.
19. **S5, the pile.** Ten proposals to John stay open; nothing ends them; near-repeats are linked `same-as` only if the sixth run looks. The pile grows, smaller than a file and each item endable, but nothing ends it alone. A design gap: no expiry or re-surfacing.
20. **S6, no git, no tracker.** Every record has a home. The newsletter is a `change` with a file version as its head, and the verdict is `on` it. Holds with a stretched `change`.

## What would count as a break

As design §5, each with why: something with no home; a hand-off to no reader; a retold thing that should be one record; a stage that needed something it couldn't find by brief or query; a rule refusing something right.
