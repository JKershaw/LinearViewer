# S4 result: two overlapping sessions claim the same item

Actors: session-a, session-b, Lighthouse. Seed (08:00): task-1 weekly read, area-2 `studies/`, task-3 "Write the next study" (child).

**What each actor got and did**
- **A, 09:00.** Briefs held only task-3. A picked LH051 from disk and wrote run-4 claiming `studies/LH051.md`.
- **B, 09:05.** Part 6 empty; part 7 showed bare `run-4 run - weekly-read`. B ran `get run-4`, saw A's open claim on LH051, took LH052 (run-5) and wrote finding-6 to session-a, `on` run-4@1.
- **A, 09:40.** Part 3 held finding-6. A wrote change-7 (LH051, merged); ended finding-6, run-4, task-3.
- **B, 09:45.** Its brief showed neither change-7 nor that task-3 was done. B wrote change-8 (LH052), ended run-5 and task-3 again.

**Answer:** no collision, and both learned of each other, only because B followed an index pointer carrying no owner, state or claim; the brief never pushes the overlap. A first pass where B did not look it up ended with both on LH051. `show` reported overlap `[run-4, run-5]`; neither brief did. Either way, two studies were written for one due item.

**Gaps**
- Part 6 lists only runs of *other* tasks: a same-task overlap (this case) never reaches the brief. Only `show` has it.
- The study numbers have no home in the store and no uniqueness check. A run's claim works as a lock only if the session picks its number first.
- A study has no kind. Stored as git-shaped `change`.
- An ended task still shows in part 1 with no state, and ended changes are left out, so B could not see that the item was already done.
- Re-ending task-3 was accepted, overwriting A's stateReason.
- If both sessions run as one actor, `to` cannot address the other.

**Refusals:** none.
