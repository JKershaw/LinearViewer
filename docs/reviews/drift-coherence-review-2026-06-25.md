# Drift & Coherence Review — run of 2026-06-25 (trend vs. 2026-06-11)

**Grounding:** reviewed at HEAD = `d9c51da` (merge of #617, 2026-06-25). Prior run: **2026-06-11** at HEAD `dbdfc33` — `docs/reviews/drift-coherence-review-2026-06-11.md` (LIN-419). Every finding below is re-grounded against current source at HEAD (not the prior prose) and framed as a delta against that run's Trend ledger. Review-only: no code/docs/config changed beyond this report and the Linear updates.

**Headline:** this is a **clean-up run, not a drift run**. All three follow-ups the 2026-06-11 run minted have **landed** — LIN-420 (adopt `lib/errors.js` in the big-three routes), LIN-421 (hoist client helpers), LIN-422 (de-dup client `escapeHtml`) — and LIN-479's shared `window.api()` quietly **resolved** the prior run's new low finding too. Four of last run's eight rows moved to *resolved* or *largely resolved*. The single regression is in **dependency direction**: the GitHub provider (LIN-178/LIN-541) copied the Linear provider's deliberate `lib/ → routes/` auth-router edge, so there are now **two** upward edges instead of one — exactly the "a second provider doubles the inversion" cost the prior run predicted. ~40 commits landed since `dbdfc33` (per-workspace provider selection LIN-581, proxy provider re-point LIN-308/309/310, GitHub provider + login, Observation promotion LIN-595, next-run LIN-603/645, attachment relay LIN-649/650, new session/run/task-snapshot stores) — and the canonical seams absorbed nearly all of it.

---

### 1. `routes-error-envelope-fragmentation` — Medium — *improved (markedly)*

`lib/errors.js` is canon (LIN-36). The prior run had **2** route importers against **246** inline `res.status(4xx).json({ error })` bodies, concentrated in proxy (106), workspace-api (80), dispatch (42). **LIN-420 landed** (commit `8fadcb9`): those three files now route through the canonical helpers and the inline count there collapsed.

At HEAD:
- **Importers of `lib/errors.js`: 5** — `routes/dispatch.js:18`, `routes/proxy.js:67`, `routes/workspace.js:8`, `routes/workspace-api.js:12`, plus `server.js`. Canonical-helper call sites are now dense: proxy 183, workspace-api 93, dispatch 49.
- **Inline `res.status(4xx/5xx).json` across `routes/`: 85 total**, of which **32 are in `routes/test.js`** (test-only fixtures, out of scope). Excluding tests, ~**53**, and the big three are essentially drained: `proxy.js` 1, `workspace-api.js` 1, `dispatch.js` 0.

The residue is a **new, smaller frontier**: the route files written/grown after the canon was established do not import `lib/errors.js` — `routes/dashboard.js` (17 inline), `routes/collective.js` (15), `routes/task-chat.js` (10), `routes/next-run.js` (5), `routes/legacy-redirects.js` (4). The character of the finding has flipped from "the canon has one adopter" to "the canon is dominant; four newer routes haven't adopted yet."

**Concrete cost:** much reduced. A fleet-wide error-response change (machine-readable `code`/`retryable`, request IDs, audit-on-4xx) now lands cleanly in `lib/errors.js` + the big-three; the remaining ~50 non-test inline bodies in the four newer routes would each need touching. Blast radius is a third of last run's.

**Fix direction (no sweep):** adopt `badRequest`/`jsonError`/`notFound` in `dashboard.js`/`collective.js`/`task-chat.js`/`next-run.js` *as those files are next touched* — do not mass-rewrite. Below the promotion bar this run (improving trend, no new pressure); recorded for the next run.

### 2. `client-escape-html-duplication` — Medium-low — *resolved*

**LIN-422 landed** (commit `fa493e1`). At HEAD the only definition of `escapeHtml` is the canonical `window.escapeHtml` (`public/common.js:23`). The prior "1 full copy + 2 delegate-fallbacks" are gone: `public/ship.js:681` now aliases (`const escapeHtml = window.escapeHtml`), and `prompt-section.js:20`, `sessions.js:39`, `context.js:24` all bind `const esc = window.escapeHtml` (with a sourced comment). `feedback-widget.js:33` keeps a thin guarded fallback (`window.escapeHtml ? … : String(...)`) — acceptable, since it is a self-contained widget. The `&#039;`/`&#39;` semantic split called out at baseline is gone with the private copy. No divergence surface remains.

**Delta:** resolved. Drops off the active ledger to a clean-row re-check next run.

### 3. `client-shared-helper-duplication` (relativeTime / renderMarkdown / stripCodeBlockWrapper) — Medium-low — *largely resolved*

**LIN-421 landed** (commit `b760bb4`). The prior run's 7 relative-time impls / 2 name spellings / 3 behaviors, 4 `renderMarkdown` copies, and 2 `stripCodeBlockWrapper` copies have collapsed onto `window.relativeTime` / `window.renderMarkdown` / `window.stripCodeBlockWrapper` (`public/common.js:95/69/50`). `brief.js`, `recap.js`, `sessions.js` alias `window.relativeTime`; `brief.js`, `prompt-section.js` alias the markdown/strip helpers; `app.js` and `swipe.js` no longer carry private `marked.parse`/`DOMPurify`/relative-time impls (sourced comments mark the convention). New consumers (`observation.js`, `next-run.js`) use the globals directly without re-defining — the convention is now self-propagating.

**One deliberate deviation remains:** `public/pipeline.js:34` keeps a private `function relativeTime(dateStr)` — the 30-day-cap-then-`toLocaleDateString()` variant. This is the divergent behavior the prior run already flagged; it is a genuine UX choice for the pipeline floor view, not an oversight. Left as a documented single deviation, not drift.

**Delta:** largely resolved (one intentional deviation). Drops to watch-only.

### 4. `provider-auth-router-upward-import` → `provider-auth-router-upward-imports` — Medium-low — *worsened* ⚠️

The prior run's lone `lib/ → routes/` edge has **doubled**. At HEAD there are **two**:
- `lib/providers/linear/index.js:33` → `routes/auth.js` (`createAuthRoutes`) — the original, documented edge (LIN-331).
- `lib/providers/github/index.js:49` → `routes/github-auth.js` (`createGitHubAuthRoutes`) — **new**, added with the GitHub provider (LIN-178 / LIN-541).

This is precisely the cost the 2026-06-11 run named: *"a second provider copying the pattern (GitHub LIN-178 / Jira LIN-275) doubles the inversion."* It is now realized. The pattern is becoming the **per-provider convention** for auth wiring (each provider's `getAuthRouter()` imports its own route factory from `routes/`), which means every future provider (Jira, etc.) will add a third, fourth edge.

**No static cycle (re-verified):** `routes/auth.js` and `routes/github-auth.js` both import only *downward* — `getProvider` from `lib/providers/registry.js`, `AuthExchangeError` from `interface.js`, and `lib/render*`/`lib/workspace.js`. `registry.js` still has **no static imports** (runtime `Map` registration), so the would-be `provider → its-auth-route → registry → provider` loop never closes statically. There are still **no `lib/ → server.js` edges**.

**Concrete cost:** doubled. Neither provider can be imported (unit test, non-HTTP consumer, the registry itself) without pulling in Express + that provider's auth/route stack; and the inversion now scales linearly with provider count rather than being a single grandfathered exception.

**Fix direction (no sweep):** apply the LIN-330 shim trick *once, generically* — move the auth-router **factories** under `lib/` (e.g. `lib/providers/<x>/auth-router.js`), leaving `routes/auth.js` / `routes/github-auth.js` as thin re-exports that `server.js` still mounts. That removes both `lib/ → routes/` edges and gives the third provider a downward-only template to copy. **Promoted to a follow-up this run** — it is the only row that regressed and the only one above the bar.

### 5. `linear-cli-parallel-graphql-surface` — Low — *unchanged*

`lib/linear-cli.js` still carries its own GraphQL surface (**18** `gql` blocks) in parallel with the Linear provider's (now **40** blocks in `lib/providers/linear/index.js`, grown with the proxy re-point). The CLI remains partially coupled — it still imports `getStateOrder` from `lib/providers/state-map.js` (`linear-cli.js:25`), so it is neither standalone nor sharing the provider's operations. Bounded: the consumers genuinely differ (agent CLI on `LINEAR_API_KEY` vs. the provider-backed web app). Watch only — explicitly out of scope per the proxy-provider tickets.

### 6. `provider-resolution-incantation` — Low — *improved*

The copy-pasted `getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))…` lookup is now at **4** renderer sites, down from 5: `lib/render-swim.js:33`, `lib/render-ship.js:51`, `lib/render-swipe.js:500` (all carrying the `?.ui?.displayName || 'Linear'` tail) and `lib/render.js:140` (captures the provider object). The fifth (`render-foreman.js`) is gone with the Foreman retirement (LIN-451). Notably, **LIN-581's per-workspace provider selection added no new incantation sites** — the per-workspace resolution stayed inside `getProviderForWorkspace`/the routes, not the renderers. Still renderer-local (those are the only sites holding a `workspaces` array + `urlKey` rather than a resolved workspace).

**Concrete cost:** a 4-place edit to change the lookup key or the `'Linear'` fallback; a one-line `resolveProviderUi(workspaces, urlKey)` next to `getProviderForWorkspace` collapses it. Not promoted (low; rides along with Finding 4's provider-layer touch if convenient).

### 7. `client-section-fetch-idiom-duplication` — Low — *resolved*

The prior run's new finding — the `const body = await res.json().catch(() => ({})); … err.status = res.status; throw err;` idiom copied 5× across `brief.js`/`recap.js`/`sessions.js` — is **gone**. **LIN-479 landed** the shared `window.api()` helper (`public/common.js:184`); the trio now calls `window.api(url, { on401: false })` (`brief.js:35/39`, `recap.js:32/36`, `sessions.js:60`) and the hand-rolled error-normalization no longer exists in any of them. The error-handling change the prior run worried about (surfacing `code`/`retryable`) now lands once in `window.api()`.

**Delta:** resolved.

### 8. `semicolon-style-split` — Low (informational; below the action bar) — *unchanged*

Stable cosmetic split (`lib/render.js`, `lib/tree.js`, `routes/workspace.js` semicolon-free; `routes/proxy.js`, stores, `routes/dispatch.js` use them; `routes/auth.js` near-free). No runtime cost, no linter, a reformat would be the cosmetic churn this review avoids. Recorded for trend only.

---

## Clean results (re-checked; no regression)

- **`lib-import-cycles` — clean.** No static cycle despite the doubled `lib → routes` edges (Finding 4) — `registry.js` has no static imports, no `lib → server.js` edges, `lib/components/` reaches upward nowhere.
- **`lib-to-routes-imports` — now 2 edges (folded into Finding 4, *worsened*).** Both are the deliberate per-provider auth-router pattern; everything else in `lib/` still imports only downward.
- **`store-module-uniformity` — clean (and broader).** All **10** `lib/*-store.js` follow the one injected-collection pattern (`options.collection`): `agent-status`, `custom-prompts`, `dispatch`, `free-tier`, `local`, **`observation-sessions`** (new, LIN-595), `prompt-trace`, `report-history`, `session`, `task-snapshot` (new, LIN-598). The store family grew by several members and stayed uniform.
- **`server-side-escaping` — clean (reinforced).** **26** importers of `lib/utils/html.js` (up from 19); no hand-rolled `replace(/&/g, '&amp;')` anywhere in `lib/`/`routes/` outside the canonical impl.
- **`renderer-provider-abstraction` — clean.** Renderers consume `provider.ui` / the `{nodes}` contract and provider-neutral fields (`identifier`); none reach into Linear-specific URL shapes. `routes/proxy.js` is now genuinely provider-backed (LIN-308/309/581), retiring the prior documented exception.
- **`dispatch-payload-centralization` — clean (reinforced).** `window.dispatchPrompt` (`public/common.js`) is the sole POST-assembly path for **5** callers (`app.js`, `dispatch.js`, `pipeline.js`, `next-run.js`, `prompt-section.js`) — `next-run.js` adopted it on arrival rather than re-rolling.

**Deliberate exceptions cross-referenced, not flagged:** `pipeline.js`'s divergent `relativeTime` cap (Finding 3); `feedback-widget.js`'s guarded `escapeHtml` fallback; the periodicals prompt-scaffold repetition; `lib/linear.js` re-export shim; `linear-cli.js`'s parallel GraphQL (Finding 5).

---

## Follow-ups minted this run (capped at top-3 by severity; default state)

1. **Hoist the provider auth-router factories under `lib/` (remove both `lib/ → routes/` edges)** — Finding 4. The only regressed, above-bar row.

Findings 1, 5, 6, 8 are recorded but **not** promoted (improving, watch-only, or below the bar). Findings 2, 3, 7 resolved this cycle — nothing to mint. **Under-creating deliberately:** one follow-up for the one real regression beats padding the queue.

**No re-mints:** LIN-420/421/422 (last run's three follow-ups) are all **Done** — verified by search — so none are carried.

---

## Trend ledger

| finding | severity | delta vs. 2026-06-11 |
|---|---|---|
| `routes-error-envelope-fragmentation` | medium | **improved** (LIN-420 landed; importers 2→5, big-three drained; inline 4xx in routes/ 246→~53 non-test; residue is 4 newer routes) |
| `client-escape-html-duplication` | medium-low | **resolved** (LIN-422; only canonical `window.escapeHtml`, all sites alias) |
| `client-shared-helper-duplication` | medium-low | **largely resolved** (LIN-421; canonical in common.js; only pipeline.js's intentional `relativeTime` cap remains) |
| `provider-auth-router-upward-imports` | medium-low | **worsened** (GitHub provider added a 2nd `lib→routes` edge; LIN-178/541; still no static cycle) |
| `linear-cli-parallel-graphql-surface` | low | unchanged (18 cli vs 40 provider gql blocks; still imports getStateOrder) |
| `provider-resolution-incantation` | low | **improved** (5→4 sites, foreman retired; LIN-581 added no new sites) |
| `client-section-fetch-idiom-duplication` | low | **resolved** (LIN-479 `window.api()`) |
| `semicolon-style-split` | low (informational) | unchanged |
| `lib-import-cycles` | — | clean (unchanged; no cycle despite 2 lib→routes edges) |
| `lib-to-routes-imports` | — | 2 edges — folded into the worsened row above |
| `store-module-uniformity` | — | clean (unchanged; family grew to 10, all uniform) |
| `server-side-escaping` | — | clean (reinforced; 26 importers) |
| `renderer-provider-abstraction` | — | clean (proxy now genuinely provider-backed) |
| `dispatch-payload-centralization` | — | clean (reinforced; 5 callers) |

*Run at HEAD `d9c51da`. Next run: re-ground every row against HEAD and mark `unchanged` / `improved` / `worsened` / `resolved` / `new`. Particular watch items: the error-envelope residue in the 4 newer routes (Finding 1) and whether a third provider adds a third `lib→routes` edge before Finding 4's shim lands.*
