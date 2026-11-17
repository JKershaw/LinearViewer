# Notes: 1-survey-task (task-28, LIN-4472)

**Written** (all open except the run):
- finding-82 → task-28: indent-anchored text slicers, plus two executing suites the plan doesn't list.
- finding-83 → area-49: `relativeWords`/`formatElapsed` duplicate non-leaf lib helpers.
- question-84 → task-28: what to do with those duplicates (on decision-32, about finding-83).
- finding-85 → task-28: `importWorld` gives less than `loadWorld`; use static imports for pure exports (about lesson-67).
- check-86 → task-28: real-browser e2e.
- finding-87 → task-28: minor points, census expectation (about finding-56).
- run-88, ended `done`.

Nothing was addressed to task-28, so nothing was ended or handed on. I left finding-56 open, because deleting it is the builder's job.

**Lookups:** `show --task task-28`, `find --to task-28` (empty), open findings in area-49 and area-50, `get finding-56` and `get decision-15` (Waiting-entry dispositions), and text searches (task-page, relativeAgo, fmtDuration, e2e, importWorld) to avoid writing duplicates.

**Refusals:** none.

**Relied on beyond brief/queries:** the whole substance came from reading the code at 17faa83f4: line numbers, the indent-anchored slice strings, the `vm.runInNewContext` suite, the `relativeAgo`/`fmtDuration` duplicates and their import counts, what `importWorld` lacks compared with `loadWorld`, Node 25's `navigator`, the census value 102, the e2e spec names, and that #2431 had merged. decision-36's "comment on LIN-4463" only told me where to record a deviation.

**Brief carried, unneeded:** the full task-1 ask, lesson-60 (poll discipline), decisions 33 and 34, and the plan's "likeliest ways it breaks" item 2.

**Couldn't place:** whether to address the e2e check to a review stage instead of the task. I don't know the stage names without reading stages.json.
