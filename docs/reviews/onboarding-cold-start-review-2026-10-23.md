# Onboarding & Cold-Start Review — 2026-10-23 (run 3, trend vs 2026-09-26)

**Status: run 3.** This is the third report in the series. It compares every journey step with run #2 (`docs/reviews/onboarding-cold-start-review-2026-09-26.md`, LIN-3106, PR #1592). Run #2 itself trended against the baseline (`…-2026-08-29.md`, LIN-2382). No later `onboarding-*` report existed when this run started.

**Grounded at:**
- `LinearViewer` `origin/main` `661124c1`, which is 1,171 commits after run #2's pin `b5c528c4`.
- Live `https://harbour.cat`, whose footer showed `578aa0d`. That is one commit behind `661124c1`, and the gap is a docs-only review.
- `simple-dispatcher` `origin/main` `bb1da78`, 61 commits after run #2's `3b1e734`.

**How the evidence was gathered.** This is a **performed** review. Every journey below was attempted this run:
- live HTTP probes against `harbour.cat`;
- fresh `git clone`s of both repos, run from a scratch directory with no `.env` from the dispatch workspace;
- the zero-credential Local door on the live site, walked and then removed.

The status-by-status transcript is in `docs/reviews/_evidence-2026-10-23/onboarding-cold-start-walk.md` (sections A–F, cited below as §A–§F).

**Headline.** For the first time in this series, a cold journey got past "ground" without any third-party credential. The path is hosted `/swipe` → `+ local workspace`. It leads to a free-tier, AI-routed grounded prompt in about 1.6 s, with no OAuth and no OpenRouter key. On a self-host the same door went further: it dispatched a task and stood up the new own-session runner as far as a `take` decision.

The product does not point anyone at this path. The landing's "try it yourself" block says *"Log in and try…"* and contains no control. The provider list is plain text. `/llms.txt` names no way in.

Every other journey still gates before the frozen destination, as in run #2. The highest-severity objective defect is still run #2's top finding, `scripts/env-check.sh` (LIN-2386).

**What production says (added after the adversarial second-read, §9).** The public `/kpis` page publishes a cross-account onboarding funnel (LIN-2952, `41b165b2`). For the last 30 days it shows **fewer than 5 sign-ups, fewer than 5 connected, and 0 first Go presses, 0 PRs opened, 0 merges** (R3-17). So the improvements above are improvements in *reachability*, shown by synthetic walks. No real newcomer in the window got past "connected", which is exactly where the walks found the best path unadvertised (R3-6).

---

## 1 · Frozen destination

This run freezes the **live landing claim**, unchanged from both earlier runs:

> **"Harbour keeps human intent in command of AI execution, one turn of the loop at a time."**
> — `lib/render-landing.js:341` (was `:306` at run #2). The live page title is now *"Harbour — keep human intent in command of AI execution"*, and the hero h1 reads *"Keep human intent in command of AI execution"*.

**Why this sentence.** It is the purpose a cold visitor actually reads, and it has not changed across three runs, which keeps the ledger mechanically comparable. *Used as intended* still means reaching the four advertised loop steps on the live product: read the backlog → ground a prompt → dispatch to an agent → verify on evidence.

**Purpose divergences.** All are recorded; none is re-picked as the destination:

- **north-star v3** (`docs/north-star.md:5`) still opens *"…meets a developer where they are, completes verified backlog work … funds itself doing it — and proves every word."* **Delta: unchanged.**
- **`docs/v1.md`'s 8-step promise** (`:43-50`) is now partly built, and the doc has not caught up. `docs/v1.md:107` still says *"Email login does not exist in code … Build it."* In fact LIN-1892 is Done and the live landing advertises and serves email sign-in (§3 J9). **Delta: worsened as a document (stale against the product); improved as a product.** The full check is at §3 v1.
- **D1.** `README.md:3` and `/llms.txt:3` both still describe *"a … web app that displays your projects and issues as a collapsible tree"*. **Delta: unchanged.** Live `/llms.txt` is byte-identical to `public/llms.txt` at HEAD (§A).
- **New this run: the incident doc and the task brief both lag the live state.** `docs/incidents/2026-10-22-railway-security-disclosure.md:4` says *"Email sign-in is switched off until LIN-3771 lands."* LIN-3771 landed and was deployed. Its close-out records `EMAIL_TRANSPORT` being deleted and `/auth/email` going `503 → 200` at about 10:35Z today. This run's own task description repeated the "switched off" premise. The walk found the door **on**. This is recorded as a reach (§5), not a product defect. The doc itself belongs to the Documentation Review's altitude.

---

## 2 · Scope: journey inventory

**How the scope was widened.** The scope was treated as a floor and widened by search, not by memory:

1. `git diff --name-status b5c528c4 661124c1 -- routes/` lists 14 new route files.
2. Grepping the added `router.get|post` / `app.get` lines for paths outside `/workspace`, `/api/proxy` and `/test` gives the new unauthenticated doors.
3. Every href on `/`, `/library`, `/swipe`, `/privacy`, `/terms` and `/archive/1`, plus every `<loc>` in `/sitemap.xml`, was fetched (132 URLs, §A).

| # | Path / persona | Status this run |
|---|---|---|
| J1 | Hosted visitor → OAuth sign-in strip | ✅ live probe |
| J2 | Advertised vs. reachable backends | ✅ live probe and source check |
| J3 | Self-hoster following the README literally | ✅ fresh clone `661124c1` |
| J4 | Self-hoster using `npm run setup` / `env:check` | ✅ fresh clone |
| J5a | Broker-delivered bootstrap | ✅ this session is the evidence |
| J5b | Standalone bootstrap exchange | ✅ live 401s and doc re-read |
| J6 | Free-tier first useful action | ✅ **live, via the hosted Local door (new route to it)** |
| J7 | Pre-auth public surfaces, now including Library, sitemap, robots and `llms.txt` | ✅ live probe and link sweep |
| J8 | Headless agent / local self-hoster, now including the first screen (LIN-2944) | ✅ fresh clone and live hosted |
| **J9** | **Email magic-link sign-in (new)** | ✅ live door; inbox gated. Self-host end-to-end with `console`. |
| **J10** | **Own-session runner (new; LIN-3098 Done)** | ✅ fresh clone, run up to `poll → take`; hosted to the page's `owner` state |
| **J11** | **Guest share link `/t/:token` (new; LIN-3330)** | ✅ fresh clone, cold guest; live bogus-token 404 |
| R1 | `simple-dispatcher` seam | ✅ fresh clone `bb1da78` |
| D1 | Destination divergence | cross-cutting |
| v1 | v1-promise check | ✅ live and self-host |

**Scope decisions:**
- **J10 joins the inventory.** Run #2 left the own-session runner out only because no product existed (its §2). LIN-3098 shipped the served prompt, the setup page and the public kit, and this run walked them, so the runner is now a consumer entry path.
- **Library, crawler files and `/llms.txt`** fold into **J7**. They are public read surfaces, not doors.
- **The first screen and starter seed** (LIN-2944, LIN-3279) fold into **J8**. LIN-3279 turned out to be about agent-filed starter tickets, not the local-workspace seed, so it does not touch the cold path.
- **Landing copy (LIN-2392)** is re-walked under **J2/J6**.

**Considered and bounded out (not separate cold doors):**
- `/auth/email/register` and `/auth/email/reproof` redirect to `/` without `req.session.accountId` (`routes/email-auth.js:393-416`).
- `/connect/:provider/held` is a post-OAuth picker driven by `req.session.heldEntry` (`routes/held-connection.js:1-35`).
- `/account` returns `302 /` for a cold visitor.
- `/workspace/:urlKey/api/milestone-funnel` is session-gated (§5 telemetry).
- `/auth/github-projects` answers live with a 302 to GitHub but no surface links to it (J2).

**Zero state:** no account, no `.env`, no token, no prior session. Every self-host leg ran in a fresh clone in a scratch directory. One caveat is the opposite of run #2's: the npm cache and `~/Library/Caches/ms-playwright` were already warm, so install times here say nothing about a genuinely cold machine.

---

## 3 · Journey-by-journey walk log

Each step is recorded as *proceeded*, *had to guess*, *hard-blocked* or *capability-gated*. The delta compares it with run #2.

### J1: Hosted visitor, OAuth sign-in strip
`/` → 200. Linear, GitHub and Jira each redirect correctly with a 302 to their consent screens (§A). The scopes are unchanged from run #2. **Verdict:** proceeded, then capability-gated at consent. **Destination:** NO (gated). **Delta:** unchanged.

### J2: Advertised vs. reachable backends
`landing-providers` still lists five backends as text with **0 `<a>`** (§A):
- **GitHub Projects** still declares no entry CTA (`lib/providers/github-projects/index.js:618`). `/auth/github-projects` does answer live with a 302 to the GitHub App, but no surface links to it. In-workspace "add source" rows for a signed-in Local visitor offer Linear, GitHub Issues and Jira, not Projects (§A2).
- **Local** is still reachable only through the nav form on the preview pages: `/` → footer "swipe" → `+ local workspace` (`lib/components/navbar.js:108`; the line has moved from `:97-99`).

**Verdict:** GitHub Projects hard-blocked from a cold surface; Local had to guess; the other three proceeded. **Destination:** NO. **Delta:** unchanged (LIN-2387, Todo). LIN-2392's copy rewrite changed the wording, not the reachability.

### J3: Self-hoster following the README literally (fresh clone `661124c1`)
`cp .env.example .env` → `npm install` → `npx playwright install` → `npm start` → *"Harbour running at http://localhost:3000"*. The startup warnings now include `OPENROUTER_API_KEY is set but empty/whitespace` and `Email sign-in: off` (§B). The first warning is caused by the shipped `.env.example:97` itself. It predates run #2 (`852f5534`, LIN-961) but was not logged then.

On `/`, the only hero CTA is "Log in with Linear", and **`/auth/linear` → 503 "OAuth Not Configured"**. The email door, by contrast, hides its CTA and answers an honest 503 *"Email sign-in isn't available on this server"*. So the one predicate (`lib/email-availability.js`) does what the Linear CTA (`lib/providers/linear/index.js:2362`, `isConfigured: () => true`) still does not.

**Verdict:** proceeded; the zero-credential Linear CTA still 503s. **Destination:** NO. **Delta:** unchanged (LIN-3108, Backlog). The email half is new and clean.

### J4: Self-hoster using the repo's scripts
`npm run setup` → exit 0. `npm run env:check` → **exit 0** while printing *"Status: 1 issue(s) to fix"* and a false `Install Playwright browsers` blocker, even though `~/Library/Caches/ms-playwright/chromium-1200/INSTALLATION_COMPLETE` exists. `scripts/env-check.sh` is still 154 lines with zero `exit` and no macOS path. `.claude/settings.json` `SessionStart` still runs `npm run setup` (§C). The script was last touched by `51a90689` (LIN-646), before run #2.

**Verdict:** had to guess (the macOS path); hard-blocked as an enforcement mechanism. **Destination:** NO. **Delta:** unchanged (LIN-2386, Backlog). This is the third consecutive run with this finding.

### J5a: Broker-delivered bootstrap
This claude-code session received `HARBOUR_LOCAL_BASE` and called the local proxy tokenlessly, and the dispatch prompt carried no prose credential. A grant-less call to `/api/proxy/runner/prompt` returns a clear `403 TAKE_GRANT_REQUIRED` (§A). **Verdict:** informational, proceeded. **Delta:** unchanged shape.

### J5b: Standalone bootstrap exchange
`docs/proxy-integration.md` Quick Start now forward-points to Bootstrap Tokens and to runner copies (`:43-45`). That closes run #2's ordering trap (R2-9). The live probes are unchanged: `/api/proxy/instructions` without a header → 401 `PROXY_TOKEN_INVALID`, and `POST /api/proxy/token` with a fake bearer → 401 *"already-exchanged bootstrap token"*. So `/instructions` is still 401-gated, which is circular for a newcomer, but the doc now carries the reader. **Verdict:** proceeded (was had to guess). Minting a genuine bootstrap is capability-gated. **Delta: improved.**

### J6: Free-tier first useful action
**Through the advertised route (unchanged).** `landing-try` (`lib/render-landing.js:177,184`) still says *"Log in and try AI Generated Prompts free"* with 0 `<a>`, 0 `<button>` and 0 `<form>`. "Log in" has to be inferred as one of the OAuth CTAs, which then gate at consent.

**Through the hosted Local door (new route, walked live, §A2).** `/swipe` → `+ local workspace` gives an anonymous workspace whose first screen reports `aiState: "ready", freeTier: true`. `GET …/api/prompt/<id>/research` returned the grounded template (200, 11.6 KB). `GET …/api/recommend/<id>/stream` streamed an AI-routed recommendation in **1.58 s** with **no OAuth and no OpenRouter key**. The workspace was then removed.

This run did not establish whether the anonymous free tier is new since run #2 or whether run #2 simply never tried Local on the hosted site. Either way, it is the first walk in this series to reach "ground a prompt" cold.

**Verdict:** the advertised route had to guess, then capability-gated. The zero-credential route **proceeded**, but nothing on the try-it block points to it. **Destination:** loop steps 1 and 2 (read, ground) reached on the live product; steps 3 and 4 not attempted live. **Delta: improved (new reachable route); copy unchanged.**

### J7: Pre-auth public surfaces
All of these return 200: `/`, `/library`, `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/kpis`, `/styleguide`, `/templates`, `/privacy`, `/terms`, `/health`, `/swipe`, `/swim`, `/ship`, `/archive/1`, **`/archive/8` (404 in run #2)**, and `/runner-kit/{broker,runner}.mjs`.

`/login` and `/docs` still return 404 with a bare `Cannot GET`. `/t/<bogus>` returns a Harbour-chrome 404.

The **link sweep** fetched 132 URLs (sitemap plus page hrefs), and **all resolve** (§A). The landing now links six Library pieces and the Archive.

`/llms.txt` (95 KB, agent-facing) documents `/library`, `/templates`, the runner link and `/t/{token}` (`:290`). It names **no way in**: no `/auth/*`, no `/auth/email`, no `POST /workspace/new`.

**Verdict:** proceeded. **Delta: widened** (Library, sitemap, robots, runner kit, `/archive/8` resolved). The `llms.txt` "no way in" observation is new to the ledger.

### J8: Headless agent / local self-hoster (fresh clone, plus hosted §A2)
1. `POST /workspace/new` → 302 + `connect.sid`. **Had to guess** for a doc-driven agent: the route still appears in no README, `proxy-integration.md` or `llms.txt` text. A browser user meets it as `+ local workspace`, and after an email sign-in it is now also a button on `/account` (§E). **Unchanged (refines LIN-3058).**
2. **First screen (LIN-2944): improved.** A hint now reads *"Your workspace is ready. Add your own task to get started — the welcome tasks are just a starting point."* (`lib/render.js:248`), and swipe demotes seed cards behind real ones (`lib/render-swipe.js:500-509`). The seed itself is unchanged: "Welcome to your local workspace" is still **In Progress** (`lib/starter-seed.js:13-17`). The project blurb still says *"Edit or add issues via the API/CLI for now"* right above a working `+ Add task`. LIN-3069's roadmap and next-run leg was not exercised (OpenRouter on self-host). **Partial improvement; LIN-3069 stays open.**
3. No-cookie re-entry `GET /workspace/<key>/` → `302 /`, both on the self-host and live. **Hard-blocked, unchanged (LIN-3065).** This now also holds **through an email account**: a second sign-in as the same address does not list or open the account's local workspace (§E). The `/account` copy says so honestly ("Workspaces don't follow you to a new device yet"), which matches LIN-3141.
4. Enable a feature with `POST settings/features` (form-encoded, with an `Origin` header) → 302. **Had to guess** (no doc), unchanged.
5. **Dispatch a local issue: `POST /workspace/:key/api/dispatch` → 201 (§D). LIN-3068 does not reproduce.** The UUID check run #2 cited at `lib/dispatch-validation.js:224-226` is gone. `issueId` is now checked by `isValidIssueId` (`lib/dispatch-validation.js:267` → `lib/workspace.js:84-88`, `/^#?[A-Za-z0-9-]{1,100}$/`), relaxed by LIN-3440 (`4563046c`, Done). The response carries a useful warning: *"No consumer has ever polled this workspace…"*. **Resolved** in the walk; the ticket is still Backlog (§6).
6. Mint a token with `POST /workspace/:key/api/proxy/tokens`. **Proceeded (documented)**, unchanged.

**Credential surfaces (LIN-3059, Done).** The walk still crosses the `connect.sid` cookie → a bootstrap → a working token. The working token now carries `take` and `dispatch` together (§D), so one agent credential is real for the runner lane. The session-only routes (feature toggle, share mint) remain session-only. **Improved; confirmed in the walk.**

**Destination (self-host):** read, ground (template) and **dispatch** reached zero-credential; verify not reached. **Delta: improved** (dispatch now reachable).

### J9: Email magic-link sign-in (new)
- **Hosted.** Three doors advertise it: hero `Continue with email` (`lib/components/landing-hero.js:69`), nav `Email →` (`lib/components/navbar.js:100`) on `/swipe`, `/swim` and `/ship`, and the form at `/auth/email`. All render live. The form carries a nonce and the honeypot `website` from LIN-3771 (§A). The task brief expected the door to be switched off and still advertised. It is **on**, which is consistent: the CTAs and routes share one predicate (`lib/email-availability.js`), so it is never advertised-while-off.
  - **Not submitted.** This run did not add a send to a production mailer still under LIN-3771's 24–48 h spam watch, and the inbox is human-held, so the confirm leg is **capability-gated**.
  - **Source-confirmed hazard, already ticketed.** The site-wide `global-ceiling` (`EMAIL_SEND_GLOBAL_MAX = 10` per rolling hour, `lib/email-auth.js:51`, applied at `routes/email-auth.js:495`) refuses every further send silently, with the same "check your inbox" page. A real cold visitor arriving after a burst would get no email and no explanation. That is **LIN-3789** (In Progress), cited rather than minted.
- **Self-host.** With email unconfigured, the CTAs are hidden and `/auth/email` answers an honest 503 (§B). With the README's dev opt-in `EMAIL_TRANSPORT=console`, the full loop **proceeded**: form → "Check your inbox" → link in the server log → "Sign in as …?" → `POST confirm` → `302 /account` → *Connect Linear* / *Create a local workspace* (§E). `Connect Linear` leads to LIN-3108's 503 again.

**Verdict:** hosted door proceeded, then capability-gated at the inbox. Self-host proceeded end-to-end. **Destination:** sign-in reached on the self-host; the loop beyond it is as in J8. **Delta: new journey.** It resolves run #2's v1 row "email not advertised, not reachable".

### J10: Own-session runner (new; LIN-3098)
- **Self-host, walked:**
  1. `/workspace/:key/runner` → 200 with `data-state="owner"`. The local workspace's anonymous account is its owner. The page states its preconditions plainly: Claude Code only, Node 18+, macOS or Linux, 1 h bootstrap, 24 h credential, the same-user boundary.
  2. `POST …/api/proxy/tokens {runner:true}` → 201 bootstrap with `[take, dispatch]`.
  3. The served prompt (`/api/proxy/runner/prompt`, 15.9 KB) §1 was run **as written**, with `HOME` set to a scratch directory: fetch kit → **`kit ok`** (the live kit hashes match HEAD) → `recover` → `login` (`ok: true`) → **`poll` decided `take` (`confirmed`) on the dispatched local item**.
  4. `take` was not run, because it would launch a subagent, which is outside a review-only scope.
- **Hosted.** The live Local workspace reached the page in `owner-dispatch-off`, and enabling dispatch flipped it to `owner` (§A2). No mint was made on production.
- **Reaches and friction:**
  - The page's mint button builds the credential block client-side (`public/runner-setup.js:34-46`). This walk had to read that file to reproduce it with curl. A browser user just presses copy.
  - Exchanging the bootstrap by hand, as J5b teaches, spends it before `runner login` can. That cost this walk one mint (reach 3, §5).

**Verdict:** proceeded through every step attempted, zero-credential on a self-host. **Destination:** dispatch, plus a runner ready to take. "Verify on evidence" needs a real subagent run against a repo and PR, which was not attempted. **Delta: new journey.** Run #2 ruled it out of remit; it is now walkable.

### J11: Guest share link (new; LIN-3330)
- **Owner side (self-host).** The task page has a "Share this task / Create share link" slot. `POST …/api/task/LOCAL-2/share` → 201 `/t/<token>`.
- **Cold guest (no cookie).** `GET /t/<token>` → 200 with `noindex`, `no-referrer` and `no-store`. It shows the task, the live stage track ("Research queued, waiting for a worker"), the description and details, with no owner controls. `/state` → 200 (§D).
- **The seam toward sign-up.** Every Harbour link on the guest page (nav brand, swipe, swim, observation, settings, kpis, `← back to tasks`, the parent task) points into the owner's `/workspace/<key>/…`, and each **302s the guest to the landing with no message**. This is a recorded design decision ("Links back into Harbour stay for every viewer", `lib/render-task-page.js:34-36`; `/llms.txt:290`). It is not breakage. The effect is that the guest's only route toward signing up is an unexplained bounce to `/`, where the hero CTAs are. Nothing on the guest page says "this is Harbour — get your own".
- **Live.** A bogus token gives the Harbour-chrome 404 with a single "Go back" link. Its rendering is the Design Review's finding (LIN-3747), not re-flagged here. Minting a real share on production needs an owner session (capability-gated).

**Verdict:** proceeded (guest view); had to guess (the onward path). **Destination:** n/a for the guest, who is a viewer. **Delta: new journey.**

### R1: `simple-dispatcher` seam (fresh clone `bb1da78`)
`npm install` (5 packages) → `node dispatcher.js` in a clean env → `Failed to load workspaces.json: ENOENT` → exit 1. Still no example file; the explanation sits at `README.md:196`, roughly 150 lines below §Setup. The poll leg is capability-gated (dispatch token). The runner prompt adds a coexistence rule worth knowing: `poll` prints `abort` if a Simple Dispatcher polled the same workspace in the last 10 minutes, so the two consumers are mutually exclusive per workspace. **Verdict:** unchanged friction. **Delta:** unchanged. LIN-2249 stays resolved.

### v1: v1-promise check (`docs/v1.md:43-50`)

| v1 step | Advertised live | Reachable cold | Delta vs run #2 |
|---|---|---|---|
| 1 Log in with email | **yes** (3 doors) | **yes**: form live; inbox capability-gated; end-to-end on self-host | **resolved** (was not advertised, not reachable) |
| 2 Connect GitHub + tracker | yes (OAuth CTAs) | capability-gated at consent | unchanged |
| 3 See the work | yes | **yes via Local**, zero-credential | improved (route found) |
| 4 Press Go | via "try it" copy | **grounded prompt reached live via Local**; dispatch 201 on self-host | improved |
| 5 Watch | — | the guest/owner task page shows the stage track | new |
| 6 PR with evidence | — | not reached (needs a runner subagent, repo and PR) | unchanged (gated) |
| 7 Close out | — | not reached | unchanged |
| 8 Share the link | — | **yes**: owner mint 201, guest view 200 (self-host) | **new** |

**Advertised before reachable:** no step found advertised and unreachable. Steps 6–7 are not advertised as cold-reachable. **Delta: large improvement in reachability.** Observed use has not moved: the live `/kpis` funnel shows 0 first Go presses among fewer than 5 sign-ups in 30 days (R3-17). The doc's own gap table (`docs/v1.md:107`) is now stale (§1).

---

## 4 · Findings (objective first, then advisory, each by severity)

The classification is the review contract's:
- **Objective** means a dead or broken link, a documented command that errors, a setup step that hard-blocks with no workaround, or a 404/500 mid-journey.
- **Friction** means it eventually worked, but only after guessing.

Every finding is walk-observed unless tagged *source-confirmed*.

| ID | Finding | Journey | Class | Severity | Treatment |
|---|---|---|---|---|---|
| **R3-1** | `scripts/env-check.sh` still reports a false Playwright blocker on macOS (`~/Library/Caches/ms-playwright` is never checked) and still has **no `exit`**: it returned 0 this run with "1 issue(s) to fix". `SessionStart` chains into it, so nothing can gate on it. | J4 | Objective | **High** | Cite **LIN-2386** (3rd run) |
| R3-2 | Local workspaces are not re-enterable from a new session, and an **email account does not restore them either**. A fresh cookie, or a second sign-in as the same address, gets `302 /`. *Source-confirmed corollary (§9):* today's `SESSION_SECRET` rotation (`docs/incidents/2026-10-22-railway-security-disclosure.md:69`, described there as "only … one sign-out") also made every hosted anonymous Local workspace created before it unreachable. The signed session cookie was such a workspace's only way back in (`routes/workspace.js:85-90`). | J8/J9 | Objective | Med-High | Cite **LIN-3065**; cross-device part **LIN-3141** |
| R3-3 | GitHub Projects is advertised in the provider list with no reachable cold entry. `/auth/github-projects` works live, but nothing links it, and the in-workspace add-source rows omit it. | J2 | Objective | Med | Cite **LIN-2387** |
| R3-4 | Hosted email door: the site-wide `global-ceiling` (10 sends per rolling hour) silently refuses sends behind the same "check your inbox" page, so a cold visitor after a burst gets nothing and no explanation. | J9 | Objective (*source-confirmed*; not triggered by this walk) | Med | Cite **LIN-3789** (In Progress) |
| R3-5 | A zero-credential self-host still shows "Log in with Linear", which 503s. The email door on the same server shows the right pattern (hidden CTA, honest 503). | J3 | Objective (500-class mid-journey) | Low-Med | Cite **LIN-3108** |
| R3-6 | **The best cold path is unadvertised.** Hosted Local reaches a free-tier grounded prompt with zero credentials, and on a self-host it reaches dispatch and the own-session runner. Yet the landing's try-it block says "Log in and try…" with no control, the provider list has no links, Local's door is two clicks away on `/swipe`, and `/llms.txt` names no way in. | J6/J2/J7/J8 | Friction | Med-High | Report-only (adjacent: **LIN-2387**, **LIN-3058**) |
| R3-7 | Guest share page: every Harbour link 302s the guest to `/` with no message, and nothing on the page tells a stranger what Harbour is or how to get their own. This follows a recorded design decision. | J11 | Friction | Med | Report-only (LIN-3330 decision; siblings LIN-3369, LIN-3348) |
| R3-8 | Headless discoverability: `POST /workspace/new` and `POST settings/features` appear in no doc an agent reads (README, `proxy-integration.md`, `llms.txt`). | J8 | Friction | Med | Report-only; refines **LIN-3058** |
| R3-9 | Seeded starter tasks: they are now labelled by a first-screen hint and demoted on swipe, but "Welcome…" is still **In Progress**, and the project blurb says "add issues via the API/CLI for now" above a working `+ Add task`. | J8 | Friction (partial improvement) | Low-Med | Cite **LIN-3069** |
| R3-10 | The destination docs lag the product. `docs/v1.md:107` says email "does not exist in code", and the incident doc (`:4`) says email is switched off. Both were false on the live product today. | D1/v1 | Divergence | Med | Report-only (Documentation Review altitude) |
| R3-11 | D1: `README.md:3` and `/llms.txt:3` still give the narrower "collapsible tree" purpose. | D1 | Divergence | Med | Report-only (unchanged 3 runs) |
| R3-12 | The shipped `.env.example:97` (`OPENROUTER_API_KEY=`) makes every literal-README start print a warning. | J3 | Friction | Low | Report-only |
| R3-13 | Own-session runner: hand-exchanging the bootstrap (the J5b lesson) spends it before `runner login`. Reproducing the copy without a browser means reading `public/runner-setup.js`. | J10 | Friction | Low | Report-only |
| R3-14 | `simple-dispatcher` zero-config prints `ENOENT workspaces.json` and exits 1 with no pointer; there is no example file. | R1 | Friction | Low | Report-only (unchanged) |
| R3-15 | `/login` and `/docs` return a bare 404 with no chrome; `/api/proxy/instructions` is itself 401-gated. | J7/J5b | Friction | Low | Report-only (unchanged) |
| **R3-17** | **The production funnel corroborates where newcomers stop.** Public `/kpis` ("How people get started · from sign-up to merge · 30d", `lib/render-kpis.js:283`; collector `lib/kpi-stats.js:647` → `lib/milestone-funnel.js`) shows sign-ups fewer than 5, connected fewer than 5, **first Go 0, PR opened 0, merge 0**. The sign-up count may include this run's own anonymous Local accounts (`POST /workspace/new` mints an account). *Added after the second-read (§9).* | cross-cutting | Corroboration (secondary to the walk) | Med-High (signal) | Report-only; supports R3-6 |
| R3-16 | The frozen destination is still not reached end-to-end cold. "Verify on evidence" needs a runner subagent, a repo and a PR, and every other journey gates at OAuth, inbox or consumer. Read → ground (live) and dispatch (self-host) are now reached. | cross-cutting | Capability gate | — | Report-only |

**Resolved or improved since run #2:**
- **LIN-3068 (R2-4)** does not reproduce: a local issue dispatches with 201.
- **R2-9 (J5b ordering)** is improved by the Quick Start forward pointer.
- **v1 email (R2 v1 row)** is resolved.
- **LIN-3059 (R2-15)** is Done: the walk confirms one working token carrying `take` and `dispatch`.
- **J7 `/archive/8`** now resolves.
- **LIN-3069 (R2-5)** is partially improved.

---

## 5 · Reaches, capability gates, and telemetry

**Reaches.** These are points where repo or outside knowledge directed the walk. They are logged here rather than used silently:

1. **The task brief's "email switched off" premise** came from the incident doc and was wrong by the time of the walk. The live product contradicted it, and LIN-3771's close-out (read via the proxy) explained why.
2. **The probe list** (`/login`, `/docs`, `/auth/github-projects`, `/runner-kit/*`, `/t/<bogus>`, `/connect/:provider/held`) came from source and from run #2, not from clicking the live surface. The link sweep (§A) is the surface-only cross-check, and it found no dead links.
3. **J10:** the credential-block format was read from `public/runner-setup.js:34-46`. The first bootstrap was spent by a manual J5b-style exchange and had to be re-minted (R3-13).
4. **J8/J10/J11 POST bodies and the `Origin` header** (feature toggle, dispatch, share) were read from `server.js:4254`, `routes/dispatch.js:436` and `routes/task-share.js:287`. A browser user gets them from page JS.
5. **J6:** the hosted free-tier prompt was reached by calling `…/api/prompt/…` and `…/api/recommend/…/stream` directly, with the route names taken from `public/prompt-section.js:813,858`. A browser user presses the prompt buttons on the first screen.

**Capability-gated** (marked, not guessed):
- all OAuth consent screens;
- the hosted email inbox (a send was deliberately not triggered on production; see J9);
- a genuine standalone bootstrap;
- a real share link on production (needs an owner session);
- `runner take` and a subagent run, with the PR and evidence that follow;
- LIN-3069's roadmap and next-run leg on a self-host (OpenRouter).

**Funnel telemetry (corrected at §9).** Run #2's claim that "no funnel telemetry exists" is **no longer true**. LIN-2952 (`41b165b2`, in this window) added both a per-workspace route (`GET /workspace/:urlKey/api/milestone-funnel`, session-gated) and a **public cross-account aggregate on `/kpis`**. This run's §A fetched `/kpis` (200) but did not read the funnel, and the first draft wrongly called it capability-gated. Read live on 2026-10-23: `login` and `connected` fewer than 5 (below the privacy floor), `firstGo` 0, `prOpened` 0, `mergeClicked` 0, rung entries `copy` 0 / `run-step` fewer than 5 / `run-task` fewer than 5. Per the contract it corroborates the walk and does not replace it (R3-17). Human-reported corroboration (Lighthouse, LIN-3057, Backlog) remains secondary.

---

## 6 · Follow-up tasks (objective breakage only, at most about 3)

**Minted this run: none.** Every objective finding already has a ticket. The new findings (R3-6 to R3-8, R3-12, R3-13) are friction or divergence and do not qualify under the mint rule.

**Objective findings matched to existing tickets (no mint):**
- **LIN-2386**: R3-1.
- **LIN-3065** and **LIN-3141**: R3-2.
- **LIN-2387**: R3-3.
- **LIN-3789**: R3-4.
- **LIN-3108**: R3-5.

**Housekeeping recommendation (no state change made).** **LIN-3068** no longer reproduces: the walk dispatched a local issue with 201, and the fix is LIN-3440 `4563046c`. This run posted that evidence as a comment on LIN-3068 and leaves the close to its owner.

### Duplicate search (for the candidates that might have been objective)
- **Method:** `GET /api/proxy/search` for: `guest share`, `share link guest`, `/t/ guest nav`, `guest page links`, `guest navbar`, `task share guest header`, `share link sign up`, `guest workspace links redirect`.
- **Hits:** LIN-3369, LIN-3348, LIN-3330, LIN-3373, LIN-3447, LIN-3617, LIN-3619 and LIN-3747/3749. None names the guest's onward path.
- **Why nothing was minted:** R3-7 is a recorded design decision, not breakage, so it stays report-only.
- **Email:** the email hazard was already LIN-3789 (with LIN-3771 and LIN-3777).

---

## 7 · Classes (bounded) and surface assessment

**C1, cold entry doors.** Bounded by three things: the new route files since `b5c528c4` (14), the added unauthenticated `get`/`post` lines in `server.js` and `routes/`, and every href or `<loc>` on the public pages and sitemap (132 URLs).
- **Members:** `/`, `/auth/linear`, `/auth/github`, `/auth/jira/oauth`, `/auth/github-projects` (unlinked), `/auth/email` with `/send` and `/confirm`, `POST /workspace/new` (nav form and `/account`), `/t/:token` with `/state`, `/runner-kit/:file`, `/library*`, `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/kpis`, `/styleguide`, `/templates`, `/privacy`, `/terms`, `/archive/:n`, `/swipe`, `/swim`, `/ship`, `/health`, `/api/proxy/token` and `/api/proxy/instructions`.
- **Excluded as post-auth:** `/auth/email/register`, `/auth/email/reproof`, `/connect/:provider/held` and `/account`.
- **Added at §9:** the GitHub App install return `GET /auth/github/callback?installation_id=…&setup_action=install`, a door entered from github.com rather than from Harbour. It is mounted by a runtime-built path (`router.get(callbackPath)`, `lib/github-install-flow.js:477`) and changed in this window (LIN-2882, LIN-3404). Probed live: 302 → `/auth/github`, so the door works. The consent leg is capability-gated.
- **What would have to be true for the set to be wrong:** a door mounted by a router whose path is built at runtime rather than written as a literal. The grep would miss such a door, and so would the sitemap and page sweep if nothing links it. The second-read found exactly one (above), so this check is not a formality.

**C2, personas.** Hosted visitor, cold guest, README self-hoster, scripts self-hoster, headless agent, own-session runner, Simple Dispatcher consumer, and a broker-delivered session. Each one maps to J1–J11 and R1.

**C3, run #2's tracked tickets.** LIN-2386, LIN-2387, LIN-3065, LIN-3068, LIN-3069, LIN-3058, LIN-3108, LIN-3510, LIN-3059 and LIN-1892. Each one's state is re-checked above, and LIN-3510 (Backlog) was not re-walked separately because it is landing-copy only.

**Partly bounded by production data (corrected at §9).** Where real cold visitors stop is production data, not source. Its aggregate is public on `/kpis` (§5, R3-17), but who arrives and why they stop are not observable from this seat.

`Surface Assessment: [lands cleanly]`. This is a review-only report; no code change is proposed or needed to land it.

---

## 8 · Trend ledger (every journey under its stable name)

| Step | Outcome this run | Destination reached | Severity | Delta vs 2026-09-26 |
|---|---|---|---|---|
| J1: hosted OAuth sign-in | proceeded (redirects); consent capability-gated | NO (gated) | — | unchanged |
| J2: advertised vs. reachable backends | GitHub Projects hard-blocked cold; Local had to guess; 3 proceeded | NO | Med | unchanged (LIN-2387) |
| J3: README-literal self-hoster | proceeded; Linear CTA 503 | NO | Low-Med | unchanged (LIN-3108); email door clean (new); `.env.example` warning newly logged |
| J4: repo-scripts self-hoster | had to guess; hard-blocked as enforcement | NO | High | unchanged (LIN-2386, 3rd run) |
| J5a: broker-delivered bootstrap | proceeded | gated | Informational | unchanged |
| J5b: standalone exchange | proceeded (doc forward-pointer) | gated | Low | **improved** (R2-9 closed) |
| J6: free-tier first action | advertised route had to guess, then gated; **Local route proceeded live** | **read + ground (live)** | Med-High (R3-6) | **improved** (new reachable route) |
| J7: pre-auth public surfaces | proceeded; 132-URL sweep clean | n/a | Low | **widened** (Library, crawler, runner kit; `/archive/8` resolved) |
| J8: headless / local self-hoster | guess → improved first screen → re-entry hard-blocked → guess → **dispatch 201** → proceeded | **read + ground + dispatch (self-host)** | Med-High | **improved** (LIN-3068 resolved; LIN-2944 hint; LIN-3059 Done); LIN-3065 unchanged |
| **J9: email sign-in** | hosted door proceeded, inbox gated; self-host end-to-end with `console` | sign-in (self-host) | Med (LIN-3789) | **new** |
| **J10: own-session runner** | proceeded through `poll → take` (self-host); hosted page `owner` | dispatch + runner ready | Low | **new** (out of remit in run #2) |
| **J11: guest share** | guest view proceeded; onward path had to guess | n/a (viewer) | Med (R3-7) | **new** |
| R1: simple-dispatcher seam | setup proceeded; zero-config exit 1 | n/a | Low | unchanged |
| D1: destination divergence | README and `/llms.txt` narrower; v1.md and incident doc stale | n/a | Med | unchanged; doc-lag (R3-10) **new** |
| v1: v1-promise check | 5 of 8 steps reachable cold; nothing advertised-but-unreachable | partial | — | **large improvement** |
| Funnel (secondary, `/kpis` 30d) | sign-up fewer than 5 · connected fewer than 5 · first Go 0 · PR 0 · merge 0 | NO (observed) | Med-High (signal) | **new to the ledger** (run #2 said none existed) |

---

## 9 · Adversarial Second-Read

**Tier used:** Tier 2, a fresh-context sub-agent with no memory of the report-writing turn. It received only the report path, its evidence file, the previous run's report path, both repo paths, the window (`b5c528c4..661124c1`) and the question. It was not given this session's notes or told which finding was top-ranked. It was limited to read-only GETs against `harbour.cat` and wrote no files.

**Question posed (verbatim):** *"What is the largest item in this window that this report missed or misfiled?"*

**Reader's answer (in full, lightly reformatted):**

> **1. The largest missed or misfiled item:** the public `/kpis` page shows a cross-account onboarding funnel, and the report says no such data is available to it.
>
> - **What the report says.** §5 says the LIN-2952 funnel is served only behind a session, at `GET /workspace/:urlKey/api/milestone-funnel`, and that "reading another account's funnel is capability-gated". §7 then puts "Real cold-visitor behaviour on production (who arrives, and where they stop)" under **Unbounded**, as "capability-gated".
> - **Where it was built.** The cross-account version landed inside the review window. Commit `41b165b2` (LIN-2952, "the cross-account aggregate, the chart, docs") adds `collectMilestoneFunnel` to the public KPI collector (`lib/kpi-stats.js:647`, `:1056-1069`). It is rendered on the public page by `lib/render-kpis.js:258,286-288`, under "How people get started · from sign-up to merge · 30d".
> - **What production shows.** A no-cookie `GET https://harbour.cat/kpis` today returns `"milestoneFunnel":{"steps":{"login":{"count":{"hidden":"below-floor"}},"connected":{…"below-floor"},"firstGo":{"state":"reached","count":0},"prOpened":{"count":0},"mergeClicked":{"count":0}}`, with entries by rung of `copy: 0`, `run-step: fewer than 5`, `run-task: fewer than 5`. The rendered text reads "signed up: fewer than 5 / connected: fewer than 5". So over 30 days, fewer than 5 people signed up, and none of them made a first Go press, opened a PR or reached a merge. The "signed up" count probably includes this run's own anonymous Local account, because `POST /workspace/new` creates an account (`routes/workspace.js:90`).
> - **The report had it in hand.** Its own §A lists `GET /kpis` as 200, so it fetched this page but never read the funnel.
> - **Why this is the largest item.** The review exists to find where a first-time user stops. This is production data showing exactly that: real newcomers stop after "connected" and before "Press Go". The report instead calls that question unanswerable. It also weakens the report's optimistic reading: the v1 table rates "4 Press Go" as "improved" and calls the overall change a "large improvement", while production shows zero first Go presses in 30 days. Every other gap I found is a coverage or citation problem; this one changes the conclusions.
>
> **2. Verdict: DISAGREE.** The walk itself is careful, and I could reproduce its claims. I spot-checked the line citations in `render-landing.js`, `linear/index.js`, `navbar.js`, `starter-seed.js`, `dispatch-validation.js`/`workspace.js`, `email-auth.js` and `render-task-page.js`, and they hold, as does the "no way in" claim about `llms.txt`. But the report states twice that the real cold-visitor outcome is capability-gated, while the product publishes it on a page the report itself fetched. That number (fewer than 5 sign-ups, zero first Go presses in 30 days) is the strongest evidence available on whether the frozen destination is reached by anyone. Its absence makes the trend verdicts (J6/J8 "improved", v1 "large improvement") rest only on synthetic walks. The contract keeps telemetry secondary to the walk, but secondary evidence should still be reported, not declared unavailable.
>
> **3. Differs from the report's top-ranked finding: YES.** I take the report's top-ranked finding to be **R3-1**: `scripts/env-check.sh` reports a false Playwright blocker on macOS and has no `exit` (rated High, LIN-2386, third run running).
>
> **4. Lesser issues:**
> - **A cold door the report never walked.** A GitHub App install started from github.com lands at `/auth/github/callback?installation_id=…&setup_action=install`. That return was added and changed in this window (LIN-2882 `fe5190e8`, LIN-3404 `15c3b42c`). It is mounted with a path built at runtime, `router.get(callbackPath)` (`lib/github-install-flow.js:477`), which is exactly the case the report's own §7 C1 says would make its door list wrong. A live GET returns 302 → `/auth/github`, so the door works; this is a coverage gap, not a defect.
> - **A Local-workspace consequence of today's incident is missed.** The incident doc says rotating `SESSION_SECRET` today had "only effect was one sign-out" (`docs/incidents/2026-10-22-railway-security-disclosure.md:69`). The server signs sessions with a single secret (`server.js:1087`), and a local account's only identity is its random urlKey (`routes/workspace.js:85-90`). Combined with LIN-3065, every hosted anonymous Local workspace created before the rotation is now unreachable. The report promotes that path as the best cold route (R3-6) without saying so.
> - **Wrong line citation.** R3-12 and J3 cite `.env.example:78` as `OPENROUTER_API_KEY=`. Line 78 is `SESSION_SECRET=…`; the empty key is at `.env.example:97`.

**Disposition reasoning.** Every point was checked independently before acting:
- A live `GET /kpis` returns the funnel exactly as quoted, `firstGo: 0` included, and the rendered section reads "signed up: fewer than 5 · connected: fewer than 5".
- `41b165b2` is LIN-2952's cross-account aggregate, and the collector and renderer are at the cited lines.
- `.env.example:97` is the empty key.
- `/auth/github/callback?installation_id=1&setup_action=install` → 302 `/auth/github` live.

All four were **fixed in place**:
- the funnel is added as **R3-17**, and §5 telemetry, the §7 class bound, the headline and the v1 delta are corrected so they read as reachability, not use;
- the GitHub install return is added to C1;
- the session-secret corollary is added to R3-2, cited rather than minted, because it is LIN-3065's mechanism;
- the citations are corrected.

**Why R3-1 stays top-ranked.** R3-17 is corroborating evidence: it is a reading of outcomes, not a defect someone can fix. It sharpens R3-6 (the best path is unadvertised), but the most severe *objective* defect is still R3-1. **No new task is minted:** R3-17 is not breakage, and the session-secret effect is LIN-3065's.

`Adversarial second-read verdict: DISAGREE`
`Differed from top finding: YES`
`Disposition: fixed in place`
---

## 10 · Scope discipline

This review changed no code, config or secrets, and no docs beyond this report and its evidence file.

**Production writes, all now removed or inert:**
- Two anonymous local workspaces were created on `harbour.cat` to walk the hosted Local door, and both were removed with `POST /workspace/:key/remove`.
- One free-tier recommendation was generated in one of them.
- The anonymous account those workspaces created was left in place.

No production email was sent. All other journey state (local workspaces, a dispatch item, a runner login, a share link, an email account) lived in a scratch fresh clone's local server, which was stopped afterwards. The repo under review is untouched. The only tracker writes are this task's own comments and status, and one evidence comment on LIN-3068.
