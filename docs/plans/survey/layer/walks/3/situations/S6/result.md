# S6 result: a task with neither git nor a tracker

**Seed:** `area-1` (newsletter) and `lesson-2` by Harbour; `task-3` by John (paths `newsletter/2027-03.md`).

**What each actor was given and did:**
- **survey-task:** its brief held the words, `area-1`, and `lesson-2` in the index. The record holds none of the three facts. It wrote `finding-5` to implementation ("use marked placeholders") and `check-6` to John (confirm the facts).
- **implementation:** its brief held `finding-5`, with `check-6` in the index. Recording the file version as it really is was refused: `{"rule":"3.2","msg":"change-8: change has no field file"}`, plus the same for `version`. It used `change-8` instead (ref = file, head = "local file version 1"), then ended `finding-5`.
- **review:** `change-8` reached it only as an index line, so it ran `get`. It wrote `verdict-10`, approve-with-notes, **on `change-8@1`**.
- **close-out:** its brief held `verdict-10`, with `check-6` in the index. Ending the change as sent was refused: `{"rule":"3.2","msg":"change-8: sent is not a state of change"}` and `"sent is not an end of change"`. It used `merged`, then ended `task-3` done.

**Answer.** Every record found a home, but only by stretching `change`: ref = a path, head = a free-text version label, and "merged" stands for "sent". `verdict-10` is on `change-8@1`, a record version. It is not the file's content: no hash and no snapshot. The file can be overwritten and the verdict will still look current.

**Gaps:**
- The newsletter text, who received it and proof of sending have no home; they exist only in run accounts.
- `check-6` reached no reader. `task-3` closed over it because rule 1 counts only records addressed `to` the task, so the newsletter went out with its placeholders.
- Retold: `finding-5` restates `lesson-2`, and `verdict-10` restates `check-6`.
