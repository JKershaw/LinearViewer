# Onboarding & Cold-Start Review run #4: walk transcript (2026-11-11)

This is the raw evidence behind `docs/reviews/onboarding-cold-start-review-2026-11-11.md`, recorded from this run's own probes. Every token, bootstrap, nonce and share token is redacted. Times are UTC on 2026-11-11, from about 21:28 to 21:44.

**Pins.**
- `LinearViewer` `origin/main` `da5df707d`, which is 480 commits after run #3's `661124c1`.
- Live `harbour.cat` footer `da5df70`, the same commit.
- `simple-dispatcher` `origin/main` `5d8489e`, 67 commits after `bb1da78`.
- Node 25.9.0, npm 11.12.1, macOS.

**Zero state.**
- No `.env` from the dispatch workspace.
- A fresh cookie jar per journey.
- Fresh `git clone`s of both repos into a scratch directory.

**Caveat.** The npm cache and `~/Library/Caches/ms-playwright` were warm, so install times say nothing about a cold machine.

## A. Live `https://harbour.cat`, no cookie

| Request | Status | Notes |
|---|---|---|
| `GET /` | 200 | Title `Harbour — keep human intent in command of AI execution`. Hero subtitle: "Harbour reads your backlog, writes the next prompt, runs it on your coding agents, and checks the result against real evidence." Hero doors: `/auth/linear`, `/auth/github`, `/auth/jira/oauth?mode=new`, `/auth/email`. Below them is the "Or hand this to your coding agent" block, a copyable prompt that points at `https://harbour.cat/getting-started.md` (LIN-4085). The try-it block reads "Log in and let Harbour write the next prompt for a task, free to start, with no OpenRouter key needed", followed by the same four doors. The provider list still has no `<a>`. |
| `GET /getting-started.md` | 200 | `text/markdown`, `content-security-policy: default-src 'none'; sandbox`, 3,621 B. Paths: (a) local workspace via `/swipe` → "+ local workspace", then the Proxy page's Agent Prompt; (b) the sign-in door for the person's tracker, then the Proxy page's Agent Prompt; (c) `/workspace/<urlKey>/runner`. Doors listed: Linear, GitHub, Jira (OAuth), email. "This deployment has a free tier." |
| `GET /getting-started`, `/llms.txt`, `/sitemap.xml`, `/robots.txt`, `/kpis`, `/library`, `/templates`, `/styleguide`, `/privacy`, `/terms`, `/health`, `/swipe`, `/swim`, `/ship`, `/archive/1`, `/archive/2` | 200 | `/llms.txt` (128,932 B) now opens with "## Getting started (onboarding a person)" → `/getting-started.md`. Line 3 still reads "…displays your task tracker's projects and issues as a collapsible tree…". |
| `GET /login`, `/docs`, `/signup`, `/register`, `/invite`, `/join`, `/runner`, `/runner-setup`, `/backlog` | 404 | bare `Cannot GET` |
| `GET /auth/jira` | 400 | "No Workspace Selected · Jira can only be added as an additional source on an existing workspace — open Settings on the workspace you want to add it to, then try again." |
| `GET /auth/jira/oauth?mode=new` | 302 | `auth.atlassian.com/authorize?…scope=read:jira-work write:jira-work read:jira-user offline_access…` |
| `GET /auth/linear`, `/auth/github`, `/auth/github-projects` | 302 | to the providers' consent screens |
| `GET /auth/github/callback?installation_id=1&setup_action=install` | 302 | → `/auth/github` |
| `GET /auth/email` | 200 | the form; not submitted live (see §E) |
| `GET /auth/openrouter`, `/account`, `/settings`, `/workspace/new` | 302 | → `/` |
| `GET /runner-kit/broker.mjs`, `/runner-kit/runner.mjs` | 200 | `/runner-kit/contract.json` → 404 |
| `GET /t/bogus-token` | 404 | Harbour-chrome |
| `GET /api/proxy/instructions`, `/api/proxy/runner/prompt` | 401 | no token |

**Link sweep.** I swept 163 unique URLs: the 129 `<loc>` entries in `/sitemap.xml`, the hrefs on `/`, `/library`, `/swipe`, `/swim`, `/privacy`, `/terms`, `/archive/1`, `/archive/2`, `/getting-started`, `/templates` and `/kpis`, and every `https://harbour.cat/…` in `/getting-started.md`.
- 153 → 200.
- 4 OAuth/OpenRouter doors → 302.
- `/api/proxy/instructions` → 401 (documented as needing a token).
- The 5 others were my extractor keeping trailing prose punctuation (`/llms.txt:`, `/swipe,`, `/workspace/<urlKey`). They are not real links.
- No dead link was found. `/sitemap.xml` lists `/getting-started`.

## A2. Live hosted Local door, walked and removed (J6, J12, J13, J14, J11)

| Step | Status | Notes |
|---|---|---|
| `GET /swipe` → `POST /workspace/new` (nav form, `Origin` set) | 302 | → `/workspace/local-workspace-648f52d4/` |
| first screen | 200 | "Your workspace is ready. Add your own task to get started — the welcome tasks are just a starting point." Seed: "Welcome to your local workspace" (◐ In Progress). Nav add rows: `+ Linear` → `/auth/linear`, `+ GitHub Issues` → `/auth/github?heldConnection=1`, **`+ Jira` → `/auth/jira/oauth?mode=new`**, `+local workspace`. Footer `ai: ● free`. No runner link on Home. |
| `GET …/settings` › Sources | 200 | "Add a source": Linear ("connects another Linear organization as its own workspace"), GitHub Issues, **GitHub Projects** ("adds a source onto this workspace"), and Jira with two buttons, **API token** and **OAuth**. "Only sources this server can add are listed." |
| `POST …/settings/providers/add provider=jira authType=basic` | 302 | → `/auth/jira?workspace=local-workspace-648f52d4` → 200 "Connect Jira" form (site, email, API token) |
| `POST …/settings/providers/add provider=jira authType=oauth` | 302 | → `/auth/jira/oauth?mode=add-source&workspace=…` |
| `POST …/settings/providers/add provider=github-projects` | 302 | → `/auth/github-projects?mode=add-source&workspace=…&heldConnection=1` |
| `POST /auth/jira/link` (site `https://cold-start-review-nonexistent-0000.atlassian.net`, fake email and token) | 400 | form re-rendered: "Could not authenticate with Jira. Check the email, API token, and site URL and try again." |
| `GET …/proxy` | 200 | Header: **"Let AI agents interact with Linear through secure proxy tokens"**. Hint: "…credentials to interact with **Linear**." Examples include `…/api/proxy/issues/LIN-123`. Scope picker: read-only / read-write / read-write + dispatch. |
| "generate & copy" (`POST …/api/proxy/tokens {label:"agent-prompt",scope:"readWrite",bootstrap:true}`, the body `public/proxy.js` sends) | 201 | `providerDisplayName: "Local"`, `kind: bootstrap`, `singleUse: true` |
| the copied prompt (rendered with `buildAgentPrompt` from `public/proxy.js`) | — | "You have access to a workspace API proxy (source-neutral; currently backed by Local)… First, exchange your single-use bootstrap…" then `/instructions`. "It cannot enqueue work: the dispatch routes return 403 `DISPATCH_GRANT_REQUIRED`." |
| agent follows it: `POST /api/proxy/token` | 200 | working token, `readWrite`, 48 h |
| `GET /api/proxy/instructions` | 200 | 127,834 B. The `POST /issues` text names GitHub and Local field limits and does not mention Jira. |
| task page `LOCAL-2` (Playwright render) | 200 | "Write the prompt for this task." / "✦ Write the prompt" / "Harbour can also run steps for you, on your own machine. **Set up a runner ›**" |
| press "✦ Write the prompt" | 200 | `GET …/api/prompt/<id>/plan` answered at 823 ms. The section shows "Plan · generated just now · Copy prompt", and the prompt opens "# Plan LOCAL-2: Add your own tasks". No OAuth, no OpenRouter key. |
| `…/settings/running` | 200 | "Runner · Set up a runner · No runner yet. Run buttons appear for the workspace owner once one is set up." Queue → `Dispatch ›` (`/workspace/<key>/dispatch`). |
| `…/dispatch` (no runner key) | 200 | Reachable by URL and by Settings › Running. Not in the nav. Tokens: "Run on your own machine instead: set up a runner ›", "new token: generate", "Queue tokens are listed with every other key…". |
| Settings › Account / Agent access / Features | 200 | Copy mentions "every workspace you're a member of — even work triggered by another member", "For everyone in Local Workspace", "Any member can, and each change is logged". No invite or add-member control on any settings page. |
| `POST …/api/task/LOCAL-2/share` | 201 | `/t/<redacted>` |
| no-cookie `GET /t/<token>` | 200 | `x-robots-tag: noindex`, `referrer-policy: no-referrer`, `cache-control: private, no-store`. Shows "Nothing has run on this task yet." Links point into `/workspace/local-workspace-648f52d4/…`. |
| no-cookie `GET /workspace/local-workspace-648f52d4/`, `…/task/LOCAL-1` | 302 | → `/` (the guest's onward path; LIN-3065's mechanism for any cookie-less visitor) |
| cleanup: `POST /workspace/local-workspace-648f52d4/remove` | 302 | Afterwards the owner jar gets 302 `/`, the share token 404, and the working proxy token 401. |

## B. Fresh clone `da5df707d`, README literally (J3)

`git clone` → `cp .env.example .env` → `npm install`:
```
npm warn EBADENGINE Unsupported engine { package: 'harbour@1.0.0', required: { node: '24' }, current: { node: 'v25.9.0', npm: '11.12.1' } }
added 112 packages, and audited 113 packages in 722ms
7 vulnerabilities (2 moderate, 4 high, 1 critical)
```
`npx playwright install` → exit 0. It downloaded WebKit 26.0; the other browsers were cached.

`npm start` with a clean environment:
```
Warning: Missing OAuth environment variables: LINEAR_CLIENT_ID, LINEAR_CLIENT_SECRET
Warning: OPENROUTER_API_KEY is set but empty/whitespace — it will be treated as unset.
Email sign-in: off
Harbour running at http://localhost:3000
```

| Request (no cookie) | Status | Notes |
|---|---|---|
| `GET /` | 200 | The only hero door is "Log in with Linear", plus the agent-prompt block with `http://localhost:3000/getting-started.md` (BASE_URL correct) and the `LINEAR_ACCESS_TOKEN` callout |
| `GET /auth/linear` | **503** | "Linear sign-in is not set up · Signing in with Linear is not available on this Harbour yet. Try another way to sign in, or come back later." (branded; run #3 saw "OAuth Not Configured — … Missing environment variables …") |
| `GET /auth/github`, `/auth/jira/oauth?mode=new` | 503 | the same branded page per provider; neither is advertised on this landing |
| `GET /auth/jira` | 400 | the same "add it to an existing workspace" page as live |
| `GET /auth/email` | 503 | "Email sign-in isn't available on this server." |
| `GET /getting-started.md` | 200 | Identical to live after swapping the base URL, except for two differences. Only `[Log in with Linear](http://localhost:3000/auth/linear)` is listed as a door, and that door 503s. The free-tier line reads "This deployment has no free tier, so writing prompts needs the person's own OpenRouter key." |
| `GET /login`, `/docs` | 404 | bare |

## C. Fresh clone, repo scripts (J4)

- `npm run setup` → exit 0.
- `npm run env:check` → **exit 0**. It prints "⚠️ ACTION REQUIRED … 1. Install Playwright browsers → npx playwright install chromium --with-deps", lists "Optional … Set SESSION_SECRET" (`.env` holds the example value), "✓ Node.js 25.9.0 (≥24 required)", and "Status: 1 issue(s) to fix before proceeding".
- Meanwhile `~/Library/Caches/ms-playwright/` holds `chromium-1181/1200/1208/1228`.
- `scripts/env-check.sh` is 162 lines, with 0 `exit` and cache checks only for `$HOME/.cache/ms-playwright` and `/ms-playwright`.
- `.claude/settings.json` `SessionStart` still runs `npm run setup`.

## D. Fresh clone, self-host local workspace and runner (J8, J10, J13, J14)

| Step | Status | Notes |
|---|---|---|
| `POST /workspace/new` | 302 | → `/workspace/local-workspace-1b1b3805/` |
| nav add rows | — | `+ Linear` (→ 503) and `+local workspace`. **No `+ Jira`.** |
| Settings › Sources | 200 | "Add a source": Linear ("add") and Jira ("API token"). "Only sources this server can add are listed." |
| `POST …/settings/providers/add provider=linear` | 302 | → `/auth/linear?mode=add-source&workspace=…` → **503** |
| `POST …/settings/providers/add provider=jira authType=basic` → `POST /auth/jira/link` (fake) | 302 → 400 | the same honest "Could not authenticate with Jira…" |
| task page `LOCAL-2` | 200 | idle · "Harbour can also run steps for you, on your own machine. Set up a runner ›". Description: "Use the "+ Add task" affordance, **the Linear API proxy**, or the CLI to create issues." |
| `/workspace/<key>/runner` | 200 | `data-state="owner"`. Title "Run on my machine". "…runs each item in its own subagent, on your machine, **with no Simple Dispatcher**." Preconditions: Claude Code only, Node 18+, macOS or Linux, 1 h bootstrap, 24 h credential. §3 rule 1: a different consumer ("a Simple Dispatcher") that polled the workspace recently means `abort`. |
| `POST …/api/proxy/tokens {runner:true}` | 201 | bootstrap with `grants: [take, dispatch]`, `lifetimeProfile: runner`, 1 h |
| served prompt §1 run as written (`HOME` set to a scratch directory; the credential block built in the format of `public/runner-setup.js`) | — | fetch kit → **`kit ok`** → `recover` (all lists empty) → `login` (`ok: true`, take+dispatch, 24 h) → `poll` (no decisions) |
| task page after login (Playwright) | 200 | "Set up a runner ›" is gone. Run control: "Next step · Harbour picks the next step when you press Next step… / Runs on Claude Code's own model · your runner · Change / **Next step · Run to PR · Run to Done** · Another step ▾". Nav gains `live console` and `dispatch` (LIN-3849). |
| press **Next step** (no AI on this server: `aiState: "unconfigured"`) | **503** | `GET …/api/recommend/<id>/stream` → 503. The UI shows "AI Recommend · generating…" with a spinner and "Loading…", still unchanged after 8 s. It offers no message and no fallback. |
| press **Run to PR** | — | "Started." → `poll` decided **`take`** (`confirmed`, `kind: autopilot`, `Autopilot — LOCAL-2`) |
| `runner take` (scratch `HOME` of 150+ chars) | — | `[failed] runner could not start this item's broker (… socket path too long for sun_path (209 > 103 bytes) …)`. This is an artifact of my long scratch `HOME`, recorded as information only. |
| task page after that failure | 200 | The header still reads "idle · No sessions yet.", while Stages shows "Kick-off · failed · started 28s ago" and "Sessions on one clock: 1 session". |
| re-dispatch (Run to PR) → `poll` → `take` with a short `HOME` | — | `take` printed `item`, `handoff {mode:new}`, `subagent`, `broker {socket, pid}`, an `environment` block (`HARBOUR_LOCAL_BASE=http://harbour-runner.invalid` plus `--unix-socket …`) and a **72,491-byte Autopilot prompt** |
| broker channel: `curl --unix-socket … /api/proxy/issues/LOCAL-2` | 200 | the issue JSON, with no token held |
| `runner feedback <id> status "[failed] … review probe … no subagent launched"` | — | `posted: true`, `state: done`. The broker had already exited (`stop-broker` found nothing). |
| subagent | not launched | A subagent would need a real repo, CI and a PR to reach "verify". That is out of scope for a review-only run. |
| Settings › Agent access | 200 | The runner key and the dispatch bootstraps are listed. "New key": Read or Read and update only. "Keys that can start runs are minted by the workspace owner only, from the agent prompt." |
| `/workspace/<key>/dispatch` | 200 | "Tokens · Run on your own machine instead: set up a runner › · new token: generate"; then the integration guide (`/api/dispatch/poll`, `take`, `feedback`) |

## D2. Fresh clone, test mode, the fake-Jira harness (J13 downstream; a reach)

The second server ran with `NODE_ENV=test PORT=3011`. `POST /test/set-jira-session {}` returned `{"ok":true,"urlKey":"jira-workspace","site":"https://acme.atlassian.net"}`. That route seeds `tests/fixtures/jira-harness.js`'s in-memory fake Jira through the real provider. It is a simulation: no Jira site was contacted.

| Step | Status | Notes |
|---|---|---|
| Home | 200 | First-visit card: "Open a task and Harbour writes a prompt for its next step. Paste it into Claude Code, Codex or any coding agent…". Jira issues listed under Running and Up next. Nav add rows: `+ Linear`, `+local workspace`. |
| Backlog `+ Add task` | — | `https://acme.atlassian.net/secure/CreateIssue!default.jspa`, Jira's own create dialog (it leaves Harbour) |
| Proxy page | 200 | the same "interact with **Linear**" header and hint, and the `LIN-123` example |
| agent prompt mint | 201 | `providerDisplayName: "Jira"` |
| `POST /api/proxy/issues {title, description}` | **422** | `{"error":"This workspace's provider does not support this","code":"CAPABILITY_NOT_SUPPORTED","capability":"createIssue","provider":"jira"}` |
| Settings › Running → turn on Periodic reviews (with a reason) | 302 | `?changed=1`. Home showed no periodical row without a runner. |
| `purpose:"agent"` mint → `POST /api/proxy/periodicals/documentation-review/mint {}` | **201** | `status: queued`, with the warning "No consumer has ever polled this workspace…". There is no caveat that the review's follow-on step needs to create an issue. |

## E. Fresh clone with `EMAIL_TRANSPORT=console` (J9, R3-4)

- The third server ran with `PORT=3012` and logged `Email sign-in: console`.
- `grep GLOBAL_MAX|global-ceiling` over `lib/email-auth.js` and `routes/email-auth.js` → no match (LIN-3789).
- Twelve sends, each from a fresh cookie jar, with a 3.2 s wait and a fresh nonce, to `cold-start-<n>@example.invalid`: **200 ×10, then 429 ×2**.
- The 429 page reads "Too many sign-in emails requested, please try again later".
- The log shows 10 console sends and `[email-auth] send refused: per-ip-limit` ×2.
- No silent "check your inbox" page appeared for a refused send.
- Nothing was submitted to the production mailer.

## F. Fresh clone `simple-dispatcher` `5d8489e` (R1)

- `npm install` → exit 0.
- `env -i PATH=… node dispatcher.js` → "Simple Dispatcher starting… API: http://localhost:3000 …", then `Failed to load workspaces.json: ENOENT …` → exit 1.
- There is no example file.
- `README.md` explains `workspaces.json` at "Create a `workspaces.json` file…" (line 223 of 415). It says "Tokens are created in LinearViewer's workspace settings."
- The README never names the in-repo runner kit or the Runner setup page.

## G. Housekeeping

- All three scratch servers were stopped.
- The short scratch `HOME` used for the second `take` was deleted.
- The live workspace was removed (§A2), and its keys and share link stopped working.
- No production email was sent.
