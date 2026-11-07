## Scope (scoping stage, 2026-11-07)

**Goal in one line:** add a copyable "give this to your agent" prompt to the public homepage (`/`, `lib/render-landing.js`), and a new public `/getting-started` guide (HTML plus `/getting-started.md`) that the agent reads to onboard the user and their project to Harbour. The agent asks or inspects, then tells the human exactly which browser steps are theirs.

**Done means:** a signed-out visitor on `/` can copy a short prompt with one tap (phone width included). Pasted into Claude Code, Codex or any agent, that prompt makes the agent fetch `<this deployment>/getting-started.md`. The guide is enough for the agent to work out the user's situation, pick the right sign-in door, take the user to first value (copy-first, then optionally a runner or a Workspace API key) and go over the settings with them. Every route and door the guide names exists and is enabled on the deployment that serves it.

### What the code shows (re-grounded at `e1f75fe7`, 2026-11-01)

- **The homepage has no "getting started" section.** `/` is `renderLandingPage` in `lib/render-landing.js`, laid out as: hero with sign-in buttons, the loop, live runs, swim lanes, checked prompts, "try it yourself" (`renderTrySection`), providers, Harbour OS, Library, Archive. The only "┌─ Getting started" box is the `setupNotice === 'setup'` banner, shown on localhost only. It is about `.env`/`LINEAR_ACCESS_TOKEN` and does not appear on harbour.cat. The same banner is duplicated in `lib/render.js` (`setupNoticeHtml`). So the ticket's "the getting started section" is a new section, not an edit to an existing one.
- **`harbour.cat/getting-started` does not exist.** No route matches it. The nearest public surfaces are `/llms.txt` (DOM navigation for agents, not onboarding), `/library` (papers and essays) and `/api/proxy/instructions` (needs a token).
- **There is a precedent.** `content/landing.md` holds an "AI-assisted setup / copy this prompt into your preferred AI assistant" block for self-hosting. It feeds only the swipe/swim/ship landing demos (`server.js` `landingTrees`), not `/`.
- **Onboarding is browser-gated by design:**
  - sign-in is human OAuth or email (`/auth/linear`, `/auth/github`, `/auth/jira`, `/auth/email`; GitHub, Jira and email show only when configured, see `renderSignInCtas`)
  - a local workspace is `POST /workspace/new`, which is cookie-session based
  - the runner credential is minted in the owner's browser on `/workspace/<urlKey>/runner` and is never rendered server-side
  - Workspace API keys come from Settings › Agent access
  - the OpenRouter key is set in Settings › Account
  - Once an agent has a token, the Workspace API lets it read and write issues, dispatch, halt, and read or write model routing (`/api/proxy/model-routing…`). It has no endpoints for sources, dispatch defaults or presets, the OpenRouter key, or features.
  - So an agent can steer onboarding but cannot do the sign-in or credential steps itself. This shapes the guide, and it is the subject of the ruling below.
- **Staleness:** `git log --since=2026-11-01` on the touched paths shows only `e1f75fe7` (server.js, unrelated halt wiring). The last landing changes were LIN-3980 and LIN-3995 (2026-10-26). Nothing the ticket relies on has moved.

### In Scope

1. **Homepage section** (`lib/render-landing.js`, `public/landing.css`). A new section, `data-testid="landing-agent-start"`, eyebrow "get started", placed directly before "try it yourself". The hero stays untouched (LIN-3980/3995 settled it). It holds the agent prompt in a bounded, selectable block with a **Copy** button (`landing-agent-prompt`, `landing-agent-copy`), wired in the landing's existing scripts. It must work at phone width, because the report came from Android Chrome. Draft prompt text (implementation may tighten it; it must stay "a couple of paragraphs"):
   > I'd like to start using Harbour, a control plane that reads my issue tracker, writes a grounded prompt for the next step of each task, runs it on coding agents like you, and checks the result against CI and merged code. Please read the onboarding guide at `{origin}/getting-started.md` and use it to help me set Harbour up for this project.
   >
   > Look at this repository and the tools you can see first, and ask me only what you can't work out yourself. Some steps (signing in, approving access, minting a key) have to be done by me in a browser. When we reach one, tell me exactly what to open and click and why, then wait for me.
2. **The guide**, served at `GET /getting-started` (HTML, shared page shell, library-style CSP) and `GET /getting-started.md` (`text/markdown`, sandbox CSP, matching the `/library/*.md` convention, because agents read markdown). One source renders both. The guide's sections:
   - **What Harbour is**, reusing `HARBOUR_PLAIN_SENTENCE`.
   - **How the agent should use this guide:** inspect first, ask second. The human does every sign-in and credential step. Never invent a route or setting.
   - **Work out the situation:** the tracker (Linear, GitHub Issues, GitHub Projects, Jira, or none, which means a local workspace), where the repo is hosted, which agent harness the user has, solo or team, whether they want copy-first only or a runner, and free tier or their own OpenRouter key.
   - **Situation → sign-in door,** listing only the doors enabled on this deployment.
   - **Human step: sign in,** with the exact link.
   - **First value: copy-first.** Open a task, choose "Write the prompt", paste it into the agent.
   - **Optional: runner.** `/workspace/<urlKey>/runner`, owner only; paste the prompt and credential block into the agent.
   - **Optional: Workspace API key** (Settings › Agent access). The agent then reads `/api/proxy/instructions`.
   - **Settings to review with the user,** each with what it does and a recommended default per situation: Sources, Models, Running, Agent access, Account.
   - **Self-hosting:** point to the repo README and the existing AI-assisted setup prompt.
   - **Next:** `/llms.txt`, `/library`.
3. **Per-deployment rendering (engineering choice).** The prompt's URL and the guide's links come from the request origin (`publicOrigin` / `requestOriginOrNull`, as the landing canonical tag already does). On harbour.cat that is exactly `https://harbour.cat/getting-started`, and a self-hosted deployment points at itself. The guide's sign-in doors use the same `isConfigured()` / `isEmailSignInAvailable()` gates as the hero. Reason: a static guide would send agents to doors that are switched off on some deployments.
4. **Making the guide public and findable:**
   - add `/getting-started` and `/getting-started.md` to `isAuthExemptPath` (`lib/guest-task-path.js`, the one exemption predicate, LIN-3346)
   - add both to `BASE_PUBLIC_PAGES` (`lib/scan-public-pages.js`) so the secret scan covers them
   - add both to the sitemap entries (`routes/library.js` `sitemapEntries`)
   - add a "Getting started (for agents)" pointer to `public/llms.txt`, which the CLAUDE.md rule requires
5. **Drift guard (engineering choice).** A unit test asserts that every path the guide names (`/auth/*`, `/workspace/<urlKey>/runner`, `/api/proxy/instructions`, settings area ids) resolves to a registered route or a `settings-areas.js` id, and that a disabled door is absent from the rendered guide. Reason: the guide describes the product to agents, so a stale guide is worse than none. The repo already checks hand-written facts against source this way, for example the source-map invariants.
6. **Tests:**
   - unit tests for the landing section (the prompt is present, carries the origin, has the copy control) and both guide routes (status, content type, CSP, no session needed)
   - an e2e check in `tests/e2e/landing.spec.js` that Copy puts the prompt on the clipboard and the link resolves
7. **Docs:** a line in `docs/architecture/source-map.md` for the new module and route.

### Out of Scope

- **Signing in, consenting or minting a credential on the user's behalf.** OAuth consent, the email link, and the runner and API key mints are deliberately human-in-browser, and the runner credential is never rendered server-side. This ticket does not change that.
- **The authenticated Home (`/workspace/<urlKey>/`).** The feedback was filed from there, but the ask names "the homepage", meaning the public `/` that harbour.cat visitors land on. Home already has its own first-visit slot (`home-copy-first-card`). See Open Questions.
- **The localhost `setupNotice` "Getting started" banner** (render-landing and render.js). It is a different audience (self-hosters with no auth configured) and stays as is.
- **Cuts to the ask, quoted. Each needs the ruling below; until it is answered, none of them is agreed:**
  - **Cut 1:** *"we can have essentially a full guide on how to properly configure Harper for whatever your situation is without the user needing to follow those steps"*. Sign-in, the runner credential, Workspace API keys, sources, dispatch defaults and presets, the OpenRouter key and features have no agent-operable path. Some are human-only by design, and some only because no Workspace API endpoint exists. The guide will be full, and the agent will drive it, but the user still performs the browser steps the agent names. Model routing is the one settings area the agent can change itself once it holds a write token.
  - **Cut 2:** *"it can decide whether to have a conversation with the user or review The repositories and the settings"*. Reviewing the repositories is delivered. Reviewing "the settings" is possible only after the user mints a Workspace API key, and even then only for what the API exposes (`/api/proxy/me`, model routing, periodicals, north star, credential health). Before that, the agent reviews settings by walking the user through Settings, not by reading them.
- **Ruling requested (one question):** accept Cuts 1 and 2 as described, so the guide hands the browser-only steps to the human with exact instructions? Or widen this ticket to add Workspace API endpoints for the onboarding settings (sources, dispatch defaults and presets, features), so the agent can configure and review them directly? **Recommendation: accept**, and file agent-writable settings as a separate ticket if wanted. Opening settings writes to tokens is a security-surface change (grants, audit, change-log, undo) that the team should design on its own, not as a side effect of a homepage section.

### Assumptions

- "The homepage" is the public landing `/` on harbour.cat, and "harbour.cat/getting-started" is the canonical guide URL on production.
- The prompt is static apart from the deployment origin. The landing is signed-out, so it cannot know the visitor's tracker or repo, and the agent finds those out from the guide.
- The guide is product documentation served by the app. It is not a prompt template, so the prompt-size freeze (`tests/unit/prompt-size-budget.test.js`) does not apply. If reviewers decide it does, its ceiling is recorded with this reason.
- Agents can fetch a public URL. Claude Code and Codex can. Where an agent cannot, the HTML page is readable by the human as a fallback.
- No new runtime dependency is needed: markdown is rendered with `marked`, already a dependency, through the Library's safe renderer (`lib/library.js`). There is no build step.

### Success Criteria

- `/` shows the agent-start section before "try it yourself". Copy puts the prompt on the clipboard on desktop and at 360px width, with no horizontal scroll.
- The copied prompt's URL is `<request origin>/getting-started.md`, which is `https://harbour.cat/getting-started.md` on production.
- `GET /getting-started` and `GET /getting-started.md` return 200 with no session, carry `nosniff` and the stated CSPs, and appear in the sitemap, `llms.txt` and the public-pages scan.
- The guide covers every section listed under In Scope, and lists only sign-in doors enabled on the serving deployment (test-enforced).
- Every route and settings area the guide names exists (drift test green).
- A dry run passes: pasting the prompt into Claude Code against a fresh repo produces an agent that asks no more than the guide says it should, names the right sign-in door, and stops for the human at each browser step. The PR records this, because CI cannot prove it.
- `npm test` and `ci-success` are green, and CLAUDE.md stays within its byte limit (the source-map line goes in docs, not CLAUDE.md).

### Open Questions

1. **The ruling on Cuts 1 and 2** (above): accept, or widen to agent-writable settings. Recommendation: accept, with a follow-up ticket.
2. **Placement:** directly before "try it yourself" (recommended, leaves the settled hero alone) or higher, just under the hero, where an install command usually sits. This is a copy and design call and can be settled at review.
3. **The authenticated Home:** should a signed-in user without a runner also see this prompt, for example in the `home-copy-first-card` slot? Recommendation: not in this ticket. Revisit after seeing whether agents complete onboarding from `/`.
