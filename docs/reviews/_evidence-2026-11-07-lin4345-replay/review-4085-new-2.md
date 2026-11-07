## Review — LIN-4085

Reviewed head `4f247b68`, the squash of PR #2221 (branch head `6dacd78d`), against `e1f75fe7`/`f0ac579c`.

CI: green on `6dacd78d` (unit, all four E2E shards, secret scan, per the 18:18 comment). Close-out re-checks it on the exact merge commit.

### What I checked

**Plan against what changed.** Every place in the plan's table landed: guide source, builder, route and server mount, the two exact `isAuthExemptPath` entries, the sitemap, `signInDoors`, the landing block with its script and CSS, `llms.txt`, source-map, size ceilings and the steady-base group. Plan-review note 4 said the public-page scan needed no new entry, and none was added. Nothing landed outside the plan's places.

There is one deviation from the plan. The plan said to reuse the Library's markdown renderer ("export it; do not copy it"). Instead, `routes/getting-started.js` has its own small `Marked` renderer. The stated reason holds. `lib/library.js`'s renderer is a single module-level instance driven by per-catalog `activeRender` state (slugger, backlinks, Library link rewriting), so it can't be called on a loose string without a refactor. The new renderer copies the two safety rules (raw HTML escaped, href allow-list). Both are tested directly with hostile input, and `LIBRARY_CSP` backs them up. I accept the deviation and it needs no action.

Staleness: `f0ac579c` is the only commit since the ticket on a referenced path. It touches `server.js`, but not the landing, `/swipe`, workspace or proxy routes.

**Regression check** (`git log -30` on each modified file):
- LIN-3346 (one auth-exemption predicate) is intact. The new paths go into the single `isAuthExemptPath`, with no second list. `guest-task-path.test.js` and `pat-session.test.js` pass.
- LIN-2010 (registry-sourced hrefs) and LIN-1892 (email gated by its predicate) both carry over into `signInDoors`.
- Hero output is unchanged. I diffed `renderSignInCtas` and `renderLandingHero` from `HEAD^` against `HEAD` over all 8 flag combinations × 3 `idPrefix` values: 0 differences.
- LIN-3692's `publicOrigin` is used with `safeHost`. No reverted change was re-applied.

**Ran it myself** on a local full server (the whole middleware stack, not the test router):
- `/getting-started.md` returns 200 `text/markdown; charset=utf-8`, `nosniff`, `no-store`, `MARKDOWN_CSP`.
- `/getting-started` returns 200 HTML under `LIBRARY_CSP`. The page's one inline script hashes to the pinned `sha256-XK9P…`.
- `/GETTING-STARTED.MD` and `/getting-started/` are served. `/getting-started.md.bak` is 404. `sitemap.xml` lists `/getting-started` only.

**The guide's path claims, checked live:**
- Signed-out `/swipe` shows "+ local workspace".
- `POST /workspace/new` returns 302 to `/workspace/local-workspace-…/` and sets a cookie. The same workspace without the cookie returns 302 to `/`. This confirms the guide's "a workspace you make with curl lives in your cookie jar" warning.
- With the cookie, `/workspace/<key>/proxy` returns 200 with the Agent Prompt section, `/workspace/<key>/runner` returns 200, and `/auth/openrouter` returns 200.

**Placement** (desktop 1280 and phone 390 screenshots). The block is the first thing under the Linear/email buttons, headed "Or hand this to your coding agent", above "The Loop". It is the only block on the page with an action. It meets the 17:43 ruling ("directly under the hero sign-in buttons, as an equal second way in"). The 320px light/dark screenshots are legible, with no sideways scroll.

**Tests and mutation checks.** I ran each mutation and reverted it. Each line says whether the tests went red.
- Dropping either exemption entry: red (exemption test).
- `publicOrigin(req)` without `safeHost` in the route: red (hostile-Host test).
- Route passing `doors: []`: red.
- Route ignoring the free-tier flag: red.
- HTML form missing `nosniff`/CSP: red.
- Href allow-list removed: red.
- Raw HTML passed through: red.
- Unknown-placeholder check removed: red.
- Design notes served: red.
- Landing block not inserted: red.
- `/landing-copy.js` not in `scripts`: red.
- Block rendered with a guessed origin when none is passed: red.
- `llms.txt` section removed: red.
- A bogus `{{BASE_URL}}/no-such-page` or `/runnr` link in the guide: red (link test).
- E2E, `server.js` using `requestOriginOrNull(req)` for `agentOrigin`: red ("hostile Host" spec).
- E2E, `landing-copy.js` copying the wrong text: red (clipboard spec).
- **Stayed green:** changing the landing prompt's fallback URL `{{BASE_URL}}/getting-started` to `{{BASE_URL}}/get-started`. The landing test's `text.includes(`${BASE}/getting-started`)` is satisfied by the `.md` URL, and the link test only scans the guide. The plan's witness (e) covered "every root-relative path in the filled guide **and in the landing prompt**". This is ledger item 2.

The `REGISTERED` table in the link test reads source, and the test says so. The live checks above cover those routes for this head.

**Isolated, or one of a class?** I found two classes.
- *Sign-in door lists decided in more than one place.* `lib/components/navbar.js` (signed-out branch) keeps its own GitHub/Jira/email decision. The guide matches the hero, as planned, and `signInDoors`' header names the navbar copy. This is **outside**: the deliverable doesn't depend on it, and plan review ruled no change. Close-out may file it as a dedupe if wanted.
- *Renders of the signed-out landing.* `server.js:1959` (`handleWorkspaceRemoval`, after the last workspace is removed) renders `renderLandingPage` without `agentOrigin`, so that landing has no agent block. This is **inside**: it is the same landing surface on a parallel path. Ledger item 3.

The authenticated Home is out of scope by the ticket (LIN-3833's card).

### What CI Did Not Prove

1. **Cold-agent walk on the final guide (Success Criterion 4).** **Inside**: the ticket's own bar. The 18:18 comment says a GET-only walk found four gaps and that they were fixed in `6dacd78d`. It does not say the walk was re-run on the fixed text (the guide grew 462 bytes after it). I can't see whether the PR carries the transcript. *Before the merge:* close-out confirms the PR records a walk against the guide as served at this head. If not, it runs one: a fresh Claude Code session given only the copied prompt, against a local server. *Pass:* the agent asks first, then reaches either the `/swipe` → "+ local workspace" instruction or "sign in with <listed door>, then copy the Agent Prompt from `/workspace/<urlKey>/proxy`". *Fail:* any URL the agent gives that is not in the guide. Then record it on the PR.
2. **Landing prompt fallback URL is not link-checked.** **Inside**: In Scope item 5 / plan witness (e). *Before the merge, close-out makes this fix:* in `tests/unit/agent-onboarding.test.js`, test "each same-origin link is a known route; the only external link is the README", change `const links = linksIn(guide);` to `const links = [...linksIn(guide), ...linksIn(renderLandingAgentPrompt({ baseUrl: BASE }))];`. I applied this temporarily: it passes on this head (22/22) and goes red on the `/get-started` mutation ("the guide links to /get-started, which no test knows how to resolve"). Reverted.
3. **Landing rendered after the last workspace is removed has no agent block** (`server.js:1959`). **Inside**: the same landing on a parallel path. The 18:18 comment says this was left out on purpose, but the reason is only on the PR. *Before the merge:* either do it here, by adding `agentOrigin: publicOrigin(res.req, { safeHost: true })` to that `renderLandingPage` call, or drop it with the reason recorded in the close-out comment. A sound reason would be: that page is a one-off response to a removal, and the next load of `/` shows the block. Filing a ticket does not discharge it.
4. **Production origin in the copied prompt and the guide.** **Inside**: the change depends on it. Locally, `publicOrigin` falls back to `req.protocol`, and the hostile-Host unit test pins `http://harbour.cat`. Production relies on `PUBLIC_ORIGIN` or `trust proxy` (set, `server.js:1146`), the same machinery the Library's canonical tags already use. *After the deploy:* `curl -s https://harbour.cat/getting-started.md` and the `/` block's `<pre>` must both carry `https://harbour.cat/...` links. An `http://` link or another host is wrong.
5. **Copy button outside Chromium** (the e2e runs one browser; the filer was on Android Chrome). **Inside**: Success Criterion 1, "a working copy button". Not run, because I had no Safari, Firefox or real-phone browser here. *After the deploy:* on a phone, open `https://harbour.cat/`, tap "Copy prompt" and paste into a note. Pass: the pasted text equals the block. Acceptable fallback: the label reads "Selected: press Ctrl/Cmd+C" and the text is selected. *Rollback:* revert `4f247b68`. It is reversible: no migration, nothing persisted, and the guide is built per request.
6. **Funnel effect.** **Inside**: Success Criteria, explicitly not a merge gate. *After the deploy:* read the `/kpis` "How people get started" funnel a week after release. Only real visitors over time can show whether first Go presses move off 0. This is a reading, not a gate on closing.

### Verdict

`Approve — conditional on close-out discharging the ledger`

How the work meets what was asked, sentence by sentence:
- **"on the homepage the getting started section … like an npm install command … a prompt that the person passes to their agent".** Met. The scoping comment corrected the premise: production had no such section, so the work adds one. The block sits directly under the sign-in buttons, styled like the terminal glimpses, with a copy button and selectable `<pre>` text when JS is off.
- **"a couple of paragraphs explaining the situation and linking to harbour.cat/getting-started, which walks an agent through onboarding the project and the user".** Met. The prompt is three paragraphs. It points at `<origin>/getting-started.md` (harbour.cat in production) with `/getting-started` as the fallback for people. The guide walks through the paths.
- **"the human naturally uses the agent to interact with Harbour, which is a good first step".** Met. The prompt is written for the agent and in the person's voice.
- **"the agent can read the guide and decide whether to have a conversation with the user or review the repositories and the settings".** Met. "Ask or look first" offers both, and the guide forbids starting a path the person has not agreed to.
- **"essentially a full guide on how to properly configure Harbour for whatever your situation is, without the user needing to follow those steps".** Met. The guide routes each situation:
  - just looking: a local workspace;
  - a real tracker: the listed doors, then the Proxy Agent Prompt;
  - own machine: the runner page;
  - self-host: the README.

  It hands off to the existing agent-facing surfaces rather than duplicating them. It names the few steps only the person can take (OAuth, the OpenRouter key, the owner runner key) and leaves the rest to the agent.

Nothing in the ask is narrowed. Close-out makes fix 2, settles items 1 and 3 before merging, and records 4–6 as post-deploy steps.
