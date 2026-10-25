# LIN-3937: where each cost decision lives

Grounded at `origin/main` `f1190392`, which includes LIN-3855 (Settings › Models, merged at `d53bb5bc`). Every file:line below was re-derived at that sha by finding each site by its own text and checking the symbol it sits in. The earlier lines from `4a6a4e50` are superseded. The design note is `docs/plans/costs.md` (LIN-3936).

## 1. Rules

**Site.** A function, or a module-level constant, in `server.js`, `lib/`, `routes/` or `public/` whose own body states part of a decision's rule: its arithmetic, predicate, constant or precedence. A caller that only passes a site's result through does not count. A caller that re-applies part of the rule (re-divides, re-gates, re-sums, re-windows) does count. Tests, docs, `scripts/` and `experiments/` do not count.

**What counts.** A site counts only when the rule it states determines a cost figure, or the window or label of one, that a surface emits. This rule is stated here for the first time (the first draft applied the same idea without writing it down). Two sites from the first draft fall outside it and are excluded:

- `lib/pricing-conformance-sweep.js:49` (`TIER_MAP`): the sweep compares the rate table against the live catalog and logs violations. It emits no figure and no label of one.
- `lib/dispatch-lineage-status.js:69` (`anchorFor`, a copy of the lineage anchor): it keys the persisted lineage status that the `/dispatch` list shows (`lineageStatus`, `lineageCompletedAt`, `lineageFeedbackCount`). The only readers of those fields are in `lib/dispatch-store.js` (`grep -rn lineageStatus lib routes`). No cost path reads them.

**Owner.** "The area that would have to change if its rule changed", named by the first matching pattern in `scripts/code-shape/areas.json`. The owners below are resolved by a script from that file. The first draft's owners were partly from memory, and four were wrong (`routes/proxy-compute.js` is Agent API, `lib/kpi-stats.js` and `lib/workspace-kpi-stats.js` are Reports & operator tools, `lib/openrouter.js` and `lib/model-pricing.js` are LLM & prompts, `lib/effort-readout.js` is Runs & dispatch).

**Decision.** A rule applied to a dispatch row, a call, or a window. D1–D8 are counted. D9 (showing a USD figure) is recorded and judged by the rendered-HTML surfaces; it is not counted, because a formatter changes how a figure is shown, not what it is.

## 2. Surfaces (what a person or agent sees)

| # | Surface | Entry → cost code |
|---|---|---|
| S1 | `GET /api/proxy/issues/:id/cost` | `routes/proxy-compute.js:706` → `lib/task-cost.js` `buildTaskCost`; `lib/llm-call-log.js:252` |
| S2 | Settings › Health, "Harbour's AI calls" | `routes/settings.js:290` → `lib/llm-call-log.js:161`; `lib/render-settings.js:369` (`llmStatsRows`), `:85` (`formatCost`) |
| S3 | `/kpis` "Cost per finished task" | `lib/kpi-stats.js:1136` (`computeTerminalMarkedTaskCost`); `:1355` → `publicCost` at `:1304`; `lib/render-kpis.js:161` |
| S4 | Observation feed: a session's derived cost | `lib/session-telemetry.js:473` → stored by `lib/observation-sessions-store.js` (`BUILDER_VERSION` at `:192`) |
| S5 | Model picker display prices | `lib/openrouter.js:250,260,273` → `lib/model-pricing.js:203` (`getDisplayPricing`), plus the cached catalog |
| S6 | Settings › Models: spend per job (LIN-3855, merged) | `routes/settings.js:308–327` → `lib/model-routing-spend.js` (`agentSpendByJob` `:60`, `harbourSpendByJob` `:69`, `byJobSpend` `:82`) and `LlmCallLogStore.listInHorizon` (`lib/llm-call-log.js:338`); rendered by `lib/render-settings-models.js` (`rowsBody`, totals at `:123–124`) |
| S7 | Workspace KPIs "API-equivalent cost" per day | `routes/workspace-kpis.js:32` → `lib/workspace-kpi-stats.js:83` → `lib/weekly-budget.js:121` (`windowedSpend`); `lib/render-workspace-kpis.js:46,150` |
| S8 | Effort read-out: cost per kind and per group | `routes/dashboard-effort.js:174` → `lib/effort-readout.js` `computeEffortReadout` (sums at `:333`, `:466`); `lib/render-effort-readout.js:20,132` |
| S9 | Run page: step cost and header total | `lib/run-view.js:206` (`lineageCost`), `:378` (header total) → `lib/render-session.js:271,343`, `lib/render-run-steps.js:270` |
| S10 | Observation "due scan" cost estimate | `routes/dashboard-feed.js:630` → `lib/llm-call-log.js:307`; `lib/render-observation.js:66` (copy), `public/observation.js:3625` |
| S11 | Flight Companion per-tab check-in cost | `public/flight-companion.js:427` (browser; sums `usage.cost` from SSE) |
| S12 | Ship biscuit "Weather" input | `routes/ship-biscuit.js:155` → `lib/llm-call-log.js:161` → `lib/ship-biscuit.js` |
| S13 | Weekly-budget gauge | `lib/kpi-stats.js:1142` → `lib/weekly-budget.js:160`. Computed on every `/kpis` build, dropped from the public stats |

## 3. Decisions, sites, counts, owners

Each row is a decision–site pair. The "Judge" column names the planted fault in `replay/mutants.mjs`; a row marked *named exception* is not reachable from node.

| Decision | Site (file:line, function) | Owner | Judge |
|---|---|---|---|
| **D1 Rates** | `lib/model-pricing.js:111` MODEL_PRICING rows | LLM & prompts | `D1-model-pricing-row` |
| | `lib/model-pricing.js:185` `getModelRate` | LLM & prompts | `D1-getModelRate` |
| | `lib/model-pricing.js:232` `resolveWorkerModelId` | LLM & prompts | `D1-resolveWorkerModelId` |
| | `lib/model-pricing.js:278` `selectRateForPrompt` (long-context tier) | LLM & prompts | `D1-selectRateForPrompt` |
| | `lib/openrouter.js:273` `getModelPricingHint` (catalog fallback, `-1` rejected) | LLM & prompts | `D1-getModelPricingHint` |
| **D2 Pricing one usage report** | `lib/model-pricing.js:347` `computeUsageCostUsd` | LLM & prompts | `D2-computeUsageCostUsd` |
| | `lib/session-telemetry.js:473` native-wins precedence | Runs & dispatch | `D2-native-wins` |
| | `lib/run-view.js:215` "priced means finite and > 0" | Runs & dispatch | `D2-run-view-priced` |
| | `lib/observation-sessions-store.js:192` `BUILDER_VERSION` (stored derived cost) | Runs & dispatch | `D2-observation-builder-version` |
| **D3a Lineage identity** | `lib/task-cost.js:51` `anchorFor` | Runs & dispatch | `D3a-task-cost-anchorFor` |
| | `lib/dispatch-lineage.js:176` lineage key `rootItemId \|\| _id` (no feedback fallback) | Runs & dispatch | `D3a-dispatch-lineage-key` |
| **D3b Combining a session's reports** | `lib/task-cost.js:120` `parseUsage(merged)`: last report wins | Runs & dispatch | `D3b-task-cost-parseUsage-merged` |
| | `lib/dispatch-lineage.js:56` `usageOf`: last report per row | Runs & dispatch | `D3b-usageOf-last` |
| | `lib/terminal-marked-task-cost.js:142` `reduceLineageCost` (opencode sums) | Runs & dispatch | `D3b-reduceLineageCost-opencode-sum` |
| | `lib/run-view.js:206` `lineageCost` (`CUMULATIVE_HARNESS` at `:187`) | Runs & dispatch | `D3b-run-view-lineageCost` |
| | `lib/model-pricing.js:367` override gate (`harness !== 'opencode'`) | LLM & prompts | `D3b-model-pricing-override-harness` |
| **D4 A call's cost** | `lib/openrouter.js:478` `extractUsage` (billed cost) | LLM & prompts | `D4-openrouter-extractUsage` |
| | `lib/llm-call-log.js:68` `record` (`cost: num(call.cost)`) | LLM & prompts | `D4-llm-call-log-record` |
| | `lib/llm-call-log.js:161` `summarize` (missing → $0) | LLM & prompts | `D4-summarize-missing-zero` |
| | `lib/llm-call-log.js:252` `summarizeByIssue` (missing → unpriced) | LLM & prompts | `D4-summarizeByIssue-unpriced` |
| | `lib/llm-call-log.js:307` `summarizeByFeature` (missing → out of the mean) | LLM & prompts | `D4-summarizeByFeature-mean` |
| | `lib/model-routing-spend.js:23` `summarise` (no-telemetry arm, unpriced arm) | LLM & prompts | `D4-model-routing-summarise-no-telemetry` |
| | `lib/model-routing-spend.js:69` `harbourSpendByJob` (a missing call cost stays null, `:73`) | LLM & prompts | `D4-harbour-spend-null-rule` |
| | `public/flight-companion.js:425,1911` (missing → $0; tab total) | Front end: browser code | *named exception* (`D4-flight-companion-cost`) |
| **D5 By ticket** | `routes/proxy-compute.js:687` lineage sibling batch (unscoped by ticket) | Agent API (proxy) | `D5-proxy-compute-siblings` |
| | `lib/task-cost.js:177` `fullyPriced` gate | Runs & dispatch | `D5-task-cost-fullyPriced` |
| | `lib/terminal-marked-task-cost.js:403` per-issue sum | Runs & dispatch | `D5-terminal-marked-issue-sum` |
| | `lib/model-routing-spend.js:60` `agentSpendByJob` (kind assigns a run to a job) | LLM & prompts | `D5-agent-spend-kind-owner` |
| | `lib/model-routing-spend.js:69` `harbourSpendByJob` (feature assigns a call to a job) | LLM & prompts | `D5-harbour-spend-feature-owner` |
| **D6 By day and by period** | `lib/weekly-budget.js:121` `windowedSpend` (skipped excluded) | Runs & dispatch | `D6-windowedSpend-skipped` |
| | `lib/weekly-budget.js:160` `computeWeeklyBudgetGauge` (checkpoint basis) | Runs & dispatch | `D6-gauge-checkpoint` |
| | `lib/effort-readout.js:333` group cost sum | Runs & dispatch | `D6-effort-readout-priced-filter-a` |
| | `lib/effort-readout.js:466` per-kind cost sum | Runs & dispatch | `D6-effort-readout-priced-filter-b` |
| | `lib/llm-call-log.js:161` 30-day total (`:168`; a second use of `summarize`) | LLM & prompts | `D6-summarize-30-day-window` |
| | `lib/run-view.js:378` header total (all lineages cumulative and priced) | Runs & dispatch | `D6-run-view-header-total` |
| | `lib/model-routing-spend.js:33` `summarise` sum (priced spend per job) | LLM & prompts | `D6-model-routing-summarise-sum` |
| | `lib/model-routing-spend.js:82` `byJobSpend` (largest priced spend first) | LLM & prompts | `D6-by-job-order` |
| | `lib/render-settings-models.js:117` `rowsBody`: `totalPriced`, `harbourTotal` (re-sum of spend per job, `:123–124`) | Front end: server-rendered pages | `D6-models-page-totals` |
| **D7 Per finished task** | `lib/terminal-marked-task-cost.js:215` `computeTerminalMarkedTaskCost` (done gate at `:334`) | Runs & dispatch | `D7-terminal-marked-done-gate` |
| | `lib/kpi-stats.js:1304` `publicCost` (re-divides, rounds to cents) | Reports & operator tools | `D7-publicCost` |
| **D8 Read window** | `lib/read-horizon.js:21` `READ_HORIZON_DAYS` | Platform & plumbing | `D8-read-horizon` |
| | `lib/dispatch-lineage.js:19` `OUTCOME_WINDOW_DAYS` (independent constant) | Runs & dispatch | `D8-outcome-window` |
| | `lib/workspace-kpi-stats.js:44` `LONG_WINDOW_DAYS` | Reports & operator tools | `D8-workspace-kpi-long-window` |
| | `lib/render-observation.js:66` the "30-day historical mean" copy | Front end: server-rendered pages | `D8-observation-copy` |
| | `lib/llm-call-log.js:338` `listInHorizon` (re-applies the read window) | LLM & prompts | `D8-call-log-horizon-listing` |
| *D9 Showing a USD figure (not counted)* | `lib/render-settings.js:85` `formatCost`; `lib/render-settings-models.js:101–102`; `lib/render-workspace-kpis.js:46`; `lib/render-effort-readout.js:20`; `lib/render-kpis.js:132`; `lib/render-run-steps.js:270`; `lib/openrouter.js:260`; `public/observation.js:3625`; `public/flight-companion.js:427` | Front end (server-rendered; LLM & prompts for `openrouter.js`; browser for `public/`) | `D9-health-format-cost`, `D9-effort-format-usd` (the rendered-HTML surfaces catch the rest) |

**Totals.** D1 5 · D2 4 · D3a 2 · D3b 5 · D4 8 · D5 5 · D6 9 · D7 2 · D8 5 = **45 decision–site pairs**. Three locations serve two decisions each (`lib/model-routing-spend.js:23` as D4 and D6; `:69` as D4 and D5; `lib/llm-call-log.js:161` as D4 and D6), so there are **42 distinct locations**.

Of the 45 pairs, 44 have a planted fault in the judge (`replay/mutants.mjs`). The one not reachable from node is the browser code for D4 (`public/flight-companion.js`), a named exception: it is a browser script with no exports and it needs a DOM, so node cannot import it. The two excluded sites (§1) are not in the 45.

**Target for move 3: 11.** Nine decision rows at one site each (D1, D2, D3a, D3b, D4, D5, D6, D7, D8), plus two named exceptions: the observation store's cached derived cost, which stays until move 4 prices on read (decision 3 of the design note), and the browser tab total, which cannot import `lib/`. LIN-3855's sites fold into the same rows; the target did not change.

## 4. Reconciliation with the research and the first draft

- The research (`50e1412a`) stated 36 sites. The first draft applied the rule to 39 pairs (its D1 counted six). This draft has **45 pairs**: the research's 36 and the first draft's three extra D1/D3a/D4 rows are reconciled as follows: −2 excluded (the sweep, the status anchor), +8 from LIN-3855 (`summarise` under D4 and D6, `harbourSpendByJob` under D4 and D5, `agentSpendByJob` under D5, `byJobSpend` under D6, the Models totals under D6, `listInHorizon` under D8).
- Line numbers at the first draft's base are superseded. The moves that matter: `effort-readout` sums `331/464 → 333/466`; `proxy-compute` siblings `686 → 687`; `fullyPriced` `175 → 177`; `formatCost` `209 → 85` (LIN-3855 split `render-settings.js`); the `llm-call-log.js` 30-day window `:161` is now the function line, the window itself `:168`.
- The first draft's surface list is unchanged except S6, which is merged.
- The reproducible grep bound (research plan step 2), at `f1190392`: `grep -rniEc 'cost|usd|pric' server.js lib routes public` gives **1,249** matching lines (1,222 at `4a6a4e50`; the difference is LIN-3855). The largest per-file counts are `lib/terminal-marked-task-cost.js` 166, `lib/model-pricing.js` 67, `lib/pricing-conformance-sweep.js` 50, `lib/llm-call-log.js` 46. The grep bounds where cost words appear; it is not a site count. The sites are the §3 list, each found by its own text.

## 5. Divergences (open questions for move 3; today's behaviour is kept)

1. **One OpenCode lineage, three answers.** The world `opencode-probe-1-2-4-8-16` reproduces the production probe: row 1 reports $1, $2, $4; its follow-up reports $8, $16. The judge reads **$16** on `/cost` (S1, over HTTP), **$16** on the effort read-out (S8), **$20** on the KPI-side terminal-marked cost (S3, `termMarked`), and the reports sum to **$31**. So the effort read-out and `/cost` agree (last report of the lineage) and the KPI pages sum the last report per row. `D3b-reduceLineageCost-opencode-sum` catches a change to the KPI sum at `termMarked`, the public and workspace KPI pages. Move 3 must not fix it by accident.
2. **A missing call cost has four answers.** $0 on Health (S2) and Ship biscuit (S12); "unpriced" on `/cost` (S1) and on the Models page (S6, `harbourSpendByJob` keeps it null); left out of a mean on the scan estimate (S10). Design decision 3 says a missing cost is never counted as zero. Judge: `D4-summarize-missing-zero`, `D4-summarizeByIssue-unpriced`, `D4-summarizeByFeature-mean`, `D4-harbour-spend-null-rule`.
3. **Requested versus realised harness.** The KPI pages use the dispatch row's requested `harness`; `/cost`, the run view and model pricing use the harness the run stamped (LIN-2830). A row whose requested and stamped harness differ is priced one way on one page and another way on another. The judge's boundary world is stamped consistently (`harness: 'opencode'` on the row, as its usage says) so that the rate rule under test is what it measures.
4. **Lineage anchor.** `lib/dispatch-lineage.js:176` has no feedback-`rootItemId` fallback, and `lib/task-cost.js:51` has one. A row whose anchor sits only in its feedback forms its own lineage on the KPI pages. Judge: `D3a-dispatch-lineage-key` (caught at `lineage`, `termMarked`, `gauge`, the public and workspace KPI pages) and `D3a-task-cost-anchorFor` (caught at `cost`, `taskCost`, `effort`, `spendByJob`, the Models page).
5. **$0 reports.** `lib/run-view.js:215` treats `costUsd === 0` as "not reported"; everyone else treats it as priced $0. Judge: `D2-run-view-priced` (caught at `run`, the run page).
6. **Ticket attribution.** `/cost` counts a lineage for every ticket one of its rows names; the KPIs give it to one ticket. Judge: `D5-proxy-compute-siblings` (caught at `cost`).
7. **Weekly gauge.** Computed on every `/kpis` build and never shown (S13). Kept; the judge pins its figures at `gauge`.

## 6. Judge: what it reaches

See `experiments/costs-untangle/replay/README.md` for the method and the figures. In short: every §3 pair except the browser code has a planted fault, and each fault is caught at the surfaces its site reaches (`replay/mutants.mjs`, `expect`). The coverage denominator is every function that holds a §3 site (`replay/coverage.mjs`, `INVENTORIED`).

**Not run from node:** `public/flight-companion.js` (D4, S11) and the browser formatter `public/observation.js:3625` (D9). Both are browser scripts; they are blind spots, named, not passes.

**Production row population is unbounded.** How many OpenCode multi-turn lineages exist, and so how much divergence 1 moves real figures, needs a live read, which this ticket does not make. It is a follow-up.

## 7. Figures

From `selfcheck.mjs --old f1190392 --new d58b77f6 --n 2000 --seeds 7,11` (exit 0). The production tree is the same at both: `git diff f1190392 HEAD -- lib routes public server.js` is empty.

- **Identity:** 0 differences on seed 7 and on seed 11, 2,036 scenarios each (2,000 seeded worlds plus 36 edge worlds), across 22 surfaces.
- **Planted faults:** 46 of 46 reachable mutants caught at exactly their expected surfaces, 0 caught nowhere, 0 at an unexpected surface. By decision: D1 5/5 · D2 4/4 · D3a 2/2 · D3b 5/5 · D4 7/7 · D5 5/5 · D6 9/9 · D7 2/2 · D8 5/5 · D9 2/2. Not run: 1 (`public/flight-companion.js`, browser). Excluded under §1: 2.
- **Catches per surface** (how many mutants each surface caught): modelsHtml 18 · spendByJob 16 · publicKpisHtml 14 · cost 13 · termMarked 13 · workspaceKpisHtml 13 · effortHtml 12 · gauge 12 · taskCost 12 · effort 11 · run 11 · sessionHtml 11 · usage 7 · callLog 5 · rate 4 · healthHtml 4 · pricingHint 3 · observationHtml 3 · lineage 2 · observationStored 1 · openrouterUsage 1 · callRecord 1.
- **Non-vacuity floors:** all met. The thinnest is the public `/kpis` page, which shows its cost only at five priced finished tasks: 128 of 2,036 scenarios against a floor of 102 (5%).
- **Coverage:** 98.2% (978 of 996 lines) over every function that holds a §3 site; target 95%, hard floor 90%. Below 100%: `llm-call-log.js` `record` 23/30 (the insert path; the judge records with no collection), `effort-readout.js` `computeEffortReadout` 135/143, `observation-sessions-store.js` `findByWorkspace` 18/21 (its read-error path).
- **Base → head replay:** `replay.mjs --old f1190392 --new d58b77f6 --n 2000 --seed 7`: 0 differences over 2,036 scenarios, every surface, exit 0.

How the judge got here, recorded rather than hidden. The first full run had six mutants off their expected sets. Three were expectation errors, corrected from the code: `windowedSpend` calls `reduceLineageCost` and the workspace KPIs read the read window, so the workspace page reads those two sites; the per-issue sum feeds a field the public page does not draw. Three were generator gaps, fixed in `gen.mjs`: no rich world used a dated model id, the exact 272,000-token threshold, or the one model with a long-context tier (`openai/gpt-5.5`), and none had a failed lineage for the done gate. Two earlier fidelity bugs were also fixed before that: the KPI readers got ISO strings where the store returns Dates (the workspace page read empty), and generated rows carried no session target (the run page saw few runs).

## 8. Seams

`node scripts/code-shape/seams.mjs . f1190392`: 9 area pairs, 1 group (acorn present, exit 0). `node scripts/code-shape/seams.mjs . <head>`: 9 area pairs, 1 group, exit 0 (re-run at the final commit, see the PR). The judge lives under `experiments/`, outside the seams scope (`server.js|lib|routes|public`), so the count cannot move.
