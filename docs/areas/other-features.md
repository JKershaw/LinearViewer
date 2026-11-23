# Other features

Area notes for `other-features` in the registry. Format and rules: README.md.

## Lessons

- This area is the `^lib/` catch-all: a file lands here when no earlier pattern names it.
  A new production file belongs in its owning area, given a pattern in the same change,
  checked in `tests/unit/area-map-placement.test.js`. A file here is often homeless, not
  owned.
- `lib/stage-writes.js` is the stage write allowance the proxy enforces: a prompt telling a stage not to write
  something holds only if the stamp refuses it too. The `work` stamp is shared with Periodical runs, whose reports are
  comments, so a rule for stage runs alone cannot go on `work` until the stamp tells the two apart (LIN-4533).
