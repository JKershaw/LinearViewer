## Scope

**Goal, in one line:** a signed-out visitor to the homepage can copy a short prompt, give it to their own coding agent, and that agent reads a public Harbour setup guide and walks them through getting Harbour set up for their situation. The agent does every step it can, and tells the person exactly which steps only they can do.

**What the code shows (checked at HEAD `e1f75fe7`):**

- **The homepage has no "getting started" section like an npm-install block.** `/` renders `lib/render-landing.js`: the hero sign-in buttons, "the loop", three glimpses, "Try it yourself" (`renderTrySection`: sign-in buttons plus pricing), providers, Harbour OS, Library and Archive. The only block called "Getting started" is the localhost-only `setupNotice`, which covers `.env` setup for self-hosters. So "the getting started section" means a new section on the landing page. It is not a change to an existing one.
- **`harbour.cat/getting-started` does not exist.** No route serves it. The public pages written for agents today are `/llms.txt`, which is a guide to DOM selectors, and the Library's `.md` documents. The top line of `/llms.txt` is out of date: it still calls Harbour "a minimal web app that displays your task tracker's projects and issues as a collapsible tree".
- **Copy-to-your-agent prompts already exist,** so this follows an established pattern and does not invent one. Examples: the runner page (`/workspace/:urlKey/runner`, where you mint a key and then copy the runner prompt into Claude Code), the copy-first "Write the prompt / Copy prompt" flow on Home, and the old self-host "AI-assisted setup" prompt in `content/landing.md`. That file now only feeds the swipe/swim/ship previews.
- **What an agent can and cannot do during onboarding.** Some steps can only happen in a browser session: signing in (OAuth or email), creating a Local workspace (`POST /workspace/new`), connecting OpenRouter (`/auth/openrouter/*`), changing workspace settings (`routes/settings.js`), and minting a runner key or proxy token. These are consent and credential steps, and only an owner can do them by design (runner keys and enqueue grants, LIN-3136 / LIN-3409). Once the person gives the agent a runner bootstrap or a proxy token, the agent can run as the runner, read and write the backlog, and read or change model routing through `/api/proxy/*`. Workspace settings cannot be read through the proxy at all.

**Is this a symptom of something deeper? Yes.** Harbour has no single written onboarding path, for agents or for people. The steps are spread across the landing page's Try section, the sign-in pages, Settings (OpenRouter and the free tier), the copy-first card on Home, the runner page, the Proxy page, the README (self-hosting) and an out-of-date `llms.txt`. The cause is the missing canonical guide, and the guide is the core of this ticket. The homepage prompt is only the way in. Because the guide describes flows that change often (which sign-ins a deployment offers, whether the free tier is offered, runner states), its facts must come from code, and the paths it names must be checked by a test. Otherwise it goes stale like `llms.txt` did.

### In Scope

1. **A public setup guide at `/getting-started`**, with no session needed:
   - `GET /getting-started.md` returns `text/markdown`. Agents read this one.
   - `GET /getting-started` returns the same content as an HTML page in the landing chrome, for a person who clicks the link.
   - One source: `content/getting-started.md`, with a few facts filled in from code at render time: this deployment's origin, the sign-in options it offers (the same `entryCta.isConfigured()` checks the hero uses), and whether the free tier is offered (`isFreeTierOffered()`). The guide never hard-codes these. *Reason:* the landing page already draws its glimpses and pricing from the app's own facts (LIN-3980), and the guide should not be the one surface that can drift.
   - What the guide covers, written for the agent as reader:
     - what Harbour is and the words it uses (workspace, copy-first vs runner, stage, run, evidence);
     - finding out the person's situation: which tracker, which repositories, which agent, hosted or self-hosted, free tier or their own OpenRouter key, solo or team, owner or member;
     - the agent's choice to ask the person or to look at their repositories (tracker, CI, GitHub remote) and recommend a backend and a starting rung;
     - **the steps only the person can do, written as exact click-by-click instructions the agent passes on**: sign in with X, create a Local workspace, connect OpenRouter or use the free tier, install the GitHub App for PR and CI evidence;
     - a first win on the copy-first path (open a task, write the prompt, paste it to the agent);
     - becoming the runner (the owner opens `/workspace/<urlKey>/runner`, mints a key and pastes the runner prompt; the guide hands over to that prompt and does not repeat it);
     - optionally, a proxy token so the agent can tidy up the backlog (`/workspace/<urlKey>/proxy`, then `/api/proxy/instructions`);
     - a self-hosting branch that points at the README;
     - **safety rules**: never ask for provider passwords or OAuth secrets in chat; a credential only ever comes from Harbour's own mint flows; a bootstrap token works once.
2. **A homepage section with the agent prompt.** It is a new landing section (`data-testid="landing-agent-start"`) placed directly after "the loop", so the visitor already knows what Harbour is. It holds the prompt (two short paragraphs) in a bounded, selectable box and a Copy button. The existing Try section stays as the click-through path.
   - The prompt's link is built from the request origin (`requestOriginOrNull` / `publicOrigin`). On harbour.cat it is `https://harbour.cat/getting-started.md`, and a self-hosted instance points at its own guide. *Reason:* a hard-coded harbour.cat link would send self-hosters' agents to the wrong deployment.
   - The prompt text is the same for everyone, because the visitor is signed out and Harbour knows nothing about them. All the tailoring to their situation happens in the guide. This settles the triage question "static vs context-aware".
   - Copy follows `public/runner-setup.js`: the clipboard is written inside the click, and if that is refused the text is left selected. With no JavaScript the box is still selectable. It must work at phone width, since the ticket was filed from an Android phone.
   - Draft prompt, to be finalised and quoted in the PR for review, the same way `HARBOUR_PLAIN_SENTENCE` was:
     > I'd like your help setting up Harbour (https://harbour.cat). Harbour is a control plane for coding agents. It reads a backlog (Linear, GitHub Issues, GitHub Projects, Jira or its own local store), writes a grounded prompt for the next task, runs it on a coding agent like you, and checks the result against real evidence such as CI and merged pull requests.
     >
     > Read the setup guide at https://harbour.cat/getting-started.md and follow it. It explains what Harbour needs, which steps only I can do in a browser, and which steps you can do. Ask me what you need to know or look at the repositories we work in, then take me through it one step at a time.
3. **Fix the cause where agents already land:** rewrite the out-of-date overview line in `public/llms.txt` and add a "Getting started" entry that points at `/getting-started.md`. An agent that finds harbour.cat on its own will reach the same guide.
4. **Publishing plumbing:** add `/getting-started` to `sitemapEntries` (`routes/library.js`) and to the public-page secret scan list (`lib/scan-public-pages.js`). Add one line to `docs/architecture/source-map.md` saying where the guide lives.
5. **Tests:**
   - unit tests for the render: the prompt is present and its link uses the request origin;
   - both route forms are served with no session, with the right content types;
   - the sign-in options in the guide match the configured ones;
   - **a drift guard**: every Harbour path the guide names resolves to a registered route;
   - a Playwright landing spec: the section is visible and Copy works at phone width.

### Out of Scope

- **One cut to the ask, needing a ruling (raised once, below).** The quoted parts are delivered only partly:
  > "without the user needing to follow those steps as the use uses the agent having naturally would"

  and, in the same sentence about what the agent can do,
  > "review The repositories and the settings"

  Delivered: the agent does the explaining, asks the questions, reviews the repositories, makes the recommendation, works the copy-first path, runs as the runner, and tidies up the backlog. **Not delivered:** the person still clicks the browser-only steps themselves (sign in, connect OpenRouter or the free tier, install the GitHub App, mint the runner key or proxy token). The agent tells them exactly what to click, but cannot do it for them. The agent also cannot read Harbour's workspace settings itself, because no API exposes them. It can only read model routing, and only once it holds a token. It learns the rest by asking the person. *Proposed ruling:* agree the cut. Those steps are where the person gives consent and credentials, and only an owner can do them by design. An agent-started way to get them approved would be a change to the security model, not a landing page change (see Open Questions).
- Measuring whether visitors use the agent path, for example counting `/getting-started.md` fetches in the `/kpis` milestone funnel. That is a separate problem with its own privacy boundary (`lib/kpi-stats.js`). It can be a follow-up.
- Changing the sign-in, OpenRouter, runner or proxy flows themselves. The guide describes them as they are.
- The out-of-date self-host prompt in `content/landing.md`, which only feeds the swipe/swim/ship previews. The guide's self-hosting branch replaces it as the place to send people. Removing it from the preview data is cleanup, not this ask.

### Assumptions

- "The getting started section" means a new landing section, because none exists. "harbour.cat/getting-started" means this deployment's `/getting-started`, which is harbour.cat in production. The `.md` form is the one the prompt links, because agents read markdown more reliably than HTML. The HTML form serves people who click.
- The guide and the landing prompt are not stage prompts, so `tests/unit/prompt-size-budget.test.js` does not apply to them. The prompt stays "a couple of paragraphs" (about 1,000 characters at most), and a unit test checks that limit.
- The readers are general-purpose coding agents (Claude Code and similar) that can fetch a URL. The guide does not depend on any one vendor's tools, except where it hands over to the existing runner prompt, which is written for Claude Code.
- No changes to auth, credentials or settings APIs are needed for the in-scope work.

### Success Criteria

- On `/`, signed out, a section after "the loop" shows the agent prompt and a Copy button. At phone width (about 360px) Copy puts the exact prompt on the clipboard, or leaves it selected, with no horizontal scroll. Without JavaScript the prompt is still selectable.
- The prompt's link is `<request origin>/getting-started.md`. It is `https://harbour.cat/getting-started.md` on harbour.cat.
- `GET /getting-started.md` (`text/markdown`) and `GET /getting-started` (HTML) return 200 with no session. The guide lists only the sign-in options this deployment offers and states the free tier correctly for this deployment.
- The guide covers every item in In Scope §1. It says plainly which steps the person must do in the browser, and it carries the safety rules.
- A unit test fails if the guide names a Harbour path that no route serves.
- `/llms.txt` no longer describes Harbour as a tree viewer and points at `/getting-started.md`. The sitemap and the public-page secret scan include `/getting-started`.
- A dry run: a fresh agent given only the copied prompt, with a signed-out person on harbour.cat, reaches a signed-in workspace with a copied first prompt. The person does only the browser steps the guide names. The PR records the transcript or a summary of it.
- `npm test` is green and `ci-success` is green.

### Open Questions

1. **Ruling needed: the cut quoted under Out of Scope.** Should the person still do the browser-only consent and credential steps themselves, with the agent telling them exactly what to do, and should the agent learn workspace settings by asking? Recommendation: yes, agree the cut, and file a follow-up ticket to explore an agent-started approval flow. In that flow the agent would request a credential and the person would approve it once in the browser, like a device-code login, perhaps with a proxy read of workspace settings. That follow-up changes the credential model and needs its own design. Until this is answered, the cut is not agreed.
