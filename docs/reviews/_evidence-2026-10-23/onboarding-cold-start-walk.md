# Onboarding & Cold-Start Review run #3: walk transcript (2026-10-23)

Raw evidence behind `docs/reviews/onboarding-cold-start-review-2026-10-23.md`, recorded from this run's own probes. Every token, nonce and sign-in link is redacted. Times are UTC, 2026-10-23, about 11:42–12:00.

**Pins.** `LinearViewer` `origin/main` `661124c1`. Live `harbour.cat` footer `578aa0d` (one commit behind; the only difference is `661124c1`, a docs-only dependency review). `simple-dispatcher` `origin/main` `bb1da78`. Node 25.9.0, npm 11.12.1, macOS.

## A. Live `https://harbour.cat`, no cookie

| Request | Status | Notes |
|---|---|---|
| `GET /` | 200 | title `Harbour — keep human intent in command of AI execution`. Hero CTAs: `/auth/linear`, `/auth/github`, `/auth/jira/oauth?mode=new`, `/auth/email`. `landing-try` section: 0 `<a>`, 0 `<button>`, 0 `<form>`. `landing-providers`: 0 `<a>`. |
| `GET /auth/linear` | 302 | `linear.app/oauth/authorize?…scope=read%2Cwrite…prompt=consent` |
| `GET /auth/github` | 302 | `github.com/login/oauth/authorize?…` |
| `GET /auth/jira/oauth?mode=new` | 302 | `auth.atlassian.com/authorize?…scope=read:jira-work write:jira-work read:jira-user offline_access…` |
| `GET /auth/github-projects` (unadvertised) | 302 | `github.com/login/oauth/authorize?…` (same GitHub App) |
| `GET /auth/email` | 200 | the form `POST /auth/email/send`, with a hidden nonce, honeypot `website` and `email`. Copy: "We'll email you a link… works once, for 15 minutes." |
| `GET /swipe`, `/swim`, `/ship` | 200 | nav: `+ local workspace` (`POST /workspace/new`), `Sign in →`, `GitHub →`, `Jira →`, `Email →` |
| `GET /library`, `/sitemap.xml`, `/robots.txt`, `/llms.txt` | 200 | `robots.txt` → `Allow: /` + sitemap. Live `/llms.txt` is byte-identical to `public/llms.txt` at HEAD. |
| `GET /kpis`, `/styleguide`, `/templates`, `/privacy`, `/terms`, `/health`, `/archive/1`, `/archive/8` | 200 | `/archive/8` was 404 in run #2 |
| `GET /login`, `/docs` | 404 | bare `Cannot GET` body (unchanged) |
| `GET /t/bogus-token` | 404 | Harbour-chrome "Not Found · This page does not exist. Go back" |
| `GET /runner-kit/broker.mjs`, `/runner-kit/runner.mjs` | 200 | sha256 `79f5595f…a258` / `d080c7ac…f19d`, equal to `lib/runner-kit/*` at HEAD |
| `GET /runner-kit/README.md` | 404 | `{"error":"Not a runner kit file"}` |
| `GET /workspace/x/runner`, `GET /workspace/new` | 302 | → `/` |
| `GET /api/proxy/instructions`, `GET /api/proxy/runner/prompt` | 401 | `PROXY_TOKEN_INVALID`, `stage: proxy-token` |
| `POST /api/proxy/token` (fake bearer) | 401 | "Invalid, expired, or already-exchanged bootstrap token" |
| `GET /api/proxy/runner/prompt` with this session's grant-less token | 403 | `TAKE_GRANT_REQUIRED` |

**`/kpis` funnel (read after the second-read, same day).** A no-cookie `GET /kpis` embeds `"milestoneFunnel":{"steps":{"login":{"state":"reached","count":{"hidden":"below-floor"}},"connected":{"state":"reached","count":{"hidden":"below-floor"}},"firstGo":{"state":"reached","count":0},"prOpened":{"state":"reached","count":0},"mergeClicked":{"state":"reached","count":0}},"mode":{"byRung":[{"rung":"copy","entries":0},{"rung":"run-step","entries":{"hidden":"below-floor"}},{"rung":"run-task","entries":{"hidden":"below-floor"}}]}}`. The rendered text reads "How people get started · from sign-up to merge · 30d … signed up: fewer than 5 · connected: fewer than 5". The footer had moved to `c1b8590` by then (a later deploy). `GET /auth/github/callback?installation_id=1&setup_action=install` → 302 `/auth/github`.

**Link sweep.** The 132 unique URLs from `/sitemap.xml` plus the hrefs on `/`, `/library`, `/swipe`, `/privacy`, `/terms` and `/archive/1` were all fetched. All returned 200 except the three OAuth doors (302, as expected).

**Not submitted live:** `POST /auth/email/send`. Email sign-in was turned back on at about 10:35Z (LIN-3771 close-out). This run did not add a send to a production mailer still under a spam watch (LIN-3771's named monitor). The inbox leg is capability-gated.

### A2. Live hosted Local door, walked and then removed

| Step | Status | Notes |
|---|---|---|
| `GET /swipe` → `POST /workspace/new` (Origin header set) | 302 | → `/workspace/local-workspace-3d01f80b/` |
| first screen | 200 | onboarding hint "Your workspace is ready. Add your own task to get started — the welcome tasks are just a starting point." `__HOME_PROMPT_OPTS__` has `"hasAI":true,"aiState":"ready","freeTier":true`. Add-source rows: `+ Linear`, `+ GitHub Issues`, `+ Jira`, `+local workspace`. |
| `GET …/api/prompt/<issue-2>/research` | 200 | 11,625 B deterministic `research` template for LOCAL-2 |
| `GET …/api/recommend/<issue-2>/stream` | 200 | SSE `phase` → `reasoning` → `delta` … `done`, 1.58 s, `completionTokens: 61`, no OpenRouter key and no OAuth |
| `GET …/runner` | 200 | `data-state="owner-dispatch-off"`. After `POST settings/features dispatch=true` the state is `owner`. |
| no-cookie `GET /workspace/local-workspace-3d01f80b/` | 302 | → `/` (LIN-3065) |
| cleanup: `POST /workspace/<key>/remove` ×2 | 302 | both workspaces removed (a stray second `POST /workspace/new` had made `local-workspace-95905e4e`). Both now 302 → `/`. |

## B. Fresh clone `661124c1`, README literally (J3)

`git clone` → `cp .env.example .env` → `npm install` (108 packages, warm npm cache) → `npx playwright install` (browsers were already in `~/Library/Caches/ms-playwright`, so this was not a cold download) → `npm start`:

```
Warning: Missing OAuth environment variables: LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET
The app will start, but Linear OAuth login will be unavailable until these are set.
Warning: OPENROUTER_API_KEY is set but empty/whitespace — it will be treated as unset.
…
Email sign-in: off
Harbour running at http://localhost:3000
```

| Request (no cookie) | Status |
|---|---|
| `GET /` | 200. The only hero CTA is "Log in with Linear", plus the "Getting started" `LINEAR_ACCESS_TOKEN` callout. No email CTA. |
| `GET /auth/linear` | **503** "OAuth Not Configured — Linear OAuth is not available. Missing environment variables: LINEAR_CLI…" (LIN-3108) |
| `GET /auth/github`, `/auth/jira/oauth?mode=new` | 503 (not advertised on this landing) |
| `GET /auth/email` | 503 "Email sign-in isn't available on this server." `POST /auth/email/send` also 503. |

## C. Fresh clone, repo scripts (J4)

`npm run setup` → exit 0. `npm run env:check` → **exit 0** with `Status: 1 issue(s) to fix before proceeding` and `1. Install Playwright browsers → npx playwright install chromium --with-deps`. Meanwhile `~/Library/Caches/ms-playwright/chromium-1200/INSTALLATION_COMPLETE` exists. `scripts/env-check.sh` is 154 lines with 0 `exit`; there is no macOS cache check (lines 95–101). `.claude/settings.json` `SessionStart` still runs `npm run setup`.

## D. Fresh clone, local workspace and agent paths (J8 / J10 / J11)

| Step | Status | Notes |
|---|---|---|
| `POST /workspace/new` | 302 | → `/workspace/local-workspace-b0aa0c6d/` + `connect.sid` |
| first screen | 200 | the same onboarding hint. Seed: "Welcome to your local workspace" (In Progress) and "Add your own tasks" (Todo). Project copy says "Edit or add issues via the API/CLI for now." beside a working `+ Add task`. |
| `POST …/settings/features feature=dispatch&enabled=true` | 302 | → settings |
| `POST …/api/dispatch {issueId:"local-workspace-b0aa0c6d-issue-2", issueIdentifier:"LOCAL-2", …}` | **201** | item `ff680399…`, with warning "No consumer has ever polled this workspace…". **LIN-3068 does not reproduce.** |
| no-cookie `GET /workspace/<key>/` | 302 | → `/` (LIN-3065) |
| `GET …/runner` | 200 | `data-state="owner"`, `data-account-id` = an anonymous account minted for the local workspace |
| `POST …/api/proxy/tokens {runner:true}` | 201 | `kind: bootstrap`, `grants: [take, dispatch]`, 1 h |
| `POST /api/proxy/token` (exchange) | 200 | working token, 24 h. `GET /api/proxy/runner/prompt` → 200, 15,918 B |
| runner prompt §1, run as written (with `HOME` set to a scratch dir) | — | fetch kit → `kit ok` → `recover` (`fail/orphans/lost/live` all empty) → `login` (`ok:true`, grants take+dispatch) → `poll` → decision **`take`**, reason `confirmed`, for `ff680399…` |
| `take` | not run | Running `take` would hand the probe item to a subagent. That is outside a review-only scope. |
| `POST …/api/task/LOCAL-2/share` | 201 | `{path:"/t/<43 chars>"}` |
| no-cookie `GET /t/<token>` | 200 | `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`. The page shows the task, its stage track ("Research queued, waiting for a worker") and its description. No owner controls. |
| no-cookie `GET /t/<token>/state` | 200 | JSON repaint |
| guest clicks: nav brand, `swipe`, `settings`, `← back to tasks`, parent `LOCAL-1` | 302 | → `/` (landing), no message |

## E. Fresh clone with `EMAIL_TRANSPORT=console` (J9, self-host)

Startup log line: `Email sign-in: console`. Landing now shows "Continue with email".

`GET /auth/email` → wait 3 s → `POST /auth/email/send` (`cold-start-review@example.invalid`, nonce, empty `website`) → 200 "Check your inbox · If that address can receive email, a link is on its way." The server log prints `[email] (console transport, dev only) to=… subject="Your Harbour sign-in link"` and the confirm URL. `GET /auth/email/confirm?t=…` → 200 "Sign in as cold-start-review@example.invalid?" `POST /auth/email/confirm` → 302 `/account`. `/account` shows "Signed in as …", "Workspaces don't follow you to a new device yet: reconnect a source here.", `Connect Linear` and `or Create a local workspace`.

Cross-device check: the email account creates `local-workspace-a3717d7e`. A second cookie jar then signs in by email as the same address. Its `/account` does not list the workspace, and `GET /workspace/local-workspace-a3717d7e/` → 302 `/` (LIN-3065 / LIN-3141). The first jar still gets 200.

## F. Fresh clone `simple-dispatcher` `bb1da78` (R1)

`npm install` (5 packages) → `env -i PATH=… node dispatcher.js` → `API: http://localhost:3000`, then `Failed to load workspaces.json: ENOENT …` → exit 1. `README.md` §Setup (`:44`) asks for a `.env`; `workspaces.json` is explained at `:196`. There is no example file.
