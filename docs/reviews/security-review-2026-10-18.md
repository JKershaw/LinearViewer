# Security review, v1 path, 18 Oct 2026 (LIN-3419)

**Start condition: met.** LIN-3420 (`79c526a1`), LIN-3421 (`4939292d`), LIN-3506 (`6a7d9ad0`), LIN-3418 (`acadeeab`) and LIN-3404 (`15c3b42c`) are all on `origin/main`. Reviewed at HEAD **`e2cc2ef0`**, 2,664 commits after the baseline `d9c51daf`.

**Baseline:** `docs/reviews/security-review-2026-06-25.md` (LIN-669). **Remit:** `lib/periodicals.js:351`.
**Mode:** read-only. No code, config, test or doc changes. Every temporary mutation was reverted, and `git status` is clean. There were no live calls: no `npm audit`, no curl to GitHub, Linear or harbour.cat. No secret value appears in this report.

## Verdict

**No Critical. One new High (provisional): LIN-3642.** The first pass of this report said "No new High". That was wrong: an independent review found the miss (see the second read below). Five of the six fix claims hold at HEAD, and each holds as an attacker would test it. The sixth, LIN-3418, shipped only half its title. That gap is the first of two new Medium findings. All three new findings are ticketed:

- **LIN-3642 (High, provisional, new).** The Linear OAuth callback (`routes/auth.js:134`) passes its CSRF check when both `state` and `session.oauthState` are undefined. A callback with no `state` on a session with no `oauthState` signs in, or links the callback's Linear identity onto an already signed-in account (`establishAccount`, `lib/account-session.js`, the `else if (session.accountId)` branch). The siblings require the nonce (`lib/github-install-flow.js:522`, `routes/jira-auth.js:432`). Reproduced with the `tests/unit/auth-route.test.js` fakes. What an account id shared this way unlocks (owner checks, `listAccountsForWorkspace`, owner-credential reads) was not traced, hence "provisional".- **LIN-3634 (Medium, new).** The server admits a close-out dispatch whatever the PR's readiness. LIN-3418 step 2 was dropped, nothing was filed, and the ticket is Done.
- **LIN-3635 (Medium, carried from June M3, never ticketed).** Feedback intake spends the shared free-tier key outside the hourly net. It also has no rate limit and a 12 MB parser that accepts any content type.

Tenant isolation is still clean on both lanes. Credentials are clean across the tree and 3,954 commits of history.

## Severity-ranked findings, as a delta against 2026-06-25

| # | Sev | Delta | Finding | Ticket |
|---|---|---|---|---|
| 0 | **High (provisional)** | **new** | Linear OAuth callback passes the CSRF check when `state` and `session.oauthState` are both undefined (`routes/auth.js:134`), and links the callback's identity onto a signed-in account. | **LIN-3642** |
| 1 | High | unchanged, open | No unique `urlKey` registry/index. The only backstop is the bind-time holder read. `lib/db-indexes.js` has no `workspaces.urlKey` unique spec. | LIN-3394 (Backlog) |
| 2 | High | unchanged, open | The bootstrap token is still inline in prompt text for non-`claude-code` harnesses (`lib/proxy-preamble.js:200`). | LIN-1410 (Backlog) |
| 3 | High (tracker) | open, not re-verified | Run-page evidence reads bypass the GitHub budget. | LIN-3273 |
| 4 | High (tracker) | open, not re-verified | The dashboard Rulings feed `liveDispatchOnAnchor` has no workspace filter. The predicate returns only a liveness boolean over a loop set keyed by urlKey (`routes/dashboard.js:465`, `routes/proxy-rulings.js:247`), so I saw no cross-tenant read. | LIN-3281 |
| 5 | High (tracker) | open | The served-page secret scan reports a zero-JS page as clean, and the source scanner is fail-open. | LIN-2850 / LIN-2852 |
| 6 | **Medium** | **new** | Close-out press has no server-side readiness re-check. `head-moved` exists only in the rendered box (`lib/run-closeout-state.js:313`). The press is a plain dispatch (`public/close-out.js:109`). `guardCloseOut` refuses only the run's own `sessionId` (`lib/dispatch-factory.js:404`, `:922`). `SESSION_STAGES` (`lib/dispatch-entrance.js:1103`) has no readiness stage. | **LIN-3634** |
| 7 | **Medium** | **carried (June M3), first ticket** | The feedback title call spends the free-tier key with no `checkFreeTierGate` (`routes/workspace-api.js:3115-3144`; compare the gated siblings at `:1350` and `:2140`, and `routes/flight-companion.js:729`). The route has no limiter (`:3151`) and a 12 MB any-type parser (`:641`, `:2941`). | **LIN-3635** |
| 8 | Medium | unchanged (June M2) | The attachment relay checks the host allowlist only. There is no resolved-IP or private-range check and no DNS-rebind pin (`routes/proxy-reads.js:414-438`). The allowlist grew only by fixed GitHub hosts that never get a credential. | LIN-684 (Backlog) |
| 9 | Medium | unchanged, partly resolved | Dependency CVEs. The lockfile is byte-identical to June for `express 4.22.1`, `path-to-regexp 0.1.12`, `qs 6.14.1` and `body-parser 1.20.4`. `undici` was removed (LIN-688, `3ca297de`). Not re-audited online, by this run's rules. | LIN-620 (Backlog) |
| 10 | Medium | already filed since | Tokens and `/t/` links still outlive logout, single-binding unlink and involuntary removal. The dispatch-token default TTL is still none. | LIN-3617, LIN-3618, LIN-3619 |
| 11 | Medium | open | Prompt-injection and untrusted-text stance. Out of scope for this run. | LIN-3402 |
| 12 | Medium | open | Credential-level merge enforcement. Out of scope for this run. | LIN-3417 |
| 13 | Medium | open | Spend outside every cap (precompute, per-account share), the same class as #7. | LIN-3422 |
| 14 | Low | unchanged, **re-rated** | `SESSION_SECRET` falls back to a hardcoded default (`server.js:196-200`). The tracker says High. I rate the real blast radius Low: sessions are stored server-side and session IDs are random, so a known secret lets an attacker sign a session ID they chose but not hijack an existing one. Whether production sets it is **not verified**. | LIN-619 |
| 15 | Low | partly resolved (June M4) | `encRepo` (`lib/providers/github/client.js:66`, LIN-702) encodes each segment, but `..` survives both `encodeURIComponent` and `REPO_SLUG_REGEX` (`routes/github-auth.js:32`). The slug comes only from the user's own picker. | report only |
| 16 | Low | partly resolved (June L2) | The upload type is now sniffed (`lib/attachment-upload.js:101`). A client-supplied filename still passes through to the provider (`:84`). | report only |
| 17 | Low | new | DOMPurify 3.2.4 and marked 17.0.1 are vendored in `public/*.min.js` (last touched `874790f7`, January). They sit outside `package.json`, so no `npm audit` ever sees them. | report only |
| 18 | Low | new | `nosniff` is set only on `text/html` responses (`lib/security-headers.js:79`). Text and markdown endpoints are served without it. I found no usable `script-src 'self'` gadget: they all start with fixed template text. | report only (LIN-3627 covers `img-src`/`form-action`) |
| 19 | Low | already filed | The proxy credential resolver reads expired session rows (`server.js:2661`). The window is ≤1 h because of the hourly sweep (`lib/hourly-cleanup.js:86`, LIN-3424). | LIN-3616 |
| 20 | Low | already filed | `/user/installations` reads page 1 only. It fails closed, so this is availability, not security. | LIN-3626 |
| 21 | Low | unchanged, open (omitted from the first pass) | The OpenRouter callback has no `state` (`routes/openrouter-auth.js:123`). It relies on the PKCE verifier held in the session (`:89`, `:129`), so a code minted by someone else's flow fails the exchange. The residual is low. | LIN-676 (Backlog) |

**Resolved since June:** H1 SVG stored XSS (LIN-682: `sniffRasterType` and `nosniff`, `routes/workspace-api.js:2905-2925`). M1 GitHub `repo` scope (LIN-683/703: GitHub App with per-installation tokens). L3 no CSP (LIN-3420). The baseline's prompt-injection H1 is now tracked as LIN-3402.

**Partly resolved:** L1 OAuth `state` (LIN-2499). LIN-2499 fixed nonce reuse, but its replay test only replays with `state: 'real'`, never with `state` missing. The class "the callback is bound to the session" is still open on the Linear path (LIN-3642).

## The fix claims, re-read as an attacker

| Ticket | Claim | At HEAD | Mutation check (all reverted) |
|---|---|---|---|
| LIN-3420 | Hash-based CSP and `frame-ancestors` on app pages and `/t/` | **Holds.** `lib/security-headers.js` with no `'unsafe-inline'`. The mount order is pinned by `tests/unit/security-headers.test.js:174`. No direct `writeHead` HTML and no static HTML in `public/`. Gaps are documented and filed (LIN-3627). | Dropping the CSP `setHeader`: 4 tests fail |
| LIN-3421 | Removal revokes the remover's tokens and links; optional dispatch-token expiry | **Holds for its narrowed scope.** `lib/workspace-removal-revocation.js`, wired at `routes/workspace.js:127`, `:148`. Logout, unlink and the default TTL were deliberately left alone and are now filed (LIN-3617 to 3621). | Disabling both route calls: 3 tests fail |
| LIN-3506 | Five direct `sessions` readers skip expired rows | **Holds.** `lib/session-row-live.js`. The sixth reader (the proxy resolver) is a recorded open question, now LIN-3616. | `isSessionRowLive` returns true: 14 tests fail |
| LIN-3418 | `ready` ignores `headMoved`; re-derive on the press | **Half.** Step 1 holds. **Step 2 was not built** (see #6). | Mutations were done by the PR's own review. Step 2 has nothing to mutate. |
| LIN-3404 | Fresh-install callback mints only for an accessible installation | **Holds.** It checks membership in the user's own `/user/installations` and fails closed (`lib/github-install-flow.js:620-672`). | Disabling the membership check: 7 tests fail |
| LIN-3398 (inventory) | Owner-only runner actions | **Holds.** `refuseNonOwner` on halt POST/DELETE, item DELETE, trim and token DELETE (`routes/dispatch.js:770-990`). The mint is owner-only (LIN-3137). | not run |

## The LIN-2954 inventory at HEAD

**Fixed (Done):** 3418 (half, see #6), 3420, 3421 (narrowed, residuals filed), 3424, 3426, 3398 (and parts 3408 and 3409), 3401, 3404, 3395, 3269, 3506.
**Still open:** 3642, 676, 3417, 3422, 3423, 3425, 3394, 3402, 1410, 2850, 2852, 3261, 3346, 3348, 2530, 2642, 3273, 3281, 3280, 1301, 3284, 3400, 3264, 3321, 619, 620, 684.
LIN-618 is Canceled, superseded by LIN-376 (Done: single-use bootstraps).

## Per-layer audit (v1 path)

1. **Sign-in, email (new).** Links are 32 random bytes stored as SHA-256 hashes, expire after 15 minutes in every query, and are consumed atomically (`lib/email-auth.js:132-172`). The confirm POST checks Sec-Fetch-Site, then a per-browser nonce, then peek, consume and re-check, then N2, then `regenerate()` (`routes/email-auth.js:514-628`). Link origin comes from `EMAIL_LINK_ORIGIN`. Sends are throttled. **Clean.**
2. **Sessions and cookies.** `sameSite:'lax'`, `httpOnly` (default), `secure` in production, a 30-day TTL (`lib/session-options.js`), and `trust proxy 1` in production (`server.js:973`). See #14 for the secret. **Clean apart from LIN-619.**
3. **Connect: GitHub App.** The fresh-install membership proof holds (LIN-3404). The re-bind map lives server-side in the session. The OAuth state is consumed. **Jira:** the site is pinned to `https://*.atlassian.net` (`routes/jira-auth.js:86-109`). **Connections:** `authorizeConnection` compares canonical account ids and fails closed (`lib/connection-credential.js:102`). The held picker posts only scopes from a server-side offer map. **Clean.**
4. **Tenant isolation, session lane.** `workspaceFromUrl` (`server.js:2308`) requires the `urlKey` to be in `req.session.workspaces`. I checked every `/workspace/:urlKey` route. Only `/remove`, which does its own membership read, and one limiter mount skip it. **Clean.**
5. **Tenant isolation, proxy lane.** `authenticateProxyToken` (`routes/proxy.js:532`) is still the only writer of `req.proxyUrlKey`. Bootstrap tokens are refused on data routes, and single-use consume is atomic (`lib/proxy-tokens.js` `validateToken`). Every write route carries `requireWriteScope` (`writeAuth`, `routes/proxy-writes.js:152`). Recap and brief POSTs are read-scope by design (documented as read endpoints). **Clean.**
6. **Runner and dispatch tokens (new).** The runner mount is path-gated on `take` (`routes/proxy-runner.js:81`). Take is atomic and scoped to the urlKey. Feedback is bound to the taker's token id. The three enqueue routes are gated on `dispatch` (`routes/proxy-dispatch.js:315`, `:356`; `routes/proxy-kickoff.js:102`). Grant mints are owner-only inside `mintGrantBootstrap` and fail closed. Dispatch prose is masked for anyone but the row's own dispatcher (LIN-3384, `routes/proxy-dispatch.js:700`). The `local` spawn needs `/dev/tty` and the owner gate. Residual: lifetimes (#10). **Clean otherwise.**
7. **Prompt and Go.** Session enqueue goes through the owner gate (LIN-3383, `routes/dispatch.js:435-447`) and the run gate. Collective is owner-gated per seat. Untrusted text reaching prompts is out of scope (LIN-3402).
8. **Run page.** Reads are keyed by `(urlKey, sessionId)` (`routes/dashboard.js:1651`). The PR-state cache is partitioned by `scopeKey` for reads made with a token (`lib/pr-state-store.js:194`). The PR-read token is used only for the bound repo (`prReadToken`; its missing test is LIN-3593). **Clean.**
9. **Close-out (new).** The check route reads only with the person's own provider session. The press is recorded only after a merged-PR refusal (LIN-3395). **Gap: #6 (LIN-3634).**
10. **Task shares `/t/` (new).** Tokens are 32 bytes. Malformed, unknown and revoked tokens get the same 404 before any store read. The owner is re-checked on every request. Output passes secret masking. Server render is escaped, and client markdown goes through DOMPurify with `form` forbidden (`public/common.js:471`). `no-referrer`, `no-store`, `noindex`. There is no rate limit, by ruling. **Clean.**
11. **Untrusted text reaching HTML.** Sampled the client templates: tracker fields go only into `textContent` or titles. CSP now blocks injected script. **Clean in the sample.**
12. **SSRF and relays.** The image proxy (raster only, credential sent only to Linear) is clean. The attachment relay is #8. Jira and GitHub use fixed or pinned hosts. **One carried Medium.**
13. **Rate limits and the free tier (new).** Every other free-tier spender I found charges the hourly net. Precompute is LIN-3422. Feedback is #7. Feature flags are self-service (`server.js:4113-4129`), so they are not an authorization boundary, but no flag is the only gate in front of a privileged or ungated spend.
14. **Dependencies.** See #9 and #17.
15. **Test surface.** `createTestRoutes` mounts only under `NODE_ENV === 'test'` (`server.js:1011`).

## Classes and how each was bounded

- **Spenders of the free-tier key.** Bound: every `resolveChatCredential(` and `OPENROUTER_FREE_TIER_KEY` reader in `routes/`, `lib/` and `server.js`, each traced to a `checkFreeTierGate` call. 25 sites. Ungated: the feedback title (#7) and precompute (LIN-3422). Page-load model resolution makes no call. `routes/proxy.js:1467` is an inner helper whose callers charge the gate.
- **`/workspace/:urlKey` routes without `workspaceFromUrl`.** Bound: a grep over route definitions, single-line and multi-line. Two members, both justified.
- **Proxy mutating routes without write scope.** Bound: a grep of `/api/proxy` POST, PATCH, PUT and DELETE. Members are the token exchange (pre-auth by design) and recap/brief (read by design).
- **Direct `sessions` readers.** Bound: a grep for `sessionsCollection` and `find({})`. Five are fixed. The proxy resolver, token refresh, kpi-stats and scripts are LIN-3616.
- **Fix claims.** Bound: the operator's list plus LIN-3398. Six members, table above.

## Not verified (needs production or a browser)

- Whether production sets `SESSION_SECRET`, `NODE_ENV=production` and `OPENROUTER_FREE_TIER_KEY`. That decides #7's real exposure and #14.
- The live CSP in a browser on `/t/`, the task page and the run page.
- `npm audit` against the live registry (#9), and upstream advisories for the vendored DOMPurify and marked (#17).
- The deploy's TLS and HSTS posture, and any CDN caching of `Host`-derived responses. Neither had a ticket; the routed human-check ticket is LIN-3643.
- How many production workspaces other than the operator's have a runner (inherited from the LIN-2954 inventory).

## Coverage added after the first pass, and what stays out of depth

The first pass listed the Linear and Jira OAuth callbacks, the account-merge internals and the connection release paths as not covered in depth. The independent review found a High in the first of them, so they were covered read-only in the amendment (comment `992d04d4`):

- **Linear callback, both arms.** Beyond LIN-3642: the add-source arm restores `session.workspaces` on any refusal, and the new-login arm carries `accountId` across `regenerate()` and restores the workspace list on conflict. The token and refresh token go to the durable owner store, not the session. The add-source arm's mode depends on server-side `oauthIntent`, which a fresh session lacks, so only the `mode:'new'` path is reachable with a missing `state`.
- **Account merge.** `POST /auth/merge/confirm` (`routes/account-merge.js:86`) re-checks freshness (`:96`, `isFreshlyAuthenticated`). `respondToAccountConflict` (`lib/account-conflict.js:108`) refuses a merge unless the live account was freshly proven. In the LIN-3642 path the foreign identity does not stamp freshness, so the bypass is the plain "link a new identity" branch, not merge-confirm.
- **Jira callback.** Guarded (`routes/jira-auth.js:432`). The site is pinned to `*.atlassian.net`. The pending-token-in-session and multi-site nonce items are already LIN-2642 and LIN-2530. No new finding.
- **Connection lifecycle release paths.** Dropped from depth, with the reason: they sit behind the canonical-account compare in `authorizeConnection` (item 3 above), and LIN-3617 to 3619 own the lifetime gaps. Nothing new turned up on the way through. A deeper trace belongs to a ticket-scoped review, not a delta rerun.
- **Still not in depth:** LIN-3273 and LIN-3281 beyond a read of the predicate.

### OAuth-callback class: nonce compared without being required

| Callback | Requires the nonce? |
|---|---|
| Linear `/auth/callback` (`routes/auth.js:134`) | **No** (LIN-3642) |
| GitHub and GitHub Projects (`lib/github-install-flow.js:522`) | Yes |
| Jira (`routes/jira-auth.js:432`) | Yes |
| OpenRouter (`routes/openrouter-auth.js:123`) | No `state`; the PKCE verifier is bound to the session (LIN-676, open) |
| Email confirm (`routes/email-auth.js`) | Not an OAuth callback. Per-browser nonce plus Sec-Fetch-Site, audited clean above |

## Departures from the periodical template, with the reason

- **Where the report lives.** It was first posted as LIN-3419 comment `2f92653f`. The operator notes for that run allowed no docs change. The `lin3419-report-commit` ruling answered "Yes, follow-up docs PR", so this file is the committed copy and the ledger persists for the next run. This avoids the loss described in LIN-694 and seen with the 23 June baseline. The text is the posted comment with the amendment (comment `992d04d4`) folded in.
- **Second read: Tier 3 in the run, then an independent read.** The operator notes bar sub-agents ("No parallel forks or background sub-agents"), so the run's own second read was Tier 3, the same session. The independent review `40546d6c` then served as the Tier 1/2 read and found a miss. Tier 3 alone was not enough.

## Adversarial second read

Tier: **3 (same session, by operator rule).** Question: *what is the largest item in this window that this report missed or misfiled?*
Answer: there were two misfiles in the draft, both fixed in place. (1) A delta-only layout ranked my two new Mediums above open Highs that carry over (LIN-3394, LIN-1410). The table is now severity-first. (2) LIN-619 is filed High in the tracker, but its blast radius is Low. It is now re-rated in #14 with the reason. I found no unreported Critical or High. **That answer was incomplete.** The independent review (`40546d6c`, Request Changes) found a High the report had missed on the sign-in path: LIN-3642, the Linear callback with no `state` requirement. It also found a misfile: L1/LIN-2499 had been listed as resolved, and is partly resolved. LIN-676 had been left out of the open list. All three are corrected above.

Adversarial second-read verdict: DISAGREE (the independent read found LIN-3642; the Tier 3 read had found nothing)
Differed from top finding: YES
Disposition: fixed in place (headline, row 0, L1 and LIN-676 amended; sign-in layers covered)

## Surface Assessment

`Surface Assessment: [lands cleanly]`. This was a review-only run: there is no change to land. The three new findings (LIN-3642, LIN-3634, LIN-3635) are small, separate fixes, each scoped in its own ticket.
