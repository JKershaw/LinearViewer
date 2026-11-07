## Review — LIN-4085

Reviewed head `4f247b68` (PR #2221, branch head `6dacd78d`, squash-merged onto `f0ac579c`).

CI: green on `6dacd78d` (unit, all four E2E shards, secret scan), per the 18:18 implementation comment. `.github/workflows/test.yml` exists, so the normal CI gate applies.

### What was asked, and what landed

As asked: on the homepage's getting-started area, "we can have a prompt that the person passes to their agent ... linking to a harbour.cat slash getting started page which walks an agent through onboarding project and the user to Harbour."

All of it landed:
- **Landing block.** `/` now shows "Or hand this to your coding agent" (`data-testid="landing-agent-prompt"`) as the first section of `<main>`, directly under the hero CTAs. The prompt is static text with the origin as its only slot. It sits in a selectable `<pre>`, and the copy button is created by `public/landing-copy.js`. The block uses its own classes, not app.js's token-minting `.prompt-copy`.
- **Guide.** `docs/agent-onboarding.md` is built by `lib/prompts/agent-onboarding.js`. The cut is at the first `---`. `BASE_URL`, `SIGN_IN_DOORS` and `FREE_TIER_SENTENCE` are filled per request, and an unknown placeholder is refused.
- **Route.** `routes/getting-started.js` serves `/getting-started` as HTML (LIBRARY_CSP) and `/getting-started.md` as `text/markdown; charset=utf-8` (MARKDOWN_CSP). Both get `nosniff` and `no-store`, and both use the origin from `publicOrigin(req, { safeHost: true })`.
- **Public access.** Exactly two new exemptions in `isAuthExemptPath`. The sitemap gains `/getting-started`.
- **llms.txt.** A "Getting started" section now sits above "Library".
- **Supporting changes.**
  - `signInDoors()` is extracted and shared by the hero and the guide.
  - Three size ceilings were added at their measured sizes. `FROZEN_TOTAL_BYTES` goes up by exactly 4669 + 3691 + 584 = 8944.
  - The steady-base group and the source-map entries are in.

Nothing was narrowed. The ticket's re-grounding found that production `/` had no "getting started" section, so this change adds one rather than editing copy. The prominence question was settled by the person's 17:43 ruling. Open questions 2 and 3 were handled by stage decisions (17:39). Neither narrows the ask.

**Re-grounding / regression check.** Only one commit lands between the ticket and the change: `f0ac579c` (LIN-4070). It touches `server.js` but not the `/` handler or the mount area. The squash applied cleanly, and the `/` e2e passes at HEAD.

Recent history of the touched files:
- `lib/guest-task-path.js`: `10d3bf38` (LIN-3346) made `isAuthExemptPath` the single list shared by token refresh and PAT auto-login. This change adds to that one list, so both consumers pick it up and the LIN-3346 fix is intact.
- `lib/components/landing-hero.js`: the refactor touches the LIN-2010 registry hrefs and the LIN-1892 email gate. I checked byte-identity directly: I diffed `renderSignInCtas` output at HEAD against HEAD^ for all 8 door-flag combinations × 2 `idPrefix` values, and got 0 diffs.
- `routes/library.js`: LIN-3692's no-store and public origin are untouched.

No reverts were re-applied.

**Gap analysis against the plan.** Every row in the plan's table is done, apart from two deviations:
1. **HTML rendering.** The plan said to reuse the Library's markdown renderer. The route instead has its own small `Marked` instance with raw HTML escaped and a link-scheme allow-list. The stated reason is that the Library renderer needs per-document catalog context. This is a recorded deviation. The safety properties have direct hostile-input tests, and both survived mutation (below), so I accept it.
2. **Public-page scan.** Plan review ruled that adding the guide pages to the scan adds nothing, because they serve no JS. `/landing-copy.js` is picked up automatically by the scan of `/`.

### Verification I ran

- **Unit tests.** `agent-onboarding`, `getting-started-route`, `landing-agent-prompt`, `prompt-size-budget`, `library`, `landing-hero`, `llms-limitations`: 108/108 pass. `render-landing`, `guest-task-path`, `landing-hero`: 140/140 pass.
- **E2E.** `tests/e2e/landing-agent-prompt.spec.js` passes 6/6 against the real server:
  - placement under the Linear CTA;
  - the clipboard holds exactly the shown text;
  - 320px with no sideways scroll, in light and dark;
  - desktop in both themes;
  - with no JS, the text is selectable and there is no button;
  - a hostile `Host` on `/` falls back to `harbour.cat`.
- **Full app (temporary spec, deleted afterwards).**
  - `/getting-started.md` → 200, `text/markdown`. `/getting-started`, `/GETTING-STARTED.md` and `/getting-started/` → 200. None set a cookie.
  - `/sitemap.xml` lists `/getting-started`.
  - The served guide had every placeholder filled, and its door list matched the hero for that server's flags (Linear, Jira, email).
- **Screenshots.** I looked at `/` at 1280 and 320 in both themes, and at `/getting-started`. All are legible. The block sits directly under the buttons with its own eyebrow and H2.
- **Mutation checks.** Each was reverted afterwards, and the tree is clean.

  | Mutation | Result |
  | -- | -- |
  | Guide lists only the first door | red, 7 door-combination tests |
  | Drop the `.md` exemption | red |
  | Route uses `publicOrigin(req)` without `safeHost` | red (hostile-Host test) |
  | Free-tier sentence inverted | red, 2 tests |
  | Sitemap entry removed | red |
  | Landing block not rendered | red, 5 tests |
  | `.md` CSP header dropped | red |
  | `SAFE_HREF` check removed | red |
  | Raw-HTML escape removed | red |
  | `signInDoors` GitHub label changed | green in the new tests (they compare guide to `signInDoors`, which is the same source), red in the existing `lin-1890-jira-entry-surfaces` test |

  The last result is expected: the hero's labels are pinned by existing tests, and my direct byte-diff above covers the hero.
- **Cold-agent walk on the final guide text.** I ran it in a fresh subagent with no repo or tool access. It was given only the copied prompt; because it had no network, it took the prompt's own fallback ("paste the page") and was given the HEAD guide rendered for `https://harbour.cat`.
  - It asked what the person wants and which tracker they use before choosing a path.
  - For "Linear, real backlog", it gave "sign in at `/auth/linear`, then copy the Agent Prompt from `/workspace/<urlKey>/proxy`".
  - For "Trello, just looking", it said there is no Trello door, and gave "open `/swipe` → + local workspace in your own browser, then the Proxy Agent Prompt".
  - It invented no URLs and promised to keep the token secret.

  This covers the paste path only. The fetch path against a live server is in the ledger below.

### Isolated, or one of a class?

The class is **places that decide which sign-in doors this deployment offers**. `signInDoors` now feeds the hero and the guide. Two parallel copies of the same gating remain:
- the signed-out navbar (`lib/components/navbar.js:91-120`, shown on `/swipe`);
- `renderLoginPage` (`lib/render-pages.js:97-100`).

Both are **outside** this ticket. The class the ticket bounded is guide versus hero ("a guide that rebuilt the list itself would drift"), and that pair is now one source. Plan review explicitly kept the navbar as a known separate copy, and the guide's correctness does not depend on either. The guide only sends the person to `/swipe` for "+ local workspace", not for its doors. The `signInDoors` header comment honestly names the navbar copy. Close-out should file one follow-up, after checking it does not already exist: "navbar (isLanding) and renderLoginPage gate sign-in doors independently of `signInDoors()`; derive them from it."

**The sign-out landing** (`server.js:1959`, rendered from workspace removal) leaves the block out. It passes no `agentOrigin`, the same way it already passes no `origin`, because `handleWorkspaceRemoval` has no `req`. The ask is the homepage `/` for a cold visitor, so this is a deliberate, consistent omission rather than a gap. It is **outside**, and I recommend no follow-up.

### Findings (none blocking)

1. **Wording precision, no change required.** The design notes in `docs/agent-onboarding.md` say "a forged Host cannot steer the guide". `safeHost` rejects only a *malformed* Host. A well-formed forged Host such as `evil.example` is reflected when `PUBLIC_ORIGIN` is unset. That is harmless in practice:
   - production sets `PUBLIC_ORIGIN` (LIN-3709, recorded in `docs/reviews/security-review-2026-10-23.md`), which wins over Host;
   - on a self-host without it, the reflection reaches only the requester's own `no-store` response.

   If close-out touches this file anyway, it can say "a malformed Host cannot steer the guide; `PUBLIC_ORIGIN` pins it in production". The source ceiling equals the measured size (4669), so any reword must not grow the file, or the ceiling and total must rise with a LIN-4085 reason.
2. **Cosmetic.** On `/getting-started`, a paragraph that follows a list ("Do not start a path…", "Sign-in doors on this deployment:", "No endpoint exists…") has no top margin, so it reads as part of the list. The HTML is correct (`</ul><p>`); this is Library CSS spacing. Not a merge issue.

### What CI Did Not Prove

- **A live cold-agent walk on the fetch path. Inside** (Success Criterion 4, "a cold-agent walk passes ... without inventing URLs").
  - What exists: the PR's recorded walk ran on the pre-fix guide and found four gaps. The fixes are in HEAD, but no walk after the fixes is recorded. My re-walk above is on the HEAD text, through the paste fallback only.
  - **Before the merge:** close-out runs a fresh Claude Code session with network access against a local `npm start`, giving it only the prompt copied from `/`.
  - Distinguishing condition: the agent fetches `<origin>/getting-started.md` itself, asks before choosing, and ends at either "open `/swipe` → + local workspace" or "sign in with <a door listed for that server>, then copy the Agent Prompt from `/workspace/<urlKey>/proxy`". Every URL it emits must appear in the served guide.
  - Record a one-paragraph transcript summary on the PR.
- **The production origin in the live guide and prompt. Inside** (In Scope 1/3: "the base URL, from the request (`publicOrigin`)"). CI runs with `PUBLIC_ORIGIN=` empty, and production relies on `PUBLIC_ORIGIN` plus the protocol behind the proxy.
  - **After the deploy:** `GET https://harbour.cat/getting-started.md` returns 200 `text/markdown` with no cookie, and every absolute link in it starts with `https://harbour.cat/`, not `http://` or another host. The `<pre>` on `https://harbour.cat/` names `https://harbour.cat/getting-started.md`.
  - **Rollback:** revert `4f247b68`. Nothing is persisted.
- **The copy button on non-Chromium browsers. Inside** (Success Criterion 1, "a working copy button"). E2E drives Chromium with the clipboard permission granted. The `execCommand` and select-only fallbacks are not exercised.
  - **After the deploy:** tap "Copy prompt" on iOS Safari and on Firefox. Pass means the button reads "Copied" and the paste matches the `<pre>`, or it reads "Selected: press Ctrl/Cmd+C" with the text selected. Failure means no feedback, or nothing selected.
  - Low stakes, because the text stays selectable without the button.
- **Placement reads as "an equal second way in". Inside** (the 17:43 ruling). It is verified *directly under* the buttons (e2e plus my screenshots). Whether it reads as an *equal* door is a human call, and the implementer flagged it as reading "as its own section".
  - **After the deploy:** John looks at live `/` at desktop and 320px. If it reads as secondary, the fix (per plan review note 5) is to move the block inside `.landing-hero` after `.landing-ctas` in `lib/render-landing.js`. The hero markup stays byte-identical, and only the `previousElementSibling === null` assertion in `tests/e2e/landing-agent-prompt.spec.js` needs updating.
- **Watching the `/kpis` "How people get started" funnel. Inside** (Success Criteria, "After it ships", explicitly not a merge gate).
  - **Monitor:** the `/kpis` first-Go-press funnel, read one week after deploy. It was 0 over the prior 30 days. Only production traffic can show whether the way in is used.

### Verdict

`Approve — conditional on close-out discharging the ledger`

What was asked was "a prompt that the person passes to their agent ... linking to a harbour.cat slash getting started page which walks an agent through onboarding". That is delivered in full and not narrowed, with the public guide, the llms.txt entry and the guards the scope set. The tests that pin each claim go red when their code path is removed. Close-out should:
- run the live fetch-path walk before merge;
- do the three post-deploy checks and the funnel read;
- file the one outside follow-up (navbar and login page door gating not derived from `signInDoors`).
