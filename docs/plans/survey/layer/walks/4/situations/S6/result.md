# S6 result

**Seed (Harbour):** area-1, lesson-2, task-3 (`--via John`).

**Actors**
- **survey-task (10:00):** given task-3 and lesson-2. Wrote run-4, task-3@2 (done-when), question-5 to John (the three facts, which no one holds), question-6 to John (how to send), and finding-7 to implementation (`on` lesson-2@1).
- **implementation (11:00):** given finding-7. Looked up task-3 and question-5 (open). Wrote `newsletter/march.md` (118 words, `[TBC]` facts), run-8, and change-9 (`ref file:newsletter/march.md`, `head sha256:afcc54e0dee8`). Ended finding-7.
- **review (13:00):** saw change-9 only in the index. Wrote run-10, verdict-11 (request-changes, `on` change-9@1) and finding-12 to implementation.
- **close-out (15:00):** given verdict-11, with questions 5 and 6 open. Did not send. Wrote run-13 ("not sent").

**Answer:** yes, every record found a home. The `change` kind holds a file version: path as `ref`, content hash as `head`. A verdict is `on` change@v, meaning one hash. A probe that revised `head` made verdict-11 show as STALE.

**Gaps**
- The store keeps no bytes for that hash. Saving over the file loses the judged version.
- "Sent" has no end state. The probe accepted `end change-9 merged`, which is malformed. Channel, recipients and time fit only in the free-text reason.
- The probe accepted `end task-3 done` despite request-changes and the open questions.
- John as the asker is recorded only as `via`.
- Done-when is not in the brief, so it needed a lookup.
- No one is addressed when implementation hands off to review: a change has no `to`.
- None of the facts were in the store and John is not an actor, so "sends it" could not be played.

**Refusals (verbatim)**
- `{"refused": "no record run-11"}`: my id slip. It was right and has been fixed.
- `{"refused": "sent is not an end of change"}` (probe)
