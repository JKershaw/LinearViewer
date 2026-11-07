## Review — LIN-4085

Reviewed head `4f247b68`. This is the squash of PR #2221 and it is **already on `main`**: it merged at 18:33, after the 18:18 "waits on review" comment. It contains `6dacd78d` plus a later commit, "test the landing's validated origin and the guide renderer's safety for real (review findings 1-2)". So a review happened on the PR, but nothing about it reached this ticket. The diff I reviewed is `f0ac579c..4f247b68`: 19 files, +1162/−24. Because the work has already merged, every fix below lands as a follow-up commit under LIN-4085. Every ledger item becomes a check on `main`, not a gate on a merge.

CI: a workflow exists (`.github/workflows/test.yml`), but I could not read the checks from here. The implementer reported green on `6dacd78d` only. Nothing in this ticket shows CI on the merged head `4f247b68`, and that head has one more commit. I could not run the unit suite locally either: the clone has no `node_modules`, and installing it needs the network. Close-out re-checks CI on `4f247b68` and on the fix commit.

### What was built, against the plan

Delivered as planned:
- **`signInDoors()`.** The hero and the guide both read it, and the hero markup is unchanged.
- **The guide.** `docs/agent-onboarding.md` plus `lib/prompts/agent-onboarding.js`. It serves only the text after the first `---`, refuses an unknown placeholder, and falls back to a short text that is not cached.
- **Both routes.** They live in their own router and set `nosniff`, `no-store` and the right CSP on each form.
- **The auth exemption.** `isAuthExemptPath` gains two exact paths.
- **The landing block.** It sits first in `<main>`, gets its copy button from a static `public/landing-copy.js`, uses its own classes rather than the `.prompt-copy` handler that mints tokens, and is left out when there is no origin.
- **The `/llms.txt` entry and the sitemap entry.**
- **Three size ceilings.** Each has its LIN-4085 reason, the frozen total rises by their sum, and the matcher count is `+5 +3 +1`. I measured them: the source is 4669 bytes and the landing prompt is 584.
- **A source-map entry.**
- **Unit tests and e2e.** The e2e covers 320px in light and dark, the copy button, no-JS, and a hostile Host header.

**The plan in the description is out of date.** It names `requestOriginOrNull`, `public/landing-agent-prompt.js` and a `renderButton` copy button. The plan that plan-review approved (the 17:42 comment and the 17:45 verdict), and the code that was built, use `publicOrigin(req, { safeHost: true })`, `public/landing-copy.js` and a button that JS adds. I accept those three differences because plan-review approved them. The plan items below were in the description and are missing from the code. Plan-review did not drop any of them.

### Regression check
`git log -30` on each changed file shows that LIN-3980/3995 (landing wording, sign-in doors), LIN-4015 (CSS tokens), LIN-3346 (one exemption list), LIN-3692 (one origin source) and LIN-3633 (every ceiling carries its ticket) all still hold:
- the new CSS uses only `style.css` tokens;
- there is still one exemption list;
- the origin comes from `publicOrigin`;
- every ceiling line names LIN-4085.

No commit is reverted or re-applied.

### Gap analysis (plan items not done)
1. **The landing's agent HTML comment** still reads only `AI agents: see /llms.txt …` (`lib/render-landing.js:510`). Plan item 8 counts this pointer as half of the cause ("names no way in").
2. **The README "For AI Agents" bullet is missing** (`README.md:47`, plan item 8).
3. **The block has no plain link to `/getting-started` for people** (plan item 6).
4. **The landing prompt never tells the agent to use only the URLs the guide gives** (plan item 6). Success Criterion 4, "without inventing URLs", depends on that line.
5. **There is no shared flags function** (plan item 3). `deploymentFlags()` in `routes/getting-started.js` is a third copy of the four predicates. `server.js:2333` (`/`) and `server.js:1959` (logout) still inline them.
6. **Guide content rules that are missing:**
   - path (a) does not say a local workspace stays in the browser that made it;
   - path (b) does not tell the person to pick the smallest scope and press *generate & copy*;
   - path (c) does not say the runner is Claude Code only.

   Each label checked against `lib/render-proxy.js:47-58` and `lib/render-runner-setup.js:75`.
7. **"The guide quotes no UI label that isn't filled from source or checked by a test."** The labels "+ local workspace" (`lib/components/navbar.js:109`) and "Agent Prompt" are quoted but not checked anywhere. The README URL `https://github.com/JKershaw/LinearViewer` is typed by hand, not taken from the repo constant (`lib/library.js:34` `GITHUB_BASE`).
8. **`/getting-started` (HTML) has neither the Local CTA nor a link to the `.md`** (plan item 4). Instead the guide sends the person to `/swipe` and its "+ local workspace" nav form. I checked that this path works signed out: `server.js:2346-2361` renders the preview, and `navbar.js:107-110` posts to `/workspace/new`. **I accept the change of route** if close-out pins the label with a test (fix 7). The link to the `.md` is still owed.
9. **Planned witnesses that are missing:**
   - a PAT-session case for the new paths;
   - the sentinel-secret test (the current test runs `scanText` with no secret values set, so it only shows that nothing shaped like a secret appears);
   - `/getting-started` in `BASE_PUBLIC_PAGES`. Plan-review said this adds little, but nobody recorded the drop.

### Isolated, or one of a class?
I found two classes:
- **Pointers to the way in before sign-in.** Siblings: the landing HTML comment (inside: gap 1), the README (inside: gap 2), and `BASE_PUBLIC_PAGES` (inside: gap 9). `lib/render.js:314` is outside, because it is on signed-in pages, as the plan says.
- **Sign-in door predicates repeated.** `server.js` `/` and logout are inside (gap 5). The signed-out nav bar's own door list (`navbar.js:91-120`) is inside the same class. Plan-review gave a reason to leave it (ledger item 7).

### Test quality
The test levels fit the change: e2e for the landing UI, real-router unit tests bound to 127.0.0.1 for the routes, and unit tests for the pure module.

**Mutation checks.** I ran these on scratch copies, because the full suite cannot run here:
- deleting the `/getting-started.md` exemption turns the exemption test red;
- making it a prefix match turns the lookalike test red (`/getting-started.md.bak`);
- disabling the unknown-placeholder throw turns the refusal test red;
- serving the whole file with no cut turns the design-notes test red.

**One check I worked through by reading only:** if `guideFor` in `routes/getting-started.js` ignored the flags (`signInDoors({})`), every test would stay green. The `ALL_DOORS` route test asserts only headers and the title. The per-combination test in `agent-onboarding.test.js` builds both sides from `signInDoors`, so it never touches the route's wiring (fix 6).

**Not run:** the e2e suite, and viewing the attached 320px and desktop screenshots.

**Security:** exact exemptions; the origin is validated (a hostile Host falls back); the HTML renderer escapes raw HTML and only allows safe link targets; neither route serves a token. Nothing new found.

### Fixes for close-out (make each in a follow-up commit under LIN-4085)
1. `lib/render-landing.js:510`: change `htmlComment` to `'AI agents: to onboard a person, read /getting-started.md; see /llms.txt for navigation guidance'`. Add an assertion in `tests/unit/landing-agent-prompt.test.js` that the landing HTML comment contains `/getting-started.md`.
2. `README.md`, under "### For AI Agents": add `- **Onboarding guide** - A coding agent setting Harbour up for a person starts at /getting-started.md (public, no session)`.
3. `renderAgentPromptSection` (`lib/render-landing.js`): after the terminal `<div>`, add `<p class="lx-section__lede"><a href="/getting-started">Read the guide yourself</a></p>`, reusing an existing class. Add a unit assertion that the block contains `href="/getting-started"`.
4. `LANDING_AGENT_PROMPT_TEMPLATE` (`lib/prompts/agent-onboarding.js`): end paragraph 2 with `Use only the addresses the guide gives you; do not guess others.` Re-measure `LANDING_AGENT_PROMPT_CEILING`, raise `FROZEN_TOTAL_BYTES` by the same amount, and give the reason as LIN-4085 review.
5. `server.js:1959` and `server.js:2333`: replace the four inline predicate arguments with `...deploymentFlags()`, imported from `./routes/getting-started.js`. The output must stay the same.
6. `tests/unit/getting-started-route.test.js`: add a test that serves `ALL_DOORS` and asserts the `.md` body contains:
   - `${base}/auth/github`;
   - the Jira door's `getProvider('jira').entryCta.href` on the request origin;
   - `${base}/auth/email`;
   - `This deployment has a free tier`.
7. `tests/unit/agent-onboarding.test.js`: pin every label the guide quotes to the source that renders it:
   - `read('lib/components/navbar.js')` contains `>+ local workspace</button>`;
   - `read('lib/render-proxy.js')` contains `title: 'Agent Prompt'` and `generate &amp; copy`;
   - `GITHUB_BASE` (from `lib/library.js`) starts with the guide's README URL followed by `/`.
8. `docs/agent-onboarding.md`:
   - path (a): add "Tell the person a local workspace stays in the browser that made it; it does not follow them to another browser or device.";
   - path (a) and path (b) step 2: replace "copy the Agent Prompt there" with "pick the smallest scope that does the job, press "generate & copy" under Agent Prompt, and paste the result to you";
   - path (c): add "The runner runs Claude Code only.";
   - re-measure both guide ceilings and the total, with their reason.
9. `routes/getting-started.js`, HTML route: after the article, add `<p><a href="/getting-started.md">This guide as plain markdown</a></p>`. Assert it in the HTML route test.
10. `tests/unit/pat-session.test.js:317`: add `'/getting-started'` and `'/getting-started.md'` to the public-path list.
11. Sentinel-secret test: in `tests/unit/getting-started-route.test.js` and `tests/unit/landing-agent-prompt.test.js`, set sentinel values in `OPENROUTER_FREE_TIER_KEY`, `LINEAR_ACCESS_TOKEN`, `LINEAR_CLIENT_SECRET` and `GITHUB_CLIENT_SECRET`, render or request both guide forms and the landing block, and assert that no sentinel appears. Restore the environment afterwards.
12. `lib/scan-public-pages.js:21`: add `'/getting-started'` to `BASE_PUBLIC_PAGES`.
13. `tests/e2e/landing-agent-prompt.spec.js`: add a request-level test against the real server. `GET /getting-started.md` should return 200 with `content-type: text/markdown; charset=utf-8` and CSP `default-src 'none'; sandbox`. Today the mount and the middleware chain are only exercised for the HTML form, through the sitemap sweep.

### What CI Did Not Prove
1. **The cold-agent walk on the final guide.** *Inside* (Success Criterion 4). The walk recorded on the PR ran on the guide *before* its four fixes. It was not run again on `4f247b68`, or after fixes 4 and 8. **Before close:** a fresh Claude Code session with no Harbour context gets only the prompt copied from `/` on a running build of the fixed head. It passes if it reaches "press *+ local workspace* on `/swipe`" or "sign in with <an enabled door>, then copy the Agent Prompt from `/workspace/<urlKey>/proxy`". It fails if it fetches or quotes any URL the guide does not give. Record an excerpt here.
2. **Path (a) end to end, as a person.** *Inside* (the guide's own claim). **Before close:**
   - in a signed-out browser, open `/swipe` and press "+ local workspace";
   - the workspace opens;
   - `/workspace/<key>/proxy` shows Agent Prompt;
   - *generate & copy* returns a prompt with a token.

   It fails on a 401, a redirect to sign-in, or a missing Agent Prompt section for a new local workspace. The parts are tested on their own (`tests/e2e/proxy-local.spec.js`), but nothing tests them chained.
3. **CI on the merged head.** *Inside.* Green was reported only on `6dacd78d`, and `4f247b68` has one more commit. **Before close:** close-out reads CI for `4f247b68` and for the fix commit. Any red is this ticket's.
4. **The live origin and headers.** *Inside* (Success Criteria 1-2). **After deploy:**
   - the block on `https://harbour.cat/` reads `https://harbour.cat/getting-started.md`, with `https` and not `http`;
   - a signed-out `GET https://harbour.cat/getting-started.md` returns 200 `text/markdown` with no `Set-Cookie`;
   - `/getting-started` renders with no CSP violations in the console.

   This depends on `PUBLIC_ORIGIN` or `trust proxy` in production. CI cannot reach that.
5. **The copy button outside desktop Chromium.** *Inside* (Success Criterion 1, "working copy button"; the ticket came from Android Chrome). **After deploy:** on Android Chrome and iOS Safari, pressing "Copy prompt" shows "Copied" and pasting gives the whole prompt. When the clipboard API refuses, it shows "Selected: press Ctrl/Cmd+C" and the prompt is selected. The e2e covers only Chromium with clipboard permission granted.
6. **Placement reads as an equal second way in.** *Inside* (the 17:43 ruling). **Before close:** a person looks at the 320px and desktop screenshots the e2e attaches, in light and dark. It fails if the block reads as the start of the showcase. The fix then is to move it inside `.landing-hero`, after `.landing-ctas`, as plan-review note 5 says.
7. **The signed-out nav bar's own door list** (`lib/components/navbar.js:91-120`). *Inside* (the "one door list" class). **Route:** drop it, with plan-review note 2's reason recorded at close: it has different labels ("Sign in →", "GitHub →"), it matches the gating today, and the guide quotes only its "+ local workspace" button, which fix 7 pins.
8. **Whether people start.** *Inside* (Success Criteria, after it ships). **Monitor:** the "How people get started" funnel on `/kpis`, first Go presses over 30 days. It was 0 before. Only production traffic can show this, so it is not a merge gate.

### Verdict
How the work meets each sentence of `## As asked`:
- **"on the homepage the getting started section … like an npm install command … a prompt that the person passes to their agent".** Met by the new block under the hero buttons. Production had no such section, so a new block in that place is what was asked (the plan's "not a cut").
- **"a couple of paragraphs explaining the situation and linking to harbour.cat/getting-started".** Met: three paragraphs that link to `/getting-started.md` and `/getting-started`.
- **"a page which walks an agent through onboarding project and the user to Harbour".** Met by the guide, pending ledger item 1.
- **"the human naturally uses the agent to interact with Harbour".** Met.
- **"it can decide whether to have a conversation with the user or review the repositories and the settings".** Met by the guide's "Ask or look first" section.
- **"a full guide on how to properly configure Harbour for whatever your situation is without the user needing to follow those steps".** **Met in part.** The person still signs in (OAuth), connects an OpenRouter key and mints the owner runner key. The plan listed this as a cut that "needs a ruling and is unagreed until answered". I could not query the rulings endpoint from here. No comment in this ticket answers the cut, and the only recorded ruling is the one on prominence. Until a person agrees, this sentence is narrowed without agreement.

`Needs Discussion`

One question for John: **accept the cut?** The guide puts the person's few clicks in order rather than removing them. *Recommendation: accept.* Agent-callable versions of OAuth, the OpenRouter key and the runner-key mint would widen what a token can do with credentials, and would need their own security review.
- **If accepted:** this becomes `Approve — conditional on close-out discharging the ledger`. Close-out makes fixes 1-13 and settles items 1-8.
- **If he wants those steps done here:** this goes back to `plan`.
