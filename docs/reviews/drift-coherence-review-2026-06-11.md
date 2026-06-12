# Drift & Coherence Review — run of 2026-06-11 (trend vs. 2026-06-10 baseline)

**Grounding:** reviewed at HEAD = `dbdfc33` (LIN-417, 2026-06-11). Prior run: the **2026-06-10 baseline** at HEAD `f6dc420` — `docs/reviews/drift-coherence-review-2026-06-10.md`, also the report comment on LIN-381. Every finding below is re-grounded against current source (not the baseline prose) and framed as a delta against the baseline ledger.

**Headline:** no clean-baseline row regressed; no new high-severity drift. The code itself moved very little against these classes; most of the deltas this run are **re-grounding corrections** (the baseline over- or under-counted two findings) plus one genuinely new low-severity duplication class. 17 commits landed since the baseline, dominated by the local-provider E2E migration (LIN-403/404/405/406/407) and the proxy write/error surface (LIN-398/399/417) — the latter touched Finding 1's territory directly.

---

### 1. `routes-error-envelope-fragmentation` — Medium — *unchanged*

`lib/errors.js` is canon (LIN-36). At baseline exactly one route file imported it; **at HEAD two do**: `routes/workspace.js:8` (`badRequest`, `notFound`) and now `routes/proxy.js:37` (`workspaceUnavailableEnvelope`, added by LIN-417). Everything else still hand-rolls inline `res.status(4xx).json({ error })`. Inline 4xx counts at HEAD: **246** across `routes/`, concentrated in `routes/proxy.js` (106), `routes/workspace-api.js` (80), `routes/dispatch.js` (42). (Baseline tallied 239; the rise tracks file growth — proxy.js gained the append/replace endpoints in LIN-398 and the uniform write surface in LIN-399 — not a change in the fragmentation ratio.)

**What LIN-417 demonstrates:** it is exactly the cross-cutting error-shape change the baseline predicted. Faced with adding a structured `{ error, code, category, retryable, detail, context }` envelope, the author put it in the **canonical module** (`lib/errors.js:141` `errorEnvelope`, `:182` `workspaceUnavailableEnvelope`) and imported it into proxy — the right direction. But it is wired to exactly **one** call site (`routes/proxy.js:945`), so the richer shape now coexists with ~245 bare `{ error }` bodies. The fragmentation is unchanged in character; the module is now better positioned to absorb the next consumer.

**Concrete cost:** any fleet-wide error-response change (machine-readable codes, request IDs, audit-on-4xx) is still a ~245-site edit, and new code keeps copying the inline idiom.

**Fix direction (no sweep):** adopt `jsonError`/`badRequest`/… in the three largest route files as they are touched; do not mass-rewrite for uniformity. Promoted to a follow-up this run.

### 2. `client-escape-html-duplication` — Medium-low — *improved (re-grounded)*

Canonical: `window.escapeHtml` (`public/common.js:19`). The baseline reported **5** re-implementations; re-grounding at HEAD shows **3**, and two of the baseline's entries were inaccurate:

- **Full private copy:** `public/ship.js:679` — `function escapeHtml` (uses `&#39;`, returns `''` for null/undefined). The ship page **does** load `/common.js` first (`lib/render-ship.js:159`), so this copy is pure divergence surface. *unchanged.*
- **Delegate-with-fallback:** `public/prompt-section.js:21` and `public/sessions.js:38` (`window.escapeHtml ? … : String(str == null ? '' : str)`). *unchanged.*
- **Correction:** the baseline listed `public/brief.js:17` and `public/recap.js:16` as "full private copies." Neither file contains `escapeHtml` at HEAD **or at `f6dc420`** (verified with `git show f6dc420:public/brief.js`); these files were never touched since (last commit `fed9c6a`, pre-baseline). The baseline row was an over-count, not a resolution — I'm correcting the record so the trend stays honest.

So the real divergence is **1 full copy + 2 delegate-fallbacks**. The `&#039;`-vs-`&#39;` / falsy-zero semantic split called out at baseline still holds between `common.js` and `ship.js`.

**Concrete cost:** a security-sensitive function with 3 extra bodies — an XSS-hardening fix (escape backticks, fix the falsy-zero drop) must land in `common.js` + `ship.js`, and the two fallbacks should simply delegate (common.js is a guaranteed dependency on every page that loads them).

**Fix direction:** point `ship.js` at `window.escapeHtml`; drop the dead fallbacks; reconcile the `&#039;`/falsy semantics once in `common.js`. Promoted to a follow-up this run.

### 3. `client-shared-helper-duplication` (relativeTime / renderMarkdown / stripCodeBlockWrapper) — Medium-low — *unchanged (scope re-grounded wider)*

Re-grounding shows the relative-time cluster is **larger** than the baseline captured — **7** implementations under **two name spellings** and **three different behaviors**:

- *seconds-based, `Nd ago` forever* — `public/brief.js:32`, `public/recap.js:25`, `public/sessions.js:51` (byte-identical to each other).
- *mins/hours/`yesterday`/`Nd ago` <7d then `Mon D` short date* — `public/app.js:156` `formatRelativeTime`, `public/foreman.js:125` `formatRelativeTime`, `public/swipe.js:95` `formatRelativeTime` (the baseline omitted this whole sub-cluster).
- *30-day cap then `toLocaleDateString()`* — `public/pipeline.js:34` `relativeTime` (the divergent variant the baseline already flagged).

`renderMarkdown` (marked + DOMPurify): **4** copies — `public/app.js:140`, `public/brief.js:26`, `public/prompt-section.js:32`, `public/swipe.js:80` — with subtle guards differing (app.js assumes `marked`/`DOMPurify` may be absent and checks; others vary; two apply `stripCodeBlockWrapper`, two don't). *unchanged.* `stripCodeBlockWrapper`: **2** copies — `public/prompt-section.js:26`, `public/swipe.js:74`. *unchanged.*

**Concrete cost:** a DOMPurify/marked config change must land in 4 places to keep XSS posture uniform; and the relative-time split is **user-visible today** — a 90-day-old timestamp renders as `90d ago` (brief/recap/sessions), `Mar 12` (app/foreman/swipe), or a locale date (pipeline) depending on the page. The two name spellings (`relativeTime` vs `formatRelativeTime`) are themselves convention fragmentation.

**Fix direction:** one canonical `relativeTime`/`renderMarkdown` on `window.*` in `common.js` (same no-build convention as `escapeHtml`); pick one old-timestamp behavior as the shared default and document pipeline's cap as a deviation if kept. Promoted to a follow-up this run (paired with the escapeHtml dedup as the "hoist shared client helpers" task).

### 4. `provider-auth-router-upward-import` — Medium-low — *unchanged*

`lib/providers/linear/index.js:31` still imports `createAuthRoutes` from `routes/auth.js` — the **only** `lib/ → routes/` edge in the repo (re-verified: a grep for `from '…routes/'` under `lib/` returns this one line; no `lib/ → server.js` edges; `lib/components/` reaches upward nowhere). It is documented as deliberate (LIN-331; `getAuthRouter` at `linear/index.js:770`, mounted from `server.js`). **No static cycle:** `routes/auth.js` imports only downward (`registry`, `render`, `workspace`), and `lib/providers/registry.js` has **no static imports** (runtime `Map` registration), so the would-be `linear → auth → registry → linear` loop never closes.

**Concrete cost:** the Linear provider can't be imported (unit test, non-HTTP consumer) without pulling in Express + the auth stack; a second provider copying the pattern (GitHub LIN-178 / Jira LIN-275) doubles the inversion.

**Fix direction:** the LIN-330 shim trick — move the auth-router factory under `lib/`, leave `routes/auth.js` a thin re-export. Not promoted this run (medium-low, no new pressure).

### 5. `linear-cli-parallel-graphql-surface` — Low — *unchanged*

`lib/linear-cli.js` still maintains its own GraphQL operations (18 `gql` template blocks) in parallel with the Linear provider's (`lib/providers/linear/index.js`, 10 blocks sharing `ISSUE_FIELDS_FRAGMENT`). The CLI remains partially coupled — it still imports `getStateOrder` from `lib/providers/state-map.js` (`linear-cli.js:25`, used at `:268`) — so it is neither standalone nor shared. Bounded: the consumers genuinely differ (agent CLI on `LINEAR_API_KEY` vs web app). Watch only.

### 6. `provider-resolution-incantation` — Low — *improved (re-grounded)*

The copy-pasted lookup `getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))` appears at **5** renderer sites, not the baseline's "8× across 6 files": `lib/render.js:137`, `lib/render-foreman.js:40`, `lib/render-ship.js:50`, `lib/render-swim.js:32`, `lib/render-swipe.js:443` (four carry the `?.ui?.displayName || 'Linear'` tail; `render.js` captures the provider object instead). `server.js` was counted at baseline but does **not** use this incantation — it calls `getProviderForWorkspace(workspace)` on an already-resolved workspace (`server.js:447`, `:1175`, `:1328`), as do the routes. So the duplication is renderer-local (those are the only sites holding a `workspaces` array + `urlKey` rather than a resolved workspace).

**Concrete cost:** changing the lookup key (urlKey → id) or the `'Linear'` fallback is a 5-place edit. A one-line `resolveProviderUi(workspaces, urlKey)` helper next to `getProviderForWorkspace` collapses it. Not promoted (low; could ride along with Finding 4).

### 7. `client-section-fetch-idiom-duplication` — Low — *new*

The paired client section modules re-implement an identical fetch-error-normalization idiom — `const body = await res.json().catch(() => ({})); const err = new Error(body.error || '…failed: ' + res.status); err.status = res.status; throw err;` — across `public/brief.js` (`:52`, `:63`), `public/recap.js` (`:45`, `:56`), and `public/sessions.js` (`:71`): **5 occurrences in 3 files**. These three modules are near-clones of each other (same `relativeTime`, same `fetchXStatus`/`fetchX` shape), so the whole trio is a copy-paste family. Surfaced by this run's fetch-wrapper sweep; the baseline didn't record it.

**Concrete cost:** any change to client-side error handling for these JSON section endpoints (e.g. surfacing `code`/`retryable` from the new LIN-417 envelope, or unified retry/backoff) is an N-place edit across the trio. Low because the behavior is currently uniform and the blast radius is three small modules. Folds naturally into the same `common.js` consolidation as Finding 3. Not promoted on its own.

### 8. `semicolon-style-split` — Low (informational; below the action bar) — *unchanged*

The split is stable: `lib/render.js`, `lib/tree.js`, `routes/workspace.js` remain semicolon-free; `routes/proxy.js`, the stores, `routes/dispatch.js` use them; `routes/auth.js` is near-free. No runtime cost, no linter, and a reformat would be the cosmetic churn this review avoids. Recorded for trend only; fix on touched lines if at all.

---

## Clean results (re-checked; no regression)

- **`lib-import-cycles` — clean.** Single documented `lib → routes` edge (Finding 4), no static cycle (registry has no static imports), no `lib → server.js` edges, `lib/components/` clean.
- **`lib-to-routes-imports` (other than auth-router) — clean.** Re-verified by import grep; the auth-router edge is still the only one.
- **`store-module-uniformity` — clean.** All 7 `lib/*-store.js` follow the one pattern (exported class over an injected `options.collection`, Mongo/Mango-agnostic).
- **`server-side-escaping` — clean.** 19 importers of `lib/utils/html.js` (up from 18); the only hand-rolled `replace(/&/g, '&amp;')` in `lib/`/`routes/` is the canonical impl itself.
- **`renderer-provider-abstraction` — clean.** Renderers consume `provider.ui` / the `{nodes}` provider contract; no renderer reaches into Linear-specific shapes. `routes/proxy.js` staying on the Linear default is the documented LIN-306 exception, cross-referenced not flagged.
- **`dispatch-payload-centralization` — clean (and reinforced).** `window.dispatchPrompt` (`public/common.js:103`) is now the sole POST-assembly path for **4** callers (`app.js:1081`, `dispatch.js:88`, `pipeline.js:680`, `prompt-section.js:619`) — wider adoption than baseline. Previously-fixed drift class, still fixed.

**Deliberate exceptions cross-referenced, not flagged:** the periodicals prompt-scaffold repetition (`lib/periodicals.js` NOTE); `routes/proxy.js` on the Linear default pending LIN-306; `lib/linear.js` as a re-export shim.

---

## Follow-ups minted this run (top-3 by severity; default state)

1. Adopt `lib/errors.js` in the three largest route files (proxy, workspace-api, dispatch) — Finding 1.
2. Hoist shared client helpers (relativeTime, renderMarkdown, stripCodeBlockWrapper) into `common.js` — Findings 3 + 7.
3. De-duplicate client `escapeHtml` onto `window.escapeHtml` — Finding 2.

Findings 4, 5, 6, 8 are recorded but **not** promoted (below the bar this cycle); the next run can promote what still matters.

**Archive note:** this report is ready to be copied to `docs/reviews/drift-coherence-review-2026-06-11.md` as the greppable archive — that is the separate owner-driven step (PR #393 precedent) and is **not** committed by this review-only run.

---

## Trend ledger

| finding | severity | delta vs. 2026-06-10 |
|---|---|---|
| `routes-error-envelope-fragmentation` | medium | unchanged (canonical module gained a 2nd importer via LIN-417; inline 4xx 239→246, tracks file growth) |
| `client-escape-html-duplication` | medium-low | improved (re-grounded: 3 reimpls, not 5 — baseline's brief.js/recap.js entries were inaccurate) |
| `client-shared-helper-duplication` | medium-low | unchanged (scope re-grounded wider: 7 relative-time impls / 2 names / 3 behaviors) |
| `provider-auth-router-upward-import` | medium-low | unchanged (lone lib→routes edge, no cycle) |
| `linear-cli-parallel-graphql-surface` | low | unchanged |
| `provider-resolution-incantation` | low | improved (re-grounded: 5 renderer sites, not 8/6-files; server.js never used the incantation) |
| `client-section-fetch-idiom-duplication` | low | new |
| `semicolon-style-split` | low (informational) | unchanged |
| `lib-import-cycles` | — | clean (unchanged) |
| `lib-to-routes-imports` (other than auth-router) | — | clean (unchanged) |
| `store-module-uniformity` | — | clean (unchanged) |
| `server-side-escaping` | — | clean (unchanged) |
| `renderer-provider-abstraction` | — | clean (unchanged) |
| `dispatch-payload-centralization` | — | clean (unchanged; more callers adopted it) |

*Run at HEAD `dbdfc33`. Next run: re-ground every row against HEAD and mark `unchanged` / `improved` / `worsened` / `resolved` / `new`.*
