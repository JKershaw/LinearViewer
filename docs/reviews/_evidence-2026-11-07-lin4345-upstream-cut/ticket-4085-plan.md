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

1. **Prominence:** should the agent prompt be a **co-equal door beside the sign-in buttons in the hero**, or a **secondary block lower down** (for example inside "try it yourself")? *Recommendation:* directly under the hero CTAs as "Or hand this to your coding agent". It's the ticket's premise and the landing's only real control besides sign-in.
2. **The default path the guide steers to:** should it start with the zero-credential local workspace ("see it first"), or go straight to connecting the user's real tracker? *Recommendation:* the agent asks first. Default to the real tracker when the user has one, and use the local door as the "just looking" path.
3. **Wording owner:** is the final prompt and guide copy reviewed by John before merge, or does the plain-language guide (`docs/papers/harbour/plain-language.md`) plus the cold-agent walk count as sign-off? *Recommendation:* the walk plus a PR review is enough. Wording is easy to change after launch.

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
