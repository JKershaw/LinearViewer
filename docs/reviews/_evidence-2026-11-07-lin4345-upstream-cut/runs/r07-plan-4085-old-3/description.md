## Implementation Plan

**What this is for.** A cold visitor on `/` has one thing to do today: sign in. The 2026-10-23 cold-start review (`docs/reviews/onboarding-cold-start-review-2026-10-23.md:19`, R3-6, R3-8) found that the paths that work, including a zero-credential one, are never pointed at. The landing doesn't name them, `/llms.txt` names no way in, and no text is written for an agent. This change gives the visitor something to copy into their own coding agent. That prompt sends the agent to a public guide at `/getting-started.md`. The guide lets the agent pick a path with the user, hand the user the few clicks only a person can make, and do the rest through the agent surfaces that already exist. Both parts of the cause are fixed here: the landing and `/llms.txt` will name a way in, and the onboarding text will be addressed to agents.

**Done when** (the scope's Success Criteria, with the corrections below applied):
- On a configured deployment, `/` shows the agent-prompt block right under the hero sign-in buttons, and its copy button works. At 320px there is no horizontal page scroll, in light and in dark.
- `GET /getting-started.md` returns 200 `text/markdown; charset=utf-8` with no session. Every placeholder is filled, and every link points at a real route. `GET /getting-started` returns an HTML page for people.
- `/llms.txt` names `/getting-started.md` in its first section.
- A cold-agent walk passes and is recorded on the PR: a fresh Claude Code session with no Harbour context, given only the copied prompt, ends at either the local-workspace door or a correct "sign in with X, then copy the Agent Prompt from Proxy". It invents no URL.
- `npm run test:unit` and `ci-success` are green, and each new size ceiling carries its reason.

The three open product questions are settled as the 2026-11-01 unblock comment decided them: the block goes **directly under the hero sign-in buttons** ("Or hand this to your coding agent"); the guide **asks first, then defaults to the user's real tracker**, with Local as the "just looking" path; and **wording is not a merge gate**, because the walk plus PR review is the bar.

### What the scope got wrong (checked at HEAD `e1f75fe7`; no commits since the ticket touch any file named here)

1. **The served part of `docs/runner-prompt.md` is below the first `---`, not above it.** The design notes come first (`docs/runner-prompt.md:1-24`, cut in `lib/prompts/runner-kickoff.js:82-85`). The new guide follows the real pattern: notes first, then `---`, then the served body.
2. **The landing does load JS** (`/common.js`, `/app.js`, `lib/render-landing.js:485`). It has no inline script, and the CSP (`lib/security-headers.js:65`) allows only `'self'` plus hashed inline scripts. So the copy button lives in a new static file, `public/landing.js`. It is not an inline `<script>`.
3. **`/api/proxy/instructions` returns 401 without a proxy token** (`routes/proxy.js:1328`; the review confirms it live, `:118`). The guide may point there only as "once you hold a token from the Agent Prompt, read this". It must not be a link a cold agent fetches first.
4. **The Local door is a POST form, and only the user's browser can use it.** It appears as "+ local workspace" in the nav of the preview pages (`/swipe`, `/swim`, `/ship`; `lib/components/navbar.js:108`) and on `/account` after an email sign-in. A Local workspace can be re-entered only through the session cookie that created it (LIN-3065, review R3-2). If the agent POSTs `/workspace/new` itself, it creates a workspace in its own cookie jar that the user can never open. The guide must say so: the **user** presses the button in their own browser.
5. **The new public paths must join the one auth exemption** (`isAuthExemptPath`, `lib/guest-task-path.js:91`, LIN-3346). If they don't, PAT auto-login and token refresh run when an agent fetches the guide. The scope left this out.
6. **The landing's `origin` comes from the raw Host header** (`requestOriginOrNull`, `server.js:2332`), and it is `null` on the logout render (`server.js:1958`). Text that tells an agent which host to trust needs a validated origin and an honest answer when there is none (see Decisions).
7. **The sitemap tests count entries** (`tests/unit/library.test.js:340` expects `2 + docs + editions`). Adding `/getting-started` changes that count.

### Decisions

**D1. A single list of sign-in doors, read by the hero, the Try section and the guide.** In `lib/components/landing-hero.js`, split `renderSignInCtas` into a data function, `signInDoors({githubEnabled, jiraEnabled, emailEnabled})`, which returns `[{id, label, href, primary}]` (hrefs from `entryCta.href` and `/auth/email`, as today), and the renderer that maps it to buttons. Add one reader, `deploymentDoors()`, that calls the four predicates the `/` handler calls today: `getProvider('github').entryCta.isConfigured()`, the same for Jira, `isEmailSignInAvailable()` and `isFreeTierOffered()`. The `/` handler, the logout render and the new route all use it, which removes the two hand-copied argument lists in `server.js`. *Why:* the guide must never name a door the hero hides, or miss one the hero shows. Without this, the door set would be hand-copied a third time. *Set aside:* hand-writing door lines in the guide (they drift); having the guide link to `/` and let the agent read the buttons (an agent needs the hrefs).

**D2. The guide source is `docs/agent-onboarding.md`, built by `lib/prompts/agent-onboarding.js`.** The builder follows the shape of `createRunnerKickoffBuilder`: read the file at HEAD once, cut at the first `---`, fail closed on an unknown `{{NAME}}` by serving a FALLBACK that is never cached, and export a `create…Builder({promptPath})` for tests. It takes `{baseUrl, doors, freeTier}` on every call. These placeholders are filled from source, never hand-typed:
- `BASE_URL`;
- the sign-in door lines, rendered from `signInDoors(...)`;
- the free-tier sentence, chosen by `freeTier`;
- the README link, from `GITHUB_BASE` (`lib/library.js:34`).

The same module exports the landing prompt text: `buildLandingAgentPrompt({origin})`, 2–3 short paragraphs, with only the origin templated. *Why:* the guide and the prompt are one agent-facing surface, so one module owns and sizes both. *Set aside:* making the guide a Library document (the Library serves raw files with no templating, and its link rewriter sends root-relative links to GitHub, `lib/library.js:340-345`); extracting a shared "served doc" loader for the five near-identical ones in `lib/prompts/` (that refactor removes no cause here and would touch the security-pinned runner prompt; it is a follow-up, not this ticket).

**What the guide must say**, in this order. The builder writes the copy, in plain words with no internal names (LIN-3995):
- what Harbour is, in one paragraph (it may reuse `HARBOUR_PLAIN_SENTENCE`);
- ask the user or look at their repos and tracker before choosing a path, and never pick one silently;
- the paths:
  - **(a)** just looking: the user opens `{{BASE_URL}}/swipe` and presses "+ local workspace" in their own browser. The guide gives the reason the agent must not do this step itself (decision-list item 4), and says the workspace stays in that browser only;
  - **(b)** the user's real tracker: the user signs in through one of the listed doors, opens Proxy (`/workspace/<their key>/proxy`), and hands the agent the Agent Prompt. After that, the agent reads `/api/proxy/instructions` with the token it was given;
  - **(c)** running work on the user's machine: the runner page (`/workspace/<their key>/runner`), which needs Claude Code, Node 18+, and macOS or Linux;
- what only the user can do (OAuth sign-in, the OpenRouter key, minting the runner key) and what the agent does;
- a link to `{{BASE_URL}}/llms.txt`;
- what to do if a fetch fails: ask the user to open the URL and paste it;
- one line pointing self-hosters to the README.

Every URL in the served guide is absolute (`{{BASE_URL}}/…`), because a pasted prompt has no base.

**D3. A new `routes/getting-started.js` with two routes, mounted beside the Library router in `server.js` (`:2456`).**
- `GET /getting-started.md` serves the built guide as `text/markdown; charset=utf-8`, with `X-Content-Type-Options: nosniff` and the Library's `MARKDOWN_CSP` (import it from `routes/library.js`; don't copy it).
- `GET /getting-started` renders the same text, HTML-escaped, inside a `<pre>` in the shared page shell, following `lib/render-library.js:26-34` (the Library stylesheets, no scripts). It has a link to the `.md` and is served under `LIBRARY_CSP`. URLs may be made clickable if that is done on the escaped text, but it isn't required.
- `baseUrl` is `publicOrigin(req, { safeHost: true })`, the same function the Library's canonical tags and sitemap use. A forged Host header therefore falls back to `harbour.cat` and can't steer the URLs the agent is told to trust.
- Neither route reads the session or redirects a signed-in user, because the guide is useful after sign-in too.

*Set aside:* rendering the markdown to HTML. The only safe renderer, the Library's, is bound to its catalog. The HTML page exists for people who click through, and agents read the `.md`.

**D4. Add `/getting-started` and `/getting-started.md` to `isAuthExemptPath`.** List them as exact paths in the stripped-path list, so they match case-insensitively and with one trailing slash, like `/kpis`. Lookalikes are not exempt. Add `/getting-started` to `sitemapEntries` as a fixed entry beside `/` and `/library`.

**D5. The landing block.** `renderAgentPromptSection({origin})` in `lib/render-landing.js` renders the block right after the hero, before the setup notice and the loop:
- `data-testid="landing-agent-prompt"`, with the eyebrow "Or hand this to your coding agent" and a one-line lede;
- the existing `.lx-glimpse.lx-terminal` box, with the prompt in `<pre class="lx-terminal__body">` (it already uses `white-space: pre-wrap`, `public/landing.css:312`). It must **not** carry `role="img"` as the glimpses do: here the text is the content, and screen readers and no-JS users must get it;
- a `<button type="button">` copy control, `data-testid="landing-agent-prompt-copy"`.

`public/landing.js` follows the `public/templates.js` pattern: it copies the `<pre>`'s text, shows "copied ✓" or "copy failed — select the text", and leaves the text selectable. It is added to the landing's `scripts`. The block gets its origin from the `/` handler as a new `promptOrigin` (`publicOrigin(req, {safeHost: true})`), and is **left out when there is no origin**, as on the logout render. It never shows a relative URL. The existing `origin` parameter and the canonical tags keep their current behaviour. Any new CSS in `public/landing.css` uses only existing tokens (LIN-4015, LIN-3980). Also change the landing's `htmlComment` so it names `/getting-started.md` beside `/llms.txt`.

**D6. `/llms.txt`.** Add a short `## Getting started` section above `## Library`. It points an agent that is onboarding a user at `/getting-started.md`. Nothing else in `llms.txt` changes. The stale description on line 3 (review D1) stays out of scope.

**D7. Size budget.** In `tests/unit/prompt-size-budget.test.js`, add three ceilings: `docs/agent-onboarding.md` source, the guide rendered at `BASE_URL` with every door and the free tier on (its largest form), and the landing prompt rendered. Each is set to its measured size, with `LIN-4085` and the reason in its comment (the agent-facing text is new; it isn't growth). Raise `FROZEN_TOTAL_BYTES` by their sum, add them to the sum test, and raise the matcher's expected count (`+5 +1` becomes `+8 +1`). Add an `'onboarding guide'` group to `GROUPS` in `scripts/steady-base-growth.mjs`, so the two instruments stay in step, as the test header asks.

**D8. Docs.** In `docs/architecture/source-map.md`, add entries for `routes/getting-started.js`, `lib/prompts/agent-onboarding.js`, `docs/agent-onboarding.md` and `public/landing.js`. Also add the two new paths to the `guest-task-path.js` entry, which lists the exempt paths (`:119`), and to the `render-landing.js` entry.

### Where this behaviour lives (how I know the list is complete)

The behaviour is: what an agent or a cold visitor is told about how to get into Harbour, and which sign-in doors exist. I found it with `grep -rn "renderSignInCtas\|entryCta\|isEmailSignInAvailable\|isFreeTierOffered\|isAuthExemptPath\|sitemapEntries" lib routes server.js` and by reading `public/llms.txt`. In scope: the hero and Try buttons (`landing-hero.js`, through D1), the `/` and logout renders (`server.js:2332`, `:1958`), the exemption (`guest-task-path.js`), the sitemap (`routes/library.js:70`), `llms.txt`, the size budget, and the source map. Out of scope:
- the landing nav's own door links (`navbar.js:91-120`): they call the same predicates directly, and the landing suppresses them with `minimalNav`;
- `renderLoginPage`: not reached in production (`lib/render-pages.js:73-82`);
- the README and `docs/proxy-integration.md`: no rewrite, per the scope;
- the authenticated Home slot: LIN-3833;
- the footer link list: placement beyond the hero is a product call the ruling didn't ask for;
- the setup-notice dedupe: the new block doesn't make that box redundant;
- adding `/getting-started` to `scripts/scan-public-pages.mjs`: that scanner reads served JS, and this page ships none. `/landing.js` is picked up through `/`.

The link test (W4) catches any URL the guide gains later that no route serves.

### Likeliest ways it breaks

1. **The guide names a door that's off, or a path that's gone.** Caught by W1 (doors equal `signInDoors` for each config) and W4 (every guide URL resolves to a real route).
2. **An agent fetching the guide gets a session minted or refreshed**, or a signed-in visitor is redirected away from it. Caught by W3 and W2.
3. **The prompt points agents at an attacker's host, or at a relative URL.** Caught by W2 (a forged Host falls back to `harbour.cat`) and W5 (the block is absent when there's no origin, and its URL is absolute).

### Witnesses (each fails before the change and passes after)

- **W1** `tests/unit/agent-onboarding.test.js`:
  - for each of the 16 door and free-tier combinations, the built guide has no `{{` left, and its door lines are exactly `signInDoors(cfg)` (an `href` appears if and only if that door is on);
  - a trailing slash on `baseUrl` is stripped;
  - a fixture file with an unknown placeholder serves the FALLBACK, and a later call retries instead of caching it;
  - the landing prompt contains `<origin>/getting-started.md`.
- **W2** `tests/unit/getting-started-route.test.js`, against a server bound to `127.0.0.1` (the CLAUDE.md rule):
  - `.md` returns 200 with the exact content type, nosniff and `MARKDOWN_CSP`, and its body equals the builder's output;
  - the HTML route returns 200 with the guide's text escaped inside `<pre>`, a link to `.md`, and `LIBRARY_CSP`;
  - a request with `Host: evil.example/x` gets `https://harbour.cat`-based URLs (this tries the thing the safe-host rule exists to stop);
  - no cookie is needed.
- **W3** Add yes rows (`/getting-started`, `/getting-started.md`, `/Getting-Started/`) and no rows (`/getting-startedx`, `/getting-started/x`, `/api/getting-started`) to `tests/unit/guest-task-path.test.js`. Add `/getting-started.md` to the zero-provider-reads list in `tests/unit/pat-session.test.js:317`. The no rows test what the exemption must not widen to.
- **W4** Every `{{BASE_URL}}/…` URL in the built guide (all doors on) must be in one of two known sets, and the test fails on a URL in neither. Public, session-less paths are fetched by a new `tests/e2e/landing.spec.js` case with `request` and must not return 404, following the "every Library link resolves" case at `:209`. Workspace- and token-scoped paths (`/workspace/:urlKey/proxy`, `/workspace/:urlKey/runner`, `/api/proxy/instructions`) are checked in the unit test against their registered route strings (`server.js:3989`, `routes/runner-setup.js:56`, `routes/proxy.js`), because they need a session or a token to fetch.
- **W5** `tests/unit/render-landing.test.js`:
  - the block sits after `landing-hero` and before `landing-loop`;
  - its `<pre>` holds the full `buildLandingAgentPrompt` output with the origin filled in;
  - the block is absent when there's no `promptOrigin`;
  - the copy button is `type="button"`, and the page lists `/landing.js`;
  - the block has no `role="img"`;
  - the block contains no token-shaped string (reuse the patterns the secret scan uses, if they're exported).
- **W6** `tests/e2e/landing.spec.js`:
  - with clipboard permission granted, clicking copy puts exactly the `<pre>` text on the clipboard;
  - at 320px wide, `scrollWidth <= clientWidth`, in light and with `.theme-dark`.

  If the visual job's `landing` and `landing-dark` baselines fail, regenerate them; that diff is expected.
- **W7** A test that the first `##` section of `public/llms.txt` is `## Getting started` and names `/getting-started.md`. It can extend `tests/unit/llms-limitations.test.js` or be its own file.
- **W8** In `tests/unit/library.test.js`, the sitemap lists `${base}/getting-started`, and the count becomes `3 + …`. The "every loc resolves" case keeps its `/library` filter, and W4's e2e case covers the new loc.
- **W9** The size budget's new ceilings (D7) pass at their measured sizes.
- **W10** The cold-agent walk from Done-when, recorded on the PR with the transcript or its key turns. It must also show that the agent did not POST `/workspace/new` itself.

### Order of landing

All of this goes in one PR, in commits that each pass their own tests:
1. D1, the door data and reader. A pure refactor: the existing hero and Try tests, including `landing.spec.js:287`, must stay green unchanged.
2. D2 with W1, and D7.
3. D3, D4 and D8 with W2, W3 and W8.
4. D5 and D6 with W4–W7.
5. The walk (W10).

This work fits one session: one module, one route, one landing block, and the edits around them, each with its own witness.

This plan is one that deserves a second reader before it is built. It widens an auth guard (two new paths in `isAuthExemptPath`) and serves public instructions that tell outside agents what to do and which host to trust.

plan-review due: yes
