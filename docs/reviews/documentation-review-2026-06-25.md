# Documentation Review — run of 2026-06-25 (builds on the 2026-06-22 baseline)

**Grounding:** reviewed at HEAD = `683d504` (LIN-580 merge, 2026-06-25). Every finding is re-grounded against current source at HEAD, cited to `file:line`, not to prior prose. Baseline under the report contract: `docs/reviews/documentation-review-2026-06-22.md` (run at `238b7b9`). A re-grounding research note was posted on LIN-664 at HEAD `d9c51da`; this report re-verifies it at `683d504`, which is one commit further on — **LIN-580 removed `lib/linear-cli.js` and rewrote ~159 lines of CLAUDE.md after that note was written**, so the GitHub/source-tree findings below were re-checked against the post-LIN-580 CLAUDE.md, and a new CLI-transport drift finding (NEW-4) is added.

**Headline:** the three promoted follow-ups from the baseline all landed (LIN-605/606/607), so baseline rows 1–5 are **resolved** — the consumer wire contracts, the CLAUDE.md source-tree map's original gaps, the `FREE_TIER_*` env vars, and the `llms.txt` template/quota drift are all fixed at HEAD. Drift has **re-concentrated in CLAUDE.md** as the codebase moved on: a whole new **GitHub-login auth surface** (`routes/github-auth.js`, the `## Authentication` section, six `GITHUB_*` env vars) is undocumented there (NEW-1), and the source-tree map has **re-drifted** with the Observation substrate + feedback widget + the new route absent (NEW-2). The consumer-contract surface is now nearly clean except a single **error-code asymmetry** (NEW-3 / evolved Finding 7): neither the served instructions nor the guide's error *table* lists the full set the code returns. The three baseline carryovers never promoted (F6/F8/F9) remain open and below the bar. Every finding is a doc-only edit — see Surface Assessment.

---

### 1. `claude-md-github-auth-surface-undocumented` — Medium-high — *new*

The GitHub-login feature (LIN-541, merged `7b3f1f5`) is a first-class auth path that `README.md` documents (GitHub OAuth setup, added in `e8a613d`) but `CLAUDE.md` is silent on across **three** surfaces:

- **Routes map omits the whole route file.** `routes/github-auth.js` defines `/auth/github`, `/auth/github/callback`, and `/auth/github/link` (`routes/github-auth.js:67,94,169`), but the routes map lists only `auth.js` and `openrouter-auth.js` (`CLAUDE.md:23-24`).
- **`## Authentication` section has no GitHub subsection.** It documents Linear OAuth 2.0, PAT mode, OpenRouter OAuth, and Free Tier (`CLAUDE.md:240,252,267,282`) but stops there — a reader learns every auth path except GitHub.
- **`## Environment Variables` block omits all GitHub config vars.** Read in code but absent from the env block (`CLAUDE.md:296-307`): `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`, `GITHUB_API_BASE`, `GITHUB_OAUTH_AUTHORIZE_URL`, `GITHUB_OAUTH_TOKEN_URL`.

This is the exact recurrence-class of resolved baseline Finding 5 (`claude-md-missing-free-tier-env-vars`): a new operator-facing config + auth surface lands in code and README but never reaches CLAUDE.md. Promoted (folds NEW-2's route line). **Medium-high** — operator-facing config and the densest orientation surface, but not a consumer wire contract.

### 2. `claude-md-source-tree-map-redrift` — Medium — *new*

CLAUDE.md's source-tree map, refreshed wholesale by LIN-606 and again touched by LIN-580, has re-drifted as new substrate landed. Files that exist at HEAD and are absent from the map:

- `routes/github-auth.js` (also Finding 1's route line).
- Observation first-class-view substrate: `lib/observation-sessions-store.js`, `lib/observation-sessions-materializer.js`, `lib/sessions-feed-cache.js` — the backing store/materializer/cache for the Observation page the map's own LIN-595 prose describes.
- `public/feedback-widget.js` + `public/feedback-widget.css` (LIN-635) — the footer feedback widget, a shipped first-class surface.

Lower-weight helpers also unmapped (`lib/async-errors.js`, `lib/db-indexes.js`, `lib/feedback-title.js`) fall under the map's own "a handful of small helpers may not be listed" disclaimer — recorded, not counted against the map. The Observation substrate and the new route do **not**. Promoted by folding into the Finding 1 CLAUDE.md edit. **Medium** — degrades orientation, breaks no call.

### 3. `proxy-error-code-asymmetry` — Medium — *evolved from baseline Finding 7*

Baseline Finding 7 (`proxy-504-undocumented-both-references`) is **improved but still open, now inverted into an asymmetry**: neither the served instructions nor the guide's error *table* is exhaustive, and they miss *different* codes.

- **Served `/api/proxy/instructions` Error Codes list omits 504.** The list (`routes/proxy.js:1356-1364`) runs 400/401/403/404/409/429/500/502/503 — no 504, even though the code maps `TimeoutError`/`AbortError` → 504 (`routes/proxy.js:739`, reachable from `/me`, `/issues`, `/stack`, `/recommend`, …).
- **Guide error *table* omits 502.** The table (`docs/proxy-integration.md:1304-1307`) now lists 504 (baseline fix landed) but not 502, even though the code returns 502 on a rejected write (`routes/proxy.js:791-792`) and the served instructions list it (`routes/proxy.js:1362`). 502 appears in the guide only as prose (`docs/proxy-integration.md:101,854`), never in the consumer-facing error table.

A consumer building exhaustive error handling from either single source misses a real status. The fix is two one-line additions (504 to the served list, 502 to the guide table). Promoted. **Medium** — consumer contract, but a missing 5xx row degrades robustness rather than breaking a happy-path call.

### 4. `periodicals-stale-rationale-counts` — Medium — *unchanged from baseline Finding 6 (still open)*

`lib/periodicals.js:42-45` header comment still says "the **seven** code-surface reviews are 'corrective'" and "the Stability Review (LIN-453) is the **first** 'advisory' entry". The registry now holds **9 corrective + 2 advisory** = 11 entries (`mode:` at `lib/periodicals.js:443,451,459,467,475,483,491,499,507,515,523`; advisory = Stability `:499` + Recent Headwinds `:515`). The "eleven prompt builders" claim at `:51` is correct (11 total). A present-but-wrong embedded count is exactly the inline-rationale drift this review owns. Cheap single-file fix. Recorded; promoted this cycle (it has now survived one full cycle unfixed and is a one-line correction).

### 5. `direction-layer-proposal-stale-cli-transport` — Low — *new*

LIN-580 removed `lib/linear-cli.js` and updated README, CLAUDE.md, `docs/executive-summary.md`, and `docs/prompt-audit-instructions.md` (see `fe99566`), but **missed** `docs/direction-layer-proposal.md:21`, which still asserts "There are **four** transport layers for getting prompts to agents (dispatch queue, proxy API, **Linear CLI**, llms.txt + data attributes)". Only three transports remain. This is a long-form proposal/notes doc (lower blast radius than a contract), so the stale claim misleads orientation but breaks no call. Recorded, not promoted — a one-line edit the next CLAUDE.md/docs pass can fold in.

### 6. `claude-md-components-undercount` — Low (informational) — *unchanged from baseline Finding 8 (still open)*

`CLAUDE.md:140-141` lists only `navbar.js` and `footer.js` under `lib/components/`; nine files exist (`card`, `empty-state`, `field`, `page-header`, `page`, `section`, `status-pill` also). Legitimately within the map's "small helpers" disclaimer, though `page.js`/`section.js`/`card.js` are structural enough that a one-line "+ small card/section/page/field/status-pill primitives" would help. Recorded, not promoted.

### 7. `readme-omits-view-tiers` — Low — *unchanged from baseline Finding 9 (still open)*

`README.md:21-28` still presents Tree/Swipe/Swim/Roadmap/Ship/Pipeline as a flat "Views" list; per `docs/view-tiers.md` and `CLAUDE.md:208-210`, Roadmap/Pipeline are flag-gated power-user and Ship is experimental, so a newcomer can't reach them on first run. Not wrong, mildly misleading. Recorded, not promoted.

---

## Surface Assessment (necessity gate)

Every finding is a **doc-only edit** — fix the prose to match the code. None demands a structural/code change: the GitHub-login routes and env vars, the Observation substrate, the feedback widget, the 502/504 paths, the periodical registry, and the removal of `linear-cli.js` are all already correct and shipped; only their documentation lags. No consumer in this task calls for a new seam, and no bystander pays a refactor tax. Verdict: **no refactor required — all findings land cleanly as documentation edits.** (One adjacent *improvement noticed, not required*, carried over from the baseline: the dispatch `kind` vocabulary being hard-typed in the guide rather than generated from `DISPATCH_KINDS`, and the two divergent proxy error lists — a single generated error catalog would prevent both re-drift classes but is not demanded by any finding here.)

---

## Clean results (re-checked at HEAD; no drift)

- **Consumer wire contracts (baseline rows 1–2) — resolved.** `followUpTo` (`docs/proxy-integration.md`, 4 refs), `/autopilot/manual` (1 ref), dispatch `kind`, the `local` target (`docs/dispatch-integration.md`, 4 refs), and the terminal-marker completion convention (`docs/dispatch-integration.md:196-213`, "Signaling Completion (terminal markers)") are all now documented.
- **`llms.txt` template + quota (baseline row 3) — resolved.** The deleted `code-review` template is gone; `review` is present (`public/llms.txt:197`); free-tier quota reads 20/day (`public/llms.txt:119,387`). DOM selectors re-checked, no regressions.
- **CLAUDE.md source-tree original gaps (baseline row 4) — resolved (re-drift tracked separately as Finding 2).** `foreman-store.js`→`agent-status-store.js` rename done (`CLAUDE.md:115`); the GitHub *provider* is mapped (`CLAUDE.md:51`); task-chat/styleguide views and the ~9 previously-unmapped `lib/` modules are present.
- **`FREE_TIER_*` env vars (baseline row 5) — resolved.** `FREE_TIER_DAILY_LIMIT`/`FREE_TIER_HOURLY_LIMIT` now in the env block (`CLAUDE.md:306-307`).
- **Linear CLI catalog (baseline clean row) — N/A.** `lib/linear-cli.js` was deleted by LIN-580 (`fe99566`); the baseline's "18 commands map to handlers" clean row no longer applies. Primary docs (CLAUDE.md/README/llms.txt) carry no stale CLI references; the only residual is `docs/direction-layer-proposal.md:21` (Finding 5).
- **Auth routes, proxy scopes/error envelopes, dispatch core contract, inline rationale (sampled) — clean** (aside from Finding 4's periodicals header). Spot-rechecked; no regressions.

---

## Follow-ups minted this run (top-3 by severity; default state)

1. **Document the GitHub-login auth surface in CLAUDE.md** — add `routes/github-auth.js` to the routes map, a GitHub subsection to `## Authentication`, the six `GITHUB_*` env vars to `## Environment Variables`, and fold in the Finding 2 source-tree re-drift (Observation substrate + feedback widget). Findings 1 + 2. **Medium-high.**
2. **Make the two proxy error lists exhaustive** — add `504` to the served `/api/proxy/instructions` Error Codes list (`routes/proxy.js`) and `502` to the guide's error table (`docs/proxy-integration.md`). Finding 3. **Medium.**
3. **Fix the stale corrective/advisory counts in `lib/periodicals.js`** — header says "seven … corrective" + "first 'advisory'"; registry is 9 corrective / 2 advisory. One-line correction. Finding 4. **Medium (cheap).**

Findings 5, 6, 7 are recorded but **not** promoted (below the bar this cycle); the next run can promote what still matters.

---

## Trend ledger

| finding | severity | delta (vs 2026-06-22 baseline) | evidence at HEAD `683d504` |
|---|---|---|---|
| `proxy-contract-behind-served-instructions` (F1) | high | **resolved** | `followUpTo`/`/autopilot/manual`/`kind` now in proxy guide |
| `dispatch-contract-target-and-terminal-markers` (F2) | high | **resolved** | `local` target + terminal markers (`dispatch-integration.md:196-213`) |
| `llms-txt-removed-template-and-stale-quota` (F3) | high | **resolved** | `code-review` gone, `review` at `llms.txt:197`, quota 20/day |
| `claude-md-source-tree-map-drift` (F4) | medium-high | **resolved (original) / re-drifted → new F2** | rename + provider + views mapped; new files now missing |
| `claude-md-missing-free-tier-env-vars` (F5) | medium | **resolved** | `CLAUDE.md:306-307`; same class recurs as GitHub → new F1 |
| `periodicals-stale-rationale-counts` (F6) | medium | **unchanged (open)** | `lib/periodicals.js:42-45` still 7/first; registry 9/2 |
| `proxy-504-undocumented-both-references` (F7) | medium | **improved, open → evolved (new F3)** | guide table added 504; now asymmetry — served omits 504, table omits 502 |
| `claude-md-components-undercount` (F8) | low (info) | **unchanged (open)** | `CLAUDE.md:140-141` lists 2 of 9 components |
| `readme-omits-view-tiers` (F9) | low | **unchanged (open)** | `README.md:21-28` flat Views list |
| `claude-md-github-auth-surface-undocumented` | medium-high | **new** | route + auth section + 6 env vars absent from CLAUDE.md |
| `claude-md-source-tree-map-redrift` | medium | **new** | Observation substrate + feedback widget + github-auth route unmapped |
| `proxy-error-code-asymmetry` | medium | **new (evolved from F7)** | served omits 504 (`proxy.js:739`), guide table omits 502 (`proxy.js:791`) |
| `direction-layer-proposal-stale-cli-transport` | low | **new** | `direction-layer-proposal.md:21` still "four transports / Linear CLI" post-LIN-580 |
| linear-cli-catalog (baseline clean row) | — | **N/A — file deleted (LIN-580)** | `lib/linear-cli.js` removed |
| auth-routes / proxy-scopes / dispatch-core / llms-dom-selectors / inline-rationale | — | clean | spot-rechecked, no regressions |

*Run at HEAD `683d504`. Next run: re-ground every row against HEAD. The three promoted follow-ups should resolve the two CLAUDE.md rows (github-auth + re-drift), the proxy error-code asymmetry, and the periodicals counts if landed.*
