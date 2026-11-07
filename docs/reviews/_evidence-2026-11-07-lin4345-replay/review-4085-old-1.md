## Review — LIN-4085

Reviewed head `4f247b68`, the squash of PR #2221 (PR head `6dacd78d`), on base `f0ac579c`.

CI: green on `6dacd78d` (unit, all four E2E shards, secret scan), as the 18:18 implementation comment records. CI is configured in `.github/workflows/test.yml`. I also re-ran the eight affected unit files locally: 239/239 pass.

### Scope against the plan

Every place in the plan's table changed, and nothing outside it did: the guide doc, the builder, the route, the `isAuthExemptPath` entries, the sitemap, the `signInDoors` extraction, the landing block, the script and CSS, `llms.txt`, the size ceilings, the steady-base group, and the source map. The public-page scan list was not touched, which matches plan-review note 4: the scan covers `/landing-copy.js` on `/` automatically. One deviation from the plan:
- **The HTML form has its own small Marked renderer** instead of the Library's. The plan said "export it; do not copy it". The implementer's reason holds. The Library renderer's `heading`, `link` and `image` methods read per-document `activeRender` catalog state (`lib/library.js:48`, `:89-130`), so it can't take a free-standing guide. The new renderer escapes raw HTML and allow-lists hrefs, and `getting-started-route.test.js` tests that directly with hostile input (`javascript:`, mixed case, `data:`, `vbscript:`, `//evil`, `<script>`, `<img onerror>`). I accept this deviation.

The implementation comment says "the sign-out landing does not show the block". That is not quite right. Sign-out (`GET /logout`, `routes/auth.js:512`) redirects to `/`, which does show the block. The render that leaves the block out is the one in `handleWorkspaceRemoval` (`server.js:1959`); see ledger item 3.

### Regression check

I ran `git log` on every modified file. The only recent commit on the same behaviour is LIN-3346 (`10d3bf38`), which merged PAT auto-login and token refresh onto one shared `isAuthExemptPath`. This change adds two exact entries to that shared predicate and creates no private list, so the LIN-3346 drift guards still pass (`guest-task-path`, `pat-session` and `llms-limitations` tests are green). LIN-2010's registry-sourced GitHub and Jira hrefs survive the move into `signInDoors`. LIN-3692's `publicOrigin` is used as designed. Nothing reverted is re-applied.

### Gap analysis

Each success criterion, against the implementation:
- **Block under the CTAs, copy button, 320px, light and dark:** implemented, with e2e coverage (`tests/e2e/landing-agent-prompt.spec.js`), and I checked it by hand (see Manual verification).
- **`/getting-started.md` returns 200 `text/markdown` with no auth, and `/getting-started` returns HTML:** implemented and route-tested. I also confirmed it through the real `server.js` stack (ledger item 6).
- **Every placeholder filled, every link resolves:** unit-tested. Public routes get real requests. Routes behind auth or with parameters get a source-registration check, which the test itself says is weak.
- **`/llms.txt` names `/getting-started.md`:** done, and pinned above `## Library`.
- **Size ceilings recorded with a reason:** done. Each is set to its measured size, each line names LIN-4085, and `FROZEN_TOTAL_BYTES` rises by exactly 4669 + 3691 + 584 = 8944.
- **Cold-agent walk:** claimed on the PR, which this replay can't read. It ran with GET requests only, and it found four gaps that were then fixed. Nothing records a re-run against the fixed text. See ledger item 1.
- **Plan's claim "the doors come from one place":** true in code, but no test pins it at the route. See ledger item 2.

### Isolated, or one of a class?

- **Class: places that render the signed-out landing.** There are two call sites of `renderLandingPage`. `/` (`server.js:2333`) is handled. The `handleWorkspaceRemoval` fallback (`server.js:1959`) is not. **Inside**, as ledger item 3.
- **Class: places that decide which sign-in doors exist.** The hero and the guide now share `signInDoors`. The signed-out nav bar (`lib/components/navbar.js`, `isLanding` branch, about lines 91-120) still decides GitHub, Jira and email itself. That copy has existed since LIN-1890. The guide doesn't depend on it: the guide lists the hero's doors, not the nav's. The two lists match today, and the `signInDoors` header comment names the nav copy. **Outside**: a pre-existing duplicate between nav and hero, not this ticket's problem or cause. Close-out should file a follow-up after checking none exists: "The signed-out nav bar (`lib/components/navbar.js` isLanding branch) decides its GitHub/Jira/email doors itself instead of from `signInDoors()` (`lib/components/landing-hero.js`); derive it, keeping its own labels and testids."
- **Class: Host-derived origins on public pages.** The agent prompt and both guide routes use `publicOrigin(req, { safeHost: true })`. On `/`, the canonical and social tags still use the unvalidated `requestOriginOrNull(req)`. That predates this change. It only reflects back to the requester, responses are `no-store`, and production pins `PUBLIC_ORIGIN`. I judge it not a defect and file nothing.

### Test quality and mutation checks (LIN-2274)

Every mutation below was reverted, and `git status` is clean afterwards.

| Mutation | Result |
| -- | -- |
| `routes/getting-started.js`: raw `Host` instead of `publicOrigin(safeHost)` | red ("a malformed Host header falls back…") |
| `lib/guest-task-path.js`: drop the two `/getting-started*` entries | red (exemption test) |
| `lib/render-landing.js`: `agentHtml = ""` | red (5 landing tests) |
| `routes/library.js`: drop the sitemap entry | red (sitemap test) |
| `lib/prompts/agent-onboarding.js`: don't throw on an unknown placeholder | red |
| `routes/getting-started.js`: `signInDoors({})` instead of `signInDoors(flags)` | **green**, survives |
| `routes/getting-started.js`: `freeTierEnabled: false` instead of `flags.freeTierEnabled` | **green**, survives |
| `deploymentFlags()`: `githubEnabled: true` hard-coded | green, survives (I checked by reading instead: it is one-to-one with the predicates at `server.js:2333`) |
| `lib/components/landing-hero.js`: GitHub CTA rendered before Linear | **green**, survives |

Findings:
- The door and free-tier wiring at the route is untested. The `agent-onboarding.test.js` checks that the guide's doors equal the hero's for all eight flag combinations, but the test builds the doors with `signInDoors` itself and hands them to the builder. That proves the builder and nothing about the route. The route test's `ALL_DOORS` case never looks at doors. Ledger item 2.
- The plan named `landing-hero.test.js` as the check that the hero stays byte-identical, and it misses a reorder. I checked byte-identity directly instead. I loaded `HEAD^`'s `landing-hero.js` beside the new one and compared `renderSignInCtas` and `renderLandingHero` output for all 8 flag combinations × 2 `idPrefix` values: 0 differences. The claim is settled. The named test just doesn't prove it.
- Test levels are right for the change: e2e for the landing block (copy, clipboard, no-JS, 320px, hostile Host on `/`), route tests for headers and lookalike paths, unit tests for the builder. The one path no automated test drives is the guide through the full `server.js` stack (mount order plus exemption). I ran it myself (ledger item 6).

### Manual verification

On a local server at `4f247b68` (unconfigured env, as in e2e), using Playwright at 320px and 1280px, light and dark:
- The block sits directly under "Log in with Linear / Continue with email" with its own heading. It reads as a second way in, not as the start of the showcase.
- `scrollWidth - clientWidth = 0` at every size and theme.
- Copy puts the origin-filled prompt on the clipboard.
- There are no console errors.

Over raw HTTP: `/getting-started.md` returns 200 `text/markdown; charset=utf-8` with `MARKDOWN_CSP` and no `Set-Cookie`. `/getting-started` and `/GETTING-STARTED/` return 200 HTML with `LIBRARY_CSP` (the theme script is hash-allowed). `/getting-started.md.bak` returns 404. `/sitemap.xml` lists `/getting-started`, and `/landing-copy.js` is served as JS.

### Review checklist

- [x] Tests cover new and changed behaviour. The route-level door and free-tier gap is ledger item 2.
- [x] No unintended side effects. The guide routes set no cookie and mint no PAT session (shared exemption). The block avoids `.prompt-copy`, so app.js's token-minting handler never binds to it (pinned by test).
- [x] Shared paths: hero and guide share `signInDoors`, and the hero output is byte-identical (verified above).
- [x] Security: validated origin, exact exemptions with lookalike negatives, sandboxed `.md`, escaped HTML render, no credential in either text (secret-scan rules applied in tests), static script with no CSP change.
- [x] Error handling: an unreadable guide serves an uncached fallback, and an unknown placeholder throws at parse time.
- [x] Style is consistent with the runner-prompt pattern. Non-blocking nit: in the guide, "Sign in (OAuth) through any of the doors above" also covers the email door, which is not OAuth.
- [x] No performance concern: the template is read once and cached, and filling it per request is trivial.

### What CI Did Not Prove

1. **The cold-agent walk passes on the final guide text.** **Inside**: Success Criterion 4. The walk ran before the four fixes in `6dacd78d` and used GET requests only. The ticket records no re-run against the fixed text, and the transcript is on the PR, not here. **Before the merge:** close-out confirms PR #2221 carries the walk summary, and that a walk ran against the guide as it stands at `4f247b68`. If not, close-out runs one: a fresh Claude Code session with no Harbour context, given only the prompt copied from `/` on a local server. It passes when the agent asks the person first, then either sends them to `<origin>/swipe` → "+ local workspace", or says "sign in with <a door the guide lists>, then copy the Agent Prompt from `<origin>/workspace/<urlKey>/proxy`". It fails if the agent fetches or names any URL not in the guide, or creates a workspace itself with `POST /workspace/new`.
2. **The guide's doors and free-tier sentence follow the deployment's flags at the route.** **Inside**: Scope item 1 ("filled from source… from the same flags the hero CTAs use") and the plan's "the sign-in doors come from one place". Mutations `signInDoors({})` and `freeTierEnabled: false` in `guideFor` stay green. **Before the merge, fix:** in `tests/unit/getting-started-route.test.js`, test "serves the guide as sandboxed markdown, with no session, nosniff and no-store" (the `ALL_DOORS` server), add assertions that the body includes `` `${base}/auth/github` ``, `` `${base}/auth/jira/oauth` ``, `` `${base}/auth/email` `` and `'This deployment has a free tier, so no OpenRouter key is needed to start.'`. To check the fix: each of the two mutations above must now turn that test red.
3. **The second landing render, `handleWorkspaceRemoval` (`server.js:1959`), shows no agent block.** **Inside**: the plan's behaviour, "a visitor can reach, from public pages, an agent-readable way in", and the landing class above. The implementation left it out on purpose, but its reason is on the PR, not the ticket. **Before the merge:** close-out records an explicit drop on the ticket with this reason. This render is the fallback shown when the session's last workspace is removed for a failed credential (callers at `server.js:2179`, `2236`, `2288` and `2306`). It is not sign-out, which redirects to `/` and shows the block. The visitor's next load of `/` shows the block, and adding it here means passing the request into a credential-eviction helper. If close-out finds the PR's reason is different and does not support a drop, the alternative is to do it here: add `agentOrigin: publicOrigin(res.req, { safeHost: true })` to the `renderLandingPage` call at `server.js:1959`.
4. **Placement meets the 17:43 ruling** ("directly under the hero sign-in buttons, as an equal second way in"). **Inside**: the ruling. **Discharged** by my 320px and 1280px light/dark screenshots: the block is first in `<main>`, immediately under the CTAs, with its own heading. If a person reads it as secondary, plan-review note 5 gives the fix: move it inside `.landing-hero`, after `.landing-ctas`.
5. **On the hosted deployment, the guide and prompt carry the canonical `https://harbour.cat` origin.** **Inside**: Success Criteria 1–2. No CI environment has production's `PUBLIC_ORIGIN` or proxy. **After the deploy:** fetch `https://harbour.cat/getting-started.md`. It passes on 200 `text/markdown`, with every link starting `https://harbour.cat/` (not `http://` and not an internal host), and when the `<pre>` on `https://harbour.cat/` names `https://harbour.cat/getting-started.md`. **Rollback:** revert squash commit `4f247b68`. Nothing is migrated or persisted, so the revert is clean.
6. **The guide is reachable through the real server stack** (mount order, `isAuthExemptPath`, no session minted). **Inside**: Success Criterion 2. Route tests mount the router alone, and no e2e test requests `/getting-started*`. **Discharged** by my run of `node server.js` at `4f247b68`: 200 for both forms and for case and trailing-slash variants, correct CSPs, no `Set-Cookie`, 404 for `.md.bak`.
7. **The `/kpis` "How people get started" funnel moves.** **Inside**: Success Criterion 6, which the ticket marks "not a merge gate". **After the deploy:** close-out reads the `/kpis` funnel one week after deploy and posts the first-Go-press count against the 0-in-30-days baseline on the ticket.

### Verdict

**Approve — conditional on close-out discharging the ledger**

The ask was "a prompt that the person passes to their agent… linking to a harbour.cat slash getting started page which walks an agent through onboarding project and the user to Harbour". The change ships exactly that: a copyable prompt on `/` and a public `/getting-started(.md)` guide that asks first and then sequences the person's clicks. I name no narrowing. The self-host pointer and the static-per-deployment prompt are consistent with an ask about harbour.cat. Close-out's work: re-confirm or re-run the walk (item 1), add the four route-test assertions (item 2), record the item-3 drop, and run the two post-deploy steps (items 5 and 7). Close-out also files the outside nav-bar follow-up.
