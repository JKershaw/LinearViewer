## Scope (scoping stage, grounded at `e1f75fe7`)

**What this delivers, in one line:** the public homepage (`/`) gets a "Get started" box near the top. It holds a short prompt the visitor copies into their own coding agent, the way most software homepages show an `npm install` line. The prompt sends the agent to a new public page, `/getting-started`, written for agents. It walks the agent through setting up the user and their project on Harbour.

### What the code shows (re-grounding)

- **The production homepage has no "getting started" section today.** `lib/render-landing.js` renders a "┌─ Getting started" box only when `setupNotice === 'setup'`, which `server.js` (`app.get('/')`) sets only on an unconfigured **localhost**. It is a self-host `.env` hint, and harbour.cat never shows it. So this ticket **adds** a section. It does not change an existing one.
- **`/getting-started` does not exist.** There is no route for it, and it is not in `isAuthExemptPath` (`lib/guest-task-path.js`), so as things stand it would fall through to the auth middleware.
- **The feedback came from `/workspace/linearviewer/`** (signed-in Home, on an Android phone). Signed-in visitors never see `/`, because it redirects them to their workspace. The comparison to `npm install` points at the public landing, so that is where the box goes (see Assumptions).
- **Some steps can only be done by a person in the browser.** An agent cannot do these:
  - Sign-in uses OAuth or an email magic link in the browser.
  - The runner credential is minted owner-only at `/workspace/:urlKey/runner`.
  - Backends, the OpenRouter key, feature flags and theme are session-only Settings with no API.

  What an agent *can* reach with a Workspace API token (the `+proxy` copy mint, or a runner credential):
  - the backlog through `/api/proxy/*`;
  - `/api/proxy/instructions`;
  - model routing, read and write, through `/api/proxy/model-routing`.
- **Staleness check:** none of the referenced files changed after the ticket was filed: `lib/render-landing.js`, `lib/components/landing-hero.js`, `public/landing.css`, `public/llms.txt`, `lib/library-metadata.js`, `routes/runner-setup.js`, `lib/prompts/runner-kickoff.js`, `content/landing.md`. The one commit since then (`e1f75fe7`, LIN-4080) touched `server.js` only for run-stop wake gating, which has nothing to do with this ticket.

### This ticket is aimed at a symptom of something deeper

The latest onboarding review (`docs/reviews/onboarding-cold-start-review-2026-10-23.md`) found two things:

- **R3-17:** the production funnel had fewer than 5 sign-ups, **0 first Go presses** and 0 merges in 30 days.
- **R3-6:** "the best cold path is unadvertised … `/llms.txt` names no way in".

`public/llms.txt`, the file agents are told to read, still opens by calling Harbour "a minimal web app that displays … a collapsible tree" (review item D1). So the deeper problem is that **Harbour has no agent-readable way in**, and newcomers stall between signing up and their first run. That cause is in scope here: `/llms.txt` gets fixed and points at the guide (In Scope, item 4).

### In Scope

1. **A "Get started" section on the landing page** (`lib/render-landing.js`, `public/landing.css`). It sits directly under the hero's sign-in buttons, so it is visible on the first screen.
   - A terminal-styled block (reuses `.lx-terminal`) holding the prompt, with a **Copy** button. It must work at 390px and 320px, in both light and dark themes, since the idea came in from a phone.
   - The prompt is **static text, about two paragraphs**. Only the guide URL is filled in. Draft (the builder finalises the wording, follows `docs/papers/harbour/plain-language.md`, and quotes the final text in the PR, as LIN-3980 did with `HARBOUR_PLAIN_SENTENCE`):
     > I'd like to start using Harbour, which reads my task tracker, writes a prompt for the next step of each task, runs it on coding agents like you, and checks the result against real evidence such as CI and merged pull requests.
     >
     > Please read the getting-started guide at {origin}/getting-started and use it to set me up. Look at what you can already see of my repositories first, ask me only what you can't work out yourself, and when a step needs me in the browser, tell me exactly what to click.
   - The localhost `setupNotice` box stays as it is, shown only on an unconfigured localhost.
2. **A public `/getting-started` guide written for agents.**
   - `GET /getting-started` serves HTML for people. `GET /getting-started.md` serves plain `text/markdown` for agents.
   - It is added to `isAuthExemptPath`. It does **not** redirect signed-in visitors.
   - It is listed in `/sitemap.xml`.
   - Engineering choice: write the guide as one markdown source and reuse the Library's markdown rendering and `.md` serving (`routes/library.js`, `lib/library.js`), so there is no second renderer. Reason: the Library already serves both forms under a sandboxed CSP.
   - The guide covers:
     - (a) what Harbour is, in plain words;
     - (b) **two ways for the agent to work, chosen by the agent:** interview the user, or review the repositories it can see (CI, tests, `CLAUDE.md`/agent docs, where issues are tracked), then ask only about what is still unclear;
     - (c) choosing a backend. The names come from the provider registry. It includes the zero-credential hosted Local workspace with the free tier, which is the unadvertised path R3-6 found;
     - (d) the steps only a person can do, with the exact clicks for each: sign in, OAuth consent, connecting OpenRouter or using the free tier, installing the GitHub App so Harbour can see CI and PRs, and minting a runner credential;
     - (e) what to set in Settings, and why, for each situation;
     - (f) the first task: open it, copy the prompt, and have the agent run it. This is the "first Go" step in the funnel;
     - (g) optional: becoming the workspace runner (Claude Code only), which points at `/workspace/:urlKey/runner`;
     - (h) self-hosting: the README, and the same steps as the AI-assisted self-host prompt in `content/landing.md`.
   - **It describes only what the code does today:** nowhere does it say an agent can do a human-only step.
3. **Guards so the guide stays true** (the same idea as LIN-3980's "glimpses show the app's own words"):
   - a unit test that every in-app path the guide names matches a registered route;
   - a unit test that every backend it names comes from `getAllProviders()`;
   - a test that the landing prompt's link is built from the request origin.
4. **`/llms.txt` gets a way in.** The opening summary is rewritten so it describes Harbour as it is now (D1), and a "Getting started" entry pointing to `/getting-started` and `/getting-started.md` sits near the top.
5. **Tests:**
   - `tests/unit/render-landing.test.js`: the section renders, the Copy control is present, the guide URL is absolute and taken from `origin`.
   - A route test for `/getting-started` and `.md`: 200 with no session, correct content types, no redirect when signed in.
   - The sitemap includes the guide.
   - An E2E or visual check of the landing box at 390px in both themes.

### Out of Scope

- **Different problems, excluded:**
  - **An onboarding prompt on signed-in Home** (`/workspace/:urlKey/`, the copy-first-card slot from LIN-3833). The ask names the homepage. See Open Questions.
  - **A context-aware prompt** that changes with backend, sign-in state or similar. The prompt is static, and the guide does the adapting.
  - **New agent-facing APIs:** an API for Settings or feature flags, or an agent-driven sign-in. These are separate, security-relevant work (see the ruling below).
  - **Rewriting the rest of `llms.txt`** (its DOM and selector sections). Only the summary and the way-in entry change.
- **Cuts to the ask (one ruling below; until it is answered, none of these is agreed):**
  - Quoted: *"we can have essentially a full guide on how to properly configure Harper for whatever your situation is **without the user needing to follow those steps** as the use uses the agent having naturally would"*
    - **Proposed: delivered in part.** The user never reads or follows the guide; the agent does. But with today's code the agent still has to ask the person for a few browser actions: signing in and giving OAuth consent (these can never be handed to an agent), plus connecting backends and OpenRouter, setting feature flags and minting the runner credential (there is no agent API for these). The guide keeps those actions as few as possible and gives the exact clicks.
  - Quoted: *"it can decide whether to have a conversation with the user or review The repositories **and the settings**"*
    - **Proposed: delivered in part.** The agent reviews repositories directly. It can read Harbour **settings** directly only where a Workspace API token reaches: the backlog and model routing. Everything else in Settings it reviews through the person (for example by asking what a screen shows).
  - Neither gap is closed in this ticket. **Recommendation:** accept both partial deliveries, and file a follow-up for an owner-scoped agent API covering the Settings an agent could safely change (feature flags, workspace preferences). Sign-in and OAuth consent stay with the person in every case.

### Assumptions

- "The homepage" means the public landing at `/` (`lib/render-landing.js`). This is based on the `npm install` comparison and the fact that signed-in visitors are redirected away from `/`.
- "harbour.cat/getting-started" means the **request's own origin** + `/getting-started`, using `publicOrigin` (the canonical tags already do this). On harbour.cat that is exactly the URL asked for, and a self-host points at itself. When no origin is known (the logout render passes `origin: null`), the link falls back to `https://harbour.cat/getting-started`.
- The guide and the landing prompt are product copy, not stage prompt templates. So the prompt-size freeze (`tests/unit/prompt-size-budget.test.js`) does not apply, and no ceiling is raised.
- The prompt should work with any agent (Claude Code, Codex, Cursor and others). Only the optional runner section says it is for Claude Code only.
- No new runtime dependency: the existing clipboard pattern from `public/app.js` and the Library renderer are reused.

### Success Criteria

- A signed-out visitor at `/` on harbour.cat sees the "Get started" box on the first screen, at 1400px and at 390px, in both themes. **Copy** puts the whole prompt on the clipboard.
- The copied prompt contains an absolute link to `<origin>/getting-started`.
- `GET /getting-started` returns readable HTML, and `GET /getting-started.md` returns `text/markdown`. Both work signed out without redirecting, signed-in visitors get them too, and both are in `/sitemap.xml`.
- Pasted into a fresh Claude Code session with no other context, the prompt takes the agent to the guide. The agent then either reviews the repo or asks questions, names the right backend, and gives the person exact click-by-click steps for the human-only actions. It never claims to have done one of those itself. This is checked by hand once, and the transcript is linked in the PR.
- The tests in In Scope items 3 and 5 pass. Renaming or removing a route or provider that the guide names makes a test fail.
- `/llms.txt` describes Harbour as it is now and names `/getting-started` near the top.
- Signal after release, not a merge gate: the `/kpis` "How people get started" funnel shows first-Go presses above 0.

### Open Questions

1. **Ruling on the two partial deliveries quoted above** (accept, or expand this ticket to include the agent Settings API). Recommendation: accept, and file the API as a follow-up.
2. **Should signed-in Home get the same prompt** in its onboarding slot (LIN-3833's copy-first card), for people who signed in before finding it? Recommendation: a follow-up ticket, once the landing version proves out.
3. **Final prompt wording.** The draft is above. The builder quotes the final text in the PR, and the owner approves it there.
