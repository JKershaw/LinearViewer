## Review — LIN-4085

Reviewed head `4f247b68`: the squash of PR #2221. The ticket records the PR head as `6dacd78d`.

CI: green on the PR (unit, all four E2E shards, secret scan), as the 18:18 comment records. I also re-ran the touched unit files myself: 236/236 pass across agent-onboarding, getting-started-route, landing-agent-prompt, prompt-size-budget, library, landing-hero, render-landing and guest-task-path. `tests/e2e/landing-agent-prompt.spec.js` passes 6/6 against a local server. My first e2e attempt collided on ports 3001-3003 with another Playwright run on the same machine. The rerun with those ports free was clean.

### What was asked vs what changed

The ask: replace an npm-install-style getting-started line with "a prompt that the person passes to their agent … linking to a harbour.cat/getting-started page which walks an agent through onboarding". The scope adds two root-cause parts: `/llms.txt` names no way in, and no text is addressed to agents. The change covers every place in the plan's table, and no others:
- the guide source `docs/agent-onboarding.md`
- the builder `lib/prompts/agent-onboarding.js`
- the routes `GET /getting-started` and `/getting-started.md`
- two exact `isAuthExemptPath` entries
- the sitemap entry
- the `signInDoors` extraction, with the hero's output unchanged (landing-hero tests green)
- the landing block, plus `public/landing-copy.js` and CSS
- the `llms.txt` section above Library
- the size ceilings, the steady-base group and the source-map entries

The 17:43 placement ruling is met. The block is the first child of `<main>`, directly after the hero, and the e2e test asserts it has no previous sibling. All seven plan-review notes were followed:
- the block uses its own classes, not `.prompt-copy`;
- the `signInDoors` header names navbar.js as a separate copy;
- the door links are full URLs, and the link test extracts absolute URLs;
- the secrets check uses `scanText`;
- `nosniff` and `no-store` are set in the router itself.

There is one deviation from the plan. The HTML form uses a new 15-line `Marked` instance, not the Library's renderer. The Library's renderer is bound to per-document `activeRender` state (`lib/library.js:90-131`), so it can't be called without a catalog. The new renderer escapes raw HTML, allow-lists link schemes and is tested directly with hostile input. I accept the deviation; nothing to fix.

Re-ground: since the ticket was created (2026-11-01T17:34Z), no commit before HEAD touches `lib/render-landing.js`, `lib/components/landing-hero.js`, `lib/guest-task-path.js`, `public/llms.txt`, `routes/library.js`, `lib/public-origin.js` or `lib/components/navbar.js`.

### Regression check

`git log -30` on the touched files. The relevant recent fix is LIN-3346 (`10d3bf38`): one public-path predicate shared by PAT auto-login and token refresh. It is intact. The change adds two exact `===` entries inside the shared `isAuthExemptPath` and adds no private list to either consumer. The LIN-3346 drift guard is still green. LIN-2255's `llms.txt` Limitations section is untouched. I found no reverts on these files.

### Manual verification

I ran `node server.js` (NODE_ENV=test, no PUBLIC_ORIGIN) and checked:
- `GET /getting-started.md` returns 200 `text/markdown; charset=utf-8` with `nosniff`, `no-store`, `default-src 'none'; sandbox` and no `Set-Cookie`.
- `GET /getting-started` returns HTML under LIBRARY_CSP. Its only inline script is the theme prepaint, whose hash is the one LIBRARY_CSP pins.
- `/GETTING-STARTED/` returns 200 and `/getting-startedxmd` returns 404, matching Express's case and trailing-slash handling and the exemption's.
- `sitemap.xml` lists `/getting-started` and not the `.md` form.
- Signed out, `/swipe` returns 200 with "+ local workspace" in the nav, so path (a) holds.
- `/` is `Cache-Control: private, no-store`.

I looked at the e2e screenshots at 320px (light) and at desktop width (dark). The prompt wraps, the button sits above it, and nothing scrolls sideways.

### Mutation checks

I made each change, ran the three new unit files, then reverted.

| Mutation | Result |
| -- | -- |
| M1: remove the two `isAuthExemptPath` entries | red (1) |
| M2: drop `${agentHtml}` from the landing content | red (5) |
| M4: the route hard-codes `freeTierEnabled: true` | red (1) |
| M5: the route uses the raw `req.protocol://host` in place of `publicOrigin(req, { safeHost: true })` | red (1, the malformed-Host test) |
| M3: the route passes `signInDoors({})` and ignores the deployment's door flags | **green** |
| M6: `deploymentFlags()` hard-codes `githubEnabled: true` | **green** |

Why M3 stays green:
- The route test with `ALL_DOORS` asserts nothing about doors.
- The `NO_DOORS` test only checks that GitHub is absent, which `signInDoors({})` also satisfies.
- The eight-combination door test calls the builder directly, not the route.

So the route's wiring from flags to doors has no witness. Fix 1 below adds one.

M6 is the same gap one level up. `deploymentFlags()` calls the same predicates that `server.js:2333` calls inline for the hero. They are two call sites, but neither is wrong today. I'm noting this, not naming a fix.

### Isolated, or one of a class?

Class: **pages that render the signed-out landing, or that decide the sign-in doors.**

- The sign-out landing at `server.js:1959` calls `renderLandingPage` without `agentOrigin`, so the block is left out. **Inside**: it is the same landing page, under the plan's behaviour "a visitor can reach, from public pages, an agent-readable way in". It goes in the ledger as item 3.
- The signed-out nav's own door decision, `lib/components/navbar.js:91-120`. **Outside**: this duplication existed before the change. The guide never sends the person to the nav's sign-in links (path (a) uses `/swipe` only for "+ local workspace"), and plan review ruled it needs no change here. Close-out may file a follow-up to derive the nav doors from `signInDoors`, after checking that no ticket for it already exists.

I found no other renderer of the landing and no other public agent-instruction surface that lacks a way in.

### Findings

1. **A well-formed forged Host still reaches both texts when PUBLIC_ORIGIN is unset.** `publicOrigin(req, { safeHost: true })` only checks the Host header's shape (`/^[a-z0-9.-]+(:\d+)?$/i`). Locally, `Host: evil.example` puts `http://evil.example/getting-started.md` into the landing prompt, and evil.example appears 10 times in the guide. The tests use only a malformed Host (`evil.example/<script>…`), so this passes them.
   - Impact is low. Both responses are no-store (`/` is `private, no-store`), so the forged origin only goes back to the client that sent it.
   - The implementation follows the plan as written. The plan assumed `safeHost` was enough; it isn't on its own.
   - Two texts overclaim. The design note in `docs/agent-onboarding.md` says "a forged Host cannot steer the guide". The e2e test is titled "a hostile Host header never reaches the prompt".
   - In production, the real protection is PUBLIC_ORIGIN. Fix 2 and ledger item 2 cover this.
2. **The guide's path (b) is wrong for the email door.** The email door signs a person in with no tracker. `accountHomeRedirect` (`routes/email-auth.js:79`) sends a session with no workspace to `/account`, and `/swipe` redirects there too. So "the workspace key is in the address bar once they are signed in" is false for that door. The person first has to connect a source or create a local workspace on `/account`, which offers both (`lib/render-account-home.js`). Plan risk 1 ("the guide is wrong about a door") is exactly this. The cold-agent walk was GET-only, so it could not catch it. Fix 3.

### Fixes for close-out (make these before the merge)

1. **Add a test that the route's doors follow the flags.**
   - Where: `tests/unit/getting-started-route.test.js`, the test "serves the guide as sandboxed markdown, with no session, nosniff and no-store" (it runs with `ALL_DOORS`).
   - What to add:
     - assert the body contains each of these lines: `- [Continue with GitHub](`, `- [Continue with Jira](` and ``- [Continue with email](${base}/auth/email)``;
     - assert it contains `This deployment has a free tier`.
   - Check: re-run M3 (in `guideFor`, `signInDoors(flags)` becomes `signInDoors({})`) and confirm the test goes red. Then revert M3.
2. **Correct the two Host overclaims.**
   - In `docs/agent-onboarding.md` (design notes, above `---`), replace "so a self-host points at itself and a forged Host cannot steer the guide" with: "so a self-host points at itself; a malformed Host falls back to harbour.cat, a well-formed one is reflected only to the client that sent it (the response is `no-store`), and a configured PUBLIC_ORIGIN pins it".
   - In `tests/e2e/landing-agent-prompt.spec.js`:
     - rename the test to "a malformed Host header never reaches the prompt: the canonical origin is used";
     - change the comment above it to match: safeHost rejects malformed hosts, and PUBLIC_ORIGIN pins well-formed ones.
3. **Add the email door's extra step to path (b).**
   - Where: `docs/agent-onboarding.md`, path (b), at the end of step 1.
   - Add: "The email door signs the person in without a tracker: they land on `{{BASE_URL}}/account`, where they connect a tracker or create a local workspace before step 2."
   - Fixes 2 and 3 change the guide's size. Re-measure and set `AGENT_ONBOARDING_SOURCE_CEILING` and `AGENT_ONBOARDING_RENDERED_CEILING` (`tests/unit/prompt-size-budget.test.js`) to the new measured sizes. Raise `FROZEN_TOTAL_BYTES` by exactly the sum of the two deltas. Each comment line cites LIN-4085 and the reason ("review: email door lands on /account; Host note corrected").

### What CI Did Not Prove

1. **The cold-agent walk (Success Criterion 4). Inside**: it is the ticket's own bar, and it is the only real test of the parameterised and authenticated links, which the unit test checks only by reading source.
   - The 18:18 comment says the walk ran (GET only), found four gaps, and that `6dacd78d` fixed them. I cannot see the PR transcript from here.
   - Settle before the merge: close-out confirms the transcript summary is on PR #2221. It must show the agent, given only the copied prompt, reaching either the "+ local workspace via /swipe" path or a "sign in with X, then copy the Agent Prompt from `/workspace/<urlKey>/proxy`" instruction, with no URL that is missing from the guide.
   - If fix 3 lands, a re-walk is not required: the change is one sentence on a door the walk did not take.
2. **The production origin. Inside**: plan decision "Origin is the validated one" and plan risk 2. CI runs with `PUBLIC_ORIGIN=` empty and over plain http, so it cannot show what harbour.cat serves.
   - Before the merge: confirm PUBLIC_ORIGIN is set to `https://harbour.cat` in the production environment. Without it, the texts follow a well-formed Host (finding 1).
   - After the deploy: run `curl -s https://harbour.cat/getting-started.md`. It must contain `https://harbour.cat/auth/linear`; `http://` or any other host is wrong. The landing's `<pre>` on `https://harbour.cat/` must contain `https://harbour.cat/getting-started.md`.
   - Rollback: revert `4f247b68`. The change is reversible: no migration and no stored data.
3. **The landing shown after signing out (`server.js:1959`) omits the block. Inside**: same landing page, same behaviour.
   - Settle by an explicit drop, which close-out records on the ticket with this reason. That page is the reply to removing the last workspace, rendered without `req`: the call chain `handleWorkspaceRemoval(session, workspaceId, res)` has no request object to take an origin from. The person has just signed in, so they are not the cold visitor. The next `GET /` shows the block.
   - The ask was `/`, and this page is not served at `/`, so the drop does not narrow what was asked.
4. **Whether the placement reads as "an equal second way in" (the 17:43 ruling). Inside.**
   - The tests check DOM order only. My screenshot check covered the block alone, not the block beside the hero.
   - Settle before the merge: a person looks at `/` at 1280px and 320px. The block must read as an alternative to the sign-in buttons, not as the start of the showcase. If it reads as secondary, plan-review note 5 has the fix: move it inside `.landing-hero`, after `.landing-ctas`.
5. **Whether the change moves the funnel (the "After it ships" criterion). Inside, but explicitly not a merge gate.**
   - After the deploy: about a week after deploy, read the `/kpis` "How people get started" funnel. It was at 0 first Go presses over 30 days before this change.
   - No check short of production can show adoption.

### Verdict

Approve — conditional on close-out discharging the ledger

The change does what was asked: "a prompt that the person passes to their agent … linking to a harbour.cat/getting-started page which walks an agent through onboarding". It also adds the `llms.txt` entry the scope set. Nothing is narrowed: the sign-out page in item 3 is not `/`, and the Home prompt was excluded by scope as a separate slot. Close-out makes fixes 1-3 and settles ledger items 1, 2 (pre-merge part) and 4 before merging. Item 2's post-deploy part and item 5 come after the deploy.
