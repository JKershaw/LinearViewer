## Implementation Plan

*Plan, pass 1. Written against `origin/main` `e1f75fe7`, which is still HEAD. No commit since the ticket was created touches any file named below (`git log --since=2026-11-01 -- <files>` is empty). Builds on the finalized Scope and the 2026-11-01 unblock comment, and corrects that Scope in five places (see "Corrections").*

### What this is for, and what done looks like

The filer wants the homepage to have what a software homepage puts next to its `npm install` line: a short prompt the visitor pastes into their own coding agent. The prompt points the agent at `harbour.cat/getting-started`. That page walks the agent through onboarding the person and their project, so the person never follows the setup steps themselves. They just use their agent.

What it is for: the 2026-10-23 cold-start review found that nothing points anyone at a way in. The landing's try-it block has no control, `/llms.txt` names no way in (`docs/reviews/onboarding-cold-start-review-2026-10-23.md:19,136`), and `/kpis` shows 0 first Go presses in 30 days. Two causes, both fixed here: no surface addressed to an agent names a way in, and no onboarding text is written for agents.

**Done when** (the Scope's Success Criteria, carried as written, plus one line marked *plan*):
- On a configured deployment, `/` shows the agent-prompt block directly under the hero sign-in buttons, with a working copy button. The block works at 320px with no horizontal scroll, in light and in dark.
- `GET /getting-started.md` returns 200 `text/markdown` with no auth. Every placeholder is filled and every path it names is a real route (unit-tested). `GET /getting-started` renders HTML.
- `/llms.txt` names `/getting-started.md`.
- A cold-agent walk passes: a fresh Claude Code session with no Harbour context, given only the copied prompt, reaches either the local-workspace door or a correct "now sign in with X, then copy the Agent Prompt from Proxy". It does this without inventing URLs. The walk is recorded on the PR.
- *(plan)* Every button the guide tells the human to press appears, with that exact label, on `/getting-started` for this deployment.
- `npm run test:unit` and `ci-success` are green, and each new size ceiling records its reason.
- After it ships, someone watches the `/kpis` "How people get started" funnel. This is not a merge gate.

Product calls already made, and carried unchanged from the unblock comment:
- The block goes directly under the hero buttons, headed "Or hand this to your coding agent".
- The guide's agent asks first. It defaults to the person's real tracker when they have one, and uses the local workspace as the "just looking" path.
- Copy sign-off is the cold-agent walk plus PR review.

### Cuts to the `## As asked` block

**None.** Two clauses come close, so here is why each is delivered in full:
- *"without the user needing to follow those steps as the use uses the agent"*: the person never reads or follows the guide. The agent reads it and asks for each human action at the moment it is needed. The actions that stay with the human are consent and secrets: the OAuth sign-in, their own OpenRouter key (not needed at all where the free tier is on), and the owner's runner-key mint. Each is a single press the agent asks for, which is "using the agent naturally". The Scope's Out of Scope line (no new agent-callable endpoints for these) keeps them human, and does not cut the clause.
- *"a full guide on how to properly configure Harbour for whatever your situation is"*: the guide covers three situations (just looking, real tracker, running work on your own machine). It lists every Settings area with its purpose and path, filled from `lib/settings-areas.js` `AREAS` so the list cannot go stale. It sends self-hosters to the README, which is the maintained full self-host guide (`README.md` sections Authentication, Setup and Deployment). Copying the README into the guide would create a second copy that drifts.

### Corrections to the Scope at HEAD

1. **"The landing ships no JS" is wrong.** `/` loads `/common.js` and `/app.js` (`lib/render-landing.js:483`). The copy button still needs its own small file, `public/landing.js`, for two reasons. The enforced hash-based CSP (`lib/security-headers.js:63-72`) blocks any inline script that is not registered. And app.js's prompt-copy handler (`public/app.js:1158-1199`) appends workspace proxy blocks, which has no meaning on `/`.
2. **The runner-prompt pattern is the other way round.** In `docs/runner-prompt.md` the design notes sit *above* the first `---` line and the served body sits *below* it (`lib/prompts/runner-kickoff.js:85-86`). The guide follows that real shape.
3. **A new public page must join the auth exemption.** Since LIN-3346 (`10d3bf38`), PAT auto-login and token refresh both skip only `isAuthExemptPath` (`lib/guest-task-path.js:92-107`). Without adding `/getting-started`, a self-host with `LINEAR_ACCESS_TOKEN` set would log in anyone who opens the guide.
4. **`/api/proxy/instructions` needs a token** (`routes/proxy.js:1341`, `authenticateProxyToken`). The guide says to fetch it with the token that comes with the Agent Prompt. The link test checks that a route exists, not that it returns 200.
5. **The local door is a POST.** It is `POST /workspace/new` (`routes/workspace.js`). Before sign-in, a person meets it only in the `/swipe`, `/swim` and `/ship` nav, as "+ local workspace" (`lib/components/navbar.js:107-109`). If the agent POSTed it, the workspace would land in the agent's cookie jar, not in the person's browser. So the person has to press it, and the guide needs one page to send them to (see Part 2).

### Direction

Add one public, agent-readable guide, filled from source the way the runner prompt is. Then point every pre-sign-in surface an agent or visitor reads at it: the new landing block, `/llms.txt`, the sitemap, the README's "For AI Agents" list and the landing's HTML comment. Give the person one page, `/getting-started`, that holds every door the guide names, under the exact labels the guide uses.

Set aside:
- **A context-aware prompt.** `/` has no session, so the only context available is the deployment itself. Context belongs in the guide, where the agent can ask the person or read their repos.
- **Rendering the guide's HTML through the Library's markdown renderer.** That renderer depends on per-parse catalog state (`lib/library.js:46-48,90-131`). An escaped `<pre>` is safe by construction and enough for a page whose human job is the doors.
- **Pointing the person at `/` for sign-in and at `/swipe` for the local door.** That is two places, and the nav labels ("GitHub →", "+ local workspace") differ from the hero labels the guide would quote.
- **Reusing app.js's copy handler.** It carries the proxy append. See correction 1.
- **A shared loader across the five `lib/prompts/*-kickoff.js` modules.** No cause here needs one. The new builder follows the same read-at-HEAD pattern on its own.

### Shape

**Part 1: guide source and builder.**

*Guide source.* `docs/agent-onboarding.md` holds design notes above its first `---` line and the served body below it, as in correction 2. The body is prose addressed to the agent, in this order:
1. What Harbour is, in one paragraph.
2. Ask or look first: interview the person, or read their repos and tracker, before choosing a path. Do not choose without asking.
3. The paths:
   - (a) Just looking: the person presses `{{LOCAL_DOOR}}` on `{{BASE_URL}}/getting-started`.
   - (b) A real tracker: the person signs in with one of `{{SIGN_IN_DOORS}}` on the same page. The agent then asks them to open their workspace's Proxy page (`/workspace/<your-workspace>/proxy`), press "generate & copy" under Agent Prompt, and paste the result back. That prompt carries the token, and the token unlocks `/api/proxy/instructions`.
   - (c) Running work on the person's own machine: the runner setup page, `/workspace/<your-workspace>/runner`. Link only. That page states its own preconditions, so the guide does not repeat them.
4. `{{FREE_TIER}}`: one sentence, which forks on whether the free tier is on.
5. Configure for your situation: `{{SETTINGS_AREAS}}`.
6. What only the person can do, and what the agent does.
7. Links to `/llms.txt` and `/api/proxy/instructions`, noting that the latter needs the token.
8. Self-hosting: `{{README_URL}}`.
9. If the agent cannot fetch a URL, it asks the person to paste the page.

*Builder.* `lib/prompts/agent-onboarding.js` exports two functions:
- `buildAgentOnboardingGuide({ baseUrl, githubEnabled, jiraEnabled, emailEnabled, freeTierEnabled })`.
- `buildLandingAgentPrompt({ origin })`.

Where each placeholder comes from:
- `BASE_URL`: the caller's origin, trailing slash stripped.
- `SIGN_IN_DOORS`: the shared door data (below), so labels and hrefs match the buttons.
- `LOCAL_DOOR`: `LOCAL_WORKSPACE_FORM.submitLabel` (`lib/render-pages.js:55-60`).
- `FREE_TIER`: the flag picks one of two sentences that live in the builder.
- `SETTINGS_AREAS`: `AREAS` from `lib/settings-areas.js`, each area's label, purpose and path.
- `README_URL`: `GITHUB_BASE + 'README.md'` (`lib/library.js:34`).

Caching and failure follow the runner builder. The cut template is cached per process. The flag-dependent values are filled on every call, because they are read from env. A placeholder the builder doesn't know, or a failed read, serves a minimal FALLBACK that is never cached, so a later call retries.

*Landing prompt.* `buildLandingAgentPrompt` returns 2–3 short paragraphs addressed to the agent:
- what Harbour is, in one sentence;
- read `${origin}/getting-started` (plain markdown at `${origin}/getting-started.md`) and use it to onboard the person who pasted this;
- ask the person before acting;
- if you can't fetch it, ask them to paste it.

The prompt names `/getting-started` itself, as asked, and the `.md` URL for agents. It contains no secret and no workspace data. Only the origin is templated.

*Shared door data.* `lib/components/landing-hero.js` gains `signInDoors({ githubEnabled, jiraEnabled, emailEnabled })`, which returns `[{ id, label, href, primary }]`. `renderSignInCtas` maps over that list and its markup does not change. Today the labels exist only inside `renderSignInCtas` (`landing-hero.js:79-109`). Making them data means the guide cannot quote a label the buttons don't have.

**Part 2: routes.** `routes/getting-started.js` exports `createGettingStartedRoutes(deps)`. The four predicates are injectable, and they default to the ones the landing uses (`server.js:2332`):
- `getProvider('github').entryCta.isConfigured()`
- `getProvider('jira').entryCta.isConfigured()`
- `isEmailSignInAvailable()`
- `isFreeTierOffered()`

It is mounted in `server.js` beside `createRunnerKitRoutes()` (`server.js:3214`). Both routes take their origin from `publicOrigin(req, { safeHost: true })`, the Library's rule: `PUBLIC_ORIGIN` if set, else a validated Host, else `harbour.cat`. Neither sets a public `Cache-Control`. The body varies by origin, so the app default (private, no-store) stays.
- `GET /getting-started.md` serves the built guide as `text/markdown; charset=utf-8` with `nosniff` and `MARKDOWN_CSP` (`routes/library.js:35`).
- `GET /getting-started` serves the shared page shell (`is-landing`, `minimalNav`) containing:
  - `renderSignInCtas({ …, idPrefix: 'getting-started-cta' })`;
  - `renderLocalWorkspaceCta()`;
  - the same guide, escaped, in an `lx-terminal` `<pre>`;
  - a link to the `.md`.

  It serves the same page to a visitor who is already signed in, with no redirect, because it is a guide and not a landing.

**Part 3: auth exemption.** `isAuthExemptPath` exempts exactly `/getting-started` and `/getting-started.md`, after its existing lowercase and single-trailing-slash normalisation. Lookalikes stay non-exempt. Update the predicate's doc comment and its `docs/architecture/source-map.md` line (`:119`).

**Part 4: landing block.** Add a `renderAgentPromptBlock({ origin })` in `lib/render-landing.js`, placed as the first child of `<main>`, directly after the hero. Its parts:
- the eyebrow/heading "Or hand this to your coding agent";
- a `<pre class="lx-terminal__body">` holding `buildLandingAgentPrompt({ origin })`;
- `data-testid="landing-agent-prompt"`.

When `origin` is null, the block is left out. That happens on the logout render (`server.js:1958`) and on a request with no Host, the same rule the canonical tags follow (`render-landing.js:327-329`). A relative or `http://undefined` URL would be useless to an agent. `public/landing.js` inserts the copy button with JS (the `public/templates.js` pattern), so a page without JS shows selectable text and no dead button. Styles go in `public/landing.css`, using semantic tokens only. `'/landing.js'` joins the landing's `scripts`.

**Part 5: pointers.**
- `public/llms.txt` gains a `## Getting started (onboarding a user)` section above `## Library` that names `/getting-started.md`.
- `sitemapEntries` (`routes/library.js:70-84`) adds `{ path: '/getting-started' }`.
- `README.md`'s "For AI Agents" list gains one bullet.
- The landing's `htmlComment` (`render-landing.js:480`) names `/getting-started.md` beside `/llms.txt`.

**Part 6: size budget.** In `tests/unit/prompt-size-budget.test.js`, add three ceilings at their measured size, each with a `LIN-4085` reason (agent-facing text, carried in full by every onboarding session):
- `AGENT_ONBOARDING_SOURCE_CEILING`: `docs/agent-onboarding.md`;
- `AGENT_ONBOARDING_RENDERED_CEILING`: the largest variant (all doors on, free tier on, fixed BASE_URL);
- `LANDING_AGENT_PROMPT_RENDERED_CEILING`.

Add all three to the sum test and raise `FROZEN_TOTAL_BYTES` by exactly their sum. The matcher count goes from `5 + 1` to `8 + 1` (`:308`). Update the header list of surfaces. Mirror the change in `scripts/steady-base-growth.mjs` `GROUPS` as `'agent onboarding': ['docs/agent-onboarding.md', 'lib/prompts/agent-onboarding.js']`.

**Part 7: docs.** `docs/architecture/source-map.md` gains entries for:
- `routes/getting-started.js`;
- `lib/prompts/agent-onboarding.js`;
- `docs/agent-onboarding.md`;
- `public/landing.js`.

It also gets the `render-landing.js` line (`:82`) and the `guest-task-path.js` line (`:119`) updated.

### Where this behaviour lives, and how I know I found it

The behaviour: *a surface a signed-out visitor or their agent reads that tells them how to start using Harbour.* I found the places by searching for every pre-auth surface the 2026-10-23 review swept (`…-2026-10-23.md:130,285`) and for every agent-addressed pointer (`grep -rn "AI agents: see\|llms.txt" lib routes server.js README.md`).

| Place | In / out |
|---|---|
| `/` landing (new block, HTML comment) | In, Parts 4–5 |
| `/getting-started`, `/getting-started.md` | In, new, Part 2 |
| `/llms.txt` | In, Part 5 |
| `/sitemap.xml` | In, Part 5 |
| `README.md` "For AI Agents" | In, one bullet |
| `/swipe` `/swim` `/ship` nav ("+ local workspace") | Out. It stays as it is, and the guide sends the person to `/getting-started` instead |
| `lib/render.js:314` HTML comment, Proxy Agent Prompt, `/account` | Out. Signed-in surfaces, which already carry the Proxy Agent Prompt |
| Authenticated Home copy-first card | Out. LIN-3833 owns that slot (Scope) |
| `docs/proxy-integration.md` / headless `POST /workspace/new` | Out. Headless discoverability is LIN-3058. The guide's local path is a human press on purpose (correction 5) |
| `llms.txt:3` / `README.md:3` "collapsible tree" purpose line | Out. A separate divergence (review R3-11, report-only). Not part of naming a way in, and the Scope rules out rewriting either file beyond the entry |
| Self-host `setupNotice` box (`render-landing.js:352`, `render.js:286`) | Out. It is a `.env` notice, not a way in, and the new block does not make it redundant, so the Scope's optional dedupe is not taken |

What catches places this table missed is the link test (W2), plus the guide↔page label test (W3). Together they fail when the guide names a path or button that no longer exists.

### Witnesses (each fails before the change and passes after)

- **W1 builder** (`tests/unit/agent-onboarding.test.js`):
  - the rendered guide contains no `{{`;
  - it names each enabled door's label and href, and none of the disabled ones (toggle GitHub, Jira and email separately);
  - the free-tier sentence forks on its flag;
  - every `AREAS` label appears;
  - a fixture doc with an unknown placeholder serves FALLBACK, and a later call retries;
  - the landing prompt contains `${origin}/getting-started` and `${origin}/getting-started.md`.
- **W2 links:**
  - every root-relative path in the rendered guide and in the landing prompt matches a GET route registered in `server.js` or `routes/*.js` (a `<…>` segment matches a `:param`) or a file under `public/`;
  - a fixture naming `/no-such-route` fails;
  - external links are not fetched, because the unit suite is hermetic.
- **W3 route** (supertest-style on `127.0.0.1`):
  - `.md` returns 200 `text/markdown; charset=utf-8` with `nosniff`, no `Set-Cookie`, and no public `Cache-Control`;
  - `/getting-started` returns 200 HTML with the testid for each enabled door and a form posting to `/workspace/new`;
  - every door label the guide tells the person to press appears in that page's HTML;
  - with `PUBLIC_ORIGIN` unset, a Host header that fails the safe-host check (for example one that contains `/`) yields a body that names `harbour.cat`, never the forged host.
- **W4 exemption** (`tests/unit/guest-task-path.test.js`):
  - exempt: `/getting-started`, `/Getting-Started/`, `/getting-started.md`;
  - not exempt: `/getting-startedx`, `/getting-started/x`, `/api/getting-started`.

  The second list tries exactly what the guard exists to stop. The existing consumer-pin tests (`:92-118`) keep both middlewares on the one predicate.
- **W5 landing render** (`tests/unit/render-landing.test.js`):
  - with an origin, `landing-agent-prompt` sits after `landing-cta-linear` and before `landing-loop`, and holds the origin URL;
  - with `origin: null` the block is absent;
  - the block holds no secret-shaped string;
  - `/landing.js` is in the page's scripts.

  The existing hero tests and `landing.spec.js:287` (the same hrefs and labels) show the door-data refactor changed no markup.
- **W6 e2e** (`tests/e2e/landing.spec.js`):
  - the block is visible under the hero buttons;
  - copy puts exactly the `<pre>` text on the clipboard (the clipboard-permission pattern in `tests/e2e/proxy-toggle-copy.spec.js`);
  - at 320px, `scrollWidth <= clientWidth`;
  - the block renders in the dark scheme;
  - the existing 390×844 first-screen test (`:270`) still passes.
- **W7 sitemap** (`tests/unit/library.test.js:316-340`): the count becomes `3 + …` and the list includes `${base}/getting-started`.
- **W8 budget:** the three new ceilings pass at their measured size. The sum, matcher and ticket-reference tests stay green.
- **W9 llms.txt:** a unit assertion that `public/llms.txt` names `/getting-started.md` before `## Overview`.
- **W10 cold-agent walk:** recorded on the PR, as in Done-when.

### Likeliest ways this breaks

1. **The guide promises something this deployment doesn't have.** Examples: a Jira door where Jira is off, a label the buttons don't carry, or a route that is later renamed. Guarded by the source-filled placeholders, the shared door data, W1, W2 and W3.
2. **The origin is wrong.** It could be a relative URL, `http://undefined`, or a forged Host steering an agent somewhere else. Guarded by the null-origin rule on `/`, `safeHost` on the guide, no public caching, W3 and W5.
3. **The public page mints a session.** PAT auto-login or token refresh would run on `/getting-started`. Guarded by W4.

### Order of landing

One PR, with commits in this order, each green on its own:
1. door data;
2. guide, builder and size ceilings;
3. routes, exemption and sitemap;
4. landing block, script and CSS;
5. llms.txt, README, HTML comment and source map;
6. the cold-agent walk as PR evidence.

### Session fit and review

Session fit: fits one session. Every part is small and the parts share one feature. The checklist items that are easy to lose (budget total, exemption, sitemap count) each have a failing test.

plan-review due: yes. The change adds a public, unauthenticated route that serves text agents will act on, widens `isAuthExemptPath` (a guard on both auth middlewares), and raises the frozen prompt budget.
