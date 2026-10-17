# The single-import knots at d349e78c: who owns each decision

Measured with `node scripts/code-shape/seams.mjs /home/user/LinearViewer d349e78c scripts/code-shape/areas.json` (raw output: `seams-head.json`). There are 20 knots at HEAD. **Seven** of them, not six, hang on one import in one direction. `docs/papers/harbour/theseus.md:80-90` counted six of 19 at `38fc3b5c`. The seventh is the one LIN-3579 tied: Front end: server-rendered pages ↔ Other features (`experiments/periodicals-before-after/seams-before-after.md`, "Knots that changed"). All seven are covered below.

## Rules used (generic)

1. **A module belongs to the area whose decision it embodies.** The decision is the rule that would have to change, and the person who would change it. Where that is unclear, look at who uses it. A helper whose importers all sit in one area is a private part of that area.
2. **Dependencies point from the user of a fact to the owner of the fact.** A constant, a vocabulary or a wire format lives with whoever has to edit it when the rule changes. The import that points the other way is the wrong one.
3. **A catch-all area owns nothing.** A file lands in "Other features" (`areas.json:64-66`, `^lib/`) because nobody named it. Before you treat a knot through the catch-all as two real owners, ask which importer's area the file belongs to.
4. **If the only true fix is to the map, leave the code alone.** That is the case when a file is named explicitly into the wrong area. Bending code to satisfy a wrong map moves a decision away from its owner. Flag it for the area guide instead.
5. **Re-exports count.** `seams.mjs:37-38` treats `export … from` as an import edge. To keep old import sites working, use a plain `import` plus `export { name }` in the old file, or update the importers.

---

## 1. Agent API (proxy) ↔ Front end: server-rendered pages: 2 / 1

| Direction | File pairs |
|---|---|
| Agent → pages (2) | `routes/proxy-compute.js:20` → `lib/tree.js` (`isTerminalState`); `routes/proxy.js:79` → `lib/tree.js` (`isBlocked`) |
| pages → Agent (1, thin) | `lib/render-runner-setup.js:32` → `lib/proxy-scopes.js` (`RUNNER_BOOTSTRAP_TTL_SECONDS`, `RUNNER_WORKING_TTL_SECONDS`) |

**What the thin import uses.** The runner page prints the runner copy's two credential lifetimes in hours (`render-runner-setup.js:73-74`). The values come from `LIFETIME_PROFILES` (`proxy-scopes.js:52-60`), which is the Agent API's own decision.

**Verdict.** The thin import is **right**: a page displays a fact that the API owns (rule 2). The wrong direction is the **thick** one. The Agent API reaches into a page module for issue-state predicates, and the page module doesn't own them either. `tree.js:170-179` says that state semantics "now live in lib/providers/state-map.js". It re-exports `isTerminalState` from there. `isBlocked` (`tree.js:194-202`) is a predicate on issue relations, not tree layout.

**Smallest real change.** `routes/proxy-compute.js` imports `isTerminalState` from `lib/providers/state-map.js:17`, its owner. Move `isBlocked` into `lib/providers/state-map.js`. `tree.js` keeps a plain import and re-export, so `lib/workspace-api-mocks.js:12` and the page code are unchanged. `routes/proxy.js` imports it from state-map. Agent → Providers already exists (18), so this adds no new knot.

**Risk.** Low to medium. One function body moves, about 9 lines. Two route imports change. `isBlocked` has three importers. Not verified here.

## 2. Auth, accounts & workspaces ↔ Providers: 9 / 1

| Direction | File pairs |
|---|---|
| Auth → Providers (9) | `github-install-flow`, `pat-session`, `workspace-api-mocks`, `workspace`, `routes/auth` (×2), `routes/email-auth`, `routes/held-connection`, `routes/jira-auth` → provider registry, interface or OAuth modules |
| Providers → Auth (1, thin) | `lib/providers/jira/oauth.js:38` → `lib/token-refresh.js` (`TokenRefreshError`, `TOKEN_REFRESH_TIMEOUT_MS`) |

**What the thin import uses.** The Jira refresher throws `TokenRefreshError` with the codes `EXPIRED`, `INVALID` and `NETWORK` (`jira/oauth.js:215-291`). It also borrows Linear's 10 s timeout (`token-refresh.js:9`). The code vocabulary is a contract: `isDefinitiveRevocation` (`token-refresh.js:44`) deletes a credential only on `EXPIRED`.

**Verdict (judgement).** The error class is the contract that every provider's refresher must speak. In this codebase, that kind of contract lives with the provider interface: `AuthExchangeError` is defined in `lib/providers/interface.js:56`. `token-refresh.js` itself is Linear's refresher, filed under Auth by path. Its header (`:1-3`) says "Token refresh module for Linear OAuth 2.0", and its default `tokenUrl` is `api.linear.app` (`:83`). So the thin import reaches the right contract, but the contract sits in the wrong file. You could argue instead that Auth owns the codes because Auth acts on them. The interface precedent is why this call goes to Providers.

**Smallest real change.** Move `TokenRefreshError`, and the timeout if it is treated as the shared refresh budget, into `lib/providers/interface.js` next to `AuthExchangeError`. `token-refresh.js` imports them from there and re-exports them (rule 5), so its seven importers keep working. Auth → Providers already exists.

**Risk.** Medium. `instanceof` identity must stay a single class. A plain re-export keeps it, but a copy would not. Credential-deletion paths depend on it.

## 3. Front end: server-rendered pages ↔ Other features: 2 / 1 (tied by LIN-3579)

| Direction | File pairs |
|---|---|
| pages → Other (2) | `lib/render.js:31` and `lib/render-swipe.js:24` → `lib/home-swipe-prompt-opts.js` (`buildPromptOpts`) |
| Other → pages (1, thin) | `lib/ship-journey.js:13` → `lib/ship-layout.js` (`BEARING_TO_ANGLE`, `BEARINGS`) |

**What the thin import uses.** `ship-journey.js` turns roadmap bearings into canvas angles (`:183`) and counts all 8 bearings (`:371`). It uses the canvas-angle convention that `ship-layout.js:942-964` defines. `public/ship-journey.js:9` also names that convention as `lib/ship-layout.js`'s.

**What the thick side is.** `home-swipe-prompt-opts.js` computes what the shared PromptSection widget shows on Home and Swipe. That covers which prompt keys are default and which sit behind "more" (`:14`, `:32`), the ✦ action's state (`:38-39`), and flag-driven controls (`:41-46`). Its header (`:1-8`) says that each page builds its own embedded JSON from these fields. Its only importers are those two page renderers (repo-wide grep at d349e78c). It reads the prompt catalog through `prompt-templates.js` (`:11`) but decides nothing about prompts.

**Verdict.** Both "Other features" files here are page-owned modules that no pattern names (rule 3). The thin import is right in meaning: ship-journey uses a canvas convention it doesn't own. The **thick** side is the misplaced one. LIN-3579's consolidation put its one place in the catch-all, which is the failure `theseus.md:25-26` describes. The prompt-options decision belongs to the pages (rules 1 and 3).

**Smallest real change.** Rename the file to a path the pages area already owns. `lib/render-prompt-opts.js` matches `^lib/(render[^/]*|…)\.js$` (`areas.json:12`). Update the two import lines. No function body changes.
- *Rejected:* moving ship-journey into a pages path. No honest name matches without editing the map, and `render-ship-journey.js` already exists.
- *Rejected:* moving `BEARINGS`/`BEARING_TO_ANGLE` into `lib/prompts/roadmap-orientation-template.js`. That would retire the `BEARINGS` twin of `ORIENTATION_BEARINGS` (`:43`), but it would put a canvas convention in a prompt file.

**Risk.** Very low. Verified in a copy (see `prediction-3.md`): knots 20 → 19, no new knot.

## 4. LLM & prompts ↔ Providers: 5 / 1

| Direction | File pairs |
|---|---|
| LLM → Providers (5) | `lib/audit.js` → `linear-fetch`; `lib/chat-tools.js` → `github-pr-status`; `lib/graph-features.js` → `providers/state-map`; `lib/prompt-formatters.js` and `lib/prompt-template-defs.js` → `providers/models` |
| Providers → LLM (1, thin) | `lib/providers/linear/index.js:30` → `lib/openrouter.js` (`COUSIN_CAP`, `SIBLING_CAP`) |

**What the thin import uses.** `fetchIssueContext` truncates siblings and cousins at fetch time (`linear/index.js:884-918`). The caps are documented as limits on what is "rendered into prompt context" (`openrouter.js:133-147`). The formatter prints whatever list it is given and the "N not shown" nudge (`openrouter.js:696-706`, `:718-728`).

**Verdict.** This is the LLM's context-budget decision, applied in the wrong place (rule 2). The import is wrong. The provider shouldn't know the prompt's window.

**Smallest real change.** Invert the dependency.
- The provider returns the sorted lists with their totals, which it already computes before slicing.
- `formatIssueContext` slices to its own caps.
- Option B, smaller but with the owner wrong: move the constants into `lib/providers/` and have openrouter import them. That unties the knot and leaves the decision away from its owner. Not recommended.

**Risk.** Medium. The other providers' contexts would now also be capped when formatted, and any consumer of the raw context JSON would see longer lists. That is a possible behaviour change, so it would need a replay.

## 5. Other features ↔ Platform & plumbing: 4 / 1

| Direction | File pairs |
|---|---|
| Other → Platform (4) | `flight-companion-gate`, `report-history-store`, `ship-biscuit-history-store`, `ship-biscuit` → `lib/utils/time.js` |
| Platform → Other (1, thin) | `lib/kpi-stats.js:41` → `lib/report-history-store.js` (`MAX_REPORTS_PER_WORKSPACE`) |

**What the thin import uses.** One label string, ``roadmapReportsBasis: `newest ${MAX_REPORTS_PER_WORKSPACE} reports per workspace` `` (`kpi-stats.js:897`). The comment at `:895-896` explains why: the label is "named rather than hand-restated so it can't drift" from the store's cap (`report-history-store.js:55`).

**Verdict.** The import is **right** (rule 2). The odd part is the map: `kpi-stats` is named explicitly into Platform (`areas.json:54`). It is the /kpis feature's aggregator and privacy boundary (`kpi-stats.js:1-10`), not plumbing (rule 4).

**Smallest real change.** None in code. Flag it for the area guide. Passing the cap in from `server.js` would untie the knot only by bending code to a misfiled map.

**Risk.** —

## 6. Other features ↔ Runs & dispatch: 1 / 2

| Direction | File pairs |
|---|---|
| Other → Runs (1, thin) | `lib/periodicals.js:1` → `lib/periodical-report-gate.js` (`buildPeriodicalGateMarker`, `extractPeriodicalGateId`, `slugifyPeriodicalTitle`) |
| Runs → Other (2) | `lib/dispatch-validation.js:17` → `periodicals.js` (`getPeriodicals`); `routes/dispatch.js:31` → `periodicals.js` (`PERIODICAL_AUTOPILOT_TAIL`) |

**What the thin import uses.** The periodical marker's format.
- `periodicals.js` writes the marker into each minted task's prompt (`:166`).
- It maps a marker back to a periodical (`resolvePeriodicalIdFromGateMarker`, `:993-997`). Its own comment says `lib/periodicals.js` "stays the source of truth for the mapping" (`:985`).
- The gate only checks that the marker is present, and its comment says the slug need not match any periodical id (`periodical-report-gate.js:41-49`).

**Verdict (judgement).** The marker identifies *a periodical task*, and periodicals already owns both writing it and mapping it back. The gate owns only the Done rule (evidence comments, `:102-160`). So the marker format is periodicals' decision, and the thin import is the wrong one. The opposite reading is that the gate created the marker (LIN-694), so it owns it. That reading would make `periodical-report-gate` a periodicals file that the map put in Runs (`areas.json:24`).

**Smallest real change.** Move `MARKER_ATTR`, `MARKER_RE` and the three functions (`periodical-report-gate.js:38-84`) into `lib/periodicals.js`. The gate imports `extractPeriodicalGateId` from there and re-exports it with a plain import plus export, for `routes/proxy-writes.js:46` and the 4 test files that import `buildPeriodicalGateMarker` from the gate. Runs → Other already exists.

**Risk.** Low to medium. About 45 lines move. No function body changes. Check that there is no import cycle: after the move, `periodicals.js` must not import the gate.

## 7. Providers ↔ Runs & dispatch: 1 / 7

| Direction | File pairs |
|---|---|
| Providers → Runs (1, thin) | `lib/pr-state-store.js:19` → `lib/run-evidence.js` (`summarizeChecks`) |
| Runs → Providers (7) | `dispatch-factory` (×2), `run-evidence`, `task-page-loader` (×2), `ticket-close-closer`, `routes/dispatch` → GitHub PR modules, `providers/models`, `providers/state-map` or the registry |

**What the thin import uses.** `summarizeChecks` (`run-evidence.js:31-44`) folds GitHub check-run conclusions and commit-status states into passing, failing, pending or unknown, using two GitHub-vocabulary sets (`:24-25`). `lib/github-pr-status.js:207-208` builds that mixed checks list. `pr-state-store.js:89` uses it for the PR-state route payload.

**Verdict.** This is a reading of GitHub's vocabulary, owned by the GitHub PR module (rules 1 and 2). It sits in the run-evidence builder, so the thin import is wrong because the function is in the wrong file.

**Smallest real change.** Move the two sets and `summarizeChecks` into `lib/github-pr-status.js`. `run-evidence.js` imports it from there; it already imports that module at `:17`. It also does `export { summarizeChecks }` for `tests/unit/run-evidence.test.js`. `pr-state-store.js` imports it from `github-pr-status.js`.

**Risk.** Low. Verified in a side branch of the copy (`seams-alt-summarize.json`):
- Knots 20 → 19: Providers ↔ Runs is gone, and no other pair changes.
- `run-evidence` and `pr-state-store` unit tests: 26 of 26 pass with egress blocked.
- The diff is +22/−20.

---

## Summary

| Knot | Wrong import | Fix | Risk |
|---|---|---|---|
| Agent ↔ pages | thick: proxy routes → `tree.js` | import the predicates from `providers/state-map.js` | low–med |
| Auth ↔ Providers | thin, but the contract is misfiled | `TokenRefreshError` → `providers/interface.js` | med |
| pages ↔ Other | thick: the LIN-3579 helper in the catch-all | rename to `lib/render-prompt-opts.js` | very low |
| LLM ↔ Providers | thin: provider applies the prompt caps | formatter slices; provider returns totals | med |
| Other ↔ Platform | none (the map misfiles `kpi-stats`) | none in code; flag the guide | — |
| Other ↔ Runs | thin (judgement) | marker trio → `periodicals.js` | low–med |
| Providers ↔ Runs | thin: GitHub vocabulary in run-evidence | `summarizeChecks` → `github-pr-status.js` | low |

**Target for ticket 3: pages ↔ Other.** We tied this knot, and its fix tests the theseus claim directly: a consolidation put in the wrong area ties a knot, and moving it to the owning area unties it. Its fix is also the smallest of the seven, with no body change. Providers ↔ Runs is a close second and the better test of moving a *function*. It is verified too, and it makes a natural ticket 4.
