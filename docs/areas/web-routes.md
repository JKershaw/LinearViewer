# Web routes (pages & workspace API)

Area notes for `web-routes` in the registry. Format and rules: README.md.

## Waiting

- `routes/test.js`: fold the `/test/clear-*` routes into the key-state registry
  (`lib/key-state-holders.js`), split the file, and give `createTestRoutes` one context
  object. (Survey tally: LIN-4168.)
- `routes/dashboard-rulings.js`: the rulings badge counts through
  `collectUnansweredDecisions` (`lib/unanswered-decisions.js`), while Home's Waiting on you
  reads `readRulingStanding` (`lib/ruling-standing.js`, via `lib/home-row-states.js`). Two
  reductions of one set, which counted differently when it was named. One rulings
  reduction for both. (Survey tally: LIN-4144.)
- `routes/dashboard-summaries.js`: the run-summary and session-summary handlers paste the
  same `truncationFailureOf` arm that `routes/proxy-compute.js` repeats four times; one
  owner for mapping a cut-off to its reply. (Area reads CG/CH, 8 Nov, on LIN-4358.)
