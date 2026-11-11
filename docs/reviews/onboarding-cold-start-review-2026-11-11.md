# Onboarding & Cold-Start Review — 2026-11-11 (run 4, trend vs 2026-10-23)

**Status: run 4.** This is the fourth report in the series. Every journey step below is a delta against run #3 (`docs/reviews/onboarding-cold-start-review-2026-10-23.md`, LIN-3791, PR #2043). The earlier runs are `…-2026-09-26.md` (LIN-3106) and the baseline `…-2026-08-29.md` (LIN-2382). No later `onboarding-*` report existed when this run started (LIN-4413).

**Grounded at:**
- `LinearViewer` `origin/main` `da5df707d`, which is 480 commits after run #3's `661124c1`.
- Live `https://harbour.cat`, with footer `da5df70`, the same commit.
- `simple-dispatcher` `origin/main` `5d8489e`, 67 commits after `bb1da78`.

**The persona this run reads for.** The operator's note frames the reader: the first outside users will be a small team who already use agents, work in Jira, and run tasks on their own runner. Four new journeys follow from it:
- **J12**, agent-led onboarding;
- **J13**, a Jira team;
- **J14**, the team's own runner;
- **J15**, more than one person.

**How the evidence was gathered.** Every journey below was performed this run:
- live HTTP probes against `harbour.cat`;
- a live anonymous Local workspace, walked as a person in a browser (Playwright for client-rendered controls) and then removed;
- fresh `git clone`s of both repos in a scratch directory, with no `.env` from the dispatch workspace and three throwaway servers (zero-credential, test-mode fake Jira, console email).

The step-by-step transcript is `docs/reviews/_evidence-2026-11-11/onboarding-cold-start-walk.md` (sections A–G, cited below as §A–§G).

**Headline.**
- **Agent-led onboarding is the clearest improvement.** The landing now hands a coding agent a guide (LIN-4085), and `/llms.txt` opens with it. On the live product a person can go from that guide to a free-tier grounded prompt with a real button and no credential. So run #3's top friction, "the best cold path is unadvertised" (R3-6), is largely closed.
- **The furthest point reached cold** is on a zero-credential self-host. Run #3 stopped at `poll → take`. This run got further: dispatch from the task page's **Run to PR**, then the runner's **take**, a live broker serving the item over a socket, and the runner posting feedback. Verify-on-evidence is still unreached, because it needs a real repo, CI and a PR.
- **For the persona, three seams decide the cold start.** None of them is broken outright, and each one makes a Jira team guess:
  - **Jira by API token**, the door that needs no server config, is offered only from inside an existing workspace's Settings. The landing door and the workspace switcher's `+ Jira` both go to OAuth (J13).
  - **The product's runner and Simple Dispatcher are never introduced as a choice.** The runner page defines itself as working "with no Simple Dispatcher" to a reader who has never heard the name (J14).
  - **A second person has no way in.** The UI speaks of "members" and "everyone in <workspace>", but nothing says how a teammate joins. `docs/v1.md` rules colleagues beyond the share link a later step (J15).
- **One new objective breakage.** On a self-host without AI, the run control's default **Next step** gets a 503 and spins forever (R4-2).
- **The top objective defect is unchanged.** It is still `scripts/env-check.sh` (LIN-2386), now in its fourth consecutive run.

---

## 1 · Frozen destination

**Frozen, unchanged from runs #1–#3:**

> **"Harbour keeps human intent in command of AI execution, one turn of the loop at a time."**
> — `lib/render-landing.js:407` (it was `:341` at run #3). This is the "the loop" section's lede on the live landing.

The landing gained a plainer operational restatement as its hero subtitle (LIN-3980): *"Harbour reads your backlog, writes the next prompt, runs it on your coding agents, and checks the result against real evidence"* (`lib/components/landing-hero.js:58`). The served `/getting-started.md` says the same (§A).

These are the same four loop steps run #3 used as "used as intended": read → ground a prompt → dispatch to an agent → verify on evidence. So **purpose has not changed (delta: unchanged)**. The new sentence is a restatement, not a redefinition.

**This run's concrete reading for the persona**, as the task brief states it: *a Jira-backed workspace, a task from it run on the team's own runner, and the result checked on evidence.*

**Divergences (D1).** All are recorded; none is re-picked as the destination.
- `CLAUDE.md:3-5` describes a control plane that "reads any issue backend, generates grounded prompts, dispatches them … and verifies the work on real evidence". **Consistent.**
- `README.md:3` and live `/llms.txt:3` still describe a web app showing projects and issues "as a collapsible tree". **Unchanged, fourth run.**
- `docs/north-star.md:5` is still broader ("…funds itself doing it — and proves every word"). **Unchanged.**
- `docs/v1.md:107` now records email login as closed (LIN-1892, LIN-3771, LIN-3789). **Resolved** (it was stale at run #3, R3-10).
- `docs/incidents/2026-10-22-railway-security-disclosure.md:4` still says "Email sign-in is switched off until LIN-3771 lands". **Unchanged.** Email has been on since 23 Oct (§E for self-host). This belongs to the Documentation Review's altitude.

---

## 2 · Scope: journey inventory

**How the scope was widened (search, not memory):**
1. `git diff --name-only 661124c1..HEAD` mapped through `docs/areas/areas.json`. The heaviest code areas were runs-and-dispatch (82 files), front-end-pages (74), front-end-browser (73), llm-and-prompts (56), web-routes (37) and auth-accounts-and-workspaces (33).
2. `git diff --name-status 661124c1..HEAD -- routes/` gives 18 added route files. The cold-reachable one is **`routes/getting-started.js`**. The others are `dashboard-*`, `workspace-api-*`, `settings*.js` and `proxy-model-routing.js`, all session- or token-gated. `routes/next-run.js` was deleted.
3. `signInDoors()` (`lib/components/landing-hero.js:81`) is now the one list behind both the hero and the guide's doors (`lib/prompts/agent-onboarding.js:102`).
4. Every `<loc>` in `/sitemap.xml` (129), the hrefs on eleven public pages, and the URLs in `/getting-started.md`: 163 URLs swept (§A).
5. The persona: Jira doors, both runners, and team membership.

| # | Path / persona | Status this run |
|---|---|---|
| J1 | Hosted visitor → OAuth sign-in strip | ✅ live probe |
| J2 | Advertised vs. reachable backends | ✅ live, including the add-source rows |
| J3 | Self-hoster following the README literally | ✅ fresh clone `da5df707d` |
| J4 | Self-hoster using `npm run setup` / `env:check` | ✅ fresh clone |
| J5a | Broker-delivered bootstrap | ✅ this session is the evidence |
| J5b | Standalone bootstrap exchange | ✅ live, via the Proxy page's agent prompt |
| J6 | Free-tier first useful action | ✅ **live, through the real button** |
| J7 | Pre-auth public surfaces | ✅ live probe and 163-URL sweep |
| J8 | Headless agent / local self-hoster | ✅ fresh clone and live |
| J9 | Email magic-link sign-in | ✅ live door; self-host console with 12 sends |
| J10 | Own-session runner | ✅ fresh clone, **to `take` + broker + feedback** |
| J11 | Guest share link | ✅ **live** (owner mint on the anonymous workspace) |
| **J12** | **Agent-led onboarding (new)** | ✅ live and self-host |
| **J13** | **Jira team (new)** | ✅ live doors and self-host; downstream via the fake-Jira harness (a reach) |
| **J14** | **The team's own runner (new)** | ✅ fresh clone; live up to the runner page |
| **J15** | **More than one person (new)** | ✅ live surfaces; second identity capability-gated |
| R1 | `simple-dispatcher` seam | ✅ fresh clone `5d8489e` |
| D1 | Destination divergence | cross-cutting |
| v1 | v1-promise check | ✅ live and self-host |

**Folded in or bounded out:**
- `/getting-started(.md)` folds into J12 and J7.
- The Settings › Sources add-source rows (LIN-3846) fold into J2 and J13.
- Run controls (LIN-3849) fold into J14.
- The Dispatch page's queue tokens fold into J14 and R1.
- The `dashboard-*` and `workspace-api-*` routes are post-session and out of the cold path.
- `/auth/openrouter` from the guide 302s a cold visitor to `/`. That is expected (it needs a session) and noted in J12.

**Zero state:** no account, no `.env`, no token, no prior session, fresh cookie jars, fresh clones. **Caveat:** the npm cache and `~/Library/Caches/ms-playwright` were warm.

---

## 3 · Journey-by-journey walk log

Each step is recorded as *proceeded*, *had to guess*, *hard-blocked* or *capability-gated*, with its delta against run #3.

### J1: Hosted visitor, OAuth sign-in strip
`/` → 200. Linear, GitHub and Jira each redirect with a 302 to their consent screens. The Jira scopes are unchanged (§A). **Verdict:** proceeded, then capability-gated at consent. **Destination:** NO (gated). **Delta:** unchanged.

### J2: Advertised vs. reachable backends
- The landing provider list still has **0 `<a>`** (§A).
- **GitHub Projects now has an entry inside a workspace.** Settings › Sources › Add a source lists GitHub Projects ("adds a source onto this workspace"), and its button 302s to `/auth/github-projects?mode=add-source…` (§A2). Run #3 found the add-source rows omitted it.
- A cold visitor still cannot start from GitHub Projects. They need a workspace first, and nothing on the landing says so.
- **Local** is still two clicks away (`/swipe` → `+ local workspace`). The guide now names that route (J12).

**Verdict:** GitHub Projects improved from "hard-blocked cold" to "had to guess" (it is reachable after another door). **Destination:** NO. **Delta: improved** (LIN-2387, Todo, still open for the landing).

### J3: Self-hoster following the README literally (fresh clone `da5df707d`)
- `cp .env.example .env` → `npm install` → **new: `npm warn EBADENGINE … required: { node: '24' }`** on Node 25.9.0. LIN-3788 pinned `"engines": {"node": "24"}`, but `README.md` §Setup names no Node version, while `env:check` says "≥24 required" (§B, §C).
- `npx playwright install` → `npm start`. The warnings are unchanged, including the empty `OPENROUTER_API_KEY` warning caused by `.env.example` itself.
- `/` offers only "Log in with Linear", and `/auth/linear` → **503**. The page is now branded and plain: "Linear sign-in is not set up · … Try another way to sign in". Run #3 saw "OAuth Not Configured — … Missing environment variables".
- The CTA is still shown, and now also appears in three more places:
  - the workspace switcher's `+ Linear`;
  - Settings › Sources' Linear "add", under the note "Only sources this server can add are listed";
  - the self-host's `/getting-started.md` door list.

  All four 503 (§B, §D). The guide inherits the list from `signInDoors()`, which always offers Linear (`lib/components/landing-hero.js:98`; `lib/providers/linear/index.js:2458`, `isConfigured: () => true`).
- `README.md` §Setup still opens with "1. Create a Linear OAuth Application" for every self-hoster, whatever their tracker (LIN-3510 covers the landing's self-host prompt).

**Verdict:** proceeded; the zero-credential Linear doors still 503, but the page is more honest. **Destination:** NO. **Delta:** **improved copy, widened surface** (LIN-3108, Backlog). The Node pin warning is new.

### J4: Self-hoster using the repo's scripts
- `npm run setup` → exit 0.
- `npm run env:check` → **exit 0**, with "Status: 1 issue(s) to fix" and the false "Install Playwright browsers" blocker, while `~/Library/Caches/ms-playwright/chromium-*` exist (§C).
- The script changed in this window (LIN-3788, the Node 24 floor), but it is still **0 `exit`**, and it still checks only `$HOME/.cache/ms-playwright` and `/ms-playwright`.
- It also lists "Set SESSION_SECRET" as optional while `.env` holds the example value.

**Verdict:** had to guess (the macOS path); hard-blocked as an enforcement mechanism. **Destination:** NO. **Delta:** unchanged (LIN-2386, Backlog). **This is the fourth consecutive run.**

### J5a: Broker-delivered bootstrap
This session received `HARBOUR_LOCAL_BASE` and used the local proxy without a token. **Verdict:** proceeded. **Delta:** unchanged.

### J5b: Standalone bootstrap exchange
- The Proxy page's copied prompt now teaches the exchange inline: "First, exchange your single-use bootstrap … The bootstrap is single-use — this exchange spends it" (§A2).
- An agent following it exchanged the bootstrap (200, 48 h `readWrite`) and fetched `/instructions` (200, 128 KB) with nothing else to read.
- A cold `/instructions` is still 401.

**Verdict:** proceeded. **Delta:** improved (the guide → Proxy page → prompt chain now carries the reader end to end).

### J6: Free-tier first useful action (live)
Live `/swipe` → `+ local workspace` → task `LOCAL-2` → **"✦ Write the prompt"**. The page fetched `…/api/prompt/<id>/plan` and showed "Plan · generated just now · Copy prompt" in **823 ms**, with no OAuth and no OpenRouter key (§A2).

Run #3 reached the same tier only by calling the API routes directly (its reach 5). This run pressed the real button. The landing's try-it block now promises exactly this ("free to start, with no OpenRouter key needed"), though its buttons are sign-in doors, not the Local door.

**Verdict:** proceeded. **Destination:** loop steps 1–2 (read, ground) reached live. **Delta: improved** (walked through the UI; advertised).

### J7: Pre-auth public surfaces
- 163 URLs were swept and none is dead (§A).
- `/getting-started` is in the sitemap.
- `/llms.txt` now opens with "Getting started (onboarding a person)" → `/getting-started.md`. That closes run #3's "llms.txt names no way in".
- Bare `Cannot GET` 404s persist on `/login` and `/docs`, and on `/signup`, `/register`, `/invite` and `/join`.

**Verdict:** proceeded. **Delta: improved** (`llms.txt` way in). The bare 404s are unchanged.

### J8: Headless agent / local self-hoster
1. `POST /workspace/new` still appears in no agent doc. The guide now states the policy instead: *"Do not create it for them with an HTTP request. A workspace made that way belongs to your cookie jar"* (`/getting-started.md`, §A). That is a design answer to R3-8 for the agent-led path. A headless self-host init is still LIN-3058 (Backlog). **Reframed.**
2. First screen: the same hint as run #3. Seed task LOCAL-2's description still says "the **Linear** API proxy" on a Local workspace. "Welcome…" is still ◐ In Progress (§D). **Unchanged (LIN-3069).**
3. Cookie-less re-entry: a guest's cookie-less GET of the owner's `/workspace/<key>/` → `302 /` (§A2). **Unchanged (LIN-3065, LIN-3141).**
4. Dispatch no longer needs a feature toggle (LIN-3849). It runs from the task page once a runner is set up (J14). **Improved.**

**Destination (self-host):** read, ground (template), dispatch, and a runner take. **Delta: improved.**

### J9: Email magic-link sign-in
- **Hosted.** The hero's `Continue with email` and `/auth/email` render (§A). No live send was made: the inbox is human-held, and an undeliverable send would cost the production mailer. **Capability-gated.**
- **R3-4 re-test (LIN-3789, Done).**
  - Source: no `GLOBAL_MAX` or `global-ceiling` in `lib/email-auth.js` or `routes/email-auth.js`.
  - Walk: a self-host with `EMAIL_TRANSPORT=console` took 12 sends from fresh jars. Ten were delivered to the console log. The 11th and 12th got a **visible 429**, "Too many sign-in emails requested, please try again later" (`send refused: per-ip-limit`), not the silent "check your inbox" page (§E).

**Verdict:** hosted door proceeded, then inbox-gated; self-host proceeded. **Delta: R3-4 resolved.** The remaining refusal is per-IP and honest.

### J10: Own-session runner
This was walked on the self-host; see J14 for the full chain. The kit verified (`kit ok`), then `recover` → `login` → `poll` → **`take`** → broker → `feedback` (§D).
- **Reach (repeat of R3-13):** the credential block was built in the format of `public/runner-setup.js`. A browser user presses copy.
- **Information only:** with a scratch `HOME` of 150+ characters, the broker's Unix socket path exceeded macOS's 103-byte `sun_path`. `take` failed honestly with that reason. A normal `HOME` is far below the limit.

**Delta: improved** (`take` and broker reached; run #3 stopped before `take`).

### J11: Guest share link
- Walked **live** this run: an owner session on the anonymous workspace minted `/t/<token>` (201). The cold guest page loads (200, `noindex`, `no-referrer`, `no-store`) and shows "Nothing has run on this task yet."
- Every Harbour link on the page points into the owner's workspace and 302s the guest to `/` with no message (§A2).
- After the workspace was removed, the link → 404.

**Verdict:** guest view proceeded; the onward path had to guess. **Delta:** unchanged behaviour, **now confirmed live** (run #3 could only walk it on a self-host).

### J12: Agent-led onboarding (new)
The persona's likely first move: copy the landing prompt (*"…fetch the onboarding guide at https://harbour.cat/getting-started.md, read all of it, and follow it…"*) into a coding agent, then follow the guide as served.

1. **Fetch the guide.** Live 200, markdown, `sandbox` CSP (§A). On the self-host the prompt and guide both carry `http://localhost:3000`, so `{{BASE_URL}}` is right (§B). **Proceeded.**
2. **"Ask or look first."** The agent has to ask the person. **Proceeded** (by design).
3. **Path (a), Local.** The person opens `/swipe` → `+ local workspace`, then the Proxy page → "generate & copy". The copied prompt is provider-correct ("currently backed by Local") and leads to a working token and `/instructions` (§A2). **Proceeded.** On the self-host it works the same way.
4. **Path (b), a real tracker.**
   - Live, the doors list Linear, GitHub, **Jira (OAuth only)** and email, and each one gates at consent or the inbox. **Capability-gated.**
   - On the zero-credential self-host the guide lists only "Log in with Linear", which **503s** (J3, LIN-3108). **Hard-blocked on that path.** Path (a) still works, and the guide says to fall back to it when no door fits.
5. **Path (c), run work on their own machine.** The guide points at `/workspace/<urlKey>/runner` and says "Only the workspace owner can mint a runner key" (§A). It ends somewhere real (J14).
6. **Where the guide stops.**
   - It ends at "copy the Agent Prompt". It says nothing on adding Jira by API token, on Settings › Sources, or on how to get from a prompt to a checked result. That is **LIN-4090** (Todo, "the guide itself is too thin").
   - The `/getting-started` door is still missing from `/swipe`, the very page path (a) sends the person to (**LIN-4088**, Backlog).
   - `https://harbour.cat/auth/openrouter`, listed under "What only the person can do", 302s a cold visitor to `/`. That is expected, since it needs a session, but the guide doesn't say so.
7. **Copy residue the guide routes every agent through.** Both paths send the person to the Proxy page, whose header still says *"Let AI agents interact with **Linear** through secure proxy tokens"*, and *"…credentials to interact with **Linear**"*, with a `/issues/LIN-123` example. That holds on Local and on Jira (§A2, §D2). The copied prompt itself is correct, because LIN-2370 fixed the client block. **Friction (R4-7).**

**Verdict:** proceeded live to a working agent token, and on the self-host path (a) too; path (b) is capability-gated live and hard-blocked on a zero-credential self-host. **Destination:** read and ground (live); with path (c), up to a runner take (self-host). **Delta: new journey.** It closes most of R3-6.

### J13: Jira team (new)
**Doors (live).**
- The hero `Continue with Jira` and the guide's door are both **OAuth** (`/auth/jira/oauth?mode=new`) → Atlassian consent. **Capability-gated.**
- The API-token door, which `README.md` (`:89`) describes as needing "No server config", is not on the landing or in the guide. A cold `GET /auth/jira` answers honestly: *"Jira can only be added as an additional source on an existing workspace — open Settings on the workspace you want to add it to"* (§A).
- So a Jira team without OAuth consent has to make a workspace first (Local or email), then find **Settings › Sources › Jira › API token** (§A2). **Had to guess.**
- Inside a workspace, the switcher's **`+ Jira` goes to OAuth `mode=new`** (a new sign-in), not to the add-source path. Settings offers both add-source buttons (API token → `/auth/jira?workspace=…`; OAuth → `mode=add-source`).
- A fake token on a non-existent site got an honest "Could not authenticate with Jira…" (§A2).

**Self-host with no Jira env (compare R3-5).**
- `/auth/jira/oauth` → an honest branded 503 ("Jira sign-in is not set up"), and it is not advertised. **Degrades honestly**, unlike Linear (J3).
- The API-token door works with zero config, as the README says, but the workspace switcher shows **no `+ Jira`** there at all. Only Settings › Sources lists it (§D). **Had to guess.**

**Downstream: what a Jira workspace meets.** Without a Jira site this was walked on the self-host's fake-Jira test harness (§D2; logged as a reach, §5):
- **`+ Add task`** on the Backlog opens Jira's own create dialog (`https://<site>/secure/CreateIssue!default.jspa`), which leaves Harbour. That is honest, and consistent with `README.md:60`'s "creating new issues isn't supported yet".
- **An agent creating a task** through the proxy gets **422 `CAPABILITY_NOT_SUPPORTED` `createIssue`**. That is honest at the endpoint, but `/api/proxy/instructions`' `POST /issues` text names only GitHub's and Local's limits (§A2). An agent learns about Jira by failing. That is **LIN-3807** (Backlog, "add Jira to the c[reate …]").
- **A periodical mint** on the Jira workspace was accepted (201, queued), with no caveat that the review's follow-on step needs to create an issue. *Inferred, not walked:* that step would hit the same 422. The run would need a runner subagent, which is out of scope here.
- The **Proxy page** says "interact with Linear" (R4-7).
- Known open, cited and not re-filed: **LIN-4355** (As asked block in Jira), **LIN-2008** (boards/sprints), **LIN-2014** (scope on a large site), **LIN-2391** (docs misstate Jira).

**Verdict:** OAuth door proceeded, then gated; API-token door had to guess; downstream create honest at each surface, with the instructions silent. **Destination:** NO cold (no Jira site); a simulated Jira workspace reads, writes, mints and could dispatch. **Delta: new journey.**

### J14: The team's own runner (new)
1. **How a newcomer learns a runner is needed.** From a fresh workspace (live and self-host):
   - the task page says *"Harbour can also run steps for you, on your own machine. Set up a runner ›"*;
   - Settings › Running says *"No runner yet. Run buttons appear for the workspace owner once one is set up"*;
   - the guide's path (c) says the same.

   Home itself carries no runner line on the first screen (§A2). **Proceeded.**
2. **Which runner the product points to.** Always the in-repo own-session kit (`/workspace/<key>/runner`, `lib/render-runner-setup.js`). The page is titled *"Run on my machine"* while every link to it says *"Set up a runner"* (LIN-3989).
3. **Are the two runners told apart?**
   - The only place a newcomer meets the other one's name is the runner page's own definition, *"…on your machine, **with no Simple Dispatcher**"*, plus a rule that a recently-polling Simple Dispatcher makes the runner `abort` (§D).
   - `README.md`, `/llms.txt` and `/getting-started.md` never name Simple Dispatcher.
   - From the other side, `simple-dispatcher`'s README never names the runner kit or the Runner setup page. It says only *"Tokens are created in LinearViewer's workspace settings"* (§F).
   - In fact a queue token is minted on the **Dispatch** page (Settings › Running › Queue and history › Dispatch › "new token: generate"). Settings › Agent access says keys that can start runs are minted "from the agent prompt" (§D).

   **Had to guess**, for any team that wants an always-on host rather than a session.
4. **How far the kit gets (self-host).**
   - Owner mint (take+dispatch) → served prompt run as written → `kit ok` → `recover` → `login` → `poll`.
   - **Run controls then appear** on the task page: Next step · Run to PR · Run to Done (LIN-3849, confirmed).
   - **Run to PR** → "Started." → `poll` decided `take` → `take` started a broker and printed a 72 KB Autopilot prompt, with an `environment` block that holds no token. The broker served the issue over the socket. `feedback` posted a terminal `[failed] … review probe` status (§D).
   - The subagent was not launched, because "verify on evidence" needs a real repo, CI and a PR. **Capability-gated by this review's scope.**
5. **Defect on the way (self-host without AI): R4-2.** The default **Next step** button fetches `…/api/recommend/<id>/stream` → **503**. The control shows "AI Recommend · generating…" and "Loading…", still unchanged after 8 s, with no message (§D). The page offered the button even though its own options say `aiState: "unconfigured"`.
6. **A state mismatch after a failed item.** After the first take failed (the long-`HOME` artifact), the task page header still read "idle · No sessions yet." while Stages showed "Kick-off · failed" (§D). **Friction, Low.**
7. **`simple-dispatcher` leg:** see R1. Zero-config exits 1. A queue token needs the Dispatch page above.

**Verdict:** proceeded to `take` + broker + feedback with the kit; had to guess on the runner choice; one objective defect on the AI-less self-host. **Destination:** dispatch plus a runner holding the item. Verify not reached. **Delta: new journey** (extends run #3's J10 by two steps).

### J15: More than one person (new)
- **What the product says.** Settings speaks of membership: *"every workspace you're a member of — even work triggered by another member"* (Account); *"For everyone in Local Workspace"*; *"Any member can, and each change is logged"* (Agent access, Features) (§A2). There is no invite, member list or "add a teammate" control on any settings page. `/invite` and `/join` are bare 404s. No served doc (README, `/llms.txt`, `/getting-started.md`) says how a teammate joins.
- **What can be walked.**
  - A Local workspace belongs to one browser's cookie (a second, cookie-less client is bounced: LIN-3065).
  - The **share link** is the one multi-person surface. It gives a read-only guest view, walked live (J11).
  - Run controls are owner-only, and the runner kit runs only the owner's dispatches, as the runner page says plainly. So a teammate who is a member could not start runs on the owner's runner.
  - Whether a second Jira identity signing into the same site joins the same workspace is **capability-gated** (it needs two Jira accounts).
- **Recorded scope.** `docs/v1.md:89` puts *"organisations and colleagues beyond the share link"* out of v1, "as later steps rather than never".

**Verdict:** had to guess, and capability-gated for tracker-backed membership. **Destination:** n/a (a team property). **Delta: new journey.** The gap is a recorded v1 scope decision, not a defect. For this persona it is the first question the product cannot answer.

### R1: `simple-dispatcher` seam (fresh clone `5d8489e`)
`npm install` → `node dispatcher.js` in a clean environment → `Failed to load workspaces.json: ENOENT` → exit 1. There is still no example file. The explanation has moved to `README.md:223` of 415 (it was `:196`). The README names no runner-kit alternative, and its token sentence doesn't name the Dispatch page (J14). **Verdict:** unchanged friction. **Delta:** unchanged.

### v1: v1-promise check (`docs/v1.md:43-50`)

| v1 step | Advertised live | Reachable cold | Delta vs run #3 |
|---|---|---|---|
| 1 Log in with email | yes | yes; inbox gated; the R3-4 ceiling is gone (§E) | improved (R3-4 resolved) |
| 2 Connect GitHub + tracker | yes | consent-gated; Jira API token only via Settings | unchanged; Jira seam newly logged |
| 3 See the work | yes | yes via Local | unchanged |
| 4 Press Go | yes ("free to start") | **live: the "Write the prompt" button, 823 ms**; self-host: Run to PR dispatches | improved (through the UI) |
| 5 Watch | — | stage track and "Sessions on one clock" on the task and guest pages | unchanged |
| 6 PR with evidence | — | not reached (needs a subagent, repo and PR) | unchanged (gated) |
| 7 Close out | — | not reached | unchanged |
| 8 Share the link | — | **yes, live** (owner mint 201, guest 200) | improved (live) |

**Advertised before reachable:** none found on the hosted product. On a zero-credential self-host, Linear is advertised in four places and unreachable (LIN-3108).

---

## 4 · Findings (objective first, then advisory, each by severity)

**Classification:**
- **Objective** means a dead or broken link, a documented command that errors, a setup step that hard-blocks with no workaround, or a 404/500 mid-journey.
- **Friction** means it eventually worked after guessing.
- **Divergence** means stated purpose or docs disagree with the product.

| ID | Finding | Journey | Class | Severity | Treatment |
|---|---|---|---|---|---|
| **R4-1** | `scripts/env-check.sh` still reports a false Playwright blocker on macOS and still has **no `exit`** (returns 0 with "1 issue(s) to fix"). The script changed this window (LIN-3788) without fixing either. **Fourth consecutive run.** | J4 | Objective | **High** | Cite **LIN-2386** |
| R4-3 | Local workspaces are still not re-enterable from a new session or a second client (the cookie is the only key); the email account does not restore them. | J8/J15 | Objective | Med-High | Cite **LIN-3065**, **LIN-3141** |
| **R4-2** | **New.** On a self-host without AI (`aiState: "unconfigured"`), the run control offers **Next step**. Pressing it gets **503** from `…/api/recommend/<id>/stream` and leaves "AI Recommend · generating…" / "Loading…" spinning, with no message. Run to PR works on the same page. | J14 | Objective (503 mid-journey) | Med | **Area note** (`public/prompt-section.js`); not ticketed (LIN-3597 is a different stall) |
| R4-4 | Zero-credential self-host: "Log in with Linear" 503s. The page is now branded and honest, but the door is offered in four places: hero, switcher `+ Linear`, Settings › Sources (under "Only sources this server can add are listed"), and **the self-host's `/getting-started.md` door list**, the only door an agent is given there. | J3/J12 | Objective | Low-Med | Cite **LIN-3108** (the guide inherits `signInDoors()`) |
| R4-5 | GitHub Projects: now addable from Settings › Sources, but still no cold entry from the landing's provider list. | J2 | Objective (narrowed) | Low-Med | Cite **LIN-2387** |
| R4-6 | **Jira team, door seam.** Hosted Jira doors (hero, guide, switcher `+ Jira`) are all OAuth `mode=new`. The no-server-config **API-token** path exists only under Settings › Sources › Jira inside an existing workspace. On a self-host with no Jira env the switcher shows no `+ Jira`, though the API-token path works there. A Jira team without OAuth consent has to discover "make a workspace first, then Settings". | J13 | Friction | Med | **Area note** (`lib/components/navbar.js`); the guide's half is **LIN-4090** |
| R4-9 | **Runner choice is never presented.** The product points only to the own-session kit. The runner page defines itself as working "with no Simple Dispatcher" and makes the two mutually exclusive per workspace, but no surface a newcomer reads introduces Simple Dispatcher, and `simple-dispatcher`'s README never names the kit. Its "Tokens are created in LinearViewer's workspace settings" doesn't lead to the Dispatch page where queue tokens are minted. A cross-repo seam. | J14/R1 | Friction | Med | **Area note** (`lib/render-runner-setup.js`, naming the other side); the `simple-dispatcher` side in its own notes (companion PR) |
| R4-11 | **A second person has no way in, and nothing says so.** The UI speaks of members; there is no invite or join, and no doc says how a teammate joins. Run controls and the runner are owner-only. This is a recorded v1 scope decision (`docs/v1.md:89`). | J15 | Capability gate / divergence | Med (for this persona) | Report-only; for the person (a product decision, not a tidy) |
| R4-7 | The Proxy page, where the guide sends every agent, says "interact with **Linear**" (header and hint), with a `LIN-123` example, on Local and Jira workspaces. The copied prompt is correct (LIN-2370). | J12/J13 | Friction / divergence | Low-Med | **Area note** (`lib/render-proxy.js`) |
| R4-8 | Jira create: `+ Add task` leaves for Jira's own dialog; proxy `POST /issues` → 422 `CAPABILITY_NOT_SUPPORTED` (honest). But `/api/proxy/instructions` names only GitHub's and Local's create limits, and a periodical mint is accepted with no caveat. | J13 | Friction | Low-Med | Cite **LIN-3807** |
| R4-12 | Agent-led guide: thin past "copy the Agent Prompt" (no Jira API token, Sources, runner choice or first checked result); its door is missing on `/swipe`, where path (a) sends the person. | J12 | Friction | Low-Med | Cite **LIN-4090**, **LIN-4088** |
| R4-13 | Guest share page: every Harbour link 302s the guest to `/` with no message; nothing says "this is Harbour, get your own". Now confirmed live. | J11 | Friction | Med | Report-only (recorded design decision; siblings LIN-3369, LIN-3348) |
| R4-14 | Seed copy: LOCAL-2's description says "the **Linear** API proxy" on a Local workspace; "Welcome…" is still In Progress. | J8 | Friction | Low | Cite **LIN-3069** |
| R4-15 | Task page after a failed item: header "idle · No sessions yet." beside Stages "Kick-off · failed" and "1 session". | J14 | Friction | Low | Report-only (Design & Interface Review altitude for the rendering) |
| R4-16 | Node pin: `npm install` warns `EBADENGINE` (engines `"24"` exactly, LIN-3788) on Node 25; `README.md` §Setup names no Node version; `env:check` says "≥24". | J3 | Friction | Low | For the person (`package.json`, no area) |
| R4-17 | D1: `README.md:3` and `/llms.txt:3` still say "collapsible tree"; the incident doc's status line still says email is off. `docs/v1.md:107` is fixed. | D1 | Divergence | Low-Med | Report-only (Documentation Review altitude) |
| R4-18 | `.env.example` `OPENROUTER_API_KEY=` makes every README-literal start warn; `README.md` §Setup step 1 is "Create a Linear OAuth Application" for every tracker. | J3 | Friction | Low | Report-only; the landing half is **LIN-3510** |
| R4-19 | `simple-dispatcher` zero-config: `ENOENT workspaces.json`, exit 1, no example file, the pointer at `README.md:223`. | R1 | Friction | Low | `simple-dispatcher` area note (companion PR) |
| R4-20 | Bare `Cannot GET` 404s: `/login`, `/docs`, `/signup`, `/register`, `/invite`, `/join`. | J7 | Friction | Low | Report-only |
| R4-21 | Runner kit: the credential block can only be reproduced without a browser by reading `public/runner-setup.js` (a repeat of R3-13). For information: the broker socket lives under `$HOME`, so an unusually long `HOME` exceeds macOS `sun_path`; `take` fails honestly with that reason. | J10 | Friction / info | Low | Report-only |
| R4-22 | The frozen destination is still not reached end to end cold. Verify needs a runner subagent, a repo, CI and a PR. Reached: read and ground (live); dispatch, take and broker (self-host). | cross-cutting | Capability gate | — | Report-only |

**Resolved or improved since run #3:**
- **R3-4** (email ceiling, LIN-3789): **resolved**, verified at source and by 12 console sends (§E).
- **R3-6** (best path unadvertised): **largely closed** by LIN-4085, the `/llms.txt` way in, and the try-it copy. What remains is LIN-4090 and LIN-4088.
- **R3-10** (`docs/v1.md:107`): **resolved**. The incident doc half is unchanged.
- **R3-3** (GitHub Projects): **improved** (in-workspace entry).
- **R3-5** (Linear 503): copy **improved**, but the surface **widened** (now in the guide).
- **J5b**, **J6** and **J11**: improved; walked through the UI or live.
- **J10/J14**: two runner steps further.

---

## 5 · Reaches, capability gates, and telemetry

**Reaches.** These are points where repo knowledge directed the walk. They are logged rather than used silently.
1. **The Proxy page's "generate & copy"** was reproduced with curl using the body in `public/proxy.js`, and the copied text was rendered with that file's `buildAgentPrompt`. A browser user presses the button.
2. **The runner credential block** was built in `public/runner-setup.js`'s format (repeat of R3-13).
3. **J13 downstream used the test-only fake-Jira harness** (`NODE_ENV=test`, `/test/set-jira-session`, `tests/fixtures/jira-harness.js`). It drives the real provider code against an in-memory Jira, but no real Jira site, credential or Atlassian consent was involved. Its results stand for "what a Jira workspace's surfaces show", not for real-site behaviour.
4. **Probe paths** (`/auth/jira` bare, `/invite`, `/join`, `/runner-kit/contract.json`, `…/dispatch` without a runner) came from source and the brief, not from the live surface. The 163-URL sweep is the surface-only cross-check.
5. **Settings form bodies and the `Origin` header** (add-source, feature toggles) were read from the rendered forms. That is what a browser submits, so it is not a deep reach.
6. **Where Next step fails** (`public/prompt-section.js`) was located by grep after the walk found the 503. Only the owning file is cited; no cause analysis was done (Comprehension-Debt altitude).

**Capability-gated** (marked, not guessed):
- all OAuth consent screens (Linear, GitHub, Jira 3LO, GitHub Projects);
- the hosted email inbox (no live send);
- a real Jira site and a second Jira identity (J13, J15);
- a runner subagent with a repo, CI and PR (verify on evidence);
- AI on the self-host (no OpenRouter key).

**Funnel telemetry.** This run did not go looking for a signup or activation signal. R3-17's `/kpis` funnel reading is carried as **not re-measured**. The walk fetched `/kpis` (200) as a public surface but did not read the funnel, and nothing here stands in for the walk. Note for whoever reads `/kpis` next: this run's anonymous Local workspace (`POST /workspace/new` mints an account) may appear in its sign-up count.

---

## 6 · Where findings went (no tasks minted)

This review mints no tasks. **Ticketed findings stay in this report only:** R4-1, R4-3, R4-4, R4-5, R4-8, R4-12 and R4-14, citing LIN-2386, LIN-3065/3141, LIN-3108, LIN-2387, LIN-3807, LIN-4090/4088 and LIN-3069.

**Area notes written in this PR.** Each is a Waiting entry, citing the area's file first and this report second, sourced "Onboarding & Cold-Start Review, 11 Nov.":
- `docs/areas/front-end-browser.md`: R4-2 (`public/prompt-section.js`).
- `docs/areas/front-end-pages.md`:
  - R4-6 (`lib/components/navbar.js`);
  - R4-7 (`lib/render-proxy.js`);
  - R4-9 (`lib/render-runner-setup.js`). R4-9 is a **cross-repo seam**, filed under the area a change would start from and naming `simple-dispatcher` as the other side. **Seams have no full home in the notes yet.**
- `simple-dispatcher/docs/areas/loop-and-routing.md` (new note, companion docs-only PR): R4-19 and the README half of R4-9 (`dispatcher.js`).

Neither LinearViewer note was near its cap, and no existing entry was found settled by this walk. The notes near their cap (`agent-api.md`, `llm-and-prompts.md`, `runs-and-dispatch.md`) are untouched, because no un-ticketed finding binds them.

**For the person (no area home):**
- **R4-11** (team membership): a product decision recorded in `docs/v1.md`, not a tidy.
- **R4-16** (the Node pin in `package.json`, a manifest).
- A fresh `npm install` reports **7 vulnerabilities (2 moderate, 4 high, 1 critical)**. That belongs to the Dependency & Supply-Chain Review's altitude (`docs/reviews/dependency-supply-chain-review-2026-11-10.md`) and is only routed here.

**Objective breakage, ranked:** R4-1, R4-3, R4-2, R4-4, R4-5. Only R4-2 is un-ticketed, and it is in the front-end-browser note.

---

## 7 · Classes (bounded) and surface assessment

**C1, cold entry doors.** Bounded by three searches: the 18 added route files since `661124c1` (only `routes/getting-started.js` is unauthenticated); `signInDoors()` as the one door list for the hero and the guide; and the 163-URL sweep.
- **Members:** `/`, `/getting-started` and `.md`, `/auth/linear`, `/auth/github`, `/auth/jira/oauth?mode=new`, `/auth/jira?workspace=` (API token, workspace-only), `/auth/github-projects` (workspace add-source), `/auth/email` with `/send` and `/confirm`, `POST /workspace/new` (`/swipe` nav), `/t/:token` with `/state`, `/runner-kit/{broker,runner}.mjs`, `/library*`, `/sitemap.xml`, `/robots.txt`, `/llms.txt`, `/kpis`, `/templates`, `/styleguide`, `/privacy`, `/terms`, `/archive/:n`, `/swipe`, `/swim`, `/ship`, `/health`, `/api/proxy/token`, `/api/proxy/instructions`, and the GitHub install return `/auth/github/callback?installation_id=…` (302 → `/auth/github`).
- **Would be wrong if** a door is mounted by a runtime-built path that nothing links to. Run #3's second-read found one such door, the GitHub install return. This run re-probed it, and no new runtime-mounted door appeared in the 18 added route files' unauthenticated lines.

**C2, personas.** Hosted visitor, coding agent following the guide, Jira team (OAuth / API token / self-host), team runner owner (kit / Simple Dispatcher), teammate, cold guest, README self-hoster, scripts self-hoster, broker-delivered session. Each maps to J1–J15 and R1.

**C3, run #3's tracked tickets.** LIN-2386, LIN-3065, LIN-3141, LIN-2387, LIN-3789 (Done, verified), LIN-3108, LIN-3369, LIN-3058, LIN-3069, plus the persona tickets LIN-4090, LIN-4088, LIN-3989, LIN-4355, LIN-2008, LIN-2014, LIN-2391, LIN-3849 (Done, confirmed), LIN-4085 (Done, walked) and LIN-3807. Each one's state was read via the proxy on 11 Nov.

**C4, Jira surfaces a newcomer meets** (bounded by the walk): hero door, guide door, cold `/auth/jira`, switcher `+ Jira`, Settings › Sources (API token / OAuth), the link form and its error, Backlog `+ Add task`, Proxy page, proxy create, periodical mint. **Unbounded:** real-site behaviour (sync, OAuth site picker, a large site), because that is production data behind consent.

**C5, multi-person surfaces:** share link (walked), membership copy in Settings (walked), owner-only runner and run controls (walked). **Unbounded:** whether a second tracker identity joins a workspace (capability-gated).

`Surface Assessment: [lands cleanly]`. This is a review-only report. It proposes no code change, and the area-note entries fit their notes' caps without restructuring.

---

## 8 · Trend ledger (every journey under its stable name)

| Step | Outcome this run | Destination reached | Severity | Delta vs 2026-10-23 |
|---|---|---|---|---|
| J1: hosted OAuth sign-in | proceeded; consent gated | NO (gated) | — | unchanged |
| J2: advertised vs. reachable backends | GitHub Projects reachable in-workspace; landing list unlinked | NO | Low-Med (R4-5) | **improved** |
| J3: README-literal self-hoster | proceeded; Linear doors 503 (branded); EBADENGINE warning | NO | Low-Med (R4-4) | copy **improved**, surface **widened**; Node pin **new** |
| J4: repo-scripts self-hoster | false blocker, exit 0 | NO | **High** (R4-1) | unchanged (**4th run**) |
| J5a: broker-delivered bootstrap | proceeded | gated | Info | unchanged |
| J5b: standalone exchange | proceeded via the copied prompt | gated | Low | **improved** |
| J6: free-tier first action | **live, real button, 823 ms** | read + ground (live) | — | **improved** |
| J7: pre-auth public surfaces | 163 URLs clean; `llms.txt` way in | n/a | Low (R4-20) | **improved** |
| J8: headless / local self-hoster | guide forbids HTTP creation; seed copy; re-entry blocked | read + ground + dispatch | Med-High (R4-3) | reframed; LIN-3065 unchanged |
| J9: email sign-in | hosted inbox gated; self-host 10×200 then honest 429 | sign-in (self-host) | — | **R3-4 resolved** |
| J10: own-session runner | `kit ok` → login → poll → take → broker → feedback | dispatch + runner holding item | Low (R4-21) | **improved** (+take, +broker) |
| J11: guest share | live mint and guest view; onward bounce | n/a (viewer) | Med (R4-13) | unchanged; **now live** |
| **J12: agent-led onboarding** | guide → Local → token (live); self-host guide's only door 503s | read + ground (live) | Low-Med (R4-12, R4-7) | **new** |
| **J13: Jira team** | OAuth gated; API token via Settings only; downstream honest (harness) | NO (no site) | Med (R4-6), Low-Med (R4-8) | **new** |
| **J14: team's own runner** | kit to take + broker; runner choice unexplained; Next step 503 spinner (no AI) | dispatch + take (self-host) | Med (R4-2, R4-9) | **new** |
| **J15: more than one person** | membership copy, no join path; share link only | n/a | Med (R4-11) | **new** |
| R1: simple-dispatcher seam | zero-config exit 1; no runner-kit pointer | n/a | Low (R4-19) | unchanged |
| D1: destination divergence | README and `llms.txt` "collapsible tree"; incident doc stale; v1.md fixed | n/a | Low-Med (R4-17) | partly **resolved** |
| v1: v1-promise check | steps 1, 3, 4, 5, 8 reachable; 6–7 gated | partial | — | **improved** (step 4 via UI, step 8 live) |
| Funnel (secondary, `/kpis`) | not re-measured | — | — | not re-measured |

---

## 9 · Adversarial Second-Read

*(Filled in after the fresh-context read; see below.)*

---

## 10 · Scope discipline

This review changed no code, config or secrets, and no docs beyond this report, its evidence file and the area-note entries (plus one `simple-dispatcher` area note in a companion docs-only PR).

**Production writes, all removed or inert:**
- one anonymous Local workspace on `harbour.cat`, removed with `POST /workspace/:key/remove` (afterwards the owner jar got 302, the share link 404 and the proxy token 401);
- one free-tier plan prompt generated in it;
- one agent bootstrap and its working token (now revoked);
- one share link (now dead);
- one failed Jira link attempt against a non-existent site;
- the anonymous account that the workspace minted, left in place (as in run #3).

No production email was sent. Every other journey ran against throwaway servers from a scratch fresh clone, which were stopped afterwards. The repos under review are untouched. The only tracker writes are this task's own comments and status.
