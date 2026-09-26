# Onboarding & Cold-Start Review — 2026-09-26 (run #2, trend vs 2026-08-29 baseline)

**Status: run #2.** This is the second edition of the series. It trends every journey step against the 2026-08-29 baseline (`docs/reviews/onboarding-cold-start-review-2026-08-29.md`, LIN-2382, PR #1290), which established the stable step names J1–J7/R1 and the D1 divergence. No later `onboarding-*` report exists under `docs/reviews/`.

**Grounded at:** `LinearViewer` HEAD `b5c528c4` (`origin/main`, verified locally this beat) · `simple-dispatcher` HEAD `3b1e734` (unmoved) · live instance `https://harbour.cat` walked directly, 2026-09-26.

This is a **performed** review: every journey below was actually attempted this run — live HTTP probes against `harbour.cat`, and fresh `git clone`s of this repo run in isolated scratch directories — not onboarding artifacts read in the abstract. All of it is recorded on LIN-3106: the performed-walk ledger and finding-class table live in the research comment (`6993fb7f-83d8-4d57-b783-53bdfce6f94e`, 2026-09-26), and the single-session execution plan in the plan-summary comment (`fe532725-967b-4078-9cbb-9d2473880b0b`, 2026-09-26) plus the `## Implementation Plan` in the issue description. This report is written from that recorded evidence; it does not re-walk and does not silently repair anything the walk recorded.

---

## 1 · Frozen destination

This run freezes the **live landing page's own claim**, **unchanged from the 2026-08-29 baseline**:

> **"Harbour keeps human intent in command of AI execution, one turn of the loop at a time."**
> — `lib/render-landing.js:306` (title `:404`; hero tagline `lib/components/landing-hero.js:67`)

Why this one: (1) it is the live, advertised purpose a cold visitor actually walks against; (2) it is unchanged from the baseline, which keeps the trend ledger mechanically comparable; and (3) it is a strict prefix of the normative north-star v3 lead, so freezing it contradicts no accepted doc.

Every journey below is judged against that sentence: *used as intended* means the cold visitor reached read → ground → dispatch → verify on the live product.

**Purpose divergences — all recorded, none silently re-picked:**

- **north-star v3** (`docs/north-star.md:5`, accepted 2026-09-19) now leads with *"Harbour keeps human intent in command of AI execution: it meets a developer where they are, completes verified backlog work at a cost and cadence a solo operator can sustain, funds itself doing it — and proves every word."* The old *"stranger … one sitting"* lead is gone, surviving only as the step bar at `:17` (*Login → connected → first evidence-verified merge, without talking to the operator*). **Delta vs baseline: changed/new.**
- **`docs/v1.md`** (accepted 2026-09-19, scope of LIN-2935 In Progress) makes an explicit 8-step cold-start promise (`docs/v1.md:43-50`): log in with email → connect GitHub + tracker → see the work → press *Go* → watch → get the PR with its evidence → close out → share the link. **Not advertised on any live surface** (the landing hero offers only Linear/GitHub/Jira) and **not reachable** — email auth *"does not exist in code"* (`docs/v1.md:107`), tracked by LIN-1892 (Todo). **Advertised-before-reachable: NO.**
- **`README.md:3`** (D1, re-verified at HEAD) still describes the product as *"a minimal, CLI-aesthetic web app that displays your projects and issues as a collapsible tree … backed by Linear, GitHub, GitHub Projects, Jira, or a local store."* **Delta: unchanged.**
- **`/llms.txt`** (public, agent-facing) opens with the same narrower *"collapsible tree"* framing. **The D1 divergence now also appears on the agent-facing surface — new this run.**

---

## 2 · Scope: journey inventory

Discovery at 2026-09-26 widened the baseline's J1–J7/R1 inventory to add **J8** (the new headless agent/local-workspace persona), split **J5** into **J5a** (broker-delivered) and **J5b** (standalone exchange), and add the **v1-promise check** (v1.md postdates the baseline). D1 is carried as a cross-cutting divergence.

| # | Path / persona | Walked this run |
|---|---|---|
| J1 | Hosted visitor → sign-in strip | ✅ live probe (redirects only; consent gated) |
| J2 | Advertised vs. reachable backends | ✅ live probe + provider-source check |
| J3 | Self-hoster, README §Setup literally | ✅ fresh clone `b5c528c` |
| J4 | Self-hoster, `npm run setup` / `env:check` | ✅ fresh clone `b5c528c` |
| J5a | Broker-delivered bootstrap | ✅ this session's own live dispatch is the evidence |
| J5b | Standalone bootstrap exchange | ✅ live 401 probes (real bootstrap gated) |
| J6 | Free-tier / BYOK first useful action | ✅ live probe |
| J7 | Pre-auth public surfaces (widened) | ✅ live probe |
| J8 | **Headless agent-run self-hoster on a local workspace (new)** | ✅ fresh clone `b5c528c` |
| R1 | `simple-dispatcher` dispatch-consumer seam | ✅ fresh clone `3b1e734` |
| D1 | Destination divergence (README vs. landing) | cross-cutting |
| v1 | v1-promise check (new) | ✅ live probe + docs read |

Recording vocabulary per step: `proceeded` / `had to guess` / `hard-blocked` / `capability-gated`. Each journey also records whether the frozen destination was actually reached.

**Zero state declared:** no account, no `.env`, no token, no prior session. Per the review contract, the dispatch workspace's populated `.env`/`node_modules` were **not** used — every self-host leg above ran in a fresh clone in a scratch directory.

---

## 3 · Journey-by-journey walk log

### J1 — Hosted visitor, sign-in strip
`https://harbour.cat/` → `200`. All three CTAs render and resolve to correctly-scoped OAuth redirects (302; consent not followed):

| Provider | CTA href | Redirect target |
|---|---|---|
| Linear | `/auth/linear` | `linear.app/oauth/authorize?scope=read,write…` |
| GitHub | `/auth/github` | `github.com/login/oauth/authorize…` |
| Jira | `/auth/jira/oauth?mode=new` | `auth.atlassian.com/authorize?scope=read:jira-work write:jira-work read:jira-user offline_access…` |

**Verdict: proceeded** (redirects), **capability-gated** at consent. **Destination: NO (gated). Delta: unchanged.**

### J2 — Advertised backends vs. reachable backends
The landing page lists **5** providers as non-interactive `<li>` text with zero `href` (`lib/render-landing.js:292-296`): Linear, GitHub Issues, GitHub Projects ("boards, read-only V1"), Jira, Local ("writable, no tracker"). Linear/GitHub/Jira each have an entry point. GitHub Projects declares `No entryCta` as a deliberate absence (`lib/providers/github-projects/index.js:585`) and has no reachable entry from any surface.

**Correction (adversarial second-read, §9):** the walk record's original claim that Local is "hard-blocked … no workaround discoverable from the surface" is **wrong** and is corrected here. Local declares `No entryCta` (`lib/providers/local/index.js:594`) only because its door is the form action `POST /workspace/new`, not a provider login route — and that form **is rendered pre-auth, zero-credential**, in the shared landing nav bar: `lib/components/navbar.js:97-99` emits `<form action="/workspace/new" method="POST"><button>+ local workspace</button></form>`. The homepage suppresses the bar via `minimalNav` (`navbar.js:61-62`, `lib/render-landing.js:277`), but `/swipe`, `/swim` and `/ship` call `renderNavBar({… isLanding})` **without** `minimalNav` (`lib/render-swipe.js:494`, `lib/render-swim.js:36`, `lib/render-ship.js:48`) and so render the button. The landing footer links `projects · swipe · swim` (`lib/components/footer.js:112-124`; `lib/render-landing.js:280`), making the path from `/` two clicks: `/` → footer "swipe" → `+ local workspace`. A cold `GET /workspace/new` → `302 /` only reflects that this route is POST-only, not that it is unreachable — a real `POST` creates the workspace.

**Verdict: GitHub Projects hard-blocked** (no workaround discoverable from any surface); **Local had to guess** (reachable, but only via the nav bar on the adjacent public preview pages, never from the provider list that advertises it); **proceeded** for the other three. **Destination: NO. Delta: unchanged** — LIN-2387 still open for GitHub Projects and for the landing provider-list advertisement (see §6).

### J3 — Self-hoster, README §Setup literally (fresh clone `b5c528c`)
Clone → `cp .env.example .env` → `npm install` (106 pkgs) → `npx playwright install` (**a genuine ~100 MB cold download this run** — unlike the baseline's pre-cached caveat) → `npm start` (warns `LINEAR_CLIENT_ID`/`LINEAR_CLIENT_SECRET` missing; *"Harbour running at http://localhost:3000"*) → `GET /` `200` with the "Getting started" callout.

**Verdict: proceeded end-to-end, zero guessing** beyond the documented port. One reach (§5, #1): the README never warns about the Playwright download size/time. **Destination: NO** (a rendered product, not a verified merge). **Delta: unchanged.**

**Zero-credential sub-finding:** with no OAuth configured, the hero still shows **"Log in with Linear"** and clicking it returns **503 "OAuth Not Configured / Linear OAuth is not available."** Resolved this run as objective breakage — see §4/§6 and the J3 row below.

### J4 — Self-hoster, the repo's own scripts (fresh clone `b5c528c`)
- `npm run setup` → `scripts/setup.sh`: **proceeded** (installs deps, `npx playwright install chromium --with-deps` with a graceful fallback, then runs `env:check`).
- `npm run env:check`: **had to guess**, plus an objective defect. It prints `1. Install Playwright browsers` as **ACTION REQUIRED** even though `chromium-1200` is fully installed at `$HOME/Library/Caches/ms-playwright` (`INSTALLATION_COMPLETE` present), and it returns **exit 0** despite *"Status: 1 issue(s)"*.

`scripts/env-check.sh` re-verified at HEAD: **154 lines, zero `exit` statements** (`grep -n exit` → no matches). Its Playwright detection checks only `node_modules/playwright-core/.local-browsers` (`:95`), `$HOME/.cache/ms-playwright` (`:97`), `/ms-playwright` (`:99`) and `$PLAYWRIGHT_BROWSERS_PATH` (`:101`) — **never the macOS path** `$HOME/Library/Caches/ms-playwright`. `.claude/settings.json` `SessionStart` still runs `npm run setup`, which chains into it.

**Verdict: had to guess** (macOS path) and **hard-blocked as an enforcement mechanism** (no exit signal). **Delta: unchanged** — both LIN-2386 defects persist. Minor: the optional list now also names `SESSION_SECRET`.

### J5a — Broker-delivered bootstrap
**Harness-dependent, recorded, no defect judged.** This opencode-harness session carried **no** `HARBOUR_LOCAL_BASE` / `HARBOUR_BOOTSTRAP_TOKEN` / `HARBOUR_PROXY_BASE`; it exchanged a prompt-embedded single-use bootstrap via `POST https://harbour.cat/api/proxy/token` → a working read-write token against the public TLS proxy. The orchestrating claude-code session on the same workspace/runner *does* carry `HARBOUR_LOCAL_BASE` (an unauthenticated `http://127.0.0.1:<port>` local proxy) and read/wrote LIN-3106 tokenlessly.

Runner source (`simple-dispatcher`): `dispatcher.js:1112-1113` (`usesMcpToken = usesMcpTokenExchange && token present`), `:1209-1216` (MCP-token delivery *"set only for an EXPLICIT claude-code harness"*), `:1256-1258` (`HARBOUR_LOCAL_BASE` pointer emitted only under `usesMcpToken`); `:1185-1191`/`:1300-1306` (opencode gets `item.prompt` verbatim — *"would hand an opencode launch a HARBOUR_LOCAL_BASE-pointing message it cannot resolve"*); `harnesses.js:425/432` (claude-code `{usesMcpTokenExchange:true}`) vs `:442` (opencode `{process-exit}`, no MCP). **Verdict: informational. The issue's "J5a changed shape (local proxy)" did not manifest in this session; the two harnesses receive mutually-exclusive access instructions.**

### J5b — Standalone bootstrap exchange
`docs/proxy-integration.md` Quick Start (`:20`) sits before Bootstrap Tokens (`:88`) with **no forward pointer**; Quick Start's examples use `Authorization: Bearer YOUR_TOKEN` with no hint how to obtain it. Live probes: `GET /api/proxy/instructions` no-header → `401` *"Missing or invalid Authorization header"*; fake bearer → `401` *"Invalid, expired, or consumed token"*; `POST /api/proxy/token` fake bearer → `401` *"Invalid, expired, or already-exchanged bootstrap token"* (the only body naming "bootstrap"). `/instructions` itself is 401-gated — circular. **Verdict: had to guess** (friction, not a hard block). **Capability-gated:** minting a genuine bootstrap. **Delta: unchanged** (baseline F1); the error envelope is richer now (`category`/`stage`/`retryable`).

### J6 — Free-tier / BYOK first useful action
`<section data-testid="landing-try">` (free-tier branch, `lib/render-landing.js:174-175`): *"Log in and try AI Generated Prompts free — no OpenRouter connection needed to start …"*, containing **0 `<a>`, 0 `<button>`, 0 `<form>`**. Read the offer = **proceeded**; act on it = **had to guess** ("log in" must be inferred as one of the hero OAuth CTAs), then **capability-gated** at consent. **Destination: NO. Delta: unchanged** (baseline F2).

### J7 — Pre-auth public surfaces (widened)
All `200`: `/`, `/kpis`, `/styleguide`, `/health`, `/swipe`, `/swim`, `/ship`, `/templates`, `/privacy`, `/terms`, `/archive/1..7`. `/archive/8` → `404`; `/login` → `404`; `/docs` → `404` (bare `<pre>Cannot GET /path</pre>`, no chrome). Enumeration sources: `lib/scan-public-pages.js:68` (`['/','/kpis']` + `/archive/:n`) and `server.js:1766-1942` unauth render routes + `/health` (`:800`) + `/auth/*`. **Verdict: proceeded. Delta: widened** — `/kpis`, `/styleguide`, `/health`, `/archive/3..7` are new to the ledger; `/login`, `/docs` unchanged (baseline F4).

**Correction (adversarial second-read, §9):** the walk logged `/swipe`/`/swim`/`/ship` as carrying only a "sign-in nav bar" and missed the adjacent `+ local workspace` submit control in that same bar (`lib/components/navbar.js:97-99`). That control is the Local entry point reclassified in J2 above; it belongs to J7's surface inventory too.

### J8 — Headless agent-run self-hoster on a local workspace (new this run)
Fresh clone `b5c528c`, local `:3000`:
1. clone/install/start — **proceeded** (README surfaces).
2. `POST /workspace/new` → `302` + `connect.sid` — **had to guess**: the endpoint is **not named in any doc** a headless self-hoster would read (not README, not `proxy-integration.md`), though a *browser* visitor can reach it as a one-click `+ local workspace` button on the public `/swipe`/`/swim`/`/ship` nav bars (`lib/components/navbar.js:97-99`; corrected at §9). The route is `routes/workspace.js:69-126`.
3. Re-enter by key, fresh no-cookie `GET /workspace/<key>/` → `302 /` — **hard-blocked** (LIN-3065 confirmed).
4. Enable a feature, `POST settings/features` — **had to guess** (web-settings AJAX; `lib/feature-defaults.js:22-48`).
5. Mint token, `POST /workspace/:urlKey/api/proxy/tokens` — **had to guess** (only Linear/proxy-UI-framed in docs).

This **refines LIN-3058**: the barrier is a plain `connect.sid` requirement, not a literal browser (curl held it fine); the real gaps are **discoverability + re-enterability**.

- **LIN-3068 mechanism at source:** `lib/dispatch-validation.js:224-226` requires `issueId` to match `UUID_REGEX` (*"Invalid issueId format"*), while local starter issues carry `LOCAL-1` (`routes/workspace.js:41`).
- **LIN-3069 at source:** `routes/workspace.js:38-41` seeds a real "Getting started" project + *"Welcome to your local workspace"* (`LOCAL-1`) in state **In Progress**, indistinguishable from real work; roadmap/next-run generation is capability-gated (OpenRouter).

**Destination: NO. Delta: new journey.**

### R1 — `simple-dispatcher` seam (fresh clone `3b1e734`)
**Walked, not just read:** `npm install` (5 pkgs) → `node dispatcher.js` (clean env) → `API: http://localhost:3000` (default, `config.js:17`) then `Failed to load workspaces.json: ENOENT` → **exit 1** with no further guidance. The poll leg is **capability-gated** (the dispatch token is *"created in LinearViewer's workspace settings"* — self-referential). The broker triad is documented (`README.md:152-158`; LIN-2249 remains resolved). **Verdict: baseline-clean remains; new friction: zero-config refusal with no guidance. Delta: unchanged (resolved stays resolved).**

### v1-promise check (new)
Email + "Go" is **not advertised** (zero email/signup terms on the live landing) and **not reachable** (email auth absent, LIN-1892). **Advertised-before-reachable: NO. New check** (v1.md postdates the baseline).

---

## 4 · Findings (severity-ranked)

Every finding from the walk is recorded here — including advisory friction and capability-gated legs — whether or not it was promoted to a follow-up task. Classification follows the review contract: *objective breakage* means a broken/dead link, a documented command that errors, a setup step that hard-blocks with no workaround, or a 404/500 mid-journey; *friction* means it eventually worked but needed guessing. Capability-gated steps are labelled, never guessed at.

| ID | Finding | Journey | Class | Severity | Treatment |
|---|---|---|---|---|---|
| **R2-1** | `scripts/env-check.sh`: never checks the macOS Playwright cache path (`$HOME/Library/Caches/ms-playwright`), so it reports a persistent false blocker even right after its own successful setup; and, compounding, it has **no `exit` statement at all** (154 lines, 0 `exit`) so it returns 0 on every platform no matter how many blockers it prints — nothing that trusts its status (incl. `.claude/settings.json` `SessionStart`, which chains into it) can gate on it. | J4 | Objective | **High** | Cite **LIN-2386** |
| **R2-2** | Landing markets 5 backends as plain non-interactive `<li>` text (zero `href`): **GitHub Projects** has no reachable entry from any surface (`lib/providers/github-projects/index.js:585`); **Local**'s reachable entry (`+ local workspace`, `lib/components/navbar.js:97-99`) is not surfaced from the provider list that advertises it — only from the adjacent `/swipe`/`/swim` public nav bars. *(Corrected at §9: the original "Local hard-blocked" read was wrong — Local is reachable pre-auth, zero-credential.)* | J2 | Objective (GitHub Projects) + friction (Local) | Med-High | Cite **LIN-2387** |
| **R2-3** | Local workspace is not re-enterable: a fresh no-cookie `GET /workspace/<key>/` → `302 /` (`routes/workspace.js:69-126`). A headless agent can create a workspace but cannot return to it without the original session cookie. | J8 | Objective | Med-High | Cite **LIN-3065** |
| **R2-4** | Local issue ids fail the dispatch `issueId` format check: `lib/dispatch-validation.js:224-226` requires a UUID while local starter issues carry `LOCAL-1` (`routes/workspace.js:41`), so a local issue cannot be dispatched. | J8 | Objective | Med (own line) | Cite **LIN-3068** |
| **R2-5** | Seeded starter tasks read as real work: `routes/workspace.js:38-41` seeds a real "Getting started" project and a *"Welcome to your local workspace"* (`LOCAL-1`) issue in state **In Progress**, indistinguishable from genuine backlog. | J8 | Objective | Med (own line) | Cite **LIN-3069** |
| **R2-6** | Zero-credential self-host advertises an **ungated** "Log in with Linear" CTA: `lib/providers/linear/index.js:2334` declares the Linear `entryCta` deliberately `isConfigured: () => true`, so with no OAuth configured the hero shows it while GitHub/Jira are hidden — and clicking `/auth/linear` returns **503 "OAuth Not Configured."** | J3 | Objective (404/500 mid-journey) | Low-Med | **Minted this run → LIN-3108** |
| R2-7 | Destination divergence: `README.md:3` states a narrower "collapsible tree" purpose than the frozen live claim; `/llms.txt` repeats the same narrower framing on the agent-facing surface. | D1 | Divergence (advisory) | Med | Report-only; v1/email gap cites **LIN-1892** |
| R2-8 | Headless discoverability gap: the local-workspace creation/feature-enable/token-mint **documented** path is absent. Creation exists only as browser chrome on public preview pages (`lib/components/navbar.js:97-99`), never in README or `proxy-integration.md`, so the headless persona's own documented surfaces do not lead to it (feature-enable and token-mint remain AJAX-only). *(Corrected at §9: "surfaced by nothing" overstated the gap — the control is on public web surfaces.)* | J8 | Friction (advisory) | Med | Report-only; **refines LIN-3058** |
| R2-9 | Ordering trap + circular discoverability in the standalone bootstrap lane: Quick Start precedes Bootstrap Tokens in `docs/proxy-integration.md` with no forward pointer; the live generic 401 gives no guidance to the exchange; `/instructions` is itself 401-gated. | J5b | Friction (advisory) | Med | Report-only (baseline F1) |
| R2-10 | The free-tier CTA has no distinct actionable route of its own — it aliases to J1's OAuth requirement with nothing in between (`lib/render-landing.js:174-175`). | J6 | Friction (advisory) | Low-Med | Report-only (baseline F2) |
| R2-11 | Error surface points nowhere: `/login` and `/docs` both 404, and error bodies (`401`/`404`) carry no navigation. Neither is reachable from the live surface without prior code knowledge. | J7/J5b | Friction (advisory) | Low | Report-only (baseline F4) |
| R2-12 | Consumer zero-config refusal: `node dispatcher.js` with a clean env prints `Failed to load workspaces.json: ENOENT` and exits 1 with no guidance. | R1 | Friction (advisory) | Low | Report-only |
| R2-13 | The credential/bootstrap lane is harness-dependent: opencode and claude-code receive mutually-exclusive access instructions (`dispatcher.js:1112-1258`; `harnesses.js:425/432/442`). | J5a | Informational | — | Report-only |
| R2-14 | The frozen destination itself is never reached cold: every journey gates at a credential / OpenRouter / consumer boundary before it. A journey set that is almost entirely capability-gated is itself a finding stated plainly. | cross-cutting | Capability-gate | — | Report-only |

**Clean / unchanged:** J1 (redirects correct); J3 (README path); J5a broker delivery for the claude-code harness; R1's documented broker triad (LIN-2249 stays resolved). **No funnel telemetry exists** — see §5.

---

## 5 · Reaches, capability-gates, and telemetry

**Reaches** (repo/outside knowledge used to direct the walk, logged per the discipline rule rather than silently used):

1. J3's README never warns about the ~100 MB Playwright download size/time — logged as a reach/finding in its own right.
2. The journey inventory and several probe targets (`/login`, `/docs`, the exact `/auth/*` hrefs, `/kpis`) were seeded by prior repo/source knowledge, not discovered by clicking the live surface alone.
3. J8's creation/feature/token endpoints were reached via source (`routes/workspace.js`). The creation button itself *is* on public surfaces (`lib/components/navbar.js:97-99`, `/swipe`/`/swim`), so the original walk's "surfaced by nothing" framing was itself a reach artefact — caught by the adversarial second-read (§9) and corrected in R2-8.

**Capability-gated** (marked explicitly; no outcome guessed):

- All three OAuth consent screens (Linear, GitHub, Jira) — redirect targets verified only.
- Provider-app-configured self-host first screens (GitHub App / Jira).
- Minting a genuine standalone bootstrap (J5b).
- A full dispatch of a local issue (blocked by LIN-3068) and roadmap/next-run generation (needs OpenRouter + a consumer).
- The frozen destination end-to-end — every cold journey gates at a credential / OpenRouter / consumer boundary before it; "destination reached" is recorded per journey as **NO-with-gate**, never faked.

**Funnel telemetry: none exists.** Confirmed, not assumed — this run did not hunt for signup/activation analytics and found none; the performed walk above is the primary signal. Human-reported feedback (e.g. the Lighthouse epic LIN-3057 and its children) is secondary, capability-gated corroboration only, never a substitute for the walk.

---

## 6 · Follow-up tasks (objective breakage only, capped at 3)

The mint cap governs *new* tasks only; the four pre-ticketed objective classes below were deduplicated to existing tickets and consume no cap slots.

**Objective classes deduplicated to existing tickets (no mint):**

- **LIN-2386** — `scripts/env-check.sh` false macOS blocker + zero `exit` (R2-1; J4).
- **LIN-2387** — landing provider list advertises Local / GitHub Projects with no reachable entry (R2-2; J2). *Note: this run's second-read corrected the Local half — Local is reachable pre-auth via `+ local workspace` on `/swipe`/`/swim`; the GitHub Projects half and the unlinked provider-list advertisement still stand, so the ticket remains the right home.*
- **LIN-3065** — local workspace not re-enterable (R2-3; J8).
- **LIN-3068** — local issue ids fail the `issueId` format check (R2-4; J8).
- **LIN-3069** — seeded welcome tasks read as real work (R2-5; J8).

**Minted this run (one, within the cap):**

- **LIN-3108** — *"Self-host landing shows an ungated \"Log in with Linear\" CTA that 503s with no Linear OAuth configured"* (Backlog; R2-6; J3). The zero-credential `/auth/linear` 503 was resolved as **objective breakage** under the review contract's independent disjunct *"a 404/500 mid-journey"*, regardless of the workaround available elsewhere; no existing ticket names it (§7 below), so it is mint-eligible. Scope: gate the Linear `entryCta` on the three `LINEAR_*` vars as GitHub/Jira already are, or render an honest not-configured state — preserving the test short-circuit at `lib/providers/linear/index.js:2327-2332`. Ranked Low-Med by severity, consistent with the class table.

Every other finding in §4 is friction or divergence and is **not** promoted; they live in this report for the next run.

### Lifecycle divergence (recorded, not silently resolved)

The implementation plan's **Phase 3** placed follow-up filing in `close-out` (`docs/reviews` plan, "Phase 3 — `close-out` … files the capped follow-up(s)"). **This implementation assignment instead resolves and mints the single J3 follow-up in Phase 1 (this beat)** so the report can cite a concrete ticket id in its own text. The two do not contradict on substance — one follow-up, same ticket, objective — but they differ on *which lifecycle step files it*. Per the assignment, the follow-up was searched for and minted now; the divergence is recorded here and in the implementation summary.

---

## 7 · Duplicate search for the J3 503

Before minting, `GET /api/proxy/search` was run for: `auth/linear 503`, `OAuth Not Configured`, `linear provider ungated`, `zero-credential login`, `entryCta`, `503 login CTA`, `auth/linear not configured`, `self-host Linear CTA 503`, `landing sign-in unreachable zero credentials`, `ungated sign-in CTA`. No result named the zero-credential self-host `/auth/linear` 503. Relevant relations of the obvious tickets were also read: LIN-2386, LIN-2387, LIN-3065, LIN-3068, LIN-3069, LIN-3058, LIN-1892 — none covers this finding. **No duplicate exists → LIN-3108 minted.**

---

## 8 · Trend ledger (every journey under its stable name)

| Step | Outcome this run | Destination reached | Severity | Delta vs 2026-08-29 |
|---|---|---|---|---|
| J1 — hosted visitor sign-in | proceeded (redirects); consent capability-gated | NO (gated) | — | unchanged |
| J2 — advertised vs. reachable backends | GitHub Projects hard-blocked; Local had to guess (reachable via nav bar); proceeded for 3 | NO | Med-High | unchanged (LIN-2387) |
| J3 — README-literal self-hoster | proceeded; zero-credential CTA returns 503 | NO | Low-Med | unchanged (new R2-6 finding) |
| J4 — repo-scripts self-hoster | had to guess (macOS); hard-blocked as enforcement (no `exit`) | NO | High | unchanged (LIN-2386) |
| J5a — broker-delivered bootstrap | informational; harness-dependent | gated | Informational | unchanged shape; harness split recorded |
| J5b — standalone bootstrap exchange | had to guess | gated | Med (advisory) | unchanged (F1) |
| J6 — free-tier first action | had to guess | NO | Low-Med (advisory) | unchanged (F2) |
| J7 — pre-auth public surfaces | proceeded | n/a | Low (advisory) | **widened** (`/kpis`, `/styleguide`, `/health`, `/archive/3..7`) |
| J8 — headless agent local self-hoster | proceeded → had to guess → hard-blocked → had to guess ×2 | NO | Med-High | **new journey** (LIN-3065/3068/3069; refines LIN-3058) |
| R1 — simple-dispatcher seam | proceeded setup; zero-config exit 1 | n/a | Low (advisory) | unchanged (LIN-2249 resolved); new friction R2-12 |
| D1 — destination divergence | README + `/llms.txt` narrower than frozen claim | n/a | Med (advisory) | unchanged; `/llms.txt` echo new |
| v1 — v1-promise check | not advertised, not reachable | n/a | — | **new check** |

---

## 9 · Adversarial Second-Read

**Tier used:** Tier 2 — a fresh-context sub-agent with no memory of this report-writing session. **Isolation:** the reader was given only (a) the absolute path to this report file, (b) LIN-3106 as the place the evidence lives, with proxy read access to its description and comments, (c) the local repo at HEAD `b5c528c4` for citation checks, and (d) the verbatim question. It was **not** given this session's notes, reasoning, or any statement of which finding is top-ranked; it derived the top finding from the report itself. It wrote no files.

**Question posed (verbatim):** *"What is the largest item in this window that this report missed or misfiled?"*

**Reader's answer (in full):**

> **1. The largest missed/misfiled item:**
>
> **Misfiled: the report's #2 finding (R2-2, Med-High) that the Local backend is "hard-blocked … no workaround discoverable from the surface" — and R2-8's claim that local-workspace creation is "surfaced by nothing."** Local's entry *is* surfaced, pre-auth, zero-credential:
>
> - `lib/components/navbar.js:96-99` — the unauthenticated (`isLanding`) nav renders a visible `<form action="/workspace/new" method="POST"><button>+ local workspace</button></form>`.
> - `server.js:1793-1849` serves `/swipe`, `/swim`, `/ship` to a cold visitor with `{isLanding: true}`; `lib/render-swipe.js:494`, `lib/render-swim.js:36`, `lib/render-ship.js:48` each call `renderNavBar({…, isLanding})` with **no** `minimalNav`, so the button renders.
> - `lib/components/footer.js:112-124` — the landing footer itself (`lib/render-landing.js:278`) links `projects · swipe · swim`, so the path is two clicks from `/`.
>
> So a cold visitor can create a local workspace (the one backend needing no third-party account) from a live public surface. `POST /workspace/new` (`routes/workspace.js:69-126`) is therefore *not* an undiscoverable "reach," the J2 verdict is **not** "hard-blocked," and the J8 "had to guess" step-2 characterization is wrong. The report's J7 walk even logged `/swipe`/`/swim`/`/ship` as 200 with "sign-in nav" but never noticed the adjacent local-workspace control. This demotes the report's second-highest finding and one trend-ledger `hard-blocked` verdict.
>
> **2. Verdict: DISAGREE (targeted).** The top rank (R2-1, `scripts/env-check.sh`) is correct and independently verified (154 lines, zero `exit`; misses `$HOME/Library/Caches/ms-playwright`). Coverage is otherwise broad, but R2-2/R2-8 are materially false as written, which invalidates the "Local is hard-blocked" row and weakens the J2/J8 severity picture — so the ranking does not fully hold.
>
> **3. Differs from top finding (R2-1): YES.** My answer is the misfiled Local reachability, not the env-check defect.

**Disposition reasoning.** The correction is independently verified at HEAD and valid: `renderNavBar` emits the `+ local workspace` form in its `isLanding` branch (`lib/components/navbar.js:97-99`), the branch is suppressed only by `minimalNav` (`:61-62`) which only the homepage passes (`lib/render-landing.js:277`), `/swipe`/`/swim`/`/ship` pass only `isLanding` (`lib/render-swipe.js:494`, `lib/render-swim.js:36`, `lib/render-ship.js:48`), `server.js:1793-1849` serves those pages to cold visitors, and the landing footer links them (`lib/components/footer.js:112-124`). So Local is reachable pre-auth with zero credentials, and the original walk record — which logged the public pages as carrying only a "sign-in nav" — was wrong. One refinement to the reader: R2-8 is overstated but not wholly wrong — the control is on public *browser* surfaces, yet it is named in **no** doc (`README`, `proxy-integration.md`), so the headless doc-driven persona still has to guess. The finding was narrowed to that documented-discoverability gap rather than deleted. Corrections applied to §3 (J2, J7, J8), §4 (R2-2, R2-8), §5 (reach #3), §6 (LIN-2387 note) and §8 (J2 ledger row).

`Adversarial second-read verdict: DISAGREE`
`Differed from top finding: YES`
`Disposition: fixed in place`

---

## 10 · Scope discipline

This review changed no code, config, or secrets, and no docs beyond this artifact. The fresh clones and their `npm install`/`npm start` runs were performed in isolated scratch directories authorised by the review contract (§10: *"the one periodical whose entire evidentiary basis is a walk that writes files"*); the repo under review is otherwise untouched. The one follow-up minted (LIN-3108) is a Linear task, not a repo change.
