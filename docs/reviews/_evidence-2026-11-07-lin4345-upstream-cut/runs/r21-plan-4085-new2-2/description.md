## Implementation Plan

### What this is for, and what done looks like

**The problem, in the ask's words:** on the homepage, where software usually shows an `npm install` line, offer "a prompt that the person passes to their agent". The prompt is "a couple of paragraphs explaining the situation and linking to a harbour.cat/getting-started page which walks an agent through onboarding [the] project and the user to Harbour". The agent reads that guide and "can decide whether to have a conversation with the user or review the repositories and the settings". The guide is "essentially a full guide on how to properly configure Harbour for whatever your situation is", so the user doesn't have to follow the steps themselves.

**Why it matters (the cause, from the scope above):** nothing shows a newcomer, or their agent, the way in. The landing's try-it block has no control of its own, and `/llms.txt` names no way in (cold-start review `docs/reviews/onboarding-cold-start-review-2026-10-23.md`, R3-6). The `/kpis` funnel shows 0 first Go presses in 30 days. Both halves of that cause are in scope: (1) no surface addressed to an agent names a way in, and (2) no onboarding text is written for agents.

**Done means** the scope's Success Criteria, plus two things this plan adds (marked *plan's own*):
- `/` shows the agent-prompt block directly under the hero sign-in buttons, with a working copy button. It fits at 320px with no horizontal scroll, in light and dark.
- `GET /getting-started.md` returns 200 `text/markdown` with no auth, and every placeholder is filled. `GET /getting-started` renders HTML.
- Every path the guide links to resolves on a running server.
- `/llms.txt` names `/getting-started.md`.
- A cold-agent walk is recorded on the PR (see "Witnesses").
- `npm run test:unit` and `ci-success` are green, and the new size ceilings carry their reason.
- *Plan's own:* every click only a human can make sits on one page, `/getting-started`. The agent sends the human there rather than describing buttons on other pages.
- *Plan's own:* the guide covers self-hosting as a path the agent can carry out, not just a pointer (see Cuts).

### Cuts to the `## As asked` block

One cut, raised as ruling `lin4085-cut-human-clicks` (see the comment):

> "…without the user needing to follow those steps as the use[r] uses the agent having naturally would."

**What is cut.** The user still makes a few clicks themselves:
- the OAuth sign-in (or the "Create a local workspace" press);
- **generate & copy** on the Proxy page, which mints the agent's token;
- adding an OpenRouter key, only when this server has no free tier;
- copying the runner prompt from the runner page, only if they want work run on their machine.

The agent tells them which click comes next, and the guide puts the clicks on one page. But the agent can't make these clicks itself. OAuth consent needs the human's own browser. The other three are owner-session credential mints, which are deliberate security boundaries (CLAUDE.md: runner copies are owner-only). Making them agent-callable is a credential change that needs its own design, which is why the scope listed it as Out of Scope.

**Recommendation:** accept. **Until the ruling is answered, this cut is not agreed.**

**Inherited cut I'm closing, not keeping.** The scope's Assumption "Self-hosters get a pointer, not a walkthrough" would cut "for whatever your situation is". It's cheap to close. The guide gets a self-host path that the agent carries out:
- clone the repo (the URL comes from `GITHUB_BASE`, `lib/library.js:34`);
- `cp .env.example .env`, then `npm install`, then `npm start`;
- open the local-workspace door on its own origin, which needs no credentials;
- read README `## Setup` / `## Authentication` for OAuth and the other environment variables.

The README is the authority for environment detail, so the guide links to it rather than copying it. The 2026-10-23 review walked this path to success (J3, "proceeded"). Its known rough edges are tracked elsewhere: LIN-2386 (env-check), LIN-3108 (Linear CTA 503s on a zero-credential self-host). The guide works around LIN-3108 by sending a zero-credential self-host to the local door.

**Settled open questions.** The scope's three open questions were settled in the 2026-11-01 unblock comment, and this plan builds on those answers:
- **Placement:** directly under the hero buttons.
- **Default path:** ask first; use the real tracker when there is one, and the local workspace as the "just looking" path.
- **Copy sign-off:** the cold-agent walk plus PR review.

### Where the scope's facts were wrong at HEAD `e1f75fe7` (checked, and corrected here)

No commits since the ticket touch the referenced files (`git log --since=2026-11-01 -- lib/render-landing.js lib/render.js public/llms.txt content/landing.md lib/render-proxy.js tests/unit/prompt-size-budget.test.js docs/architecture/source-map.md server.js routes` is empty). Three of the scope's claims are still wrong, and the plan follows the code:
1. **"The landing ships no JS."** False. The landing loads `/common.js` and `/app.js` (`lib/render-landing.js:483`). The real constraint is the enforced CSP `script-src 'self' <hashes>` (`lib/security-headers.js:65`). So the copy button must be an **external file in `public/`**, never an inline script.
2. **`/api/proxy/instructions` as a public link.** It needs a proxy token (`routes/proxy.js:1341`, `authenticateProxyToken`). The guide presents it as "once you have a token, read this", never as a first fetch.
3. **"The local-workspace door" as something the agent does.** It's a browser form `POST /workspace/new` that binds the workspace to the browser's session cookie (`routes/workspace.js:41`). An agent that curls it creates a workspace the human never sees, so it's a human click. That's why the HTML page carries the form (below).

### Which way the change goes

There is one new prompt module, served two ways: markdown for the agent, HTML for the human.

**1. Guide source and builder**
- The guide source is `docs/agent-onboarding.md`. Design notes sit above the first `^---$` line, and the served body sits below it.
- The builder is `lib/prompts/agent-onboarding.js`, a copy of the `lib/prompts/runner-kickoff.js` pattern:
  - read the doc once and cache it;
  - an unknown `{{NAME}}` throws inside the builder and serves an **uncached** FALLBACK, never raw braces.
- **Placeholders carry facts only, never prose.** The prose for both branches lives in the doc ("if the free tier is on…, otherwise…"), so the agent-facing words stay in one reviewed file. Every fact is filled per call, because flags can differ per test env:
  - `BASE_URL`: from the request.
  - the enabled sign-in doors and their hrefs: from the same predicates the hero uses (`getProvider('github'|'jira').entryCta`, `isEmailSignInAvailable()`; Linear is always on).
  - free tier on or off: `isFreeTierOffered()`.
  - the repo URL: derived from `GITHUB_BASE`.
- **Guide content:** the scope's In Scope §1 list, with three changes:
  - (a) Every human click points at `<origin>/getting-started`.
  - (b) After any door, the step is the same: "open `/workspace/<urlKey>/proxy`, press generate & copy (read-write, or + dispatch if they want runs), paste it to me". The agent then reads `/api/proxy/instructions` with that token.
  - (c) A short **"choose your setup"** section maps situations to configuration:
    - which tracker → which door;
    - how work runs: copy-first prompts, the runner on their machine (`/workspace/<urlKey>/runner`), or Harbour OS;
    - AI access: the free tier, or their own OpenRouter key.

    This is what "properly configure Harbour for whatever your situation is" asks for. It names the decisions and where each is made, and doesn't re-describe those pages.

  It also includes the self-host path above, and the "if you can't fetch URLs, ask the user to paste this page" fallback.
- **The landing prompt** is a second export of the same module, `buildLandingAgentPrompt({ baseUrl })`.
  - It's 2–3 paragraphs addressed to the agent: what Harbour is, "read `<origin>/getting-started.md` (the human's page of buttons is `<origin>/getting-started`) and follow it, asking me or looking at my repos first", and the paste fallback.
  - Only the origin is templated. It links the literal `/getting-started` the ask names, plus the `.md` form for agents.

**2. Routes** (`routes/getting-started.js`, a router factory mounted in `server.js` beside the library router)
- Both routes are public. Neither redirects a signed-in visitor.
- **`GET /getting-started.md`**
  - Returns the built guide as `text/markdown; charset=utf-8`.
  - Uses the same `MARKDOWN_CSP` + nosniff as Library `.md` (`routes/library.js:36`; reuse the export, don't add a new policy).
- **`GET /getting-started`**
  - Renders a minimal HTML page on the Library's `is-landing` shell, under the Library's `LIBRARY_CSP`, with no external script.
  - Top of the page, "Your clicks": the shared sign-in buttons (`renderSignInCtas`, gated on the same flags) and the existing local-workspace form (`renderLocalWorkspaceCta`, `lib/render-pages.js`). These are reused, not rebuilt.
  - Below that: the guide rendered from markdown, with raw HTML escaped. Use the same rule as `lib/library.js:102`, but in a separate `Marked` instance. The library's instance depends on its catalog's per-parse state, so don't reuse it.
  - A "View as Markdown" link to `/getting-started.md`.
- **Missing origin:** if `requestOriginOrNull(req)` is null, both routes answer 400 with `ORIGIN_UNRESOLVED_REFUSAL`. This matches `routes/proxy-runner-prompt.js`; no guide names `http://undefined`.
- **Auth exemption:** add both paths to `isAuthExemptPath` (`lib/guest-task-path.js`, LIN-3346's one predicate, used by both PAT auto-login and token refresh). Without this, a PAT-mode server mints a session for anyone reading the guide.
  - Match exactly `/getting-started` and `/getting-started.md`, case-insensitive, with one trailing slash tolerated.
  - Lookalikes stay out: `/getting-startedx`, `/getting-started/x`.
- **Sitemap:** add `/getting-started` in `sitemapEntries` (`routes/library.js:70`), the one generated sitemap list.

**3. Landing block** (`lib/render-landing.js`)
- A new `<section data-testid="landing-agent-prompt">` goes first in `<main>`, immediately under the hero buttons.
  - Heading: "Or hand this to your coding agent".
  - Body: the prompt in a `<pre>` styled with the existing `lx-terminal` look (`public/landing.css`, reuse the tokens; LIN-4015 just merged the CSS into one token set, so add no new colours).
  - Below it, a copy button `data-testid="landing-agent-prompt-copy"`.
- **The copy script** is a new `public/landing-agent-prompt.js`, added to the landing's `scripts` list. Its behaviour:
  - clipboard write, the label shows "copied!", and a failure says so;
  - without JS, the `<pre>` stays selectable and the button is hidden or inert.
- **Origin:** comes from the existing `origin` param (`requestOriginOrNull`, PUBLIC_ORIGIN-pinned). When `origin` is null the block is **omitted**, never rendered with a broken URL. The logout render (`server.js:1958`) passes no origin today. It gets `requestOriginOrNull(res.req)`, which also restores its canonical tags.
- **HTML comment:** the landing's `htmlComment` (`render-landing.js:480`) names `/getting-started.md` beside `/llms.txt`.
- **Setup notice:** the localhost setup notice keeps its place after the new block. The scope's optional dedupe of the two setup-notice copies is **not** done: the new block doesn't make either one redundant.

**4. Agent-facing pointers** (the "names no way in" half of the cause)
- `public/llms.txt`: a `## Getting started` entry above `## Library` pointing at `/getting-started.md`.
- `README.md` "For AI Agents" (`:47`): one bullet pointing at `/getting-started.md`.
- Nothing else in either file changes.

**5. Docs:** a `docs/architecture/source-map.md` entry for the route file, the builder and the doc. The scope listed only the route and module; the doc gets an entry too.

**Set aside:**
- *Putting the guide in the Library as a listed doc.* Library docs are served verbatim, and this one needs per-deployment facts.
- *Content-negotiating one URL for both agent and human.* It's invisible to the person following a link, and two URLs are easier to test.
- *An inline copy script.* It needs a new CSP hash for no gain.
- *Having the agent POST `/workspace/new`.* The workspace would land in the agent's cookie jar, not the human's browser.
- *A context-aware prompt on `/`.* `/` is unauthenticated, so the guide holds the context (scope Assumption).

### Every place this behaviour lives

**The behaviour:** *a cold visitor or their agent is shown the way in, in words addressed to an agent.*

**Places found, all in scope:**
- the landing (block + HTML comment);
- `/getting-started(.md)` (new);
- `/llms.txt`;
- README "For AI Agents";
- `sitemap.xml`.

**Places found, left out:**
- `lib/render.js:314`'s identical HTML comment is the signed-in dashboard, so the visitor already has a way in.
- The `/swipe` `/swim` `/ship` previews already carry the local door in their nav (`lib/components/navbar.js:108`). The ask is the homepage.
- The authenticated Home's copy-first card (LIN-3833) is out per the scope.

**How I searched (repeatable):** `grep -rn "llms.txt\|Getting started\|For AI Agents" lib/ routes/ README.md public/llms.txt`. The link-resolution e2e below catches any guide link that drifts from a real route.

### Constraints from recent history on these files

- **LIN-3346** (`10d3bf38`): public pages go through the one `isAuthExemptPath`, with yes/no lists in `tests/unit/guest-task-path.test.js`.
- **LIN-2255** (`b3748ef2`): everything under llms.txt `## Limitations` must stay true (`tests/unit/llms-limitations.test.js`). Don't touch that section.
- **LIN-3633 rule in `prompt-size-budget.test.js`:** a new surface lands with a ceiling, a `LIN-4085` comment and its reason. That means:
  - raise `FROZEN_TOTAL_BYTES` by exactly the new ceilings;
  - bump the matcher's expected count at `:308`;
  - mirror the surfaces in `scripts/steady-base-growth.mjs` `GROUPS`.
- **LIN-3980** (`render-landing.js` header): no hard-typed copies of the app's own words. Sign-in buttons come from `renderSignInCtas`.

### Likeliest ways this breaks, and what catches each

1. **The guide names a path that isn't a route**, now or after a later rename. This sends agents to invented URLs, which is the failure the guide exists to prevent. → The e2e link check.
2. **The public page leaks or mints a session**, or the exemption over-matches into an app path. → `guest-task-path.test.js` lists, plus a no-`Set-Cookie` check on the route test.
3. **The copy button silently does nothing**: CSP blocks inline JS, or the clipboard is refused. → External script, plus an e2e clipboard test.

### Witnesses (each fails before the change, passes after)

**Unit**
- `tests/unit/agent-onboarding.test.js`:
  - no `{{` in the rendered guide or the landing prompt;
  - `BASE_URL` is filled for two different origins;
  - GitHub/Jira/email doors appear exactly when their flag is on;
  - the free-tier fact flips with the flag;
  - an unknown placeholder serves FALLBACK uncached;
  - the guide and prompt contain no value of the dummy secrets set in env (`OPENROUTER_FREE_TIER_KEY`, `SESSION_SECRET`).
- Route test (router factory, `127.0.0.1` per LIN-2023):
  - `.md` returns 200 `text/markdown`, nosniff, `MARKDOWN_CSP`;
  - HTML returns 200, has the guide's headings, the local-workspace form, and sign-in buttons per flags;
  - no origin → 400 `ORIGIN_UNRESOLVED`;
  - no `Set-Cookie`.
- `guest-task-path.test.js`: the two paths, plus case and trailing-slash forms, are exempt. Lookalikes `/getting-startedx` and `/getting-started/x` are not. **This is the test that tries what the guard is for.**
- `library.test.js`: `sitemapEntries` includes `/getting-started`.
- `render-landing.test.js`:
  - the block is present with its testid and the origin filled;
  - it's absent when `origin` is null;
  - the landing HTML has no inline `<script>` beyond the hashed prepaint;
  - `landing-agent-prompt.js` is in the scripts.
- An llms.txt test: `/getting-started.md` appears before `## Library`.
- `prompt-size-budget.test.js`: three ceilings at their measured size: guide source, guide rendered at the fixed `BASE_URL` with every door on, landing prompt rendered.

**E2E** (`tests/e2e/landing.spec.js`, following its "every Library link resolves" test at `:209`)
- Clicking copy puts the prompt on the clipboard.
- At 320px wide, `scrollWidth <= clientWidth`, in the light and the `colorScheme: 'dark'` describe.
- **Link resolution.** Fetch `/getting-started.md`, extract every path, then GET each one that isn't a 404:
  - public paths as-is;
  - `/workspace/<urlKey>/…` paths against a workspace from `seedLocalWorkspace`.

**Manual, on the PR (scope Success Criteria):** the cold-agent walk. A fresh Claude Code session given only the copied prompt reaches either the local door or "sign in with X, then copy the Agent Prompt from Proxy", with no invented URL.

### Order, size, review

- **Order:** one PR, in this commit order:
  1. builder + doc + unit tests;
  2. route + exemption + sitemap;
  3. landing block + script + CSS + e2e;
  4. llms.txt / README / source-map / size ceilings.
- **Refactor:** none required. No research step marked one, and nothing here removes a cause elsewhere.
- **Session fit:** about 15 small edits in one feature. Each part lands and is verified in the order above, and I can't name an edge one session would lose, so it fits one session.
- **Plan review:** this widens the auth-exemption predicate, a guard, and raises the frozen prompt-size total, a contract. Both are easy to get subtly wrong and hard to notice once built.

plan-review due: yes
