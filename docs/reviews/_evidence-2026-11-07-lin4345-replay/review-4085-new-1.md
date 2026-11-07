## Review — LIN-4085

Reviewed head `4f247b68`, the squash of PR #2221 (branch head `6dacd78d`), against base `f0ac579c`.

CI: green on `6dacd78d` per the 18:18 implementation comment (unit, all four E2E shards, secret scan). I also re-ran the five new or changed unit files plus `landing-hero.test.js` locally: 101/101 pass.

### Scope against plan

The diff touches the plan's places and no others: the guide doc, builder, route, `isAuthExemptPath`, `sitemapEntries`, the `signInDoors` extraction, the landing block, `landing-copy.js` and its CSS, `llms.txt`, source-map, steady-base `GROUPS` and the size ceilings. Nothing goes past the plan. One deviation:

- **HTML renderer.** The plan said to reuse the Library's markdown renderer ("if not exported in a usable form, export it; do not copy it"). Instead, `routes/getting-started.js` defines its own small `Marked` instance. Its stated reason holds up: `lib/library.js`'s renderer is bound to per-parse catalog state (`activeRender`, `resolveLinkHref`) and can't be called on a document that isn't in the catalog. The new renderer is not a copy. It escapes raw HTML, allow-lists link schemes, and is tested directly with hostile input (`javascript:`, mixed case, `data:`, `vbscript:`, `//host`). I accept the deviation and it needs no follow-up.

The plan-review notes were all handled. The block uses its own classes, not `.prompt-copy`, and `signInDoors`' header names the navbar copy instead of claiming to be "the one place". Door links are full URLs. The secret check uses `lib/secret-scan`. Both routes set `nosniff` and `no-store` themselves, and the md/HTML CSP split is pinned in a test.

### Regression check

I ran `git log` on every modified file.
- `landing-hero.js` (LIN-3980, LIN-3995 wordmark doors, LIN-2010 registry hrefs): I rendered `renderSignInCtas` at HEAD^ and at HEAD for all 8 flag combinations, and the output is **byte-identical**. The registry-sourced hrefs (LIN-2010) are kept inside `signInDoors`.
- `guest-task-path.js` (LIN-3346, one public-path exemption): the change adds two exact entries to that one helper, with no second list. The shape of LIN-3346's fix is intact.
- `routes/library.js` / `public-origin.js` (LIN-3692): the new route uses `publicOrigin(req, { safeHost: true })` as LIN-3692 intended.
- `landing.css` (LIN-4015, one token set): the new rules only use tokens that exist (`--card`, `--line`, `--brand`, `--text`, `--space-3/4`).
- `prompt-size-budget.test.js` (LIN-4021): I measured the three new ceilings at HEAD. Source is 4669, rendered is 3691 (largest of the 16 combinations: all doors, no free tier) and the landing prompt is 584. All three match exactly, and `FROZEN_TOTAL_BYTES` rises by exactly their sum (+8944).

No reverted change is re-applied, and no earlier fix is undone.

### Manual verification (local server, `NODE_ENV=test`, real `server.js`)

- `GET /getting-started.md`: 200, `text/markdown; charset=utf-8`, `default-src 'none'; sandbox`, `nosniff`, `no-store`, no cookie needed. `/Getting-Started.md/` also works. `GET /getting-started`: 200 HTML under `LIBRARY_CSP`, with no console or CSP errors and no overflow at 390px. Both are mounted and reachable through the full middleware chain, not just the bare-router unit tests. `sitemap.xml` lists `/getting-started` and does not list `.md`.
- Doors and free tier: with Jira and email configured, the guide lists exactly Linear, Jira and email. Free tier off gives the "own OpenRouter key" sentence, and `OPENROUTER_FREE_TIER_KEY` set gives "has a free tier". So the live `deploymentFlags()` wiring is right.
- Every absolute URL in the served guide resolves. `/swipe` is 200 and its signed-out nav has the "+ local workspace" form. `/library` and `/llms.txt` are 200. `/auth/linear` and `/auth/jira/oauth?mode=new` 302 to the providers, `/auth/email` is 200, `/api/proxy/instructions` is 401 (the guide says it needs a token) and `/auth/openrouter` 302s to `/` when signed out.
- Path (a) end to end, in one cookie jar: `POST /workspace/new` led to `/workspace/local-workspace-…/`. Its `/proxy` page is 200 and shows "Agent Prompt", and `/runner` is 200. So "the person creates it, then copies the Proxy Agent Prompt" is a path that works.
- Landing, in Playwright at 320×1100 and 1280×1000, light and dark: the block sits directly under "Log in with Linear" and reads as a second way in, not as the start of the showcase, which meets the 17:43 ruling. Page overflow is 0 in all four views, with no console errors. Clicking "Copy prompt" put the prompt on the clipboard.
- Origin: a malformed Host (`evil.example/<x>`) falls back to `http://harbour.cat` on `/`. With `PUBLIC_ORIGIN=https://harbour.cat`, a forged well-formed Host never appears on `/` or in `/getting-started.md`. Without `PUBLIC_ORIGIN`, a **well-formed** forged Host (`Host: evil.example`) *is* reflected into the prompt and the guide. That is how `safeHost` works by design: it validates format, not identity. `/` is `private, no-store` and the guide routes are `no-store`, so this is a reflection into the attacker's own response, with no cache-poisoning path. It is safe only where `PUBLIC_ORIGIN` is set (see ledger item 2).

### Mutation checks (each reverted; tree clean afterwards)

| Mutation | Result |
| -- | -- |
| Drop both `/getting-started*` lines from `isAuthExemptPath` | red: "exactly these forms are exempt" |
| Route passes all-doors-on to `signInDoors`, ignoring flags | red: "its doors follow the flags" |
| Route uses `publicOrigin(req)` without `safeHost` | red: "a malformed Host header falls back to harbour.cat" |
| Landing renders `${agentHtml}` after `${setupHtml}` | red: "sits directly under the hero sign-in buttons…" |
| `server.js` `/` passes `requestOriginOrNull(req)` as `agentOrigin` | on the live server the malformed Host now reaches the prompt (`http://evil.example/&lt;x&gt;`), which the e2e test "a hostile Host header never reaches the prompt" asserts against |
| Add an absolute `{{BASE_URL}}/no-such-page` link to the guide | red: link census, plus the two size tests |
| **Route hard-codes `freeTierEnabled: false`** | **green, 39/39.** No route-level test pins the free-tier wiring. The `ALL_DOORS` test turns the flag on but never checks the sentence, and `deploymentFlags()` has no test at all. I checked the live wiring by hand (above), but nothing guards it. |
| **Add a root-relative `` `/no-such-page` `` to the guide** | **green, 55/55.** `linksIn` only pulls out `https?://` URLs, so plan witness (e) ("every root-relative path… is a real route") and plan-review note 3 ("as well as root-relative ones") are only half met. The guide has no root-relative links today, so this is a latent gap, not a live broken link. |

Test level is right overall. There are unit tests for the builder, route and guard, and Playwright for placement, clipboard, no-JS, 320px in both themes, and the `/` Host wiring that only the running server can show. One gap: the `/getting-started*` routes are never requested through the real `server.js` in CI (the unit tests mount the router bare). My local run covers that for this head.

### Isolated, or one of a class?

The pattern is "a public surface decides which sign-in doors exist", and it has three instances. The hero and the guide now share `signInDoors`. The signed-out navbar (`lib/components/navbar.js:91-120`, shown on `/swipe`) is the third copy. It matches today and is named in `signInDoors`' header. The guide's correctness doesn't depend on it, because the guide's door links come from `signInDoors` and the guide only sends people to `/swipe` for "+ local workspace". So it is **outside** (plan-review note 2 set it aside).

A second pattern is "the landing is rendered", with two call sites. `/` gets the block. The workspace-removal sign-out render (`server.js:1959`) has no `req` and leaves it out, which was deliberate and disclosed. That audience is someone who has just signed out, not a cold visitor, and the ticket bounded "a cold visitor on `/`". So it is **outside**.

### What CI Did Not Prove

1. **Cold-agent walk on the final guide.** **Inside**: Success Criterion 4, the ticket's own bar. The 18:18 comment says a walk found four gaps, fixed in `6dacd78d`. It does not say the *fixed* guide was walked again to the bar. *Before the merge*: close-out confirms that the walk recorded on PR #2221 ran against the `6dacd78d` guide text. The deciding condition is the guide version the transcript fetched. If it did, confirm the walk reached either the local-workspace door or "sign in with X, then copy the Agent Prompt from Proxy" without inventing a URL. If the only recorded walk predates the fixes, run one fresh walk on the final guide and record it.
2. **Production origin pinning.** **Inside**: the plan's "a poisoned Host header would tell agents to fetch and trust another origin" is a claim this change depends on. As shown above, a well-formed forged Host is only refused when `PUBLIC_ORIGIN` is set. *After the deploy*: `curl -s -H 'Host: evil.example' https://harbour.cat/getting-started.md` and the same against `/`. Both bodies must name `https://harbour.cat` and never `evil.example`. If they don't, set `PUBLIC_ORIGIN` on the deployment. Also, close-out should correct the claim in the design notes (fix C below).
3. **Free-tier sentence wiring in the route is unguarded.** **Inside**: In Scope item 1, "whether the free tier is on", filled from source. The mutation stayed green. *Before the merge*: fix A below, then re-run that mutation and confirm it goes red.
4. **Root-relative links are not checked.** **Inside**: In Scope item 5 and plan witness (e). The mutation stayed green. *Before the merge*: fix B below, then re-run that mutation and confirm it goes red.
5. **Live render on harbour.cat.** **Inside**: Success Criteria 1–2 on the configured deployment, with real door flags, https and the edge in front. *After the deploy*: `/` shows `data-testid="landing-agent-prompt"` under the hero with `https://harbour.cat/getting-started.md` in the `<pre>`, and `GET https://harbour.cat/getting-started.md` returns 200 `text/markdown` with the production door list.
6. **`/kpis` "How people get started" funnel.** **Inside** (Success Criterion 6), and explicitly not a merge gate. *After the deploy*: read the funnel a week after release and record the first-Go count on the ticket.
7. **Navbar sign-in doors, a separate copy** (`lib/components/navbar.js:91-120`). **Outside.** Close-out files a follow-up after checking none exists: "The signed-out nav bar decides its GitHub/Jira/email doors itself; derive it from `signInDoors()` so a new door can't appear on the hero and the guide but not on `/swipe`."
8. **The sign-out landing has no agent prompt** (`server.js:1959`, no `req` and so no validated origin). **Outside.** Close-out files a follow-up only if none exists: "The landing rendered after removing the last workspace omits the LIN-4085 agent prompt; thread a validated origin into `handleWorkspaceRemoval` if that view should offer it."

### Fixes for close-out

- **A.** `tests/unit/getting-started-route.test.js`, the first `GET /getting-started.md` test (which serves `ALL_DOORS`, `freeTierEnabled: true`): add `assert.ok(body.includes('This deployment has a free tier, so no OpenRouter key is needed to start.'))`. That pins the route's `freeTierEnabled: flags.freeTierEnabled` hand-off; the `NO_DOORS` test already pins the off sentence.
- **B.** `tests/unit/agent-onboarding.test.js`, `linksIn`: also collect root-relative paths. For example, add `` for (const m of guide.matchAll(/(?:^|[\s(`])(\/[a-z][^\s`)]*)/gm)) out.add(`${BASE}${m[1].replace(/[.,:;]+$/, '')}`); `` so they go through the same known-route assertion. Run the same pass over `renderLandingAgentPrompt({ baseUrl: BASE })`. The guide and prompt must still pass unchanged.
- **C.** `docs/agent-onboarding.md` design notes, the `{{BASE_URL}}` bullet: replace "so a self-host points at itself and a forged Host cannot steer the guide" with "so a self-host points at itself; a malformed Host falls back to harbour.cat, and only a configured `PUBLIC_ORIGIN` stops a well-formed forged Host from steering the guide". This is above the `---` cut, so the served text and size ceilings are unchanged except the source ceiling. If the source grows past 4669, raise `AGENT_ONBOARDING_SOURCE_CEILING` and `FROZEN_TOTAL_BYTES` by the measured delta, with a LIN-4085 reason.

### Verdict

How the work meets what was asked, taken in order:
- *"On the homepage the getting started section, where software normally has an npm install command, we can have a prompt that the person passes to their agent."* **Met.** Scoping found no such section in production, so this adds one: a terminal-style block directly under the hero sign-in buttons, with a copy button and selectable `<pre>` text when JS is off. I verified it in the browser.
- *"This can be a couple of paragraphs explaining the situation and linking to a harbour.cat/getting-started page which walks an agent through onboarding the project and the user to Harbour."* **Met.** The prompt is three paragraphs, it names `<origin>/getting-started.md` and falls back to `/getting-started`, and the public guide walks the agent through what Harbour is, the three paths, and who does what.
- *"Because it's instruction for an agent, the human naturally uses the agent to interact with Harbour, which is a good first step."* **Met.** The prompt is written for the agent to act on, in the person's voice.
- *"Then, because the agent can read the guide, it can decide whether to have a conversation with the user or review the repositories and the settings."* **Met.** The guide's "Ask or look first" section offers exactly those two choices and forbids starting a path the person hasn't agreed to.
- *"We can have essentially a full guide on how to properly configure Harbour for whatever your situation is, without the user needing to follow those steps."* **Met, on my reading.** The guide covers each situation an agent can act on for a hosted user: just looking, a real tracker through every door this deployment has, and running work locally. It then hands configuration to the existing agent surfaces (the Proxy Agent Prompt and the `/api/proxy/instructions` catalog), so the user doesn't follow those steps themselves. The only steps left to the person are the ones no agent can do: OAuth, the OpenRouter key and minting the owner runner key. Self-hosting gets a README pointer, not a walkthrough. I read that as a different situation from the requester's (a harbour.cat user), not as a narrowing. If the requester meant self-host setup too, that's for them to say.

All three fixes are test or doc changes, made precisely enough to apply without guessing. The ledger has inside items to settle before merge (1, 3, 4) and after deploy (2, 5, 6).

`Approve — conditional on close-out discharging the ledger`
