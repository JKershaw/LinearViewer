## Implementation Plan

*Plan for HEAD `e1f75fe7`. Builds on the finalized Scope above and the 2026-11-01 unblock-check comment. The three open questions are settled as that comment decided: the block goes directly under the hero CTAs; the guide asks first, defaults to the real tracker when there is one, and offers Local as the "just looking" path; the copy is signed off by the cold-agent walk plus PR review.*

### What this is for, and what done looks like

**The problem, as asked:** a cold visitor should be able to hand Harbour to their own coding agent, "like an npm install command", with a prompt "a couple of paragraphs" long that links to "harbour.cat/getting-started", a page that "walks an agent through onboarding project and the user to Harbour". The agent then decides "whether to have a conversation with the user or review the repositories and the settings".

**The cause it closes** (from the scope, checked at HEAD): no text addressed to an agent shows the way in before sign-in. The landing has no control besides sign-in. `/llms.txt` names no way in (it documents the Library, templates and the runner, but never `/auth/*`, `/auth/email` or `POST /workspace/new`; see `docs/reviews/onboarding-cold-start-review-2026-10-23.md` J7/J8). This plan closes both halves: the guide and landing prompt fix the missing agent-facing text, and the `/llms.txt` entry plus the landing's agent HTML comment fix the missing pointer.

**Done when** (the scope's Success Criteria, unchanged):
- On a configured deployment, `/` shows the agent-prompt block under the hero CTAs. Its copy button works, and it fits at 320px with no horizontal scroll, in both light and dark themes.
- `GET /getting-started.md` returns 200 `text/markdown` with no auth. Every placeholder is filled and every linked path resolves. `GET /getting-started` renders HTML.
- `/llms.txt` names `/getting-started.md`.
- In a cold-agent walk, a fresh Claude Code session given only the copied prompt reaches the Local door or a correct "sign in with X, then copy the Agent Prompt from Proxy" instruction, without inventing a URL. This is recorded on the PR.
- `npm run test:unit` and `ci-success` are green, and each new size ceiling carries its reason.

### Cuts to the As asked block

One cut, inherited from the scope's Assumptions and Out of Scope. It needs a ruling and is unagreed until answered:

> "we can have essentially a full guide on how to properly configure Harper for whatever your situation is **without the user needing to follow those steps**"

The human still makes a few clicks: OAuth sign-in, connecting an OpenRouter key, minting the owner runner key, and changing anything on Harbour's own Settings page. These need the human's own consent or browser session, and no agent-callable endpoint exists for them. Adding one is out of scope because it would widen what a token can do with credentials. The guide's job is to put those clicks in order and say exactly which button to press. Everything else is the agent's job.
**Recommendation: accept.** Agent-callable versions of those steps would be a separate ticket with its own security review. Nothing in this build changes if the ruling goes the other way: rejecting the cut means filing that ticket, not reworking this one.

These are **not cuts**, and here is why:
- *"the getting started section" on the homepage.* Production has no such section (the only one is the localhost `.env` notice, `lib/render-landing.js:352-358`). A new block in that position delivers what was asked.
- *"linking to harbour.cat/getting-started".* That URL becomes a real page. The prompt points the agent at its plain-markdown twin, `/getting-started.md`, which is the same guide text.
- *"whatever your situation is"* for self-hosters. The guide sends the agent to the README's Setup section, which an agent can carry out itself (clone, `.env`, `npm start`). The guide also names the one step there that needs the human: creating a Linear OAuth app or a token. The README is not repeated in the guide.

### Which way it goes, and why

1. **The guide is a served doc with placeholders filled from source**, following `docs/runner-prompt.md` and `lib/prompts/runner-kickoff.js:79-116`. The source is `docs/agent-onboarding.md`: design notes, then the first `---` line, then the served body. A new `lib/prompts/agent-onboarding.js` reads the file once and caches the template. It fills values on every call. If the file can't be read, or it holds a placeholder the module doesn't know, the module serves an uncached FALLBACK, so a reader never sees raw `{{...}}`.
   *Set aside:* hand-written HTML (it would drift from the routes and doors it names); generating the guide from code (it is prose for a model, so it belongs in a doc that can be reviewed).
   *Set aside:* pulling the shared "cut at `---`, fill, fall back" loader out of runner-kickoff and the passage and worker kickoffs. That duplication is not this ticket's cause, and changing those loaders would make their callers pay for this feature.
2. **The placeholders, each read from its source:**
   - `BASE_URL` comes from `requestOriginOrNull(req)` (`lib/public-origin.js`), so a self-host points at itself and `PUBLIC_ORIGIN` pins it. If it is null, the `.md` route still serves the guide with root-relative paths. The landing block (below) is left out instead.
   - The sign-in doors come from the same flags and the same labels and hrefs the hero buttons use.
   - The free-tier line comes from `isFreeTierOffered()` (`lib/chat-request.js:76`).
   - The Local door's button label comes from `LOCAL_WORKSPACE_FORM.submitLabel` (`lib/render-pages.js:55-60`).
   - The repo URL for the self-host pointer comes from the repo constant `lib/library.js` already exports, not a new literal.
3. **One source for the sign-in doors (a small refactor folded in).** Today `server.js` repeats the four predicates inline at `:1958` (the logout render) and `:2332` (`/`). The guide would make a third copy. So: one function returns `{githubEnabled, jiraEnabled, emailEnabled}`, and `/`, the logout render and the guide route all call it. One data list `[{id, label, href}]` feeds both `renderSignInCtas` (`lib/components/landing-hero.js`) and the guide's door list, so the guide names the exact button text the human sees ("Log in with Linear", "Continue with GitHub", …). The builder picks where the function lives. The hero's output must not change; the existing landing tests prove that.
4. **The route lives in its own router**, `routes/getting-started.js`, mounted in `server.js` beside `createLibraryRouter()`. Unit tests never boot `server.js` (`tests/unit/account-home.test.js:8`), so a router file is what makes the route testable. The router serves:
   - `GET /getting-started.md`: `text/markdown; charset=utf-8`, with `MARKDOWN_CSP` from `routes/library.js:35` (sandboxed, loads nothing).
   - `GET /getting-started`: the guide rendered on the shared page shell with `followSystemTheme`. Markdown is rendered by `marked` with raw HTML escaped, as `lib/library.js:102` does. The page links to the `.md` and carries the existing Local CTA (`renderLocalWorkspaceCta()`), so path (a) gives the human one place to go: "open `<origin>/getting-started` and press *Create a local workspace*". Without this the Local door is only the `/swipe` nav button, which is a fragile thing to describe to someone.
   - Neither route redirects a signed-in visitor. It is a guide, not a landing.
5. **The auth exemption gets two exact paths.** `isAuthExemptPath` (`lib/guest-task-path.js:91-106`) gains `/getting-started` and `/getting-started.md` as exact matches, not a prefix. Without them, PAT auto-login and token refresh would run for a signed-out agent fetching the guide (LIN-3346 made this predicate the one list). This widens a guard; see the witnesses.
6. **The landing block** is `renderAgentPromptSection({ origin })` in `lib/render-landing.js`. It is the first child of `<main>`, directly after the hero and before the setup notice, with `data-testid="landing-agent-prompt"` and the lead "Or hand this to your coding agent". It contains:
   - the prompt in a real `<pre>` (selectable, wraps; **not** `role="img"` like the glimpse terminals);
   - a copy button made with the shared `renderButton` (LIN-3980 outcome 9);
   - one plain link to `/getting-started` for people.
   The look follows `.lx-terminal` (`public/landing.css:278-310`), using semantic tokens only. The prompt text comes from `buildLandingAgentPrompt({ baseUrl })` in the same module as the guide. Only the origin is templated. It is 2-3 short paragraphs addressed to the agent, and it says:
   - what Harbour is (reusing `HARBOUR_PLAIN_SENTENCE`);
   - to fetch `<origin>/getting-started.md` and follow it;
   - if it can't fetch, to ask the user to open `<origin>/getting-started` and paste the guide;
   - to use only URLs the guide gives.
   **If `origin` is null** (the logout render, `server.js:1958`, has no request origin), the block is left out entirely. An agent can't use a relative URL, and printing `null` would be worse. This matches how the canonical and social tags already drop out (`tests/unit/render-landing.test.js:248`).
7. **The copy script is a file, not inline.** The app CSP is hash-based with no `'unsafe-inline'` (`lib/security-headers.js:4-8`), so an inline handler would silently do nothing. So the script is a new `public/landing-agent-prompt.js` added to the landing's `scripts` list (`render-landing.js:483`). It copies inside the tap, with a select-the-text fallback, the same way `public/runner-setup.js:80-99` does. Without JS the `<pre>` is still there to select. *(The scope says "the landing ships no JS". In fact it loads `/common.js` and `/app.js`; what it has none of is inline scripts.)*
8. **Pointers, so an agent finds the guide from wherever it starts:**
   - a "Getting started / onboarding a user" entry near the top of `public/llms.txt` (static, so the path is root-relative like the rest of that file);
   - the landing's agent HTML comment (`render-landing.js:480`) also names `/getting-started.md`;
   - one bullet in README's "For AI Agents";
   - `{ path: '/getting-started' }` in `sitemapEntries` (`routes/library.js:70`);
   - `/getting-started` in `BASE_PUBLIC_PAGES` (`lib/scan-public-pages.js:21`), so the scheduled public-page scan covers it.

### What the guide must say (content rules, not wording)

The guide is written to an agent, in plain language. In order:
- what Harbour is;
- **ask or look first**: interview the user, or read their repos and tracker, then choose a path;
- the paths:
  - **(a) Local, no credentials.** The human presses *Create a local workspace* on `/getting-started`. Say plainly that a local workspace stays in the browser that made it and doesn't follow the user to another device (LIN-3065; the `/account` copy says the same). Give the free-tier line.
  - **(b) A real tracker.** The human presses one of this deployment's enabled doors. Then the human opens Proxy (`/workspace/<their workspace>/proxy`), picks the smallest scope that does the job, presses *generate & copy* under *Agent Prompt* (`lib/render-proxy.js:47-58`) and pastes the result to the agent.
  - **(c) Run work on their machine.** The runner setup page, `/workspace/<their workspace>/runner`. It is Claude Code only and the mint is owner-only, consistent with that page.
- what only the human can do versus what the agent does;
- `/llms.txt`;
- `/api/proxy/instructions`, stated as **needing the token from the Agent Prompt**. It is token-gated (`routes/proxy.js:1341`), not public as the scope's list might suggest;
- the self-host pointer.

The guide quotes no UI label that isn't filled from source or checked by a test.

### Every place this behaviour lives

**The behaviour:** *what a cold agent or visitor is told about the way in to Harbour, before sign-in.* I found the places with `grep -rn "llms.txt\|AI agents" lib routes server.js README.md public/llms.txt`, plus the public-path predicate, the sitemap and the public-page scan list.

| Place | In or out | Reason |
|---|---|---|
| `/` (new block, agent HTML comment) | in | |
| `/getting-started` and `/getting-started.md` | in | |
| `public/llms.txt` | in | |
| README "For AI Agents" | in | one bullet |
| `sitemapEntries` | in | |
| `isAuthExemptPath` | in | |
| `BASE_PUBLIC_PAGES` | in | |
| `docs/architecture/source-map.md` | in | entries for the doc, module, router and script |
| `lib/render.js:314` comment | out | authenticated pages; the user is already in |
| `lib/render.js:286-291` setup notice | out | the new block doesn't make the landing's copy redundant, so the optional dedupe isn't triggered |
| The authenticated Home copy-first card (LIN-3833) | out | per scope |
| The "try it yourself" block, which still doesn't point at the Local door (review J6) | out | landing redesign is out of scope; the new block above it now names the way in |
| `docs/proxy-integration.md` and `/api/proxy/instructions` text | out | read after sign-in, with a token |

What catches the rest: the e2e sitemap sweep (`tests/e2e/library.spec.js:85`) fetches every sitemap URL on the real server, and the link check below fails on any path the guide names that isn't served.

### Likeliest ways it breaks, and the witness for each behaviour

1. **The prompt overflows at 320px.** A long origin URL in a `<pre>` is the classic cause.
   *Witness:* a new e2e in `tests/e2e/landing.spec.js` at 320px, in light and in dark, asserting the block is visible and `scrollWidth <= clientWidth`. The existing 390×844 first-screen test must still pass.
2. **The exemption is too wide or missing.**
   *Witness:* `tests/unit/guest-task-path.test.js` cases.
   - Exempt: `/getting-started`, `/getting-started.md`, `/Getting-Started/`.
   - **Not** exempt: `/getting-started-x`, `/getting-startedfoo`, `/getting-started/x`, `/api/getting-started`.
   - A `pat-session` case: a signed-out GET of `/getting-started.md` in PAT mode mints no session.
   These are what the guard was there to stop.
3. **The guide drifts from the deployment.** It names a door that isn't enabled, a label that changed or a route that's gone.
   *Witness:* a unit test that renders the guide for each door configuration and asserts the doors it names equal the hero's CTA labels and hrefs for that configuration.
   *Witness:* a link check. Every path the guide names is a registered route: concrete paths are fetched by an e2e against the running app (200, or 401 for `/api/proxy/instructions`), and workspace-templated paths are matched against registered route patterns. A path with no check fails, and a path to an unregistered route fails.
4. **The block is left out when it shouldn't be, or printed without an origin.**
   *Witness:* render tests. With an origin, the block is present and holds `<origin>/getting-started.md`. With `origin: null`, there is no block and no `null`.
5. **A secret leaks.**
   *Witness:* with sentinel values in `OPENROUTER_FREE_TIER_KEY`, `LINEAR_ACCESS_TOKEN` and the OAuth secrets, neither the landing block nor either guide response contains them. Run both through `findSecretMatches` (`lib/secret-scan.js:416`).

**Other witnesses** (each fails before this change and passes after):
- **Route:** a unit test on `createGettingStartedRouter`, bound to `127.0.0.1` (LIN-2023 rule). `.md` returns 200 `text/markdown` with the sandbox CSP. The HTML route returns 200 with the Local CTA form posting to `/workspace/new`, and it doesn't redirect a session that holds workspaces.
- **Placeholders:** every `{{NAME}}` resolves; none survive rendering; the design notes aren't served. An unknown placeholder or a missing file gives the uncached FALLBACK, as in `tests/unit/runner-kickoff.test.js:283-312`. The template holds no hand-written copy of a filled value (`runner-kickoff.test.js:202` pattern).
- **Copy button:** an e2e clicks it and gets the prompt text on the clipboard (Chromium clipboard permission), or the select fallback. A unit test asserts the landing still has no un-hashed inline `<script>`.
- **Pointers:**
  - `/llms.txt` contains `/getting-started.md` near the top;
  - the `sitemapEntries` unit test includes `/getting-started`, and the e2e sweep resolves it;
  - `BASE_PUBLIC_PAGES` includes it.
- **Size:** `tests/unit/prompt-size-budget.test.js` gains three ceilings, each set to its measured size with a `LIN-4085` reason beside it:
  - guide source;
  - guide rendered at `BASE_URL`;
  - landing prompt rendered.
  Add them to the sum list, raise `FROZEN_TOTAL_BYTES` by their sum, and change the matcher count at `:308` from `+ 5 + 1` to `+ 8 + 1`. The reason is that these are new agent-facing prose surfaces under the CLAUDE.md frozen-size rule. Aim for a guide that renders under about 8 KB and a prompt under about 1.2 KB, since agents read both whole.
- **Cold-agent walk:** a fresh Claude Code session against `npm start` on localhost, or the preview deploy, given only the copied prompt. Record the outcome and an excerpt on the PR. This is evidence, not a CI gate.

### Constraints from recent history on these files

- **LIN-3980 / LIN-3995** (`render-landing.js`): plain words, no internal product names in visitor copy, and every button is `renderButton`.
- **LIN-4015** (`landing.css`): one token set and a dead-class measure, so any new class must be used and colours must be tokens.
- **LIN-3346** (`guest-task-path.js`): one exemption predicate, so don't add a second list.
- **LIN-3692** (`routes/library.js`): absolute URLs come only from `publicOrigin` / `requestOriginOrNull`.
- **LIN-3633** (size test): every ceiling line carries its ticket.

None of these files has changed since the ticket was created (checked with `git log --since=2026-11-01`).

### Order of landing, and session fit

All in one PR, in this order:
1. The doors helper (no output change; the existing hero and landing tests stay green).
2. The doc, the module and its tests, the size ceilings.
3. The router, the mount, the exemption, the sitemap, the scan list.
4. The landing block, the CSS and the copy script, with the e2e.
5. `llms.txt`, the README bullet, the HTML comment, source-map.
6. The cold-agent walk.

No research stage ran, and no `refactor required` subtask applies. The doors helper is folded in because this change is its only new user.

**fits one session.** There are about a dozen small files and one new prose doc, and the edges are listed above.

**This plan should get a second reader before it is built.** It widens the auth-exemption predicate and adds an unauthenticated route. It does not touch credentials, merge rules or the dispatch contract.

plan-review due: yes
