# S1 result: lanes ask each other, go ahead on silence

Seed (Harbour, 16:00): area-1/2, lanes task-3 (LIN-4447) and task-4 (LIN-4448), children task-5/6 (LIN-4458/4459). Output: `out.txt`.

**Actors.** Played in time order, so actor 4 falls between wakes.
1. **LIN-4458 build, 16:42.** Its brief never named LIN-4448; `find --text LIN-4448` gave task-4. Wrote run-7, decision-8 (boundary), question-9 `to: task-4`, `on decision-8@1`, `if-unanswered: keep as drawn`; ended run-7.
2. **LIN-4459, 16:42.** Wrote run-10, change-11 (PR #2432), question-12 `to: task-4`, `on change-11@1`.
3. **LIN-4448 autopilot, 17:00/20:00/23:00.** Brief part 3 showed every ask; at 17:00 part 6 showed run-10 claiming `lib/llm/registry`. Wrote nothing.
4. **LIN-4459, 17:06.** `get question-12` showed no answer. Revised change-11 to v2 (question-12 went STALE), wrote question-13 ("unless you say otherwise … proceeding to merge"), ended change-11 `merged` that minute, ended run-10.

**Answer.** Each ask reaches whoever briefs on task-4, and nobody else. That is LIN-4448's autopilot, from its next wake. John never sees one; the asker's brief only indexes its asks. Afterwards, silence is three questions left `open` indefinitely. "Went ahead on silence" exists only as free text in change-11's end reason.

**Gaps**
- A question has no end for "lapsed, proceeded on if-unanswered". Questions 9/12/13 stay open or must be falsely `withdrawn`.
- `if-unanswered` has no deadline. question-13 gave a zero-minute window and was accepted.
- At 20:00/23:00 question-13 still asks permission for a done merge; `merged` doesn't make it stale.
- The lane address reaches an autopilot that can't decide; nothing hands it on to a person.
- A wake leaves only read-log rows, with wall-clock `at` and `by: autopilot`; the lane shows only inside `q`.
- change-11 has no natural link to the questions it went ahead on, so the link is retold in prose.

**Refusals:** none.
