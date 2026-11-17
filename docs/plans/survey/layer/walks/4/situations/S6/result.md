# S6 result: a newsletter with no git and no tracker

**Seed (Harbour, 09:00):** area-1 `newsletter/`, lesson-2 (phones, <400 words), task-3 (`--via John`).

**Actors**
- **survey-task (10:00):** its brief had task-3 and an index line for lesson-2. It wrote run-4, task-3@2 (done-when), question-5 to John (the three facts, none of which are in the store), question-6 to John (how to send it), and finding-7 to implementation (`on` lesson-2@1).
- **implementation (11:00):** got finding-7 in part 3. It looked up task-3, because done-when is not in the brief, and question-5, which was still open. It wrote `newsletter/march.md` (118 words, 12 `[TBC]` markers), then run-8 and change-9 (`ref file:newsletter/march.md`, `head sha256:afcc54e0dee8`, `on` task-3@2). It ended finding-7.
- **review (13:00):** change-9 showed up only as an index line. Review read the file and checked the hash. It wrote verdict-11 (request-changes, `on` change-9@1) and finding-12 to implementation, and ran run-10.
- **close-out (15:00):** part 4 showed verdict-11, and questions 5 and 6 were open. It did **not** send. It wrote run-13, which ended "not sent".

**Answer:** yes, every record found a home. The `change` kind took a file version: a path as `ref` and a content hash as `head`. A verdict is `on` change@v, meaning one file hash. A probe on a copy ran a revise of `head`, and after it verdict-11 showed as **STALE**.

**Gaps**
- The verdict points at bytes the store does not keep. The file gets overwritten, so the version that was judged cannot be recovered. Git would have kept it.
- "Sent" has no end state. On the probe, `end change-9 merged` was accepted, which is malformed: nothing was merged. Who it went to, by which channel and when only fit in the free-text reason.
- `end task-3 done` was accepted on the probe while the verdict asked for changes and both questions were open.
- John asked for the task, but that is recorded only as `via`, so it has no field of its own.
- Done-when needed a lookup because the brief does not show it.
- Implementation handed off to review without addressing anyone. A change has no `to`.
- None of the facts were in the store, and John is not an actor, so the scene's line "sends it" could not be played.

**Refusals (verbatim)**
- `{"refused": "no record run-11"}`: my own id slip. It was right and has been fixed.
- `{"refused": "sent is not an end of change"}` (probe)
