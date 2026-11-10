# Dependency & Supply-Chain Review — 2026-11-10

**Task:** LIN-4412 (periodical run — delta vs the 2026-10-23 review)
**Altitude:** supply chain and provenance: lockfile trust, name proximity, tree growth, runtime additions and their justification, browser-library provenance, runtime service trust and CI provenance. The Security Review (LIN-4411 next) owns generic CVE scope. The audit is re-run here only as the baseline that frames the work.
**Repo HEAD measured:** `008d38bb088ca824f433940a227bffc27f3a60a1` (`origin/main`, "Merge pull request #2391 …"). Nothing had landed after the ticket was created (2026-11-10T13:16Z), so the re-ground check was clean.
**Sibling measured (read only):** `JKershaw/simple-dispatcher` at `5d8489e`. Not edited.
**Baseline and prior runs:** `dependency-supply-chain-review-2026-06-25.md` (LIN-670, `8de7da5`) and `dependency-supply-chain-review-2026-10-23.md` (LIN-3786, `2a26c7b1`).
**Mode:** review only. No manifest, lockfile, configuration or code changed. No `npm audit fix`, `npm update` or lockfile-rewriting install was run.
**Tooling:** Node 25.9.0, npm 11.12.1 (local). Node 24, the declared production line, was not available locally.
**Text evidence:** `docs/reviews/_evidence-2026-11-10-supply-chain/` (`audit-advisories.txt`, `lock-and-install-checks.txt`).

---

## Instruments run

All run 2026-11-10 at `008d38bb0`, except the sibling audit, which used `--package-lock-only` against the sibling lockfile.

| Instrument | Result |
|---|---|
| `npm audit --json` (full tree) | **7 packages (1C/4H/2M)** · **15 advisories (1C/4H/8M/2L)**; metadata prod 106 / dev 6 / optional 2 / total 112 |
| `npm audit --omit=dev --json` | identical to the full tree |
| `npm ci --dry-run` | exit 0; lockfile not rewritten |
| `npm ls --all` | exit 0; UNMET entries are optional peers only (7 under `mongodb`, `encoding` under `graphql-request → cross-fetch → node-fetch`) |
| `npm audit signatures` | **112 of 112** registry signatures verified; 9 packages with attestations |
| `python` over `package-lock.json` | 113 entries including root (112 resolved packages excluding root); 0 non-registry `resolved`; 0 missing `integrity`; 7 nested duplicates (unchanged from 10-23) |
| Root entry of `package-lock.json` | no `engines` field, although `package.json` declares `engines.node: "24"` (see F10) |
| `shasum -a 256` of served browser files | DOMPurify `cd37898f9782adf5` (banner 3.4.17); marked `e131975cfd9e6fd1`; Chart.js `48444a82d4edcb5b`. marked and Chart.js hashes match 10-23 |
| Embedded versions in the served Chart.js file | `@kurkle/color v0.3.2` inlined; installed `@kurkle/color` is 0.3.4 (see F4) |
| `npm view` / npm downloads API / `gh api /advisories` | provenance of the four new lock entries; advisory text and publish dates |
| Sibling `npm audit --package-lock-only --json` | **2 packages high**: `undici@7.28.0` (23 advisories, 7 high; fix ≥7.30.1) and `zod@4.3.6` (1 high, GHSA-mrhx-c7xc-m3w5; fix 4.6.6) |
| Guards (run at HEAD, see Verification) | `area-notes`, `vendor-assets`, `node-version-pin`, `lin-688-undici-not-a-dependency` |

Package counts and advisory counts are reported separately throughout. `npm audit`'s `metadata.vulnerabilities` counts **packages**. Advisory counts are taken from each package's `via` list, de-duplicated by URL.

## Re-grounding (the ticket's leads, checked live)

| Lead | Live at HEAD | Verdict |
|---|---|---|
| 7 packages, 1C/4H/2M | 7 packages, 1C/4H/2M | ✓ |
| Which package escalated? | **`body-parser`**: new high **GHSA-27r3-jxmh-p828** (trailing bytes after a compressed request body), published 2026-10-23T20:53Z, hours after 10-23 measured | answered |
| Advisories 13 → ? | **15** (1C/4H/8M/2L): +GHSA-27r3 (body-parser, high), +GHSA-6pq8-jhm2-2vcw (qs, moderate) | worsened |
| Lock 109 → 113 with four new entries | 113 entries including root; `chart.js`, `dompurify`, `@kurkle/color`, `@types/trusted-types`; nothing removed | ✓ |
| "107 → 108 → 113 resolved packages" | **corrected to 107 → 108 → 112 resolved packages**; 113 is lock entries including root | lead corrected |
| `@types/trusted-types` optional or runtime? | `"optional": true` (a `dompurify` optional dependency); type definitions only | answered |
| Runtime 12 / dev 4 | 12 direct runtime, 4 direct dev | ✓ |
| `trust proxy` hop count | `app.set('trust proxy', 1)` in production only (`server.js`, moved from the 10-23 line) | ✓ |
| Parser limits (10-23 cited 250kb / 14mb / 12mb literals) | reshaped: global `express.json({limit:'250kb'})` and `express.urlencoded({extended:false})` in `server.js`; route-scoped `json({type:'text/plain', limit: FEEDBACK_BODY_LIMIT})` in `routes/workspace-api-feedback.js` and `json({type: () => true, limit: ATTACHMENT_UPLOAD_BODY_LIMIT})` in `routes/proxy-writes.js`; a test-only 4mb parser on `/test/set-local-session` | template updated |
| CI pins (`checkout`, `setup-node`, `upload-artifact` at `@v4`; Playwright and Mongo images by tag; no `permissions:`) | all unchanged in `test.yml` and `secret-scan-scheduled.yml` | ✓ |
| mangodb `^0.1.2`; 0.1.3/0.1.4 adopted? | still locked at 0.1.2 | ✓ (not adopted) |
| Sibling undici 7.28.0 | still locked and imported; advisories now **23** (7H/13M/3L), was 15 (3H) | worsened |

## Scope audit (§0): surfaces the scope did not name

The ask requires looking for surfaces the remit does not name. What was found, and where it lands:

- **Runtime services reached by bare `fetch` with no npm package:** Resend (`lib/email-transport.js`, F7) and Yap (`lib/yap-client.js`, F6). Yap was missed by both earlier reviews. Host diff against 10-23: the only change in the set of `https://` hosts across `lib/`, `routes/`, `server.js` and `public/` is that the `www.chartjs.org` banner is gone. No new service arrived in the window.
- **Anything that downloads at run time:** no third-party CDN. A grep for CDN hosts (`cdn.`, `unpkg`, `jsdelivr`, `cdnjs`, `esm.sh`, Google Fonts) over `lib/`, `routes/`, `public/` and `server.js` returns nothing. One first-party run-time fetch does exist: the runner kit. `GET /runner-kit/:file` serves `broker.mjs` and `runner.mjs` from `lib/runner-kit/`, which a person's runner downloads and executes (F15). `public/fonts/` is unchanged in the window, so LIN-1651 is untouched.
- **Runtime platform:** the production build and run environment is Railway. Its security disclosure and Harbour's rotation response are in `docs/incidents/2026-10-22-railway-security-disclosure.md`, created before the 10-23 base by `8e59ed62` (missed by the 10-23 run); amended in the window by `040a3e76` (preliminary report, 23 Oct rotation, GitHub App check) (F0).
- **Environment-built service URLs:** checked against `docs/architecture/configuration.md`. `YAP_BASE_URL` and the GitHub base variables are documented. **`OPENROUTER_API_URL` is not** (F8). It is read at `lib/openrouter.js` and overrides the endpoint that receives the OpenRouter bearer token. `JIRA_OAUTH_TEST_BASE` is undocumented but only active under `NODE_ENV=test` (`lib/providers/jira/oauth.js`); it is not a finding.
- **Other parser mounts:** the four product mounts and the test-only ones listed above. A grep for `express.json(`, `express.urlencoded(`, `express.raw(`, `express.text(` and destructured `json({` covers them.
- **CI image and action pins:** in scope (F5).
- **Changed-file window:** `git diff --name-only 2a26c7b1..HEAD` lists **4,673 files**. Mapped through `docs/areas/areas.json` (first match wins): **437** fall in registry areas (`runs-and-dispatch` 82, `front-end-pages` 74, `front-end-browser` 73, `llm-and-prompts` 56, `web-routes` 37, `auth-accounts-and-workspaces` 33, `agent-api` 27, `other-features` 21, `reports-and-operator-tools` 13, `providers` 11, `platform-and-plumbing` 7, `task-model` 2, `wiring` 1). The other **4,236** are outside the registry by design, since it covers code only: `docs/` 3,158, `tests/` 959, `scripts/` 41, `prototypes/` 39, `experiments/` 27, and a handful of root files. The dependency-relevant paths in the window are `package.json`, `package-lock.json`, `.nvmrc`, `.github/workflows/*`, `lib/vendor-assets.js`, `lib/email-auth.js` (sign-in) and `lib/yap-client.js`.

Nothing in the window adds a new scanner or a new third-party CDN. The runner kit is a first-party run-time download (F15).

## Findings (severity-ranked)

Ranking is by consequence, with reachability shown beside severity. Severity labels: **Medium** means a plausible path to harm under stated conditions; **Low** means posture or exposure with no demonstrated path; **Info** means recorded for the trend.

### F0 — `railway-build-platform-trust`  ·  **Medium (contained; verification open)**  ·  **new to the record** (ranked first; numbered F0 so the references to F1–F14 stay stable)

Railway is Harbour's build and run platform, so it sits in the runtime service trust this review covers. Its own disclosure (21 October) said an unauthorised third party "may have accessed encrypted environment variables and, for some of them, obtained the decrypted contents". Its preliminary report adds that the attacker escalated through Railway's build infrastructure and reached its CI credentials, and that Railway cannot say which variables were decrypted. Source: `docs/incidents/2026-10-22-railway-security-disclosure.md`, which records the response; it was created before the 10-23 base by `8e59ed62` (missed by the 10-23 run); amended in the window by `040a3e76` (preliminary report, 23 Oct rotation, GitHub App check).

- **Response, on the record:** Harbour treated every Railway variable as exposed and rotated them on 23 October (about 08:15Z). The rotated set includes `GITHUB_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY`, `RESEND_API_KEY` (replaced with a Sending-only key restricted to the domain), the MongoDB password and the Linear client secret. Email sign-in was switched off with `EMAIL_TRANSPORT=off`. The record states no misuse of Harbour's credentials or database was found.
- **What stays open:** the GitHub App private key could mint installation tokens for every account that installed the app, not only John's. The incident record lists the app's installations and recent deliveries for 20–23 October as a check for John at github.com. This review did not and could not perform that check. Nothing in the repository proves it was done.
- **Why it is a supply-chain item here:** the deployed artifact is built on Railway's infrastructure from this repository's lockfile. A lockfile verified in the repository does not, by itself, prove what Railway built and ran during the window. This is why F10's clean result and F3's pin cannot be read as production provenance.
- **Verdict on rank:** this is the largest item in the window for this altitude. Its consequence (every runtime secret treated as exposed) is far larger than any single advisory, and the open GitHub App check is the one step in the window that still needs a person.

### F1 — `npm-advisories-runtime`  ·  **Medium (effective)**  ·  **worsened**

At HEAD: **7 packages (1C/4H/2M)**, **15 advisories (1C/4H/8M/2L)**, identical with and without dev dependencies. All seven packages have a fix in range (`fixAvailable: true`), so LIN-620's non-breaking lockfile refresh still clears them. body-parser 1.20.9 satisfies express 4.22's `~1.20.x` range.

| Package@locked | Worst advisory | Delta vs 10-23 | Reachability at HEAD |
|---|---|---|---|
| `body-parser@1.20.4` | **GHSA-27r3-jxmh-p828** (high): trailing bytes after a compressed body are re-thrown as an uncaught exception | **new, the escalation** (low → high) | **Code path reachable, pre-authentication.** Every app parser uses the default `inflate: true`: the global `express.urlencoded` and `express.json`, mounted before session and routes, plus the two route-scoped `json()` parsers. The `uncaughtException` handler in `server.js` logs and keeps the process alive, so the process-termination consequence is absorbed there. **Spike, not production validation:** on Node 25.9, with the repo's own express, gzip, deflate and br payloads with trailing bytes (single write and split writes) did not terminate the process, even with the backstop removed. Node 24 was not tested, so the advisory's termination claim is neither confirmed nor refuted for the production line. Review re-ran the naive trigger on Node 24.22.2 without the backstop: gzip 400 / deflate 200 / br 415, process alive (LIN-4412 review). No first-party client sends compressed bodies (`lib/runner-kit/broker.mjs` strips `content-encoding`), so `inflate: false` would be safe. This is the only advisory in the set with a reachable path. |
| `body-parser@1.20.4` | GHSA-v422 (low): invalid `limit` disables size enforcement | unchanged | Not reachable: every limit is a valid literal or a computed positive number. |
| `express-rate-limit@8.2.1` | **GHSA-46wh-pxpv-q5gq** (high): IPv4-mapped IPv6 addresses bypass per-client limiting | unchanged; **exposure narrowed** | **Conditional** on production `req.ip` being `::ffff:`-mapped, which is unverified at the edge. Ten IP-keyed limiters: `routes/dispatch.js` (×4, default key), `routes/email-auth.js` (sign-in), `routes/task-mode.js`, `routes/proxy.js` (`proxyTokenCreationLimiter` and `defaultCopyTokenCreationLimiter` by account, else IP; `proxyLimiter` now keyed by proven credential, falling back to IP only for unproven tokens since LIN-4378, `f7d1923e6`), and `routes/workspace-api-feedback.js` (`feedbackSubmitLimiter`, account else IP). The flight-companion limiters key on token and URL and are unaffected. Impact is availability: one client can throttle all IPv4 users, including sign-in. |
| `proxy-addr@2.0.7` | **GHSA-jqcg-44mw-7w3h** (critical): IPv4-mapped IPv6 trust-subnet spoofing | unchanged | **Not reachable.** The app uses hop-count `trust proxy 1` in production; no subnet trust is configured. |
| `ip-address@10.0.1` | GHSA-mwp4-54f8-5fhr (high), plus five moderate advisories | unchanged | Low. Its sole consumer is `ipKeyGenerator(req.ip)`; no SSRF or access decision rides on it. |
| `path-to-regexp@0.1.12` | GHSA-37ch-88jc-xwx2 (high, ReDoS with multiple params in one segment) | unchanged | **Not reachable.** No route literal in `server.js` or `routes/` has two parameters in one segment. |
| `qs@6.14.1` | GHSA-6pq8-jhm2-2vcw (moderate, new) and three others | **worsened** (count) | Not reachable. Express 4's default query parser runs `qs.parse` on every request, but GHSA-6pq8, GHSA-q8mj and GHSA-4mjr trigger only in `qs.stringify`, which neither the app nor express calls, and GHSA-w7fw needs `comma: true`, which express does not set; `urlencoded` is `extended: false`. |
| `express@4.22.1` | rollup, via `qs` | unchanged | n/a |

**LIN-620 reconciliation.** LIN-620 is still Backlog and its list is stale. Its last comment (10-23) added proxy-addr and body-parser. This run adds the body-parser escalation and reachability note, and the qs advisory. Per the ask, the item is reconciled on LIN-620 and not re-ticketed. It is kept out of the area notes.

### F2 — `sibling-simple-dispatcher-undici`  ·  **Low / Medium (sibling)**  ·  **worsened**

Read only; the sibling repo was not edited.

- `undici@7.28.0` is imported by `opencode-runner.js` (`Agent` as a fetch dispatcher). It carries **23 advisories (7 high, 13 moderate, 3 low)**; fix ≥7.30.1. Most high advisories target features the sibling does not appear to use (private-cache directives, WebSocket subprotocols, BalancedPool TLS), and it talks to a local opencode server, so reachability stays low. The count is the change: 15 (3 high) at 10-23.
- `zod@4.3.6` is declared in the sibling's `dependencies`, carries **GHSA-mrhx-c7xc-m3w5** (high, memory exhaustion; fix 4.6.6), and is **never imported**. An unused runtime dependency with a high advisory is supply-chain debt with no reachable path.
- The sibling now has CI (`.github/workflows/ci.yml`, LIN-1456, Done) with `permissions: contents: read`, but it runs `npm ci` and `npm test` only, with no `npm audit`. Its CI pins Node 22 by literal.

### F3 — `node-runtime-eol-unpinned`  ·  **Low**  ·  **improved** (source); production line still unverified

- Source now pins Node 24: `.nvmrc` is `24`, `package.json` `engines.node` is `"24"`, and every `setup-node` step reads `node-version-file: '.nvmrc'` (`.github/workflows/test.yml`, `secret-scan-scheduled.yml`). Guard: `tests/unit/node-version-pin.test.js`. CI no longer runs EOL Node 20.
- **Production is still unverified.** Railpack resolves Node in this order: `RAILPACK_NODE_VERSION` env, then `devEngines.runtime`, then `engines.node`, then `.nvmrc`, then `.node-version`, then mise, defaulting to `lts`. So the pin is honoured only if the Railway service builds with Railpack and has no `RAILPACK_NODE_VERSION` override. Both facts live in Railway settings, not the repo; there is no `railway.json`, `nixpacks.toml`, `Dockerfile` or `Procfile`. `process.version` appears only in a server-side error log, and `/health` returns `{status:'ok'}`.
- Since LIN-688 removed npm `undici`, application `fetch` runs on the undici bundled in Node. The Node line therefore is the HTTP client's supply chain, which is why this stays in scope.

### F4 — `vendored-dompurify-drift`  ·  **Resolved** (one residual blind spot)

- `public/` no longer holds copies of DOMPurify, marked or Chart.js. They are declared in `package.json` (`dompurify@3.4.17` and `chart.js@4.5.1`, exact; `marked@^17.0.1`) and served from `node_modules` by `lib/vendor-assets.js` at the same URLs (LIN-3787, `d81aebd2d`). Guard: `tests/unit/vendor-assets.test.js`, which passes.
- The served files match the locked versions: DOMPurify's banner reads 3.4.17, and the served bytes are the upstream tarball bytes. The old vendored marked and Chart.js bytes are unchanged (same hashes as 10-23), so only DOMPurify's executed bytes changed.
- **Residual blind spot:** `chart.umd.min.js` inlines **`@kurkle/color` v0.3.2**, while the lock installs 0.3.4. The installed copy never executes: the server does not import chart.js, and the browser receives the inlined copy. So `npm audit` audits the declared transitive package, not the bytes the browser runs. This is narrow, but it is the reason a served-bundle check is needed alongside the lockfile check.

### F5 — `ci-action-tag-pinning`  ·  **Low**  ·  unchanged

`actions/checkout@v4`, `actions/setup-node@v4` and `actions/upload-artifact@v4` are pinned by mutable tag. The images `mcr.microsoft.com/playwright:v1.57.0-noble` and `mongo:8.0.32` are pinned by tag, not digest. That is five distinct pins. Neither `test.yml` nor `secret-scan-scheduled.yml` has a `permissions:` block, so `GITHUB_TOKEN` gets the repository default. Mitigations are unchanged: no `secrets.*` reference in the workflows, no `pull_request_target`, and E2E browsers come from the image rather than a runtime download. The sibling's `ci.yml` offers a ready `permissions: contents: read` template. Recorded, not ticketed.

### F6 — `yap-collective-transport`  ·  **Info**  ·  **new to the record** (pre-existing)

`lib/yap-client.js` (created by LIN-450, `2b7ad9398`, 2026-06-13) reaches `DEFAULT_YAP_BASE_URL = https://yap.jkershaw.com` through `createProxyFetch`, with an optional `YAP_PASSWORD`. It is documented in `docs/architecture/configuration.md` (`YAP_BASE_URL`). It is a first-party, experimental (Collective) runtime service on a personal host. It predates both prior runs, and both missed it. Recorded here; the area note for `lib/yap-client.js` (llm-and-prompts) is at its byte cap, so it stays in the report and the closing comment.

### F7 — `resend-email-transport`  ·  **Info / Low**  ·  unchanged

`lib/email-transport.js` (created by LIN-1892 S2, `8b65b4214`, 2026-09-27) POSTs to `https://api.resend.com/emails` through global `fetch` with `RESEND_API_KEY`, for the LIN-3771 email sign-in path. It adds no npm package, so no lockfile instrument sees it. It receives user email addresses and sign-in links and holds a secret key. Positives from the file: the endpoint is a pinned constant, the key comes from the environment, failures log a hashed recipient, and the transport is selected by a `kind` switch with an injected `fetchImpl` and timeout. Since F0, the incident record states the Resend key was replaced on 23 October with a Sending-only key restricted to the domain, and that email sign-in was switched off with `EMAIL_TRANSPORT=off`. `lib/email-availability.js` treats an unrecognised `EMAIL_TRANSPORT` value as off, so the switch behaves as described. Not verified in this run: whether production currently holds `EMAIL_TRANSPORT=off` (not visible from the repository), Resend account posture, and fallback when the service is down. Service-trust question for the Security Review altitude; recorded here.

### F8 — `undocumented-outbound-url-override`  ·  **Info**  ·  **new**

`lib/openrouter.js` sets `OPENROUTER_API_URL` as an override of the OpenRouter chat endpoint, defaulting to `https://openrouter.ai/api/v1/chat/completions`. The override exists so the hermetic suite can point at a fake. It is **not** listed in `docs/architecture/configuration.md`, and it is not gated by `NODE_ENV`. The bearer token (`Authorization: Bearer ${apiKey}`) is sent to whatever URL it names. The risk requires an operator to set the variable, so it is Info. Recommended: document it, or gate it under `NODE_ENV=test` as the Jira test override is. The area note is `llm-and-prompts`, which is at its byte cap, so this stays in the report and the closing comment.

### F9 — `new-packages-this-cycle`  ·  **Info**  ·  four additions, justified

| | `dompurify@3.4.17` | `chart.js@4.5.1` | `@kurkle/color@0.3.4` | `@types/trusted-types@2.0.7` |
|---|---|---|---|---|
| Kind | direct runtime, exact | direct runtime, exact | transitive runtime (chart.js `^0.3.0`) | transitive, **optional** (dompurify `optionalDependencies`) |
| First publish / this version | 2014-05-21 / 2026-10-12 | 2014-07-08 / 2025-10-13 | 2020-02-05 / 2024-11-19 | 2019-01-19 / 2023-11-21 |
| Weekly downloads (11-03 to 11-09) | 99.5M | 16.7M | 14.2M | 94.6M |
| Maintainers | cure53 (sole) | nnnick, tannerlinsley, etimberg, simonbrunel, chartjs-ci | **kurkle (sole)** | DefinitelyTyped (Microsoft) |
| Repo | cure53/DOMPurify | chartjs/Chart.js | kurkle/color | DefinitelyTyped |
| Latest | 3.4.17 | 4.6.1 | 0.6.5 | 2.0.7 |
| Licence | MPL-2.0 OR Apache-2.0 | MIT | MIT | MIT |

Integrity strings match `npm view dist.integrity` for all four. Names are canonical, so there is no typosquat or slopsquat proximity. Watch item: `@kurkle/color` has a sole maintainer and released a burst in September–October 2026 (0.5.1 to 0.6.5). None of those is adopted, because chart.js pins `^0.3.0`.

**Minimal-runtime verdict: justified** (see §4). Recorded as **Info**, not a finding against the change.

### F10 — `lockfile-integrity`  ·  **Info (clean)**  ·  unchanged, plus one metadata note

- `npm ci --dry-run` exits 0. Every resolved entry comes from `registry.npmjs.org` with integrity. The seven nested duplicates are the same benign set as 10-23. `npm audit signatures` verifies 112 of 112.
- **Root-metadata drift:** the lock's root entry lacks `"engines": {"node": "24"}`, which LIN-3788 added to `package.json` without refreshing the lock root. A scratch-copy regeneration of the lock differs only in that field. `npm ci` does not check it, so it is cosmetic, but it is an entry a clean install would produce differently. Remediation for the person: a lock refresh that adds it, via a normal install (not run here).

### F11 — `mangodb-first-party-trust`  ·  **Info**  ·  unchanged

`@jkershaw/mangodb` is still locked at `0.1.2` under `^0.1.2`. Upstream has published 0.1.3 (2026-01-21) and 0.1.4 (2026-01-31); the next lock refresh would admit them, so that bump should be reviewed deliberately (LIN-620's refresh is the natural place).

### F12 — `phantom-bson-import`  ·  **Info**  ·  unchanged

`scripts/lin3014/capture-kpis.mjs` imports `bson` (EJSON) without declaring it. It resolves to the hoisted `bson@6.10.4` (from mangodb), while `mongodb` uses a nested `bson@7.0.0`. Script only, not runtime.

### F13 — `periodical-cadence-gap`  ·  **Info**  ·  **improved**

The registry entry says weekly. The gap from 10-23 to today is **18 days**, down from about four months at 10-23. Still beyond the cadence.

### F14 — `resolved` carry-forward: `undici-advisory-cluster`

Remains resolved (LIN-688, `3ca297de`; guard `tests/unit/lin-688-undici-not-a-dependency.test.js`, which passes).

### F15 — `runner-kit-run-time-fetch`  ·  **Low**  ·  **new**

`GET /runner-kit/:file` (`routes/runner-kit.js`) serves `broker.mjs` and `runner.mjs` from `lib/runner-kit/`, allow-listed by name. A person's Claude Code runner fetches these and executes them. The served prompt (`lib/prompts/runner-kickoff.js`) computes each file's sha256 from the same server files and delivers the pins in that same prompt. The pins therefore catch corruption in transit, but not a compromised server, because server and pins come from one origin. The kit is Harbour's public open source, so an independent check would be the repository at a named commit. The window touched `lib/runner-kit/` (`broker.mjs` +54/−15, `runner.mjs` +146/−47, `contract.json` +569/−1; `routes/runner-kit.js` unchanged). Not a package and not in the lockfile, so no npm instrument sees it. `lib/runner-kit/` maps to `runs-and-dispatch`, whose note is at 6140 of its 6144-byte cap, so this stays in the report and the closing comment rather than in a note. Not ticketed.

---

## §4 — Defending the minimal-runtime posture

Every runtime addition since 10-23 needs its own justification. This cycle the runtime additions are `dompurify` and `chart.js` (direct), plus `@kurkle/color` and `@types/trusted-types` (transitive, the latter optional and types-only). No new dev dependency was added.

- **Why not a committed copy?** The committed copies were the problem: `npm audit` and LIN-620 could not see them, and the DOMPurify copy sat three minor versions behind. Declaring the packages puts them under audit coverage, lets the lockfile pin them, and removes the duplicate marked.
- **Did it add executed code?** Only DOMPurify's version bump changes executed bytes. The three libraries were already shipped runtime code before the change.
- **What did it cost?** Four resolved packages, all from the browser-library migration (tree 108 → 112; the rest of the lockfile is byte-identical to 10-23). `@kurkle/color` is inlined in the bundle and never executes from `node_modules`. `@types/trusted-types` holds types only.
- **Verdict:** the trade is justified, and it was correct, with the coverage caveat in F4: declared-package audit does not cover versions embedded inside a served bundle. The trade gains audit coverage and lockfile control, and it does not make the served bytes independently auditable.

## §5 — Altitude: what this review does not own

- Generic CVE scope belongs to the Security Review. Its next run is LIN-4411. The audit above is the frame, and the reachability triage is only what a supply-chain finding needs.
- LIN-1651 owns font licensing. `public/fonts/` is unchanged in the window.
- A cross-area seam (a finding that spans two areas) has no full home in the area notes yet. See "Seams" below.

---

## Tree growth and the trend

| | 2026-06-25 (`8de7da5`) | 2026-10-23 (`2a26c7b1`) | 2026-11-10 (`008d38bb0`) |
|---|---|---|---|
| Resolved packages (excl. root) | 107 | 108 | **112** |
| Lockfile entries (incl. root) | 108 | 109 | **113** |
| Direct runtime dependencies | 11 | 10 | **12** |
| Direct dev dependencies | 2 | 4 | **4** |
| Vendored browser libraries | 3 committed copies | 3 committed copies | **0 committed; 3 declared and served from `node_modules`** |

Growth 107 → 108 came from the 10-23 dev additions (`acorn`, `acorn-walk`), net of `undici`'s removal. Growth 108 → 112 is the four LIN-3787 entries: two direct and two transitive. The rest of the tree is unchanged.

---

## Trend Ledger (stable finding names)

| Finding (stable name) | Severity | This run | Delta vs 10-23 |
|---|---|---|---|
| `railway-build-platform-trust` | Medium (contained; verification open) | Railway disclosure 21 Oct; every runtime secret rotated 23 Oct; GitHub App check open | **new to the record** (disclosure pre-dates 10-23; rotation in window) (F0) |
| `npm-advisories-runtime` | Medium (effective) | 7 pkgs (1C/4H/2M), 15 advisories (1C/4H/8M/2L); body-parser GHSA-27r3 reachable pre-auth, absorbed by the backstop | **worsened** |
| `sibling-simple-dispatcher-undici` | Low / Medium | undici 23 advisories (7H); unused zod 4.3.6 high | **worsened** |
| `node-runtime-eol-unpinned` | Low | source pins 24; Railway runtime unverified | **improved** |
| `ci-action-tag-pinning` | Low | 5 tag-pinned actions/images; no `permissions:` | unchanged |
| `vendored-dompurify-drift` | — | **resolved**; residual: Chart.js inlines `@kurkle/color` 0.3.2 | **resolved** |
| `lockfile-integrity` | Info (clean) | clean; signatures 112/112; root `engines` drift | unchanged |
| `new-packages-this-cycle` | Info | four additions, justified (dompurify, chart.js, @kurkle/color, @types/trusted-types) | **new** (justified) |
| `yap-collective-transport` | Info | `yap.jkershaw.com` default, present since LIN-450 | **new to the record** (pre-existing) |
| `resend-email-transport` | Info / Low | pinned-endpoint `fetch` to api.resend.com; key replaced 23 Oct (Sending-only); sign-in switched off per incident record | unchanged (rotated) |
| `runner-kit-run-time-fetch` | Low | first-party run-time download and execution; pins from the same origin | **new** (F15) |
| `undocumented-outbound-url-override` | Info | `OPENROUTER_API_URL` not in configuration doc | **new** |
| `mangodb-first-party-trust` | Info | 0.1.2 locked; 0.1.3/0.1.4 upstream | unchanged |
| `phantom-bson-import` | Info | `scripts/lin3014/capture-kpis.mjs` | unchanged |
| `periodical-cadence-gap` | Info | 18 days vs weekly | **improved** |

### Running totals

| Metric | 2026-06-25 | 2026-10-23 | 2026-11-10 |
|---|---|---|---|
| Total resolved packages (excl. root) | 107 | 108 | **112** |
| Lockfile entries (incl. root) | 108 | 109 | **113** |
| Direct runtime dependencies | 11 | 10 | **12** |
| Direct dev dependencies | 2 | 4 | **4** |
| New packages this cycle | 0 (baseline) | 2 (dev) | **4** (2 direct runtime, 1 transitive runtime, 1 transitive optional) |
| Open CVEs, packages, full tree | 7 (3H/4M) | 7 (1C/3H/3M) | **7 (1C/4H/2M)** |
| Open CVEs, packages, `--omit=dev` | not recorded | 7 (1C/3H/3M) | **7 (1C/4H/2M)** |
| Open advisories, full tree | not recorded | 13 (1C/3H/7M/2L) | **15 (1C/4H/8M/2L)** |
| Open advisories, `--omit=dev` | not recorded | 13 | **15** (identical) |
| Non-registry / missing-integrity entries | 0 | 0 | **0 / 0** |
| Nested duplicates | — | 7 | **7** |
| Signatures verified | not recorded | 108/108 | **112/112** |
| Browser libraries | 3 committed (DOMPurify 3.2.4, marked 17.0.1, Chart.js 4.5.1) | 3 committed (same) | **3 declared, served from `node_modules`**: DOMPurify 3.4.17, marked 17.0.1, Chart.js 4.5.1 |

Package counts and advisory counts are separate throughout. Lockfile entries include the root; resolved packages do not.

---

## Adversarial Second-Read

**Tier:** 2 — a fresh-context sub-agent with no memory of the report-writing turn. It was given only the repository and report paths, the question below, and the instruction to verify against the repository and not to modify it. It was not given the plan, the research or this report's conclusions.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's full answer:**
1. *Largest miss or misfile:* the Railway platform security incident (21–23 October 2026). `docs/incidents/2026-10-22-railway-security-disclosure.md` was added in the window by `040a3e769`. Every runtime secret was rotated on 23 October, including the GitHub App private key, which the record says could mint tokens for every installing account, and that check remains open. The report did not mention it, and runtime service trust is in scope. Second, smaller miss: the runner kit is fetched and executed at run time (`routes/runner-kit.js`, `lib/prompts/runner-kickoff.js`), and its sha256 pins come from the same server, so they add no independent provenance.
2. *Top finding:* disagrees. F1 is advisory triage that the report itself assigns to the Security Review. Its one reachable advisory is absorbed by the `uncaughtException` backstop and is untested on Node 24. The Railway compromise outranks it.
3. *Errors:* (a) "Anything that downloads at run time: none" was false for the runner kit; the grep covered only CDN hosts. (b) The Resend finding was stale: the incident record says the key was rotated to Sending-only, and email sign-in was switched off with `EMAIL_TRANSPORT=off`. (c) The Adversarial Second-Read and Verification sections were unfilled placeholders. The reader reproduced the audit counts (7 packages, 15 advisories), the lockfile counts (113 entries, 112 resolved, no non-registry or missing-integrity entries), the missing root `engines`, the absence of `secrets.*` references and `permissions:` blocks in the workflows, and the absence of Railway, Docker, Procfile, nixpacks and `.node-version` files.

*Reader's final line:* `Adversarial second-read verdict: DISAGREE`, because the report omits the Railway compromise and secret rotation, the largest runtime-service-trust item in the window, and states that nothing downloads at run time when the runner kit does.

**Disposition, by the author:** the reader's verdict stands as recorded. Its points were verified against the repository before any change: the incident record was created before the 10-23 base by `8e59ed62` (missed by the 10-23 run); amended in the window by `040a3e76` (preliminary report, 23 Oct rotation, GitHub App check) (this corrects the reader's and the first draft's "in the window (`040a3e769`)"), `routes/runner-kit.js` serves `lib/runner-kit/*` and the pins come from the same server, and the Resend and email-transport facts match `lib/email-availability.js` and the incident record. Changes made in place: F0 (Railway) added and ranked first; F15 (runner kit) added; F7 (Resend) corrected; the scope audit's "no run-time download" sentence corrected; the ledger, verdict and "who acts" list updated; the placeholders filled. Not verified and left open for the person: whether the GitHub App check was done, and whether production currently holds `EMAIL_TRANSPORT=off`.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place

---

## Verification

| Check | Result |
|---|---|
| `node --test tests/unit/area-notes.test.js tests/unit/vendor-assets.test.js tests/unit/node-version-pin.test.js tests/unit/lin-688-undici-not-a-dependency.test.js` | **29 of 29 pass** |
| Targeted unit tests that read `docs/areas/` or `docs/reviews/` (21 files, found by grep) | **0 failures** |
| Required CI checks on the PR (`ci-success` aggregates unit and e2e) | green on `b968775b9` (CI success, unit, E2E 1–4, secret scan) |

---

## Verdict

**The largest item in the window is the platform, not a package.** Railway, which builds and runs Harbour, was compromised in October, and every runtime secret was rotated in response (F0). Harbour's record of that response is good, but one step is still open for a person: the GitHub App check. Beneath that, the runtime tree is stable and the browser-library provenance is now under audit. The package-level risk is advisory drift in packages that are already shipped. Lockfile integrity is clean and signature-verified, and the four new lock entries are canonical, justified and integrity-checked. The vendored-library problem from 10-23 is resolved, with one residual: the bytes Chart.js serves carry an embedded `@kurkle/color` that the lockfile does not audit. The advisory picture worsened. `body-parser` moved to a high advisory with a reachable pre-authentication path, which the existing `uncaughtException` backstop absorbs on Node 25 in the spike but which is not validated on the production Node 24 line. The sibling `undici` count grew from 15 to 23. Node pinning improved in source, but the production runtime remains unverified from the repository.

**Who acts (for the person; nothing filed here):**
- Check the Harbour GitHub App at github.com: installations and recent deliveries for 20–23 October, as the incident record asks (F0). This is the one item that cannot be settled from the repository.
- Confirm whether production holds `EMAIL_TRANSPORT=off` (F7).
- Decide whether the runner kit needs an independent check, such as pinning to a repository commit (F15).
- Lock refresh that clears all seven packages in range, and adds the missing root `engines` (LIN-620, reconciled with this run).
- `inflate: false` on the global parsers, a small parser-hardening move (noted in `wiring.md`).
- `permissions:` blocks and digest pins in `.github/workflows/`, and the sibling's `undici` and unused `zod`.
- Confirm the Railway Node line in service settings.
- Document or gate `OPENROUTER_API_URL` (F8).
- Review the `@jkershaw/mangodb` 0.1.3 and 0.1.4 bump deliberately.

## Seams

Cross-area seams have no complete home in the area notes yet. Two seams in this report have to be read across areas:

- **Browser-library trust boundary:** `lib/vendor-assets.js` (platform-and-plumbing) decides which bytes reach the browser, and `public/common.js` (front-end-browser) calls DOMPurify on them. The platform-and-plumbing lesson names the sanitiser side. The front-end-browser note is not changed in this run.
- **Rate-limiter keying:** the IP-keyed limiters sit in `routes/*` across several areas, and their keying depends on `server.js`'s `trust proxy` setting (wiring). No note entry covers this seam in this run; it is recorded here only.

---

*Evidence: `docs/reviews/_evidence-2026-11-10-supply-chain/audit-advisories.txt` and `lock-and-install-checks.txt`.*
