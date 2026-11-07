## Implementation Plan

### What this is for, and what done looks like

**As asked:** where most software puts an `npm install` line on its homepage, Harbour should offer a prompt that a person pastes into their own coding agent. The prompt points the agent at a `harbour.cat/getting-started` guide. The agent reads the guide, then either talks with the person or looks at their repos and settings, and onboards them to Harbour, so the person never has to follow the setup steps themselves.

**Done when:** this plan uses the Success Criteria in the finalized Scope above, unchanged. In short: `/` shows a copyable agent prompt below the hero CTAs, and it works at 320px in light and dark. `GET /getting-started.md` returns 200 `text/markdown` with no auth, every placeholder filled and every link a real route. `GET /getting-started` renders HTML. `/llms.txt` names `/getting-started.md`. A cold-agent walk is recorded on the PR. `npm run test:unit` and `ci-success` are green.

**Is the ask still what it's for?** Yes. Scoping already restated it correctly: production `/` has no getting-started section, so this adds a new block. The cause behind the symptom (neither the landing nor `/llms.txt` names a way in, and no onboarding text is written for agents) is in scope, and this plan keeps it there. The three open product questions are settled by the 2026-11-01 unblock comment, and this plan builds on those answers: the block goes **directly under the hero CTAs**; the guide **asks first, defaults to the real tracker, and offers local as the "just looking" path**; wording sign-off is **the cold-agent walk plus PR review**.

### Corrections to the Scope (re-grounded at HEAD `e1f75fe7`)

No commits since the ticket was created touch any file it names (`git log --since=2026-11-01` over the named paths, `routes/`, `server.js` and `lib/prompts/` is empty). Reading the code, though, shows four Scope statements that are wrong and change how the work is built:

1. **"The landing ships no JS" is wrong.** `renderLandingPage` already loads `/common.js` and `/app.js` (`lib/render-landing.js`, the `scripts:` line in its `renderPageShell` call). A new script is still needed, for two reasons. The app CSP is `script-src 'self'` plus pinned hashes (`lib/security-headers.js:65`), so an inline `<script>` would be blocked. And `app.js`'s `.prompt-copy` handler appends a proxy block and can mint a token (`public/app.js:1158-1184`, `maybeAppendProxyBlock`). So the block must **not** use the `.prompt-container`/`.prompt-copy` classes. It uses its own small file, following the precedent of `public/templates.js` ("No proxy/token machinery").
2. **The design-notes cut is the other way round.** In `docs/runner-prompt.md` the design notes come first, and the served body is everything **after** the first `^---$` line (`lib/prompts/runner-kickoff.js:5-6`, the `load()` divider). The guide follows the real pattern: notes above, served body below.
3. **The guide route is missing from the auth exemption.** A public, session-less page must be added to `isAuthExemptPath` (`lib/guest-task-path.js:93-106`). That one predicate keeps both PAT auto-login (`lib/pat-session.js`) and the token-refresh `app.use` in `server.js` from minting a session for a signed-out visitor (LIN-3346: one list, never two). Without it, visiting `/getting-started` on a PAT deployment signs the visitor in.
4. **An existing landing test collides with the obvious copy.** `tests/unit/render-landing.test.js:112` asserts `!renderLandingPage({}).includes('Getting started')` to prove the setup notice is absent. The new block's visible copy should say "Or hand this to your coding agent", not "Getting started". The builder also narrows that assertion to the notice's own markup (`class="setup-notice"`), so it tests what it means to.

### Which way the change goes

There is one new agent-facing document, served from source with every variable filled from code, plus one static landing prompt that points at it. The landing, the guide and `/llms.txt` each name the same way in.

- **Guide source:** `docs/agent-onboarding.md`. Design notes, then `---`, then the served body. The content and its order are as in Scope §1. The copy must also say these true things:
  - The local workspace lives only in the browser that made it. It can't be reopened without that cookie (LIN-3065), so the **human** must press `+ local workspace` on `/swipe` (`lib/components/navbar.js:108`, the only door today). An agent that POSTs `/workspace/new` itself gets a cookie the human doesn't have.
  - `/api/proxy/instructions` needs the token from the Proxy page's Agent Prompt, so the guide links it as "once you have a token".
  - If the agent can't fetch a URL, it asks the person to paste the guide in.
- **Guide builder:** `lib/prompts/agent-onboarding.js`, modelled on `createRunnerKickoffBuilder`:
  - It reads the doc at HEAD once and cuts at the first `---`.
  - A failed read, or a `{{NAME}}` the builder doesn't know, serves a short FALLBACK that is never cached, rather than raw braces.
  - Placeholders: `BASE_URL` (per request), `SIGN_IN_DOORS` (a list of the enabled doors as absolute URLs) and `FREE_TIER` (one sentence for each state).
  - It also exports the **landing prompt**: a 2–3 paragraph constant where `{{BASE_URL}}` is the only placeholder, pointing at `<origin>/getting-started.md`.
  - *Set aside:* generalising the runner and passage-runner builders into one shared loader. Nothing here needs it, and the runner's builder carries kit-pin caching that this one doesn't.
- **One list of sign-in doors:** in `lib/components/landing-hero.js`, extract `signInDoors({githubEnabled, jiraEnabled, emailEnabled})` → `[{id, label, href}]` from `renderSignInCtas`, which then maps over it. The guide's `SIGN_IN_DOORS` uses the same list, so the guide can't offer a door the hero hides. Rendered HTML doesn't change.
- **One read of the deployment flags:** today the flag reads are copied at `server.js:1958` (the logout render) and `server.js:2332` (`/`). Add `lib/deployment-doors.js` exporting `readDeploymentDoors()` → `{githubEnabled, jiraEnabled, emailEnabled, freeTierEnabled}`, built from the same predicates (`getProvider(...).entryCta.isConfigured()`, `isEmailSignInAvailable()`, `isFreeTierOffered()`). `/`, the logout render and the new route all call it. A third copy would be the drift LIN-2010/LIN-3980 removed.
- **Route:** `routes/getting-started.js` (`createGettingStartedRouter({ buildGuide, readDoors })`), mounted in `server.js` beside `/templates` and the Library.
  - `GET /getting-started.md` returns the filled guide as `text/markdown; charset=utf-8` under the Library's `MARKDOWN_CSP` (export it from `routes/library.js`, never copy it), with `X-Content-Type-Options: nosniff`.
  - `GET /getting-started` returns the same filled text, HTML-escaped, in a `white-space: pre-wrap` block on the shared `is-landing` shell. It has a one-line human lede ("this page is written for your coding agent…") and a link to the `.md`.
  - The base URL is `publicOrigin(req, { safeHost: true })`, the same origin the Library's canonical tags use.
  - *Set aside:* rendering the guide's markdown to HTML. The Library's marked instance rewrites links against the docs tree (repo links go to GitHub), and a second sanitising renderer is a new XSS surface. Showing the human exactly what their agent reads is the honest render.
- **Exemption and sitemap:** add `/getting-started` and `/getting-started.md` to `isAuthExemptPath` as exact matches, after the existing lowercase and trailing-slash strip. In `routes/library.js`, add `/getting-started` to `sitemapEntries`' fixed entries (beside `/` and `/library`; the `.md` stays out, as Library `.md` URLs do).
- **Landing block:** a new `<section class="lx-section …" data-testid="landing-agent-prompt">`, the first thing in `<main>` after `setupHtml`. It sits *below* the hero `<header>`, not inside it, so the hero's DOM and the 390×844 first-screen test stay as they are.
  - It is styled like `lx-terminal` with tokens only, and the `<pre>` wraps (`pre-wrap`) so nothing scrolls sideways at 320px.
  - It must **not** carry `role="img"` (the glimpses do; this is real text).
  - A `<button>` copies the `<pre>`'s `textContent` via the new `public/landing.js`, added to the landing's `scripts`. Without JS, the text can still be selected.
  - The block renders only when an `origin` is known, the same rule the canonical tag follows. The logout render passes `origin: requestOriginOrNull(res.req)`, so it shows there too.
- **`/llms.txt`:** add a short `## Getting started (onboarding a user)` section above `## Library` that points at `/getting-started.md`. Add `agent-prompt` to the landing testid list in `## Limitations` (`public/llms.txt`, the `landing-{hero,plain,…}` line). CLAUDE.md requires that update, and LIN-2255's test keeps that section true.
- **Size budget:** in `tests/unit/prompt-size-budget.test.js`, add three ceilings: guide source, guide rendered (all doors on, free tier on, the file's `BASE_URL`) and landing prompt rendered. Each ceiling is set to its measured size with a `LIN-4085` comment giving the reason (new agent-facing text that can't be code). Raise `FROZEN_TOTAL_BYTES` by exactly their sum. Add them to the sum test. Bump the matcher's expected count (`+ 5 + 1` → `+ 8 + 1`). Add an `'agent onboarding'` group to `GROUPS` in `scripts/steady-base-growth.mjs`, which the test header says it mirrors.
- **Docs:** `docs/architecture/source-map.md` gets entries for `routes/getting-started.js`, `lib/prompts/agent-onboarding.js`, `lib/deployment-doors.js`, `public/landing.js` and `docs/agent-onboarding.md`. It also updates two existing entries that describe today's shape: `guest-task-path.js` (its list of exempt paths) and `library.js` (the sitemap's fixed set).

### Every place the behaviour lives

The behaviour is **"where a newcomer, or their agent, is told the way into Harbour"**. These are the places I found, by reading the landing, `/llms.txt`, the public-path predicate and its tests, the sitemap, the size guard and its mirror, and by searching for `renderLandingPage(`, `isAuthExemptPath`, `sitemapEntries`, `RUNNER_PROMPT_*_CEILING` and `landing-{` across `lib/ routes/ server.js tests/ public/ docs/ scripts/`:

| Place | In or out |
|---|---|
| `lib/render-landing.js` (new block), `lib/components/landing-hero.js` (door list), `public/landing.css`, new `public/landing.js` | in |
| `server.js:2332` (`/`) and `server.js:1958` (logout render): both landing renders | in |
| New `docs/agent-onboarding.md`, `lib/prompts/agent-onboarding.js`, `routes/getting-started.js`, `lib/deployment-doors.js` | in |
| `lib/guest-task-path.js` `isAuthExemptPath` | in |
| `routes/library.js` `sitemapEntries` | in |
| `public/llms.txt`: new section, and the Limitations testid list | in |
| `tests/unit/prompt-size-budget.test.js`, `scripts/steady-base-growth.mjs` GROUPS | in |
| `docs/architecture/source-map.md`: 5 new entries and 2 updated | in |
| Authenticated Home copy-first card (`lib/render.js:281-284`) | out: Scope says LIN-3833 owns it |
| Setup-notice duplicate (`render-landing.js` / `render.js:286-291`) | out: the new block doesn't make it redundant (different audience, `.env` on localhost); nothing here needs the dedupe |
| `scripts/scan-public-pages.mjs` page list | out: it scans served JS, and `/` already pulls in `landing.js`. The guide serves no script |
| README `/llms.txt` intro line ("displays … as a collapsible tree") | out: Scope excludes rewriting `llms.txt` beyond the entry |
| The local door being reachable only from `/swipe` (cold-start review J2) | out: the guide names that door honestly. Linking it from `/` is a landing redesign, which Scope excludes |

These checks catch any place I missed:
- the link-check test below fails on any guide path that no route serves;
- the e2e sitemap test (`tests/e2e/library.spec.js:85`, "every sitemap `<loc>` resolves 200 without noindex") fails if `/getting-started` isn't served publicly;
- the size guard's matcher-count test fails if a ceiling is added without being counted.

### Witnesses (each fails before the change, passes after)

- **Route** (new `tests/unit/getting-started.test.js`, a real Express app bound to `127.0.0.1`, per LIN-2023): `GET /getting-started.md` returns 200 with `text/markdown`, nosniff, the sandbox CSP and no `{{`. `GET /getting-started` returns 200 HTML that contains the escaped guide text. A `Host:` that fails `safeHost` produces `harbour.cat` URLs, never the forged host.
- **Filled from source:** with doors `{github:false, jira:true, email:false}`, the guide lists exactly `signInDoors()`'s Linear and Jira hrefs and no GitHub. Flipping free tier changes the sentence. An unknown placeholder in a temp doc serves the fallback, and a later call with a good doc doesn't stay stuck on it.
- **Link check:** every same-origin path in the rendered guide (`<base>/…`, with `<urlKey>`-style segments treated as a parameter) matches a GET route registered in `server.js` or `routes/*.js`. Reading the source is enough, as other drift tests do; the exact matcher is the builder's call. Run it against a guide with a made-up `/no-such-route` link to prove it fails.
- **Must-do anchors:** one anchor per required section (ask or look first; the three paths; what only a human can do; can't-fetch fallback; `/llms.txt` and `/api/proxy/instructions`; self-host pointer). `runner-kickoff.test.js` does the same.
- **Landing** (`tests/unit/render-landing.test.js`):
  - with `origin`, the block is present and its `<pre>` text equals `buildLandingAgentPrompt({ baseUrl: origin })` escaped. That equality also proves the only variable part is the origin, so it holds no secret;
  - it sits after `landing-hero` and before `landing-loop`, and doesn't carry `role="img"`;
  - with no `origin`, it is absent;
  - the setup-notice test is narrowed as in Correction 4.
- **Exemption** (`tests/unit/guest-task-path.test.js`): add `/getting-started`, `/getting-started.md`, `/Getting-Started/` to `yes`. Add `/getting-startedx`, `/getting-started/x`, `/api/getting-started` to `no`. This tries what the predicate guards against: a lookalike must not escape auth refresh.
- **Sitemap** (`tests/unit/library.test.js` at its `/sitemap.xml` test): the set includes `/getting-started`.
- **`/llms.txt`:** a unit assertion that `public/llms.txt` names `/getting-started.md` before `## Library`.
- **Browser** (`tests/e2e/landing.spec.js`):
  - at 320px wide, the block is visible and `document.documentElement.scrollWidth <= clientWidth`, in both light and `.theme-dark`;
  - with clipboard permission granted (the `prompts.spec.js:64` pattern), clicking copy puts exactly the `<pre>` text on the clipboard, it contains `<origin>/getting-started.md`, and no request goes to `/api/proxy/` or a token mint;
  - `GET /getting-started.md` returns 200 with no session.
- **Cold-agent walk:** recorded on the PR as Scope describes. It is evidence, not a CI gate.

### Likeliest ways this breaks

1. **A signed-out visitor gets a session on the guide.** This happens if the exemption is missed or matches the wrong paths. The exemption tests above catch it, and so does the existing `pat-session.test.js` public-path pattern (`:280`), which the builder extends with `/getting-started.md`.
2. **The guide drifts from the product.** A hand-typed URL, a door the deployment doesn't have, or a route renamed later. The shared `signInDoors`, placeholder filling, the fallback on an unknown name, and the link-check test catch these.
3. **The landing block regresses the page.** Sideways scroll at 320px; a copy button picked up by `app.js`'s token-minting handler; the hero's first screen pushed down. Own class names, a block placed outside the hero, the 320px and clipboard e2e checks, and the untouched 390×844 test catch these.

### Order of landing (one PR)

1. The `signInDoors` and `readDeploymentDoors` extractions. No output changes, and the existing landing unit and e2e tests stay green.
2. The guide doc, its builder and its unit tests.
3. The route, the exemption, the sitemap entry and their tests.
4. The landing block, `landing.js`, CSS, the logout-render origin, and tests.
5. `/llms.txt`, size ceilings with `FROZEN_TOTAL_BYTES` and GROUPS, and source-map.
6. The cold-agent walk, recorded as PR evidence.

**Left out:** everything in Scope's Out of Scope list, and the rows marked out in the table above.

### Session fit and review

fits one session. Each step is small and has its own test. The only open-ended part is writing the guide's copy, and the must-do anchors and the cold-agent walk bound it. No refactor is marked `refactor required`. The two extractions are small, done in place, and remove the drift this change would otherwise add.

plan-review due: no. It fits one session, routes around no cause, and touches no credentials, merge rules or dispatch contract. The exemption change makes two new public paths skip session minting: that narrows when a session is created rather than loosening a guard, and a test covers the lookalikes. The ceiling raise follows the size guard's own documented process (reason recorded beside the ceiling; no other approval).
