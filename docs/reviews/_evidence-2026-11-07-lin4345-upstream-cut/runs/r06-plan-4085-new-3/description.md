## Implementation Plan

### What this is for, and what done looks like

**As asked:** the homepage's getting-started slot, where software usually puts its `npm install` line, holds a prompt the person pastes into their own agent. The prompt is a couple of paragraphs that explain the situation and link to `harbour.cat/getting-started`. That page walks the agent through onboarding the user and their project to Harbour. The agent then decides whether to talk with the user or review their repos and settings, and does the configuring itself.

**Cause.** This is a feature, not a fix, but it closes a gap. The 2026-10-23 cold-start review (`docs/reviews/onboarding-cold-start-review-2026-10-23.md:19`, R3-6 and R3-8) found that working paths into Harbour exist and nothing points at them. Neither the landing nor `/llms.txt` names a way in, and no onboarding text is written for agents. This plan fixes both.

**Done when** (the Scope's Success Criteria, adopted as written):

- A configured deployment shows the agent-prompt block on `/`, directly under the hero sign-in buttons.
- The block's copy button works. The block fits a 320px screen with no horizontal scroll, in both themes.
- `GET /getting-started.md` returns 200 `text/markdown` with no auth, with every placeholder filled and every linked path resolving. `GET /getting-started` renders HTML.
- `/llms.txt` names `/getting-started.md`.
- A fresh Claude Code session given only the copied prompt reaches the local-workspace door, or a correct "sign in with X, then copy the Agent Prompt from Proxy". It invents no URLs. The walk is recorded on the PR.
- `npm run test:unit` and `ci-success` are green, and the new size ceilings carry their reasons.

**Rulings this plan builds on.**
- Prominence: the block goes in the hero position, under the sign-in buttons. That is the 2026-11-01 unblock comment's default for ruling `lin4085-prominence`, and it goes ahead if the ruling stays unanswered.
- The guide asks first, then defaults to the user's real tracker. The local workspace is the "just looking" path.
- The wording is not a merge gate.

### Cuts to the As asked block

**One inherited cut, raised as a ruling.** The ask ends: *"we can have essentially a full guide on how to properly configure Harper for whatever your situation is without the user needing to follow those steps as the use uses the agent having naturally would."* The Scope's Out of Scope leaves out *"New agent-callable endpoints for things only a human can do today (OAuth, the OpenRouter key, minting the owner runner key). The guide hands those to the human."* So the user still does a few steps by hand:

- the provider's OAuth consent;
- entering an OpenRouter key, when the free tier isn't enough;
- pressing the runner mint.

OAuth consent can't be delegated under any design, because the consent screen belongs to the provider. The other two are a real cut.

- **Recommendation:** accept the cut for this ticket. Letting an agent set the OpenRouter key or mint the owner's runner credential puts those credentials in the agent's hands. That is a security design change and deserves its own ticket.
- **If the ruling says no cut:** a follow-up ticket for those two endpoints is filed, blocked-by this one. Nothing in this build changes either way.
- **Until it's answered,** the cut is not agreed. The guide still minimises the human part: it tells the human exactly which click to make and when.

**Delivered, not cut** (noted so the reasoning is visible):
- *"linking to harbour.cat/getting-started"*: the prompt names both `<origin>/getting-started` (the page) and `<origin>/getting-started.md` (the same text as plain markdown, which agents read best). On harbour.cat the origin is harbour.cat. A self-host points at itself.
- *"review the repositories and the settings"*: the Scope's guide outline covers repos and tracker but no settings step. This plan adds a "configure for their situation" section (Guide, below).
- *"for whatever your situation is"*, for self-hosters: the guide links the README, which is the complete self-host guide and readable by an agent. The agent still does the work, so this is delivery by link, not a cut.

### Which way it goes, and why

One new served text (the guide) and one new landing block. The guide follows the existing served-prompt pattern (`docs/runner-prompt.md` → `lib/prompts/runner-kickoff.js`): the source doc holds design notes above its first `---`, and every `{{NAME}}` is filled from code. The door list comes from the same data the hero buttons render from, so the guide and the landing can't disagree.

Set aside:
- **A context-aware prompt on `/`:** the page is unauthenticated and has no context beyond the deployment (Scope Assumptions).
- **Putting the guide into the Library catalog:** the guide is templated per deployment, and Library docs are served verbatim.
- **A static `public/getting-started.md`:** it couldn't fill the origin or the doors.
- **An inline copy script:** the app CSP (`lib/security-headers.js:65`) runs only hashed inline scripts. An external file is simpler, and the public-pages scanner already picks it up.
- **Consolidating the five read/cut/cache prompt builders** (passage-runner, passage-planner, worker-lane, runner, and now this one) into one helper. Nothing here needs it, and it would put the frozen runner prompt at risk. The duplication is a code-shape note, not a defect, so no follow-up is filed.

### Re-grounding: facts checked at HEAD `e1f75fe7`

HEAD predates the ticket (it was committed 2026-11-01 16:23, and scoping ran at 17:34), and no commit since touches the files in play. The Scope's code facts hold, with four corrections:

1. **"The landing ships no JS" is wrong.** `renderLandingPage` already loads `/common.js` and `/app.js` (`lib/render-landing.js:483`). What's true is that the landing has no copy behaviour, and an inline script would be blocked by CSP. So the copy button is a new external file, `public/landing.js`.
2. **`/api/proxy/instructions` is token-gated** (`routes/proxy.js:1341`, `authenticateProxyToken`). The guide must present it as "once you hold a token", not as a public link.
3. **There is no dispatch or proxy switch to turn on any more.** LIN-3849 removed them, and the runner page's state comes from the owner check alone (`routes/runner-setup.js:9-14`). The cold-start review's "owner-dispatch-off" state is stale, so the guide must not tell anyone to enable dispatch.
4. **The logout render of the landing has no request and no origin** (`server.js:1958`, inside `handleWorkspaceRemoval`).

Other facts the plan relies on:
- The local door is `POST /workspace/new`, which is always available whatever the auth config (`lib/render-pages.js:49-60`). It's reached at `/swipe` → "+ local workspace" (`lib/components/navbar.js:108-110`) or from `/account`.
- A local workspace lives only in the browser session that made it (LIN-3065, review R3-2). The guide must say so.
- Settings an agent can read once it holds a token: `/api/proxy/model-routing` and `/api/proxy/north-star`. They're documented by `/api/proxy/instructions`, and the guide points there instead of copying the endpoint list.

Constraints from recent history on these files (`git log --oneline -15`):
- **LIN-3980 / LIN-3995 (landing copy).** The landing has no hand-typed copies of app words, uses plain words, and contains none of the insider words in `tests/unit/render-landing.test.js:212`: "HEAD", "grounded", "cockpit", "control plane" and others. Exactly four `role="img"` glimpses exist (`render-landing.test.js:191`). The new block is real, selectable text and must not carry `role="img"`.
- **LIN-4015 (CSS).** One token set and no raw hex. Reuse `.lx-section` and the `.lx-terminal*` classes (`public/landing.css:278-316` already wraps long lines with `pre-wrap` and `break-word`). Add only layout rules.
- **LIN-3346 (exemptions).** One public-path exemption predicate, `isAuthExemptPath` (`lib/guest-task-path.js`). A new public page is added there and nowhere else.
- **LIN-2255 (llms.txt).** The `## Limitations` lines in `public/llms.txt` must stay true, and they list the landing's `data-testid`s.
- **LIN-3203 / LIN-3633 (prompt size).** Prompt text is frozen. A new surface gets ceilings, a ticket reference on each ceiling line, and a matching rise of `FROZEN_TOTAL_BYTES`.

### The parts

**1. One door list (land first; changes no behaviour).** New `lib/sign-in-doors.js` exports two things:
- `signInDoorFlags()`, which calls the predicates the hero and nav already use: `getProvider('github'|'jira').entryCta.isConfigured()`, `isEmailSignInAvailable()` and `isFreeTierOffered()`.
- `signInDoors(flags)`, which returns `[{id, label, href, primary}]` for Linear (always), then GitHub, Jira and email when configured.

`renderSignInCtas` (`lib/components/landing-hero.js:79`) maps `signInDoors`. Both `renderLandingPage` calls in `server.js` (`:1958`, `:2332`) spread `signInDoorFlags()` instead of repeating the four reads. The preview navbar keeps its own short labels ("GitHub →"), because they're a different design. It already calls the same predicates, so it's left alone.
*Witness:* the existing hero, try-section and landing tests pass unchanged.

**2. The guide.**
- **Source:** `docs/agent-onboarding.md`. Design notes go above the first `---`, and the served body below it is written to an agent.
- **Builder:** `lib/prompts/agent-onboarding.js` exports `createAgentOnboardingBuilder({promptPath})` and `buildAgentOnboardingGuide({baseUrl, doors?})`. It caches the template and computes values per call. `doors` defaults to `signInDoorFlags()`, and tests pass a fixture. It strips a trailing slash from `baseUrl`. An unknown placeholder or a failed read serves a short FALLBACK and does not cache it, as `runner-kickoff.js` does.
- **Placeholders:**
  - `BASE_URL`;
  - `SIGN_IN_DOORS`: the enabled doors as label plus absolute URL, from `signInDoors`;
  - `FREE_TIER`: one of two sentences;
  - `README_URL`: `GITHUB_BASE + 'README.md'`, from `lib/library.js:34`.

  Every URL in the body is absolute and starts with `{{BASE_URL}}`.

Content, in order (the Scope's outline, plus one section):
1. What Harbour is, in one paragraph.
2. Ask or look first. Interview the user, or read their repos and tracker, to pick a path. Don't act before choosing.
3. The paths:
   - (a) Just looking: the human opens `{{BASE_URL}}/swipe` and presses the local-workspace button. Warn that this workspace lives in that browser session only.
   - (b) Real tracker: the human signs in through one of `{{SIGN_IN_DOORS}}`, opens Proxy, and copies the Agent Prompt to the agent. From then on, the agent reads `{{BASE_URL}}/api/proxy/instructions` with its token.
   - (c) Run work on their machine: the owner opens their workspace's runner page and pastes its prompt into Claude Code.
4. **Configure for their situation (added).** Once connected, the agent reviews the workspace's projects and issues, its north star and its model routing through the API (per the instructions), and recommends changes. Where only the Settings page can make a change, the agent names the setting for the human.
5. What only the human does (OAuth consent, the OpenRouter key, the runner mint) versus what the agent does.
6. Never invent a URL. If you can't fetch a page, ask the user to paste it.
7. Links to `{{BASE_URL}}/llms.txt`.
8. A short self-host pointer to `{{README_URL}}`.

UI labels the guide tells the human to press, other than the sign-in doors:
- the local-workspace button;
- Proxy's "Agent Prompt" box and its "generate & copy" button;
- the runner page.

The unit test lists each label beside the source file that renders it, and fails if that file stops containing it. That turns a hand copy into a checked one without moving those pages' constants.

**3. The routes.** New `routes/getting-started.js` (`createGettingStartedRoutes({buildGuide})`), mounted in `server.js` beside `createRunnerKitRoutes()` (`:3214`). It never redirects, even for a signed-in visitor.
- `GET /getting-started.md` returns the guide, built for `publicOrigin(req, {safeHost: true})`, as `text/markdown; charset=utf-8` with nosniff and `MARKDOWN_CSP` (`routes/library.js:35`).
- `GET /getting-started` returns the same text rendered to HTML. It uses the Library's safe markdown renderer: raw HTML escaped and the href scheme allow-list. Add a small export to `lib/library.js` that renders one markdown string outside the catalog, and a small exported page shell to `lib/render-library.js`. The response carries `LIBRARY_CSP`, a canonical tag and a "View as Markdown" link.
- `isAuthExemptPath` gains `/getting-started` and `/getting-started.md`, matched exactly after the existing lowercase and one-slash strip.
- `sitemapEntries` (`routes/library.js:70`) gains `{path: '/getting-started'}`. The `.md` form is left out because the HTML page is the canonical one.

The HTML route uses the Library renderer so there is still only one server-side markdown sanitiser. A `<pre>` dump was the alternative, and it reads worse for the people who follow the link.

**4. The landing block.** In `lib/render-landing.js`, a new section is the first child of `<main>`, right after the hero and before the localhost setup notice.
- **Markup:** `data-testid="landing-agent-prompt"`, eyebrow "getting started", heading "Or hand this to your coding agent". It holds a `.lx-glimpse.lx-terminal` box with `<pre data-testid="landing-agent-prompt-text">` (no `role="img"`) and a copy button, `data-testid="landing-agent-prompt-copy"`.
- **Copy button:** rendered with `hidden`, and `public/landing.js` reveals it and wires it up. It copies the `<pre>` text. If the clipboard is refused, it selects the text and says how to copy, in an `aria-live` status. Without JS, nobody sees a dead button and the `<pre>` stays selectable.
- **Prompt text:** 2–3 paragraphs from `buildLandingAgentPrompt({baseUrl})` in the same module, with only the origin templated. Required content: this is Harbour at `<origin>`; read `<origin>/getting-started.md` (the page version is `<origin>/getting-started`) and follow it; ask the user before acting; use only URLs from the guide; if you can't fetch it, ask the user to open it and paste it.
- **No origin:** when `origin` is null (the logout render), the block is left out. An agent can't use a relative URL, and the visitor's next `/` load shows the block.
- **Scripts and comment:** `scripts` gains `/landing.js`. The page's `htmlComment` becomes "AI agents: see /getting-started.md to onboard a user, /llms.txt for navigation guidance", so an agent that fetches `/` as HTML finds the guide too.
- **Header comment:** update the Structure list at the top of `render-landing.js`.

**5. `/llms.txt`.** A `## Getting started (onboarding a user)` section goes first, before `## Library`. It names `/getting-started.md` and `/getting-started`, says what the guide does, and says it needs no session. The `## Limitations` landing line adds the agent-prompt block and `agent-prompt` to its `landing-{…}` testid list.

**6. Size ceilings.** `tests/unit/prompt-size-budget.test.js` gets three new ceilings, each measured after the text is final and each with a LIN-4085 comment and its reason (a new agent-facing surface, prose a model reads, so it can't be code):
- `AGENT_ONBOARDING_SOURCE_CEILING`, on `docs/agent-onboarding.md`;
- `AGENT_ONBOARDING_RENDERED_CEILING`, on the guide rendered at `BASE_URL` with every door on, the largest form;
- `LANDING_AGENT_PROMPT_RENDERED_CEILING`.

Add all three to the sum test, and raise `FROZEN_TOTAL_BYTES` by exactly their sum. Add an `'agent onboarding'` row to `GROUPS` in `scripts/steady-base-growth.mjs`, which the test header says it mirrors.

**7. Docs.** In `docs/architecture/source-map.md`:
- new entries for `routes/getting-started.js`, `lib/prompts/agent-onboarding.js`, `lib/sign-in-doors.js` and `public/landing.js`;
- updates to three entries that describe today's shape in words: `render-landing.js` (`:82`), `guest-task-path.js` (`:119`, its literal exemption list) and `routes/library.js` (`:46`, its literal sitemap set).

### Every place the behaviour lives

**The behaviour:** *how someone who isn't signed in (a person, or their agent) finds the way into Harbour.*

**Found by:**
- `grep -rn "llms.txt\|AI agents:" lib routes server.js public/*.js`
- `grep -n "renderLandingPage(\|sitemapEntries\|isAuthExemptPath" -r server.js lib routes`
- `grep -rn "workspace/new" lib routes`
- the review's public-surface list (`onboarding-cold-start-review-2026-10-23.md:285`)

**In scope:**
- `/` (block, `htmlComment`);
- `/getting-started` and `/getting-started.md` (new);
- `/llms.txt` (entry and Limitations line);
- `/sitemap.xml`;
- `isAuthExemptPath`;
- the source map.

**Out of scope:**
- **The logout render of `/`.** The block is left out because there is no origin. The next load shows it.
- **`/robots.txt`.** It already says `Allow: /`.
- **The `/swipe`, `/swim` and `/ship` preview navbars.** They already carry the sign-in links and the local door, and the agent prompt belongs on the front door.
- **The authenticated Home copy-first card.** LIN-3833 owns it (Scope Out of Scope).
- **`/account`.** Visitors there are already signed in, and the page already offers the local door.
- **The README.** The guide links to it, and the Scope rules out rewriting it.
- **The CLAUDE.md "Key Behaviors" landing line.** It's still true, the file is byte-budgeted, and the source map carries the detail.
- **The localhost setup-notice dedupe.** The Scope allows it only if the new block makes that box redundant, and it doesn't: the box tells an operator with no auth configured how to configure some.

**What catches the rest:**
- The e2e link sweep fails on any guide link that 404s.
- The door-permutation unit test fails if the guide names a door the deployment doesn't offer.
- The cold-agent walk catches what no test can: whether an agent actually finds its way in.

### Likeliest breaks, and witnesses

Each witness fails before the change and passes after.

1. **The copy button is dead, or shows as dead.** CSP or a missing script would leave it broken, and no JS would leave a useless button on screen.
   - *Witness:* `tests/e2e/landing.spec.js`, using the clipboard pattern in `tests/e2e/autopilot-proxy-force.spec.js:133`. Grant clipboard permissions, click `landing-agent-prompt-copy`, and the clipboard equals the `<pre>` text, which contains `${baseURL}/getting-started.md`.
   - *Unit:* the rendered button carries `hidden`, and the page lists `/landing.js`.
2. **The guide drifts from the deployment:** a door that's off, an unfilled `{{…}}`, or a dead link.
   - *Witness:* `tests/unit/agent-onboarding.test.js`. For each door-flag combination, the output has no `{{`, and each door line appears exactly when its flag is on. `FREE_TIER` forks. `BASE_URL` has its trailing slash stripped. A fixture doc with an unknown placeholder serves the FALLBACK, and a second call retries rather than reading a cache. The quoted-label table is checked against its sources.
   - *Witness:* new `tests/e2e/getting-started.spec.js`. `GET /getting-started.md` with no cookie returns 200 `text/markdown`. Every `${baseURL}/…` URL in the body requests non-404: the token-gated `/api/proxy/instructions` answers 401, which counts as a real route. `/getting-started` returns 200 HTML with an H1. `/sitemap.xml` lists it.
   - *Limit:* the link check can't type-check URLs written under a prefix-mounted auth gate, where an unknown path answers 401. That's why the guide names no `/api/proxy/*` path except `instructions`.
3. **The new exemption is too wide, or missing.** A missing exemption lets PAT mode sign in someone who's only reading the guide. A too-wide match exempts paths it shouldn't.
   - *Witness:* `tests/unit/guest-task-path.test.js`. `/getting-started`, `/getting-started/`, `/Getting-Started` and `/getting-started.md` are exempt. The guard's real target, look-alike paths, stays non-exempt: `/getting-startedx`, `/getting-started/x`, `/api/getting-started` and `/getting-started.mdx`.
   - *Witness:* `tests/unit/pat-session.test.js`. Add `/getting-started` to its exempt-path loop (`:280`).
   - *Unit route test:* `tests/unit/getting-started-route.test.js`, against an app on `127.0.0.1`. Content type, nosniff, the CSPs, no `Set-Cookie`, and no redirect when a session is present.

Other witnesses:
- **`tests/unit/render-landing.test.js`:**
  - the block sits after the hero's buttons and before `landing-loop`;
  - the origin is filled in, and the block is absent when `origin` is null;
  - the block holds no token-shaped string, checked with the rule set `scripts/scan-public-pages.mjs` uses;
  - the existing four-glimpse and insider-word tests still pass.
- **`tests/unit/library.test.js:340`:** the URL count becomes `3 + docs + editions`.
- **The size tests**, once the ceilings are set.
- **e2e at 320px:** `document.documentElement.scrollWidth <= clientWidth` with the block visible, run in both `colorScheme: 'light'` and `'dark'`. The existing 390×844 first-screen test must still pass, and it will, because the block sits below the buttons.
- **Cold-agent walk (manual, on the PR):** a fresh Claude Code session with no Harbour context is given only the copied prompt from a local server. Record where it lands and that every URL it used came from the guide.

### Order of landing

One PR, in commits that each pass on their own:
1. The `sign-in-doors` refactor.
2. The guide, builder, routes, exemption, sitemap, and their tests.
3. The landing block, script, CSS, and their tests.
4. `llms.txt`, the source map, the size ceilings, and the growth group. The ceilings are measured last, on the final text.

After that, refresh the landing screenshots (`tests/visual/pages-screenshots.spec.js` is a manual maker, not a gate).

### Session fit and review

fits one session. It is about a dozen files around one feature, with no shared state beyond the door helper, and each commit can be checked on its own.

plan-review due: yes

The plan widens the auth-exemption predicate, which governs session minting and token refresh, and raises the frozen prompt budget. Mistakes in either are easy to miss once built.

*This is the first plan for this ticket. No plan-review verdict exists yet.*
