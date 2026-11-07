# LIN-4085: Add an agent onboarding prompt to the homepage getting started section

State: In Progress
Labels: none

## Description

## As asked

Have an idea which I think might be interesting to explore which is on the homepage the getting started section normally for software has like an MPM installed command we can have a prompt that the person passes to their agent this can be a couple of paragraphs explaining the situation and linking to a [harbour.cat](<http://harbour.cat>) slash getting started page which walks an agent through onboarding project and the user to Harbour. Because it's instruction for an agent the human naturally uses the agent interact with Harper which is a good first step then because the agent can then read the guide it can decide whether to have a conversation with the user or review The repositories and the settings and we can have essentially a full guide on how to properly configure Harper for whatever your situation is without the user needing to follow those steps as the use uses the agent having naturally would.

---

* **Page:** `https://harbour.cat/workspace/linearviewer/`
* **Browser:** `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36`

*End of what was asked. Steps write below this line; nothing above it changes.*

**Origin — raw feedback (triage first):** this ticket was filed directly from the in-app feedback widget, so it is an unfiltered user report, not a triaged or scoped task. Its natural next step is **triage**: work out what is actually being asked, confirm the real priority, and scope it before any research or implementation.

---

## Scope (finalized 2026-11-01)

**What this delivers.** A cold visitor on `/` can do something besides sign in: copy a short prompt and paste it into their own coding agent (Claude Code, Codex, …). The prompt points the agent at a public, agent-readable guide at `/getting-started`. The agent then onboards the human: it interviews them and/or reads their repos, picks the right door, tells the human which few clicks only a human can make (OAuth sign-in), and does the rest through the documented agent surfaces Harbour already has.

**Re-grounded against the code (HEAD** `e1f75fe7`**; no commits since the ticket to** `lib/render-landing.js`**,** `lib/render.js`**,** `public/llms.txt`**,** `content/landing.md`**, library routes or metadata):**

* **The homepage has no "getting started" section in production.** The only "┌─ Getting started" box (`lib/render-landing.js:352-358`, duplicated at `lib/render.js:286-291`) is a self-host `.env` notice shown only when `setupNotice === 'setup'`, i.e. on an unconfigured localhost. Live `https://harbour.cat/` doesn't show it. So this ticket **adds a new block**; it isn't a copy change to an existing section.
* `harbour.cat/getting-started` **does not exist** (live 404). This ticket creates it.
* **The landing ships no JS** (no `<script>` in `render-landing.js`), so a copy button is new, small client code.
* **Agent surfaces already exist for after sign-in**, and the guide links to them instead of re-describing them:
  * the Proxy page's **Agent Prompt**, which mints a token and gives a prompt for the workspace API (`lib/render-proxy.js:47`);
  * the **runner setup** page and its served prompt (`/workspace/:urlKey/runner`, `lib/prompts/runner-kickoff.js`, `docs/runner-prompt.md`);
  * the public `/runner-kit/:file`;
  * `/llms.txt`.
    The gap is **before** sign-in: nothing addressed to an agent shows the way in.

**This ticket is aimed at a symptom.** The 2026-10-23 cold-start review (`docs/reviews/onboarding-cold-start-review-2026-10-23.md`) found that "the product does not point anyone at" the paths that work. The landing's "try it yourself" block has no control of its own, and `/llms.txt` **names no way in**. The public `/kpis` funnel showed 0 first Go presses over the last 30 days. The agent prompt is one answer to that. The cause has two parts: the landing and `llms.txt` don't name a way in, and no onboarding text is addressed to agents. Both parts are in scope.

### In Scope

1. **Guide source:** `docs/agent-onboarding.md` (name can change). Prose written to an agent, following the `runner-prompt.md` pattern: the served part sits above a design-notes `---` cut, and every `{{NAME}}` is filled from source, never a hand-written copy. Filled from source:
   * the base URL, from the request (`publicOrigin`), so a self-host points at itself;
   * which sign-in doors this deployment has enabled (GitHub / Jira / email / Linear, from the same flags the hero CTAs use);
   * whether the free tier is on.
     Content, in order:
   * what Harbour is (one paragraph);
   * **ask or look first:** interview the user, or read their repos and tracker, to choose a path;
   * the paths:
     * (a) try it with no credentials through the local-workspace door;
     * (b) connect a real tracker: the human signs in, then the agent asks for the Proxy-page Agent Prompt;
     * (c) run work on their machine: the runner setup page;
   * what only a human can do (OAuth, the OpenRouter key, minting the owner runner key) versus what the agent does;
   * links to `/llms.txt` and `/api/proxy/instructions`;
   * a short self-host pointer to the README (not a full self-host guide).
2. **Route:** `GET /getting-started` is public and unauthenticated. It serves the guide as plain markdown at `/getting-started.md` (agents read this one) and as a minimal HTML render at `/getting-started` (people who follow the link). It appears in `sitemap.xml`.
3. **Landing block:** a new section under the hero sign-in CTAs in `lib/render-landing.js`, styled like the `npm install` box (the lx-terminal style). It holds a 2–3 paragraph prompt addressed to the agent that points at `<origin>/getting-started.md`. It has a copy button (a small script). Without JS, the prompt is still selectable `<pre>` text. It carries `data-testid="landing-agent-prompt"`. The prompt text is **static per deployment**: only the origin is templated (see Assumptions).
4. `/llms.txt`**:** a "Getting started / onboarding a user" entry near the top that points at `/getting-started.md`. This is the root-cause fix for "llms.txt names no way in".
5. **Size and drift guards:**
   * add served-guide and landing-prompt ceilings to `tests/unit/prompt-size-budget.test.js`, beside the runner prompt's (agent-facing text, so it follows the same frozen-size rule);
   * a unit test that every `{{placeholder}}` resolves and that every path the guide links to is a real route (`/library`-style link checks);
   * landing render tests: the block is present, the origin is filled in, and nothing in it is a secret.
6. **Docs:** a `docs/architecture/source-map.md` entry for the new route and module.

### Out of Scope

* A context-aware prompt on the **authenticated** Home. The copy-first card (LIN-3833, `lib/render.js:281-284`) already owns that slot, and changing it is a separate ticket if wanted.
* Changes to the self-host `setupNotice` box. One cleanup is allowed: if the new block makes the landing's copy of that box redundant, dedupe the two copies in `render-landing.js` and `render.js` into one helper.
* New agent-callable endpoints for things only a human can do today (OAuth, the OpenRouter key, minting the owner runner key). The guide hands those to the human.
* A redesign of the landing beyond inserting this block.
* Rewriting the README or `/llms.txt` beyond the entry above.

### Assumptions

* The prompt can't be truly context-aware: `/` is unauthenticated, so the only context it has is the deployment (origin, enabled doors, free tier). Context lives in the **guide**, where the agent asks or reads.
* An agent can't complete OAuth itself. The guide's job is to sequence the human's few clicks, not to remove them.
* The hosted `harbour.cat` is the main audience. Self-hosters get a pointer, not a walkthrough.
* The agent can fetch a public URL. The prompt also tells it what to do if it can't (ask the user to paste the guide).

### Success Criteria

* On a configured deployment, `/` shows the agent-prompt block below the hero CTAs, with a working copy button. It shows at 320px with no horizontal scroll, in light and dark themes.
* `GET /getting-started.md` returns 200 `text/markdown` with no auth. Every placeholder is filled, and every linked path resolves (unit-tested). `GET /getting-started` renders HTML.
* `/llms.txt` names `/getting-started.md`.
* A cold-agent walk passes: a fresh Claude Code session with no Harbour context, given only the copied prompt, reaches either the local-workspace door or a correct "now sign in with X, then copy the Agent Prompt from Proxy" instruction, without inventing URLs. Record it as evidence on the PR.
* `npm run test:unit` and `ci-success` are green, and the size ceilings are recorded with their reason.
* After it ships: watch the `/kpis` "How people get started" funnel. This is not a merge gate.

### Open Questions (product, need a human call)

1. ~~**Prominence**~~ **Resolved 2026-11-01:** the prompt goes **directly under the hero sign-in buttons, as an equal second way in** (not lower down the page). In Scope item 3 and the first Success Criterion already assume this placement.
2. **The default path the guide steers to:** should it start with the zero-credential local workspace ("see it first"), or go straight to connecting the user's real tracker? *Recommendation:* the agent asks first. Default to the real tracker when the user has one, and use the local door as the "just looking" path.
3. **Wording owner:** is the final prompt and guide copy reviewed by John before merge, or does the plain-language guide (`docs/papers/harbour/plain-language.md`) plus the cold-agent walk count as sign-off? *Recommendation:* the walk plus a PR review is enough. Wording is easy to change after launch.

---

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

## Comments (oldest first)

### 2026-11-01T17:34:55.141Z — None

Triage: Filed under **Product** (homepage getting-started / onboarding UX). Priority lowered High → Medium: a feature idea from the feedback widget, nothing broken or blocking. No `bug` label (no unexpected behavior reported). State stays Backlog pending scoping. Open questions for scoping: final prompt text; static vs context-aware prompt; whether harbour.cat/getting-started exists/is canonical; any homepage work beyond copy.

### 2026-11-01T17:37:36.969Z — None

Scoping done. The finalized scope is appended to the description. Two things the ticket assumed are wrong: (1) production `/` has no getting-started section (the only one is a localhost-only `.env` notice, `lib/render-landing.js:352`), and (2) `/getting-started` is a live 404. So this adds a new landing block, a new public guide route, and an `/llms.txt` entry. The root cause, found in the 2026-10-23 cold-start review: neither the landing nor `/llms.txt` names a way in. Three product questions are open (prominence, the guide's default path, who signs off the copy), each with a recommendation.

### 2026-11-01T17:39:25.786Z — None

**Unblock check: nothing needs a person before implementation starts.**

**Dependencies.** None. There are no blocks or blocked-by relations, and none is warranted: every surface the scope links to already exists (Proxy Agent Prompt `lib/render-proxy.js:47`, runner setup, `/runner-kit`, `/llms.txt`). Re-grounded against `origin/main` at `e1f75fe7`: no commits since the ticket was created touch `lib/render-landing.js`, `lib/render.js`, `public/llms.txt`, `content/landing.md`, `lib/render-proxy.js`, `tests/unit/prompt-size-budget.test.js` or `docs/architecture/source-map.md`. The scope's code references still hold (the setup-notice box is at `render-landing.js:352-358`).

**What looked like a blocker.** The open ruling `lin4085-prominence` (hero vs. secondary). By Principle 0 it doesn't need a person right now:
- *Type:* missing info, but only on placement. The guide, both routes, the sitemap and `/llms.txt` entries, the placeholder, link and size tests, and the source-map entry don't depend on where the block sits.
- *Already answered by the filer:* the request asks for the prompt where software puts its `npm install` line, which is the front door. That's the **hero** option.
- *Reversible:* it's a few lines in `render-landing.js` and moves easily after launch.

**Decisions I've made (yours to change):**
1. **Prominence → directly under the hero sign-in CTAs** ("Or hand this to your coding agent"). I filed this as a *suggested answer* on the ruling, so one press confirms it. **If unanswered:** implementation goes ahead with hero, and nothing stops.
2. **Default path in the guide → ask first, then use the real tracker when the user has one.** The local workspace is the "just looking" path. This is a coherence call, not a preference: the 2026-10-23 cold-start review's gap is that nothing names a way in to *real* use, and an agent that picks a path without asking is the failure the guide exists to prevent.
3. **Wording sign-off → not a gate on implementation.** Merge already goes through review and close-out. The cold-agent walk recorded on the PR, plus that review, is the bar. If John wants to read the copy before merge, he can say so at review. Copy changes are cheap after launch.

**Cost of doing nothing.** The ticket sits In Progress with no code while the `/kpis` "How people get started" funnel stays at 0 first Go presses, and `/llms.txt` still names no way in.

**Next action.** Dispatch implementation against the finalized scope as written, with the three decisions above.

### 2026-11-01T17:42:38.930Z — None

Plan written into the description under `## Implementation Plan` (HEAD e1f75fe7, no relevant commits since the ticket). Key decisions: guide follows the runner-prompt pattern; sign-in doors extracted into one `signInDoors()` shared by hero and guide; origin uses the validated `publicOrigin(safeHost)`; `/getting-started(.md)` added to `isAuthExemptPath` exactly, with lookalike tests; copy script is a static `public/landing-copy.js` (no CSP hash change), button created by JS only. Likeliest wrong spot: the local-workspace path, since the session lives in the creating cookie jar and a human will not see an agent-created workspace; the cold-agent walk must settle it. Plan-review is due because it widens an auth guard and puts Host-derived origin into agent instructions.

### 2026-11-01T17:43:09.026Z — None

Directly under the hero sign-in buttons, as an equal second way in

— Ruling recorded via Harbour

### 2026-11-01T17:43:32.660Z — None

Decision recorded: the agent onboarding prompt goes **directly under the hero sign-in buttons, as an equal second way in**. Open Question 1 in the description is now marked resolved. Questions 2 (the guide's default path) and 3 (who signs off the copy) are still open, each with a recommendation.

### 2026-11-01T17:45:22.181Z — None

### Plan Review Verdict

**Verdict:** Approve. The plan's premises check out against `origin/main` (`e1f75fe7`), it fixes both parts of the cause (no way in on `/` or in `llms.txt`, and no text addressed to agents), and both of its riskier steps (the auth-exempt widening and the Host-derived origin) come with tests that try exactly what those guards stop.

**What I checked (at HEAD `e1f75fe7`; no commits since the ticket touch the files involved):**
- `renderSignInCtas` (`lib/components/landing-hero.js:79`) is the hero's door logic: Linear always, GitHub/Jira/email behind flags. Extracting `signInDoors` from it, with `landing-hero.test.js` as the byte-identical check, is sound.
- `publicOrigin(req, { safeHost: true })` (`lib/public-origin.js:27`) checks Host against `^[a-z0-9.-]+(:\d+)?$` and falls back to `harbour.cat`. The landing today passes the unvalidated `requestOriginOrNull(req)` (`server.js:2332`). The plan's choice of the validated origin, and its hostile-Host check, are right.
- `isAuthExemptPath` (`lib/guest-task-path.js:92`) does exact matching after lowercasing and stripping one trailing slash. Adding two exact entries fits that shape. The plan's test (the two paths exempt, lookalikes not exempt, `/workspace/x/proxy` still not exempt) tries what the guard is there to stop.
- `docs/agent-onboarding.md` will **not** leak into the Library as raw text with design notes and `{{…}}` left in. The catalog serves only `docs/papers/harbour/*.md` plus `LISTED_DOCS` (`lib/library.js:448-452`). Keep it out of `LISTED_DOCS`.
- `LIBRARY_CSP` and `MARKDOWN_CSP` are exported from `routes/library.js:33-36`. Global `script-src 'self'` allows a static `/landing-copy.js` with no change to the hash list.
- Path (a) holds up. A human reaches `POST /workspace/new` from `/swipe` through the nav's "+ local workspace" form (`lib/components/navbar.js:108`). The proxy API works for local workspaces (`tests/e2e/proxy-local.spec.js`), so "the human creates it, then the agent uses the Proxy Agent Prompt" is a path that actually works.
- LIN-1653's new prompt-template drift guard covers dispatch `PROMPT_TEMPLATES` kinds and does not apply to this guide.

**Notes for the builder (none of these block):**
1. **Don't reuse the `.prompt-container`, `.prompt-copy` or `.prompt-text` classes on the landing block.** `/app.js` already loads on `/` (`render-landing.js:483`). Its `bindPromptControls` attaches `handleCopyClick` to those classes, and that handler calls `maybeAppendProxyBlock`, which mints tokens. Give the block and the button its own classes so `landing-copy.js` is the only thing that handles it. (This also confirms the plan was right not to reuse app.js's copy handler.)
2. **The nav bar has its own list of sign-in doors.** The `isLanding` branch of `lib/components/navbar.js:91-120` decides GitHub/Jira/email itself and is shown on `/swipe`, which is the page path (a) sends the human to. The plan's search (`renderSignInCtas`) won't find it. The guide matches the hero, which is the plan's stated goal, so this doesn't need to change. Mention it on the PR as a known separate copy, and don't describe `signInDoors` as "the one place" in its header comment.
3. **Write door links in the guide as full URLs** (`{{BASE_URL}}/auth/linear`). An agent reading a `.md` fetched from elsewhere can't resolve root-relative paths reliably. Make the link test (witness e) pull out same-origin absolute URLs as well as root-relative ones. If it doesn't, a guide written that way passes the test without checking any links.
4. **Public-page scan.** `scripts/scan-public-pages.mjs` / `lib/scan-public-pages.js` scans the *JavaScript* on `/`, `/kpis` and `/archive/:n`. Once `/landing-copy.js` is on `/`, the scan covers it automatically. Adding `/getting-started*` to the list adds little, because those pages carry no scripts. For the landing test's "no secrets" check, run the block's text through the same rules in `lib/secret-scan` instead of a hand-written pattern list.
5. **Placement versus the 17:43 ruling** ("directly under the hero sign-in buttons, as an equal second way in"). Putting the block first in `<main>`, right after `</header>`, meets it, as long as it looks like a second door and not the start of the showcase. Check that in the 320px and desktop screenshots. If it reads as secondary, the fix is to move it inside `.landing-hero` after `.landing-ctas`. The hero's own markup stays byte-identical either way, because the block is separate from `renderSignInCtas`.
6. Bake the `.md` vs HTML difference into the route test, so a later Library refactor can't reverse it: `.md` gets `text/markdown; charset=utf-8` with `MARKDOWN_CSP`, HTML gets `LIBRARY_CSP`, and both get `nosniff` and `no-store`. The Library's `nosniff` middleware only matches `isPublicLibraryPath`, so the new router has to set `nosniff` itself.
7. `public/llms.txt` currently opens with `## Library`. The new section goes right after the intro blockquote. `tests/unit/llms-limitations.test.js` only checks `## Limitations`, so nothing existing pins this order. The new llms test the plan describes is the only check on it.

Plan goes to `implementation` with these notes.


### 2026-11-01T18:18:55.102Z — None

LIN-4085 implementation is up for review: https://github.com/JKershaw/LinearViewer/pull/2221 (branch feat/lin-4085-agent-onboarding, head 6dacd78d).

What it does: a copyable agent prompt sits directly under the hero sign-in buttons on /. It points a coding agent at a public guide at /getting-started.md (and /getting-started for people), which walks the agent through setting Harbour up with the person. /llms.txt has an entry for it.

Verification on 6dacd78d:
- CI green: unit tests, all four E2E shards, secret scan.
- Unit: 22098/22098 locally. Full Playwright suite passed (1913, 1 existing skip).
- A cold-agent walk (only the copied prompt, GET requests only) found four guide gaps. All four are fixed in 6dacd78d.

Open for review: the sign-out landing does not show the block (left out on purpose, see PR). The sign-in door list on /swipe is still a separate copy in navbar.js. Placement reads as its own section under the buttons. Merge is not mine; it waits on review.
