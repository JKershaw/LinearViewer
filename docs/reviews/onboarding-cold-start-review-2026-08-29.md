# Onboarding & Cold-Start Review — 2026-08-29 (baseline)

**Status: baseline.** No prior `onboarding-*` report exists under `docs/reviews/` and none appears in git history — this run establishes the stable step names and the trend ledger. Every delta below is `baseline`.

**Grounded at:** `LinearViewer` HEAD `292ac962` (`origin/main`) · `simple-dispatcher` HEAD (checked out, unmodified) · live instance `https://harbour.cat` probed directly, 2026-08-29.

This is a **performed** review: every journey below was actually attempted this session — live curl/HTTP probes against `harbour.cat`, and two independent fresh `git clone`s of this repo run in isolated sandboxes, not code read in the abstract. Four legs were run by separate sub-agents in parallel (hosted-visitor probe, README-literal fresh clone, `npm run setup`/`env:check` fresh clone, programmatic-consumer bootstrap probe); the destination freeze, the landing-page provider-list cross-check, and the `simple-dispatcher` seam were walked directly in this session.

---

## 1 · Frozen destination

Three materially different statements of purpose exist in the product. This run freezes the **live landing page's own claim** as the destination a cold visitor is walked against:

> **"Harbour keeps human intent in command of AI execution, one turn of the loop at a time."**
> Operationalised on the page itself as four steps: *read the backlog → ground a prompt → dispatch → verify on evidence.*

Corroborating cold-start bar (`docs/north-star.md:19`): *"A stranger can trust it in one sitting … Login → connected → first evidence-verified merge, without talking to the operator."*

**Recorded divergence, not a silent re-pick:** `README.md:3` still states a materially narrower purpose — *"a minimal, CLI-aesthetic web app that displays your projects and issues as a collapsible tree … backed by Linear, GitHub, GitHub Projects, Jira, or a local store."* A self-hoster arriving via the README first (the J3/J4 personas below) is told they're getting a tree viewer; the live product they actually receive is pitched, on its own landing page, as an execution control plane. This divergence is itself the first finding (§4, D1) — this run does not silently harmonize it.

---

## 2 · Scope: journey inventory

The task named four entry paths; discovery widened this to seven plus two boundary rulings (unchanged from the pre-walk scope note — confirmed, not just assumed, during the walk itself):

| # | Path / persona | Walked this run |
|---|---|---|
| J1 | Hosted visitor → sign-in strip | ✅ live probe |
| J2 | Hosted visitor → the 5 advertised backends vs. 3 reachable ones | ✅ live probe (cross-checked directly, not just cited from prior research) |
| J3 | Self-hoster, README §Setup literally | ✅ fresh clone #1 |
| J4 | Self-hoster, `npm run setup` / `npm run env:check` | ✅ fresh clone #2 |
| J5 | Programmatic / agent consumer (bootstrap lane) | ✅ live probe + this session's own live instance of the broker-delivered variant (see §4, F1) |
| J6 | Free-tier / BYOK first useful action | ✅ live probe |
| J7 | Pre-auth public surfaces (`/swipe`, `/swim`, `/ship`, `/templates`, `/archive/2`, `/privacy`, `/terms`) | ✅ live probe |
| R1 | `simple-dispatcher` dispatch-consumer seam (bounded, per §1 widening) | ✅ walked directly (README + current checkout) |
| R2 | Harbour OS link (out of remit as a product; link only) | ✅ probed, 200, out of scope beyond that |

**R1 ruling, reaffirmed:** in remit at the Harbour-consumer seam only (`DISPATCH_API_URL`, dispatch token, `workspaces.json`, credential-broker triad) — not `simple-dispatcher`'s own internal harness/pacing surface, which is a different product's feature set.

**Not walked / capability-gated by design** (see §5): completing any OAuth consent screen, creating a Linear OAuth app, holding a live `LINEAR_ACCESS_TOKEN` PAT, minting a fresh standalone bootstrap token, and the free-tier action past sign-in.

---

## 3 · Journey-by-journey walk log

### J1 — Hosted visitor, sign-in strip
`https://harbour.cat/` → `200`. Title *"Harbour — keep human intent in command of AI execution."* All three sign-in CTAs resolve to real, correctly-scoped OAuth redirects, checked without completing consent (redirect only, not followed):

| Provider | CTA href | Redirect target (302) |
|---|---|---|
| Linear | `/auth/linear` | `linear.app/oauth/authorize?...scope=read,write...` |
| GitHub | `/auth/github` | `github.com/login/oauth/authorize?...` |
| Jira | `/auth/jira/oauth?mode=new` | `auth.atlassian.com/authorize?...scope=read:jira-work write:jira-work...` |

**Verdict: proceeded.** Clean, no guessing — every CTA the page shows works.

### J2 — Advertised backends vs. reachable backends
The landing page has **two separate, unlinked sections**: the sign-in strip above (3 real OAuth links) and a distinct "One cockpit, whatever tracks the work" provider list further down the page listing **5** backends as plain, non-interactive `<li>` text with zero `href` anywhere in that section:

```html
<li class="lx-provider"><span class="lx-provider__name">Linear</span>...</li>
<li class="lx-provider"><span class="lx-provider__name">GitHub Issues</span>...</li>
<li class="lx-provider"><span class="lx-provider__name">GitHub Projects</span>...</li>
<li class="lx-provider"><span class="lx-provider__name">Jira</span>...</li>
<li class="lx-provider"><span class="lx-provider__name">Local</span><span class="lx-provider__note">writable, no tracker</span></li>
```

Verified directly against the live HTML this session (not just cited from prior research). **Local** and **GitHub Projects** are marketed as supported backends but have **no path to them anywhere on the page** — Local needs no third-party OAuth at all, so it is specifically the one backend a cold visitor has the least reason to be blocked on, and is the one with literally no entry point. GitHub Projects isn't offered as a distinct OAuth option (only plain "GitHub" is), so whether the generic GitHub OAuth grant actually provisions Projects access is unverifiable from the surface itself.

**Verdict: hard-blocked** for the Local and GitHub Projects legs specifically (no workaround discoverable from the page); **proceeded** for Linear/GitHub/Jira. → **Fix-task candidate F-1** (§6).

### J3 — Self-hoster, README §Setup literally (fresh clone)
Fresh `git clone` into an isolated scratch directory, followed the README's documented steps in order, with **no credentials at any point** (genuinely cold — did not create an OAuth app, did not reuse any token from any other checkout on the machine):

| Step | Outcome |
|---|---|
| Clone | proceeded |
| Skip OAuth app, per README's own documented PAT shortcut | proceeded |
| `cp .env.example .env` (left credential fields blank) | proceeded |
| `npm install` | proceeded — 107 packages, ~700ms |
| `npx playwright install` | proceeded (browsers were already cached on this machine from unrelated prior use — see §5 caveat) |
| `npm start` | proceeded — clear console warning naming the exact missing env vars, no crash |
| `curl http://localhost:PORT/` | proceeded — `200`, full rendered landing page |

The running server, with **zero credentials configured**, rendered a friendly inline "Getting started" callout on the page itself (not just in server logs):
```
Getting started
Set LINEAR_ACCESS_TOKEN in your .env file to log in automatically.
Get a token from linear.app/settings/api
Or configure OAuth — see .env.example for details.
```
No stack trace, no 500, no blank page.

**Verdict: proceeded, cleanly, end to end.** Zero guessing required beyond an in-spec port change (documented in `.env.example`).

### J4 — Self-hoster, the repo's own scripts (second fresh clone)
Separate fresh clone. `npm run setup` chains `npm install` → attempts Playwright install → auto-runs `npm run env:check` at the end — one command, no manual sequencing needed. `env:check`'s own output is structured for both humans and agents (blockers first, then "Optional (only needed for web app OAuth)", then "Ready", then a one-line status):

```
⚠️ ACTION REQUIRED (complete these first):
1. Install Playwright browsers
   → npx playwright install chromium --with-deps

Optional (only needed for web app OAuth):
- Set LINEAR_CLIENT_ID / LINEAR_CLIENT_SECRET → https://linear.app/settings/api/applications

Ready:
✓ Node.js 25.9.0 (≥20 required)
✓ npm 11.12.1
✓ Dependencies installed

Status: 1 issue(s) to fix before proceeding
```

Correctly treats missing OAuth credentials as **optional**, never fatal — better guidance than README prose alone gives (README doesn't distinguish "needed to run" from "needed for OAuth login" as clearly). But independently re-running the flagged command (`npx playwright install chromium --with-deps`) after the reported blocker showed it **had already succeeded** (exit 0, 0.6s, browsers present at `~/Library/Caches/ms-playwright`) — `env:check`'s own Playwright detection (`scripts/env-check.sh:95-101`) checks `node_modules/playwright-core/.local-browsers`, `$HOME/.cache/ms-playwright` (Linux), `/ms-playwright`, and `$PLAYWRIGHT_BROWSERS_PATH`, but **never `$HOME/Library/Caches/ms-playwright`** (the actual macOS cache path). The tool perpetually reports a blocker that isn't one, on macOS, even right after its own successful setup run.

**Verdict:** `npm run setup` — proceeded; `npm run env:check` — **had to guess** (false blocker required independently re-running the "fix" to discover it already worked) → **Fix-task candidate F-2** (§6). Behaviourally better than J3's manual path on credential guidance, worse on this one platform-detection bug.

### J5 — Programmatic / agent consumer (bootstrap lane)
Two distinct flows exist under this persona, walked separately:

**J5a — broker-delivered (this session is live evidence).** This very review's own dispatch onboarding *is* an instance of this path: the dispatch prompt directly embedded the exchange rule ("a token handed to you... is a SINGLE-USE bootstrap. Before any other call, exchange it...") rather than requiring discovery via `docs/proxy-integration.md`. **Verdict: proceeded**, live and observed, not simulated.

**J5b — standalone HTTP bootstrap exchange (`docs/proxy-integration.md`), no broker.** Read the doc as a cold consumer would: **Quick Start** (`:20-40`) is placed ~65 lines **before** the **Bootstrap Tokens** section (`:85-131`), with no forward-reference in Quick Start pointing to it. Quick Start's first example is:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" https://your-instance.com/api/proxy/instructions
```
Live-probed against `harbour.cat` (no real bootstrap token available — capability-gated for the genuine article; probed with no header and with an obviously-fake token instead):

| Call | Result |
|---|---|
| `GET /api/proxy/instructions`, no header | `401` `{"error":"Missing or invalid Authorization header","code":"PROXY_TOKEN_INVALID",...}` |
| `GET /api/proxy/instructions`, fake bearer | `401` `{"error":"Invalid, expired, or consumed token","code":"PROXY_TOKEN_INVALID",...}` |
| `POST /api/proxy/token`, no header | `401`, same generic body |
| `POST /api/proxy/token`, fake bearer | `401` `{"error":"Invalid, expired, or already-exchanged bootstrap token",...}` — the *only* one of the four that even says "bootstrap," and only because it's the exchange endpoint's own rejection reason, not guidance |

A cold consumer who follows Quick Start literally with a real bootstrap token would hit the exact generic 401 shown in row 2 — indistinguishable from a plain bad token, no forward pointer to the fix. This is confirmed live for the generic-error shape; whether a *genuine* bootstrap on this exact endpoint returns byte-identical output is capability-gated (no real bootstrap available this session) — the doc-order and live generic-401 findings stand independently of that unverified detail.

**Verdict: had to guess** (resolvable by reading further, not a hard block) — friction, not breakage; kept advisory only, not promoted (§6 cap is for objective breakage).

Also checked: `/api/proxy/instructions` itself carries the exchange rule prominently but is **401-gated** — circular discoverability, readable only after already holding a working token. `docs/dispatch-integration.md` correctly defers to `proxy-integration.md` for the exchange step (no conflict), but does say "Linear Viewer" ×4 in its own overview/getting-a-token prose — did not actually mislead this walk, so left to the Documentation Review's remit per this review's altitude rule (§ Mind the altitude).

### J6 — Free-tier / BYOK first useful action
Landing copy: *"Log in and try AI Generated Prompts free — no OpenRouter connection needed to start."* Checked the underlying markup: this section (`lx-try`) contains **zero interactive elements** — no `<a>`, no `<button>` — anywhere in it. The promised action has no distinct entry point of its own; a visitor must infer that "Log in" means one of the three OAuth CTAs already shown higher on the page. Completing it past that point is capability-gated (requires a live OAuth grant).

**Verdict: had to guess** the promise isn't independently actionable — it resolves to J1's OAuth requirement with no separate route. (CTA-affordance styling itself is Design & Interface Review's territory, not re-flagged here; this is a note about there being no distinct route, which is behavioural.)

### J7 — Pre-auth public surfaces
`/swipe`, `/swim`, `/ship`, `/templates`, `/archive/2`, `/privacy`, `/terms` — all `200`. `/swipe`, `/swim`, `/ship` each carry their own sign-in nav bar (same 3 hrefs as the landing page, differently worded — "Sign in →" vs. the landing page's fuller CTA text). `/templates`, `/archive/2`, `/privacy`, `/terms` carry no sign-in CTA at all (content-only pages).

**Verdict: proceeded** for all seven; the inconsistent CTA copy between landing and in-app nav is minor friction, not promoted.

Two routes probed directly from prior research's static-analysis pointer, not organically discovered from the live surface — logged as **reaches** (see §5): `/login` → `404` (a second, unlinked, production-dead sign-in route — nothing on the live surface points here, so a genuine cold visitor would not encounter it without prior code knowledge); `/docs` → `404` (no in-product route to the integration guides — same caveat).

### R1 — `simple-dispatcher` dispatch-consumer seam
Walked directly against the existing (unmodified, no `.env` present) checkout's `README.md` §Setup: `npm install` → create `.env` (`DISPATCH_API_URL`, `POLL_INTERVAL_MS`, ...) → create `workspaces.json` (folder + per-workspace token) → the credential-broker triad (`HARBOUR_BOOTSTRAP_TOKEN` / `HARBOUR_PROXY_BASE` / `HARBOUR_LOCAL_PORT`). All four are documented in-file, including an explicit note that Harbour itself arms the broker vars on a broker-armed dispatch rather than an operator setting them. `README.md` explicitly states: *"Tokens are created in LinearViewer's workspace settings"* — a legitimate, if self-referential, pointer back into the product under review.

**Verdict: proceeded.** LIN-2249's finding (this file previously omitted the broker triad) reads as **resolved** at current HEAD — confirmed by direct inspection this session, not carried over from the prior report.

---

## 4 · Findings (severity-ranked; only objective/behavioural, no aesthetic or doc-prose-quality judgments)

| ID | Finding | Class | Severity | Journey |
|---|---|---|---|---|
| **B-1** | `scripts/env-check.sh` never checks macOS's actual Playwright cache path (`$HOME/Library/Caches/ms-playwright`), so it reports a persistent false blocker even immediately after its own successful setup run on macOS. | Objective breakage (self-verification bug) | **High** | J4 |
| **B-2** | Landing page markets 5 backends (`One cockpit, whatever tracks the work`); only 3 (Linear/GitHub/Jira) have any reachable entry point. Local (needing *no* third-party account) and GitHub Projects have zero path in from the page. | Advertised-but-unreachable entry | **Medium-High** | J2 |
| D1 | Destination divergence: `README.md:3` states a materially narrower purpose ("collapsible tree viewer") than the live landing page's execution-control-plane framing frozen as this run's destination (§1). | Destination divergence | Medium (advisory) | cross-cutting |
| F1 | Ordering trap + circular discoverability in the standalone bootstrap-token lane: Quick Start precedes Bootstrap Tokens in `docs/proxy-integration.md` with no forward-reference, and the live generic-401 error gives no guidance toward the exchange step. Not a hard block (resolvable by reading further); the broker-delivered variant (J5a) sidesteps this entirely and is what this session itself experienced. | Ordering trap / circular discoverability | Medium (advisory) | J5b |
| F2 | The free-tier CTA (J6) has no distinct actionable route of its own — it aliases to the same OAuth requirement as J1 with nothing in between. | Advertised action, no distinct route | Low-Medium (advisory) | J6 |
| F3 | `docs/dispatch-integration.md` still says "Linear Viewer" ×4 in overview/getting-a-token prose. Did not actually mislead this walk. Documentation Review's territory. | Stale naming | Low (advisory, deferred) | J5 |
| F4 | `/login` (production-dead, unlinked) and `/docs` (no in-product route to integration guides) both 404. Neither is reachable from the live surface without prior code knowledge — logged primarily as a **reach** (§5), not user-facing breakage. | Dead/absent route | Low (advisory) | J7 |
| — | Inconsistent sign-in CTA copy between the landing page and in-app nav bars (`/swipe`/`/swim`/`/ship`). | Minor friction | Low (advisory) | J7 |

**Clean / resolved:** R1 (simple-dispatcher seam) is fully documented and proceeded without friction; LIN-2249 reads resolved. J1 and J3 proceeded end-to-end with zero guessing.

---

## 5 · Reaches, capability-gates, and telemetry

**Reaches** (outside-surface/repo knowledge used to direct or unstick the walk, logged per the discipline rule rather than silently used):
- The full 7-path + 2-ruling journey inventory, and the specific probe targets `/login`, `/docs`, and the exact `/auth/*` hrefs, were seeded by a prior research pass over the repo's source and history — not discovered purely by clicking through the live surface as a genuine first-time visitor would. A visitor with zero repo knowledge would very plausibly never try `/login` or `/docs` at all (nothing on the live surface links to either).
- Discovering that `npm run setup` / `npm run env:check` exist (J4) required reading `package.json`, since README §Setup never mentions them — a true first-time reader following only README prose would never find this path.
- The Playwright chromium binaries used in J3 were already cached on this machine from unrelated prior use, so "`npx playwright install` succeeded" is not proof of a truly cold, bandwidth-constrained first install; the README doesn't warn about the size/time of that download.

**Capability-gated** (marked explicitly, no outcome guessed):
- All three OAuth consent screens (Linear, GitHub, Jira) — redirect target verified live; the grant itself needs a human-held provider account.
- Creating a Linear OAuth application, and holding a live `LINEAR_ACCESS_TOKEN` PAT (J3 alternatives).
- Minting a genuine standalone bootstrap token for J5b (requires an authenticated session on the instance) — the generic-401 shape was probed with a placeholder instead; whether a real bootstrap returns byte-identical output is unverified this session.
- Completing the J6 free-tier action past sign-in.

**Funnel telemetry:** none exists; confirmed, not assumed, going into this run (no new evidence contradicts that). The performed walk above is the primary signal, per the review's own rule.

---

## 6 · Follow-up tasks minted (objective breakage only, capped at 3)

Two tasks minted — both objective, reproducible, code-level breakage; nothing else in §4 clears the bar (friction/divergence items are advisory only and stay in this report for the next run to weigh):

1. **F-1 — `scripts/env-check.sh` reports a false Playwright blocker on macOS** (B-1 above). Scope: add a macOS cache-path check (`$HOME/Library/Caches/ms-playwright`) alongside the existing Linux/env-var checks at `scripts/env-check.sh:95-101`.
2. **F-2 — Landing page advertises Local and GitHub Projects backends with no reachable entry point** (B-2 above). Scope: either give Local a genuine entry CTA (it needs no OAuth) and clarify how GitHub Projects access is actually granted, or remove them from the provider list until they are.

---

## 7 · Trend ledger (baseline — every delta is `baseline`)

| Step | Severity this run | Delta |
|---|---|---|
| J1 — hosted visitor sign-in | Clean | baseline |
| J2 — advertised vs. reachable backends | Medium-High | baseline |
| J3 — README-literal self-hoster | Clean | baseline |
| J4 — repo-scripts self-hoster | High (env-check bug) | baseline |
| J5a — broker-delivered bootstrap | Clean | baseline |
| J5b — standalone bootstrap exchange | Medium (advisory) | baseline |
| J6 — free-tier first action | Low-Medium (advisory) | baseline |
| J7 — pre-auth public surfaces | Clean (minor CTA-copy friction) | baseline |
| R1 — simple-dispatcher seam | Clean, LIN-2249 resolved | baseline |
| D1 — destination divergence (README vs. landing) | Medium (advisory) | baseline |

**Collision note:** LIN-2361 (*Outward validation run #2: cold dispatched worker*, In Progress at time of writing) covers a much deeper cold-dispatched-worker lifecycle (launch-gate mechanics, provider-identifier normalization, dispatch-state vocabulary) than this review's R1 leg, which is scoped only to documentation/setup discoverability at the Harbour-consumer seam. No overlap in findings; this review does not re-measure LIN-2361's territory.

---

## 8 · Adversarial Second-Read

*(completed after this report and its follow-up tasks were written — see the mandatory comment on LIN-2382 for the same three fields in the engine-readable form)*

**Tier used:** Tier 2 — a fresh-context sub-agent with no memory of this report-writing session, given the finished report and repo access but not this conversation's history.

**Question posed:** *"What is the largest item in this window that this report missed or misfiled?"*

**Reader's answer (in full):** *(filled in below once the second-read completes)*

**Verdict:** *(AGREE / DISAGREE — filled in below)*
**Differed from top finding:** *(YES / NO — filled in below)*
**Disposition:** *(fixed in place / escalated / no change — filled in below)*

---

## 9 · Scope discipline

This review changed no code, config, or secrets, and no docs beyond this artifact. The two fresh clones and their `npm install`/`npm start` runs were performed in isolated scratch directories authorised by this review's own contract (§10: *"the one periodical whose entire evidentiary basis is a walk that writes files"*); the repo under review is otherwise untouched.
