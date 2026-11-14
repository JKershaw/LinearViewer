# Other features

Area notes for `other-features` in the registry. Format and rules: README.md.

## Lessons

- This area is the `^lib/` catch-all: a file lands here when no earlier pattern names it.
  A new production file belongs in its owning area, given a pattern in the same change,
  checked in `tests/unit/area-map-placement.test.js`. A file here is often homeless, not
  owned.

## Waiting

- `lib/stage-writes.js`: since LIN-4468 it is the stage write-allowance table (`STAGE_WRITE_OPS`,
  `stageWriteAllows`, `ISSUE_PATCH_FIELDS`, the `WRITES` vocabulary), a dependency-free leaf that three areas
  read: Agent API x5 (`lib/stage-write-gate.js`, `lib/proxy-tokens.js`, `lib/proxy-preamble.js`,
  `lib/proxy-instructions.js`, `routes/proxy-writes.js`), Runs x2 (`lib/item-stage-stamp.js`, `routes/dispatch.js`)
  and LLM x1 (`lib/prompts/stage-kinds.js`). No registry pattern matches it, so it sits in this catch-all. It takes five of
  Agent API → Other features' six edges (the sixth is the seal's, below), two of Runs → Other features', and LLM's
  only edge into this area. Measured homes: Agent API (beside the gate) or LLM (beside the
  records) each close LLM ↔ Other features and leave Agent API ↔ Other features to the seal, at a cost to an
  existing knot (Runs → Agent API +2, or Agent API → LLM +5). Whose the allowance is, the proxy's policy or the
  stage record's vocabulary, is the guide owner's size of move, not a tidy.
  (Seams & Tangles, 14 Nov.; `docs/reviews/seams-tangles-review-2026-11-14-run13.md`.)
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
  so it sits in this catch-all. It opens the Agent API ↔ Other features pair (6/1 at 14 Nov.: its
  one reverse edge is the seal's import of `lib/proxy-graphql-errors.js`; five of the six forward edges go to
  `lib/stage-writes.js`, the entry above). Moving it to LLM & prompts still closes the pair, leaving five one-way
  edges, but reverses the pin and moves this entry, so it is a size of move for the
  guide's owner, not a tidy. (Seams & Tangles, 8 Nov.; `docs/reviews/seams-tangles-review-2026-11-08-run10.md`.)
