# S4 result: two overlapping sessions claim the same item

Actors: `model/actors.json` = session-a, session-b, Lighthouse. Seed (08:00, Lighthouse): task-1 the weekly read, area-2 `studies/`, task-3 "Write the next study" (child of task-1).

**What each actor got and did**
- **A, 09:00.** Brief on task-1 listed only task-3; task-3's brief had nothing. A picked LH051 from disk and wrote run-4 claiming `studies/LH051.md`.
- **B, 09:05.** Brief part 6 was "(none)". Part 7 showed a bare `run-4 run - weekly-read`. B ran `get run-4`, saw A's open claim on LH051, took LH052 (run-5) and wrote finding-6 to session-a, `on` run-4@1.
- **A, 09:40.** Part 3 held finding-6. A wrote change-7 (LH051, merged), then ended finding-6, run-4 and task-3.
- **B, 09:45.** Its brief showed neither change-7 nor that task-3 was done. B wrote change-8 (LH052, merged) and ended run-5 and task-3 again.

**Answer:** no id collision, and both sessions learned of each other, but only because B followed an index pointer that carries no owner, state or claim. The brief itself never pushes the overlap. A first pass where B did not look it up ended with both on LH051. `show` then reported overlap `[run-4, run-5]`, but neither brief did. Either way, two studies were written for one due item.

**Gaps**
- Part 6 lists only runs of *other* tasks, so a same-task overlap (this exact case) never reaches the brief. The overlap is visible only through `show`.
- The study numbers (LH051 and so on) have no home in the store and no uniqueness check. A run's claim works as a lock only if the session picks its number first.
- A study has no kind. It is stored as `change`, a git-shaped record.
- An ended task still shows in part 1 with no state, and ended changes are left out, so B could not see that the item was already done.
- Ending task-3 a second time was accepted and replaced A's stateReason as the latest reason.
- If both sessions run as one actor, `to` cannot address the other.

**Refusals:** none.
