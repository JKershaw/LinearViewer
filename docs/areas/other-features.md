# Other features

Area notes for `other-features` in the registry. Format and rules: README.md.

## Lessons

- This area is the `^lib/` catch-all: a file lands here when no earlier pattern names it.
  A new production file belongs in its owning area, given a pattern in the same change,
  checked in `tests/unit/area-map-placement.test.js`. A file here is often homeless, not
  owned.
- `lib/stage-writes.js` is the stage write allowance the proxy enforces: a prompt telling a stage not to write
  something holds only if the stamp refuses it too. A stage run's `work` token (`isStageRunToken`: a dispatch mint
  that names its run) is refused `createComment`, since its report is records; a Periodical's report is a record
  too (LIN-4533), so the rule can sit on `work` and needs no second stamp.
- When a producer retires, its readers keep their inputs and read them as false forever, and no test fails.
  `lib/task-state.js` kept a `taskScan` fact after the scan was the last thing that could set it (LIN-4540).
  Before deleting a writer, grep for the facts and fields that only it fed, and delete them with it.
