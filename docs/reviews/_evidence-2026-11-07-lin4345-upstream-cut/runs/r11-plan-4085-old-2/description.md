## Implementation Plan

*Planned against `origin/main` `e1f75fe7` (2026-11-01). No commits since then touch the files below.*

### What this is for, and what done looks like

A cold visitor on `/` today has one control: sign in. Nothing on the landing page, and nothing in `/llms.txt`, shows a way in, and nothing is written for a coding agent. The 2026-10-23 cold-start review found exactly this gap (`docs/reviews/onboarding-cold-start-review-2026-10-23.md`, J6, J7, J8), and `/kpis` shows 0 first Go presses in 30 days. This change does three things:

- It adds a copyable prompt under the hero sign-in buttons. The visitor pastes it into their own agent.
- It adds a public guide at `/getting-started.md` (with an HTML twin at `/getting-started`). The guide tells that agent how to bring the person in.
- It puts an `/llms.txt` entry that points at the guide near the top of the file.

**Done when:** the Scope's *Success Criteria* hold as written above. The block shows at 320px in light and dark with a working copy button. `GET /getting-started.md` returns 200 `text/markdown` without auth, with every placeholder filled and every linked path resolving. `/llms.txt` names the guide. A cold Claude Code walk reaches a correct first step without inventing URLs. Unit tests and `ci-success` are green, with the size ceilings recorded.

The plan adopts the three decisions in the 2026-11-01 unblock comment:
- the block sits **directly under the hero CTAs**;
- the guide **asks first**, then defaults to the real tracker, with Local as the "just looking" path;
- the copy is **not gated** on a separate sign-off: the cold walk plus PR review is the bar.

### What the code shows that the Scope gets wrong or leaves out (each checked at HEAD)

1. **The landing page already ships JS.** The shell loads `/common.js` and `/app.js` (`lib/render-landing.js:483`). The CSP is `script-src 'self'` plus pinned hashes (`lib/security-headers.js:65`), so an inline `<script>` would be blocked. The copy button therefore goes in a new static file, `public/landing.js`. `app.js`'s `.prompt-copy` handler isn't reused because it is tied to a workspace and appends a proxy block (`public/app.js:1160-1199`).
2. **There is no "npm install box".** The look to borrow is the `.lx-terminal` glimpse (`public/landing.css:278-316`; markup at `render-landing.js` "checked prompts").
3. **`/api/proxy/instructions` needs a token.** It sits behind `authenticateProxyToken` (`routes/proxy.js:1340`) and returns 401 to a cold agent (review J5b). The guide may name it only as something to read *after* the Proxy-page Agent Prompt has handed over a token. It must never be a first fetch.
4. **The Local door is a POST form with no link.** It is `+ local workspace` in the preview nav on `/swipe`, `/swim` and `/ship` (`lib/components/navbar.js`, the `form action="/workspace/new"`; route `routes/workspace.js:41`). The guide has the **human** press it in their own browser. If the agent did it with curl, it would create a workspace that the person's browser can't open (no-cookie re-entry returns 302 to `/`, LIN-3065).
5. **The hero always shows the Linear button.** Its predicate is `isConfigured: () => true` (`lib/providers/linear/index.js:2364`), and the button 503s on an unconfigured self-host (LIN-3108). The guide names exactly the doors the hero shows, so it inherits that known gap and adds none. LIN-3108 owns the fix.
6. **The logout render has no origin.** `renderLandingPage` at `server.js:1958` gets no `origin`, so the prompt would have no absolute URL to point at.
7. **A public page must be in `isAuthExemptPath`** (`lib/guest-task-path.js:92`). Otherwise PAT auto-login and token refresh run on it (`lib/pat-session.js:42`, `server.js:1585`): an agent fetching the guide on a PAT self-host would be handed a session.
8. **`/llms.txt` describes the landing page in a second place.** The Limitations line at `public/llms.txt:826` lists every landing `data-testid`.

### Which way the change goes, and why

- **The guide is a doc served at HEAD and filled from source, following `lib/prompts/runner-kickoff.js`.**
  - The guide lives in `docs/agent-onboarding.md`: design notes, then the first `---` line, then the served body.
  - The builder is `lib/prompts/agent-onboarding.js`. It caches the template and serves an uncached FALLBACK if the read fails or the doc has an unknown placeholder.
  - Placeholders: `{{BASE_URL}}`, `{{SIGN_IN_DOORS}}`, `{{AI_ACCESS}}` (free tier or bring-your-own OpenRouter key) and `{{README_URL}}`. `{{README_URL}}` is `GITHUB_BASE` (`lib/library.js:34`) plus `README.md`.
  - Why: this is the repo's established pattern for agent-facing text, and it makes a hand-copied fact a test failure.
  - *Set aside:* making it a Library listed doc. The URL would be wrong, and the Library can't template per deployment.
- **Each fact has one source, shared by the hero, the "try it" block and the guide.**
  - `landing-hero.js` gains a door list, `[{id, label, href}]` built from the same gates. `renderSignInCtas` renders from that list, and the guide's `{{SIGN_IN_DOORS}}` is rendered from it too.
  - One function returns the four deployment flags: GitHub, Jira and email sign-in, plus the free tier. The three call sites use it: both `renderLandingPage` calls (`server.js:1958`, `:2332`) and the new route.
  - Why: today the flags are spelled out twice in `server.js`. A third copy is how the guide would end up naming a door the hero hides.
  - The preview navbar keeps its own predicate calls (LIN-1890 E4 explains why) and is out of scope.
- **The landing prompt is static per deployment.** `buildLandingAgentPrompt({ baseUrl })` lives in the same module and takes only the origin. Taking nothing else is the structural guarantee that the prompt holds no secret and no per-user data. The copy is 2–3 short paragraphs:
  - who it is for (your coding agent), and Harbour in one sentence;
  - fetch `<origin>/getting-started.md` and follow it;
  - if you can't fetch it, ask the person to open that URL and paste it in;
  - start by asking the person what they want, and use only URLs the guide gives.

  Write it in the plain-language style (`docs/papers/harbour/plain-language.md`).
- **The landing block uses the request origin the page already gets, and is left out when there is none.** The block uses `renderLandingPage`'s existing `origin` (`requestOriginOrNull(req)`), HTML-escaped. If `origin` is null, the block is omitted rather than pointing at a broken URL.
  - The logout render gets its origin from the request on the response object (`res.req`). That fixes the cause in item 6, and also gives the logout page its canonical tags.
  - A `<pre>` holds the prompt, so it stays selectable without JS. The copy button is injected by `public/landing.js` (the `public/templates.js` pattern), so no dead button appears without JS.
  - The copy runs synchronously inside the tap, so it works on iOS. On a refusal, it selects the `<pre>` text and says "select and copy" (the `public/runner-setup.js` behaviour).
- **The route is a small router modelled on `routes/library.js`.**
  - It is `routes/getting-started.js`, mounted beside `createLibraryRouter()` (`server.js:2456`).
  - `.md`: `text/markdown; charset=utf-8` under `MARKDOWN_CSP`.
  - HTML: the shared `is-landing` shell under `LIBRARY_CSP`, carrying no external script. It shows a one-line lead ("written for your coding agent"), a link to the `.md`, and **the served markdown, escaped, in a `<pre>`** (wrapping, so 320px works).
  - Both responses send `nosniff` and set no cookie. The origin comes from `publicOrigin(req, { safeHost: true })`, the Library's rule, so a forged Host header can't plant a URL in the guide.
  - *Set aside:* rendering the markdown to HTML. That would need a second safe renderer, or a coupling to the Library catalog, for a page whose real reader is an agent. A `<pre>` shows the person exactly what their agent reads.
- **Guide content**, in this order:
  1. What Harbour is.
  2. Ask or look first.
  3. The paths:
     - (a) **just looking**: the person opens `<origin>/swipe` and presses `+ local workspace`;
     - (b) **connect a real tracker**: the person signs in through one of `{{SIGN_IN_DOORS}}`, opens the Proxy view (`/workspace/<their workspace>/proxy`), presses "generate & copy" under Agent Prompt and pastes the result back to the agent;
     - (c) **run work on their machine**: `/workspace/<their workspace>/runner`.
  4. What only a human can do: OAuth sign-in, the OpenRouter key (per `{{AI_ACCESS}}`), and minting the runner key.
  5. What the agent does after that.
  6. `/llms.txt`, and `/api/proxy/instructions` (with its token caveat).
  7. Self-host: one line pointing at `{{README_URL}}`.

  Every path is written as `{{BASE_URL}}/…` or as an explicit `/workspace/<your workspace>/…` pattern, so an agent never has to make up a path.

### Every place this behaviour lives

The behaviour: **"how a newcomer, or their agent, finds the way in before signing in"**, and **"what the landing page is made of"**. I found the places with:
- `grep -rn "renderLandingPage\|renderSignInCtas\|isAuthExemptPath\|sitemapEntries" server.js lib routes`;
- `grep -n "landing-" public/llms.txt`;
- `grep -n "render-landing\|guest-task-path\|library.js\|runner-kickoff" docs/architecture/source-map.md`;
- the size-budget header's surface list.

In scope:
- **Guide:** `docs/agent-onboarding.md` and `lib/prompts/agent-onboarding.js` (new).
- **Route:** `routes/getting-started.js` (new), mounted in `server.js`.
- **Auth exemption:** add `/getting-started` and `/getting-started.md` to `lib/guest-task-path.js` `isAuthExemptPath`, case-insensitive with one trailing slash stripped, like the rest. Lookalikes such as `/getting-started-x` stay non-exempt.
- **Sitemap:** add `/getting-started` to `routes/library.js` `sitemapEntries`'s fixed entries.
- **Landing:**
  - `lib/render-landing.js`: the new section, immediately after the hero and before the setup notice, with `data-testid="landing-agent-prompt"`; add `/landing.js` to `scripts`; update the header comment.
  - `lib/components/landing-hero.js`: the door list.
  - `public/landing.js` (new).
  - `public/landing.css`: semantic tokens only, no raw hex (the file's dark-safe rule).
- **Flags:** the single deployment-flags function, used by the three call sites in `server.js` (logout `:1958`, `/` `:2332`, the new route).
- **`public/llms.txt`:**
  - a "Getting started / onboarding a user" entry above `## Library`, pointing at `/getting-started.md` (and saying it is public);
  - add `agent-prompt` to the testid list in the Limitations landing line (`:826`).
- **Size budgets:**
  - In `tests/unit/prompt-size-budget.test.js`, add three ceilings: guide source, guide rendered, landing prompt rendered. Each is measured at landing and carries `LIN-4085`. The reason to record: new agent-facing text; it is instructions to an outside agent, which no code can carry.
  - Add the three to `ceilingSum`, raise `FROZEN_TOTAL_BYTES` by their sum, and change the matcher's expected count from `+ 5 + 1` to `+ 8 + 1`.
  - Add an `'agent onboarding'` group to `scripts/steady-base-growth.mjs` `GROUPS`, which that header says it mirrors.
- **Docs:**
  - `docs/architecture/source-map.md`: new entries for the route, module, doc and `public/landing.js`. Update the `render-landing.js` line (`:82`), the `guest-task-path.js` exempt-path list (`:119`) and the `routes/library.js` sitemap set (`:46`).
  - `CLAUDE.md:69`, the landing sentence: add "an agent prompt".
- **Visual references:** refresh `tests/screenshots/pages/landing*.png` with the visual maker. It is not part of `npm test`, but the refreshed images are the light/dark evidence.

Out of scope, with what tracks each:
- The preview-nav door predicates: kept apart on purpose (LIN-1890 E4).
- The Linear CTA 503 on an unconfigured self-host: LIN-3108.
- The Local door having no link from the landing page: LIN-2387. The guide routes the person to `/swipe` instead.
- No-cookie re-entry: LIN-3065.
- `/llms.txt`'s stale opening description (review D1) and the rest of llms.txt.
- The authenticated Home card: LIN-3833's slot.
- New agent endpoints for human-only steps.
- **The `setupNotice` box stays.** It is a localhost `.env` notice, not redundant with this block, so the optional dedupe isn't taken.
- `scripts/scan-public-pages.mjs` needs no edit: it already scans every external JS file on `/`, so `landing.js` is covered.

What reading can't settle: whether the guide's wording actually gets a fresh agent to the right first step. The cold-agent walk is the check for that (below).

### Witnesses (each fails before the change and passes after)

- **Unit, `tests/unit/agent-onboarding.test.js`:**
  - For every combination of github/jira/email/free tier, the guide has no `{{` and names each enabled door's href. For every combination, its door set equals the hero CTAs' hrefs: with GitHub off, there is no `/auth/github`.
  - A trailing slash on `baseUrl` is stripped.
  - Nothing above the doc's first `---` is served.
  - A fixture doc with an unknown placeholder serves the FALLBACK, and the next call retries.
  - `buildLandingAgentPrompt` contains `<baseUrl>/getting-started.md`.
- **Unit, `tests/unit/getting-started-route.test.js`** (express app with the router, like `library.test.js`):
  - `.md` returns 200 `text/markdown; charset=utf-8` with `MARKDOWN_CSP` and `nosniff`, and no `Set-Cookie`.
  - `/getting-started` returns 200 HTML with `LIBRARY_CSP`. The guide text sits inside an escaped `<pre>`, and there is no `<script src`.
  - A forged `Host: evil.example"<x` gives a guide that names `https://harbour.cat`, not the forged host.
- **Unit, `guest-task-path.test.js`:** `/getting-started`, `/getting-started.md` and `/Getting-Started/` are exempt. `/getting-startedx`, `/getting-started-x` and `/api/getting-started` are not.
- **Unit, `library.test.js`:** `sitemapEntries` includes `/getting-started`.
- **Unit, `render-landing.test.js`:**
  - The block is present, after `landing-ctas` and before `landing-loop`.
  - Its `<pre>` text equals `buildLandingAgentPrompt({ baseUrl: origin })`.
  - It is byte-identical across free-tier and door flags, so only the origin feeds it.
  - An origin containing `"<` comes out escaped.
  - `origin: null` gives no block.
  - The page loads `/landing.js`.
- **Unit, size budgets:** the three new ceilings pass at their measured sizes, and the matcher-count test passes with the new count.
- **E2E, `tests/e2e/getting-started.spec.js`** (runs in CI shards):
  - At 320px, in light and in dark (`localStorage` theme), the block is visible and `expectNoClippedOverflow` passes.
  - With clipboard permissions granted, pressing copy puts exactly the `<pre>` text on the clipboard.
  - With `javaScriptEnabled: false`, the `<pre>` text is present and there is no copy button.
  - **Link walk:** fetch `/getting-started.md`, take every `<origin>/…` path it names, and substitute a real key from `seedLocalWorkspace` for `<your workspace>`. GET each one and assert it is not a 404. The `/workspace/<key>/…` ones should be 200, and `/api/proxy/instructions` 401, which is the documented token gate.

  This is the test that fails wherever the guide names a route that doesn't exist.
- **The existing LIN-3980 e2e** "at 390×844 the plain sentence and the Linear button are inside the first screen" (`tests/e2e/landing.spec.js:270`) must stay green. That is why the block goes *after* the hero and not inside it above the buttons.
- **Cold-agent walk (PR evidence, manual):** start a fresh Claude Code session with no Harbour context and give it only the copied prompt from a running build. It must reach either the `/swipe` → `+ local workspace` instruction or "sign in with X, then generate & copy the Agent Prompt on Proxy", without inventing a URL. Record the transcript on the PR.

### Likeliest ways this breaks

1. **The guide and the hero drift** and the guide names a door that 503s or is hidden. Guarded by the single door list and flags function, plus the combination test.
2. **The public route picks up auth behaviour:** it mints a session, redirects a signed-in visitor, or reflects a forged host. Guarded by the exemption test, the no-`Set-Cookie` assertion and the safeHost test.
3. **Copying fails where it matters (phone, no JS) or the block overflows at 320px.** Guarded by the e2e copy, no-JS and overflow checks.
4. Less likely: **the agent follows the guide to a gated or made-up URL.** Guarded by the link walk and the cold walk.

### Landing order

One PR, in commits that each keep the tree green:
1. The door list and flags function. This changes no behaviour, so the existing landing and hero tests pass unchanged.
2. The doc, builder, unit tests and size ceilings.
3. The route, exemption, sitemap and mount.
4. The landing block, `landing.js`, CSS and the logout origin.
5. llms.txt, source-map and CLAUDE.md.
6. The e2e spec.
7. The cold walk, recorded on the PR.

No refactor was flagged `refactor required`. The door-list and flags extraction is folded in as commit 1 because the guide depends on it.

**Session fit:** fits one session. Every piece follows a pattern already in the repo: runner-kickoff, the library router, templates.js copy, guest-task-path tests.

plan-review due: no. It needs one session and routes around no cause. It loosens no guard: the exemption *withholds* session minting on a new read-only public path, the same class as `/library`, and the size-budget change adds ceilings rather than raising existing ones. It touches no credentials, merge rules or dispatch contract.
