# LIN-3937: where each cost decision lives

Grounded at `origin/main` `4a6a4e50` (LIN-3936's design note is on main at `docs/plans/costs.md`). Every file:line below was printed at that sha and checked against its symbol; the research at `856d8ae6` cites the same lines, and `git log --since=2026-10-25T10:59:22Z -- <cost files>` is empty, so nothing has moved. Move 3 is judged against the target in §3.

## 1. Rules

**Site.** A function, or a module-level constant, in `server.js`, `lib/`, `routes/` or `public/` whose own body states part of a decision's rule: its arithmetic, predicate, constant or precedence. A caller that only passes a site's result through does not count. A caller that re-applies part of the rule (re-divides, re-gates, re-sums, re-windows) does count. Tests, docs, `scripts/` and `experiments/` do not count.

**Owner.** "The area that would have to change if its rule changed", named by `scripts/code-shape/areas.json` (first match wins). The owner of each site is resolved from that file, not assumed.

**Decision.** A rule the surfaces apply to a dispatch row, a call, or a window. Nine are listed; D1–D8 are counted, D9 is recorded but not targeted.

## 2. Surfaces (what a person or agent sees)

| # | Surface | Entry → cost code |
|---|---|---|
| S1 | `GET /api/proxy/issues/:id/cost` | `routes/proxy-compute.js:643` → `lib/task-cost.js:85` + `lib/llm-call-log.js:252` |
| S2 | Settings › Health "Harbour's AI calls" | `routes/settings.js:260` → `lib/llm-call-log.js:161` → `lib/render-settings.js:209,609` |
| S3 | `/kpis` "Cost per finished task" | `lib/kpi-stats.js:1136` → `lib/terminal-marked-task-cost.js:215`; `lib/kpi-stats.js:1304` publicCost; `lib/render-kpis.js:132,161` |
| S4 | Observation feed: a session's derived cost | `lib/session-telemetry.js:471` stored by `lib/observation-sessions-store.js` (`BUILDER_VERSION = 20`, `:192`) |
| S5 | Model picker display prices | `lib/openrouter.js:250,260,273` → `lib/model-pricing.js:203`, plus the live catalog |
| S6 | Settings › Models: spend per job | LIN-3855, **not merged**. Adds `lib/model-routing-spend.js` and `LlmCallLogStore.listInHorizon`. Pending |
| S7 | Workspace KPIs "API-equivalent cost" per day | `routes/workspace-kpis.js:29` → `lib/workspace-kpi-stats.js:83` → `lib/weekly-budget.js:121` → `lib/render-workspace-kpis.js:46,146` |
| S8 | Effort read-out: cost per kind and per group | `routes/dashboard-effort.js:241` → `lib/effort-readout.js:430` (`buildTaskCost`), sums at `:331`, `:464` → `lib/render-effort-readout.js:20` |
| S9 | Session/run page: step cost and header total | `lib/run-view.js:206,376` → `lib/render-session.js:270,343`, `lib/render-run-steps.js:270` |
| S10 | Observation "due scan" cost estimate | `routes/dashboard-feed.js:630` → `lib/llm-call-log.js:307` → `lib/render-observation.js:66` + `public/observation.js:3616` |
| S11 | Flight Companion per-tab check-in cost | `public/flight-companion.js:425,1911` (browser; sums `usage.cost` from SSE) |
| S12 | Ship biscuit "Weather" input | `routes/ship-biscuit.js:155` → `lib/llm-call-log.js:161` → `lib/ship-biscuit.js:436` |
| S13 | Weekly-budget gauge | `lib/kpi-stats.js:1142` → `lib/weekly-budget.js:160`. Computed on every `/kpis` build, dropped from the public stats (`tests/e2e/kpis.spec.js:93`) |

The design note's five surfaces (S1–S5) are all present; S6 is pending LIN-3855; S7–S13 are not in the note.

## 3. Decisions, sites, counts, owners

Owners are from `areas.json`: LLM & prompts, Runs & dispatch, Reports & operator tools, Platform & plumbing, Agent API (proxy), Front end: server-rendered pages, Front end: browser code.

| Decision | Site (file:line) | Owner | Mutant (judge) |
|---|---|---|---|
| **D1 Rates** | `lib/model-pricing.js:111` MODEL_PRICING rows | LLM & prompts | `D1-model-pricing-row` |
| | `lib/model-pricing.js:185` getModelRate | LLM & prompts | `D1-getModelRate` |
| | `lib/model-pricing.js:232` resolveWorkerModelId | LLM & prompts | `D1-resolveWorkerModelId` |
| | `lib/model-pricing.js:278` selectRateForPrompt (long-context tier) | LLM & prompts | `D1-selectRateForPrompt` |
| | `lib/openrouter.js:273` getModelPricingHint (per-token→per-1M, `-1` rejection) | LLM & prompts | not run |
| | `lib/pricing-conformance-sweep.js:52` restates the tier vocabulary | Reports & operator tools | not run |
| **D2 Pricing one usage report** | `lib/model-pricing.js:347` computeUsageCostUsd | LLM & prompts | `D2-computeUsageCostUsd` |
| | `lib/session-telemetry.js:471` native-wins precedence | Runs & dispatch | `D2-native-wins` |
| | `lib/run-view.js:215` "priced means finite and > 0" | Runs & dispatch | not run |
| | `lib/observation-sessions-store.js:192` BUILDER_VERSION (stored derived cost) | Runs & dispatch | not run |
| **D3a Lineage identity** | `lib/task-cost.js:51` anchorFor | Runs & dispatch | `D3a-task-cost-anchorFor` |
| | `lib/dispatch-lineage-status.js:69` anchorFor (copy) | Runs & dispatch | not run |
| | `lib/dispatch-lineage.js:176` lineage key `rootItemId \|\| _id` (no feedback fallback) | Runs & dispatch | `D3a-dispatch-lineage-key` |
| **D3b Combining a session's reports** | `lib/task-cost.js:120` parseUsage(merged), last report wins | Runs & dispatch | `D3b-task-cost-parseUsage-merged` |
| | `lib/dispatch-lineage.js:56` usageOf, last report per row | Runs & dispatch | `D3b-usageOf-last` |
| | `lib/terminal-marked-task-cost.js:142` reduceLineageCost (opencode sums) | Runs & dispatch | `D3b-reduceLineageCost-opencode-sum` |
| | `lib/run-view.js:206` lineageCost (`CUMULATIVE_HARNESS` at `:187`) | Runs & dispatch | not run |
| | `lib/model-pricing.js:367` override gate (`harness !== 'opencode'`) | LLM & prompts | `D3b-model-pricing-override-harness` |
| **D4 A call's cost** | `lib/openrouter.js:478` extractUsage | LLM & prompts | not run |
| | `lib/llm-call-log.js:68` record (`cost: num(call.cost)`) | LLM & prompts | not run |
| | `lib/llm-call-log.js:161` summarize (missing → $0) | LLM & prompts | `D4-summarize-missing-zero` |
| | `lib/llm-call-log.js:252` summarizeByIssue (missing → unpricedCalls) | LLM & prompts | `D4-summarizeByIssue-unpriced` |
| | `lib/llm-call-log.js:307` summarizeByFeature (missing → out of the mean) | LLM & prompts | `D4-summarizeByFeature-mean` |
| | `public/flight-companion.js:425,1911` (missing → $0; tab total) | Front end: browser code | not run |
| **D5 By ticket** | `routes/proxy-compute.js:686` lineage sibling batch (unscoped by ticket), 30-day bound | Agent API (proxy) | `D5-proxy-compute-siblings` |
| | `lib/task-cost.js:175` fullyPriced gate | Runs & dispatch | `D5-task-cost-fullyPriced` |
| | `lib/terminal-marked-task-cost.js:403` per-issue sum | Runs & dispatch | `D5-terminal-marked-issue-sum` |
| **D6 By day and by period** | `lib/weekly-budget.js:121` windowedSpend (skipped excluded) | Runs & dispatch | `D6-windowedSpend-skipped` |
| | `lib/weekly-budget.js:160` computeWeeklyBudgetGauge (checkpoint basis at `:172`) | Runs & dispatch | `D6-gauge-checkpoint` |
| | `lib/effort-readout.js:331` group sum | Runs & dispatch | not run |
| | `lib/effort-readout.js:464` total sum | Runs & dispatch | not run |
| | `lib/llm-call-log.js:161` 30-day total (a second use of this site) | LLM & prompts | `D6-summarize-30-day-window` |
| | `lib/run-view.js:376` header total (all lineages cumulative and priced) | Runs & dispatch | not run |
| **D7 Per finished task** | `lib/terminal-marked-task-cost.js:215` computeTerminalMarkedTaskCost, `done` gate at `:334` | Runs & dispatch | `D7-terminal-marked-done-gate` |
| | `lib/kpi-stats.js:1304` publicCost (re-divides, rounds to cents) | Reports & operator tools | not run |
| **D8 Read window** | `lib/read-horizon.js:21` READ_HORIZON_DAYS | Platform & plumbing | `D8-read-horizon` |
| | `lib/dispatch-lineage.js:19` OUTCOME_WINDOW_DAYS (independent constant) | Runs & dispatch | `D8-outcome-window` |
| | `lib/workspace-kpi-stats.js:44` LONG_WINDOW_DAYS | Reports & operator tools | not run |
| | `lib/render-observation.js:66` the "30-day" copy | Front end: server-rendered pages | not run |
| *D9 Showing a USD figure* | eight `format*` / `fmt*` renderers (`render-settings.js:209`, `render-workspace-kpis.js:46`, `render-effort-readout.js:20`, `render-kpis.js:132`, `render-run-steps.js:270`, `openrouter.js:260`, `public/observation.js:3616`, `public/flight-companion.js:425`) | Front end | not counted, not targeted |

**Totals.** D1 6 · D2 4 · D3a 3 · D3b 5 · D4 6 · D5 3 · D6 6 · D7 2 · D8 4 = **39 decision–site pairs**. `lib/llm-call-log.js:161` serves both D4 and D6, so there are **38 distinct locations**. Each pair has one planted mutant in the judge (`mutants.mjs`): 39 mutants, of which 24 are reachable by the surfaces the judge calls today and 15 are not run (§6).

**Target for move 3:** 11 (nine decision rows at 1 site each, plus two named exceptions: the observation store's cached derived cost until move 4, and the browser tab total, which cannot import `lib/`). Unchanged from the research.

## 4. Reconciliation with the research

The research (`50e1412a`) stated 36 sites. Applying the counting rule above to every location its own tables list gives 39 pairs. The differences, reported and not trimmed:

- **D1 counts 6, not 3.** The research listed six D1 locations and counted three. The rule counts all six: `getModelRate` states the known-rate predicate, `selectRateForPrompt` states the long-context tier rule, and `pricing-conformance-sweep` restates the tier vocabulary. None is a pass-through.
- **D4 and D6 share `llm-call-log.js:161`.** The research counted it under both, as it should be; the 36 total therefore already double-counts it across decisions. The judge has a mutant per pair, so it is tested for both behaviours.
- **D9 is not counted** (per the research), so the 39 excludes its eight sites.

The owner of every site is resolved from `areas.json` (§3). The research's shorthand owners (`Reports`, `Pages`, `Platform`, `Proxy`) map to `Reports & operator tools`, `Front end: server-rendered pages`, `Platform & plumbing`, `Agent API (proxy)`.

## 5. Divergences (open questions for move 3; today's behaviour is kept)

1. **One OpenCode session, three answers.** A lineage with per-turn reports of $1, $2, $4 (row 1) and $8, $16 (row 2): `/cost` reads $16 (last report), the KPI pages read $20 (last report per row, summed), and the reports sum to $31. `opencode-runner.js:586` posts per-turn or roll-up deltas, so $31 looks right and both readers undercount. The judge does not yet reach the $16/$20 readings: they come from `/cost` (S1, over HTTP) and the KPI pages (S3), which are phase 2 of the judge. The sum-versus-last site itself is judged (`D3b-reduceLineageCost-opencode-sum`, caught at S3 and S13). Move 3 must not fix it by accident.
2. **A missing call cost is three different answers.** $0 on Health (S2) and Ship biscuit (S12), "unpriced" on `/cost` (S1), and excluded from a mean on the scan estimate (S10). This contradicts design decision 3 ("never counted as zero"). Judge: `D4-summarize-missing-zero`, `D4-summarizeByIssue-unpriced`, `D4-summarizeByFeature-mean`.
3. **Requested versus realised harness.** KPIs use the dispatch row's requested `harness`; `/cost`, run-view and model-pricing use the harness the run stamped (LIN-2830). A row with no `harness` is "unknown" in terminal-marked.
4. **Lineage anchor.** `dispatch-lineage.js:176` has no feedback-`rootItemId` fallback that `task-cost.js:51` has. A row whose anchor is only in its feedback forms its own lineage on KPIs. Judge: `D3a-task-cost-anchorFor` is caught at S1 only, because the KPI lineage key is pinned at `D3a-dispatch-lineage-key`.
5. **$0 reports.** run-view treats `costUsd === 0` as "not reported" (`lib/run-view.js:215`); everyone else treats it as priced $0.
6. **Ticket attribution.** `/cost` counts a lineage for every ticket one of its rows names; KPIs give it to one ticket.
7. **Weekly gauge.** Computed on every `/kpis` build and never shown. Kept; the judge pins its figures (S13).

## 6. Judge: what it reaches, and what it does not

See `experiments/costs-untangle/replay/README.md` for the method, the self-checks and their figures.

**Not run** (15 pairs). Each names a reason:
- Browser code: `public/flight-companion.js` (D4, S11). Reachable only by e2e or the visual judge.
- Rendered copy and renderers: `render-observation.js:66` (D8), `run-view.js` and `effort-readout.js` (D2, D3b, D6, S8, S9), `kpi-stats.js:1304` publicCost and `workspace-kpi-stats.js:44` (D7, D8, S3, S7). Phase 2 of the judge.
- Stores and sweeps: `observation-sessions-store.js:192` (needs the store and its db), `dispatch-lineage-status.js:69` (persisted lineage status, not a cost figure), `pricing-conformance-sweep.js:52` (a checker that reads no cost figure), `llm-call-log.js:68` (record needs an insert-capable collection).
- `openrouter.js:478` extractUsage and `openrouter.js:273` getModelPricingHint: reached through `streamChat` with a fake fetch, or as the picker hint. Not yet an adapter.

**Pending:** S6 (LIN-3855) is not merged. Its `lib/model-routing-spend.js` joins as a reader of `buildTaskCost`, and two D4/D6 sites join the count when it lands.

**Production row population is unbounded** and reading it would be a live call this ticket may not make. How many OpenCode multi-turn lineages exist, so how much divergence 1 moves real figures, is unanswered and is a follow-up.

## 7. Grep bound (reproducible)

Command, run at `4a6a4e50`:

```
grep -rniEc 'cost|usd|pric' server.js lib routes public
```

1,222 matching lines across the production tree. The largest per-file counts (the full list is the command's output):

`lib/terminal-marked-task-cost.js` 166 · `lib/model-pricing.js` 67 · `lib/pricing-conformance-sweep.js` 50 · `lib/llm-call-log.js` 45 · `lib/kpi-stats.js` 44 · `lib/openrouter.js` 40 · `public/flight-companion.js` 39 · `lib/weekly-budget.js` 38 · `lib/effort-readout.js` 38 · `public/observation.js` 35 · `lib/session-telemetry.js` 35 · `lib/task-cost.js` 34 · `lib/flight-companion-gate.js` 29 · `lib/run-view.js` 28 · `lib/openrouter-catalog.js` 24 · `lib/observation-sessions-store.js` 23 · `lib/render-settings.js` 22.

The grep is a bound on where cost words appear, not a site count: most matches are prose, comments or tests-by-name. The site list in §3 is the reviewed subset, each line checked against its symbol.

## 8. Seams

`node scripts/code-shape/seams.mjs . 4a6a4e50`: 9 area pairs, 1 group (acorn present, exit 0). The judge lives under `experiments/`, outside the seams scope (`server.js|lib|routes|public`), so the count cannot move. Head: see the PR.
