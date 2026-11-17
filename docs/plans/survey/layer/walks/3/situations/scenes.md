# Walk 3 situations

*Six short scenes from the traces' leak moments that the three task replays don't cover. Quotes are from `trace-2026-11-15/6-LIN-4448.md` and `picture.md` §9 on `claude/peaceful-euler-thz7ct` at `fff543172` [checked]. Each scene is played by one agent that acts as each actor in turn: before each actor acts, it computes that actor's brief (or, for a person, `find` what is addressed to them) and acts only on that plus the actor's line below. The scenes test containment and routing; the task replays test whether a brief is enough.*

*Each scene starts from an empty store, seeded with only what the scene needs, at the times given (all 13–14 Nov 2026, UTC, unless said).*

## S1. Lanes ask each other, and go ahead on silence (trace 6, rows 13–14)

**What happened:** "From LIN-4458: renews the classifier-home ask and draws a census boundary: "tell me on LIN-4458 if you want it drawn differently"." "No reply appears on the parent's trail." "From LIN-4459: a renewed ask on the live-wait move (PR #2432); then an import change and one retired LLM entry, "unless you say otherwise … proceeding to merge"." "Nobody answered; it merged." "So the three asks from LIN-4458 and LIN-4459 got no reply, and those lanes went ahead on silence." Meanwhile LIN-4448's autopilot was waking all night (67 wakes).

**Seed:** two lanes: parent LIN-4447 (Runs & dispatch) with children LIN-4458 and LIN-4459; parent LIN-4448 (LLM & prompts). One area each.

**Actors, in order:**
1. LIN-4458's build session (16:42): asks LIN-4448's lane whether the census boundary is drawn right; if no answer, it keeps the boundary as drawn.
2. LIN-4459's session (16:42): asks LIN-4448's lane to agree the live-wait move.
3. LIN-4448's autopilot wakes (17:00, 20:00, 23:00): it reads what is addressed to its lane.
4. LIN-4459's session (17:06): "unless you say otherwise … proceeding to merge"; it merges.

**The question:** where does each ask go, who sees it and when, and what does silence mean in the record afterwards?

## S2. A withdrawn ruling leaves a false line (trace 6, rows 23–24)

**What happened:** a LIN-4469 builder wrote on the parent LIN-4448: "the ruling `lin-4469-witness` … gates merge". The ruling was "raised by the autopilot under the parent's loop, with `record_on: LIN-4469`; withdrawn", with "Nothing left on the parent's trail". "A withdrawn ruling left #21 saying something false".

**Seed:** parent LIN-4448, child LIN-4469 with an open change.

**Actors, in order:**
1. LIN-4469's autopilot (22:50): raises a question to John: may the merge go ahead without the witness?
2. LIN-4469's builder (23:11): records that merge waits on that question.
3. LIN-4469's autopilot (23:40): withdraws the question.
4. A reader of LIN-4448 the next morning (09:00): what is LIN-4469 waiting on?

**The question:** after the withdrawal, does anything in the record still say merge is gated?

## S3. A count copied five ways (trace 6c)

**What happened:** "The Waiting counts 26, 25, 23, 22 and 12 were each right at their commit, yet #5 calls the ask's 26 wrong." A byte figure "went stale once close-out changed the PR; #27 caught it by reading the PR body".

**Seed:** an area with 26 open findings addressed to it.

**Actors, in order:**
1. The ask's writer (10:00): needs the number of open findings for the area to state the task's scope.
2. A child build (12:00): ends 1 finding.
3. A plan reviewer (13:00): needs the number.
4. Two more builds (15:00, 16:00): end 2 and 1.
5. A reviewer (17:00): compares the ask's number with today's.

**The question:** does any actor have to type the count, and can any two disagree?

## S4. Two overlapping sessions claim the same item (Lighthouse, picture §9 #6)

**What happened:** "Runs do overlap: a Codex session ran across a scheduled run, and two dispatches ran together on 26 Sep. The blindness appeared: two overlapping sessions both allocated study LH051."

**Seed:** a project with no tracker (one task, "the weekly read"), an area for studies, and one due item: "write the next study".

**Actors, in order:**
1. Session A (09:00): starts the weekly read; it will write the next study.
2. Session B (09:05, overlapping): starts the weekly read too; it will write the next study.
3. Both record the study they write.

**The question:** do the two collide on an id, and does either learn that the other is doing the same work?

## S5. Proposals pile with nothing declining them (Lighthouse, picture §9 #1)

**What happened:** "`proposals.md` went from nothing to 91 KB, with "Declined, parked and expired: (none yet)"."

**Seed:** a project with no tracker, the keeper John, one area.

**Actors, in order:**
1. Five runs over five days (each 09:00, 14–18 Nov): each proposes two changes to the keeper, one of them a near-repeat of an earlier one.
2. John does not answer.
3. A sixth run (19 Nov): what is open for the keeper, and what does it add?

**The question:** does the pile still grow, does anything end, and are the near-repeats seen as repeats?

## S6. A task with neither git nor a tracker (design-plan, "a paper walk")

**What happened:** nothing yet; this is the project kind the design has not met.

**Seed:** a project run through Harbour's local workspace, no repository: a small club's newsletter. Task: "Write the March newsletter: the AGM date, the new treasurer, and the spring fixtures", asked by John. One area, "newsletter", with one lesson ("members read on phones; keep it under 400 words").

**Actors, in order:** survey-task, implementation (writes the newsletter, saved as a file version, not a commit), review (judges it), close-out (sends it).

**The question:** does every record have a home with no PR or commit, and what is a verdict `on`?
