## Scope

**Goal, settled.** Give a signed-out visitor a second way to start: a short prompt they copy from the homepage and paste into their own coding agent. The prompt sends the agent to a new public guide, `/getting-started`. The guide tells the agent how to get this person and this project set up on Harbour. It is clear about which steps only the human can do (signing in, approving access) and which the agent can work out for itself (which tracker, which repo, copy-first or runner, which settings). "Done" means a visitor can do this end to end. Today they can't: no such section exists, and `/getting-started` returns 404.

### What the code shows (re-grounded at `e1f75fe7`, 2026-11-01)

- **The homepage has no "getting started" section.** The ticket assumes one exists. The signed-out `/` is `lib/render-landing.js` (`renderLandingPage`). It is built from the hero with its sign-in buttons (`lib/components/landing-hero.js`), then the loop, three preview panels, "Try it yourself" (`renderTrySection`, which has sign-in buttons but no install or command step), providers, Harbour OS, Library and Archive. The only text with "Getting started" in it is the `setupNotice` box, which appears only on an unconfigured localhost. `content/landing.md` is no longer the homepage: it only feeds the `/swipe`, `/swim` and `/ship` previews. Its old "AI-assisted setup" self-host prompt is the precedent for this idea, but nobody visiting `/` sees it.
- **`/getting-started` does not exist.** No route, file or link exists for it, so it is built here.
- **What the guide has to explain already exists:** sign-in by Linear, GitHub, Jira or email, all human-only browser flows; the free tier or an OpenRouter key (Settings › Account); copy-first prompts; the own-session runner at `/workspace/<key>/runner`, which needs Claude Code, Node 18+ and macOS or Linux (`lib/render-runner-setup.js`); agent keys and the proxy API (Settings › Agent access, `/api/proxy/instructions`); and the zero-credential Local workspace (`+ local workspace` in the nav).
- **Staleness check:** `git log --since=2026-10-31` over the landing, hero, `content/landing.md`, `public/llms.txt`, library and route files shows only `e1f75fe7` (LIN-4080, the dispatch wake gate), which does not touch any of these surfaces. The last landing changes were LIN-3980 and LIN-3995 on 2026-10-26, and the description above is read from HEAD.

### This is aimed at a symptom

The 2026-10-23 onboarding review (`docs/reviews/onboarding-cold-start-review-2026-10-23.md`) found these problems:

- The best ways into Harbour are not written down anywhere a newcomer (or their agent) would find them.
- "Try it yourself" has no control (J6).
- `/llms.txt`, the agent-facing file, "names no way in" (J7), and its first line still describes "a … web app that displays … a collapsible tree" (D1).
- The live `/kpis` funnel showed 0 first Go presses in 30 days.

The cause is that there is no single, maintained description of how to start. This ticket fixes that cause: the guide becomes that description, the homepage prompt and `/llms.txt` both point to it, and a test keeps what it says about routes and requirements true. It does not fix the separate blockers the review listed (see Out of Scope).

### In Scope

1. **Homepage section** (`lib/render-landing.js`, `public/landing.css`). Add a new section, `data-testid="landing-agent"`, directly under the hero. It is a peer of the sign-in buttons, the same position an `npm install` line takes on a developer tool's homepage. It has a short heading, one line of explanation, the prompt in a bounded box, and a Copy button that uses the existing clipboard pattern. Without JavaScript the box can still be selected. Colours come from tokens, so it works in dark mode, and it fits at phone width.
2. **The prompt.** It is the same text for every visitor, with no per-visitor personalisation, and it is two short paragraphs. The guide URL is absolute, built from `publicOrigin(req, { safeHost: true })`, so a self-hosted copy links to its own guide and the logout render, which has no origin, falls back to `harbour.cat`. The text lives in one exported constant, so tests and the guide quote the same words. Starting draft (final wording is reviewed in the PR):
   > I'd like to try Harbour (https://harbour.cat). It reads my issue tracker, writes a grounded prompt for the next task, runs it on coding agents, and checks the result against CI and merged code. Before doing anything else, read the setup guide at https://harbour.cat/getting-started.md.
   >
   > The guide says which steps are mine and which are yours. Signing in and approving access happen in my browser, so never ask me for a password. Look at this project and how I track work, tell me which setup the guide recommends for us and why, then walk me through it one step at a time. Check with me before you change any setting or file.
3. **The guide.** It is public, needs no session, and is written for an agent that reads it on the user's behalf. There is one source file (`content/getting-started.md`), served as HTML at `/getting-started` and as raw Markdown at `/getting-started.md`, following the Library's `.md` pattern. It covers:
   - what Harbour is (`HARBOUR_PLAIN_SENTENCE`);
   - the hard limits: only the human signs in and approves OAuth or email, and the agent never asks for passwords or creates accounts;
   - how to choose a path: which tracker the user has (or the Local workspace for a no-account trial, with the warning that it lives in that browser only), and whether to use copy-first prompts (works with any agent) or the own-session runner (Claude Code only, Node 18+, macOS or Linux);
   - the AI key choice: the free tier or the user's own OpenRouter key;
   - the first useful action: open a task and write or run its prompt;
   - optional depth: settings areas, agent keys and `/api/proxy/instructions`, Autopilot;
   - where to go next: Library, `/llms.txt`.

   Paths inside a workspace are written as `/workspace/<key>/…`, because the agent learns `<key>` from the user. Self-hosting gets one line pointing to the README, not a walkthrough.
4. **Point the agent surfaces at the guide.** Add `/getting-started` to the top of `public/llms.txt` as "the way in", and replace its outdated first-line definition with the current one. Add `/getting-started` to the sitemap (`sitemapEntries`, `routes/library.js`) and to the public-page secret scan list (`lib/scan-public-pages.js`).
5. **Tests:**
   - unit tests for the section (present, the prompt names the absolute guide URL, built from origin with the fallback) and both guide routes (200 signed out; HTML and `text/markdown`);
   - a drift test: every Harbour path the guide names is a registered route or a documented workspace path, and the runner requirements it states match `lib/render-runner-setup.js`;
   - a landing e2e assertion for copy;
   - updated visual snapshots for the landing if its layout changes.

### Out of Scope

These are separate problems that this ticket links to but does not fix:

- advertising the Local door on the homepage (LIN-2387);
- the self-host Linear button returning 503 when OAuth is unset (LIN-3108);
- no-cookie re-entry to a Local workspace (LIN-3065);
- workspaces not following an account across devices (LIN-2149/LIN-3141);
- the email send ceiling (LIN-3789).

These are deliberately not built:

- a personalised or signed-in version of the prompt;
- an MCP server or CLI installer;
- any API that lets an agent create an account or sign in without the human (sign-in stays human by design);
- a full self-host walkthrough in the guide;
- reworking the rest of the landing or the legacy `content/landing.md` previews.

### Assumptions

- The guide is the right home for onboarding steps. The homepage stays a showcase, and only the one prompt section is added to it.
- Agents users paste this into (Claude Code, Codex, Cursor and others) can fetch a public URL. The `.md` twin covers fetch tools that don't convert HTML well.
- The guide's route paths and requirements are the ones shipped today (see above). Anything it states that the drift test cannot check stays general rather than going stale.
- Asking an agent to "read and follow a URL" can look like prompt injection. To keep it trustworthy, the prompt asks the agent to read the guide first, explain its recommendation and confirm with the user before acting. The guide asks for no secret beyond what the user would paste anyway: the runner credential block from the runner page, or an OpenRouter key entered in Harbour's own Settings, never given to the agent.

### Success Criteria

- Signed out, `/` shows the `landing-agent` section directly under the hero. Copy puts the exact prompt on the clipboard, and the prompt contains an absolute guide URL that resolves on the same deployment.
- `/getting-started` returns 200 HTML and `/getting-started.md` returns 200 `text/markdown`, with no session. Both come from one source file.
- A fresh agent session given only the prompt can, by following the guide, tell the user which steps are theirs and recommend copy-first or runner for their situation. Its first step sends the user to sign in, or to the Local door, without guessing at URLs. This is checked once by hand on the deployed site and recorded in the PR.
- `/llms.txt` names `/getting-started` as the way in and no longer describes Harbour as a tree viewer. The sitemap and public-page scan include the guide.
- The new unit tests and the drift test pass, the drift test fails if a named route is removed, and `ci-success` is green.

### Open Questions

None block the build. The defaults above stand unless the owner says otherwise:

1. **Prominence.** The section goes directly under the hero, as a peer of sign-in. If the owner would rather it sit inside "Try it yourself", that is a small move.
2. **Copy-first or runner as the recommended first path.** The guide recommends copy-first prompts first because they work with any agent, and the runner second. If the product wants Claude Code users sent straight to the runner, that is a one-paragraph change to the guide.
3. **Measuring it.** Should copy presses and guide fetches be counted on `/kpis`, next to the onboarding funnel? This is not part of done. It is suggested as a follow-up if the owner wants to see whether this moves first Go presses.
