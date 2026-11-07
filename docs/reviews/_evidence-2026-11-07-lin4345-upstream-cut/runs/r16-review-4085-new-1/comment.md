## Review — LIN-4085

I reviewed head `4f247b68`. That is the squash of PR #2221 (PR head `6dacd78d`), and it **is already on `main`**: John Kershaw merged it on 2026-11-01 at 18:33. The 18:18 comment said "Merge is not mine; it waits on review", so this review comes after the merge, not before it. That means a fix lands as a follow-up commit on this ticket, and the rollback is `git revert 4f247b68`, which is clean: nothing is persisted and there is no migration.

CI: CI exists (`.github/workflows/test.yml`), but this stage has no GitHub access, so I could not read the rollup on `4f247b68` myself. As a substitute I ran the suites myself on both branches. `npm run test:unit` passes on head (22135/22135) and on base `f0ac579c` (22092/22092). Neither run has any failing test name, and head adds 43 tests. Playwright `landing-agent-prompt.spec.js` + `landing.spec.js` + `library.spec.js` pass on head (39/39). This substitute has limits: it ran on one dev machine (Node 25, not the pinned 24), not in a clean environment, it was not independent of the author's setup, and it gives no flake separation.

### What was asked, sentence by sentence

1. *"…on the homepage the getting started section… like an npm install command we can have a prompt that the person passes to their agent… a couple of paragraphs explaining the situation and linking to a harbour.cat/getting started page which walks an agent through onboarding project and the user to Harbour."* **Met.** `/` shows a 3-paragraph prompt in a terminal-style block, directly under the hero sign-in buttons. It points at `<origin>/getting-started.md`. `GET /getting-started(.md)` serves the guide, public and with no session. I checked this on a running server and in screenshots at 320px and 1280px, light and dark.
2. *"…the agent can then read the guide it can decide whether to have a conversation with the user or review the repositories and the settings."* **Met.** The guide's "Ask or look first" section offers both, and it says "Do not start a path the person has not agreed to."
3. *"…essentially a full guide on how to properly configure Harbour for whatever your situation is without the user needing to follow those steps…"* **Met in part.** The person still signs in (OAuth), connects an OpenRouter key and mints the owner runner key. The plan named this as a cut that "needs a ruling and is unagreed until answered". No comment or answered ruling on the thread accepts it: the only ruling recorded, at 17:43, is about prominence. A stage's scope or plan cannot agree to a narrowing, so this goes to the person. See the Verdict.

### Scope versus the plan (what landed against the plan's places)

Done as planned:
- the guide doc and its module, with an uncached fallback and a refusal on an unknown placeholder;
- `signInDoors()`, with the hero byte-identical (I diffed hero, CTAs and the whole landing over all 16 flag combinations, base against head: the only lines added are the block slot and `<script src="/landing-copy.js">`);
- the router with exact `isAuthExemptPath` entries;
- the sitemap entry;
- the `llms.txt` section above Library;
- the CSS block and the static copy script with its own classes (no `.prompt-copy`);
- the three size ceilings, with the `FROZEN_TOTAL_BYTES` sum and the `+ 3` matcher count;
- the `source-map.md` entries.

Places the plan named that were **not** done. Each one is a fix for close-out, listed below:
- Plan §3, one function for the deployment's door and free-tier flags, called by `/`, the logout render and the guide. It was not extracted. `routes/getting-started.js` adds `deploymentFlags()` as a **third** copy beside `server.js:1959` and `server.js:2333`. That is exactly the drift the plan set out to stop.
- Plan §8: the README "For AI Agents" bullet and the landing's agent HTML comment naming `/getting-started.md` are both missing. The plan's own table marks both as "in".
- Plan §6, the landing prompt's fourth point, "use only URLs the guide gives", is missing. That instruction backs the Success Criterion "without inventing URLs".
- Plan §4: the HTML page neither links to the `.md` nor carries the Local CTA. Path (a) sends the person to `/swipe` → "+ local workspace" instead. I walked that path in Chromium at 390px and 1280px: the button is visible, it creates `local-workspace-*`, and `/workspace/<key>/proxy` returns 200 with `#proxy-generate-btn`. The deviation works, so I'm accepting it, apart from the drift guard below.
- "What the guide must say": three points are missing.
  - (a) does not say that a local workspace stays in the browser that made it and does not follow the person to another device. It says only that an agent-made one sits in the agent's cookie jar.
  - (c) does not say the runner is Claude Code only.
  - The self-host pointer does not name the one human step, creating a Linear OAuth app or token. The plan relied on that sentence to argue "whatever your situation is" was not a cut.
- "The guide quotes no UI label that isn't filled from source or checked by a test": "+ local workspace", "Agent Prompt" and "Settings page" are typed by hand, and no test checks them.
- Planned witnesses that are missing:
  - the `pat-session` case;
  - env-sentinel secret checks (the `scanText` runs have no secrets set, so they cannot fail);
  - an e2e that fetches `/getting-started.md` on the running server.

  The e2e link check was weakened to string needles, and the test file admits it.
- `BASE_PUBLIC_PAGES` was not changed. Plan-review note 4 judged it low value because these pages carry no script. I accept that. No fix.

### Regression check

I ran `git log` on every modified file and found no conflicts.
- LIN-3346 (one exemption predicate): kept.
- LIN-3692 (absolute URLs only from `publicOrigin`): kept, now with `safeHost`.
- LIN-3995/3980 (hero doors and wordmark): byte-identical, as diffed above.
- LIN-4015 (token-only CSS): the new rules use tokens only.
- LIN-3633 (every ceiling carries its ticket): kept.

Nothing reverted is re-applied.

### Test quality and mutations (each one reverted)

Load-bearing tests go red when the code they claim to cover is removed:

| Mutation | Result |
|---|---|
| Drop the `/getting-started.md` exemption | exemption test red |
| Route uses `publicOrigin(req)` without `safeHost` | hostile-Host test red |
| Route ignores the flags | doors-follow-flags test red |
| Remove `${agentHtml}` | 5 landing tests red |
| Make `SAFE_HREF` match anything | unsafe-href test red |
| Add an unknown link to the guide | link test and both size tests red |
| Throw instead of serving the fallback | fallback test red |
| Remove the `llms.txt` section | llms test red |
| Remove the sitemap entry | sitemap test red |
| Serve `.md` as text/plain | headers test red |
| Render the block without an origin | no-origin test red |
| `server.js /` uses `requestOriginOrNull` for `agentOrigin` | unit green, **e2e hostile-Host red** |
| Remove the copy click handler | e2e clipboard test red |

One weak spot: removing `white-space: pre-wrap` / `overflow-wrap` keeps the 320px e2e green, because the `<pre>` scrolls inside itself (`overflow-x: auto`). The test proves "no page scroll", which is the criterion, but it does not prove the prompt wraps. That's a note, not a fix.

The guide-equals-hero door test builds both sides from `signInDoors`, so it cannot catch the hero and the guide drifting apart. The real guarantee is structural: `renderSignInCtas` reads `signInDoors`. I proved the hero is unchanged by the 16-combination diff, not by that test.

I also ran these checks myself:
- the `pat-session` exemption case in scratch: `/getting-started.md` and `/Getting-Started/` get zero provider reads and no session, while `/getting-started.md.bak` and `/api/getting-started` still run PAT auto-login. It passes, but it is not in the repo;
- on a running server, every link in the served guide resolves: 200, 302 to OAuth or `/`, or 401 for `/api/proxy/instructions`;
- neither guide route sets a cookie;
- the `/getting-started` inline script matches the `LIBRARY_CSP` hash.

Security: I found no new vulnerability. The HTML render escapes raw HTML and allow-lists hrefs. The `.md` route is `default-src 'none'; sandbox`. A hostile Host falls back to `harbour.cat`. No env value or secret is templated.

### Isolated, or one of a class?

The class is *"a list of the deployment's sign-in doors, or the flags that gate them"*. Its instances:
- the hero and the guide: now one source;
- `deploymentFlags()` against `server.js:1959` and `:2333`: **inside**, plan §3's bounded class (fix 1);
- the signed-out nav bar's own door list (`lib/components/navbar.js:91-120`, on `/swipe`, which path (a) sends people to): **outside**. It predates this ticket, the guide never reads it, uses its own short labels by design, and gates on the same provider predicates. Close-out files it after checking it doesn't already exist.

Second class, *"pre-sign-in pointers to the way in"*:
- `llms.txt`: done;
- the landing agent HTML comment and the README: **inside**, plan §8 (fixes 2 and 3);
- `lib/render.js:314`'s comment: the plan marked it out (authenticated pages), and I agree.

### Fixes for close-out (each one inside, plan-bounded)

1. **One flags source** (plan §3). In `server.js`, replace the inline `githubEnabled/jiraEnabled/emailEnabled/freeTierEnabled` reads in both `renderLandingPage(...)` calls (`:1959` logout, `:2333` `/`) with `...deploymentFlags()`, imported from `./routes/getting-started.js`. Or move `deploymentFlags` to `lib/components/landing-hero.js` and import it in all three places. Fix the docblock in `routes/getting-started.js` to match. The hero output must stay byte-identical, and the existing landing tests pin that.
2. **README** (plan §8). Under `### For AI Agents` in `README.md` (lines 47-51), add: `- **Agent onboarding** - A public guide at /getting-started.md (HTML at /getting-started) that a coding agent reads to set Harbour up with a person; the landing offers it as a copyable prompt`.
3. **Landing agent comment** (plan §8). In `lib/render-landing.js:510`, `htmlComment` becomes `'AI agents: to set Harbour up for a person, read /getting-started.md; for navigation see /llms.txt'`. No test pins the old string. Leave `lib/render.js:314` as it is.
4. **"Use only URLs the guide gives"** (plan §6). Add to `LANDING_AGENT_PROMPT_TEMPLATE` in `lib/prompts/agent-onboarding.js`, in the third paragraph: `Use only the addresses the guide gives you; do not guess others.` Re-measure `LANDING_AGENT_PROMPT_CEILING` and raise `FROZEN_TOTAL_BYTES` by the same delta, each with a `LIN-4085` reason.
5. **Guide content rules.** In `docs/agent-onboarding.md`:
   - in (a), add `A local workspace stays in the browser that made it; it does not follow the person to another device or browser.`;
   - in (c), add `The runner runs Claude Code only.`;
   - after the README link, add `Self-hosting needs one step only the person can do: creating a Linear OAuth app or a Linear personal token.`

   Re-measure `AGENT_ONBOARDING_SOURCE_CEILING`, `AGENT_ONBOARDING_RENDERED_CEILING` and `FROZEN_TOTAL_BYTES`, each with a `LIN-4085` reason.
6. **Drift guard for quoted labels.** In `tests/unit/agent-onboarding.test.js`, add a test asserting:
   - `renderNavBar({ isLanding: true, ... })` contains `+ local workspace`;
   - the proxy page render (`lib/render-proxy.js`) contains `title: 'Agent Prompt'`, or render it;
   - the guide still quotes both.
7. **Missing witnesses.**
   - (a) In `tests/unit/pat-session.test.js`, in the LIN-3346 public-pages test, add `'/getting-started.md', '/Getting-Started/'` to the exempt list and `'/getting-started.md.bak', '/api/getting-started'` to the negatives. I ran exactly this in scratch and it passes.
   - (b) In `tests/unit/getting-started-route.test.js`, add a test that sets sentinel values in `OPENROUTER_FREE_TIER_KEY`, `LINEAR_ACCESS_TOKEN`, `LINEAR_CLIENT_SECRET`, `GITHUB_CLIENT_SECRET` and `JIRA_CLIENT_SECRET`, serves with the default `deploymentFlags`, and asserts that neither response body contains any sentinel. Restore the env afterwards.
   - (c) In `tests/e2e/landing-agent-prompt.spec.js`, add a request test: `GET /getting-started.md` on the running server returns 200 `text/markdown; charset=utf-8`, with no `set-cookie`, and contains `${baseURL}/auth/linear`. That catches a lost mount in `server.js`, which today only the sitemap sweep catches, and only for the HTML form.

### What CI Did Not Prove

- **Cold-agent walk after the fixes (inside: Success Criterion 4, a claim this ticket depends on).** The 18:18 comment reports a walk that found four gaps, fixed in `6dacd78d`. It does not say a fresh walk passed after those fixes, and I cannot read the PR evidence.
  - Settle **after the deploy**, since the change is already live: run a fresh Claude Code session with no Harbour context, give it only the prompt copied from `https://harbour.cat/`, and record the transcript excerpt on the ticket.
  - It passes only if the session reaches either "open `/swipe` → + local workspace" or "sign in with <an enabled door>, then copy the Agent Prompt from Proxy", and uses no URL outside the guide's.
  - Redo it once fixes 4 and 5 land.
- **Production origin in the prompt and guide (inside: plan §2/§6, `publicOrigin` behind the proxy).** Tests run on plain-http localhost.
  - Settle **after the deploy**: `curl -s https://harbour.cat/ | grep -o 'https://harbour.cat/getting-started.md'` and `curl -s https://harbour.cat/getting-started.md | grep -c 'http://'` must find the https URL and report 0 `http://` links.
  - The distinguishing precondition is `trust proxy` (set at `server.js:1146`) with `X-Forwarded-Proto: https`. If `PUBLIC_ORIGIN` is set in production, that value wins and must equal `https://harbour.cat`.
- **The guide's doors on the live deployment (inside: plan §3, guide = hero for *this* deployment's flags).** Unit tests cover all 8 combinations with injected flags. Only production shows which flags are live.
  - Settle **after the deploy**: the `- [label](url)` lines in `https://harbour.cat/getting-started.md` must list the same labels and hrefs as the `landing-cta-*` buttons on `https://harbour.cat/`.
- **Guide links stay real routes (inside: plan witness 3).** The unit link check only finds string needles in the registering files. I fetched every link on a running `4f247b68` server and all resolved, so that is discharged for this commit only. Fix 7c adds a running-server guard for the `.md` route, but the other paths stay needle-checked.
- **Substitute-for-CI limits (inside: the CI gate).** My two-branch run was on one dev machine with Node 25, not in a clean environment, and not author-independent. It also does not cover anything after `4f247b68`.
  - Settle **before close**: close-out reads the GitHub check rollup for the merge commit `4f247b68` on `main` (and for the PR head `6dacd78d`). It must be green: `ci-success`, the unit job, all four E2E shards, and the secret scan.
- **Funnel effect (outside: product outcome, not a merge gate per scope).** Watch the `/kpis` "How people get started" funnel after deploy. A named monitor already exists there, and no check short of production can show visitor behaviour.
- **Rollback:** `git revert 4f247b68`. The change is reversible: it adds static pages, one landing block and one static script, with no persisted data and no migration.

### Verdict

`Needs Discussion`

One question for the person: the plan's cut to sentence 3 of what was asked ("…without the user needing to follow those steps"). The person still signs in through OAuth, connects their OpenRouter key and mints the owner runner key. Today these need the person's own browser session and consent, and no agent-callable endpoint exists for them. **My recommendation is to accept the cut (drop it, with that reason).** Agent-callable OAuth or key minting would widen what a token can do with credentials and needs its own security design. The guide's job is to put those clicks in order, and it does.

- **If accepted:** this becomes `Approve — conditional on close-out discharging the ledger`. Close-out makes fixes 1-7 above as a follow-up commit on this ticket (the PR is already merged), re-checks CI on that commit, runs the post-deploy checks, then closes.
- **If rejected:** the agent-callable steps are this ticket's work. It goes back to `plan` for that design, with fixes 1-7 still due.
