## Review — LIN-4085

Reviewed head `4f247b68` (the squash of PR #2221 on `main`). The implementation comment names `6dacd78d`, but the squash also contains a third commit, "test the landing's validated origin and the guide renderer's safety for real". I diffed `4f247b68~1..4f247b68` and it matches the PR diff byte for byte: 19 files, +1162/−24.

**Process note first:** PR #2221 was **merged to `main` on 2026-11-01 18:33**, before this review ran, and the ticket is still In Progress. So none of the fixes below can go on the PR branch. Close-out has to land them as a follow-up commit on `main`. The rollback is named in the ledger.

CI: not confirmed by this review. CI is configured (`.github/workflows/test.yml`: unit, 4 E2E shards, `ci-success`). The implementation reported it green on `6dacd78d`. Nothing on the ticket shows the final PR head or `main@4f247b68`, and I had no network to read the rollup. I also couldn't run the suite locally: the clone has no `node_modules`, and `npm ci` needs the network. Close-out must read `ci-success` on `4f247b68`.

### Re-ground / regression check
- The plan was written at `e1f75fe7`, and the PR's base is `f0ac579c` (LIN-4070). LIN-4070 touched `server.js` but not the `/` handler, the logout render or the auth middleware, so the plan's line references still hold.
- `git log -8` on each modified file turned up no reverted change being re-applied. The constraints still hold:
  - LIN-3346: one exemption predicate. Two exact entries were added to `isAuthExemptPath`, which `lib/pat-session.js:42` and `server.js:1586` both call.
  - LIN-3692: the origin comes only from `publicOrigin`, and responses are no-store.
  - LIN-4015: `landing.css` uses only tokens, and `--text`, `--card`, `--line`, `--brand` and `--space-*` all exist in `style.css`.
  - LIN-3995: the hero is still built by `renderSignInCtas`, now from `signInDoors()`.
- One constraint is **not** followed: LIN-3980's "every button is `renderButton`" (finding 6).

### Scope recorded vs. what changed on disk
Delivered as planned:
- the guide doc and its module
- `signInDoors()`
- the router, its mount and the two exact exemptions
- the sitemap entry
- the landing block and its static copy script
- the `llms.txt` entry
- the three size ceilings, with the matcher moved to `+5+3+1`
- source-map entries

Small file overruns: `scripts/steady-base-growth.mjs` (new group) and `tests/unit/library.test.js` (sitemap count). Both are mechanical consequences of the change and fine.

Plan items not delivered, or delivered differently:
1. **Plan step 3, one flags function.** The plan wanted one function returning the door flags, called by `/`, the logout render and the guide. Instead, `deploymentFlags()` lives in `routes/getting-started.js` and `server.js:1959` and `:2333` still repeat the four predicates inline. That is the third copy the plan set out to prevent.
2. **Plan steps 4 and 6, the Local door.** The plan put the Local CTA (`renderLocalWorkspaceCta()`) on `/getting-started` and took the guide's label from `LOCAL_WORKSPACE_FORM.submitLabel`. Instead, the guide sends the person to `/swipe` and its nav button "+ local workspace". That label is hand-typed in the guide and no test checks it, which breaks the plan's rule that "the guide quotes no UI label that isn't filled from source or checked by a test". "Agent Prompt" is also quoted without a check. Plan-review confirmed the `/swipe` path works, so I accept the change of door, provided the labels get pinned (fix 2).
3. **Plan step 6, the landing block.** The "one plain link to `/getting-started` for people" is missing. The prompt also doesn't say "use only URLs the guide gives", one of its four content rules and the thing the "without inventing URLs" success criterion depends on.
4. **Plan step 8, pointers.** The landing's agent HTML comment still names only `/llms.txt` (`render-landing.js:510`). The plan counted that comment as half of the pointer fix. The README "For AI Agents" bullet is also missing. Dropping `BASE_PUBLIC_PAGES` is acceptable: plan-review note 4 said it adds little because those pages carry no scripts.
5. **Witnesses.**
   - The PAT-session case is missing. It's low risk, since PAT calls the same predicate the new unit test pins directly.
   - The plan wanted concrete guide links fetched by e2e against the running app. Only `/getting-started` is fetched that way (by the sitemap sweep). `/getting-started.md` is never fetched from the real server with the full middleware stack.
   - The route test doesn't check "no redirect for a session holding workspaces". The router has no session logic, so I accept that gap.
6. **Wording that differs from the plan.** The prompt doesn't reuse `HARBOUR_PLAIN_SENTENCE`. That sentence is written to the visitor ("reads your backlog"), and the prompt speaks in the person's voice to their agent, so the implementer's wording is a fair call. Not a fix.

### Isolated, or one of a class?
The class is *what a visitor or a cold agent is told about the way in before sign-in*, plus *which sign-in doors this deployment offers*.
- **Logout render** (`server.js:1959`, the landing a person sees after signing out of their last workspace): no agent block. The plan dropped it because that render "has no request origin", but `req` is in scope there and `publicOrigin(req, { safeHost: true })` never returns null, so the reason no longer holds. **Inside:** it is the same landing render that research/plan bounded. Ledger item below.
- **Door flags decided in four places:** `server.js:1959`, `server.js:2333`, `deploymentFlags()` and `navbar.js:91-104`. The two `server.js` copies are **inside**: plan step 3 bounded them. The navbar copy is **outside**: plan-review note 2 kept it on purpose and it is documented in the `signInDoors` header comment. No follow-up is needed unless the team wants one.
- **README "For AI Agents" and the landing HTML comment:** **inside** (plan step 8). They are fixes 4 and 5 below.
- **`lib/render.js:314` comment, the "try it yourself" block, the authenticated Home card:** **outside**, per the plan's table and the scope.

### Test quality and mutation check
Tests are at the right levels:
- unit tests for the module, the router (bound to 127.0.0.1), the predicate, the landing render, `llms.txt` and the sizes;
- e2e tests on the real server for placement, the clipboard, 320px in light and dark, no JS, and a hostile Host on `/`.

**The mutation check was not run.** I couldn't execute any test: there is no `node_modules` and no network to install it. Reading the code, these mutations should each go red: deleting the two `isAuthExemptPath` lines, dropping `${agentHtml}`, removing `res.set('Content-Security-Policy', MARKDOWN_CSP)`, removing the `SAFE_HREF` test in `renderGuideHtml`, and passing `requestOriginOrNull(req)` as `agentOrigin`. The commit message says the last two were checked red.

One weak test: the door-drift test compares the guide with `signInDoors()`, and both read the same list, so it guards the template rather than drift. That is acceptable, because the hero is built from the same list.

Checklist:
- Security is fine: the guide is static text plus a validated origin, raw HTML is escaped, link targets are allow-listed, the copy script is static with no CSP change, it avoids the token-minting `.prompt-copy` hook, and secret scans run on both texts.
- Errors are handled: an unreadable file serves an uncached fallback, an unknown placeholder throws, and a null origin leaves the block out.
- Performance is fine: one ~4 KB `marked` parse per HTML request.
- Style: one deviation, the hand-styled button (fix 6).

### Fixes for close-out (on `main`, one follow-up commit; all inside this ticket's plan)
1. **`server.js`:** import `deploymentFlags` from `./routes/getting-started.js` next to `createGettingStartedRouter`.
   - In the `/` handler (`:2333`), replace the four inline args `githubEnabled: …, jiraEnabled: …, emailEnabled: …, freeTierEnabled: …` with `...deploymentFlags()`.
   - At the logout render (`:1959`), do the same, and also pass `agentOrigin: publicOrigin(req, { safeHost: true })`.
   - Add a unit assertion in `tests/unit/landing-agent-prompt.test.js` that `server.js` has no `entryCta.isConfigured()` left in either `renderLandingPage(` call.
2. **`tests/unit/agent-onboarding.test.js`:** add a test that pins each UI label the guide quotes to where it comes from.
   - The guide contains `"+ local workspace"`, and `lib/components/navbar.js` contains `>+ local workspace</button>`.
   - The guide contains `Agent Prompt`, and `lib/render-proxy.js` contains `title: 'Agent Prompt'`.
3. **`lib/prompts/agent-onboarding.js` `LANDING_AGENT_PROMPT_TEMPLATE`:** append to paragraph 1: `Use only the addresses the guide gives you; do not guess others.`
   - Re-measure and raise `LANDING_AGENT_PROMPT_CEILING` (584) and `FROZEN_TOTAL_BYTES` by the same delta, with a `LIN-4085` reason beside each.
   - Assert the sentence in the landing-prompt unit test.
4. **`lib/render-landing.js` `renderAgentPromptSection`:** add the plain link for people inside the existing lede, with no new class: `… setting up Harbour with you. <a href="/getting-started">Read the guide yourself</a>.`
   - Assert `href="/getting-started"` in the block test.
5. **Pointers:**
   - In `lib/render-landing.js:510`, change `htmlComment` to `'AI agents: to onboard a person, read /getting-started.md; for navigation, see /llms.txt'`. Leave `lib/render.js:314` alone, because those pages are signed in.
   - In `README.md` under "### For AI Agents", add `- **Onboarding guide** - \`/getting-started.md\` (public): what a coding agent reads to set Harbour up with a person`.
6. **Copy button, for the LIN-3980 button idiom:** in `public/landing-copy.js`, set `button.className = 'btn lx-agent__copy'`. In `public/landing.css`, reduce `.lx-agent__copy` to its layout (`display`, `margin`) and drop the colour, border, radius, font, hover and focus rules that `.btn` and the global focus ring already provide.
7. **Witnesses:**
   - Add `'/getting-started.md'` to the path list at `tests/unit/pat-session.test.js:317`.
   - In `tests/e2e/landing-agent-prompt.spec.js`, add a signed-out `request.get('/getting-started.md')` against the real server, asserting 200, `content-type` `text/markdown; charset=utf-8`, and that the body contains `${baseURL}/auth/linear` and no `{{`.
   - Run the mutations listed above, red then reverted, and record them on the follow-up.

### What CI Did Not Prove
- **Cold-agent walk on the merged guide.** **Inside**: it is the success criterion "reaches the Local door or a correct sign-in → Proxy Agent Prompt instruction, without inventing URLs". The only walk ran *before* the four guide fixes, and nothing on the ticket shows a re-walk; I can't see the PR description offline. Settle **before close**:
  - Setup: a fresh Claude Code session with no Harbour context, given only the prompt copied from `/` on `npm start` (localhost) at `main` after fix 3.
  - Pass: the agent asks first, then ends at either "open `/swipe`, press + local workspace" or "sign in with <an enabled door>, then copy the Agent Prompt from `/workspace/<urlKey>/proxy`", and every URL it uses appears in the guide.
  - Fail: any URL the guide doesn't contain, or a `POST /workspace/new` made by the agent itself.
  - Record it on the ticket.
- **Placement reads as an equal second way in** (the 2026-11-01 17:43 ruling). **Inside.** It's subjective and I couldn't render the page. The block uses the showcase's own `lx-section` / eyebrow / `h2` styling, which is exactly what plan-review note 5 warned could read as "the start of the showcase". Settle **before close**: John looks at `/` at 320px and 1280px, or at the e2e screenshot attachments `agent-prompt-320-*` and `agent-prompt-desktop-*`. If it reads as secondary, the fix is plan-review's: move `${agentHtml}` inside `.landing-hero`, after `.landing-ctas`.
- **The `.md` route on the real server, signed out.** **Inside**: it's the success criterion "GET /getting-started.md returns 200 text/markdown with no auth". Only the router in isolation is tested. Settled by the e2e in fix 7 **before close**.
- **Logout landing omits the block.** **Inside**: same landing render, and the plan's reason for leaving it out is stale. Settled by fix 1. Repro: sign in with one workspace, remove it or log out so the session is destroyed, and confirm the rendered landing contains `data-testid="landing-agent-prompt"`.
- **Live origin on harbour.cat.** **Inside**: the prompt and guide must carry `https://harbour.cat`, not `http://` and not an internal host. It depends on `PUBLIC_ORIGIN` or `trust proxy` in production, which CI cannot reach. **After the deploy:**
  - signed out, `curl -s https://harbour.cat/getting-started.md` returns 200 `text/markdown` and contains `https://harbour.cat/auth/linear`;
  - `/` shows `https://harbour.cat/getting-started.md` in the block;
  - `/llms.txt` contains `/getting-started.md`.
- **Mutation checks and the unit/e2e suite were not run by review.** **Inside**, because they are review's own witnesses. No `node_modules` and no network. Close-out runs them as part of fix 7 and confirms `ci-success` on the exact commit it closes.
- **Funnel effect.** **Outside** the merge and close conditions; the scope calls it "not a merge gate". **Named monitor:** the `/kpis` "How people get started" funnel (first Go presses, 0 over the 30 days before). Only production traffic can show whether the prompt moves it.
- **Rollback, named:** `git revert 4f247b68`. It's fully reversible: no migration, no persisted data, and only static files and stateless routes. Revert the close-out follow-up commit first if it has landed.

### Verdict
Each sentence of `## As asked`, in order:
1. *"on the homepage the getting started section … like an npm install command we can have a prompt that the person passes to their agent"*: **met**. The block sits directly under the hero sign-in buttons, styled like a terminal, with a copy button (`renderAgentPromptSection`, `public/landing-copy.js`). Without JS it is selectable text.
2. *"a couple of paragraphs explaining the situation and linking to a harbour.cat/getting-started page which walks an agent through onboarding project and the user"*: **met**. The prompt is three short paragraphs (584 B). It points at `<origin>/getting-started.md`, and the guide is served there and at `/getting-started`.
3. *"Because it's instruction for an agent the human naturally uses the agent to interact with Harbour"*: **met**. The prompt is written in the person's voice to their agent.
4. *"the agent … can decide whether to have a conversation with the user or review the repositories and the settings"*: **met**. The guide's "Ask or look first" section offers both, and says "Do not start a path the person has not agreed to."
5. *"a full guide on how to properly configure Harbour for whatever your situation is without the user needing to follow those steps"*: **met in part**.
   - Covered: paths (a) Local, (b) real tracker and (c) runner, a self-host pointer, and configuration after entry delegated to the Proxy Agent Prompt and `/api/proxy/instructions`.
   - Not covered: the human still does OAuth sign-in, the OpenRouter key, the owner runner key and Settings changes. The plan recorded this as a cut that "needs a ruling and is unagreed until answered", and no ruling or comment from the person agrees to it. Prior comments rule only on prominence. I couldn't query the rulings endpoint offline.
   - The plan says that rejecting the cut "means filing that ticket". Under LIN-2825 a narrowing the person rejects becomes this ticket's scope, so the honest options are "accept" or "do it here".

If the cut is accepted, the verdict becomes **Approve — conditional on close-out discharging the ledger**, with fixes 1–7.

Needs Discussion
