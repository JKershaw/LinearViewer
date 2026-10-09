# LIN-3372 / LIN-3378: the 8 Oct decision-point replay

Eval fixtures from the LIN-3372 paper (`docs/papers/harbour/what-the-selector-needs.md`). The gate
(`../jev-routing-eval.mjs`) cannot see the shapes behind the four selector misroutes (S1 defer
over plan-review, S2 a leaf whose plan is on its parent, S3 an approving review's ledger, S4
merged-but-not-Done), so these points re-run them.

- `points.mjs` — the 15 decision points and four hops, with the stage the Flight Companion then
  dispatched as `gold`. P1 is wrong in every variant (arguable gold) and the hops are out of the pass bar.
- `harness.mjs` — rebuilds the selector's exact prompt for a ticket as it stood at a past moment, from
  the workspace proxy's issue, dispatch and task-history reads (cached in `.cache/`).
- `replay-points.mjs <label> <K> [ids]` — replays points through the library's own `buildSelectorArgs`.
  No env toggles. `LV=<checkout>` points it at another checkout (run a `main` worktree beside it as the
  control arm: the model splits at temperature 0, so judge concurrent arms, not one batch).

Needs `HARBOUR_LOCAL_BASE` (or `PROXY_BASE` + `PROXY_TOKEN`) and `OPENROUTER_API_KEY`. Output lands
in `runs/` (git-ignored). The raw corpus, runs and gate output stay on `research/lin-3372-selector-context`.
