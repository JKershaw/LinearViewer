# Drift & Coherence Review — baseline run (2026-06-10)

**This is the first run of this periodical — no prior run exists.** A Linear search for `Drift & Coherence Review (periodical run)` returns only this task and LIN-380 (an accidental duplicate of this task, no report). Every finding below is therefore a **baseline** with delta `new`; the next run should measure against the trend ledger at the bottom.

**Grounding:** reviewed at HEAD = `f6dc420` (LIN-378, 2026-06-10). Several commits landed after this task was minted (LIN-356/377/378/382); both starting threads from the description were re-verified at HEAD and still hold.

---

## Findings (severity-ranked)

### 1. `routes-error-envelope-fragmentation` — Medium

`lib/errors.js` is the canonical error-envelope module (LIN-36; declared canon in CLAUDE.md), but at HEAD exactly **one** route file imports it (`routes/workspace.js:8`). Everything else hand-rolls inline envelopes: **239** `res.status(4xx)` sites across the routes layer, concentrated in `routes/proxy.js` (94), `routes/workspace-api.js` (79), and `routes/dispatch.js` (42).

**Severity bound:** the shapes are wire-compatible — a tally of every inline `res.status(4xx|5xx).json({...})` shows the first key is `error` in all ~347 occurrences, matching `jsonError()`'s `{ error, ...extra }`. So there is no behavioral divergence today; this is implementation fragmentation, not contract fragmentation.

**Concrete cost:** any cross-cutting change to error responses (machine-readable error codes, request IDs, audit logging on 4xx/5xx) is a ~240-site edit instead of one function. And the dominant convention new code copies is the inline idiom, so the gap widens with every new route — `routes/dispatch.js` and `routes/proxy.js` postdate `lib/errors.js` and never adopted it.

**Fix direction (no sweep):** adopt `jsonError`/the common-response helpers in routes as they are touched, starting with the three biggest files; do not mass-rewrite 240 call sites for uniformity's own sake.

### 2. `client-escape-html-duplication` — Medium

Canonical: `window.escapeHtml` in `public/common.js:19`. At HEAD there are **5 re-implementations**:

- Full private copies (no delegation): `public/ship.js:679`, `public/brief.js:17`, `public/recap.js:16`
- Delegate-with-fallback copies: `public/prompt-section.js:20`, `public/sessions.js:37` (`window.escapeHtml ? … : <inline copy>`)

Every page that loads these scripts also loads `/common.js` first (verified across all `lib/render-*.js`, including the ship page at `lib/render-ship.js:159`), so the private copies and fallbacks never need to exist — they are pure divergence surface. Divergence is already real, not hypothetical: `common.js` escapes `'` as `&#039;` and returns `''` for any falsy input (so `0` and `false` vanish), while the copies use `&#39;` and `String(str == null ? '' : str)` (so `0` renders). Other pages (`audit.js`, `dispatch.js`, `app.js`, `swipe.js`) correctly use the global.

**Concrete cost:** this is a security-sensitive function with 6 bodies. A hardening fix (e.g. escaping backticks, fixing the falsy-zero bug) must land in 6 places; missing one leaves an inconsistent XSS posture across pages. This is exactly the pattern the dispatch-payload consolidation in `common.js` (`window.dispatchPrompt`, line 74 comment) was built to prevent.

**Fix direction:** point `ship.js`/`brief.js`/`recap.js` at `window.escapeHtml`; in the shared section renderers either keep a one-line delegation or drop the fallback (common.js is a guaranteed dependency); reconcile the `&#39;`/falsy semantics once, in common.js.

### 3. `client-shared-helper-duplication` (relativeTime / renderMarkdown / stripCodeBlockWrapper) — Medium-low

Same pattern class as finding 2, lower stakes:

- `relativeTime`: byte-identical copies in `public/brief.js:32`, `public/recap.js:25`, `public/sessions.js:51`, plus a divergent variant in `public/pipeline.js:34` (caps at 30 days then falls back to a locale date — the other three render `45d ago` forever).
- `renderMarkdown` (marked + DOMPurify pipeline): 4 copies — `public/app.js:140`, `public/brief.js:26`, `public/prompt-section.js:32`, `public/swipe.js:80` — with subtle differences (app.js assumes `marked` is loaded; the others guard; two apply `stripCodeBlockWrapper`, two don't).
- `stripCodeBlockWrapper`: duplicated in `public/prompt-section.js:26` and `public/swipe.js:74`.

**Concrete cost:** a sanitizer change (DOMPurify config, marked options) must be applied in 4 places to keep XSS posture uniform; timestamps already display inconsistently across pages for >30-day-old items.

**Fix direction:** one canonical `relativeTime` and `renderMarkdown` in `common.js` alongside `escapeHtml` (same no-build, `window.*` convention); pipeline's 30-day cap either becomes the shared behavior or stays as a documented local deviation.

### 4. `provider-auth-router-upward-import` — Medium-low

`lib/providers/linear/index.js:31` imports `createAuthRoutes` from `routes/auth.js` — the **only** `lib/ → routes/` import in the repo (verified by import-graph walk). It is documented as deliberate (LIN-331: `server.js` mounts `provider.getAuthRouter(...)`, see `server.js:421`), and there is **no static cycle** (verified repo-wide), but the layering is genuinely inverted: `routes/auth.js` itself imports `lib/providers/registry.js`, `lib/render.js`, and `lib/workspace.js`, so provider and route layer are load-order coupled in both directions.

**Concrete cost:** the Linear provider cannot be imported (e.g. in a unit test or a non-HTTP consumer) without pulling in Express and the auth route stack; and a second provider (GitHub LIN-178 / Jira LIN-275) copying this pattern doubles the inversion before anyone notices.

**Fix direction:** the same shim trick already used for `lib/linear.js` (LIN-330): move the auth-router factory under `lib/providers/linear/` (or `lib/auth/`), leave `routes/auth.js` as a thin re-export until callers are re-pointed. Zero behavior change.

### 5. `linear-cli-parallel-graphql-surface` — Low

`lib/linear-cli.js` maintains its own 24 GraphQL operations in parallel with the Linear provider's 26 (which share `ISSUE_FIELDS_FRAGMENT`, `lib/providers/linear/index.js:58`). The CLI is partially coupled already — it imports `getStateOrder` from `lib/providers/state-map.js` (`linear-cli.js:25`) — so it is neither standalone nor shared.

**Concrete cost:** a field-selection or pagination fix in the provider does not propagate to the CLI (and vice versa); the two surfaces can drift in what "an issue" contains. Bounded because the consumers genuinely differ (agent CLI vs web app) and the CLI is deliberately self-contained for `LINEAR_API_KEY` use.

**Fix direction:** watch; if it recurs as a real defect, share the read fragments only.

### 6. `provider-resolution-incantation` — Low

`getProviderForWorkspace(workspaces?.find(w => w.urlKey === urlKey))` is copy-pasted **8×** across 6 files (`lib/render.js:137`, `lib/render-foreman.js:40`, `lib/render-ship.js:50`, `lib/render-swim.js:32`, `lib/render-swipe.js:443`, `server.js`), five of them with the `?.ui?.displayName || 'Linear'` tail.

**Concrete cost:** changing the lookup (e.g. resolving by id instead of urlKey) or the fallback is an 8-place edit. A one-line helper (e.g. `resolveProviderUi(workspaces, urlKey)` next to `getProviderForWorkspace` in the registry) removes it.

### 7. `semicolon-style-split` — Low (informational; below the action bar)

CLAUDE.md declares semicolons as canon, but `lib/render.js`, `lib/tree.js`, `routes/workspace.js`, `routes/auth.js`, and `routes/openrouter-auth.js` are written semicolon-free, while the stores, `routes/proxy.js`, and `routes/dispatch.js` mostly use them; `server.js` is mixed. Recorded for trend purposes only: there is no runtime cost and no linter to enforce it, and a mass reformat would be exactly the cosmetic churn this review is told to avoid. Fix only on touched lines, if at all.

---

## Clean results (recorded so the next run can detect regressions)

- **Dependency direction otherwise clean:** no `lib/ → routes/` or `→ server.js` imports besides finding 4; **zero import cycles** repo-wide (DFS over the full ES-module import graph).
- **Store modules are uniform:** all 9 `lib/*-store.js` / preference stores follow one pattern — exported class with an injected `options.collection`, Mongo/MangoDB-agnostic. No fragmentation.
- **Server-side HTML escaping is consolidated:** 18 importers of `lib/utils/html.js`, zero hand-rolled escape implementations in `lib/`/`routes/`.
- **Renderers respect the provider abstraction:** the `{nodes: [...]}` issue shape is the provider contract, not a Linear leak — the local provider emits it too (`lib/providers/local/index.js:96`); display names and create-task URLs go through `provider.ui` / `getCreateTaskUrl`.
- **Dispatch payload assembly is centralized** in `window.dispatchPrompt` (`public/common.js:103`) — a previously-fixed drift class that has stayed fixed.

**Deliberate exceptions cross-referenced, not flagged:** the periodicals prompt-scaffold repetition (documented NOTE, `lib/periodicals.js:43`); `routes/proxy.js` staying on the Linear default pending LIN-306; `lib/linear.js` as a re-export shim pending LIN-306/LIN-331 re-pointing.

---

## Candidate follow-up tickets (severity-ordered; not created)

1. **"Adopt lib/errors.js in the three largest route files (proxy, workspace-api, dispatch)"** — replace inline `res.status(4xx).json({ error })` with `jsonError`/common responses in those files only; assert wire-compatibility with existing tests; no shape changes. (Finding 1)
2. **"De-duplicate client HTML escaping onto window.escapeHtml"** — ship.js/brief.js/recap.js use the global; reconcile `&#039;` vs `&#39;` and falsy-zero semantics once in common.js; drop or simplify the fallbacks in prompt-section.js/sessions.js. (Finding 2)
3. **"Hoist shared client helpers (relativeTime, renderMarkdown, stripCodeBlockWrapper) into common.js"** — one canonical each on `window.*`; decide pipeline's 30-day cap as shared behavior or documented deviation. (Finding 3)
4. **"Move the Linear auth-router factory under lib/, shim routes/auth.js"** — relocate `createAuthRoutes` so `lib/providers/linear` stops importing the routes layer; thin re-export preserves all callers; byte-identical behavior. (Finding 4)
5. **"Add resolveProviderUi(workspaces, urlKey) helper to the provider registry"** — collapse the 8 copy-pasted resolution incantations. Could ride along with ticket 4. (Finding 6)

---

## Trend ledger

| finding | severity | delta vs. prior run |
|---|---|---|
| `routes-error-envelope-fragmentation` | medium | new |
| `client-escape-html-duplication` | medium | new |
| `client-shared-helper-duplication` | medium-low | new |
| `provider-auth-router-upward-import` | medium-low | new |
| `linear-cli-parallel-graphql-surface` | low | new |
| `provider-resolution-incantation` | low | new |
| `semicolon-style-split` | low (informational) | new |
| `lib-import-cycles` | — | clean (baseline) |
| `lib-to-routes-imports` (other than auth-router) | — | clean (baseline) |
| `store-module-uniformity` | — | clean (baseline) |
| `server-side-escaping` | — | clean (baseline) |
| `renderer-provider-abstraction` | — | clean (baseline) |
| `dispatch-payload-centralization` | — | clean (baseline, previously-fixed drift class) |

*Baseline run at HEAD `f6dc420`. Next run: re-ground every row against HEAD and mark `unchanged` / `improved` / `worsened` / `resolved` / `new`.*
