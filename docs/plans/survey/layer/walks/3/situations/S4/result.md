# S4 result: two overlapping sessions claim the same item

**Seed (08:00):** area-1 studies; task-2 "The weekly read." (John); finding-3 "Due: write the next study." to task-2.

**Refusals (verbatim):** `run-4: by Session A is not a declared stage or person` and `run-5: by Session B is not a declared stage or person` (rule 5). Both acted as `implementation`.

**Actors.**
- A (09:00): brief held finding-3; `find --path studies/` showed no studies. A took LH051 from disk and wrote run-4 claiming `studies/LH051.md`.
- B (09:05): brief held finding-3 and index line `run-4 run: implementation` (the stage, not the account or claims). B learned of A only by looking up the next study number: `find --path studies/` returned run-4's claim. B wrote run-5 (LH052) and finding-6 to John; a run can't be addressed.
- A (09:30): no fresh brief; wrote change-7, ended finding-3.
- B (09:35): wrote change-8. Ending finding-3 was refused, `finding-3 has already ended (done)`: B's only sign A had finished.

**Answer.** Record ids can't collide (layer-allocated). Study names avoided a collision only because B chose to look: nothing makes `ref` or `claims` unique, and `check` is clean. B learned; A never did. Nothing routes run-5 or finding-6 to A; the due item has no "taken" state.

**No home:** session identity (A and B are both `implementation`, so either may end the other's run); the study numbering.
**Hand-off with no reader in time:** finding-6 (John, read next day).
**Needed, not found:** "who is on this now", unasked.
