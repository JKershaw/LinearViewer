## Review — LIN-4085

Reviewed head `4f247b68` (the squash of PR #2221, three commits: build, cold-agent walk fixes, review-finding tests).

CI: green, as recorded in the 18:18 comment (unit, all four E2E shards, secret scan) for PR #2221. Close-out re-checks the exact merge commit.

### What I checked

**Scope against the plan.** Every changed file is a place in the plan's table: the guide and its builder, the route, the two exact `isAuthExemptPath` entries, the sitemap, the `signInDoors` extraction, the landing block with its script and CSS, `llms.txt`, the source-map, the size ceilings, the steady-base group, and the `server.js` mount plus `agentOrigin`. Nothing goes beyond the plan. Two deviations, both acceptable:
- **The HTML form has its own small `Marked` renderer.** The plan said to reuse the Library's renderer. That renderer reads a per-catalog `activeRender` (slugger, catalog link resolution; `lib/library.js:90-130`), so it really cannot be reused here. The new renderer is a fresh 15 lines, not a copy. It escapes raw HTML, allow-lists link schemes, and is tested with hostile input.
- **The public-page scan list was not extended.** Plan-review note 4 said this adds nothing, and `/landing-copy.js` is scanned automatically as JS on `/`.

**Regression check.** I ran `git log` on every touched file. LIN-3346 (one public-path exemption helper): the new entries use that same helper, in its exact-match shape. LIN-3692 (absolute URLs from one public origin): the route and the landing both use `publicOrigin`. LIN-4015 (CSS dead and duplicate rules removed) is touched slightly: see the CSS note below. Nothing reverted or previously fixed is re-applied.

**Real server.** I started a `NODE_ENV=test` server on its own port with no cookie. `/getting-started.md` returns 200 `text/markdown; charset=utf-8` with `nosniff`, `no-store` and `default-src 'none'; sandbox`. `/getting-started` returns 200 HTML under `LIBRARY_CSP`, and its only inline script is the hash-pinned theme script. The doors listed match the flags (Linear, Jira, email on that server). `/` sends `private, no-store`.

**Path (a), walked in a real browser.** The cold-agent walk was GET-only, so I drove this path myself in a fresh Playwright context with no cookie: `/swipe` → "+ local workspace" → `/workspace/local-workspace-…/` → `/workspace/<key>/proxy` → "generate & copy" → a proxy prompt appears. The plan named this as the likeliest place for the guide to be wrong, and it is correct.

**Placement.** I took desktop (1280) and 320px screenshots in light and dark. The block sits right under the Linear and email buttons, before the localhost setup box. It reads as a second way in, and the text is legible in both themes.

**Mutation checks** (each reverted; `git status` is clean):

| Mutation | Result |
| -- | -- |
| Drop the two `isAuthExemptPath` entries | route test red (1) |
| Route passes `doors: []` | route test red (2) |
| Route uses `publicOrigin(req)` without `safeHost` | route test red (1) |
| Builder fills `SIGN_IN_DOORS` empty | onboarding test red (9) |
| Drop `/landing-copy.js` from the landing `scripts` | landing test red (1) |
| Guide renderer stops escaping raw HTML | route test red (1) |
| `server.js` passes `requestOriginOrNull(req)` as `agentOrigin` | e2e hostile-Host test red |
| Copy script writes `''` to the clipboard | e2e clipboard test red |
| **Remove all of `.lx-agent__block` / `.lx-agent__text`, and force `white-space: pre !important` on the prompt** | **e2e 320px test stays green**: see finding 2 |

All 101 tests in the six touched or new unit files pass locally. The six e2e tests in `landing-agent-prompt.spec.js` pass on an isolated server.

### Findings

1. **The guide's path (b) is wrong for the email door.** `{{SIGN_IN_DOORS}}` lists "Continue with email" whenever email is on, under the heading "A real tracker". Step 2 then says the workspace key "is in the address bar once they are signed in". But an email sign-in connects no tracker. A new account lands on `/account` (`routes/email-auth.js:687`, `accountHomeRedirect`), which has no workspace, no key and no Proxy page. An agent that picks the email door gets a wrong next instruction, and the Success Criterion asks for a *correct* one. A related gap: the Proxy page shows no prompt until the person presses "generate & copy" and picks a scope (`lib/render-proxy.js:47-60`). The guide says only "copy the Agent Prompt there".
2. **The 320px witness cannot fail.** `html`/`body` are `overflow-x: clip` (`public/style.css:295`), and `.lx-glimpse` is already `overflow: hidden`. So `documentElement.scrollWidth - clientWidth` stays 0 even when the prompt does not wrap. Under the mutation above I measured the `<pre>` at `scrollWidth 1953` inside `clientWidth 246`, with the document still at 320/320. The criterion holds on the real build (`<pre>` 246/246, wrapping through `.lx-terminal__body`'s existing `pre-wrap`), but the test does not witness it.
3. **Note: the design notes overclaim on the Host header.** `docs/agent-onboarding.md` says "a forged Host cannot steer the guide". That is true for a malformed Host. A well-formed one (`Host: evil.example`) is reflected whenever `PUBLIC_ORIGIN` is unset: I saw 12 occurrences on the local server. This is the same model the Library uses, and there is no shared-cache exposure, because both routes and `/` are `no-store`. So this is a wording fix, not a security finding.
4. **Note, not required: the new CSS mostly repeats existing rules.** `.lx-agent__block`'s `overflow: hidden` repeats `.lx-glimpse`. `.lx-agent__text`'s `pre-wrap` / `overflow-x: auto` repeat `.lx-terminal__body` (`public/landing.css:305-315`). LIN-4015 has just removed duplicates like these. Close-out may drop the two rules (keeping `.lx-agent` and the `.lx-agent__copy*` rules) once fix 2's assertion is in place to catch a regression.

**Fixes for close-out to make:**
- **Fix 1 (finding 1 and note 3):** `docs/agent-onboarding.md`.
  - In path (b), after step 1, add: "If the person uses Continue with email (when it is listed), they are signed in without a tracker. A new account lands on its account page, {{BASE_URL}}/account, where the person connects a tracker or creates a local workspace. Then go on to step 2."
  - In both path (a) and step 2 of path (b), replace "copy the Agent Prompt there" with wording that says the person presses **generate & copy** in the Agent Prompt section, after choosing the scope the work needs (read-only, read-write, or read-write + dispatch), and pastes the result to you.
  - In the design notes, change "a forged Host cannot steer the guide" to "a malformed Host falls back to harbour.cat; a well-formed one is pinned only by PUBLIC_ORIGIN, and both routes are no-store".
  - Then add `'/account': { file: 'routes/email-auth.js', needle: "router.get('/account'" }` to `REGISTERED` in `tests/unit/agent-onboarding.test.js`.
  - Re-measure `AGENT_ONBOARDING_SOURCE_CEILING` and `AGENT_ONBOARDING_RENDERED_CEILING` to their new sizes. Raise `FROZEN_TOTAL_BYTES` by exactly the sum of the two deltas, with a LIN-4085 reason on each line.
- **Fix 2 (finding 2):** `tests/e2e/landing-agent-prompt.spec.js`, in the 320px test's loop, after the page-overflow assertion, add:
  ```js
  const preOverflow = await page.locator(TEXT).evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(preOverflow, `${scheme}: the prompt is clipped or scrolls in its box instead of wrapping`).toBeLessThanOrEqual(0);
  ```
  Also add one comment line saying the page check alone cannot fail, because the root is `overflow-x: clip`. With the `white-space: pre !important` mutation this goes red (1953 > 246).

### Isolated, or one of a class?

- **Class: deciding the sign-in doors in more than one place.** The plan bounded this ("the sign-in doors come from one place"). One sibling is unhandled: the signed-out nav bar on `/swipe` (`lib/components/navbar.js:91-120`). It is inside the class. It was dropped at plan review (17:45 note 2), because the guide reads the hero's list and does not route sign-in through the nav. The `signInDoors` header records it honestly as a separate copy. The account home's `accountHomeSourceCtas` is a different list (add a source, registry-derived, no email), not a sibling.
- **Class: `renderLandingPage` callers.** The other caller, `handleWorkspaceRemoval` (`server.js:1959`, the landing shown after the last workspace is removed), has no `req`, and already passes no `origin`. Leaving the block out there is deliberate and consistent with that path. This is outside the ticket and not a defect; nothing to file.

### What CI Did Not Prove

- **The email door instruction in the guide** (inside: the guide's sign-in doors and path (b), In Scope item 1). Settled **before the merge** by fix 1. The condition that tells right from wrong: the guide served with `emailEnabled: true` says that an email sign-in lands on `/account` and what to do there, and `node --test tests/unit/agent-onboarding.test.js tests/unit/prompt-size-budget.test.js` is green with the re-measured ceilings.
- **The 320px no-scroll criterion has a real witness** (inside: Success Criterion 1). Settled **before the merge** by fix 2. Condition: the e2e passes on the real build and goes red with `.lx-agent__text { white-space: pre !important }`.
- **Path (a) end to end: the person creates a local workspace and the Proxy page gives the prompt** (inside: guide path (a), the plan's likeliest-wrong spot). **Discharged**: I walked it in a fresh browser context with no cookie (see above).
- **Path (b) after a real OAuth sign-in** (inside: a claim the guide depends on). The claim: after Linear, GitHub or Jira OAuth the person lands on `/workspace/<key>/`, and "generate & copy" on `/workspace/<key>/proxy` gives the prompt. No CI run reaches a real provider. Settled **after the deploy**: in a fresh browser profile on harbour.cat, sign in with Linear, then confirm the address bar shows `/workspace/<key>/` and that the Proxy page's "generate & copy" yields a prompt. Wrong = landing anywhere without a key in the path.
- **The production origin in the prompt and the guide** (inside: `{{BASE_URL}}` from `publicOrigin`, In Scope items 1 and 3). The scheme comes from `PUBLIC_ORIGIN` or `trust proxy`, which only production has. Settled **after the deploy**: `curl -s https://harbour.cat/getting-started.md | grep -c 'https://harbour.cat/auth/linear'` returns ≥1, and the `<pre>` on `https://harbour.cat/` contains `https://harbour.cat/getting-started.md`. Wrong = `http://` or any other host. **Rollback**: revert the squash commit `4f247b68`. It is reversible: no migration, no persisted data.
- **The copy button outside Chromium** (inside: Success Criterion 1, "a working copy button"). The e2e runs Chromium only, so the `execCommand` fallback and Safari/Firefox clipboard behaviour are unexercised. Settled **after the deploy**: on iOS Safari and desktop Firefox, press Copy prompt and paste. Right = "Copied" and the pasted text matches the `<pre>`, or "Selected: press Ctrl/Cmd+C" with the prompt selected.
- **The nav bar's separate door list** (inside: the doors-from-one-place class). **Discharged**: dropped at plan review (17:45 note 2), with the reason given above.
- **The `/kpis` "How people get started" funnel** (inside: the ticket's post-ship criterion; not a merge gate). Settled **after the deploy** by a monitor: read the funnel one week after deploy. Only real visitors can move it.

The `## As asked` request, sentence by sentence:
1. *A prompt where software puts its `npm install` line, for the person to pass to their agent.* Met. A terminal-style block with a copy button sits directly under the hero sign-in buttons on `/`. Scoping found there was no existing section, so a new block was added.
2. *A couple of paragraphs, linking to harbour.cat/getting-started, which walks an agent through onboarding the project and the user.* Met. The prompt is three paragraphs pointing at `<origin>/getting-started.md`, with `/getting-started` as the fallback. The guide is public at both forms.
3. *Because it is an instruction for an agent, the person uses their agent to work with Harbour, a good first step.* Met by design: the prompt is addressed to the agent and says what only the person must click.
4. *The agent reads the guide and decides whether to talk with the user or review the repositories and settings.* Met: the "Ask or look first" section, and the prompt tells the agent to ask before picking a path.
5. *A full guide to configuring Harbour for whatever the situation, without the user following the steps themselves.* Met once fix 1 lands. Each situation gets a path: just looking, a real tracker, a runner, and a pointer to the README for self-hosting. After sign-in the agent gets the full API through the Proxy Agent Prompt and `/api/proxy/instructions`. The email-door gap is the one place it was wrong.

On wording sign-off: the 17:39 decision makes it not a gate. John can still read the copy before merge if he wants to.

### Verdict

Approve — conditional on close-out discharging the ledger
