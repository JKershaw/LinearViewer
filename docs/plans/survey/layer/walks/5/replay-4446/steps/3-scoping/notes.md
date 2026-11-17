# 3-scoping notes (task-9 / LIN-4446)

**Written:** decision-26 (in task-9, scope task-9, on finding-16, finding-12, about task-9): size is just the task, no cuts, decided by a ruling. run-27 added and ended `done`.
**Revised:** findings 11, 13, 16, 22 and 23 re-addressed from `scoping` to `design`. They shape the slice, not its size. Then re-pins: decision-26 (v2, v3) and finding-16 (v3).
**Ended:** run-27 only. I left all the findings open because scoping closed none of them.

**Looked up:** `show --task task-9`, to see the records and their state. `find --kind decision`, to check that no size decision existed already (none did). `find --kind run --in task-9`, for the survey accounts. `show` again, which surfaced stale flags.

**Refusals:** `{"refused":"a decision takes no to"}`. I dropped `to` and re-added. So the decision cannot be addressed to design; design only finds it through `in`.

**Spurious staleness:** changing only `to` counts as a revision. decision-26 went stale on finding-16@1. Then finding-16 went stale on 11@1 and 13@1, and the decision went stale through it. That took three extra re-pin writes to clear. Re-addressing should not make anything stale.

**Relied on beyond brief/queries:** the ticket's "Size of the move" format (Size / Why / Cuts / Decided by) and the allowed size values ("just the task"). Neither came from the brief. Also that the description is where the size lands.

**Brief carried but not needed:** the detail in findings 11, 13, 22 and 23 (vm harness, vendor-assets, the rule's limits), lesson-2, and findings 14, 15, 20, 24 and 25. The size needed only the ask, finding-16 and finding-12.

**Couldn't place:** which actor follows scoping for a "just the task" size. I assumed `design`.
