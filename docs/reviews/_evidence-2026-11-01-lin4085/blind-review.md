# Blind A/B review: LIN-4085 two ways (1 November 2026)

Verbatim report of the blind reviewer, a fresh Claude Code subagent given two unlabelled copies of the change, the original request, and a seven-part rubric, and told not to guess which was which. **Unblinded: A = Harbour (PR #2221, squash `4f247b68`, reviewed at base `f0ac579c`); B = the fast single session (commit `2bebcc03` on branch `claude/cool-rubin-6acj5j`, base `e1f75fe7`).** Blinding was partial: A carries 31 `LIN-4085` references. The helper scripts it names (`mut.sh`, `csp-check.mjs`, `xss-check.mjs`, `overflow.mjs`) lived in the reviewing session's scratch space and are not preserved. Context: `docs/reviews/lin-4085-ab-run-2026-11-01.md`.

---

# Review: agent getting-started prompt + `/getting-started` guide, A vs B

Scope: the one commit on top of each base (`git diff HEAD^ HEAD`). A = `blind/A` (base f0ac579c), B = `blind/B` (base e1f75fe7). I ignored differences that come only from the bases.

How I tested:
- Ran the new and affected unit tests in each tree (A: 203 pass; B: 196 pass).
- Ran the full unit suite in each tree (results under "Full suite" below).
- Ran the e2e specs: A's `tests/e2e/landing-agent-prompt.spec.js` (6/6 pass); `tests/e2e/landing.spec.js` in both trees (B 22/22 pass, including its 3 new tests; A 19/19 pass).
- Started a real server for each tree on 127.0.0.1 (A :4101, B :4102), with `PUBLIC_ORIGIN` unset and private data dirs, and probed it with curl and headless Chromium.
- Ran 22 mutations against A and 24 against B with a small harness (`mut.sh` (not preserved)). Each one patches a file, runs the named tests, then restores the file and checks `git diff --quiet`. Every mutated file was restored.

## Scores

| Dimension | A | B |
|---|---|---|
| 1. Fidelity to the request | 3 | 5 |
| 2. Correctness of the guide's claims | 4 | 5 |
| 3. Security | 5 | 4 |
| 4. Test quality | 4 | 4 |
| 5. Fit with the codebase | 5 | 3 |
| 6. Agent usability | 3 | 5 |
| 7. Simplicity and scope | 3 | 4 |
| **Total** | **27** | **30** |

---

## 1. Fidelity to the request

The request asks for four things: a homepage prompt to hand to an agent; a guide at `/getting-started` written for agents; a choice for the agent between talking to the person and looking at their repositories and settings; and "essentially a full guide on how to properly configure Harbour for whatever your situation is".

**A: 3.**
- Has: a homepage block "Or hand this to your coding agent", placed directly under the hero sign-in buttons (`lib/render-landing.js:270-282`, `:311-313`). The prompt points at `/getting-started.md`, with `/getting-started` as the fallback (`lib/prompts/agent-onboarding.js:161-165`).
- The served guide is about 3.5 KB (577 words; `curl :4101/getting-started.md | wc`). It offers "Ask or look first" (`docs/agent-onboarding.md:40-48`) and three paths: local workspace, a real tracker, and a runner.
- Missing: almost everything about configuring Harbour. There is no guidance on reviewing repositories (tests, CI, `gh`, default branch, agent instruction files). It does not cover Settings › Sources (more than one tracker, Jira by API token, the active source), runner requirements, Simple Dispatcher, Settings › Agent access keys, a first task, or troubleshooting.
- "Look" is one line: "read the repositories and tracker they point you to" (`:45-46`). That is a starting point, not the "full guide" the request asked for.

**B: 5.**
- Has: a homepage "Get started" section that names the install-command analogy ("Most tools start with an install command. Harbour starts with a prompt.", `lib/render-landing.js:239-254`).
- `/getting-started` serves a full guide (22 KB, 3,707 words, `content/getting-started.md`):
  - how to work with the person (look first if you can see their code, otherwise ask, `:18-28`);
  - a situation table, each row with how to find the answer yourself (`:34-42`);
  - a repository readiness check (`:52-62`), sign-in doors (`:64-81`), sources (`:83-92`), AI keys (`:94-108`), backlog hygiene (`:110-121`);
  - three run modes (`:123-139`), agent access (`:141-155`), the first task (`:157-170`), every Settings area (`:172-183`), troubleshooting (`:185-193`) and a "Done when" checklist (`:195-206`).
- This is the request almost point for point.

## 2. Correctness of the guide's claims (spot checks against source)

### A: about 12 claims checked

| Claim | Source | Verdict |
|---|---|---|
| "+ local workspace" is in the nav bar on `/swipe` | `lib/components/navbar.js:109`; `curl :4101/swipe` shows it once | true |
| A workspace made with curl belongs to the cookie jar | `POST /workspace/new` is session-bound (302 to a new workspace, verified) | true |
| `/workspace/<urlKey>/proxy` has an "Agent Prompt" | `server.js:3997`, `lib/render-proxy.js:47` | true |
| That prompt "carries its own token" | the "generate & copy" flow mints one (`render-proxy.js:47-60`) | true, but the guide never mentions the generate step or the scope choice (which includes "read-write + dispatch") |
| `/workspace/<urlKey>/runner`; only the owner can mint | `routes/runner-setup.js:56`, `lib/render-runner-setup.js:13-17` | true |
| OpenRouter is connected on Settings via `/auth/openrouter` | `routes/openrouter-auth.js:64`, `lib/render-settings-you.js:54` | true |
| `/api/proxy/instructions` needs a token | `routes/proxy.js:1341` (`authenticateProxyToken`) | true |
| Sign-in doors and hrefs (Linear, GitHub, `/auth/jira/oauth?mode=new`, email) | generated from `signInDoors()` | true by construction |
| Free tier on: "no OpenRouter key is needed to start" | `isFreeTierOffered` | true |
| Free tier off: "writing prompts needs the person's own OpenRouter key" | `public/prompt-section.js:553` "a template step needs no AI"; only the ✦ selector write is gated (`:188-192`) | **misleading / false**: template prompts work with no key |
| "No endpoint exists for these steps" (OAuth, OpenRouter, runner key) | session-cookie endpoints exist for each (for example `/auth/openrouter`, the runner mint) | **overstated**: what is true is that no agent-callable endpoint exists |
| "If no door below fits their tracker, use path (a)" | Settings › Sources accepts Jira by API token when Jira OAuth is off (B's Step 4; `lib/providers/jira` has both auth shapes) | **misleading**: it sends a Jira user to a throwaway local workspace |
| Self-hosting README at github.com/JKershaw/LinearViewer | `git remote -v` | true |

False or misleading claims in A: (1) "writing prompts needs the person's own OpenRouter key" when there is no free tier; (2) "No endpoint exists for these steps", which is literally false; (3) "if no door fits, use path (a)", which ignores Jira by API token. All three are small. A's main correctness problem is what the guide leaves out, not what it gets wrong.

### B: about 28 claims checked

All of these are true: the stage list (tested against `USUAL_STAGES`); runner TTLs of 1 h and 24 h (`lib/proxy-scopes.js`, tested); the runner versus Simple Dispatcher window of 10 min (`OTHER_CONSUMER_RECENT_MS`, tested); free tier 10 runs/day (`FREE_PLAN`, tested); the 15 min magic link (`MAGIC_LINK_TTL_MS`, tested); the 90-day key (`render-settings-workspace.js`, tested); 60 req/min (`proxy-instructions.js`, tested); and all eight Settings areas, their labels, order and grouping (`lib/settings-areas.js:24-100`, tested).

These I checked by hand:
- Branch naming `feat/<id>-short-description` and "a pull request targeting main" (`lib/prompts/revision-brief.js:31,37`).
- Node 18+, macOS/Linux, no Windows, Claude Code only (`render-runner-setup.js:98`).
- "If the laptop sleeps, it pauses" (`:101`).
- The "unavailable" sign-in page (`routes/auth.js:64`, `jira-auth.js:128`, `email-auth.js:184`).
- `/account` "Connect …" rows and create-local-workspace (`render-account-home.js:54,70`).
- "Make active" (`render-settings.js:447`).
- Starter "Getting started" project with two tasks (`lib/starter-seed.js:11-15`).
- Bug boost for Urgent/High/Medium and not backlog (`lib/task-order.js:121-137`).
- GitHub issue state mapping, including closed as not planned = cancelled (`providers/github/index.js:79-89`).
- No GitHub relations (`:53,262`).
- "Merge PR #N" (`render-task-page.js:887`) and its readiness conditions (`run-closeout-state.js:6-15,287-310`).
- Pause/Stop/Resume (`components/halt-controls.js:26-34`).
- "New key", "Read, or read and update" (`render-settings-workspace.js:156`).
- "Agents can change models" (`:36,172`).
- Footer "ai: ● free" (`components/footer.js:94`).
- "needs OpenRouter" (`prompt-section.js:189`).
- Models asks for a reason (`render-settings-models.js:329`).
- "a cent or two per prompt" (`render-landing.js:210`).
- "the merge box advises protecting the default branch" (`render-run-evidence.js:218`).
- An OpenRouter connect needs a workspace (`openrouter-auth.js` redirects to `/` without one).
- Simple Dispatcher needs Node ≥22 (`docs/reviews/dependency-supply-chain-review-2026-10-23.md:96`).

Imprecise in B: (1) `"+ local workspace" is in the top bar … at /swipe and on /account`. On `/account` the control is labelled "Create a local workspace" (`render-pages.js:59`). (2) It links `https://github.com/JKershaw/simple-dispatcher`, which may be private, but the guide hedges: "If they can't reach it, use the runner instead". I found no outright false claim.

## 3. Security

Both implementations:
- **Auth exemptions are exact-match**: `s === '/getting-started' || s === '/getting-started.md'` after the existing lowercase and one-slash strip (A `lib/guest-task-path.js:104-107`, B `:104-105`).
- **Real-server probes match.** `/getting-started/`, `/Getting-Started` and `/GETTING-STARTED.MD` return 200. `/getting-started.md.bak`, `/getting-startedx`, `/api/getting-started` and `/getting-started.markdown` return 404.
- **Lookalike paths stay non-exempt.** Mutating the exemption to `startsWith` is caught in both (A2, B2).
- **Guide routes** use `publicOrigin(req, { safeHost: true })`. Forged malformed hosts fall back to `harbour.cat` on both servers (curl table below).
- **Markdown rendering**: raw HTML is escaped, link hrefs are allow-listed, images become their alt text. I ran 11 hostile inputs through both renderers: `javascript:`, case variants, entity-encoded, percent-encoded, autolink, `data:`, HTML inside a heading or table, title-attribute breakout. Both behave identically and safely.
  - Shared nit: both allow `/\evil.example/x` (browsers treat `/\` as `//`, an off-site link). It cannot be exploited here because the guide text is ours and only the origin is templated in. The Library renderer has the same rule.
- **CSP and headers**: HTML is served under `LIBRARY_CSP`, and the page's one inline theme script matches the pinned hash in both (`csp-check.mjs` (not preserved): "inline allowed? true", no external scripts). Markdown is served under `MARKDOWN_CSP` (`default-src 'none'; sandbox`). `nosniff` is set on both forms. The pages are `no-store` (A sets it explicitly; B inherits the global `private, no-store`).

Forged Host, real servers, `PUBLIC_ORIGIN` unset:

```
Host header               A landing prompt              B landing prompt                         guide.md (A and B)
evil.example              http://evil.example/...       http://evil.example/...                  http://evil.example
evil.example/x?           http://harbour.cat/...        http://evil.example/x?/getting-started   http://harbour.cat
evil.example"><b>x        http://harbour.cat/...        http://evil.example&quot;&gt;&lt;b&gt;x/getting-started   http://harbour.cat
harbour.cat@evil.example  http://harbour.cat/...        http://harbour.cat@evil.example/getting-started          http://harbour.cat
evil.example#             http://harbour.cat/...        http://evil.example#/getting-started     http://harbour.cat
```

**A: 5.** The landing prompt uses `publicOrigin(req, { safeHost: true })` (`server.js:2333`). The block is left out when there is no origin, which happens on the logout render at `server.js:1959`. An e2e test sends a hostile Host header to the running server (`tests/e2e/landing-agent-prompt.spec.js:92-112`; passed).

**B: 4.** The landing prompt is built from the existing `origin` argument, which is `requestOriginOrNull(req)` and has **no safeHost**. So a malformed Host header lands in an instruction an agent will act on, for example the userinfo-phishing shape `http://harbour.cat@evil.example/getting-started`.
- Mitigations: the output is HTML-escaped (no XSS); `/` is `private, no-store` (no shared-cache poisoning); a production deployment with `PUBLIC_ORIGIN` set is pinned; and a browser cannot send these malformed Host values.
- So this is a defence-in-depth gap and an inconsistency (B's own `/getting-started` route does validate) rather than a live exploit.
- Note the realistic attack, a plain attacker domain pointed at the server, passes `safeHost` in **both** A and B. Only `PUBLIC_ORIGIN` stops it.
- Separately, the logout render falls back to `https://harbour.cat`, so a self-hosted user who is logged out on a 401 is handed a prompt that points at harbour.cat.

## 4. Test quality (mutation results)

### A: 15 of 22 mutations killed

Killed:
- A1: drop the `.md` exemption.
- A2: exemption becomes a prefix match.
- A3: the route drops safeHost.
- A5: href allow-list removed.
- A6: raw HTML passed through.
- A7: `.md` loses `no-store`.
- A8: `.md` loses CSP.
- A11b: `signInDoors` drops Jira (caught by the existing `lin-1890` and `render-landing` tests).
- A12: landing block removed (5 failing).
- A13: sitemap entry removed.
- A14: llms.txt section removed.
- A15: guide links to `/runnerz` (3 failing).
- A18: `/auth/email` route renamed in source.
- A19: `/runner` route renamed in source. A18 and A19 show the `REGISTERED` needles such as `router.get('/auth/email'` are specific (`tests/unit/agent-onboarding.test.js:121-131`).
- A4: the landing drops safeHost in `server.js`. The unit tests stay green, but A's e2e Host test covers it.

Survived (unit):
- **A9**: caching the fallback. The comment "Never cached" (`agent-onboarding.js:191`) has no witness.
- **A10**: `fill()` tolerating unknown placeholders. This is redundant with `parseAgentOnboardingTemplate`, so it is not a real gap.
- **A16, A17**: removing "Do not mint keys yourself" or the token-secret rule from the guide. The prose safety rules are not pinned.
- A11 against A's new tests alone. The door test compares `signInDoors()` with itself, so it is tautological, but other suites catch the mutation.

Drift: the sign-in doors and the free-tier sentence are generated from source, so they cannot drift. Route links are checked against specific needles. UI labels quoted in the guide ("+ local workspace", "Agent Prompt") are **not** tied to source. A also adds prompt-size ceilings for the guide (source and rendered, over all 16 flag combinations) and for the landing prompt (`tests/unit/prompt-size-budget.test.js`, diff).

### B: 20 of 24 mutations killed

Killed:
- B1: drop the `.md` exemption. B2: prefix match (3 failing).
- B3: the route drops safeHost.
- B5: allow-list opened. B6: raw HTML.
- B8: `.md` CSP. B9: `Vary: Accept` removed. B10: negotiation change.
- B11: fallback cached. B12: unknown placeholder tolerated.
- B13: landing section removed. B14: sitemap entry removed.
- B16: `RUNNER_WORKING_TTL_SECONDS` changed in `proxy-scopes.js`.
- B17: "create runner prompt" renamed in `render-runner-setup.js`.
- B18: guide names `/workspace/<key>/runnerz`. B19: broken in-page anchor.
- B20: guide names `/accountz`.
- B24: `/runner` route renamed in source.

B16 and B17 show the drift tests work: changing the code makes the guide's test fail.

Survived:
- **B23**: renaming the real `router.get('/auth/email'` in `routes/email-auth.js` leaves the suite green. The KNOWN patterns for `/auth/email` (`/\/auth\/email/`), `/account` (`/\/account/`) and `/llms.txt` (`/llms\.txt/`) match any mention in the concatenated files (`tests/unit/getting-started.test.js:343-355`), so those three checks are vacuous. The `/getting-started` patterns match the constants in the module under test, so they are tautological.
- **B15**: the llms.txt section can be removed and no test notices.
- **B21, B22**: removing "Treat keys as secrets" or "Ask before you act" from the guide. Prose is unpinned (the same as A16/A17).
- **Not tested at all**: the landing prompt's origin validation. A test would fail today; see defect B-1.

Drift: this is B's strength. TTLs, limits, stage names, all Settings areas (label, path, order), 11 UI labels, in-page anchors and workspace page routes are tied to source (`tests/unit/getting-started.test.js:248-385`). The prompt itself is not under the prompt-size budget.

## 5. Fit with the codebase

**A: 5.**
- Reuses `publicOrigin` safeHost in both places, the Library CSPs, `renderPage` and the footer, and the landing terminal-glimpse classes.
- Follows the runner-prompt pattern: served text after `---`, cached, an uncached fallback, unknown placeholders refused (`lib/prompts/agent-onboarding.js`).
- Pulls the hero's door list into one `signInDoors()` (`lib/components/landing-hero.js:52-64`), which feeds both the buttons and the guide. It is honest that the navbar still keeps its own copy.
- Treats the guide as prompt text under the frozen-size invariant: three new ceilings with reasons, `FROZEN_TOTAL_BYTES` raised by their exact sum, and a group added to `scripts/steady-base-growth.mjs`.
- Updates llms.txt, the sitemap and the source-map; adds data-testids.
- Avoids the `.prompt-copy` class because `app.js` binds it to a token-minting handler (`render-landing.js:263-268`), and a test pins that (`landing-agent-prompt.test.js:232-238`). That is a good catch.

**B: 3.**
- Reuses `publicOrigin` safeHost on the route, the Library CSPs, `githubSlug`, `renderButton`, `renderPageHeader`, `canonicalTag`, the sitemap, llms.txt and the source-map (a thorough entry); adds data-testids.
- But:
  - (a) The landing does not reuse the safeHost seam its own route uses.
  - (b) It adds 22 KB of agent-facing instruction text with no prompt-size ceiling. CLAUDE.md says prompt text "grows only with its reason recorded beside the ceiling it raises". The guide is not one of the listed surfaces, but it is the same kind of text, and A shows the budget can hold it.
  - (c) It adds a new `public/getting-started.css` and a `public/landing.js`, which is fine but more surface.

## 6. Agent usability

**A: 3.**
- Good: the prompt names the `.md` URL directly, says "read all of it, and follow it", and has a paste fallback if the agent cannot fetch. The guide is small enough for any fetch tool to read whole, and every link is absolute.
- Good: "Do not start a path the person has not agreed to"; the token is treated as a secret; "Do not mint keys yourself"; and it warns against making the local workspace with curl.
- Weak: after "copy the Agent Prompt" the agent has nowhere further to go. It is not told about scopes, runner requirements, repository readiness or a first task, and there is no troubleshooting. An agent would hit "now what?" within minutes.

**B: 5.**
- `/getting-started` answers curl, `*/*`, `text/markdown` or `text/plain` with Markdown and a browser with HTML (`Vary: Accept`; verified with curl: the default Accept gives `text/markdown`). `/getting-started.md` always returns Markdown.
- The prompt explicitly asks the agent not to summarise and gives a `curl -s` example.
- Next steps are numbered. It tells the agent what it can find out itself and how (`git remote -v`, `gh pr list`, `gh api …/protection`, and what a 404 or 403 means).
- Explicit rules: ask before writing to the tracker, editing, committing, pushing or calling a mutating API; treat keys as secrets; exchange the bootstrap key; least privilege (Read versus Read and update).
- It hedges where a URL may not be reachable.
- The cost is length: 22 KB. A summarising fetcher would lose most of it, which is why both the content negotiation and the "not a summary" line matter.

## 7. Simplicity and scope

- **A: 3.** About 1,160 added lines, roughly 70% tests; the guide itself is about 75 lines. The per-request templating (doors, free-tier sentence) and the hero refactor are well made, but they are a lot of machinery for a guide that delivers little configuration content. The gap, not excess code, is the scope problem.
- **B: 4.** About 1,200 added lines. Most of the value is in the guide and its drift tests, and the code is compact (about 200 lines of library, 71 of routes, 65 of shell). Content negotiation is extra, but it pays for itself for agents. Missing: a ceiling for the guide, and a landing-origin test.

---

## Defects

### A, verified (ran something)
1. **Medium (fidelity/usability).** The guide covers almost none of the configuration the request asked for. Scenario: a person with Linear plus GitHub repos asks their agent to set Harbour up. The guide stops at "copy the Agent Prompt"; nothing tells the agent that PR evidence needs a GitHub connection, what the runner needs, or how to check a repo's tests and CI. Evidence: 577 words served (`curl :4101/getting-started.md | wc -w`); no mention of Sources, Agent access, Running or Health.
2. **Low (correctness).** With no free tier the guide says "writing prompts needs the person's own OpenRouter key" (`agent-onboarding.js:229`). Template prompts need no AI (`public/prompt-section.js:553`). Scenario: an agent tells the person they cannot get any prompt without paying OpenRouter.
3. **Low (correctness).** "If no door below fits their tracker, use path (a)" (`docs/agent-onboarding.md:70-71`). This sends a Jira user on a deployment without Jira OAuth to a local workspace, although Settings › Sources accepts Jira by API token.
4. **Low (test).** Fallback non-caching has no witness (mutation A9 survived).
5. **Low (test).** The prose safety rules are not pinned (A16 and A17 survived).
6. **Nit (security, shared with B).** The href allow-list accepts `/\host` (verified with `xss-check.mjs`). Not exploitable with static content.

### A, suspected
7. **Nit.** The guide points agents at the older Proxy page, whose own hint says the canonical key list is Settings › Agent access. Its scope menu offers "read-write + dispatch", and the guide does not advise choosing least privilege.

### B, verified
1. **Medium-low (security/consistency).** The landing prompt uses an unvalidated Host. Verified on the real server: `Host: harbour.cat@evil.example` gives `http://harbour.cat@evil.example/getting-started` inside the copyable prompt; `evil.example#` and `evil.example/x?` pass through too. Scenario: a non-browser client or a misconfigured proxy in front of a self-host without `PUBLIC_ORIGIN` produces a prompt that sends the agent to an attacker host. It is limited by escaping, `no-store`, and `PUBLIC_ORIGIN` in production. Fix: pass `publicOrigin(req, { safeHost: true })` to the landing section, as `/getting-started` already does, and add a Host test (A's e2e is the model).
2. **Low (test).** The route checks for `/auth/email`, `/account` and `/llms.txt` are vacuous (mutation B23 survived: renaming the real `router.get('/auth/email'` stays green).
3. **Low (fit).** 22 KB of agent instruction text lands outside `prompt-size-budget.test.js`, against the spirit of the frozen-prompt invariant.
4. **Low (test).** The llms.txt section is untested (B15 survived). The prose safety rules are not pinned (B21 and B22 survived).
5. **Low (correctness).** The logout render (`server.js:1959`, no origin) shows a prompt pointing at `https://harbour.cat` (`DEFAULT_ORIGIN`). That is wrong on a self-host. Verified by unit: `renderLandingPage({})` includes `https://harbour.cat/getting-started` (B's own test asserts this as intended).
6. **Nit.** On `/account` the control is "Create a local workspace", not "+ local workspace" (`content/getting-started.md:74`).
7. **Nit (shared).** The `/\host` href, as A.

### B, suspected
8. **Nit.** Simple Dispatcher's repository link may be private to the public. The guide hedges with a runner fallback.

## What each did that the other missed

**A only:**
- safeHost on the landing prompt, with an e2e witness against a running server.
- Prompt-size ceilings for the guide and the landing prompt, plus a steady-base-growth group.
- A guide that reflects the deployment: the actual sign-in doors, generated from the same list as the hero buttons, and the actual free-tier state.
- The block is left out when there is no origin.
- e2e at 320px in light and dark, a no-JS check, and checks of the clipboard contents and position.
- The cookie-jar warning about making local workspaces with curl.
- A guard against the token-minting `.prompt-copy` handler.

**B only:**
- A full configuration guide: repository readiness, sources, AI keys, backlog hygiene, run modes, agent-access keys and bootstrap exchange, the first task, troubleshooting, a Done-when checklist.
- Drift tests that tie TTLs, limits, stage names, Settings areas, UI labels and anchors to source.
- Content negotiation on `/getting-started` with `Vary: Accept`.
- An HTML page that leads with the prompt for a human visitor and has a canonical tag.
- Heading ids, so in-page links resolve.
- A test that the fallback is not cached.
- A landing HTML comment that points agents at the guide.

## Verdict

**I would merge B, after fixes.** It is the implementation that delivers the feature as asked: a full, accurate (about 28 claims checked, none false), agent-readable guide whose drift-prone facts are tested against source.

Before merging, B needs:
1. The landing prompt built from `publicOrigin(req, { safeHost: true })`, and either the block omitted or the request origin used on the logout render.
2. A test for (1) against a running server.
3. Ceilings for the guide and the prompt in `prompt-size-budget.test.js`, or a recorded ruling that they are exempt.
4. Specific route needles for `/auth/email`, `/account` and `/llms.txt`.
5. A small llms.txt assertion.

A is the better-engineered shell: security, seams, budget, e2e. But its guide is too thin for the request. To be mergeable it needs:
1. Substantial guide content: repository checks, sources, runner requirements, Agent access, a first task, troubleshooting.
2. The free-tier-off sentence fixed.
3. The Jira-by-API-token route instead of "use local".
4. Agents pointed at Settings › Agent access with least-privilege scopes.
5. A fallback-non-caching test.

Either combination would also work: B's guide and drift tests on A's shell (safeHost landing, templated doors, budget ceilings).

## Full suite

`UNIT_TEST_CONCURRENCY=4 npm run test:unit`:
- A: 22,135 tests, 22,132 pass, 0 fail, exit 0.
- B: 22,092 tests, 22,089 pass, 0 fail, exit 0.
- The 3 not counted as passes in each are skipped or todo tests that are not part of either change.

e2e:
- A `landing-agent-prompt.spec.js`: 6/6.
- A `landing.spec.js`: 19/19.
- B `landing.spec.js`: 22/22, including its 3 new tests.
- Headless Chromium at 320px in light and dark: no horizontal overflow and no console errors on `/` or `/getting-started` in either tree (`overflow.mjs` (not preserved)).
