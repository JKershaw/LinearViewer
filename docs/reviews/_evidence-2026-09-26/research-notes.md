# Research notes — LIN-3101 (eighth design/interface review, beats 1–2 of 5)

Stage: **research only.** These notes ground the later capture/render beats; they are not the report.

- **Branch:** `research/lin-3101-design-review-8` (tracking `origin/main`)
- **Grounding SHA (HEAD):** `6e8bf424cfdd887bfeda2173a3d31b12076d6ff9` — `Merge pull request #1588 from JKershaw/claude/gracious-wright-gnl4er` (2026-09-26 15:51 +0100)
- **Ticket:** LIN-3101 set to **In Progress** at start of beat.

---

## 1 · Commit window

- Prior review HEAD (08-29 report §front-matter + ticket §2): **`b78c4499`** = `LIN-2382: Onboarding & Cold-Start Review — 2026-08-29 baseline report (#1290)`, 2026-08-30 07:07 +0100.
- Window `b78c4499..origin/main`: **625 commits** (`git rev-list --count`), matching the ticket's "~625".
- Drift check: `git log --since="2026-09-26T19:03:54.365Z"` returns **0 commits** — nothing landed after the ticket was minted; the ticket's stated window is still byte-accurate at HEAD. No discrepancy between ticket prose and HEAD on the window or the surface names it lists.

### User-visible themes in the window (from `git log --first-parent b78c4499..origin/main`)

1. **Fix re-measures (all three merged in window):** `ccc3b2c5` LIN-2400 (merge-consent differentiation), `85aa9a54` LIN-2401 (error-page subject → real heading), `7704f3c2` LIN-2402 (`.chip.ev` wrap).
2. **Archive expansion:** `8e3c6ff2` Archive #5, `616b9846` Archive #6, `56020b07`/`574a2b61`… Archive #7 (retypeset ×5). `/archive/:n` is a digits-only `sendFile` with no allow-list, so each file is a new public page.
3. **Effort-readout:** `cf53c824` LIN-2641 (per-kind read-out), `c3cc8635` LIN-2830 (rows by harness/model/effort).
4. **Nav / footer rework:** `1aca1752` LIN-2519 (team selector → five filterable pages), `eb8361e9` LIN-2523 (teams brushed into four renderers), `12a9fdfe`/`12a9fdfe` LIN-2527/LIN-2528 (assignee selector), `d87d4525` LIN-2529, `0224e368` LIN-2298 (feedback trigger → nav chrome, fixed FAB deleted), `fd8387e2` LIN-2803 (add-source hints + "as new workspace" verb).
5. **Onboarding / consent churn:** `aaf30843` LIN-2820 (repo picker grant explanation, link, filter+pagination), `cd233879`/`95dc319e` LIN-2302 (Jira API-token consent copy), `bde75057` LIN-2497/2496 (OpenRouter consent differentiation), `2392a537` LIN-2412 (consent-gated OpenRouter key), `54116d21` LIN-2499 (CSRF nonce), `208ba06e`+`55851881` LIN-2397 (GitHub install-flow extraction — `routes/github-auth.js` −593, `routes/github-projects-auth.js` −530 toward shared `lib/github-install-flow.js`).
6. **Heavy client churn:** Flight Companion (900+ lines in `routes/flight-companion.js`, `public/observation.js` +2.7k), Task Chat → shared agent-turn core (`612350e5` LIN-2966), Scan-due tab (LIN-2667/2701/2706/2707), Dispatch (Workspace Halt section, LIN-3026), proxy halt (LIN-3025), `public/style.css` +268.

---

## 2 · Files/symbols referenced by the ticket — reconciliation at HEAD

| Ticket reference | Present at HEAD? | Reconciliation |
|---|---|---|
| `lib/render-effort-readout.js`, `public/effort-readout.css` | Yes (11914 B / 4169 B) | New surface, route at `routes/dashboard.js:2134`. Title `… - Effort Self-Assessment` (`lib/render-effort-readout.js:228`). |
| `lib/components/navbar.js` (+232), `footer.js` | Yes (28651 B / 13742 B) | navbar.js present; ticket's "+232" is the window delta, not the current size. |
| `routes/github-auth.js`, `routes/github-projects-auth.js` "heavily reworked" | Yes | Both now thin descriptors over shared `lib/github-install-flow.js` (LIN-2397). |
| `renderUpstreamAwareErrorPage` | `lib/render-pages.js:619` | Still hardcodes the D5 copy (see §4). |
| `renderErrorPage` | `lib/render-pages.js:580` | Subject emitted as `<h2 class="error-title">` (LIN-2401 applied). |
| `renderMergeConfirmPage` | `lib/render-pages.js:471` | Decline now `.login-button login-button-secondary` (LIN-2400 applied, `.login-button-secondary` at `public/style.css:2047`). |
| Hardcoded `'Linear'` fallbacks (§6) | Still present | `lib/render-roadmap.js:486`, `lib/render-swim.js:34`, `lib/render-ship.js:53` (was `:51` — 2-line drift), `lib/render-swipe.js:578`; plus `renderUpstreamAwareErrorPage` title/message. |
| Archive route "digits-only, no allow-list" | `server.js:1870` (was `:1705`) | `app.get('/archive/:n(\\d+)')` + `res.sendFile` from `docs/archive/` (`server.js:1871`). |
| `EXPERIMENTAL_VIEWS` registry | `lib/feature-defaults.js:166-176` | **9 members now** (added `ship-journey`); `lib/components/view-nav.js:15` docblock still says "the six" — stale comment (source-level, not rendered; out of remit). |

---

## 3 · Inherited claims — verification table

Each claim needs a fresh render to confirm (C) or overturn (O). "Verify on fresh render" = what the render beat must measure.

### A. Merged fixes — re-measure on fresh renders

| Claim | Surface | Prior measurement | What confirms/overturns it |
|---|---|---|---|
| **LIN-2400** — merge-consent differentiation | `renderMergeConfirmPage` via `/test/set-merge-conflict-session` | Both buttons were `rgb(13,148,136)` fill, identical, `<button class="login-button">` 13.33px, cursor default | C: decline now chromeless outline (`.login-button-secondary`), confirm filled; both sized deliberately (≥ body 16px, pointer cursor). O: pixel-identical controls survive. Source already shows `login-button-secondary` on decline (`lib/render-pages.js:476`). |
| **LIN-2401** — error subject as real heading | all `render-pages.js` surfaces (error/consent family) | `.error-title` was `<div>`, 0 `role=heading`, exactly 1 heading ("Harbour") | C: `h1..h6` count ≥2 and subject is a real heading on merge-confirm/reauth, error pages, workspace-not-found, provider pickers. O: subject still a `<div>`. Source shows `<h2 class="error-title">` at `:484/:505/:562/:592/:686`. **Scope caveat: D8 `/ship` is outside `render-pages.js`, so it must be tested separately.** |
| **LIN-2402** — archive `.chip` nowrap overflow | `/archive/1,2,4` at 390/360/320 | scrollWidth 531/390, 425/390 (`/archive/4`) | C: no document-level horizontal scroll at 390 on 1/2/4. O: `span.chip.ev` still nowrap and >viewport. Source fix `7704f3c2` changed `.chip.ev` to wrap. **Regression guard LIN-2491 still Backlog — cite, do not re-mint.** |

### B. Recorded-but-unminted (promote worst survivors)

| ID | Claim | Surface | Prior measurement | Verify on fresh render |
|---|---|---|---|---|
| **D5** | `renderUpstreamAwareErrorPage` "connection closed…" copy contradicts 5xx/429 diagnostic | `lib/render-pages.js:649-651` | prose fixed sentence vs diagnostic for `LINEAR_UPSTREAM_5XX` ("503 server error") and `LINEAR_RATE_LIMITED` ("rate-limited") | C: copy still the single hardcoded sentence at `:650` (source confirms — unchanged). Render all 5 branches (auth/5xx/429/net/internal) to confirm contradiction still on-screen. |
| **D6** | `<title>` brand drift | 14 cold + 23 auth pages | 7 conventions; `- Experimental`×8, `- Projects` survives, bare titles | Re-render and recount. Source reconciliation at HEAD: `- Harbour` on `/templates`,`/kpis`,`/privacy`,`/terms`,`/styleguide` + landing; `- Experimental`×8 hardcoded in 8 renderers; `- Projects` survives in `lib/render-pages.js` (merge confirm/reauth, generic error, workspace-not-found) **plus a new instance `Connect OpenRouter - Projects`** (`:558`) and `lib/render.js:226` (tree/dashboard). Bare: `Ship`, `Observation`, `New task`. One-offs: `Swipe - Tasks`, `Swim - Lanes`. |
| **D7** | `/archive/4` missing colophon | `docs/archive/{1..7}.html` | `/archive/4` `<footer`=0 | Source at HEAD: `<footer>` count 1/2/3 = **1**, 4 = **0**, 5 = **0**, 6 = **0**, 7 = **1**. So D7 now extends to **archive 5 and 6** too — three of seven lack a footer. |
| **D8** | `/workspace/:urlKey/ship` zero headings | `lib/render-ship.js` | 0×`h1..h6`, 0 `role=heading`; `<title>` bare `Ship` | Source: `lib/render-ship.js` has no `<h1..h6` and no `renderPageHeader` call (grep empty); `title:'Ship'` at `:101`. Structural confirmation in source; render beat must still measure DOM. **Same class as D2, outside LIN-2401's reach.** |
| **§3** | every `/archive/:n` has zero links back into the product | `docs/archive/*.html` | `a[href]`=0 on 1-4 | **Needs restating, not literal re-check.** Source at HEAD: 1-4 have 0 anchors **still**; 5 has 24, 6 has 10, 7 has 98 — but all are external citations (github.com blob links, arxiv, doi, etc.) and intra-doc `#fragment` anchors; **none point back into the product** (`/`, `/templates`, no nav). Refine claim to "no route back into the product", not "zero anchor elements". |
| **§6** | hardcoded `'Linear'` in error renderer + fallbacks | `lib/render-pages.js:648-651`, `render-roadmap.js:486`, `render-swim.js:34`, `render-ship.js:53`, `render-swipe.js:578` | 4 fallback sites + the error page | C: all five still present at HEAD (source reconfirmed). Strongest candidate for a follow-up slot. |
| **§6 coverage limit** | merge-consent only captured in **Linear** variant | `/test/set-merge-conflict-session` | hardcodes `provider:'linear'` | **Seam still Linear-only** (`routes/test.js` merge-conflict seam). GitHub / GitHub Projects / Jira confirm+reauth screens remain never-rendered. New in window: github/github-projects flows moved to `lib/github-install-flow.js`. |
| **§5 advisory** | KPI heading languages, Live Console zoom targets, `/kpis` colour-only, Collective dot no state colour; FAB-blue item "probably moot" | various | — | Re-judge the nav feedback trigger (LIN-2298 moved it into nav, FAB deleted). Collective dot still `var(--fg-dim)` unless changed (source: unchanged pattern). |

### C. Cite-only / never re-mint

LIN-739 (landing CTA contrast) · LIN-2221 / LIN-1018 (touch targets) · LIN-1856 / LIN-1979 (experimental-list drift) · **LIN-2491** (archive `.chip` regression guard) · LIN-849 · LIN-681 · LIN-868 · LIN-941 · LIN-1688 · LIN-1218 · LIN-949. These are cited in the report but never re-minted.

---

## 4 · Surface inventory — derived from code (not ticket prose)

### Reproducible commands + grounding

- `grep -nE "app\.get\('/" server.js` → top-level/workspace page GETs in `server.js`.
- `grep -rnE "router\.get\(|app\.get\(" routes/*.js | grep -vE "'/api|'/test|/api/|/test/"` → page GETs in route files.
- `ls docs/archive/` → `1.html 2.html 3.html 4.html 5.html 6.html 7.html` (7 files).
- `grep -n "EXPERIMENTAL_VIEWS" lib/feature-defaults.js` → registry at `:166`, 9 entries.
- `grep -oE '<footer' docs/archive/*.html`, `grep -oE '<a [^>]*href=' docs/archive/*.html` → footer/link census.
- `git rev-list --count b78c4499..origin/main` → 625.

### 4a · Page GETs that render an HTML page (the in-remit floor)

**40 rendered page-GET destinations.** Cold vs auth marked; seeded = needs a `/test/*` seam to reach a populated variant.

**Cold / unauthenticated (10):**

| # | Route | Location | Scope |
|---|---|---|---|
| 1 | `/` (landing) | `server.js:1766` | in — flagship cold surface |
| 2 | `/swipe/:identifier?` (landing preview) | `server.js:1793` | in |
| 3 | `/swim` (landing preview) | `server.js:1818` | in |
| 4 | `/ship` (landing preview) | `server.js:1837` | in |
| 5 | `/privacy` | `server.js:1855` | in |
| 6 | `/terms` | `server.js:1859` | in |
| 7 | `/archive/:n(\d+)` → 7 pages | `server.js:1870` | in — **5,6,7 newly public** |
| 8 | `/styleguide` | `server.js:1880` | in — the shipped baseline |
| 9 | `/templates` | `server.js:1887` | in |
| 10 | `/kpis` (public) | `server.js:1942` | in |

(`/health` `server.js:800` is a status endpoint, not a rendered page — **out of scope**; `/llms.txt`, `public/` assets are static, **out of scope**.)

**Authenticated / workspace-scoped (26):**

| # | Route | Location | Scope |
|---|---|---|---|
| 11 | `/workspace/:urlKey/` (tree) | `server.js:2655` | in |
| 12 | `/workspace/:urlKey/swipe/:identifier?` | `server.js:2730` | in |
| 13 | `/workspace/:urlKey/swim` | `server.js:2797` | in |
| 14 | `/workspace/:urlKey/ship` | `server.js:2846` | in — **D8 target** |
| 15 | `/workspace/:urlKey/roadmap` | `server.js:2920` | in |
| 16 | `/workspace/:urlKey/audit` | `server.js:3005` | in |
| 17 | `/workspace/:urlKey/settings` | `server.js:3072` | in — Scan-due tab + model picker churn |
| 18 | `/workspace/:urlKey/prompts` | `server.js:3202` | in |
| 19 | `/workspace/:urlKey/prompts/custom` | `server.js:3221` | in |
| 20 | `/workspace/:urlKey/dispatch` | `server.js:3249` | in — new Workspace Halt section |
| 21 | `/workspace/:urlKey/proxy` | `server.js:3301` | in |
| 22 | `/workspace/:urlKey/observation` | `routes/dashboard.js:1099` | in |
| 23 | `/workspace/:urlKey/observation/session/:sessionId` | `routes/dashboard.js:1142` | in |
| 24 | `/workspace/:urlKey/dashboard` | `routes/dashboard.js:1246` | in — assignee selector churn |
| 25 | `/workspace/:urlKey/escalation-kpis` | `routes/dashboard.js:2001` | in |
| 26 | `/workspace/:urlKey/effort-readout` | `routes/dashboard.js:2134` | in — **new in window** |
| 27 | `/workspace/:urlKey/flight-companion` | `routes/flight-companion.js:482` | in — heavy churn |
| 28 | `/workspace/:urlKey/live-console` | `routes/live-console.js:131` | in |
| 29 | `/workspace/:urlKey/next-run` | `routes/next-run.js:137` | in |
| 30 | `/workspace/:urlKey/passage-planner` | `routes/passage-planner.js:35` | in |
| 31 | `/workspace/:urlKey/ship-biscuit` | `routes/ship-biscuit.js:92` | in |
| 32 | `/workspace/:urlKey/ship-journey` | `routes/ship-journey.js:41` | in |
| 33 | `/workspace/:urlKey/task-chat` | `routes/task-chat.js:242` | in — agent-turn core refactor |
| 34 | `/workspace/:urlKey/task/new` | `routes/task-create.js:74` | in |
| 35 | `/workspace/:urlKey/task/:issueId/edit` | `routes/task-edit.js:75` | in |
| 36 | `/workspace/:urlKey/collective` | `routes/collective.js:94` | in — seeded (mock Yap `/test/yap`) |

**Pre-auth error / consent GETs that render a page (4 rendered destinations):**

| # | Route | Location | Scope |
|---|---|---|---|
| 37 | `/auth/jira` (no-workspace → 400 page) | `routes/jira-auth.js:209` | in |
| 38 | `/auth/openrouter` (consent interstitial) | `routes/openrouter-auth.js:61` | in — **big window churn** (LIN-2412/2497/2496) |
| 39 | `/auth/github/callback` (repo picker) | `lib/github-install-flow.js:269` (via `routes/github-auth.js` basePath) | in — picker rework LIN-2820 |
| 40 | `/auth/github-projects/callback` (projects picker) | `routes/github-projects-auth.js` basePath | in |

**Redirect-only GETs, not rendered pages (out of the "rendered page" count, noted for completeness):** `/auth/linear` (`routes/auth.js:54`), `/auth/callback` (`:106`), `/logout` (`:445`), `/auth/jira/oauth` (`jira-auth.js:324`), `/auth/jira/oauth/callback` (`:375`), `/auth/github` + `/auth/github-projects` (redirect to GitHub), legacy `/audit` `/settings` `/prompts` (`routes/legacy-redirects.js`). Crucial nuance: **the callbacks (linear/github/github-projects/jira OAuth) render `renderErrorPage` / `renderMergeConfirmPage` / `renderMergeReauthRequiredPage` / account-conflict on their failure paths** — those error/consent surfaces are reachable only through callback+seam, not a plain page GET. They are in remit (prior runs rendered them via `/test/set-merge-conflict-session` and interception).

**Beat-2 correction — `GET /auth/openrouter/callback` (`routes/openrouter-auth.js:122`) is a hybrid, not a pure redirect.** It requires a signed-in workspace and redirects `/` when none is active (`:124-127`); on the success path it exchanges the code, persists the key, and `302`-redirects to `/workspace/:urlKey/settings` (never renders). On every failure path it **renders a full page** — `renderErrorPage` with `400` for: no `code` ("Authorization Failed"), no `codeVerifier` ("Session Expired"), a non-OK exchange ("Authentication Failed"), a missing key ("Authentication Failed" / "Invalid response…"), plus `500` "Something Went Wrong" in the catch. So it belongs in the same callback class as the other OAuth callbacks (redirect-on-success, error-page-on-failure), in remit for its error-family renders. Note the error `actionUrl` here is always `/auth/openrouter` (the consent interstitial), never `/logout` — unlike `renderUpstreamAwareErrorPage`'s auth branch.

### 4b · Experimental-view registry (9 members)

`lib/feature-defaults.js:166-176` — `collective, task-chat, ship, next-run, flight-companion, passage-planner, ship-biscuit, live-console, ship-journey`. All nine map to workspace routes in §4a (flagged views reachable via `/test/set-session?features=`). `- Experimental` title suffix is hardcoded in 8 of 9 renderers (`ship` is bare).

### 4c · Archive listing

`docs/archive/` = 7 HTML files (1–7). 5, 6, 7 are new public pages (digits-only `sendFile`, no allow-list).

### 4d · In-remit but NOT named in the ticket (flag)

1. **`/auth/openrouter` consent interstitial** — the ticket's §2 names "OpenRouter consent choices (LIN-2497/2496)" but not the page itself as a render target; it is the only wholly-new *pre-auth* renderable surface in the window and the only genuine third/fourth consent interstitial. Prior runs never rendered it.
2. **`/archive/5` and `/archive/6` are also colophon-less** — the ticket names "archive 5–7" for overflow/exits but the D7 (colophon) claim was only ever about `/archive/4`; 5 and 6 extend it.
3. **Scan-due tab (Settings)** — LIN-2667/2701/2706/2707 landed a fourth Settings tab; it is a new rendered surface within `/settings` (no standalone route).
4. **Dispatch "Workspace Halt" section** (LIN-3026) and proxy-halt affordances — new sections on existing pages, not named by the ticket.
5. **`/workspace/:urlKey/effort-readout`** is named (good), but its JSON sibling `/workspace/:urlKey/api/effort-readout` is API — out of scope.

### 4e · Counts

| Metric | Count |
|---|---|
| Total page-GET destinations rendering HTML | **40** |
| Cold / unauthenticated | 10 |
| Authenticated / workspace-scoped | 26 |
| Pre-auth error/consent render destinations | 4 |
| Experimental views | 9 |
| Archive pages | 7 (3 new) |
| Newly-discovered-but-unlisted surfaces | 5 (OpenRouter consent page, archive-5/6 colophon extension, Scan-due tab, Dispatch halt, proxy-halt) |

---

## 5 · Classes and bounds

### Surfaces
As enumerated in §4a–4c (40 page GETs + 9 experimental + 7 archive + pre-auth family). Plus the **seam-rendered error/consent family** (merge confirm, merge reauth, 4 merge-error outcomes, account conflict, 3 provider pickers, workspace-not-found, 5 `renderUpstreamAwareErrorPage` variants).

### Themes
`light` (default, no class) · `dark` (real cookie → `documentElement.className === 'theme-dark'`). Landing dark is `@media (prefers-color-scheme:dark)` via `colorScheme:'dark'` (no toggle).

### Viewports
1400 (desktop) · 390 (mobile) · 360 · 320 where geometry uncertain (archive documents, chips, swim lanes, live-console controls).

### Auth modes
`cold` (unauthenticated, fresh context; `/` redirects away under auth) · `authenticated` (via `/test/set-session` + `?features=`) · `seeded` (`/test/set-local-session`, `/test/set-github-session`, `/test/set-github-projects-session`, `/test/seed-*`, `/test/set-merge-conflict-session`, mock Yap `/test/yap`).

### Error-page variants
`renderErrorPage` (generic) · `renderUpstreamAwareErrorPage` five branches — `auth` (401/403), `upstream`/5xx, `upstream`/429, `upstream`/ECONNRESET, `internal` — classified by `classifyUpstreamError` (`lib/errors.js:198`) on `error.status`/`error.code`. All renderable via synthetic errors through the production renderer.

### Onboarding / consent provider variants
`Linear` (only variant with a capture seam) · `GitHub` (repo picker) · `GitHub Projects` (projects picker) · `Jira` (API-token consent + OAuth). **Coverage limit: non-Linear merge/consent screens remain un-rendered by any prior run.**

### Named re-measure targets
LIN-2400 (merge consent) · LIN-2401 (error headings) · LIN-2402 (archive chip wrap, guard LIN-2491) · D5/D6/D7/D8/§3/§6 survivors.

---

## 6 · Evidence method

### 6a · Seams (from code, with citations)

| Seam | Location | What it does |
|---|---|---|
| Visual-capture maker config | `playwright.visual.config.js` | `testDir './tests/visual'`, `baseURL http://localhost:3001`, boots a `NODE_ENV=test` server with `LINEAR_ACCESS_TOKEN=` cleared so `/` renders the cold landing (`.config` `webServer.command`). Makers do not assert; they write PNGs to `tests/screenshots/`. |
| Session seed (Linear test-token) | `routes/test.js:131` `GET /test/set-session` | Establishes a mock Linear workspace `test-workspace` (`accessToken:'test-token'`, real `accountId` via `establishAccount`); `?features=<JSON>` sets per-user flags (whitelist-validated), `?urlKey=` scopes the key. |
| Merge-conflict seed | `routes/test.js:306` `GET /test/set-merge-conflict-session` | Builds the account-merge acceptance scenario through `establishAccount` + real `respondToAccountConflict`; hardcodes `provider:'linear'`. |
| Local / GitHub / GH-Projects seeds | `routes/test.js:1236/1350/1441` `set-local-session` / `set-github-session` / `set-github-projects-session` | Provider-beyond-Linear session fixtures. |
| Mock Yap backend | `routes/test.js:59-91` `/test/yap/*` | In-process Collective backend; `YAP_BASE_URL=http://localhost:3100/test/yap` enables a populated `/collective` with zero egress. |
| Scope gate on test routes | `server.js:847` | `createTestRoutes` mounted only under `NODE_ENV === 'test'` (visual config sets it). |
| Theme cookie | `lib/user-preferences.js:415` `setThemeCookie` → `res.cookie('theme', theme)`; read pre-paint in `lib/components/page.js:29` `THEME_PREPAINT_SCRIPT` (adds `theme-dark` to `<html>` when cookie value is `dark`). Non-httpOnly, `path:'/'`. | The one seam making dark global; driven by `POST /workspace/:urlKey/settings/theme`. |
| Server boot for capture | see `playwright.visual.config.js` `webServer.command` | `NODE_ENV=test PORT=… SESSION_SECRET=… LINEAR_ACCESS_TOKEN= OPENROUTER_API_KEY= OPENROUTER_FREE_TIER_KEY= FREE_TIER_DAILY_LIMIT=5 node server.js`. |

The 2026-08-29 run's method (its §1 + evidence dir) is the convention template: a keyless `NODE_ENV=test` server on an isolated port, cold `sendFile`/public pages rendered with no session, authenticated pages through `/test/set-session`, error-family pages through the production renderer at a real origin, both themes at 1400×1000 and 390×844 with 360/320 sweeps, each PNG matched by a JSON of computed values. Its evidence set was **60 artifacts (48 PNG + 12 JSON)**. This run reuses that shape (`docs/reviews/_evidence-2026-09-26/`, `capture/` holds the tool).

### 6b · Capture script

- Path: `docs/reviews/_evidence-2026-09-26/capture/capture.mjs` (research tool, not a committed maker; never wired into `npm test`/CI).
- Invocation (server must be up; browsers are at `/Users/work/Library/Caches/ms-playwright`):
  ```
  PLAYWRIGHT_BROWSERS_PATH=/Users/work/Library/Caches/ms-playwright BASE_URL=http://localhost:3199 \
    node docs/reviews/_evidence-2026-09-26/capture/capture.mjs [<surface-key> ...]
  ```
  No args → pilot set (`styleguide archive-7 effort-readout`). Surface registry is a plain object (`SURFACES`) keyed by `key` with `{kind:'cold'|'auth', path, seed?, viewports?, settleMs?}` — beat 3 expands this list.
- Guarantees: fresh browser context per cold surface; dark only via the real `theme` cookie and `document.documentElement.className === 'theme-dark'` asserted before shooting (failure → recorded `theme-assertion`, never silently kept); desktop 1400 + mobile 390 default, 360/320 opt-in per surface; one JSON written next to each PNG.

### 6c · Metric validation (validate-metrics.mjs)

Validation script: `docs/reviews/_evidence-2026-09-26/capture/validate-metrics.mjs`.

| Check | Result |
|---|---|
| A — overflow detector flags a real unclipped overflow (500px div in a 300px viewport) | **PASS** — `scrollWidth 500 > clientWidth 300`, offender `wide-unclipped` |
| B — same detector does NOT flag an element clipped by an `overflow-x:auto` ancestor | **PASS** — `wide-clipped` excluded |
| C — heading census agrees DOM vs accessibility tree on `/styleguide` | **PASS** — DOM `{h1:3,h2:3,h3:20}=26`, a11y (getByRole level 1–6) also 26 |

### 6d · Limitations (named, not tuned around)

- `page.accessibility.snapshot()` is **gone in Playwright 1.57**; the a11y-tree heading read uses `getByRole('heading', { level })`, which resolves the true ARIA role (implicit h1–h6 included). The raw DOM `[role="heading"]` count is also recorded but is near-0 on every surface because these pages use semantic tags, not explicit `role` attributes — do not read it as "no headings".
- **Contrast / clipping-without-overflow are not captured by this script.** The overflow metric only sees element geometry past the right edge; it cannot see text clipped by `overflow:hidden` at a fixed width, and contrast needs a separate color pass (Lighthouse / computed-color probe, beat 3). Recorded here, not silently papered over.
- **Archive pages use a different dark mechanism.** `docs/archive/*.html` are standalone documents with zero shared shell; 5/6/7 have no `theme-dark` handling at all and rely on their own `@media (prefers-color-scheme: dark)` / `:root[data-theme]` (`archive/7.html:35-42`). The cookie→`theme-dark` contract therefore does not apply; a "dark" archive capture fails the theme assertion **correctly**. Beat 3 must capture archive dark via `colorScheme:'dark'` (media emulation), explicitly labelled as non-cookie, not via the theme cookie.
- **Pilot verification was programmatic, not visual.** This session's model has no image input, so the "glance at the PNGs" confirmation was done by asserting status 200 + real rendered content (title, heading census, nav/footer, product links, and for effort-readout a curl'd text-body containing "Effort Self-Assessment / Per-kind effort × cost × duration…"), rather than by viewing the images. PNG evidence exists in three `captureMode`s — `viewport`, `fullPage`, and `pageEnd` — per `capture/manifest.json`; the beat-4 corrective added `fullPage` (ship/error/operator read-outs) and `pageEnd` (archives: final-viewport capture of the page end incl. footer/colophon) so the below-the-fold claims (D7, §3) have visual backing, not just JSON.

### 6e · Pilot outcomes

| Page | Theme | Viewport | Status | Overflow | Headings (DOM/aria) | Dark assertion |
|---|---|---|---|---|---|---|
| `/styleguide` | light | 1400 / 390 | 200 | none (1385/1400, 375/390) | 26 / 26 | n/a (light) |
| `/styleguide` | dark | 1400 / 390 | 200 | none | 26 / 26 | **passed** (`theme-dark`) |
| `/archive/7` | light | 1400 / 390 | 200 | none (1400/1400, 390/390) | 26 / 26 | n/a (light) |
| `/archive/7` | dark | 1400 / 390 | 200 | — | — | **failed** (expected — standalone doc, no cookie contract) |
| `/workspace/test-workspace/effort-readout` | light | 1400 / 390 | 200 | none | **1 / 1** | n/a (light) |
| `/workspace/test-workspace/effort-readout` | dark | 1400 / 390 | 200 | none | 1 / 1 | **passed** (`theme-dark`) |

Real-content confirmation: `/styleguide` title "Style Guide - Harbour"; `/archive/7` title "Learning While the Tools Change · Harbour Archive #7" (a one-off title convention — another D6 instance) with 26 headings, a `<footer>`, and 2 archive→archive cross-links (`/archive/2`, `/archive/5`) but **zero links into the product**; effort-readout renders the seeded workspace ("Test Workspace - Effort Self-Assessment", "Live queue: 0 rows … History: showing 26 of 26", "The effort column is empty by design…").

### 6f · Blockers for the full-scope capture (next beat)

None found. Two non-blocking items to carry: (1) archive 5/6/7 dark is media-emulation, not cookie; (2) contrast/clipping needs a separate color probe pass the current script intentionally does not do.
---

## 7 · Coverage limits

Full-scope results, the re-measure verdict table, title census, contrast highlights, nav/footer census, and current-window observations live in **`measurements-summary.md`** (backing data in `capture/manifest.json` + `capture/analysis.json`). Every limit below is named, not faked — I record what was *not* renderable and what evidence would close it.

1. **Non-Linear merge-consent / reauth variants — not rendered.** The only capture seam, `/test/set-merge-conflict-session` (`routes/test.js:306`), hardcodes `identityLabel:'Linear'`, `reauthUrl:'/auth/linear'`, `provider:'linear'`. GitHub (`renderGitHubRepoSelectPage` is the picker, not the merge), GitHub Projects, and Jira confirm+reauth screens were never produced. *To resolve:* a provider-parameterised merge seam (or rendering `renderMergeConfirmPage`/`renderMergeReauthRequiredPage` directly with those labels — which I did do for the *Linear* copy, but the non-Linear consent copies remain unrendered).

2. **Unresolved-provider "Linear" fallbacks — source-only.** `render-roadmap.js:486`, `render-swim.js:34`, `render-ship.js:53`, `render-swipe.js:578` fall back to `'Linear'` only when `provider.ui.displayName` is falsy. Every seed (linear/local/github/github-projects/jira) resolves a display name, so the fallback branch is unreachable; verified it does **not** render "Linear" on the non-Linear trees ("Local Workspace - Projects", etc.). *To resolve:* an injected a provider whose `ui.displayName` is absent.

3. **Upstream outages rendered via synthetic errors.** `renderUpstreamAwareErrorPage` (and its five `classifyUpstreamError` branches) was rendered by calling the production renderer with synthetic `{status:401/429/503}`, `{code:'ECONNRESET'}`, `Error('boom')` objects, then served through request interception against the real origin — not from a live provider outage. *To resolve:* a real provider outage, or a seam that forces the tree/swipe/swim/ship/roadmap route's fetch to throw a classified error.

4. **Archive dark is media-emulated.** `docs/archive/*.html` are standalone documents with no theme-cookie contract; their dark (where it exists — archives 1–4 have no `prefers-color-scheme` rules at all, so "dark" there is visually identical to light) is driven by `prefers-color-scheme`/`[data-theme]` in the documents' own CSS. Captured with `colorScheme:'dark'` and labelled `darkMode:'media'`, distinct from the cookie-driven `theme-dark` used on every app shell page.

5. **Contrast heuristic mis-resolutions.** The effective-background walk resolves a transparent ancestor's background; on the styleguide's `.chip` and a few bordered containers it reported nonsense (e.g. a chip at 1.21:1 against black). Those specific rows are unreliable; the stable rows (body 17.4, muted 5.74, landing CTA 4.43, `.login-button` white-on-teal 3.74) were re-derived and are trustworthy. *To resolve:* a proper colour/position probe per element, or LH/Lighthouse's exact-contrast audit.

6. **Sparse seeded data on operator surfaces.** `effort-readout` renders the empty/zero state ("Live queue: 0 rows … effort column is empty by design"); `escalation-kpis` renders against test-token data; `collective` renders against the in-process mock Yap. No capture shows a *populated* effort read-out, a dense escalation-KPI board, or a busy Collective feed. *To resolve:* richer `/test/seed-*` fixtures for those stores.

7. **No screenshot in this research stage was inspected visually by an image-capable reader.** Every judgment here is a *measurement* (overflow, heading/role census, contrast, footer/colophon, links, fonts, nav census). Visual hierarchy, spacing, alignment, and any visual regression that does not manifest as overflow or a contrast/heading number is **unverified**. The report stage needs an image-capable reader to actually view the 110 kept PNGs.

8. **`task/:issueId/edit` renders 500 under the test seam only.** This is a harness artifact, not a product defect: the test-token seed cannot satisfy a real Linear GraphQL call (`Authentication required, not authenticated`, 401), so the catch-all renders `Something Went Wrong`. With a real session a missing id hits the `isValidIssueId` 400 or the `not found` 404 path (`routes/task-edit.js:93,146`). The 500 was **withdrawn** from `measurements-summary.md` as an observation; the sibling `observation/session/:id` 404 and swipe bad-identifier empty state were confirmed clean.

---

## 8 · Beat-5 reconciliations against the visible page end

The autopilot viewed `archive-4-light-390px.pe.png` (a page-end capture) and its final block is a monospace sign-off — *"THE HARBOUR ARCHIVE · THE AUGUST WING · compiled by the flight companion for John Kershaw · sources: JKershaw/LinearViewer · JKershaw/simple-dispatcher · harbour.cat"* — which visibly reads as a colophon and contradicted two inherited verdicts. Both were re-checked **by element and by visible text**, not `<footer>` presence.

### D7 — overturned-as-framed; retained only as a landmark note

- The **2026-08-29 report's D7** already mixed two claims: its *evidence* was "`/archive/4` has **no `<footer>` element at all**" (a landmark claim), but its *title* was "ships **without the colophon** its three siblings all carry". The landmark claim is correct; the "without the colophon" framing is not.
- **Element-level truth:** `docs/archive/{1,2,3,7}.html` wrap their provenance block in a `<footer>`; `docs/archive/{4,5,6}.html` do **not** (0 `<footer>`). That is a real, defensible structural note.
- **Visible-text truth:** every archive 1–7 carries a provenance/traceability sign-off. 1/2 end *"THE HARBOUR ARCHIVE · compiled by Claude for John Kershaw · sources: … · harbour.cat"* (inside `<footer>`, plus a "Colophon & provenance / Compiled 27 July 2026…" block); 3 ends *"Prepared by Claude on 3 August 2026 from a read-write workspace token…"* (in `<footer>`); **4 ends the very line in §0 above** (monospace, **outside** any `<footer>`); 5/6 end *"Harbour Archive · document N · filed … · served verbatim from docs/archive/N.html"* (bare, no `<footer>`); 7 ends *"Harbour Archive · document 7 · filed 2026-09-22 · served verbatim…"* with its `<footer>` containing *"About this document … Version Version 5 … Current version · The papers archive…"*.
- **My beat-3/4 "archive 7's footer has no colophon text"** was a regex artifact (`footerHasColophon` matched only the literal words `colophon`/`provenance`): archive 7's footer carries provenance prose under different words ("About this document", "Version", "Filed…"). That claim is withdrawn.
- **Restated D7: partially holds.** Holds = "archives 4/5/6 do not wrap their provenance block in a `<footer>` landmark" (a11y/semantics nicety, `archive-{4,5,6}-light-1400px.pe.json`: `footerCount 0`). Overturned = "archives 4/5/6 are missing a colophon" (they each end with a provenance sign-off) and "archive 7's footer has no colophon text". *Evidence: `archive-{1..7}-light-390px.pe.png`/`.json`, `capture/manifest.json`, and the source `docs/archive/*.html`.*

### §3 — holds for the app, refined for the product origin

- **Metric bug:** the beat-3 `linksIntoProduct` metric counted only `/`, `/workspace/…` and app-nav routes, so absolute URLs to the product's own origin were invisible. Fixed in `capture/links-reconciliation.json` (per-archive anchor buckets: `appHome`, `appWorkspaceOrNav`, `canonicalProductOrigin`, `archiveCross`, `external`, `fragment`).
- **Corrected numbers:** all seven archives have **0** `appHome` and **0** `appWorkspaceOrNav` links — the "no route back into the *app*" claim **holds on every archive**. But "zero links" in the literal sense was wrong: archives 1–4 have 0 anchors of any kind; **archive 5** has 24 (`/archive/4` "Harbour Archive #4, the August Wing" + 23 external citations); **archive 6** has 10 in-page `#` fragments; **archive 7** has 98 (`/archive/2`, `/archive/5`, **`https://harbour.cat/archive/5`** — the canonical product origin — plus 54 external + 41 fragments).
- **Restated §3:** every archive still offers **no link into the app** (home `/`, `/workspace/*`, nav) — the first-experience finding is unchanged and true. But archives 5 and 7 *do* interlink to sibling installments, and 7's use the canonical product origin — those are archive→archive cross-references, not a route into the cockpit. The trailing sign-offs also mention `harbour.cat` as **plain text** (not an anchor) in 1/2/4. *Evidence: `capture/links-reconciliation.json`, `archive-{5,7}-*.json`/`*.pe.png`, source `docs/archive/*.html`.*
