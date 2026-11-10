# Other features

Area notes for `other-features` in the registry. Format and rules: README.md.

## Lessons

- This area is the `^lib/` catch-all: a file lands here when no earlier pattern names it.
  A new production file belongs in its owning area, given a pattern in the same change,
  checked in `tests/unit/area-map-placement.test.js`. A file here is often homeless, not
  owned.

## Waiting

- `lib/cost-format.js`: still in the catch-all, as is LIN-4203's
  `lib/usage-snapshot-intake.js`, while the rest of the cost code moved to Runs & dispatch
  (LIN-4201). (Survey tally: LIN-4176, LIN-4195, LIN-4201.)
- `lib/home-view.js`: split it (over 600 lines), and separate `upNextOf`'s eligibility
  from its ranking, so both lists filter one candidate model. The module threads `shown`,
  `waiting`, `linked` and `onHome` through every placement. (Survey tally: LIN-4151,
  LIN-4144.)
- `lib/home-view.js`: one ranking for "what's next" everywhere. `compareRank` here sits
  beside `orderIssuesForSwipe` in `lib/task-board-view.js`. (Survey tally: LIN-4151 and
  the 11-03 Drift review's three rankers.)
- `lib/key-state-holders.js`: per-key state is reset through this test-side registry; a
  per-workspace state container in production would let a reset drop the container
  instead. (Survey tally: LIN-4168.)
- `lib/as-asked-seal.js`: homeless by a deliberate pin in `tests/unit/area-map-placement.test.js`,
  so it sits in this catch-all. It opens the Agent API ↔ Other features pair (2/1, through
  `routes/proxy-writes.js` and `lib/proxy-graphql-errors.js`). Moving it to LLM & prompts
  closes the pair, but reverses the pin and moves this entry, so it is a size of move for the
  guide's owner, not a tidy. (Seams & Tangles, 8 Nov.; `docs/reviews/seams-tangles-review-2026-11-08-run10.md`.)
