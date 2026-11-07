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

*Planned at HEAD* `e1f75fe7`*. No commit since the ticket was created (2026-11-01T17:34Z) touches* `lib/render-landing.js`*,* `lib/render.js`*,* `public/llms.txt`*,* `content/landing.md`*,* `tests/unit/prompt-size-budget.test.js` *or* `docs/architecture/source-map.md` *(checked with* `git log --since`*). The three product questions are settled in the 17:39 comment; this plan builds on those answers.*

session fit: fits one session
plan-review due: yes

### What this is for, and what done looks like

A cold visitor on `/` can only sign in. The 2026-10-23 cold-start review found the cause: neither the landing page nor `/llms.txt` names a way in, and no text addressed to an agent exists before sign-in. This change adds both: a copy-paste prompt on the landing page, and the public guide it points to.

**Done, for the person who asked** (the ticket's Success Criteria, restated as the plan's witnesses):

1. `/` shows the agent-prompt block directly under the hero sign-in CTAs. The copy button works. At 320px there is no horizontal scroll, in light and dark.
2. `GET /getting-started.md` returns 200 `text/markdown` with no session. `GET /getting-started` returns the HTML render. Every placeholder is filled and every path the guide links to exists.
3. `/llms.txt` names `/getting-started.md` near the top.
4. A cold agent (fresh Claude Code, no Harbour context, given only the copied prompt) reaches the local-workspace door, or a correct "sign in with X, then copy the Agent Prompt from Proxy" instruction, without inventing a URL. The transcript goes on the PR as evidence.

The ticket still matches its purpose, so nothing to correct. One premise was already corrected by scoping: there is no existing getting-started section in production, so this adds a block rather than editing copy.

### Direction, and what I set aside

* **Guide = a markdown file in** `docs/`**, served through a small builder, copying** `docs/runner-prompt.md` **+** `lib/prompts/runner-kickoff.js`**.** The served part sits above the first `---`; design notes sit above it. Every `{{NAME}}` is filled from source. Set aside: a hand-written HTML page (drifts from the markdown agents read) and a Library document (the Library's catalog is derived from `docs/papers/harbour/*.md` and a fixed `LISTED_DOCS` list, and this guide needs per-request filling).
* **Do not generalise the runner-kickoff builder.** Two users would not justify a shared helper; the new module is about 40 lines. Say so in the module header so a third user knows to extract.
* **The sign-in doors come from one place.** `renderSignInCtas` (`lib/components/landing-hero.js:79`) decides which doors exist from `githubEnabled/jiraEnabled/emailEnabled`. Extract that decision into an exported `signInDoors(flags)` returning `[{id, label, href}]`, used by both the hero and the guide. This is the cause-level fix: a guide that rebuilt the list itself would drift the first time a door is added. It is a small refactor, and the hero's rendered HTML must stay byte-identical (existing `landing-hero.test.js` is the witness).
* **Origin is the validated one.** Use `publicOrigin(req, { safeHost: true })` (`lib/public-origin.js:27`, as `routes/library.js` does), not the raw Host header. This is an agent-instruction surface: a poisoned Host header would tell agents to fetch and trust another origin. The landing currently passes `requestOriginOrNull(req)` (`server.js:2332`); the new block uses the validated origin and never renders without one.
* **HTML render reuses the Library's markdown renderer and page shell** (it already escapes raw HTML and allow-lists link schemes) instead of a second renderer. If the renderer is not exported in a usable form, export it; do not copy it. Same headers as the Library: `nosniff`, `MARKDOWN_CSP` (`default-src 'none'; sandbox`) for `.md`, `LIBRARY_CSP` for HTML. `Cache-Control: no-store`, like `/runner-kit`, because the body varies by origin.
* **Copy button script is a static file** (`public/landing-copy.js`, listed in the landing's `scripts`), not an inline script. `script-src 'self'` already allows it, and no hash needs adding to `INLINE_SCRIPT_HASHES`. The button is created by the script, never in markup: without JS there is no dead control, just the selectable `<pre>`. Fallback chain inside the script: `navigator.clipboard.writeText`, else select the text and `document.execCommand('copy')`, else leave it selected. Set aside: an inline `onclick` (blocked by CSP).

### What changes (the places, and how I know it is all of them)

The behaviour is: *a visitor can reach, from public pages, an agent-readable way in.* Places, each in scope:

| Place | Change |
| -- | -- |
| `docs/agent-onboarding.md` | New. Guide source; design notes above `---`. |
| `lib/prompts/agent-onboarding.js` | New. Builder (cut at `---`, fill placeholders, throw on an unknown one). Also holds `LANDING_AGENT_PROMPT` (static text, `{{BASE_URL}}` the only slot). |
| `routes/getting-started.js` | New. `GET /getting-started`, `GET /getting-started.md`. Mounted in `server.js` beside `createRunnerKitRoutes()` (`server.js:3212`). Takes the door flags and `isFreeTierOffered` from the same predicates `server.js:2332` passes the landing. |
| `lib/guest-task-path.js:92` `isAuthExemptPath` | Add `/getting-started` and `/getting-started.md` (exact, after the existing lowercase and one-trailing-slash strip). Without this the token-refresh and PAT auto-login middleware (`server.js:1585`, `lib/pat-session.js:42`) run on a public page. |
| `routes/library.js:70` `sitemapEntries` | Add `/getting-started` (the HTML form only; the Library lists its plain form, not `.md`). |
| `lib/components/landing-hero.js` | Extract `signInDoors`; hero output unchanged. |
| `lib/render-landing.js` | New first section in `<main class="landing-showcase">` (before the localhost-only setup notice), `data-testid="landing-agent-prompt"`, lx-terminal styling like the existing glimpses, heading "Or hand this to your coding agent". Add `/landing-copy.js` to `scripts` (currently `render-landing.js:483`). |
| `public/landing-copy.js`, `public/landing.css` | New script; only the CSS the block needs, including `overflow-x: auto`/`white-space: pre-wrap` so the `<pre>` cannot scroll the page at 320px. |
| `public/llms.txt` | New "Getting started / onboarding a user" section above "Library", pointing at `/getting-started.md`. It is a static file, so the entry is a relative path like the existing ones. |
| `docs/architecture/source-map.md` | Entries for the route and the module (next to `runner-kit.js`, line 23, and `runner-kickoff`). |
| `tests/unit/prompt-size-budget.test.js` | Guide source and rendered ceilings and a landing-prompt ceiling, beside the runner's (lines \~131-135). `FROZEN_TOTAL_BYTES` rises by exactly their sum. Each ceiling line carries LIN-4085 and the reason (agent-facing text that must be prose; the structure is code/tests, the wording is judgment). Set the ceilings to the measured size, not to a round number. |
| `scripts/steady-base-growth.mjs` `GROUPS` | Add `docs/agent-onboarding.md` and the landing prompt's file, so growth stays visible (the budget test header says its groups mirror this table). |
| Public-page secret scan (`npm run scan:public-pages`) | Add `/getting-started` and `/getting-started.md` to the scanned set, if the scan lists pages. |

**How I know that is every place.** Three repeatable searches the builder runs and records on the PR: `grep -rn "isAuthExemptPath\|sitemapEntries\|renderSignInCtas" lib routes server.js tests` (every consumer of the three lists I extend), `grep -rln "llms.txt" lib routes tests docs scripts` (anything pinning llms.txt contents), and `grep -rn "runner-prompt\|runner-kit" scripts tests docs/architecture` (every place the runner prompt pattern is registered, which the new guide should mirror or deliberately not). Tests that pin the *exact* sitemap set or the exact auth-exempt list will fail on the new entries: that failure is the catch-all for places I did not find, and the fix is to update the expectation, not to loosen it. Not findable by reading: other deployments' copies of the landing (none; one codebase) and whatever else links to `/`. Self-host `.env.example`/README mention of getting started stays out of scope (ticket says not to rewrite the README).

### Guide content (decisions; wording is the builder's and stays editable)

In order: what Harbour is (one paragraph); **ask or look first** (interview the user, or read their repos and tracker, before choosing a path; the agent must not pick a door unasked); the paths; who does what; where to read more.

* **(a) Just looking: the local workspace.** The door is `POST /workspace/new` (`routes/workspace.js:41`), reached by a human as `/swipe` → "+ local workspace". Its session lives in the cookie that created it: no-cookie re-entry is a redirect to `/` (LIN-3065). So the guide must say plainly that a workspace an agent creates with `curl` belongs to the agent's cookie jar and the human will not see it in their browser; the human should open `/swipe` and click it themselves, and the agent then works from the Proxy page's Agent Prompt for that workspace. The builder verifies this on the live walk and corrects the guide to what actually happens (this is the likeliest place for the guide to be wrong).
* **(b) A real tracker (default when the user has one):** the human signs in through the doors `{{SIGN_IN_DOORS}}` lists (OAuth is human-only), then the agent asks them to copy the **Agent Prompt** from the workspace's Proxy page (`/workspace/<urlKey>/proxy`, `lib/render-proxy.js:47`).
* **(c) Run work on their machine:** the workspace's runner setup page `/workspace/<urlKey>/runner` (`routes/runner-setup.js:56`), owner only.
* **Human-only:** OAuth sign-in, the OpenRouter key (`{{FREE_TIER_SENTENCE}}` says whether this deployment's free tier makes it unnecessary), minting the owner runner key. No new agent endpoints for any of them (ticket).
* Links: `/llms.txt`, `/api/proxy/instructions` (needs a token; say so), `/library`, and one self-host line pointing at the README.
* Placeholders: `{{BASE_URL}}`, `{{SIGN_IN_DOORS}}`, `{{FREE_TIER_SENTENCE}}`. `<urlKey>` in the guide is prose for the agent to fill, not a placeholder; the link test treats parameterised paths separately (below).

### Landing prompt (decisions)

Two or three paragraphs, static text, `{{BASE_URL}}` the only slot. It must: say it is for a coding agent; give `<origin>/getting-started.md` as the thing to read in full before acting; tell the agent to ask the user what they want before doing anything; tell it what to do if it cannot fetch the URL (ask the user to open `<origin>/getting-started` and paste the page). It must contain no token or credential of any kind.

### How it most likely breaks

1. **The guide is wrong about a door.** Most likely the local-workspace path (cookie ownership above), and the free-tier wording. Witness: the cold-agent walk, plus the tests below that tie door lists and free-tier sentence to their sources.
2. **A copied prompt points at the wrong origin.** Host-header poisoning, or `origin` null on the landing. Witness: a test that sends a hostile `Host` to `/`, `/getting-started` and `/getting-started.md` and asserts the attacker host appears nowhere in the body, and that the `harbour.cat` fallback is used (the Library's existing test shows the shape).
3. **Public route or exemption leaks further than intended.** A prefix match would expose lookalikes. Witness below.

### Witnesses (each fails before the change, passes after)

* `tests/unit/agent-onboarding.test.js`: (a) the real doc builds: no `{{` left, no FALLBACK served; (b) a template with an unknown placeholder throws; (c) `{{SIGN_IN_DOORS}}` equals `signInDoors(flags)` for all eight flag combinations, and the filled guide's door hrefs equal the hero CTA hrefs for the same flags; (d) free tier on/off changes the sentence; (e) every root-relative path in the filled guide and in the landing prompt is a real route. For routes that are public and cheap (`/getting-started*`, `/library`, `/llms.txt`, `/runner-kit/*`, `/kpis`), request them against the real router(s). For authenticated or parameterised ones (`/workspace/<urlKey>/proxy`, `.../runner`, `/api/proxy/instructions`, `/workspace/new`, `/swipe`), the test keeps a short table of pattern → registering file, and checks the registration string exists there. That is a source-reading check and a weak witness; say so in the test, and the cold-agent walk is what actually exercises them. If the builder finds an existing route census that can be used instead, use it.
* Route tests: 200 and `text/markdown` for `.md`; HTML for the plain form; no cookie needed; `nosniff` and the two CSPs; `/getting-startedfoo`, `/getting-started.md.bak`, `/api/getting-started` are not exempt and not served by this router. **Guard-loosening witness:** `isAuthExemptPath` is widened by exactly two paths, so the test asserts those two are exempt (case-insensitive, one trailing slash) *and* that the lookalikes are not, *and* that an authenticated route such as `/workspace/x/proxy` still is not. Sitemap test lists `/getting-started` and still lists nothing with `?q=`.
* Landing tests (`render-landing.test.js` style): block present under the hero and before the setup notice; contains `data-testid="landing-agent-prompt"`; the `<pre>` holds the origin-filled text; no `<button>` in the server-rendered HTML; `/landing-copy.js` is in `scripts`; the block contains none of the secret patterns the public-page scan uses.
* Size: the three new ceilings and `FROZEN_TOTAL_BYTES` with ticket references (the existing `ceilingLinesWithoutTicket` check enforces the reference).
* `llms.txt` test: the new section is above "Library" and contains `/getting-started.md`.
* Browser (Playwright, `tests/e2e/`): copy button appears with JS, click puts the prompt text on the clipboard (grant permission in the test); with JS disabled the text is selectable and no button exists; 320px width has `scrollWidth <= clientWidth`; light and dark both render the block legibly (screenshot compare only if the visual config already covers `/`).
* Cold-agent walk (the ticket's own bar): a fresh Claude Code session given only the copied prompt. Record the transcript summary on the PR. Fix the guide to what the walk shows; do not paper over it in the prompt.
* Full gate: `npm run test:unit` and `ci-success` green.

### Order of landing (one PR, in this order so each step is testable alone)

1. `signInDoors` extraction (hero output byte-identical).
2. Guide doc, builder, route, auth exemption, sitemap, with the unit/route tests.
3. Landing block, script, CSS, with landing and e2e tests.
4. `llms.txt` entry, size ceilings, steady-base group, source-map.
5. Cold-agent walk against a local server (`npm start` with the door flags the walk needs), then adjust copy; record on the PR.

### Left out, and why

* Authenticated-Home prompt (owned by LIN-3833's copy-first card; separate ticket if wanted).
* The `setupNotice` box duplication between `render-landing.js:352` and `render.js:286`: the new block does not make either copy redundant (the box is a localhost `.env` notice, the new block is for visitors), so the optional dedupe in the ticket is **not** done here.
* A self-host walkthrough, README or `llms.txt` rewrites beyond the one entry, new agent endpoints for human-only steps, any landing redesign.
* Watching the `/kpis` "How people get started" funnel after launch: not a merge gate; the follow-up is to read it a week after deploy.
* Reviewing the wording: not a gate (ruled in the 17:39 comment). Copy lives in two files and is cheap to change.

### Session fit and review

The work is small enough to hold in one pass: one new route, one new module, one small landing block, and the tests for them; no step depends on a result from another session. A second reader is due before building, for two reasons: it adds a public unauthenticated route and widens the auth-exempt guard (`isAuthExemptPath`), and it puts Host-derived origin text into instructions that agents will follow. Both are easy to get subtly wrong and hard to notice once built.

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
