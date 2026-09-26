# Drift & Coherence Review — run of 2026-09-26 (trend vs 2026-08-29)

**Grounding.** Measured at `LinearViewer` `6e8bf424cfdd887bfeda2173a3d31b12076d6ff9` / `simple-dispatcher` `3b1e734b5496941ef5a7ecfb9497741f275d67fa` (the dispatching-run SHAs). Report-time HEADs: `LinearViewer` = `b5c528c4807acc2222f4afd6fe2b87ded41fdf89`, `simple-dispatcher` = `3b1e734b5496941ef5a7ecfb9497741f275d67fa`.

**Drift verdict: immaterial.** `LinearViewer` advanced `6e8bf424` → `b5c528c4` (merge #1589; `207c1e71` LIN-3097) touching **only** `scripts/eval/jev-spike.mjs` and `scripts/eval/jev-spike-out/*` — no file in any measured class. `simple-dispatcher` is unchanged. Every count below is therefore carried from the research record measured at the SHAs above; no class required re-measurement. Both SHAs are recorded on every row.

**Window since 2026-08-29** (`LinearViewer` `292ac962` / `simple-dispatcher` `7064955`): **631** and **112** commits respectively — a normal-sized delta, not a re-baseline.

**Review-only.** No code, config, secret, or under-review doc was changed. The only artifact is this report, its branch/PR, and the Linear updates. Cross-repo drift *between* `LinearViewer/` (Harbour) and `simple-dispatcher/` (the runner) is in remit.

**Provenance — the 07-12 edition was never recovered.** The last persisted report before this one is `docs/reviews/drift-coherence-review-2026-08-29.md` (run task LIN-2380, PR #1291 → `cb2fbb5a`). The 2026-07-12 run (LIN-1231) was never persisted on any ref. Consistent with this edition's instruction, the 07-12 column of the trend ledger below is marked `not recovered`; no value is interpolated for it, even though a compressed comment-ledger once existed.

**Headline.** Both latent `lib/`-touching cycle clusters **worsened** this window. The provider-seam SCC grew 14→15 when the new `lib/github-install-flow.js` closed a fresh return path through `render-pages.js` back to the identity barrel, and a **new** 2-node cycle formed on the feedback seam: `lib/dispatch-store.js:48` ↔ `lib/digest-feedback.js:38`. Neither is live — no module-evaluation-time peer read exists — and that latent-not-live distinction is the same test every prior edition applied. The canonical error envelope got broader adoption (importers 14→26) even as its raw inline residue widened (68→87) and `flight-companion.js` became the growing holdout (6→8). The provider-resolution incantation rose 16→17, the UI-divergence registry fell further behind (6→9 native `confirm()` sites). All clean/resolved rows held or reinforced. **None of the three standing follow-ups has moved — all Backlog, zero comments: LIN-675 (minted by the 06-25 edition) has stood unmoved across two persisted editions (08-29, 09-26), and LIN-2388 / LIN-2389 (both minted by the 08-29 edition) across one. The promotion path is still not converting.**

---

## Findings (severity-ranked)

### 1. `provider-auth-router-upward-imports` — Medium — **worsened (provider SCC 14 → 15; 4 upward edges still open)**

At HEAD there are **four** `lib/ → routes/` upward import edges (direct read of each provider's `index.js`):

- `lib/providers/linear/index.js:34` → `routes/auth.js` (`createAuthRoutes`)
- `lib/providers/github/index.js:67` → `routes/github-auth.js` (`createGitHubAuthRoutes`)
- `lib/providers/github-projects/index.js:60` → `routes/github-projects-auth.js` (`createGitHubProjectsAuthRoutes`)
- `lib/providers/jira/index.js:103` → `routes/jira-auth.js` (`createJiraAuthRoutes`)

All four sit inside **static cycles** that close through the provider identity barrel, not `providers/registry.js`:

- `lib/providers/index.js:32` → `lib/providers/github/index.js:67` → `routes/github-auth.js:27` → `lib/render-pages.js:14` → `lib/providers/index.js`
- `lib/providers/index.js:33` → `lib/providers/github-projects/index.js:60` → `routes/github-projects-auth.js:35` → `lib/render-pages.js:14` → `lib/providers/index.js`
- `lib/providers/index.js:34` → `lib/providers/jira/index.js:103` → `routes/jira-auth.js:38` → `lib/render-pages.js:14` → `lib/providers/index.js`

**New this window — the `github-install-flow` leg.** `lib/github-install-flow.js` (imports `render-pages.js:26` and `account-conflict.js:30`) is now pulled into the auth routes: `routes/github-auth.js:28` and `routes/github-projects-auth.js:36` both `import { createGitHubInstallFlowRoutes } from '../lib/github-install-flow.js'`. That adds a second return path to `render-pages.js`/the barrel, taking the provider SCC from **14 to 15 members** (11 of them in `lib/`). The prior edition's five directly-verified cycles should be read as a floor; this run cites the three canonical 4-node cycles above and the new leg rather than re-enumerating a combinatorial total.

**Latent, not live (severity re-check).** Every peer use sits inside a function body. `render-pages.js`'s `getProvider()` calls are evaluated at call time, not at module scope; `github-install-flow.js` only calls its imported `renderErrorPage` inside handlers. There is no module-evaluation-time peer read, hence **Medium**, not High.

**Cost.** `lib/providers/index.js`, `lib/render-pages.js`, each provider `index.js`, its auth route, and now `lib/github-install-flow.js` form one closed dependency group. A future module-scope read of a peer binding in any member fails at import time with no local signal — and this is the seam the series has carried across the five persisted editions (06-10, 06-11, 06-25, 08-29, 09-26; the 07-12 edition was lost). **LIN-675** is the standing fix and is updated, not duplicated (Follow-ups); its original scope does not close the `render-pages ↔ providers/index` leg or the new `github-install-flow` leg.

### 2. `lib-import-cycles` — Medium — **worsened (new latent cluster)**

The LinearViewer `lib/`+`routes/`+`server.js` graph walk (289 nodes / 1042 edges) finds **3 SCCs touching `lib/`**:

1. **Provider-seam SCC** — 15 members (Finding 1).
2. **KPI SCC (3 members)** — `lib/kpi-stats.js:28-29` → `./terminal-marked-task-cost.js` and `./weekly-budget.js`; `lib/terminal-marked-task-cost.js:90` → `./kpi-stats.js`; `lib/weekly-budget.js:30-31` → `./kpi-stats.js` and `./terminal-marked-task-cost.js`. Three elementary cycles over five static edges — unchanged from 08-29.
3. **NEW — dispatch/digest SCC (2 members).** Formed this window by LIN-2996/LIN-3008:
   - `lib/dispatch-store.js:48` → `import { digestFeedback, _findDecisionWithdrawal } from './digest-feedback.js'`
   - `lib/digest-feedback.js:38` → `import { formatFeedbackEntries } from './dispatch-store.js'`

**Latent on the same test as every prior edition.** All cross-module bindings are used only inside function bodies (`dispatch-store.js` `digestFeedback` call sites; `digest-feedback.js` `formatFeedbackEntries` use in its own functions). No module-evaluation-time peer read; no TDZ failure today. The 08-29 "3 cycles" figure is now a floor across clusters, not a total.

**Cost.** The same unstated, untested invariant now guards a seam nobody was watching — the feedback/digest path. A module-scope const or top-level side effect added to either file turns a latent 2-node cycle into an order-dependent failure with no signal at the call site. `simple-dispatcher`'s own full walk (222 nodes / 593 edges) remains **0 SCCs**.

### 3. `routes-error-envelope-fragmentation` — Medium — **importers improved (14 → 26); raw residue worsened (68 → 87)**

`lib/errors.js` is canon. Adoption breadth improved again: **26 importers** (20 `routes/` files, 5 `lib/` files — `github-install-flow.js`, `linear-fetch.js`, `proxy-events.js`, `proxy-graphql-errors.js`, `render-pages.js` — plus `server.js`). Direct grep for `errors.js.` returns 27 files, but `lib/workspace-token-resolver.js` only *mentions* `lib/errors.js` in two comments (`:440`, `:548`) and imports nothing from it, so it is not an importer — the 26 figure holds.

Raw inline residue, measured with `grep -rn "res.status(4xx|5xx)" … | grep ".json("`, `routes/test.js` excluded: **87** (up from 68), concentrated in `task-chat.js` (20), `dashboard.js` (17), `collective.js` (15), `server.js` (8), and **`flight-companion.js` (6 → 8, the growing holdout)**, then `next-run.js` 5, `legacy-redirects.js` 4, `live-console.js` 2, `ship-biscuit.js` 2, `openrouter-auth.js` 2, and one each in `dispatch`/`proxy`/`proxy-flight-companion`/`workspace-api-prompts`.

**Cost.** A fleet-wide envelope change still lands once in `lib/errors.js` for the dominant path, but a reader still cannot tell from an import line alone whether a given handler is canonical, and `flight-companion.js` is drifting further from the canon rather than toward it. **Not promoted** — the fix direction (adopt-on-next-touch, no sweep) is unchanged across every edition; recorded for the next run to re-check `flight-companion.js`, `dashboard.js` and `task-chat.js`.

### 4. `production-to-test-fixture-imports` — Medium-low — **unchanged at 7**

The repo states its own norm (`routes/proxy.js:282`: fixtures are "kept inline (not imported) so production code never depends on a test fixture"). **Seven static top-level imports violate it** (direct read; `routes/test.js` excluded by standing convention because that file *is* the test seam):

- `server.js:103`, `:104`, `:105` — `mock-data.js`, `swim-sample-data.js`, `ship-dense-sample-data.js`
- `routes/workspace-api.js:86`, `routes/workspace-api-roadmap.js:25`, `routes/next-run.js:31`, `routes/task-chat.js:29` — all `mock-data.js`

`routes/proxy.js:138` uses the compliant dynamic form and is not counted. The dispatching run's "~11" failed to apply the `routes/test.js` exclusion (with it the figure would be 11).

**Cost.** Every production boot evaluates test-fixture modules and everything they transitively import becomes a production dependency. Unchanged this window; not promoted.

### 5. `periodical-report-filename-convention-split` — Medium-low — **unchanged**

The periodical registry's id-to-filename join is still not mechanical (`lib/periodicals.js:881` registers `id: 'design-review'` while reports persist as `design-interface-review-<date>.md`; `test-coverage-gap` carries no `-review` suffix). This is mechanically how an edition becomes "lost", and it is the sibling of the LIN-694 gate's residual gap (the gate verifies a comment citation exists, not that its target survives at a discoverable path). **Not promoted.**

### 6. `dispatch-kind-vocabulary-cross-repo` — Low-medium — **unchanged**

`simple-dispatcher/dispatcher.js:41` hardcodes a 3-key `NO_BOOTSTRAP_KINDS` subset (`implementation`, `research`, `plan`) drawn from `LinearViewer`'s `DISPATCH_KINDS` (`lib/prompt-templates.js:181`), duplicated across the repo boundary with no shared source and no cross-repo test. *Boundary: API Quality owns the wire contract; this row is the duplicated vocabulary representation only.* **Not promoted.**

### 7. `provider-resolution-incantation` — Low — **worsened (16 → 17 sites)**

The hand-rolled `w => w.urlKey === urlKey` lookup, 4 sites at 06-25, is now **17 sites** — `grep -rn "urlKey === urlKey" lib/ routes/ server.js` returns **18** raw matches, of which the canonical helper's own body is one (`lib/workspace.js:946`, inside `getWorkspaceByUrlKey`), leaving 17 call sites:

- `lib/workspace-token-resolver.js` — **8** (`:44, :146, :246, :316, :356, :398, :453, :577`)
- `lib/render.js:196, :222`; `lib/render-swim.js:34`; `lib/render-ship.js:53`; `lib/render-swipe.js:578`; `lib/render-roadmap.js:353`; `lib/components/navbar.js:320`
- Two sites new since 08-29: `lib/components/navbar.js:447` (`ws.urlKey === urlKey`, the select-option active check) and `lib/openrouter-key-resolver.js:101` (`located.urlKey === urlKey`, resolving a workspace id)
- `.some()` membership checks on a different data shape remain a related-but-distinct concern and are not counted: `routes/live-console.js:57`, `routes/dashboard.js:2554`.

**Root cause unchanged: a signature mismatch.** The canonical `getWorkspaceByUrlKey(session, urlKey)` (`lib/workspace.js:946`) takes a `session`; resolvers hold `data.workspaces`, renderers hold a bare `workspaces` array. Neither can call the canon without unwrapping to a session that doesn't exist at the call site, so each re-derives the lookup. **The fix is the helper's shape (accept a workspaces array), not 17 call-site edits.** Three renderers also carry the byte-identical `?.ui?.displayName || 'Linear'` fallback tail — with five providers live, changing that default is a 3-place edit. **LIN-2389** is the standing fix; updated, not duplicated (Follow-ups).

### 8. `ui-divergences-registry-staleness` — Low — **worsened (6 → 9 native `confirm()` sites); registry still says four**

`docs/ui-divergences.md` ratifies **four** native `confirm()` sites and states they must migrate together. At HEAD there are **nine** native sites (grep `confirm(` over `public/*.js`). The code-level count is this review's row; the registry-doc fix itself is routed to Documentation Review. **Not promoted** here.

### 9. `simple-dispatcher-api-base-duplication` — Low — **unchanged**

`simple-dispatcher/config.js:17` and `simple-dispatcher/feedback.js:5` each independently declare the API base. `config.js` is canonical (required by 10 modules); `feedback.js` re-derives it rather than import it. **Cost:** any future normalization silently diverges in the path that reports outcomes back to Harbour. **Not promoted.**

### 10. `cross-repo-halt-vocabulary` — Low, **report-only — new this window**

Halt modes + the halt record shape are defined independently on each side: `LinearViewer/lib/workspace-halt.js:28` `HALT_MODES = ['pause','stop']` and a `{mode,setAt,setBy}` record vs `simple-dispatcher/halt.js:231-251`'s `'pause'`/`'stop'` literals and `dispatcher.js:1525` rebuilding the same record. The series is fully-wired and Done (LIN-2994/2995/3041/3043/3044); only the vocabulary copies remain, tracked by **LIN-3074**. Same class as finding 6.

### 11. `cross-repo-sentinel-decision-marker-vocabulary` — Low, **report-only — new this window**

The **grammar parsing split is clean, producer → consumer**: `simple-dispatcher/hook.js:508` (`DECISION_PREFIX = '[decision] '`, emitted at `:585`) produces the structured message; `LinearViewer/lib/session-telemetry.js:674` (`parseDecision`, consumed via `parseDecisions:718` / `pipeline-loops.js:236`) parses it. Harbour does **not** re-parse the raw `DECISION:`/sentinel block. What remains duplicated is the *word vocabulary*: the sentinel words (`meta-prompt-template.js:204,303,306`, `prompt-formatters.js:918`) and the `[usage]`/`[evidence]`/`[failed]`/`[done]`/`[blocked]`/`[pending]` marker prefixes (SD emit vs `render-session.js:158-220` `WAITING_WAKE_MARKERS` + `kpi-stats.js parseTicketMarkers`). Renaming a sentinel/marker is a coordinated two-repo edit with no shared source and no cross-repo test. **Report-only.**

### 12. Remaining informational rows

- `cross-repo-repo-list` — two independent lists (Harbour `dispatch-repo-guard.js` vs SD `workspaces.json` basename); **deliberate**, divergence documented and closed by **LIN-2974** (Done). Not re-opened.
- `ci-convention-split-across-repos` — `LinearViewer` pins Node 20 with the single aggregate `ci-success` gate (`needs: [unit, e2e, secret-scan]`); `simple-dispatcher` pins Node ≥22 with no aggregate check. Unchanged; informational.
- `semicolon-style-split` — still mixed, no linter, no runtime cost; unchanged and never worth a reformat.

---

## Cross-repo contract verdicts (this window)

| field | verdict |
|---|---|
| `kind` | **Duplicated** (finding 6): LinearViewer `DISPATCH_KINDS` (`lib/prompt-templates.js:181`, 17 step-kinds + autopilot/defer/periodical/custom) vs SD 3-key subset (`dispatcher.js:41`). |
| `harness` / `terminal` | **Clean.** SD owns the vocabulary (`harnesses.js` claude-code\|opencode; `terminal-driver.js` iterm\|terminal\|kitty\|tmux); Harbour treats both as opaque ("runner-owned"). |
| `effort` | **Clean.** Single list, Harbour-only (`lib/dispatch-validation.js:51`, warn-only never-reject); SD `resolveEffort` opaque fail-soft. |
| `model` | **Clean.** Opaque on both sides. |
| `repo` | **Clean / deliberate.** Two independent lists, documented, closed by LIN-2974 (Done). |
| halt | **Shared vocabulary, independently defined** (finding 10); residual copy LIN-3074. |
| sentinel / `DECISION` / marker | **Grammar split is clean producer→consumer** (finding 11); only the word vocabulary is duplicated. |
| dispatch status enum | **Clean.** Single definition on LinearViewer (`lib/dispatch-terminal.js:27`); SD's `phases.js` `PHASES`/`TRANSITIONS` is a different axis entirely. |

---

## All other rows (carried, resolved, clean)

### Resolved (re-checked at HEAD, all held)

- `client-escape-html-duplication` — **held.** Only definition remains `window.escapeHtml` (`public/common.js:23`); `public/ship.js:739` aliases it.
- `client-shared-helper-duplication` — **held.** Only aliases of `window.relativeTime`/`window.renderMarkdown` remain in `public/`; `chat.js:307`'s `renderMarkdownText` is a distinct function, not a duplicate.
- `client-section-fetch-idiom-duplication` — **held.** `window.api()` (`public/common.js:540`) used by **20** `public/` files (up from 19).
- `linear-cli-parallel-graphql-surface` — **held.** `lib/linear-cli.js` absent.

### Clean (re-checked, no regression)

- `store-module-uniformity` — **reinforced.** **24** `lib/*-store.js` modules, all injecting `options.collection`.
- `server-side-escaping` — **reinforced.** **46** importers of `lib/utils/html.js`.
- `lib-components-primitive-adoption` — **reinforced.** **31** `lib/render*.js` modules all import from `lib/components/`.
- `dispatch-payload-centralization` — **held.** 8 `public/` callers of `window.dispatchPrompt`.
- `renderer-provider-abstraction` — **held.** `KNOWN_ADD_PROVIDERS` exists only in comments; renderers read `getProvider(x)`.
- `cache-module-family` — **held.** 7 caches in two coherent families (store-backed vs process-local Map+TTL).
- `state-store-write-seam` (SD) — **held.** Every production writer goes through `updateState(mutator)`; `saveStateAtomic` has zero external callers.
- `phase-vocabulary-centralization` (SD) — **held, exemplary.** Zero raw phase literals outside `phases.js`.
- `target-harness-axis-orthogonality` — **held.** `targets.js` (cli/web) and `harnesses.js` (claude-code/opencode) stay separate; `opencode` is a harness, not a target.
- `test-seam-separation` — **held.** `tests/helpers.js` holds no seeding; `tests/fixtures/local-harness.js` holds no selectors.

### Sibling-owned, recorded not re-flagged

- `css-token-layer` — the 08-29 "clean, one outlier" claim did not reproduce under a broad `#hex` count. This is a **Design & Interface** surface; recorded as a cross-reference only, not re-flagged here.

---

## Sibling Hand-offs

| Surface | Owner | Note |
|---|---|---|
| `css-token-layer` (suspected regression) | Design & Interface | Report-only cross-reference; not this review's finding. |
| `server.js` / `reapers.js` / `hook.js` size & complexity | Code Quality | Not measured or re-flagged. |
| `ui-divergences.md` doc-registry accuracy | Documentation Review (**LIN-3102**, in progress) | The code-level count (9) is this review's row; the registry fix is LIN-3102's. |
| Cross-repo halt vocabulary residual copy | **LIN-3074** | Class recorded here; copy tracked there. |
| Cross-repo repo-list divergence | **LIN-2974** (Done) | Recorded clean/deliberate, not re-opened. |
| Wire-contract design of the proxy/dispatch API | API Quality | Not in remit. |
| Rendered UI and CSS tokens generally | Design & Interface | Not in remit beyond the cross-reference above. |
| Third-party dependencies | Dependency & Supply-Chain | Not in remit. |
| Fetch/caching architecture | Data & Fetch Architecture | Not in remit. |

---

## Ticket trend — the promotion path is not converting

All three remain **Backlog with zero comments**. Their ages differ, so the "five editions" shorthand of prior editions is wrong and is corrected here per ticket (ages from each ticket's `createdAt` via the workspace API):

| ticket | finding | `createdAt` | minted by edition | persisted editions carried unmoved |
|---|---|---|---|---|
| **LIN-675** | provider seam | `2026-06-25T11:29:50Z` | 06-25 | **2** (08-29, 09-26); the 07-12 edition was lost and cannot be checked |
| **LIN-2388** | lib cycles | `2026-08-29T19:46:00Z` | 08-29 | **1** (09-26) |
| **LIN-2389** | incantation | `2026-08-29T19:46:01Z` | 08-29 | **1** (09-26) |

Research and plan records are **not** editions and are not counted. LIN-2388 and LIN-2389 were minted *by* the 08-29 edition, so they cannot have stood for more than the one persisted edition since. This review **updates** all three with the new legs/counts and **changes no workflow state and mints no duplicate**. Stated plainly: LIN-675 has now been recited for two persisted editions and LIN-2388/LIN-2389 for one, with zero comments and no state change, so the promotion path is still not converting new findings into movement — that is a trend fact about the process, not a reason to escalate ticket state or widen the ≤3 follow-up policy.

---

## Adversarial Second-Read

pending — filled in beat 3.

---

## Compact trend ledger

`07-12` was never recovered (lost edition, task LIN-1231); every 07-12 cell is marked `not recovered` and no value is interpolated.

| finding | severity | 06-25 | 07-12 | 08-29 | 2026-09-26 | delta |
|---|---|---|---|---|---|---|
| `lib-import-cycles` | medium | clean | not recovered | 3 elementary cycles / 3 modules / 5 edges (latent) | kpi 3 (unchanged) + **new 2-node `dispatch-store ↔ digest-feedback`** (latent) | **worsened (new cluster)** |
| `provider-auth-router-upward-imports` | medium | 2 edges, no cycle | not recovered | 4 edges, all inside static cycles; SCC 14 | 4 edges; **SCC 14→15** (+`github-install-flow` leg) | **worsened (SCC grew; edges unchanged)** |
| `routes-error-envelope-fragmentation` | medium | 5 importers, ~53 residue | not recovered | 14 importers, 68 residue; `dashboard.js` half-adopter | **26 importers**, **87 residue**; `flight-companion.js` 6→8 | **importers improved; residue worsened** |
| `production-to-test-fixture-imports` | medium-low | — | not recovered | 7 sites | 7 sites | unchanged |
| `periodical-report-filename-convention-split` | medium-low | — | not recovered | id↔filename join non-mechanical | same | unchanged |
| `dispatch-kind-vocabulary-cross-repo` | low-medium | — | not recovered | 3 hardcoded keys | 3-key subset | unchanged |
| `provider-resolution-incantation` | low | 4 sites | not recovered | 16 sites | **17 sites** (18 raw incl. canonical helper body) | **worsened** |
| `ui-divergences-registry-staleness` | low | — | not recovered | registry 4 / actual 6 | registry 4 / actual **9** | **worsened** |
| `simple-dispatcher-api-base-duplication` | low | — | not recovered | 2 | 2 | unchanged |
| `cross-repo-halt-vocabulary` | low | — | not recovered | — | independently-defined `{pause,stop}` / `{mode,setAt,setBy}`; LIN-3074 | new (report-only) |
| `cross-repo-sentinel-decision-marker-vocabulary` | low | — | not recovered | — | grammar split clean; word vocabulary duplicated | new (report-only) |
| `cross-repo-repo-list` | informational | — | not recovered | deliberate | deliberate; LIN-2974 Done | unchanged |
| `ci-convention-split-across-repos` | informational | — | not recovered | Node 20 vs 22 | same; `ci-success` `needs:[unit,e2e,secret-scan]` | unchanged |
| `semicolon-style-split` | low (informational) | unchanged | not recovered | unchanged | unchanged | unchanged |
| `client-escape-html-duplication` | — | resolved | not recovered | held | held | held |
| `client-shared-helper-duplication` | — | largely resolved | not recovered | resolved, held | held | held |
| `client-section-fetch-idiom-duplication` | — | resolved | not recovered | held (19 files) | held (**20 files**) | held |
| `linear-cli-parallel-graphql-surface` | — | resolved | not recovered | held | held | held |
| `store-module-uniformity` | — | clean (10) | not recovered | clean (22) | clean (**24**) | reinforced |
| `server-side-escaping` | — | clean (26) | not recovered | clean (45) | clean (**46**) | reinforced |
| `dispatch-payload-centralization` | — | clean (5) | not recovered | clean (8) | clean (8) | held |
| `renderer-provider-abstraction` | — | clean | not recovered | clean | clean | held |
| `cache-module-family` | — | — | not recovered | clean | clean (7) | held |
| `lib-components-primitive-adoption` | — | not assessed | not recovered | clean (30/30) | clean (**31/31**) | reinforced |
| `state-store-write-seam` (SD) | — | not assessed | not recovered | clean | clean | held |
| `phase-vocabulary-centralization` (SD) | — | not assessed | not recovered | clean, exemplary | clean, exemplary | held |
| `target-harness-axis-orthogonality` | — | not assessed | not recovered | clean | clean | held |
| `test-seam-separation` | — | not assessed | not recovered | clean | clean | held |
| `css-token-layer` | — | not assessed | not recovered | clean, 1 ratified outlier | does not reproduce (sibling-owned) | routed to Design & Interface |

*Measured at `LinearViewer` `6e8bf424` / `simple-dispatcher` `3b1e734`; report-time HEADs `b5c528c4` / `3b1e734`. Next run: re-ground every row against HEAD, not this prose. Watch items: whether either latent cycle turns live (a module-scope const or top-level peer read added to any member), whether a fifth provider edge appears before LIN-675 lands, whether `flight-companion.js` opens or closes its envelope residue, and whether LIN-675/2388/2389 finally move.*
