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
- `routes/task-share.js`: the public timeline fragment shows model names, dispatch item ids and, for a lineage founded elsewhere, that task's identifier, against its own comment; no test fails with its mask removed (0 of 84). (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `routes/collective.js`: the preview returns a prompt carrying the server's `YAP_PASSWORD` to any member who turns on the self-service `collective` flag, and Collective channels on one Yap server are shared across tenants. Send a placeholder, as the proxy token already is. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `routes/test.js`: the e2e server has no egress guard, so a live call is seen only if it logs an
  error; the task-facts refresh (`lib/task-facts-holder.js`, Other features) calls GitHub live with a
  seeded fake token. A size of move: a standing guard like the unit `test:hermetic` that fails the
  e2e job on any non-loopback connect. LIN-3815 fixes named sites, not the guard. (Test Coverage Gap Review, 11 Nov.; `docs/reviews/test-coverage-gap-2026-11-11.md`.)
- `routes/workspace-api-feedback.js`: a feedback screenshot on a Jira workspace is refused 422,
  because Jira has no `uploadFile` and an attachment needs an issue to exist first. Deciding
  whether to file the words without the picture, or to upload after the create, is open. (LIN-4451
  Survey global; a live check belongs with LIN-4452.)
- `routes/workspace-api-issue-write.js`: "a create field the provider does not declare is a 400" is
  spelled per field here (against `createFields()`), as a loop over `apiWriteFields()` in
  `routes/proxy-writes.js`, and not at all in feedback (`routes/workspace-api-feedback.js`), which
  picks its env defaults by provider name (`feedbackEnvDefault`, `jira`) instead of a provider
  declaration. One create pipeline with one resolver and one refuse-or-drop rule would make it one
  rule. (LIN-4451 Survey global; leftovers.)
