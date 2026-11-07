## Scope (scoping stage, 2026-11-07)

**What this delivers, in one line:** a signed-out visitor to `/` can copy a short prompt for their coding agent. The prompt sends the agent to a public `/getting-started` guide, written for agents, and the agent then walks the person through setting up Harbour for their situation. The person's first contact with Harbour goes through the agent they already use.

### What the code shows (checked at `e1f75fe7`, 2026-11-01)

- **There is no "getting started" section on the live homepage.** The signed-out landing (`lib/render-landing.js`, `renderLandingPage`) runs: hero with sign-in buttons → the loop → glimpses → "try it yourself" → providers → Harbour OS → library → archive. The only "Getting started" block is the `setupNotice` box. It renders only on `localhost` with no auth configured (`server.js` `/` handler). This feature adds a new section. It does not restyle an existing one.
- **Signed-in users never see `/`.** It redirects them to their workspace. The page the feedback came from (`/workspace/linearviewer/`) was not the target. The target is the public homepage at `harbour.cat/`.
- **`/getting-started` does not exist.** No route, doc or library entry uses that path, so it is free.
- **An agent cannot sign the person in.** Every way in needs the person in a browser: Linear, GitHub or Jira OAuth, an emailed magic link, or the zero-credential `+ local workspace` form (`POST /workspace/new`, offered on the `/swipe` preview). Once the person is signed in, an agent can do a lot. It can use a workspace token minted at `/workspace/:urlKey/proxy` (read and write the backlog, generate and recommend prompts, read and write model routing). It can use the copy-first prompts and the task progress key. With the runner prompt at `/workspace/:urlKey/runner` and `GET /api/proxy/runner/prompt` it can take dispatched work. The guide is therefore a handoff: the person does the browser steps, then hands the agent a token, and the agent does the rest.
- **Precedents to reuse, not reinvent:**
  - The library serves public docs as HTML plus `.md` (`routes/library.js`).
  - The runner prompt fills deployment facts into a markdown source (`lib/prompts/runner-kickoff.js`).
  - The landing already forks its copy on deployment predicates (`isFreeTierOffered()`, `entryCta.isConfigured()`, `isEmailSignInAvailable()`).
  - `requestOriginOrNull` / `publicOrigin` give the absolute origin.
- **Staleness check:** the ticket names no source files. `git log --since=2026-10-31` over the landing, hero, `landing.css`, `content/landing.md`, `llms.txt`, library and runner-prompt paths shows no commits after the ticket was filed. The last landing-adjacent change, LIN-2255 on `llms.txt` (10-31), does not touch this.

### Is this a symptom of something deeper?

Partly, and the scope follows from it. The 2026-10-23 onboarding cold-start review (`docs/reviews/onboarding-cold-start-review-2026-10-23.md`) found two things:

- A working path in exists (the free-tier local door gets to a grounded prompt in seconds), but "the product does not point anyone at this path": the try-it block has no control, and `/llms.txt` names no way in.
- `/kpis` showed fewer than 5 sign-ups and 0 first Go presses in 30 days.

The underlying problem is that nothing tells a newcomer, or their agent, how to get from "landed" to "first useful result". The homepage prompt is only the entry point. **Most of the value is in the guide**: it has to be accurate per deployment and has to tell the agent what it can do and what only the person can do. So the guide is in scope as a first-class, tested deliverable, and `llms.txt` gets its missing "way in".

### In Scope

1. **Homepage section "Get started with your agent".** It sits on the signed-out landing directly under the hero, above "the loop", and plays the role an `npm install` box plays on a developer tool's page. It contains a one-line lead, the prompt in a bounded mono box, and a **Copy** button (`data-testid="landing-agent-prompt"` / `landing-agent-prompt-copy`).
   - Works without JS: the text stays selectable.
   - On mobile, Copy falls back to selecting the text when the Clipboard API is unavailable.
   - No horizontal scroll at 390px. The feedback was filed from an Android phone.
   - Colours come only from the semantic tokens, so it works in dark mode by construction, like the rest of `landing.css`.
   - The sign-in buttons stay the primary action.
2. **The prompt text: static, a few short paragraphs, with the URL filled per request.** It names this instance's absolute `/getting-started` URL, taken from `requestOriginOrNull(req)` and falling back to `https://harbour.cat` on the logout render, which has no request. A self-host then points at itself, not at production. Draft, to be quoted in the PR for review (LIN-3980 precedent):
   > I'd like to start using Harbour (<origin>), which reads my task backlog, writes grounded prompts for coding agents, runs them, and checks the results against real evidence like CI and merged pull requests.
   >
   > Please read the setup guide at <origin>/getting-started and use it to help me set Harbour up for my situation. Look at this repository and how I track work first, ask me only what you can't find out, and tell me clearly which steps I have to do myself in the browser, such as signing in.
   >
   > If you can't open the link, say so and I'll paste the guide in.
3. **A public `/getting-started` guide written for an agent.** It is unauthenticated and indexable, and served two ways:
   - `/getting-started`: HTML in the shared shell.
   - `/getting-started.md`: `text/markdown`, the same content.

   There is one markdown source in the repo, with a few deployment facts filled in at request time from the same predicates the landing uses: the base URL, which sign-in options are configured, and whether the free tier is offered. The guide therefore never promises a way in that the server would 503 (the LIN-1890 rule). It covers:
   - what Harbour is and what the loop is, in plain words;
   - **what the agent should do first**: inspect the repo (git remote, `.github`, issue references in commits and branches, `README` or `CLAUDE.md`) to infer the tracker and setup, and only then talk to the person. The guide gives guidance on when to ask and when to infer;
   - **steps only the person can do**, clearly marked: open the site and sign in with the matching backend (Linear, GitHub, Jira or email when configured, or `+ local workspace` with no account), and add an OpenRouter key in Settings or use the free tier when it is offered;
   - **handing the agent access**: the person mints a workspace token at `/workspace/<urlKey>/proxy` (which scope to choose and why) and pastes it to the agent. The agent then reads `GET /api/proxy/instructions` and works through the proxy API;
   - **configuring for the situation**, as a short decision guide over what exists today: backend choice, connecting GitHub for PR and CI evidence, model routing defaults (readable and writable over the proxy API), and the optional own-session runner (`/workspace/<urlKey>/runner`) for people who want Harbour to dispatch to the agent;
   - **the first useful result and how to confirm it**: the first prompt written for a real task, then optionally the first Go;
   - **safety rules for the agent**: never ask for provider passwords or OAuth secrets, treat tokens as secrets, and do not paste tokens into tickets or commits.
4. **Discoverability:** `public/llms.txt` gets a "Getting started" entry pointing at `/getting-started` and `.md`. That closes the review's "names no way in" finding, and CLAUDE.md requires `llms.txt` to be kept current. The sitemap (`routes/library.js`) lists `/getting-started`, and `BASE_PUBLIC_PAGES` in `lib/scan-public-pages.js` includes it so the public-page secret scan covers it.
5. **Drift guards (engineering choice: the guide is only useful if it stays true).**
   - A unit test asserts that every in-app path the guide names (`/workspace/:urlKey/proxy`, `/workspace/:urlKey/runner`, `/api/proxy/instructions`, `/auth/*`, `/workspace/new`, …) matches a registered route.
   - Render tests cover both deployment forks: free tier on or off, and each sign-in option on or off.
   - The landing test asserts that the section, the Copy control and the absolute guide URL are present.
   - E2E: signed-out `/` shows the section, and Copy copies the text. `/getting-started` and `.md` return 200 with no session.

### Out of Scope

- **Letting the agent sign the person in**, for example a device-code or "approve this agent" handoff that mints a token without the person visiting the proxy page. This would be a new auth surface. It is the obvious follow-up if the manual token handoff turns out to be where people drop off. File it separately and do not build it here.
- **A context-aware or personalised prompt.** The landing is public and static, and the visitor has no context yet, so the prompt is static apart from the origin. The guide does the adapting.
- **New proxy endpoints for settings that are browser-only today**, such as saving an OpenRouter key over the API. The guide marks those steps as the person's.
- **The signed-in workspace Home onboarding** (`topTaskOnboarding`, the copy-first card). It is a different surface and is unchanged.
- **The stale "AI-assisted setup" self-host prompt** in `content/landing.md`, which renders only on the `/swipe`, `/swim` and `/ship` previews. It is Linear-only and self-host-only. Replacing it with this prompt is a reasonable follow-up, but it is a separate preview-content change.
- **A full self-hosting walkthrough** in the guide. It links to the README for self-hosters and assumes the hosted instance (or whichever instance is serving it).
- **Rewriting the "try it yourself" section or the localhost `setupNotice`.** Both stay as they are.

### Assumptions

- "Homepage" means the signed-out landing at `/`. Signed-in users are redirected away from it, so they are unaffected.
- The agents in view (Claude Code, Codex, Cursor and similar) can fetch a public URL. The prompt's last line covers the ones that can't.
- The manual token handoff (mint at `/workspace/<urlKey>/proxy`, paste to the agent) is an acceptable first-time step for v1.
- The guide is a product page, not a library essay. It gets its own route rather than a `START_HERE` slot, but it reuses the library's markdown-to-HTML rendering.
- Plain-English copy rules apply: no internal product words like "dispatch grant", following LIN-3995 and LIN-3980.

### Success Criteria

1. A signed-out `GET /` shows "Get started with your agent" directly under the hero. It holds the prompt and a working Copy button. It is usable at 390px without horizontal scroll, works in dark mode, and the text stays selectable without JS. Signed-in `/` still redirects.
2. The copied prompt contains the serving instance's absolute `/getting-started` URL.
3. `GET /getting-started` (HTML) and `GET /getting-started.md` (`text/markdown`) return 200 with no session, from one source. The sign-in options and the free-tier wording match the deployment's predicates, and both forks are tested.
4. Every in-app path the guide names resolves to a registered route, enforced by a unit test.
5. `llms.txt` and `sitemap.xml` link the guide, and the public-pages scan includes it.
6. **What CI cannot prove**, performed once and recorded in the PR: a fresh agent session given only the copied prompt, in a real repo, fetches the guide, works out the backend, tells the person exactly which browser steps are theirs, and, once handed a token, reads the backlog through `/api/proxy/*` and gets a first prompt written for a real task.
7. `npm test` is green and `ci-success` passes.

### Open Questions (product, non-blocking; defaults above apply unless overruled)

1. **Prominence.** Default: its own section directly under the hero, with the sign-in buttons kept primary. The alternative is to put the prompt inside the hero next to the buttons as the headline path. Recommendation: keep the default until `/kpis` shows whether agent-led arrivals convert.
2. **Hosted-first.** Default: the guide steers to the hosted instance and only links the README for self-hosting. Confirm that is the intent.
3. **Follow-ups to file if wanted:** the agent sign-in handoff, and replacing the stale self-host prompt on the previews.
