## Implementation Plan

fits one session
plan-review due: yes (it widens `isAuthExemptPath` and adds new ceilings to the frozen prompt-size total; both are guards)

Built on HEAD `e1f75fe7` (2026-11-01 16:23 UTC). The ticket was filed after that commit, so nothing it references has changed since (`git log --since=2026-11-01` on every file below returns nothing).

### What this is for, and what done looks like

**As asked:** where most software's getting-started section shows an `npm install` line, Harbour's homepage shows "a prompt that the person passes to their agent". The prompt is a couple of paragraphs that explain the situation and link to "harbour.cat/getting-started". That page "walks an agent through onboarding [the] project and the user to Harbour". The agent then decides "whether to have a conversation with the user or review the repositories and the settings". The user never follows the setup steps themselves.

**What it fixes:** the 2026-10-23 cold-start review found that the paths into Harbour that work are not signposted. "The product does not point anyone at this path … `/llms.txt` names no way in" (`docs/reviews/onboarding-cold-start-review-2026-10-23.md:19`, `:136`). In the same review, `/kpis` showed 0 first Go presses in 30 days (`:23`). Nothing addressed to an agent shows the way in before sign-in. This change adds that text in three places: the homepage, a public guide, and `/llms.txt`.

**Done when** (these are the scope's Success Criteria, kept as written):
- On a configured deployment, `/` shows the agent-prompt block right under the hero's sign-in buttons. The copy button works. The block fits at 320px with no horizontal scroll, in both light and dark themes.
- `GET /getting-started.md` returns 200 `text/markdown` with no auth. Every placeholder is filled and every linked path resolves. `GET /getting-started` renders HTML. Both pages are in `sitemap.xml`.
- `/llms.txt` names `/getting-started.md`.
- Cold-agent walk: a fresh Claude Code session with no Harbour context, given only the copied prompt, reaches either the local-workspace door or a correct "sign in with X, then copy the Agent Prompt from Proxy" instruction. It invents no URLs along the way. The walk is recorded on the PR.
- `npm run test:unit` and `ci-success` are green, and each new size ceiling has its reason recorded.
- Not a merge gate: after the change ships, someone watches the `/kpis` "How people get started" funnel.

### Cuts to the As asked block (one ruling, not yet answered)

Both cuts come from the finalized Scope. This plan does not add any.

1. **"without the user needing to follow those steps"**: cut in part. The human still makes the few moves only a human can make: the OAuth sign-in, connecting an OpenRouter key when the free tier is off, and pressing mint on the runner page. The guide puts those moves in order and tells the human exactly which to make. It does not remove them. Removing them would mean new endpoints that let an agent hold OAuth or mint credentials, which is a security change for its own ticket (Scope › Out of Scope, and the Assumption "An agent can't complete OAuth itself"). *Recommendation: accept.*
2. **"configure Harbour for whatever your situation is"**: cut for self-hosters. The guide covers hosted Harbour fully, along three paths. Someone self-hosting gets a pointer to the README, not a walkthrough (Scope › Assumptions: "Self-hosters get a pointer, not a walkthrough"). *Recommendation: accept.* The README already holds the self-host setup, and hosted Harbour is where cold visitors arrive.

The three product questions in the Scope were settled in the 2026-11-01 unblock comment, and this plan builds on those answers: the block goes directly under the hero buttons, the guide asks first and defaults to the user's real tracker, and the copy needs no sign-off gate.

### Where the scope's re-grounding is wrong at HEAD

- **"The landing ships no JS"**: wrong. `renderLandingPage` loads `/common.js` and `/app.js` (`lib/render-landing.js:483`). What matters is the CSP: `script-src 'self'` plus hashes only, with no `'unsafe-inline'` (`lib/security-headers.js:5-8,63-65`). So the copy script must be a new file under `public/`. An inline `<script>` would be blocked unless its hash were added to the CSP, and this change does not do that.
- **"The served part sits above a design-notes `---` cut"**: backwards. In `docs/runner-prompt.md`, the design notes come first and the served body comes after the first `---` (`lib/prompts/runner-kickoff.js:89-91`). The new guide follows the code, not that sentence.
- **"Styled like the `npm install` box"**: the landing has no such box. The style meant is the `lx-terminal` glimpse (`public/landing.css:278-315`). Its `pre` already wraps (`white-space: pre-wrap`).
- **"Links to `/api/proxy/instructions`"**: that route requires a proxy token (`routes/proxy.js:1341`, `authenticateProxyToken`). So the guide presents it as the next read *after* the human has copied the Agent Prompt, not as a link to open cold.
- **The local-workspace door** is `POST /workspace/new`. It is always on (`routes/workspace.js:41`), and people reach it as the `+ local workspace` button on the preview pages' nav (`lib/components/navbar.js:108`, shown on `/swipe`). The homepage hides that nav (`minimalNav`). The workspace lives only in the browser that made it: re-entering without its cookie 302s to `/` (LIN-3065, review `:143`). So an agent that creates one over HTTP cannot hand it to the human. Path (a) has to be "the human opens `/swipe` and presses `+ local workspace`".

### Direction

Follow the runner prompt's pattern. The guide is a markdown file in the repo, served at HEAD by a small builder that fills every value from source. The landing prompt is a short static text from the same module, and only the origin varies.

Set aside:
- **The guide as a Library document** (`/library/doc/…`): the Library has no per-deployment templating, so it couldn't fill in the origin or the doors. The ask names `/getting-started`.
- **A context-aware prompt on `/`**: `/` has no session, so there is no context to use. Context lives in the guide, where the agent asks the user or reads their repos.
- **Rendering the HTML view as `<pre>`-wrapped markdown**: the Library already has a safe markdown renderer, so a person following the link gets a real page at no new risk.
- **Reusing `app.js`'s `handleCopyClick`**: it is tied to `.prompt-container` and appends a proxy token block. That is the wrong behaviour for a public page.

### The parts (shape, boundaries, which data each reads)

1. **Guide source: `docs/agent-onboarding.md`.** Design notes come first, then `---`, then the served body, which is written to an agent in plain language (`docs/papers/harbour/plain-language.md`). The content and its order are Scope › In Scope item 1: what Harbour is; ask or look first; paths (a) local workspace via `/swipe`, (b) the human signs in with one of this deployment's doors and then the agent asks for the Proxy page's Agent Prompt, (c) the runner page; what only the human can do and what the agent does; then `/llms.txt`, `/api/proxy/instructions` (token needed) and a README pointer for self-hosters. It also covers:
   - **The local workspace stays in one browser.** Path (a) must say plainly that it lives only in the browser that made it.
   - **Pages behind sign-in.** Workspace pages are named as patterns (`/workspace/<your workspace>/proxy`, `/workspace/<…>/runner`), alongside "open Proxy from the view switcher". The agent cannot know the key.
   - **Every link is absolute.** Each link is written as `{{BASE_URL}}/…`. The Library renderer would send a relative link to GitHub (`lib/library.js:340-345`).
2. **Builder: `lib/prompts/agent-onboarding.js`.** It is modelled on `createRunnerKickoffBuilder`: read the file once, cut at the first `---`, cache the template, fill per call. An unknown `{{NAME}}`, or a failed read, serves an uncached FALLBACK that says where the guide lives. It exports two things:
   - `buildAgentOnboardingGuide({ baseUrl, githubEnabled, jiraEnabled, emailEnabled, freeTierEnabled })` → markdown;
   - `buildLandingAgentPrompt({ origin })` → the 2–3 paragraph prompt as plain text, addressed to the agent. It names `<origin>/getting-started.md`, says this is the markdown form of `<origin>/getting-started`, and says what to do if the agent can't fetch it (ask the user to open the page and paste it). Its only input is the origin, so nothing secret or per-user can get in.
   The placeholder names and the exact sentences are the builder's call.
3. **Doors come from one source.** Add a data function in `lib/components/landing-hero.js` that returns the sign-in doors as `[{ id, label, href }]`, with the same gating and hrefs `renderSignInCtas` uses today (Linear always; GitHub, Jira and email only when configured). `renderSignInCtas` maps over it, and the guide renders the same list as markdown, so the buttons and the guide cannot drift. The flags come from the same predicates `/` uses (`getProvider(…).entryCta.isConfigured()`, `isEmailSignInAvailable()`, `isFreeTierOffered()`). server.js now computes them inline at two sites (`server.js:1958`, `:2332`), and the guide route would be a third, so compute them in one function that all three call.
4. **Routes: a new `routes/getting-started.js`**, mounted in server.js next to the Library mount (`server.js:2456`).
   - `GET /getting-started.md` serves `text/markdown; charset=utf-8` under the Library's `MARKDOWN_CSP`, with `X-Content-Type-Options: nosniff`.
   - `GET /getting-started` renders the same markdown into HTML through the Library's marked instance and safety rules (raw HTML escaped, href scheme allow-list). That needs a small new export from `lib/library.js`, and it must not set up a second marked configuration. The page goes in the shared shell with a canonical tag and a "View as Markdown" link, under `LIBRARY_CSP`.
   - The base URL is `publicOrigin(req, { safeHost: true })`: the configured `PUBLIC_ORIGIN`, otherwise a validated Host header, otherwise `harbour.cat`, as the Library's canonical tags already do (`routes/library.js:41-43`). It is never null, and a forged Host header cannot put an arbitrary host into the instructions.
5. **Auth exemption.** Add `/getting-started` and `/getting-started.md` to `isAuthExemptPath` (`lib/guest-task-path.js:92-105`). The page reads no session, so PAT auto-login and token refresh must not mint one for an agent's fetch (LIN-3346's rule for public pages). `/` stays non-exempt.
6. **Sitemap.** `sitemapEntries` lists `/getting-started` beside `/` and `/library` (`routes/library.js:70-74`), and its doc comment's "two top-level public pages" is updated to match.
7. **Landing block.** A `<section data-testid="landing-agent-prompt">` goes right after the hero `</header>`, as the first thing in `<main>` and above the setup notice. It is rendered in `lib/render-landing.js`, so the hero component stays sign-in only. It has:
   - the heading "Or hand this to your coding agent";
   - an `lx-terminal`-style box whose `<pre>` holds the escaped `buildLandingAgentPrompt({ origin })` text. The text can be selected without JS;
   - a copy button rendered `hidden`, which the script reveals, so a visitor without JS never sees a dead button.

   When `origin` is null, the block is left out, the same rule the canonical tags follow (`render-landing.js:327-329`). A prompt must never print `null/getting-started.md`.

   The new styles in `public/landing.css` use semantic tokens only, as that file's rule requires.
8. **Copy script: new `public/landing-agent-prompt.js`.** It is added to the landing's `scripts`, following `public/runner-setup.js:80-100`. It calls `navigator.clipboard.writeText` synchronously inside the tap (iOS allows the clipboard only there; the filer was on an Android phone). On failure it selects the `<pre>`'s text and shows a "long-press to copy" note.
9. **The logout render gets an origin.** `handleWorkspaceRemoval` renders the landing with no origin (`server.js:1958`). Pass `requestOriginOrNull(res.req)` so that render shows the block too. This also gives that render its canonical tags, which is harmless.
10. **`/llms.txt` and the landing's HTML comment.** Add a `## Getting started (onboarding a user)` section right after the summary line. It points at `/getting-started.md` (the markdown form of `/getting-started`) and lists the three doors in one line each. Also change the landing's `htmlComment` (`render-landing.js:480`) so an agent that fetches `/` directly is pointed at `/getting-started.md` as well as `/llms.txt`. Both close the cause "the landing and llms.txt name no way in" for an agent that never sees the copied prompt.
11. **Size ceilings in `tests/unit/prompt-size-budget.test.js`.** Three new ceilings, each set to its measured size with `LIN-4085` and its reason beside it ("new agent-facing text addressed to an unauthenticated agent, which no code path can replace"):
    - `AGENT_ONBOARDING_SOURCE_CEILING`: the bytes of `docs/agent-onboarding.md`;
    - `AGENT_ONBOARDING_RENDERED_CEILING`: the rendered guide with every door on and the free tier on, which is the longest variant;
    - `LANDING_AGENT_PROMPT_RENDERED_CEILING`: `buildLandingAgentPrompt` at the fixture `BASE_URL`.

    Add all three to the sum test. Raise `FROZEN_TOTAL_BYTES` by exactly their sum. Change the matcher-count test from `+ 5 + 1` to `+ 8 + 1`. Also add the guide to `scripts/steady-base-growth.mjs` `GROUPS` under "lane + passage prompts", which the test header says it mirrors.
12. **Docs.** Add a `docs/architecture/source-map.md` entry for `routes/getting-started.js`, `lib/prompts/agent-onboarding.js`, `docs/agent-onboarding.md` and `public/landing-agent-prompt.js`, and update the `render-landing.js` and `landing.css` lines.

### Every place the behaviour lives

The behaviour is: **"Harbour shows an agent, before sign-in, the way in."** These are the places I found:
- `/` (hero area): in scope as part 7.
- `/getting-started` and `.md`: new, parts 2 and 4.
- `/llms.txt`: in scope as part 10.
- The landing's HTML comment, the line an agent reads when it fetches `/`: in scope as part 10.
- `sitemap.xml`: in scope as part 6.
- The logout landing render: in scope as part 9.
- The sign-in buttons, which the guide's door list must match: the shared source in part 3.

Places left out, each with a reason:
- **The README:** it is for people and self-hosters. The guide points at it, and the Scope excludes rewriting it.
- **The `/llms.txt` summary line** that still says "displays … as a collapsible tree" (review D1, `:40`): the Scope excludes rewriting llms.txt beyond the new entry. The new section sits directly under that line, so an agent reads the way in before anything else. Worth a follow-up ticket, but it does not block this one.
- **`/swipe`, `/swim` and `/ship`:** they already carry the `+ local workspace` door that path (a) uses.
- **The authenticated Home:** LIN-3833's copy-first card owns that slot (Scope › Out of Scope).
- **`scripts/scan-public-pages` page list:** it scans served JS. The guide page has none beyond the shell's hashed theme script, and the new landing script is already scanned through `/`.

How to repeat the search: `grep -rn "llms.txt\|htmlComment\|renderSignInCtas\|sitemapEntries" lib routes server.js public`. Places not yet written are caught by the link test below: any new URL put into the guide must resolve or the e2e test fails.

### Witnesses (each fails before the change and passes after)

- **Unit, builder** (`tests/unit/agent-onboarding.test.js`):
  - For all 16 combinations of the four flags, the rendered guide contains no `{{`, and contains `BASE_URL` exactly as passed.
  - A door appears only when its flag is on.
  - The guide's door list equals the hero's door data (same ids, labels and hrefs).
  - A fixture doc with an unknown placeholder serves FALLBACK and does not cache it.
  - The guide and the landing prompt both pass `SECRET_RULES` (`lib/secret-scan.js:141`) with no hits.
  - The landing prompt names `<origin>/getting-started.md`.
- **Unit, links that need a session:** each `/workspace/<…>/…` pattern the guide names maps to a route the app registers (`/workspace/:urlKey/proxy` at `server.js:3989`, `/workspace/:urlKey/runner` at `routes/runner-setup.js:56`).
- **E2E, links** (`tests/e2e/getting-started.spec.js`):
  - Without a session, `GET /getting-started.md` returns 200 `text/markdown` and no `Set-Cookie`.
  - Every `<origin>/…` URL in the body, requested without a session, returns neither 404 nor 5xx. A 401 is expected from `/api/proxy/instructions`, and a 302 from the `/auth/*` doors.
  - `GET /getting-started` returns 200 HTML with a heading.
  This is the "invents no URLs" guard.
- **Unit, routes:** the content type, CSP and nosniff on both routes. `isAuthExemptPath` is true for `/getting-started`, `/Getting-Started/` and `/getting-started.md`, and false for `/getting-startedx`, `/getting-started/x`, `/getting` and `/` (added to `tests/unit/guest-task-path.test.js`). `sitemapEntries` includes `/getting-started`.
- **Unit, landing** (`tests/unit/render-landing.test.js`):
  - With an origin, the block is present, sits after the hero and before the loop, its `<pre>` holds the escaped prompt with the origin filled in, and the copy button is `hidden`.
  - Without an origin, the block is absent and no output contains `null/`.
  - Change the existing insider-word test (`:212`) to render *with* an origin, so it covers the new copy. It renders `{}` today, which would skip the block.
  - The HTML comment names `/getting-started.md`.
- **Unit, llms.txt:** `public/llms.txt` names `/getting-started.md` within its first section.
- **Unit, size:** the three new ceilings and the sum (part 11).
- **E2E, landing** (in `tests/e2e/landing.spec.js`):
  - At 320×640, the block is visible and its `<pre>`'s `scrollWidth <= clientWidth`. Check the element, not the document: `html`/`body` carry `overflow-x: clip`, so a page-level check would pass whatever happens.
  - In Chromium with clipboard permission granted, pressing copy puts text on the clipboard that contains `/getting-started.md`.
  - The existing 390×844 first-screen test (`:270`) stays green, so the block must not push the Linear button below the fold.
- **Evidence on the PR:** the cold-agent walk transcript, and light and dark screenshots at 320px (from `tests/visual/pages-screenshots.spec.js`, which renders `/`).

### The likeliest ways this breaks

1. **The guide sends an agent somewhere that doesn't exist or doesn't work cold.** Examples: a workspace URL built by hand, `/api/proxy/instructions` presented as open, a local workspace "handed over" over HTTP. Caught by the e2e link test, the unit route-pattern test, and the cold-agent walk.
2. **The block breaks the landing on a phone.** It could overflow at 320px, push the CTAs below the fold, or fail to copy because the clipboard write happens after an `await`, or because an inline script is blocked by the CSP. Caught by the 320px element check, the 390×844 test, and the clipboard e2e.
3. **The origin is wrong.** It could be `null` on the logout render, a forged Host header, or the wrong host on a self-host. Caught by the null-origin unit test, `safeHost` on the guide route, and `PUBLIC_ORIGIN` taking precedence.

### Left out
- New agent-callable endpoints for steps only a human can do (see cut 1).
- Changes to the setup-notice box. The optional dedupe the Scope allows isn't taken: the new block doesn't make that box redundant, because it serves a different reader (a self-hoster's `.env` versus a hosted visitor's agent).
- A landing redesign. Rewriting the README or `/llms.txt` beyond the new section.

### Order of landing, and fit

One PR, in this order: the doors data function (part 3, which keeps the existing button tests green), then the guide, builder and unit tests, then routes, exemption and sitemap, then the landing block, script and CSS, then llms.txt and the comment, then ceilings, then docs, then the cold-agent walk against a local server.

None of these parts needs another to land first in a separate change, and the research named no blocking refactor. Most of the work is writing the guide; the code around it is small and follows existing patterns. This fits one session.

Plan review is due because the change widens the auth-exemption predicate and adds to the frozen prompt-size total.
