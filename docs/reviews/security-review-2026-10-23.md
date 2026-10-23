# Security review, delta vs 18 Oct 2026 (LIN-3776)

**Reviewed at HEAD `c6c5585a`** (`origin/main`, 23 Oct), 110 commits after the 18 Oct review (`e2cc2ef0`). Nothing landed between the ticket seed and this run, so the seed SHA and the execution HEAD are the same. Every `file:line` below was re-read at this HEAD, not copied from the 18 Oct prose.

**Baseline:** `docs/reviews/security-review-2026-10-18.md` (LIN-3419). **Remit:** `generateSecurityReviewPrompt`, `lib/periodicals.js` (`id: 'security-review'`).
**Mode:** read-only. No code, config, test or doc other than this report was changed. No live or mutating calls were made, and no `npm audit`. **No secret value appears in this report**; the history hits below are described by shape only.

A pre-execution research pass (ticket comment, 23 Oct) supplied most of the provisional verdicts. This run re-read the load-bearing ones at HEAD (marked ✔︎), re-ran the credential scan with built-in `git` only, and covered the items that pass left open (LIN-3273, LIN-3281, LIN-684 and the credential and `MONGO_PUBLIC_URL` greps). Mutation results quoted in the fix table are the research pass's (all reverted); this run did not repeat them.

## Verdict

**No Critical. No new High finding.** The three 18 Oct fixes (LIN-3642, LIN-3634, LIN-3635) hold as an attacker would test them. The top-ranked open item is still **LIN-3386, forged authority marks (High, existing ticket)**, and it has *grown*: two more consumers read authority from comment text since it was written, and any GitHub account can write that text on a workspace bound to a public repo. It is escalated by comment, not re-filed.

Three new **Medium** findings (N1 to N3 below) are ticketed. One more is routed into LIN-3772 and not ticketed separately. Tenant isolation is clean on both lanes. Credentials are clean across the tracked tree and full history, but the secret scanner lacks the incident's secret types (N3), which is a finding in its own right.

**Runner-contract remit decision.** The Harbour side is **in remit**: `routes/proxy-runner.js`, `lib/runner-kit/*`, the grants and the runner prompt. The simple-dispatcher broker is out of remit and read only as contract input. At SD `bb1da78` it binds `127.0.0.1`, serves only `/api/proxy/*` after path normalisation, refuses the token-mint path, and asks for `X-Harbour-Intent: write` on writes. That header is a deliberate-intent speed bump, **not a boundary**: injected text can add it.

## Severity-ranked findings (delta vs 2026-10-18)

| # | Sev | Delta | Finding | Ticket |
|---|---|---|---|---|
| 1 | **High** | **unchanged, grown** | Forged authority marks. A review Approve or ledger is matched on title plus a verdict word (`lib/run-ledger.js:49-56` ✔︎). A ruling is a text suffix (`lib/recommendation-facts.js:46` ✔︎, `:72-75`). PR links come from any comment, any repo (`lib/run-evidence.js:37-61`). New consumers since the ticket was written: `lib/close-out-readiness.js:78-87` and the CI-wake sweep's PR resolution (`lib/ci-wake-sweep.js:68-85`, live in production). On a public-repo workspace the author is anyone. | **LIN-3386** (escalate by comment) |
| 2 | High | unchanged, open | No unique `urlKey` registry or index. LIN-3700 does **not** close it (see fix table). | LIN-3394 |
| 3 | High | unchanged, open | Bootstrap token inline in prompt text for non-`claude-code` harnesses (`lib/proxy-preamble.js:335-336`). | LIN-1410 |
| 4 | Low-Medium (tracker says High; **re-rated**) | re-read this run | LIN-3273: run-page evidence reads do not spend the 36/h GitHub budget. The budget lives in `lib/pr-state-store.js:142-164`; `readRunExternal` (`routes/dashboard.js:1613-1640`) calls `readRunEvidence` outside it. Availability and shared-quota, not confidentiality: reads are keyed by the session's own `urlKey` and evidence URLs. I would rate it Low-Medium. | LIN-3273 |
| 5 | Low (tracker says High; **re-rated**) | re-read this run, **no cross-tenant read** | LIN-3281: `liveDispatchOnAnchor` has no workspace filter of its own, but its closure iterates `loops`, which are loaded per `urlKey` (`routes/proxy-rulings.js:225-247`). It returns a liveness boolean only. I rate it Low. | LIN-3281 |
| 6 | High (tracker) | unchanged | The served-page secret scan reports a zero-JS page as clean; the source scanner swallows read errors (`lib/secret-scan.js:410`, `:434`). | LIN-2850 / LIN-2852 |
| N1 | **Medium** | **new** | The runner-kit token (`take` + `dispatch`) is stored at `~/.harbour-runner/<urlKey>/runner.token` (`lib/runner-kit/runner.mjs:741` ✔︎ path builder; `broker.mjs:44`), owned by the same OS user as the dispatched subagent's shell. A leaf worker that obeys injected text can read it and enqueue arbitrary owner-trusted prompts, so "a worker cannot enqueue" does not hold on a runner-kit host. The ruling `lin3098-same-user-boundary` is pending; no ticket found. | **new ticket** |
| N2 | **Medium** | **new** | Flight Companion playbook as persistent injection. `remember` stays on for auto-wake and boot turns (`routes/flight-companion.js:577`, `:742`; `lib/agent-turn.js:517`), so tracker comment text read through `get_comments` or `get_brief` can be written into the "## Playbook" system section of every later turn (`lib/flight-companion-brief.js:419-424`). Same hazard as the Done LIN-2625-F3, reached from a different source. | **new ticket** |
| N3 | **Medium** | **new** | `lib/secret-scan.js` lacks the incident's secret types: Resend `re_`, Atlassian `ATOA`/`ATATT`, `mongodb(+srv)://user:pass@`, GitHub and Linear client secrets, `ghr_`, encrypted or truncated PEM, env-style `X_SECRET=value`. The `HB…` bootstrap branch (`:236`) is dead: nothing mints `HB` tokens, and Harbour's own proxy, dispatch, `/t/` and email tokens are unprefixed 32-byte base64url. The scanner is the **masking boundary on public `/t/` pages** (`routes/task-share.js:110`, `:168`), so any of these pasted into issue text is served unmasked to unauthenticated viewers. Dispatch-prose redaction masks only bootstrap tokens (`lib/dispatch-session-redaction.js:19` ✔︎). LIN-2853, LIN-2850 and LIN-2852 are siblings but do not cover this list. | **new ticket** |
| N4 | Medium | **new** (adjacent to LIN-1374) | The kickoff `goal` from any dispatch-grant holder is rendered as **"Goal from the human"** (`lib/prompts/autopilot-kickoff.js:703-711` ✔︎), and the child gets `dispatch` again. | LIN-1374 (comment) |
| N5 | Medium (ops) | **new, needs a human check** | A non-root production Mongo user `lin3014_read` is expected by `scripts/lin3014/lib/guard.mjs:14` ✔︎; its password file sits on the dispatcher host. The 23 Oct rotation reset the root credential; this user may have survived. | LIN-3772 (comment) |
| 7 | Medium | unchanged, open | Attachment relay is host-allowlist plus `https` only (`routes/proxy-reads.js:411-438` ✔︎): no resolved-IP check. The allowlist is fixed public hosts, `redirect: 'error'` is set (`:569`) and the bytes are served as `application/octet-stream` with `nosniff`, so the practical SSRF reach needs control of those hosts' DNS. Rated Low-Medium. | LIN-684 |
| 8 | Medium | unchanged | Dependency CVEs. The lockfile has not changed since `6597d6e0` (13 Oct, before the last review), so there is no drift. Not re-audited online. | LIN-620 |
| 9 | Medium | open | Untrusted-text stance, and the credential-level merge rule (the dispatch-grant lanes still admit a close-out). | LIN-3402, LIN-3417 |
| 10 | Medium | open | Spend outside every cap: precompute (`lib/run-paragraph-hook.js:30`) is still the only ungated free-tier spender. | LIN-3422 |
| 11 | Medium (availability; accepted by design note, **flagged by the second read as the window's largest new item**) | **new, documented** | LIN-3771 residual: the global 10-per-hour send ceiling (`lib/email-auth.js:51-52` ✔︎) can be used up by one IP with 10 POSTs to throwaway addresses; real sign-in sends then drop silently behind the "check your inbox" page. Accepted in `docs/architecture/auth.md:135-137`. Not ticketed here because the follow-up cap is used on N1 to N3 and the trade-off was a recorded decision; **the next run should promote it first** if it is still silent (one IP can keep email sign-in down indefinitely, and the only signal is a log line). Ask for a visible 429 or alert instead of the silent drop. | none (promote next run) |
| 12 | Low | **new** | The HTTP to HTTPS 301 is built from `req.hostname` (`server.js:1063` ✔︎). Under `trust proxy 1` that honours `X-Forwarded-Host`, and the redirect runs before `defaultCacheControl`, so it also skips `no-store`. This is why LIN-3692 and LIN-3643 are only partial. Reach depends on whether the edge forwards a client-supplied header (not verified). | LIN-3643 (comment) |
| 13 | Low | **correction to 18 Oct layer 6** | The `local` spawn has **no owner gate**: `isRunnerTarget('local')` is false (`lib/runner-owner-gate.js:36-40` ✔︎). It relies on an exact `localhost` Host check (`lib/dispatch-entrance.js:245`) plus `/dev/tty`. The server binds all interfaces (`server.js:4577`). It cannot happen on a hosted deploy (no tty). Command-execution class, so worth knowing. | report only |
| 14 | Low | **new** | Public `/kpis`: the small-count floor covers counts of people only (`lib/kpi-stats.js:1227-1232`). Daily, weekly and running arrays publish values 1 to 4 exactly, which contradicts the privacy page's "fewer than 5" wording (`lib/render-legal.js:132`). `cost.tasks` is exact and `perTaskUsd` refreshes every 60 s, so two snapshots difference down to one task's cost. | report only |
| 15 | Low | **new** | Stale public-DB instructions after the Railway change: `docs/runbooks/harbour-degraded.md:86-141` (no banner) still tells operators to use `MONGO_PUBLIC_URL`; `docs/operator-execution.md:23` is bannered as history but `:51-65` still carries the commands; usage comments in `scripts/drop-funnel-events-collection.mjs:24-25` and `scripts/lin3014/measure.template.js:11` too. No runtime code reads `MONGO_PUBLIC_URL` (git grep: docs and script comments only). | report only |
| 16 | Low | **new** | LIN-3700 hazard: registry rows share the `workspaces` collection with durable rows (`_id: urlKey`, `lib/workspace-store.js:96-118` ✔︎; `idChanged` is computed and never read). After the LIN-1330 cutover `getWorkspaceByUrlKey`'s `findOne({urlKey})` could return a registry row. Dormant. | LIN-3394 (comment) |
| 17 | Low | **new** | Erasure (LIN-3423) is operator-only, dry-run by default, and needs `--confirm <planId>`. All 53 collections are in `INVENTORY` (`lib/account-erasure.js:124-175`) with a runtime `listCollections` drift check. Documented gaps: session rows with no `accountId` (they can hold provider tokens), ownerless tokens, `free-tier-usage` until its TTL. | report only |
| 18 | Low | **new** | `lib/render.js:780` puts `issue.url` and `linkText` in unescaped (provider-sourced; CSP backs it). CI-wake check names have a count cap but no length cap (`lib/ci-wake-sweep.js:97-110` ✔︎). Custom templates interpolate raw while built-ins pass the same fields by reference (`prompt-templates.js:98-106`). `lib/bash-tool.js` runs `sh -c` unsandboxed but nothing outside tests imports it (latent sink). `git clone "${repo}"` does not reject a leading `-` (`lib/harbour-spawn.js:113`, owner-only). | report only |
| 19 | Low | unchanged, **re-rated** | LIN-619 `SESSION_SECRET` fallback (`server.js:204-207`, warns, does not fail). Production is rotated and known to be set. The residual is a silent fall-back to a public default if the variable is dropped in a future rotation. Low. | LIN-619 |
| 20 | Low | carried | Vendored `public/*.min.js` (DOMPurify 3.2.4, marked 17.0.1, Chart.js 4.5.1) sit outside `package.json`. Advisory check needs network. | report only |
| 21 | Low | unchanged | OpenRouter callback has no `state`; the PKCE verifier is bound to the session. | LIN-676 |
| 22 | Low | decided | Tokens and `/t/` links outlive logout (LIN-3617) and the proxy resolver reads expired session rows (LIN-3616). Both were closed on 19 Oct **as decisions with no code**: they are "decided", not "fixed". The same raw `sessions` reads now also sit in `lib/ci-wake-sweep.js:138` and `lib/observer-pass.js:506`; the window is still at most 1 h (`lib/hourly-cleanup.js:86`). | LIN-3617 / LIN-3616 |
| 23 | Low | carried, not re-traced | LIN-737, LIN-3425, LIN-2530, LIN-2642, LIN-1912, LIN-3593. They were not re-read this run and are not re-rated. | as listed |

## Fix-claim table

| Ticket | Claim | At HEAD | Mutation check (research pass, reverted) |
|---|---|---|---|
| LIN-3642 `bc875ddc` | Linear callback requires `state` | **Holds.** `routes/auth.js:140` ✔︎ `if (!state \|\| state !== req.session.oauthState)`. Missing, empty, array, object and replayed `state` are refused. | Drop `!state`: 2 of 34 fail |
| LIN-3634 `ff479045` + LIN-3657 `1ba54841` | Head-moved close-out refusal | **Holds on the session and press lanes; partial overall.** `lib/dispatch-entrance.js:1167-1195`, `routes/workspace-api.js:3739-3748`, `lib/close-out-readiness.js:125-145`. The dispatch-grant lanes (proxy `/dispatch`, recommend-and-dispatch, kickoff) still admit a close-out; the code defers them to LIN-3417 (`:1177`). It checks at enqueue, not at take. | Stage off: 6 fail; press guard off: 3 fail |
| LIN-3635 `ea96357a` | Feedback intake gated, limited, narrowed | **Holds.** Gate `routes/workspace-api.js:3159`; limiter `:651-662`, mounted before auth and the parser; `text/plain` only (`:2961`), still 12 MB (`:640`). | Gate off: 3; any-type: 2; limiter: 1 |
| LIN-3617 / 3616 | Token lifetime and session-row liveness | **Decided, no code.** See #22. | n/a |
| LIN-3618 `d8c14f6d` | 90-day dispatch-token TTL | **Holds.** `lib/dispatch-tokens.js:35`, wired at `server.js:391`. Legacy owned tokens never expire; the ownerless-expiry script is manual. | TTL nulled: 1 fail (source-shape test only) |
| LIN-3619 `5359866c` | Revocation on unlink and removal | **Holds.** `server.js:1450`, `:1766`, `:4344`. | Revoke calls off: 6 fail |
| LIN-3627 `e204e258` | CSP on email-confirm pages | **Holds.** `routes/email-auth.js:117-123`, applied `:527`, `:563`. | CSP reverted: 1 fail |
| LIN-3692 `331683f3` / LIN-3643 | HSTS, `no-store`, one public origin | **Partial.** 25 `publicOrigin()` sites are clean and `PUBLIC_ORIGIN` is set in production (LIN-3709). The 301 is not (#12). | publicOrigin off: 3; HSTS off: 2 |
| LIN-3700 `a6e0ae11` | urlKey written to the registry | **Does not close LIN-3394.** Last-writer-wins upsert; no unique `urlKey` index (`lib/db-indexes.js:455-458`), no legacy backfill. | Writer off: 14 of 41 fail |
| LIN-3706 `0eb4a2d1` / LIN-3658 | Free-tier plan and allowance in one seam | **Holds, except LIN-3422.** The free key is read only through `getFreeTierKey` (`lib/chat-request.js:60`). All 30 `resolveChatCredential` sites were traced; only precompute is ungated. **No test enforces the census**, so a new spender would not fail CI. | none possible (no census test) |
| LIN-3622 / 3673 / 3655 / 3677 | Runner polls and takes session targets only; one total owner check; throwing owner answer fails closed; unknown `followUpTarget` refused | **Hold.** Take is filtered inside the atomic delete (`routes/proxy-runner.js:148-152`); poll at `:114`. Every owner gate goes through `readOwnerSeamStatus === 'owner'` (`lib/workspace-owner.js:102-149`). | 2; 24 of 192; 15 of 235 fail |
| LIN-3771 `c6c5585a` | Rate limit and challenge on `POST /auth/email/send` | **Holds against the observed bot.** The "challenge" is a non-consumed send nonce (`routes/email-auth.js:431`, 15 min), a honeypot (`:440`) and a 2 s minimum form time (`:441`), then per-address 15-min and 24-h caps and the global ceiling. A script that fetches the form first passes the nonce and timer, so this stops form-spam bots, not a targeted client. The per-IP limiter is in memory (`:89-104`), keyed on `req.ip` under `trust proxy 1` (`server.js:1055-1057`), so it is not spoofable by `X-Forwarded-For` if Railway is the single hop (**topology not verified**). No enumeration oracle. `EMAIL_TRANSPORT=off` gives 503 on all six routes. | not run |

## Classes and how each was bounded

- **Free-tier spenders.** Every `resolveChatCredential(` and `getFreeTierKey` site: 30. One ungated (LIN-3422).
- **New HTTP routes since `e2cc2ef0`.** Diff grep for route definitions: 4. `GET /workspace/:urlKey/kpis` (gated by `workspaceFromUrl`, `routes/workspace-kpis.js:29`; an empty `urlKey` throws, `lib/workspace-kpi-stats.js:138`; all nine reads filter by `urlKey`; the client uses `textContent`), the feedback limiter, and 2 test-only routes. New proxy routes: 0. Added-line `fetch(`: 0.
- **`scripts/scan-public-pages.mjs` coverage.** `/kpis` is in `lib/scan-public-pages.js:23`. The workspace KPI page is authenticated, so it is out of that scanner's reach by design.
- **Owner gates.** Every `readOwnerSeamStatus` site: all fail closed. Target skips: `dash` and `local` (#13).
- **Prompt sinks.** About 16 builders, via consumers of `formatIssueContext(` (5 files), `generatePrompt(` (8 files) and the 22 files in `lib/prompts/`. **0 delimiters around untrusted fields** except the file-pointer block (`lib/file-pointer.js:107-131`, allowlist and markers, "dropped, never escaped"). Not covered in depth: the roadmap, `collective-participant` and `ship-biscuit-editor` builders.
- **Authority read from comment text (LIN-3386).** 6 members: rulings, review and ledger comments, run-evidence PR URLs, the selector's "ruling" label, close-out readiness, CI-wake PR resolution.
- **Consumers of the secret scanner.** 5: `/t/` masking, dispatch-session redaction (bootstrap only), run proposals, the CI source scan, the public-page scan.
- **Token revocation paths.** 6. Logout: no, by decision. Last-binding unlink: yes. Involuntary removal: yes. Erasure: yes. Merge: no, by design. Workspace delete: no route exists.
- **Mongo collections vs erasure.** 53 of 53 covered.
- **Mongo operator injection.** 598 query sites; 5 take `req.*` directly (3 are `Array.find`, 2 test-only); about 25 indirect flows are type-checked or `String()`-coerced. `qs` extended is on, so protection is per route. No finding.
- **Host-header readers.** The 301, the `publicOrigin` fallback, the `isLocalhost` UI toggles, the `local` target check.
- **Token mint sites.** 5, all unprefixed 32-byte (relevant to N3). `declaredGrants:` sites: 5.
- **Operations needing more than `readWrite`.** Only `planCacheClear` in `scripts/explain-paged-lists-lin3163.js:217`. For LIN-3772 the app runtime needs only `readWrite` on `linear-viewer` (index and collection management, no `admin()`, `serverStatus`, `listDatabases` or change streams); `authSource` must match where the user is created.

## Credentials (tracked tree and full history)

Built-in `git` only. Tree: `git grep -nIE` over `HEAD`. History: `git log --all --no-merges -p -G'<pattern>'`, excluding the committed `_evidence*` dirs, plus the research pass's wider run (5,674 commits under `--all`, 1,065 merge `--cc` diffs, 3 stashes, 4,985 tracked files).

Patterns used: the `lib/secret-scan.js` set, plus the types it lacks (N3): Resend `re_`, Atlassian `ATATT`/`ATOA`, `mongodb(+srv)://user:pass@`, `ghr_`, PEM headers, bare 43-character base64url, and `KEY=`/`SECRET=`/`PASSWORD=`/`TOKEN=` assignments.

**Result: no live secret in the tree or in any commit.** In this run's history pass, `re_`, `ATATT`, `ATOA` and `ghr_` gave 0 added lines; Mongo URI-with-password gave 6 added lines and PEM headers gave 6. Every one is a **fixture**, told apart by shape: `user:`/`admin:` with a throwaway placeholder password at `host` or `db.example.test`, in `tests/unit/{erase-account-script,lin-3700-registry-sites,workspace-registry}.test.js`; PEM headers followed by `AAAA` or an `MIIE…` alphabet run in scanner and GitHub-App-key tests (`b540900d`, `293bc936`, `5783028e`, `48e72dad`). `docs/operator-execution.md:30` uses `$MONGOUSER:$MONGOPASSWORD` shell variables. The committed `docs/reviews/_evidence-2026-10-21/*.json` hold `/t/` tokens and a `connect.sid` minted on `localhost:3197/3199`, i.e. dead local test artifacts. The research pass also confirmed the local ignored `.env` values were never committed (fixed-string search of all history: 0 hits).

Nothing needs rotating or removing on the strength of this scan, and no history rewrite is proposed. **Caveat:** the scan can only find patterns it knows. Resend `re_` and the other N3 types are exactly what Harbour's own scanner cannot recognise, so a clean result for those types rests on the patterns above, not on a scanner Harbour trusts.

**Railway incident, what the code assumes.** No runtime code reads `MONGO_PUBLIC_URL` or a public proxy route (#15 is docs and script comments only). `SESSION_SECRET` is covered by #19. There is no maintenance mode (LIN-3770); the only kill switch is `EMAIL_TRANSPORT=off`.

## Per-layer audit

1. **OAuth callbacks.** Linear fixed (LIN-3642). GitHub and Jira require the nonce. OpenRouter relies on PKCE (LIN-676).
2. **Email sign-in.** Multi-layer throttled; confirm flow unchanged and clean. Residuals #11, and the limiter topology in "Not verified".
3. **Sessions and cookies.** `trust proxy 1`; LIN-619 Low; LIN-3616 decided.
4. **Session-lane isolation.** One new route, gated. Clean.
5. **Proxy-lane isolation.** No new proxy routes; 28 write routes across 9 files all carry write scope. Clean.
6. **Runner and grants.** Poll and take filtered; owner seam total and fail-closed. Open boundary: N1.
7. **Prompt assembly and injection.** See below.
8. **Close-out.** Session and press lanes re-derive readiness. Dispatch-grant lanes bypass (LIN-3417). Readiness consumes forgeable text (#1).
9. **`/t/` shares.** Unchanged, but N3 now matters more after the incident.
10. **KPIs.** Public: #14. Workspace: clean.
11. **Erasure.** #17.
12. **SSRF and outbound.** No new fetchers beyond paginated `/user/installations` and CI-wake PR reads. LIN-684 unchanged.
13. **Misconfiguration.** CSP holds. HSTS and `no-store` landed but the 301 bypasses both (#12).
14. **Dependencies.** No drift; vendored libraries unaudited.

### Prompt injection: boundaries are prose, not technical

Prompt injection is in scope this run. **No prompt builder carries tracker text as fenced or labelled data**; the only strict data boundary is the file-pointer block. Several builders do the opposite and *elevate* tracker text: `lib/prompt-formatters.js:171` calls description and comments the "source of truth", `lib/proxy-preamble.js:268` says the brief "supersedes", and `lib/brief.js:38` says a comment saying the approach changed overrides the description. The brief is then served to workers as authoritative, which is a laundering step.

Who can write the text: on a workspace bound to a public GitHub repo, any GitHub account (public repos are bindable, `lib/providers/github/index.js:670`; the mapper keeps `login` and drops `author_association`, `:416-427`). The code itself says the author cannot tell agent from person (`lib/recommendation-facts.js:41-45`).

Blast radius if injected text is obeyed: a worker holds a 48 h workspace-wide `readWrite` token (edit, comment, mark issues Done). Autopilot, kickoff and "+ Autopilot" children also hold `dispatch` (`lib/dispatch-entrance.js:739`, `:776`, `:1081`). On a runner host the subagent has a shell plus the owner's git and `gh` credentials, so it can push and merge; the server itself never merges (LIN-3417). Per N1, the "leaf worker cannot enqueue" boundary does not hold on runner-kit hosts.

**Technical boundaries that do hold:** `requireGrant('dispatch')`, owner-only take, the owner gate on follow-ups, `guardCloseOut`, propose-only proxy Flight Companion turns, the router's closed vocabulary, the broker's `/api/proxy/*`-only allowlist with no mint.

**Aspirational text, not a boundary (rate accordingly; LIN-3402 / LIN-1374):** `lib/proxy-preamble.js:177`, `:332`, `:341` ("merge and Done are gated … on a recorded review Approve"); `prompt-template-defs.js:1071` ("A recorded review Approve is your authority to finish"); `runner.mjs:878` ("You never hold a token", contradicted by N1); the broker's write-intent header.

**Data-versus-instruction pairs found:** custom templates (raw) versus built-ins (by reference); the file-pointer block (strict) versus titles (raw); `Additional context from the human` in the scoped kickoff (`autopilot-kickoff.js:702`) versus the same text elsewhere.

## Not verified (needs production or a browser)

- Whether the edge forwards a client-supplied `X-Forwarded-Host` (decides #12) and `X-Forwarded-For` (decides the per-IP limiter claim). Whether Railway is the single proxy hop behind `trust proxy 1`.
- Whether the non-root Mongo user `lin3014_read` still exists in production (N5).
- Which production workspaces are bound to public GitHub repos (decides how wide #1 and the injection reach are).
- `npm audit` against the live registry, and upstream advisories for the vendored DOMPurify, marked and Chart.js.
- The live CSP in a browser on `/t/`, the task page and the run page.
- Whether production sets `NODE_ENV=production` and `OPENROUTER_FREE_TIER_KEY` (the research pass recorded `PUBLIC_ORIGIN` as set, per LIN-3709).
- Any CDN caching of `Host`-derived responses.
- LIN-737, LIN-3425, LIN-2530, LIN-2642, LIN-1912 and LIN-3593 were not re-traced (#23).

## Follow-ups

Existing tickets searched before minting (queries: `runner.token`, "same-user", `lin3098`, "playbook injection", "secret-scan Resend", "mongodb:// secret-scan masking", `lin3014_read`, `X-Forwarded-Host`). Nothing existing names N1, N2 or N3: LIN-3098 is Done and is the runner prompt; LIN-2625 is Done and is the playbook memory feature; LIN-2853, LIN-2850 and LIN-2852 are scanner-coverage siblings that do not list these types.

- **Escalate by comment, not re-filed:** LIN-3386 (class grew by two consumers, public repos make the attacker anyone), LIN-3772 (fold in the `lin3014_read` check, N5), LIN-3643 (the 301 `req.hostname`, #12), LIN-1374 (N4).
- **New tickets (3):** N1, N2, N3. They are **LIN-3778** (N1), **LIN-3779** (N2) and **LIN-3780** (N3).
- **Report only:** everything else above, including N4 and the Lows, so the next run can promote what still matters.

## Departures from the periodical template

- The research pass (ticket comment, 23 Oct) was done by a separate agent before this run. This run did not repeat its mutation checks; it re-read the cited lines (✔︎) and re-ran the credential scan and the open-item traces. Its fix-table mutation counts are quoted, not re-measured.
- The second read below is Tier 2 (fresh-context sub-agent). The seed ticket allowed Tier 1 or 2.

## Adversarial Second-Read

**Tier: 2** (fresh-context sub-agent, no memory of the report-writing turn; it read the code at HEAD itself and spot-checked six cited lines, no mutation runs).

**Question:** What is the largest item in this window that this report missed or misfiled?

**Reader's answer (condensed, nothing material dropped):** The cited lines checked out. The largest item is #11, the LIN-3771 global send ceiling (`lib/email-auth.js:51-52`, enforced `routes/email-auth.js:495`; per-IP limit 10 per 15 min at `:89-104`). One unauthenticated IP can exhaust the whole 10-per-hour budget, the nonce and 2 s timer are passable by fetching the form first, and the refusal is the normal "check your inbox" page, so real users get no mail and no error; repeating hourly holds sign-in down indefinitely, with only a log line as signal. The reader calls the mitigation the weakness, rates it Medium-High for availability, and wants it ticketed rather than "accepted". LIN-3386 is correctly High but old: "grown" rests on two new consumers (`lib/run-ledger.js:49-56` and `lib/ci-wake-sweep.js:68-85` confirmed). The "High (tracker)" labels on LIN-3273 and LIN-3281 contradict the prose; the reader agrees with the prose (`routes/proxy-rulings.js:225-247` filters `loops` by `urlKey`). #12 is correctly Low (`server.js:1063`; `trust proxy 1` only in production, `:1056`). LIN-3635 holds.

**Response:** Rows 4 and 5 re-rated to match the prose. Row 11 re-worded to carry the reader's rating and a promote-first instruction for the next run. Not ticketed now: the follow-up cap is spent on N1 to N3, and the reader's own Medium-High rating still leaves N1 to N3 as Medium; the reader's severity call is recorded, not adopted.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
