# Drift & Coherence Review — run of 2026-08-29 (trend vs 2026-06-25)

**Grounding:** reviewed at `LinearViewer` HEAD = `292ac962` (`292ac962ad49fe01d107e3de4fce0c44059f5a47`), `simple-dispatcher` HEAD = `7064955` (`7064955636919ee7eeb1eb90c779e020405c6612`). Review-only: no code/config/secrets/docs under review were changed — only this report, its branch/PR, and Linear updates.

**Provenance — three-point trend, not two.** The last *persisted* report in this series is **2026-06-25** (`docs/reviews/drift-coherence-review-2026-06-25.md`, HEAD `d9c51da`, run task **LIN-668** — not LIN-1231, a mapping this ticket's own scaffolding got wrong). A run happened on **2026-07-12** (task **LIN-1231**) but **its report file was never committed on any ref** — confirmed via `git log --all --diff-filter=A -- 'docs/reviews/drift-coherence-review-*'`, which returns exactly three adds (06-10 LIN-381, 06-11 LIN-419, 06-25 LIN-695 — the 06-25 report was *itself* originally unpersisted and recovered retroactively by LIN-695). `git log --all -- 'docs/reviews/drift-coherence-review-2026-07-12.md'` is empty across 3,125 commits. However, **a complete compressed ledger of the 07-12 run is readable in LIN-1231's second comment** (2026-07-12T10:26Z, HEAD `262b19f`), so it is used below as a genuine intermediate datapoint, distinct from a persisted edition. Stated plainly: **last persisted report = 2026-06-25; last readable ledger = the LIN-1231 comment (07-12); this report is the first persisted edition since.** This series has now lost editions **twice** and recovered **once**.

**Why the loss keeps happening — first-party evidence, not speculation.** `lib/periodical-report-gate.js:9-11` states it outright: *"Three batches in a row (2026-06-25, 2026-07-11, 2026-08-23) produced tasks that reached Linear's Done state while their report survived only as a Linear comment."* **LIN-694** (the persistence gate) is Done, but by its own design (`lib/periodical-report-gate.js:16-33`) it only requires a comment citing a commit/PR/blob URL — it never verifies the file exists on disk, because the periodical registry is deliberately location-agnostic (LIN-1967). **The loss mode is narrowed by LIN-694, not closed** — this run adds a second, mechanical reason it keeps recurring (row 16 below).

**Headline: a re-baseline, not a small delta.** ~973 commits landed in `LinearViewer/` and ~414 in `simple-dispatcher/` since 2026-06-25 — the provider family grew from 2 to 5 (linear, github, github-projects, jira, local), and this is the first edition to substantively audit `simple-dispatcher/` at all. Two structural regressions cross the promotion bar: a **new, latent import cycle** in `LinearViewer/lib/` (never seen in any prior edition) and the **fourth consecutive worsening** of the provider auth-router dependency inversion, whose standing fix (LIN-675) has sat in Backlog, untouched, across all four editions. A helper-signature mismatch has let a renderer-local duplication pattern escape into `lib/` itself, now at 17 sites. Against that, the two client-side duplication rows this series has tracked since its first edition remain fully resolved, and `simple-dispatcher`'s state-write discipline — its one prior open question — is confirmed clean.

---

## Findings (severity-ranked)

### 1. `lib-import-cycles` — Medium — **NEW REGRESSION (clean in every prior edition)**

A full ESM import-graph walk of `lib/`+`routes/`+`public/`+`server.js` at HEAD finds a genuine 3-node static cycle among three `lib/` modules, verified by reading the source lines directly:

- `lib/kpi-stats.js:28-29` → `import { computeTerminalMarkedTaskCost } from './terminal-marked-task-cost.js'` and `import { computeWeeklyBudgetGauge } from './weekly-budget.js'`
- `lib/terminal-marked-task-cost.js:50` → `import { groupDispatchLineages, evidenceCountOf, OUTCOME_WINDOW_DAYS } from './kpi-stats.js'`
- `lib/weekly-budget.js:30-31` → `import { groupDispatchLineages } from './kpi-stats.js'` and `import { reduceLineageCost } from './terminal-marked-task-cost.js'`

All six edges are static top-level `import`s (confirmed by direct read, not a heuristic grep).

**Severity checked, not assumed — the cycle is latent, not live.** Every cross-module use (`groupDispatchLineages`, `reduceLineageCost`, `computeWeeklyBudgetGauge`, `computeTerminalMarkedTaskCost`, `evidenceCountOf`, `parseUsage`) sits inside a function body; the only top-level export among the three is `kpi-stats.js`'s own `OUTCOME_WINDOW_DAYS = 30` literal. There is no module-evaluation-time peer read, so there is no TDZ failure today — this is why the row ranks medium, not high.

**Cost.** The invariant protecting these three files — "nobody adds a const-at-module-scope, a class field default, or a top-level side effect that reads a peer" — is stated nowhere, tested nowhere, and invisible from any one file in isolation. The next edit to any of the three can turn a latent cycle into an order-dependent TDZ failure with no local signal at the call site.

**Delta is recent and localized.** The cycle formed inside this window: `lib/terminal-marked-task-cost.js` was added 2026-08-09 (`02026827`, LIN-1957) and `lib/weekly-budget.js` 2026-08-23 (`2ab2df76`, LIN-2118) — both after the 07-12 run. Every prior edition's watch item was the provider-auth seam (Finding 2); this cycle formed at an unrelated seam nobody was watching, which is itself the point: **structural hygiene needs re-checking as a whole-graph property each run, not just at the seam the last run flagged.**

**Promoted this run** — see Follow-ups.

### 2. `provider-auth-router-upward-imports` — Medium-low — **worsened (4th consecutive run: 2 → 3 → 4)**

At HEAD there are **four** `lib/ → routes/` upward import edges (confirmed by direct read of each provider's `index.js`):

- `lib/providers/linear/index.js:34` → `routes/auth.js` (`createAuthRoutes`) — original, LIN-331
- `lib/providers/github/index.js:67` → `routes/github-auth.js` (`createGitHubAuthRoutes`) — LIN-178/541
- `lib/providers/github-projects/index.js:60` → `routes/github-projects-auth.js` (`createGitHubProjectsAuthRoutes`) — landed since 07-12
- `lib/providers/jira/index.js:98` → `routes/jira-auth.js` (`createJiraAuthRoutes`) — new this window

**Still no static cycle:** `lib/providers/registry.js` has **zero** static imports (confirmed — runtime `Map` registration), so the would-be provider → auth-route → registry → provider loop never closes. **No `lib/ → server.js` edges** — every `server.js` string match inside `lib/` is a prose comment. A JSDoc `@param {import('../lib/providers/jira/index.js').JiraProvider}` type annotation at `routes/jira-auth.js:133` is a type-only annotation, not a runtime import — it does not count as an edge.

**Cost, unchanged in kind, 4× in scale.** No provider can be imported — a unit test, a non-HTTP consumer, the registry itself — without transitively pulling in Express and that provider's full route stack. The inversion now scales 1:1 with provider count, and a fifth provider would add a fifth edge with no structural change required to do so.

**LIN-675 is the standing, unlanded fix for this row and is updated by this review** rather than duplicated (see Follow-ups) — it has sat in Backlog with zero comments across all four editions this row has now appeared in, and its body still states "both … edges" (2), which is stale.

### 3. `provider-resolution-incantation` — Low → **worsened sharply (4 → 17 sites)**

The hand-rolled `w => w.urlKey === urlKey` lookup — 4 renderer sites at both the 06-25 and 07-12 editions — has escaped the renderers. At HEAD there are **17** sites across 11 files (confirmed by direct grep and read):

- `lib/workspace-token-resolver.js` — **7** sites (`:44, :146, :206, :276, :316, :358, :413`)
- `lib/render.js:193, :216`; `lib/render-swim.js:34`; `lib/render-ship.js:51`; `lib/render-swipe.js:578`; `lib/render-roadmap.js:353`; `lib/components/navbar.js:235`
- `lib/workspace.js:938` — this is the canonical helper's **own body** (`getWorkspaceByUrlKey(session, urlKey)`, exported at `:936`)
- `routes/live-console.js:57`, `routes/dashboard.js:2011` — `.some()` membership checks on a different data shape; a related but distinct concern, not counted in the 17

**Root cause confirmed: a signature mismatch, not independent duplication.** The canonical `getWorkspaceByUrlKey(session, urlKey)` takes a `session`; the resolvers hold `data.workspaces`; the renderers hold a bare `workspaces` array. Neither caller shape can call the canonical helper without first unwrapping to a session object that doesn't exist at their call sites, so each site re-derives the lookup instead. **The fix is the helper's own shape (accept a workspaces array), not 17 call-site edits.**

**Cost.** Three renderers (`render-swim.js:34`, `render-ship.js:51`, `render-swipe.js:578`) additionally carry the byte-identical `?.ui?.displayName || 'Linear'` fallback tail — with five providers now live, changing that default is a 3-place edit, and `'Linear'` is already a provider-specific literal sitting in otherwise provider-neutral code.

**Promoted this run** — see Follow-ups.

### 4. `production-to-test-fixture-imports` — Medium-low — **NEW**

The repo states its own norm and demonstrates the compliant idiom in the same file: `routes/proxy.js:137-145` lazy-loads a fixture only under test mode ("Lazy-load test fixtures only in test mode to avoid production dependency on test files"), and `routes/proxy.js:394` states it outright: *"kept inline (not imported) so production code never depends on a test fixture."* **Seven static imports violate that stated norm** (confirmed by direct read — all seven are top-level `import`, not the lazy/dynamic form):

- `server.js:97, :98, :99` — `mock-data.js`, `swim-sample-data.js`, `ship-dense-sample-data.js`
- `routes/workspace-api.js:73`, `routes/workspace-api-roadmap.js:23`, `routes/next-run.js:30`, `routes/task-chat.js:28` — all `mock-data.js` (`testMockData`/`testMockTeams`)

(`routes/test.js`'s fixture imports are excluded — that file *is* the test seam, by design.)

**Cost.** Every production process boot evaluates test fixture modules and anything they transitively import becomes a production dependency; the repo's own compliant pattern sits three lines away, in the same file, from one of its violations (`routes/proxy.js`), which means the divergence is between a stated convention and its own author's other files in the same PR-review radius — not an unfamiliarity gap.

### 5. `routes-error-envelope-fragmentation` — Medium — **severity unchanged, shape worsened**

`lib/errors.js` is canon. Adoption breadth **improved** across the series: importers went 5 (06-25) → 7 (07-12) → **15 at HEAD** (confirmed by direct grep: 10 `routes/` files, 4 `lib/` files — `linear-fetch.js`, `proxy-events.js`, `render-pages.js`, `workspace-token-resolver.js` — plus `server.js`). Canonical call-site density: `jsonError(` 257 combined-total call sites across `jsonError`/`badRequest` idioms, `badRequest.json`-family 222, confirming the canon is dominant, not marginal.

**But the residue's *shape* got worse**, and that is the more corrosive finding than the raw count. `routes/dashboard.js` imports `jsonError` (`:37`) yet converted **zero** of its 17 pre-existing inline `res.status(4xx|5xx).json` bodies (confirmed: 9 canonical-idiom hits vs. 17 raw inline hits in the same file) — a **half-adopter, new this window**. Verified via `git log -S "from '../lib/errors.js'" -- routes/dashboard.js`, which returns exactly one commit: `59505907` (LIN-2225, a feature ticket adding new Rulings-page handlers that happened to need `jsonError`). **The import arrived incidentally, not as a migration** — none of the file's 17 pre-existing sites were touched. This matters for the report's framing: it means the half-adopter shape is a natural by-product of ordinary feature work landing in an unmigrated file, not evidence of an abandoned initiative, and it will keep happening to the other never-adopters (`routes/task-chat.js`, now the largest holdout at 20 inline bodies and rising 10→19→20 across the series; `routes/collective.js`, 15, unchanged; `routes/next-run.js` 5, `routes/legacy-redirects.js` 4, `routes/live-console.js`/`routes/ship-biscuit.js` 2 each — all never-adopters).

**Cost.** A fleet-wide envelope change (machine-readable `code`/`retryable`, request IDs) now lands once in `lib/errors.js` for the dominant path, but `dashboard.js` specifically must now be read twice — a reader can no longer tell from the import line alone whether a given handler in that file is canonical.

**Not promoted** — improving in breadth, and the fix direction (adopt-on-next-touch, no sweep) is unchanged from every prior edition; recorded for the next run to re-check `dashboard.js` and `task-chat.js` specifically.

---

## Newly discovered in-remit rows

### 6. `periodical-report-filename-convention-split` — Medium-low — **NEW**

The periodical registry's id-to-filename join is not mechanical, and that is this series' own mechanism for losing editions. `lib/periodicals.js:881` registers `id: 'design-review'`, but its reports persist as `design-interface-review-<date>.md` (confirmed: `docs/reviews/design-interface-review-*.md` exists on disk; no `design-review-*.md` does) — the filename stem does not contain the registry id. Confirmed further: `test-coverage-gap` persists with no `-review` suffix at all, while seven sibling periodicals (`api-quality`, `code-quality`, `comprehension-debt`, `dependency-supply-chain`, `drift-coherence`, `integration-surface-maturity`, `recent-headwinds`) each add one. At least three registered periodicals (`data-fetch-architecture`, `onboarding-journey`, `performance-scale`) have no report file on disk at all.

**Cost, and it is this series' own cost.** A trend-aware review is instructed to find its prior editions by discovery from the registry; an id-keyed search for `design-review` returns nothing on disk — which is mechanically how an edition becomes "lost" the way 07-12 and the original 06-25 were. This is the process-coherence surface the task description puts explicitly in remit (the `docs/reviews/` series discipline itself), and it is the mechanical sibling of the LIN-694 gate's residual gap (the gate verifies a comment citation exists; it does not verify the citation's target survives at a discoverable path).

**Not promoted** to a new ticket — the fix touches the periodical registry, a surface no sibling review owns either, and this run defers to the required second read on whether it should be. Recorded as a report-only row plus this note on LIN-694's residual gap.

### 7. `dispatch-kind-vocabulary-cross-repo` — Low-medium — **NEW**

`simple-dispatcher/dispatcher.js:36` hardcodes `NO_BOOTSTRAP_KINDS = new Set(['implementation', 'research', 'plan'])` — three string literals drawn from `LinearViewer`'s own `PROMPT_TEMPLATES` keys (the source of `DISPATCH_KINDS`, `lib/prompt-templates.js:181`), duplicated across the repo boundary with no shared source and no cross-repo test.

**Cost.** Renaming or retiring a template key in `LinearViewer` silently changes launch behaviour in the runner (the bootstrap-skip stops applying) with no error and no test spanning both repos — a cross-repo representation of the same vocabulary that can only be kept in sync by hand. *Boundary note: API Quality owns the wire contract itself; what is in this review's remit is the duplicated representation of the vocabulary, not the contract.*

**Not promoted** — below the ~3 cap, and the fix (a small shared constants file or a documented sync note) is not yet the highest-severity gap in the window.

### 8. `simple-dispatcher-api-base-duplication` — Low — **NEW**

`simple-dispatcher/config.js:14` and `simple-dispatcher/feedback.js:5` each independently declare `const API_BASE = process.env.DISPATCH_API_URL || 'http://localhost:3000'`. `config.js` is the canonical config module (required by 10 other modules); `feedback.js` does **not** require it, instead re-deriving the same value in its own `getApiBase()` (`:8-11`).

**Cost.** Any future normalization to the canonical value (trailing-slash stripping, scheme validation, a changed default) silently diverges in the feedback path — which is specifically the path that reports session outcomes back to Harbour, so a silent divergence there is closest to invisible.

**Not promoted** — a one-line fix (import the canonical constant), but not the highest-severity remaining gap.

### 9. `ui-divergences-registry-staleness` — Low — **NEW, routed to LIN-2379**

`docs/ui-divergences.md` ratifies **four** native `confirm()` sites and states explicitly that all four should migrate together ("single-site migration is explicitly the wrong pattern"). At HEAD there are **six**: the four recorded (`common.js:1728`, `custom-prompts.js:195`, `proxy.js:218`, `dispatch.js:856`) plus two unrecorded (`public/session.js:39`, `public/settings.js:180`).

**Cost.** The registry exists so a coordinated migration knows its complete set; a stale registry makes the prescribed coordinated migration incomplete by construction the moment someone acts on it. *Boundary: Documentation Review (LIN-2379, in progress at this same HEAD) owns doc accuracy generally — what makes this row borderline in-remit here is that this specific doc functions as a coherence control, not description.* Per the coordination boundary set for this run, **this row is routed to LIN-2379 by name rather than promoted or duplicated here.**

### 10. `ci-convention-split-across-repos` — Informational — **NEW**

`LinearViewer` pins Node 20 (`.github/workflows/test.yml`) with no `engines` field and a single aggregate `ci-success` gate (confirmed: `.github/workflows/test.yml:100`, `needs: [unit, e2e]`, `if: always()`). `simple-dispatcher` pins Node 22 (`package.json` `engines.node >= 22.0.0`), declares `permissions: contents: read` explicitly, and has no equivalent aggregate check. *Boundary: Security and Dependency & Supply-Chain own their respective halves of this.* Recorded as cross-repo convention drift only, below the action bar.

---

## Unchanged

**11. `semicolon-style-split` — Low, informational, below the action bar — unchanged.** Across 195 files with ≥20 statements: 122 semicolon-ful, 32 semicolon-free, 41 mixed (the mixed set is dominated by template-literal-heavy `lib/prompts/*`). No linter enforces either style; no runtime cost. Recorded for trend only — **never worth a reformat**, per this row's standing exemption.

## Resolved (re-checked at HEAD, all held)

**12. `client-escape-html-duplication` — resolved, held.** Only definition remains `window.escapeHtml` (`public/common.js:23`); `public/ship.js:739` aliases it.

**13. `client-shared-helper-duplication` — resolved, held (fully, since 07-12).** Zero private `relativeTime`/`renderMarkdown` implementations remain in `public/`. `brief.js:26`, `scan.js:46`, `recap.js:23`, `sessions.js:51` alias `window.relativeTime`; `brief.js:25`, `prompt-section.js:25` alias `window.renderMarkdown`. The one intentional deviation this series tracked since 06-25 (`pipeline.js`'s private `relativeTime`) is gone with the file (LIN-877), consistent with the 07-12 comment-ledger's record.

**14. `client-section-fetch-idiom-duplication` — resolved, held.** `window.api()` (`public/common.js:514`) is used by **19** `public/` files (up from 17 at 07-12).

**15. `linear-cli-parallel-graphql-surface` — resolved, held.** `lib/linear-cli.js` was deleted in `fe99566d` (LIN-580), confirming the 07-12 comment-ledger.

## Clean rows (re-checked, no regression)

- **`store-module-uniformity` — clean, reinforced.** 10 (06-25) → 14 (07-12) → **22** `lib/*-store.js` modules; all 22 still take the injected `options.collection` pattern. Zero outliers across a family that has more than doubled.
- **`server-side-escaping` — clean, reinforced.** 26 → 38 → **45** importers of `lib/utils/html.js`; the only other `replace(/&/g, '&amp;')` in the repo is `public/common.js:26`, the deliberate client-side canonical counterpart.
- **`dispatch-payload-centralization` — clean, reinforced.** `window.dispatchPrompt` (`public/common.js:600`) referenced from **8** `public/` files (5 → 7 → 8).
- **`renderer-provider-abstraction` — clean, reinforced.** LIN-2010 (Done) made the provider registry the identity source; `KNOWN_ADD_PROVIDERS` survives only in past-tense comments; renderers read `getProvider(x)?.entryCta`.
- **`cache-module-family` — clean, unchanged since introduced by the 07-12 scope-widening pass.** 7 caches split into two internally coherent families by purpose (4 durable store-backed; 3 process-local Map+TTL) — not drift.

## Newly clean rows (surfaces this series had never assessed before this run)

- **`lib-components-primitive-adoption` — clean.** All 30 `lib/render*.js` modules import from `lib/components/` (20 shared primitives); no outlier renderer.
- **`state-store-write-seam` (`simple-dispatcher`) — clean. Closes this series' one open question about the runner.** Every production writer goes through `updateState(mutator)` — `reapers.js` (9 call sites), `dispatcher.js` (7), `hook.js` (1), `opencode-runner.js` (via an injected `updateStateFn` defaulting to it). `saveStateAtomic` is exported (`state-store.js:194`) but has **zero** callers outside `state-store.js` itself — no bypass writer exists anywhere in the runner.
- **`phase-vocabulary-centralization` (`simple-dispatcher`) — clean, exemplary.** `phases.js` owns `PHASES`/`ACTIVE_PHASES`/`TERMINAL_PHASES` plus a formal `TRANSITIONS` legality map; zero raw phase-string literals exist anywhere else in the repo — worth naming as the contrast that makes row 7 (`dispatch-kind-vocabulary-cross-repo`) legible as an anomaly rather than the norm.
- **`target-harness-axis-orthogonality` — clean, with a correction to this task's own scaffolding.** `targets.js` (cli/web) and `harnesses.js` (claude-code/opencode) are separate single-definition registries and stayed orthogonal. Note: **`opencode` is a harness, not a target** — a distinction this ticket's own seed prose conflated (worth stating so the axes aren't re-confused next run).
- **`test-seam-separation` — clean.** `tests/helpers.js` holds no provider-seeding logic; `tests/fixtures/local-harness.js` holds no selector/session helpers — the CLAUDE.md-documented separation holds.
- **`css-token-layer` — clean, one ratified outlier.** 24 of 30 `public/*.css` files carry zero raw hex values; `feedback-widget.css` is the one self-contained exception, by the same rationale as its guarded `escapeHtml` fallback. Design & Interface's surface; recorded, not flagged here.

## Recorded, documented, self-aware duplication (not promotable)

**`.markdown-body` shared-layer duplication.** The repo's own CLAUDE.md already names four hand-rolled Markdown-typography subsets (`.desc-full-content`, `.swipe-accordion-body`, `.comment-body`, `.task-edit-preview`) as a known, deliberate local-copy choice with a predicted fifth (LIN-1032, still Backlog). The repo has already reasoned about this and chosen the local copy deliberately for each; the shared-layer consolidation itself has no ticket owner. Design & Interface adjacency; not this review's fix to propose.

## Explicitly not re-flagged (sibling ownership, per this run's remit)

- `server.js` / `reapers.js` / `routes/proxy.js` size and per-module complexity — Code Quality's remit (**LIN-2378** in progress at this same HEAD; **LIN-2360** actively splitting `routes/proxy.js`).
- `routes/test.js`'s 57 fixture-only inline error bodies — out of scope by the same convention every prior edition applied.
- Documentation accuracy in general — Documentation Review's remit (**LIN-2379**, in progress at this same HEAD); this review does not treat doc accuracy alone as a finding (row 9 above is the one doc-shaped row in remit, and it is routed there by name, not kept here).
- Rendered UI fidelity, the CSS token layer generally — Design & Interface.
- The dispatch/proxy wire contract — API Quality.
- Third-party dependency issues — Dependency & Supply-Chain.

---

## Follow-ups minted or updated this run

Capped at ~3, biased toward under-creating per the task's own instruction; zero would have been a valid outcome.

1. **Updated LIN-675** ("Hoist provider auth-router factories under lib/") — corrected the edge count from "both … edges" (2) to **4**, added the two newly-observed edges (github-projects, jira) with citations, and reprioritized (Medium → High) given four consecutive worsening editions with zero comments in between. Not duplicated — this is the standing fix for Finding 2.
2. **LIN-2388** minted for `lib-import-cycles` (Finding 1) — break the `kpi-stats.js` ↔ `terminal-marked-task-cost.js` ↔ `weekly-budget.js` static cycle. Discrete, single-seam fix (extract the shared leaf functions or invert one import direction).
3. **LIN-2389** minted for `provider-resolution-incantation` (Finding 3) — fix the canonical `getWorkspaceByUrlKey` helper's signature (accept a workspaces array, not only a session) so the 17 call sites can converge on it; explicitly scoped as a helper-shape change, not a 17-site call-site sweep.

**Report-only, left in the ledger for the next run to promote (deliberately not padding the queue):** `production-to-test-fixture-imports` (Finding 4), `periodical-report-filename-convention-split` (Finding 6), `dispatch-kind-vocabulary-cross-repo` (Finding 7), `simple-dispatcher-api-base-duplication` (Finding 8), `ci-convention-split-across-repos` (Finding 10), `routes-error-envelope-fragmentation`'s `dashboard.js`/`task-chat.js` residue (Finding 5, improving trend, no new pressure).

**Routed, not minted:** `ui-divergences-registry-staleness` (Finding 9) → named to LIN-2379.

---

## Prior open items disposed of by this run

**LIN-1923** ("Drift & Coherence Review (trend vs 2026-07-12)") was minted 2026-08-07, never run, and carried four provider-abstraction hypotheses in its one comment. All four are dispositioned by this run's evidence:

1. Provider identity hand-maintained across four lists — **resolved.** LIN-2010 is Done; `KNOWN_ADD_PROVIDERS` exists only in past-tense comments; `lib/providers/index.js` is now the single barrel.
2. Capability declared five incompatible ways — **largely resolved.** `PROVIDER_SURFACE` (`lib/providers/interface.js:71`) is the single declaration; `supports()` derives by prototype diff; `ui` derives from `supports()`. (LIN-1968 remains open but has been re-scoped to a different, correctness-shaped problem — provider-level capability vs. binding-level credentials — and should not be read as this row's fix ticket.)
3. Three REST clients hand-roll timeout/retry/pagination — **refuted**, as LIN-1923 itself suspected. Only `jira/client.js` implements retry/backoff/`Retry-After` handling; `github/client.js` and `github-projects/client.js` have essentially none. This is divergent *capability*, not duplication — there is no shared behavior to consolidate toward.
4. The `lib/ → routes/` auth-router inversion — **this is Finding 2 above**, and LIN-675 is its standing fix, updated by this run.

Nothing in LIN-1923 remains live outside what this report already carries. **LIN-1923 is closed as superseded/duplicate of this task (LIN-2380)**, per the task's own instruction, now that the report, its follow-ups, and (below) the adversarial second-read all exist.

---

## Adversarial Second-Read

**Tier used:** _(filled in after dispatch — see the companion Linear comment for the authoritative record)_

**Question asked (verbatim, cold — no other context given):** *"What is the largest item in this window that this report missed or misfiled?"*

**Reader's full answer:** _(to be filled in verbatim)_

**Verdict fields (also posted as a single Linear comment on LIN-2380):**

```
Adversarial second-read verdict: <AGREE|DISAGREE>
Differed from top finding: <YES|NO>
Disposition: <fixed in place|escalated|no change>
```

---

## Compact trend ledger

| finding | severity | 06-25 | 07-12 (comment-ledger) | 08-29 (this run) | delta |
|---|---|---|---|---|---|
| `lib-import-cycles` | medium | clean | clean | **2 static cycles (latent)** | **new regression** |
| `provider-auth-router-upward-imports` | medium-low | 2 edges | 3 edges | **4 edges** | **worsened (4th run)** |
| `provider-resolution-incantation` | low | 4 sites | 4 sites | **17 sites** | **worsened sharply** |
| `production-to-test-fixture-imports` | medium-low | — | — | **7 sites** | **new** |
| `routes-error-envelope-fragmentation` | medium | 5 importers, ~53 residue | 7 importers, ~66 residue | 15 importers, 68 residue; `dashboard.js` now a half-adopter | unchanged severity, shape worsened |
| `periodical-report-filename-convention-split` | medium-low | — | — | id↔filename join non-mechanical; 3 periodicals w/ no report file | new |
| `dispatch-kind-vocabulary-cross-repo` | low-medium | — | — | dispatcher.js hardcodes 3 LinearViewer template keys | new |
| `simple-dispatcher-api-base-duplication` | low | — | — | `config.js`/`feedback.js` re-declare `API_BASE` | new |
| `ui-divergences-registry-staleness` | low | — | — | registry says 4 sites, HEAD has 6 | new (routed to LIN-2379) |
| `ci-convention-split-across-repos` | informational | — | — | Node 20 vs 22, gate parity differs | new |
| `semicolon-style-split` | low (informational) | unchanged | unchanged | unchanged | unchanged |
| `client-escape-html-duplication` | — | resolved | resolved | resolved, held | held |
| `client-shared-helper-duplication` | — | largely resolved | fully resolved | resolved, held | held |
| `client-section-fetch-idiom-duplication` | — | resolved | (17 files) | resolved, held (19 files) | held |
| `linear-cli-parallel-graphql-surface` | — | resolved | resolved | resolved, held | held |
| `store-module-uniformity` | — | clean (10) | clean (14) | clean (22) | reinforced |
| `server-side-escaping` | — | clean (26) | clean (38) | clean (45) | reinforced |
| `dispatch-payload-centralization` | — | clean (5) | clean (7) | clean (8) | reinforced |
| `renderer-provider-abstraction` | — | clean | clean | clean | reinforced |
| `cache-module-family` | — | — | clean (introduced) | clean | unchanged |
| `lib-components-primitive-adoption` | — | not assessed | not assessed | clean (30/30) | newly clean |
| `state-store-write-seam` (`simple-dispatcher`) | — | not assessed | not assessed | clean — no bypass writer | newly clean |
| `phase-vocabulary-centralization` (`simple-dispatcher`) | — | not assessed | not assessed | clean, exemplary | newly clean |
| `target-harness-axis-orthogonality` | — | not assessed | not assessed | clean | newly clean |
| `test-seam-separation` | — | not assessed | not assessed | clean | newly clean |
| `css-token-layer` | — | not assessed | not assessed | clean, 1 ratified outlier | newly clean |

*Run at `LinearViewer` HEAD `292ac962`, `simple-dispatcher` HEAD `7064955`. Next run: re-ground every row against HEAD, not this prose. Particular watch items: whether `lib-import-cycles` turns live (a module-scope const or class field added to any of the three files), whether a fifth provider adds a fifth `lib→routes` edge before LIN-675 lands, and whether `dashboard.js`/`task-chat.js` close any of their error-envelope residue.*
