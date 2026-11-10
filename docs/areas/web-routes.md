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
- `routes/task-share.js`: the public timeline fragment shows model names, dispatch item ids and, for a lineage founded elsewhere, that task's identifier, against its own comment; no test fails with its mask removed (0 of 84). (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `routes/collective.js`: the preview returns a prompt carrying the server's `YAP_PASSWORD` to any member who turns on the self-service `collective` flag, and Collective channels on one Yap server are shared across tenants. Send a placeholder, as the proxy token already is. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
