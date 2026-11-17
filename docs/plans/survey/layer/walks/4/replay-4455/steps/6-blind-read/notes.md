# Notes: 6-blind-read (task-60)

**Written** (15:54:33–40Z):
- run-95 (task-60), ended `done`.
- verdict-96 blind-read `better`, on change-80@1.
- finding-97 → leftover: floating comments in run-view, session-telemetry, wall-clock-summary.
- finding-98 → leftover: `setHeldWakeReleaseNote?.` optional chaining vs required `@param`.
- finding-99 → area-1: `mayCarryWake` always true; run-view `lastWakeEntry` contradicts it. About question-75.
- finding-22 (Waiting 5, → area-1) revised: added the redundant second channel and the store mutation at build. I revised it instead of adding a duplicate.
- finding-100 → task-39: runner-kickoff imports through the store's re-export shim (prompts side). About decision-81.
- Ended nothing. The checks belong to close-out, and question-75 is not mine to settle.

**Looked up:** `show --task`, open records to area-1, and `--text` for lastWakeEntry, run-view, runner-kickoff, mayCarryWake, setHeldWakeReleaseNote and re-export, to avoid duplicates. Also finding-22/69/70/72/74 and question-75, plus the area and task lists, to find who should get the prompts finding.

**Refusals:** none.

**Relied on beyond brief/queries:** the PR diff itself at c95b9f139 against c205190fd: the comment text left in three files, the `?.` call, `feedbackKindMayCarryWake`'s unknown-kind default, `lastWakeEntry`'s stamp skip, `_releaseNoteFor`, and runner-kickoff's import line. Also the base commit c205190fd, which no record names.

**Brief carried, unneeded:** decisions 61–65 (grounding, sizing, blocking graph), the plan's witness wording, close-out checks 91–94, and lessons 3/4.

**Couldn't place:** there is no actor, area or task for llm-and-prompts (A14/LIN-4448), so finding-100 went to the parent task-39. The "fix-sized" items have no obvious owner, so I sent them to `leftover`.
