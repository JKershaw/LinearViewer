# Design & Interface Review — 2026-08-29

**Periodical run (seventh).** Origin LIN-520 · task LIN-2381 · prior runs LIN-565 · LIN-568 · LIN-671 · LIN-736 · LIN-942 · LIN-1924.

| | |
|---|---|
| **Repo HEAD** | `b78c4499` (LIN-2382) |
| **Window** | `0e8a1461..b78c4499` — **81 commits** (the ticket's "roughly 35" understates by ~2.3×) |
| **Method** | Fresh renders + programmatic measurement against a live server on `:3199`. No screenshot diffing — `_evidence-2026-08-23/` was never recovered, so every Tier-B claim is re-measured, not inherited. |
| **Renders** | ~78 captures over **32 distinct surfaces**, both themes, 1400×1000 and 390×844 (plus 360 and 320 sweeps where geometry was in question) |
| **Evidence** | `docs/reviews/_evidence-2026-08-29/` — 42 artifacts (PNGs + the raw measurement JSON behind every number below) |
| **Result** | **7 findings** (5 objective breakage, 2 copy/consistency). **3 follow-ups minted** (§7). Two inherited "no finding" claims **overturned with numbers** (§9). |

> **Review-only.** No product code, stylesheet, config or doc under review was modified. The report file and its evidence PNGs are the sole artifacts committed.

---

## 1. Scope and method

### What was rendered

**Cold / session-free** (a fresh browser context per surface — an authenticated session redirects `/` away from the landing, which is how a cold capture silently becomes an authenticated one): `/`, `/templates`, **`/archive/1`, `/archive/2`, `/archive/3`, `/archive/4`**, `/privacy`, `/terms`, `/styleguide`, public `/kpis`, `/swipe`, `/swim` (landing variant), `/ship` (landing variant), `/auth/jira` no-workspace.

**Tier A — never design-reviewed:** the account-merge consent flow (`renderMergeConfirmPage` live via `/test/set-merge-conflict-session`, plus `renderMergeReauthRequiredPage` and all four `renderErrorPage` outcomes), the three provider pickers, `renderWorkspaceNotFoundPage`, and — **added by the v3 plan amendment** — **`renderUpstreamAwareErrorPage`** in all five of its classified variants.

**Tier B — re-measured, not inherited:** LIN-2251 (escalation-KPI window select), LIN-2252 → LIN-2272 (feedback-FAB overlap), LIN-2247 (dark-token parity).

### Two method notes that changed the result

**The archive is four documents wide, not three.** `server.js:1705` registers `app.get('/archive/:n(\d+)')` — a digits-only `sendFile` from `docs/archive/` with **no allow-list**, so a fourth file became a fourth public surface the moment it landed. `docs/archive/4.html` landed in `784cf1c2` (#1217, 2026-08-23), inside this window, and had never been rendered by any design review. The list was derived from `ls docs/archive/`, not from the ticket's own `{1,2,3}` prose — which was already stale when written. **It produced a finding (§2 D4).**

**Error-family surfaces were captured through the production renderer at a real origin.** `renderErrorPage` and its callers are pure functions; each variant was rendered and served via request interception at `http://localhost:3199/…` so `/style.css` resolved and computed styles are the real ones. This is how the four merge error outcomes and all five `renderUpstreamAwareErrorPage` branches were captured without needing a real provider outage — see §6, where it **overturns the plan's own precautionary "may be unrenderable" note**.

---

## 2. Findings — severity ranked

### D1 · The account-merge consent screen gives an irreversible action the same visual rank as its safe opposite
**Objective · Tier A · never reviewed · highest stakes in the app**

`renderMergeConfirmPage` (`lib/render-pages.js:332`) is the consent screen for an **irreversible identity merge**, reached mid-login. Both buttons are `class="login-button"` (`:334`, `:337`). Measured live, fresh render, both themes:

| | "Yes, merge these accounts" | "No, keep them separate" |
|---|---|---|
| background (light) | `rgb(13, 148, 136)` | `rgb(13, 148, 136)` |
| color (light) | `rgb(255, 255, 255)` | `rgb(255, 255, 255)` |
| background (dark) | `rgb(45, 212, 191)` | `rgb(45, 212, 191)` |
| color (dark) | `rgb(22, 24, 29)` | `rgb(22, 24, 29)` |
| border | `rgb(13, 148, 136)` | `rgb(13, 148, 136)` |
| padding / height | `12px 24px` / **42px** | `12px 24px` / **42px** |
| font-size / weight | **13.3333px** / 400 | **13.3333px** / 400 |
| cursor | **`default`** | **`default`** |

Every visual property is identical in both themes; only the pixel width differs, and only because the labels differ in length (221px vs 201px). **Nothing in the rendering distinguishes the destructive choice from the safe one.**

This is drift from the codebase's own system, which already ships the differentiated-secondary pattern *and documents why*: `.login-button-github` is "differentiated from the primary brand action: a chromeless outline … so the two never look alike" (`public/style.css:2046-2051`).

**Compounding, same surface:** the page has **no footer** and **no `.error-home-link`** — the only two exits are the two buttons. Its own sibling, `renderMergeReauthRequiredPage`, *does* render a home link (`lib/render-pages.js:376`). The two halves of one flow disagree about whether a user may leave.

*Evidence:* `merge-confirm-{light,dark}-{desktop,mobile}.png`, `merge-measurements.json`.

---

### D2 · Every error and consent page renders its subject as a `<div>`, not a heading
**Objective · accessibility · 11 surfaces, 110 call sites**

`renderErrorPage` (`lib/render-pages.js:396`) emits the page's actual subject as `<div class="error-title">`. Measured across all 11 surfaces in the family — merge confirm, merge reauth, the four merge error outcomes, Account Conflict, the three provider pickers, workspace-not-found:

* `.error-title` / `.login-title` tag: **`DIV`** on all 11 — 20px, weight 500
* elements with `role="heading"`: **0** on all 11
* total headings on the page: **exactly 1** on all 11 — and it is the chrome word **"Harbour"**, not the error

So a screen-reader user navigating by heading on the account-merge consent screen lands on "Harbour" and **never reaches "Merge these accounts?"**. The page's only `<h1>` describes the application, not the decision being asked for.

The `<div class="error-title">` pattern is hardcoded at **8 separate sites** inside `lib/render-pages.js` alone (`:162`, `:221`, `:270`, `:314`, `:345`, `:366`, `:396`, `:490`), so it is a convention of the file, not a single renderer's slip.

Blast radius: **110 `renderErrorPage` call sites across 20 files** (`routes/account-merge.js`, `routes/auth.js`, `routes/github-auth.js`, `routes/jira-auth.js`, `server.js`, `lib/account-conflict.js`, and 14 more). One renderer fix covers all of them.

*Evidence:* `sweep-measurements.json` (the 11-row table), `sweep-*-light.png`.

---

### D3 · `.login-button` on a `<button>` falls to the UA default 13.33px and loses its pointer cursor
**Objective · consent screen + all three provider pickers**

`.login-button` (`public/style.css:2029-2039`) sets `font-family` but **no `font-size`**, and `public/style.css` carries no `button { font: inherit }` reset. The same class therefore renders two different ways depending on the element it lands on. Measured:

| element | surfaces | font-size | cursor |
|---|---|---|---|
| `<a class="login-button">` | 6 error-family pages | **16px** | `pointer` |
| `<button class="login-button">` | **merge confirm + decline**, GitHub repo picker, GitHub Projects picker, Jira site picker | **13.3333px** | **`default`** |

13.3333px is the user-agent's default `<button>` size — the app never chose it. Page body measures 16px on desktop. So the two highest-consequence buttons in the product are **2.67px smaller than the app's own body text** and give **no pointer affordance**.

This is structurally the same defect class as LIN-2251 (a form control that never got sized) — that one was on a `<select>`, this one is on `<button>`.

*Evidence:* `sweep-measurements.json`, `merge-measurements.json`, `sweep-github-{repo,projects}-light.png`, `sweep-jira-sites-light.png`.

---

### D4 · `.chip { white-space: nowrap }` forces real horizontal page scroll on three of the four archive documents
**Objective · mobile · overturns an inherited "no finding"**

Document-level horizontal overflow, measured with unclipped-offender analysis (an element only counts if **no** ancestor has `overflow-x: auto|scroll|hidden|clip`) and confirmed by actually scrolling the page:

| surface | 390px | 360px | 320px | real `scrollX` reachable @390 |
|---|---|---|---|---|
| `/archive/1` | **531 / 390** | 531 / 360 | 531 / 320 | **141px** |
| `/archive/2` | **531 / 390** | 531 / 360 | 531 / 320 | **141px** |
| `/archive/3` | 390 / 390 ✓ | 360 / 360 ✓ | 320 / 320 ✓ | 0 |
| **`/archive/4`** | **425 / 390** | 425 / 360 | 425 / 320 | **35px** (105px @320) |

**The tables are not the cause** — they are correctly wrapped in `overflow-x: auto` and clip properly. The unclipped culprit is `span.chip.ev`, which inherits `white-space: nowrap` from the base `.chip` rule (`display: inline-block; … white-space: nowrap`). That is right for a short label chip, but the `.ev` variant carries multi-token content that far exceeds a phone viewport — e.g. `"docs/drift-at-every-altitude.md · recommender-fail…"` at **477px wide**, and on `/archive/4` `"/kpis · terminalMarkedTaskCost · weeklyBudget…"` at **371px**. A nowrap inline-block wider than the viewport, with nothing to clip it, pushes the document.

`/archive/3` is clean because it is a different document that uses no chips.

**This overturns the 2026-08-23 report**, which rendered `/archive/2` and concluded: *"`/archive/2` renders legibly at 1400px and 390px with its own self-contained styling. This is the design, not drift. **No finding.**"* — and closed the item as "closed, no finding". At 390px `/archive/2` has 141px of genuine horizontal scroll. See §9.

*Evidence:* `cold-archive-{1,2,3,4}-mobile.png`, `cold-measurements.json`.

---

### D5 · The `upstream` error branch asserts a specific cause that is false for two of its three triggers
**Objective · copy correctness · newly-scoped surface**

`renderUpstreamAwareErrorPage` (`lib/render-pages.js:423`) collapses three distinct classifications into **one hardcoded sentence**:

> "We couldn't reach Linear's API just now — **the connection closed before it responded.** This is usually temporary; try again in a moment."

That sentence is only true for `LINEAR_UNREACHABLE`. Rendered side by side with the diagnostic block the same renderer puts directly beneath it:

| trigger | classified code | the prose says | the diagnostic says |
|---|---|---|---|
| HTTP 503 | `LINEAR_UPSTREAM_5XX` | the connection closed before it responded | **"Linear returned a 503 server error."** |
| HTTP 429 | `LINEAR_RATE_LIMITED` | the connection closed before it responded | **"Linear rate-limited the request; it should recover shortly."** |
| `ECONNRESET` | `LINEAR_UNREACHABLE` | the connection closed before it responded | "The connection to Linear closed before a response arrived." ✓ |

On two of three paths the page **contradicts itself on the same screen** — the prose names a mechanism the diagnostic immediately refutes. The classifier is doing its job correctly; only the copy is over-specific.

*Evidence:* `upstream-upstream-{5xx,429,net}-light-desktop.png`, `upstream-measurements.json`.

---

### D6 · Page-title brand drift: three different suffix conventions, split along a revealing line
**Objective · copy consistency**

The `<title>` a user sees in their browser tab and bookmarks follows **three** conventions:

| suffix | count | surfaces |
|---|---|---|
| `- Harbour` (current brand) | 5 | `/kpis`, `/privacy`, `/terms`, `/styleguide`, `/templates` — i.e. **the public, indexable, cold-visitor surfaces** |
| `- Projects` (pre-rename) | 8 sites | every `lib/render-pages.js` surface — login, both GitHub pickers, **merge confirm**, **merge reauth**, **every error page**, workspace-not-found — **plus `lib/render.js:220`, the authenticated workspace shell** |
| *(none)* | 1 | `renderJiraSiteSelectPage` → `"Choose a Jira site"` |

The split is almost exactly "marketing surfaces were rebranded; the product was not". The entire authenticated application, and the consent screen for an irreversible identity merge, still identify as **"Projects"** — a name the product no longer uses anywhere in its own UI (`renderPageHeader` renders "Harbour" on these same pages, so title and header disagree on one screen).

**Not already tracked.** LIN-1687 ("Rename GitHub repo and Linear workspace to Harbour") is untriaged raw feedback about the *repo and Linear workspace* names, not the `<title>` tag. LIN-975 ("Uniform page titles", **Done**) threaded `renderPageHeader` through non-conforming renderers — it is about the in-page `<h1>`, not the document title.

*Evidence:* `sweep-measurements.json`, `cold-measurements.json`.

---

### D7 · `/archive/4` ships without the colophon its three siblings all carry
**Objective · minor · newly-scoped surface**

`/archive/1`, `/archive/2` and `/archive/3` each end with a provenance footer ("Colophon & provenance — Compiled 27 July 2026 from four excavations…" / "Provenance — Every figure above traces to one of these…"). `/archive/4` has **no `<footer>` element at all** (`grep -c '<footer' docs/archive/4.html` → 0).

For a series whose whole editorial premise is that its figures are traceable, the newest instalment is the one that drops the traceability note.

---

## 3. First-experience — the cold visitor

**Required section (§3 of the brief), kept even though the report is not short.**

The cold-visitor surface is **six pages wide**: `/`, `/templates`, and `/archive/{1,2,3,4}`.

**All 14 cold surfaces render standalone with no session and no redirect.** `/` and `/templates` return 200 and reflow correctly (375/390 at mobile, no overflow). `/swim` and `/ship` were confirmed to be **cold landing previews** (`isLanding: true`, `server.js:1653`/`:1672`), not legacy redirects — both render their preview branch correctly at both widths. `/auth/jira` with no workspace returns **400** carrying "No Workspace Selected", which renders correctly.

**The finding for this section is the archive.** Three of the four archive documents scroll horizontally on a phone (D4). And **all four carry zero links** — `document.querySelectorAll('a[href]').length === 0` on every one:

> A cold visitor who arrives at `/archive/4` from a search engine — it is public, unauthenticated and indexable — reads a long, self-styled document about a product, and is then offered **no route into that product**. No nav, no home link, no CTA, not one anchor.

The 2026-08-23 review examined the archive's *shell bypass* and reasonably closed it as intentional. That answered a different question. The bypass being deliberate does not answer the brief's actual first-experience test — "does it offer a route back into the product?" — and the answer is **no, on all four**.

This is reported, not minted: it is a **content/editorial decision** about standalone museum documents, and the §7 cap is better spent on objective breakage. Flagged for the owner's judgment.

**Lighthouse accessibility** (13.4.1, cold, session-free):

| surface | score | failing audits |
|---|---|---|
| `/` | **0.96** | `color-contrast` only |
| `/templates` | **1.00** | none |

The single `color-contrast` failure is independent second-tool corroboration of **LIN-739** — cite, not re-mint.

---

## 4. Tier-B re-measures — all three verified, none inherited

### LIN-2251 (escalation-KPI window select) — **CONFIRMED FIXED**

Measured on `#kpi-window-days` in **dark driven by the real cookie** (`documentElement.className === "theme-dark"` verified in the same read):

| | 2026-08-23 | **now** |
|---|---|---|
| background | `rgb(255,255,255)` | **`rgb(22,24,29)`** — exactly body |
| color | `rgb(0,0,0)` | **`rgb(230,230,230)`** — exactly body |
| font-family | Arial | **Inter** |
| font-size | 19px | **14.4px** |
| height | — | 34px |

The new rule is genuinely wired: `lib/render-escalation-kpis.js:114` emits `class="kpi-window-select"` and `public/escalation-kpis.css:7-24` matches it. Not orphaned CSS — which is the exact failure mode that would have made this a second no-op fix.

*34px height remains under the 44px touch guidance — that belongs to **LIN-2221 / LIN-1018**, cite only.*

### LIN-2252 → LIN-2272 (feedback-FAB overlap) — **CONFIRMED FIXED, AND IT HOLDS**

LIN-2252's `padding-bottom: 3.5rem` was a no-op (bottom padding on a normal-flow element cannot move it away from a `position: fixed` overlay). LIN-2272 replaced it with horizontal reservation. Re-run live on a seeded feed:

| width | `.lc-more-btn` rect | `.feedback-fab` rect | intersects | clearance |
|---|---|---|---|---|
| **390** | x30 y5542 w203 h30 | x276 y796 w83 h32 | **false** | **43px** |
| **360** | x28 y7525 w177 h47 | x246 y796 w83 h32 | **false** | **41px** |
| **320** | x28 y7580 w137 h47 | x206 y796 w83 h32 | **false** | **41px** |

Computed `padding-right: 112px`. No document overflow at any width (375/390, 345/360, 305/320).

**Research's open residual is closed:** it flagged that at 320px the 137px button *might truncate* its label. It does not — the label wraps instead (height grows 30px → 47px) and `scrollWidth === clientWidth` (135/135), so no text is lost. **Not a finding.**

### LIN-2247 (dark-token parity) — **HOLDS on rendered evidence**

`tests/unit/theme.test.js` enforces parity by `readFileSync`-ing `public/style.css` and slicing rule bodies as *text* — it proves token **declaration** parity in source, not rendered parity, and cannot substitute for a dark render.

Dark renders were taken via the real cookie path (`theme=dark`, with `documentElement.className === "theme-dark"` asserted in the same read) on **19 surfaces**: the merge-confirm screen at both widths, all five `renderUpstreamAwareErrorPage` variants, the merge reauth page, the four merge error outcomes, Account Conflict, the three provider pickers, workspace-not-found, and the escalation-KPI page. **No missing-token defect appeared on any of them** — every measured foreground/background pair resolved to a real dark-theme token, and the focus ring tracked `--focus` correctly (§9). Parity holds visually on the surfaces rendered.

*Bound on this claim: the 14 cold/unauthenticated surfaces were captured in light only, since their theme is either cookie-driven from a footer toggle they do not all carry or, on the landing, its own `colorScheme:'dark'` path. Dark parity on those is unverified this run rather than confirmed.*

---

## 5. Advisory tail — carried forward

1. **Feedback FAB's blue** — carried. Unchanged this run.
2. **Two KPI heading languages** — **carried, restated from my own probe; both the 2026-08-23 wording and the research comment's wording are retired as inaccurate.** Measured this run:

   | | `/kpis` | `/escalation-kpis` |
   |---|---|---|
   | headings present | **13** | **1** |
   | section heading | H2 `instance kpis` — **JetBrains Mono, 19.2px, lowercase, w700** | *(none)* |
   | sub-headings | H3 `├─ proxy calls by phase` — **JetBrains Mono, 13.6px, w600**, tree-glyph prefixed | *(none)* |
   | page title | H1 `Harbour` — Inter 32px | H1 `Escalation KPIs` — **Inter, 32px, Title Case, w400** |

   The two pages genuinely do speak different heading languages — `/kpis` is mono, lowercase and tree-glyphed; `/escalation-kpis` is sans and Title Case with no section headings at all. But **neither prior description was right**: research recorded `/escalation-kpis` section headers as "JetBrains Mono, 12.8px, uppercase" — in the state rendered this run that page has **zero `.section-header` elements**. Note `/kpis` is a **top-level** route, not workspace-scoped (`/workspace/:urlKey/kpis` is a 404); a probe that assumes otherwise measures nothing and silently reports "no difference".
3. **Live Console mobile zoom targets** — **independently re-measured this run, unchanged.** All seven `.lc-timeline-preset` controls at 390px: `3m` 37×24 · `15m` 44×24 · `1h` 37×24 · `6h` 37×24 · `fit` 44×24 · `1h` 37×24 · `24h` 44×24 — **24px tall, 37–44px wide**, every one under the 44px touch target, identical to last run's figures. Owned by **LIN-2221 / LIN-1018** — cite, never mint.
4. **`/kpis` colour-only series encoding** — carried, now with LIN-2325's added density. Only **2 of 11** stat cards carry a `basis` third slot (`workspaces`, `roadmap reports` — `lib/render-kpis.js:360,368`), so the new disclosure lands unevenly across the grid.
5. **Collective status dots** — **settled after three prior runs of "unverified", and independently reproduced this run.** Driven live against the mock Yap backend, then flipped with `context.setOffline(true)` and a 6.5s settle:

   | state | rendered text | computed colour |
   |---|---|---|
   | connected | `● live` | **`rgb(102, 102, 102)`** |
   | disconnected | `● disconnected` | **`rgb(102, 102, 102)`** |

   **Identical.** Root cause in source: `public/collective.css:300` sets `.collective-poll-status { color: var(--fg-dim) }` — one colour for every state — and `public/collective.js:201-203` `setPollStatus()` sets `textContent` only, never a class, across all five call sites. The status dot carries **no semantic state colour at all**. Advisory rather than breakage: the state is still legible, because the *word* changes even though the colour does not.

---

## 6. Unrenderable states and coverage limits — named, not faked

**Genuinely unrenderable:**

* **The prompt-trace provider-context disclosure's live divergent state (LIN-2357).** No `/test/seed-prompt-trace` seam exists; traces are produced only from `lib/openrouter.js:401` via `setPromptTraceRecorder`, i.e. only on a real LLM call. **The live divergent render could not be produced on a keyless review server.** What *is* answerable from source and markup: `renderProviderContextDisclosure` (`lib/render-settings.js:721`) renders the divergent verdict as a **number inside a sentence** — `"N of M traces missing (X divergent, Y benign)"` (`:748-750`) — carrying no colour, weight or state token separating it from benign. The ticket asks "does a divergent verdict read differently at a glance?" On the markup: **no.** On the live render: **not established**, and this report does not claim it.

**Coverage limit, stated plainly:**

* **The merge-consent flow was exercised in its Linear variant only.** The sole capture seam (`/test/set-merge-conflict-session`, `routes/test.js:349-356`) hardcodes `identityLabel: 'Linear'`, `reauthUrl: '/auth/linear'` and `provider: 'linear'` with no `?provider=` override, even though LIN-2304 (`4c766e3f`) made the underlying flow multi-provider (GitHub, GitHub Projects, Jira). **This report does not claim or imply provider-wide consent-screen coverage.** The GitHub / GitHub Projects / Jira confirm and reauth screens remain never-rendered by any design review.

**Renderable after all — a plan precaution the execution overturned:**

* The v3 plan amendment listed `renderUpstreamAwareErrorPage`'s `upstream` branch as *possibly* unrenderable without a real provider outage, and required it to be named with a reason if so. **It is fully renderable.** `classifyUpstreamError` (`lib/errors.js:198`) keys purely off `error.status` / `error.code`, so all five variants — `auth` (401/403), `upstream` via 5xx, via 429, via `ECONNRESET`, and `internal` — were constructed from synthetic error objects and rendered through the production renderer. **All five are captured; none is excluded.** That is how D5 was found.
* The **four merge error outcomes** (Merge Expired ×2, Merge Failed, Workspace Limit Reached) plus Account Conflict were likewise all rendered through the production renderer with the exact strings their call sites pass (`routes/account-merge.js:86,99,110,122`). Last run's plan expected three of four to need fixtures that do not exist; **none is missing from this report.**

**Dead in production, named rather than dropped:**

* **`renderLoginPage`** (`lib/render-pages.js:68`) is **unreachable**. No route calls it; the only references are the barrel re-export (`lib/render.js:30`), two source comments, and `tests/unit/lin-1890-jira-entry-surfaces.test.js:164`, which itself labels it *"dead in production, consistency only"*. Research listed it as an in-scope Tier-A surface; that was an over-claim. It was rendered anyway for the record (`sweep-login-DEAD-light.png`) and carries the same D2 and D6 defects — but as dead code it is **not** a live finding, and no follow-up is minted for it.

**Cite-only, never re-minted:** LIN-739, LIN-849, LIN-2221, LIN-1018, LIN-1856, LIN-2370, LIN-2371, LIN-681, LIN-868, LIN-941, LIN-1688, LIN-1218, LIN-949.

**One provider-neutrality gap that is *not* covered by an existing ticket:** `renderUpstreamAwareErrorPage` hardcodes "Linear" in both its title ("Trouble Reaching **Linear**") and its message ("**Linear** rejected your session…") across five authenticated routes (`server.js:2485,2551,2594,2663,2737` — the tree, swipe, swim, ship and roadmap error paths). **LIN-2370** is scoped to `public/proxy.js` / `public/common.js`; **LIN-2371** is scoped to `lib/prompts/*`. Neither reaches `lib/render-pages.js`. On a GitHub-, Jira- or Local-backed workspace these five error paths tell the user a provider they may never have connected has rejected them. Reported here; **not minted**, to stay inside the §7 cap — it is the strongest candidate if a fourth slot ever opens.

---

## 7. Follow-ups minted — 3 (at the cap)

Objective breakage only, left in their default state.

| # | Finding | Why it earned a slot |
|---|---|---|
| **FU1** | **D1 + D3** — the account-merge consent screen renders an irreversible action identically to its decline, and both are UA-default-sized with no pointer cursor | Highest-stakes surface in the app, never design-reviewed, two measured defects on one screen |
| **FU2** | **D2** — every error/consent page's subject is a `<div>`, not a heading | Accessibility, 11 surfaces, 110 call sites, one-renderer fix |
| **FU3** | **D4** — `.chip { white-space: nowrap }` forces horizontal page scroll on `/archive/{1,2,4}` at mobile widths | Objective mobile breakage; overturns an inherited "no finding" |

**Deliberately not minted:** D5 (upstream copy), D6 (title brand drift), D7 (`/archive/4` colophon), the archive dead-end (§3), the `renderUpstreamAwareErrorPage` Linear hardcoding (§6), and every advisory item in §5. All are recorded above with measurements so a future run can promote them without re-deriving.

---

## 8. Maker coverage gap — handed off, not fixed

No committed Playwright maker touches **any** Tier-A surface: merge confirm/reauth, the four merge error pages, the provider pickers, `renderUpstreamAwareErrorPage`, the session page, task-edit/create, archive, live-console, ship-biscuit, flight-companion, passage-planner, task-chat, next-run, collective, observation, escalation-kpis, the feedback widget, and the error/not-found pages. `playwright.visual.config.js` additionally sets no `YAP_BASE_URL`, so it **structurally cannot** capture a populated `/collective`.

Per §2 of the brief these were captured live and the gap is **handed to the test/code-quality altitude** — LIN-868 / LIN-941 are the precedent. **The committed makers were not extended**; that would be a change to ship, and this is a review.

---

## 9. Inherited claims overturned

Both are the same shape: a prior conclusion that was correct about the question it asked, and wrong about the question the brief actually poses.

1. **2026-08-23: "`/archive/:n` … renders legibly at 1400px and 390px. This is the design, not drift. No finding." → overturned.** At 390px `/archive/2` has **141px** of genuine horizontal scroll and `/archive/4` has **35px** (105px at 320px). The prior run correctly established that the *shell bypass* is intentional, then closed the surface on that basis without measuring reflow. Numbers in §2 D4.

2. **Research (2026-08-29): merge-confirm focus rings are "the UA-default `solid 2px rgb(13,110,253)` ring, not the app's `--focus`." → overturned.** `public/style.css:331` is an authored global rule: `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`. Measured on the merge-confirm buttons: light ring `rgb(13,110,253)` against `--focus: #0d6efd`; dark ring `rgb(110,168,254)` against `--focus: #6ea8fe`. **Exact match in both themes** — the ring is the app's own token and tracks the theme correctly. Not a finding, and the focus order is a clean two stops (confirm → decline → out of document).

---

## 10. Adversarial second-read

_(posted as a comment on LIN-2381 and mirrored here after the report landed — see below)_
