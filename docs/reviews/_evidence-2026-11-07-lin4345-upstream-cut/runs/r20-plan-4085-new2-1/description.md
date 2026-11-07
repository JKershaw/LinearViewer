## Implementation Plan

Planned against HEAD `e1f75fe7`. No commit since the ticket was created touches any file named here (`git log --since=2026-11-01T17:00 -- .` is empty).

### What this is for, and what done looks like

**The problem, as asked.** A software homepage usually has a "getting started" box with an `npm install` line. Harbour's should instead hold a prompt that the person pastes into their own coding agent. The prompt explains the situation in a couple of paragraphs and links to `harbour.cat/getting-started`. That page walks the agent through onboarding the person and their project. The agent then talks with the person or reviews their repositories and settings, and configures Harbour for their situation, so the person doesn't have to follow the steps themselves.

**Why it matters (the cause).** The 2026-10-23 cold-start review (`docs/reviews/onboarding-cold-start-review-2026-10-23.md:19,136`) found two things. Nothing on the landing or in `/llms.txt` names a way in. No text anywhere is addressed to an agent that could take a person through the door. This plan fixes both. It also fixes where the guide's facts come from: deployment facts are filled in from code, never typed by hand (see Decisions).

**Done (from the Scope's Success Criteria, with this plan's additions in *italics*):**
- On a configured deployment, `/` shows the agent-prompt block directly below the hero sign-in buttons, with a working copy button. It fits a 320px screen with no horizontal scroll, in both light and dark themes. *Without JS the prompt is still selectable text, and no dead button shows.*
- `GET /getting-started.md` returns 200 `text/markdown` with no session. Every placeholder is filled, and every path it links to resolves. `GET /getting-started` renders the same guide as HTML. *Neither route mints or refreshes a session for a signed-out visitor.*
- `/llms.txt` names `/getting-started.md` near the top. `/sitemap.xml` lists `/getting-started`.
- Cold-agent walk: a fresh Claude Code session with no Harbour context is given only the copied prompt. It must end at either the local-workspace door or a correct "sign in with X, then copy the Agent Prompt from Proxy" instruction, without inventing a URL. The walk is recorded on the PR.
- `npm run test:unit` and `ci-success` pass. The new size ceilings are recorded with their reason.
- After it ships (not a merge gate): watch the `/kpis` "How people get started" funnel.

**What the request says vs. what it is for.** These still match. The filer was signed in when they wrote it (Page: `/workspace/linearviewer/`), but "the homepage … like an npm install command" describes the public product homepage that a newcomer sees. A signed-in visitor to `/` is redirected into their workspace (`server.js:2319-2321`). So this plan targets the public `/`. The signed-in Home already has its own agent path, the Proxy page's Agent Prompt.

### Cuts to the `## As asked` block

One cut, raised as a single ruling (`lin4085-human-steps`, see the comment):

> "decide whether to have a conversation with the user or review The repositories and the settings … without the user needing to follow those steps as the use uses the agent having naturally would"

What is delivered: the guide tells the agent to interview the person and/or read their repositories and their tracker setup through the agent API (teams, projects, labels, states). The agent then directs every remaining step. What is not delivered in full:
1. **The agent can't read Harbour's own settings.** No agent-API route exposes them (the `routes/proxy*.js` route list has no settings read; `/api/proxy/me` is the tracker's viewer).
2. **The person still makes a few clicks the agent names:** OAuth consent at sign-in, pressing "+ local workspace", pasting an AI key when the free tier is off, minting the runner key, and any Settings change.

The Scope inherited this as "An agent can't complete OAuth itself" (Assumptions) and the out-of-scope "new agent-callable endpoints". Under the plan's own rule, that inheritance does not make the cut agreed. **Recommendation: `accept-followup`.** Ship this plan with the agent naming each click, and file a follow-up for a read-only Harbour settings summary on the agent API. OAuth consent can't be delegated in any version. Agent access to settings and keys widens what a proxy token can do, and that deserves its own design and review.

No other cuts:
- "linking to harbour.cat/getting-started" is delivered literally. The prompt names `<origin>/getting-started` and gives `<origin>/getting-started.md` as the agent-readable copy.
- "a full guide on how to properly configure Harbour for whatever your situation is" is delivered by the guide's configuration section, which is filled from `lib/settings-areas.js`. On a self-host, the guide sends the agent to follow the README's Setup steps. That replaces the Scope's "pointer, not a walkthrough": the README *is* the walkthrough, and the agent follows it.

### Corrections to the Scope, checked at HEAD

- **The landing already loads JS:** `/common.js` and `/app.js` (`lib/render-landing.js:483`). The copy button still needs its own small file. The CSP is hash-pinned with no `'unsafe-inline'` (`lib/security-headers.js:1-8,63-73`), so an inline script would be blocked.
- **The `runner-prompt.md` pattern is the other way round.** The design notes sit *above* the first `---`, and the served body is everything *below* it (`lib/prompts/runner-kickoff.js` `load()`, `docs/runner-prompt.md:1-25`). The new guide follows the real pattern.
- **`/api/proxy/instructions` returns 401 without a token** (review doc line 118). The guide sends the agent there only *after* the Agent Prompt has given it a token, never as a cold link.
- **The local-workspace door is `POST /workspace/new`.** It appears as "+ local workspace" in the preview bar on `/swipe`, `/swim` and `/ship` (`lib/components/navbar.js:108`). It sets the session cookie of whoever posts. So the person presses it in their own browser; the agent can't do it for them.
- **Both new paths need the auth exemption.** The Scope missed this. `isAuthExemptPath` (`lib/guest-task-path.js:91-106`) is the one predicate PAT auto-login and token refresh both read (LIN-3346). Without it, a self-host with `LINEAR_ACCESS_TOKEN` set would sign in an anonymous agent's fetch.
- **The landing is also rendered on one path with no origin:** after the last workspace is removed (`server.js:1958`). The prompt needs an absolute URL there too.

### Decisions (which way, and why)

1. **One module owns both texts:** `lib/prompts/agent-onboarding.js` builds the served guide and the landing prompt. It follows `runner-kickoff.js`: read `docs/agent-onboarding.md` at HEAD, serve everything after its first `---`, cache the template, fill per call. If the template has a placeholder the builder doesn't know, it serves a short FALLBACK, uncached, so raw braces never ship. *Set aside:* the guide as a Library listed doc. The Library serves raw markdown and can't fill placeholders. *Set aside:* hand-written HTML. Two copies of the guide would drift.
2. **Every deployment fact is filled from its source, never copied by hand:**
   - `BASE_URL`: the request origin.
   - The sign-in doors.
   - Whether the free tier is on: `isFreeTierOffered()`.
   - The settings areas: each `AREAS` entry's `label` and `purpose`, with its path from `settingsAreaUrl`, using a placeholder workspace key.
   The landing prompt's only templated value is the origin.
3. **One list of sign-in doors.** Pull the door list (id, label, href, whether it is shown) out of `renderSignInCtas` (`lib/components/landing-hero.js`) into an exported function. The hero buttons, the "Try it" buttons and the guide all read it, so the guide can't offer a door the hero hides, or the reverse. All three callers pass the same three predicates. The builder may fold the `server.js` call sites that compute them (`:1958`, `:2332`, the new route) into one helper. Known limit, not fixed here: Linear's entry is always shown (`lib/providers/linear/index.js:2364`), so a self-host without Linear OAuth lists a Linear door that returns 503. This is the hero's existing bug, tracked by LIN-3108, and the guide inherits it rather than routing around it.
4. **Routes:** a new `routes/getting-started.js`, mounted next to the Library router.
   - `GET /getting-started.md`: `text/markdown; charset=utf-8`, the Library's `MARKDOWN_CSP` (export and reuse it, not a copy), and `nosniff`.
   - `GET /getting-started`: the filled guide rendered with `marked` (already a dependency), inside the brand plain-page shell (`renderPlainDocument`, as `/privacy` and `/templates` use), with a link to the `.md`. Raw HTML in the source renders as text, as in the Library (`lib/library.js:102-104`).
   - The guide's origin comes from `publicOrigin(req, { safeHost: true })`, the Library's canonical-URL rule, so a forged Host header can't steer the served links.
   - Both paths are added to `isAuthExemptPath`. Signed-in visitors are not redirected, because the guide is useful to them as well.
5. **The landing block** is a new `<section>` placed right after the hero, before the self-host notice and the loop:
   - It carries `data-testid="landing-agent-prompt"` and a heading like "Or hand this to your coding agent".
   - The prompt is 2–3 paragraphs in a `<pre>`, styled with the existing `lx-terminal` classes. `.lx-terminal__body` already wraps (`public/landing.css:305-313`).
   - Unlike the glimpses, it is **not** `role="img"`, because it is real text to select and copy.
   - The prompt names `<origin>/getting-started` and its `.md`, and tells the agent to ask the person to paste the guide if it can't fetch the page.
   - When `origin` is null, the block is left out (the rule the canonical tags follow). Separately, `server.js:1958` passes `requestOriginOrNull(res.req)` so that render gets the block as well.
6. **The copy button** lives in a new `public/landing-agent-prompt.js`, added to the landing's `scripts`.
   - The button renders `hidden`, and the script un-hides it, so a no-JS visitor sees the selectable `<pre>` and no dead control.
   - The listener is bound to the button element itself. A document-level, label-matched listener fails `tests/unit/no-page-wide-label-listener.test.js` Rule A.
   - It copies the `<pre>`'s text with `navigator.clipboard` and shows "copied" briefly.
7. **The guide's content, in this order:**
   - what Harbour is (one paragraph);
   - **ask or look first**: interview the person, or read their repositories and tracker;
   - the paths:
     - (a) just looking: the person opens `<origin>/swipe` and presses "+ local workspace";
     - (b) a real tracker (the default when the person has one): the person signs in through a named door, then opens Proxy and copies the Agent Prompt for the agent; after that, the agent reads `/api/proxy/instructions` with its token;
     - (c) run work on their machine: the runner page `/workspace/<key>/runner`;
   - **configure for your situation**: the settings areas, filled in;
   - what only the person can do vs. what the agent does;
   - links to `/llms.txt`;
   - self-hosting: follow the README's Setup on GitHub.
   The copy follows `docs/papers/harbour/plain-language.md`. Wording sign-off is the cold-agent walk plus PR review, per the 2026-11-01 unblock comment.
8. **`/llms.txt`** (a static file, so relative paths are fine) gets a short "Getting started: onboarding a person" section above `## Library`, pointing at `/getting-started.md`. **`sitemapEntries`** (`routes/library.js:70`) adds `/getting-started` beside `/` and `/library`. The `.md` stays out of the sitemap, as the Library's `.md` copies do.
9. **Left out:**
   - The `setupNotice` dedupe the Scope allowed. The new block doesn't make the `.env` notice redundant: one is for agents, the other for an unconfigured localhost.
   - Fixing `/llms.txt`'s stale opening line (review D1). The Scope keeps llms.txt edits to the new entry.
   - Regenerating visual baselines. They aren't in CI. If `tests/visual/pages-screenshots.spec.js` covers `/`, refresh it.

### Every place this behaviour lives

The behaviour: *what Harbour offers an agent before anyone signs in, and the deployment facts that text states.* I found the places by searching for `getting-started`, `setupNotice`, `renderSignInCtas`, `isAuthExemptPath`, `sitemapEntries`, `llms.txt` and the prompt-budget surfaces.

| Place | In or out |
|---|---|
| `lib/render-landing.js` (block, `scripts`), `public/landing.css`, new `public/landing-agent-prompt.js` | in |
| `lib/components/landing-hero.js`: shared door list | in |
| new `docs/agent-onboarding.md`, `lib/prompts/agent-onboarding.js`, `routes/getting-started.js`; mounted in `server.js`; `server.js:1958` gets an origin | in |
| `lib/guest-task-path.js` `isAuthExemptPath`; its unit test | in |
| `routes/library.js` `sitemapEntries` and the `MARKDOWN_CSP` export | in |
| `public/llms.txt` | in |
| `tests/unit/prompt-size-budget.test.js`: the ceilings, the header surface list, the sum list, the matcher's expected count (`+ 5 + 1` today), `FROZEN_TOTAL_BYTES`; `scripts/steady-base-growth.mjs` `GROUPS` gets `docs/agent-onboarding.md` (the test header says the two mirror each other) | in |
| `docs/architecture/source-map.md`: new entries for the route, module, doc and script; update the lines for `guest-task-path.js` (`:119`, lists the exempt paths), `library.js` (`:46`, sitemap set) and `render-landing.js` (`:82`) | in |
| README "For AI Agents" (`README.md:47`): one line pointing at `/getting-started` | in (one line; it describes the agent surfaces) |
| Signed-in Home, Proxy page, runner page | out: they already have an agent path, and the guide links to them |
| `scripts/scan-public-pages.mjs` | out: it scans `/`, so the new script is covered automatically |

The guide's links are the place most likely to drift later. The link-check witness below fails for any path the guide names that doesn't exist, including ones added after this ticket.

### Witnesses (fail before the change, pass after)

- **Unit, `tests/unit/agent-onboarding.test.js`:**
  - For each combination of door flags and free tier, the guide has no `{{` left.
  - The doors it names equal the shared door list; a disabled GitHub door's href is absent.
  - The self-host origin appears, and `harbour.cat` doesn't unless it is the origin. The README's GitHub link is the only exception.
  - Every `AREAS` label appears.
  - An unknown placeholder in a fixture template serves the FALLBACK, and a later call retries.
  - With fake secrets set in env (`OPENROUTER_FREE_TIER_KEY`, `LINEAR_ACCESS_TOKEN`), neither the guide nor the landing prompt contains them.
- **Unit, route** (the `library.test.js` pattern: express on port 0):
  - `.md` is 200 `text/markdown` with the sandbox CSP and no `Set-Cookie`.
  - The HTML page renders the guide, and a fixture `<script>` line renders as escaped text.
- **Unit, `isAuthExemptPath`:**
  - Exempt: `/getting-started`, `/getting-started.md`, case variants, one trailing slash.
  - **Guard test:** `/getting-startedx`, `/getting-started/x` and `/api/getting-started` stay not exempt.
- **Unit:** `sitemapEntries` includes `/getting-started`, and `public/llms.txt` names `/getting-started.md` before `## Library`.
- **Unit, `render-landing.test.js`:**
  - The block is present, after `landing-cta-linear` and before `landing-loop`, and carries the origin.
  - It is absent when `origin` is null.
  - It is not `role="img"`.
  - The copy button is `hidden` in the markup.
  - It contains no secret-shaped string.
- **Unit, `prompt-size-budget.test.js`:** ceilings for the guide's source, the rendered guide and the rendered landing prompt, each set to its measured size with a LIN-4085 reason. Agent-facing text the person pastes in full can't be code.
- **E2E, `tests/e2e/landing.spec.js`:**
  - The block is visible below the hero buttons.
  - The copy button puts the prompt on the clipboard (grant clipboard permissions).
  - At 320px, `scrollWidth <= clientWidth`.
  - Under dark scheme the prompt text is light (the existing luma check).
  - No CSP violation in the console.
- **E2E link check** (like `landing.spec.js:209`):
  - With no cookie, fetch `/getting-started.md`, then request every origin-relative path it names; none may 404.
  - Workspace-scoped paths are checked with the e2e fixture's workspace key.
  - A path planted into a fixture copy makes the check fail.
- **PR evidence:** the cold-agent walk.

### Likeliest ways it breaks

1. **A signed-out fetch gets a session.** The exemption is missing or too wide. Caught by the predicate tests (including the lookalikes) and the route test's no-`Set-Cookie` check.
2. **The guide states something the deployment doesn't do:** a hidden door, a dead path, an invented URL. Caught by the shared door list, the placeholder test and the link check, and checked from outside by the cold-agent walk.
3. **The landing block breaks on a phone or without JS:** overflow at 320px, an inline script the CSP blocks, a dead button. Caught by the 320px and CSP e2e checks, plus the `hidden`-until-bound button.

### Order, size and review

Land it as one PR, in this order: shared door list → guide doc and module → route, exemption and sitemap → landing block and script → llms.txt, budget and docs. No refactor is marked `refactor required`. The door-list extraction is small and lands first in the same PR.

fits one session

plan-review due: yes. The change widens `isAuthExemptPath`, an auth guard, to two new public paths. Its witnesses include the lookalike test above.

Waiting on ruling `lin4085-human-steps` (see the comment). If the answer is `widen-read`, add a read-only settings summary route and its proxy tests to this plan before it is built.
