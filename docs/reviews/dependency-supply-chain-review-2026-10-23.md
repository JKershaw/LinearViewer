# Dependency & Supply-Chain Review — 2026-10-23

**Task:** LIN-3786 (periodical, run — delta vs the 2026-06-25 baseline)
**Altitude:** supply-chain / provenance (lockfile trust, name-proximity, tree-growth trend, unjustified runtime additions, vendored-asset provenance). The Security Review owns generic CVE scope; the audit result is reported here because the Security Review (10-18, 10-23) explicitly deferred it and the vendored libraries to this review.
**Repo HEAD:** `2a26c7b1` (2026-10-23) — "LIN-3279: simple starter tickets …"
**Baseline:** `docs/reviews/dependency-supply-chain-review-2026-06-25.md` (LIN-670, reviewed at `8de7da5`). It is the only prior run (LIN-660 was canceled).
**Mode:** review only. `git status` was clean before; the only change is this file.

---

## Instruments run (review-only — no manifest/lockfile edits)

All run 2026-10-23 at `2a26c7b1`. No `npm audit fix`, `npm update` or rewriting install was run.

| Instrument | Result |
|---|---|
| `npm audit --json` | 7 packages (1C/3H/3M) · 13 advisories (1C/3H/7M/2L) |
| `npm audit --omit=dev --json` | identical to the full tree (dev deps add nothing) |
| `npm ci --dry-run` | exit 0, lockfile not rewritten |
| `npm ls --all` | exit 0 (only UNMET *optional* peers of `mongodb`) |
| `npm audit signatures` | **108/108 verified registry signatures**, 9 with attestations (new instrument vs baseline) |
| `jq` over `package-lock.json` | 109 entries; 0 non-`registry.npmjs.org` `resolved`; 0 missing `integrity`; 7 nested dedups |
| `npm pack` + `shasum -a 256` of upstream `dompurify@3.2.4`, `marked@17.0.1`, `chart.js@4.5.1` | all three vendored files byte-identical to upstream (see F1) |
| `npm view`, `gh api /advisories/<GHSA>`, `nodejs/Release` schedule | latest versions, advisory text, Node EOL dates |
| `grep` / `git log` / `git show` | reachability, provenance, attribution |

Package counts and advisory counts are reported separately and labelled throughout: `npm audit`'s `metadata.vulnerabilities` counts **packages**, not advisories.

## Re-grounding (snapshot in the task description was NOT trusted)

| Metric | Baseline 2026-06-25 | Minting lead | Live at HEAD | Match |
|---|---|---|---|---|
| Resolved packages (excl. root) | 107 | 108 | 108 | ✓ |
| Lockfile entries (incl. root) | 108 | 109 | 109 | ✓ |
| Direct runtime deps | 11 | 10 | 10 | ✓ |
| Direct dev deps | 2 | 4 | 4 (`@playwright/test`, `playwright`, `acorn`, `acorn-walk`) | ✓ |
| Lock diff `8de7da5..HEAD` | — | `-undici +acorn +acorn-walk` | same (plus the root `name` rename) | ✓ |
| acorn/acorn-walk introduced by | — | **LIN-3628** (`1a4c9f1d`) | **LIN-3550** (`6597d6e0`, 13 Oct) | **✗ lead corrected** |

`1a4c9f1d` (LIN-3628) touches `package.json` only to widen the `test`/`test:unit` glob; the pins were added by `6597d6e0` (LIN-3550). This also agrees with the 10-23 Security Review's "lockfile unchanged since `6597d6e0`".

Every runtime lock entry is byte-identical to June apart from `undici`'s removal (`express@4.22.1`, `express-rate-limit@8.2.1`, `qs@6.14.1`, `path-to-regexp@0.1.12`, `proxy-addr@2.0.7`, `ip-address@10.0.1`, `body-parser@1.20.4`). A runtime tree frozen for four months is itself the trend: it is stable, and it is also why advisories published since June have all landed on it unaddressed.

---

## Findings (severity-ranked)

Ranking is by consequence at this altitude. Note that F2 contains a new **critical** advisory; it ranks below F1 only because the reachability evidence beside it shows no path, whereas F1 is an unmonitored sole sanitiser.

### F1 — `vendored-dompurify-drift`  ·  **Medium (latent)**  ·  new

`public/purify.min.js` is **byte-identical to upstream DOMPurify 3.2.4** (sha256 `8eb41b658831fab1…`; banner `@license DOMPurify 3.2.4`). DOMPurify 3.2.4 has **22 advisories (1 high / 15 moderate / 6 low)**; the fix line is **3.4.17** (current latest). It is the app's **only** HTML sanitiser for untrusted ticket text and LLM output. `npm audit` and LIN-620 cannot see it, because DOMPurify has no representation in `package.json` at all. Last touched 2026-01-21 (`874790f7`).

Reachability triage (no reachable path found):
- One call site in the whole app: `DOMPurify.sanitize(html, { FORBID_TAGS: ['form'] })`, `public/common.js:495`, via `window.renderMarkdown`. String mode only: no `IN_PLACE`, `RETURN_DOM`, hooks, `ADD_TAGS/ADD_ATTR`, `CUSTOM_ELEMENT_HANDLING`, `SAFE_FOR_TEMPLATES`, `USE_PROFILES` or `setConfig`. The one high advisory (GHSA-mrv2, `IN_PLACE` + hooks) and the other config-specific advisories do not apply to this call shape.
- The rawtext-context advisories (GHSA-v8jm <3.2.7, GHSA-v2wj ≤3.3.1, GHSA-h8r8 mXSS <3.3.2) need sanitised output re-inserted into a rawtext wrapper (textarea, noscript, xmp, iframe, noembed, noframes). All ~20 `renderMarkdown` consumers (`public/app.js`, `chat.js`, `brief.js`, `prompt-section.js`, `session.js`, `task-edit.js`, `swipe.js`, `task-page.js`) insert into `div`/normal flow. The two `<textarea>`s (`lib/render-task-edit.js`, `lib/render-collective.js`) take `escapeHtml(raw)`, not sanitiser output.
- The enforced CSP has `script-src 'self'` plus hashes and no `'unsafe-inline'` (`lib/security-headers.js`), which blocks the `onerror=` payload class as defence in depth.

Why it still ranks first: the control that stands between untrusted markup and every user's DOM is 22 advisories behind and sits outside every review instrument (the baseline counted the three vendored files, but never audited their versions). Reachability today is a property of call shapes that a future edit can silently change. **Remediation (follow-up, not done here):** bump to 3.4.17 and bring the vendored libs under audit coverage (preferably by declaring `dompurify`/`chart.js` in `package.json` and serving from `node_modules`, which also removes the duplicate `marked`; that adds runtime deps, so the ticket must justify them). → Follow-up 1.

### F2 — `npm-advisories-runtime`  ·  **Critical-rated advisory, no reachable path (effective Medium/Low)**  ·  unchanged (misfiled at baseline), worsened

At HEAD: **7 packages (1C/3H/3M)**, **13 advisories (1C/3H/7M/2L)**; full tree = `--omit=dev`; every package has a non-major fix in range (`fixAvailable` true).

| Package@locked | Worst advisory | Delta | Reachability at HEAD |
|---|---|---|---|
| `proxy-addr@2.0.7` | GHSA-jqcg-44mw-7w3h, IPv4-mapped IPv6 trust-subnet spoofing — **critical** | **new** (pub. 2026-10-05) | **Not reachable.** Needs a *subnet* trust config; the app sets hop-count `trust proxy 1`, production only (`server.js:1055-1057`). No other proxy-addr/trust usage. |
| `express-rate-limit@8.2.1` | GHSA-46wh-pxpv-q5gq, default key masks `::ffff:x.x.x.x` to `::/56`, collapsing all IPv4 clients into one bucket — **high** | unchanged (misfiled) | **Conditional.** Affects the 10 IP-keyed limiters: `routes/dispatch.js:78,90,104,115`, `routes/email-auth.js:90` (LIN-3771 sign-in email limiter), `routes/task-mode.js:27`, `routes/proxy.js:236,258` (default key) and `routes/proxy.js:288`, `routes/workspace-api.js:659` (explicit `ipKeyGenerator(req.ip)`). Triggers only if production `req.ip` is `::ffff:`-mapped; behind Railway's edge `X-Forwarded-For` it is usually plain IPv4, so probably dormant — **unverified at the edge**. Impact is availability (one client 429s all IPv4 users, including sign-in). `proxy-flight-companion.js` limiters key on token/url and are not affected. |
| `ip-address@10.0.1` (via express-rate-limit) | 6 advisories, max **high** (GHSA-mwp4-54f8-5fhr) | **worsened** (moderate→high) | Low. Sole consumer is `ipKeyGenerator` on `req.ip`; no SSRF decision rides on it. |
| `path-to-regexp@0.1.12` | GHSA-37ch-88jc-xwx2 ReDoS, needs ≥3 params in one segment — high | unchanged (misfiled) | **Not reachable.** ~240 parameterised route literals in `server.js`/`routes/`; none has even 2 params in one segment. |
| `qs@6.14.1` | GHSA-q8mj (moderate), GHSA-4mjr (moderate, **new** 2026-09-02), GHSA-w7fw (low) | unchanged; GHSA-4mjr new | **Not reachable.** Express 4 uses only `qs.parse` without `comma`; the app never imports `qs` or calls `stringify`. |
| `body-parser@1.20.4` | GHSA-v422-hmwv-36x6, invalid `limit` disables enforcement — low | unchanged | **Not reachable.** All limits are valid literals (`server.js` 250kb; `routes/proxy-writes.js` 14mb; `routes/workspace-api.js` 12mb). |
| `express@4.22.1` | rollup via `qs` only | unchanged | n/a |

**The baseline misfiled its CVEs.** "7 (3 high / 4 moderate), all in undici" was a *package rollup across 7 packages*, the very list LIN-620 itemises (high: undici, express-rate-limit, path-to-regexp; moderate: qs, ip-address, express, body-parser). Re-auditing the baseline lockfile (`8de7da5`) against today's advisory DB shows `undici` **plus every package that is vulnerable at HEAD, at the same versions**; the express-rate-limit (2026-03-06) and path-to-regexp (2026-03-27) advisories were already public in June. So the non-undici items are **unchanged, misfiled at baseline**, not new; only proxy-addr's critical, GHSA-4mjr and ip-address's escalation are genuinely new.

**LIN-620 reconciliation** (existing Backlog ticket "clear baseline dependency CVEs via npm audit fix (3 high / 4 moderate)"; **not duplicated**, a comment is posted there instead). Its remedy (non-breaking lockfile refresh) is still correct, its list is stale:
- `undici`: **cleared** (LIN-688).
- `express-rate-limit`, `path-to-regexp`, `qs`, `express`: **still live**.
- `ip-address`: live, now **high**.
- `proxy-addr` (critical) and `body-parser`: **missing from its list**.
- Suggest a priority raise: `express-rate-limit` backs real controls, including LIN-3771's sign-in limiter. Whoever runs the refresh should review the `@jkershaw/mangodb` 0.1.3/0.1.4 range bump deliberately (F8).

### F3 — `node-runtime-eol-unpinned`  ·  **Medium**  ·  new

- CI pins `node-version: '20'` on four lines (`.github/workflows/test.yml:46,95,133`; `secret-scan-scheduled.yml:19`). **Node 20 reached EOL on 2026-04-30.**
- The production Node line is **not pinned anywhere in the repo**: no `engines`, `.nvmrc`, `.node-version`, nixpacks/railpack config or Dockerfile. Railway's builder default decides it.
- Since LIN-688 removed the npm `undici`, **all application `fetch` traffic runs on the undici bundled in Node**, so the Node line *is* the HTTP-client supply chain (the baseline noted this as out of scope; it is now the only copy in play).
- Test/prod skew: CI runs 20, production runs an unknown version.
- **Unverifiable from source.** I checked whether the app exposes its Node version: `process.version` appears only in a server-side error log (`lib/linear-fetch.js:133`, on Linear-unreachable) and `/health` returns only `{status:'ok'}` (`server.js:1050`). The production Node line therefore stays **open**; this report does not guess it.

→ Follow-up 2 (pin via `engines`, move CI to a supported LTS — 22 is EOL 2027-04-30, 24 is EOL 2028-04-30 — and confirm the Railway line).

### F4 — `sibling-simple-dispatcher-undici`  ·  **Low/Medium**  ·  new (read-only; sibling repo not edited)

`JKershaw/simple-dispatcher` (`bb1da78`): runtime set `playwright`, `undici ^7.28.0`, `zod`; 6-entry lockfile, all registry + integrity; `engines >=22`. Its `undici@7.28.0` **is imported** (`opencode-runner.js:37`, `Agent` used as a fetch dispatcher). The registry now reports **15 advisories (3 high)** for it, fixed in ≥7.29.1. The high ones (private-cache directives, WebSocket subprotocol, BalancedPool TLS) target features it does not use and it talks to a local opencode server, so reachability is low. Note that LIN-688's own fallback remedy ("bump to ≥ 7.28.x") is now itself vulnerable. That repo has no CI (LIN-1456) and had no dependency review of its own. **Recorded, not ticketed** (cap; low reachability); a note goes on LIN-1456.

### F5 — `ci-action-tag-pinning`  ·  **Low**  ·  new

`actions/checkout@v4` (×4), `actions/setup-node@v4` (×4), `actions/upload-artifact@v4` and the container images `mcr.microsoft.com/playwright:v1.57.0-noble`, `mongo:8.0.32` are pinned by mutable tag, not commit SHA / digest. Both workflows run `npm ci`. Mitigations: no `secrets.*` referenced, no `pull_request_target` (triggers are push/PR to main, schedule, dispatch), and E2E browsers come from the image rather than a runtime download. Residual: no `permissions:` block, so `GITHUB_TOKEN` gets the repo default on push-to-main runs. Recorded, not ticketed.

### F6 — `lockfile-integrity`  ·  **Info (clean)**  ·  unchanged

`npm ci --dry-run` exit 0; all 108 resolved entries come from `https://registry.npmjs.org` with `integrity`; the same 7 benign nested dedups as baseline (`debug`/`ms` under https-proxy-agent, `tr46`/`webidl-conversions`/`whatwg-url` under mongodb-connection-string-url, `bson` under mongodb, `ms` under send). New positive evidence: `npm audit signatures` verifies 108/108.

### F7 — `new-packages-this-cycle`  ·  **Info**  ·  2 new (dev-only), justified

| | `acorn@8.12.1` | `acorn-walk@8.3.4` |
|---|---|---|
| Introduced by | **LIN-3550**, `6597d6e0` (13 Oct) — *not* LIN-3628 | same commit |
| Kind | devDependency, pinned exact | devDependency, pinned exact |
| Registry age | first published 2012-09-24; 8.12.1 on 2024-07-03 | 2018-09-14; 8.3.4 on 2024-09-09 |
| Weekly downloads (12–18 Oct) | ~151.7M | ~46.9M |
| Maintainers | marijn, adrianheine, rreverser | same |
| Repo | acornjs/acorn | same monorepo |
| Integrity | lock `sha512-tcpGyI9z…` = `npm view` dist.integrity ✓ | `sha512-ueEepnuj…` ✓ |
| Advisories | 0 | 0 |

Canonical names, so no typosquat/slopsquat proximity. Transitive addition is only acorn-walk→acorn (`^8.11.0`, deduped). Consumers are tooling only (`scripts/code-shape/{seams,census-core,shape-core,perturb-core}.mjs`, `deps.test.mjs`, 4 `experiments/` files); no runtime import. Pins are old (latest 8.19.0 / 8.3.5). **No new runtime npm dependency**, so the npm minimal-runtime posture holds (but see F11 for a non-npm runtime addition).

### F8 — `mangodb-first-party-trust`  ·  **Info**  ·  unchanged

`@jkershaw/mangodb` still locked at `0.1.2`. Upstream has since published `0.1.3` and `0.1.4`; `^0.1.2` would admit them on the next lock refresh (e.g. LIN-620's), so that bump should be reviewed deliberately.

### F9 — `phantom-bson-import`  ·  **Info**  ·  new

`scripts/lin3014/capture-kpis.mjs:21` imports `bson` (EJSON) without declaring it; it resolves to the hoisted `bson@6.10.4` (from mangodb) while `mongodb` uses nested `bson@7.0.0`. Script only, not runtime. (The `lodash` hit at `scripts/code-shape/seams.test.mjs:30` is a string fixture, not an import.)

### F10 — `periodical-cadence-gap`  ·  **Info**  ·  new

The registry entry says weekly cadence, but the gap since the only prior run was ~4 months (06-25 → 10-23). The runtime tree was frozen throughout, so nothing was missed in the tree, but advisories published in the gap (proxy-addr, ip-address, GHSA-4mjr) went unreviewed.

### F11 — `resend-email-transport`  ·  **Info/Low**  ·  new (non-npm runtime addition; found by the second-read)

`lib/email-transport.js` (added 2026-09-27 by LIN-1892 S2, `8b65b421`; used by the LIN-3771 email sign-in path) POSTs to `https://api.resend.com/emails` through global `fetch` with `RESEND_API_KEY`. It adds **no npm package**, so no lockfile instrument sees it, but it is a new third-party runtime service that receives user email addresses and sign-in links and holds a secret key. Positives from the file itself: the endpoint is a pinned constant (`RESEND_ENDPOINT`), the key comes from env, failures are logged with a hashed recipient (`hashEmailRecipient`) rather than the address, and the transport is selected via a `kind` switch with an injected `fetchImpl`/timeout. Not verified in this run: key scope/rotation, Resend account posture, and fallback behaviour when the service is down. Recorded, not ticketed (it is a service-trust question for the Security Review altitude rather than a package-provenance defect).

### Vendored client libraries (full table)

| File | Banner | sha256 (first 16) | vs upstream tarball | Advisories | Latest |
|---|---|---|---|---|---|
| `public/purify.min.js` | DOMPurify 3.2.4 | `8eb41b658831fab1` | identical to `dompurify@3.2.4/dist/purify.min.js` | **22** (1H/15M/6L) | 3.4.17 |
| `public/marked.min.js` | marked v17.0.1 | `e131975cfd9e6fd1` | identical to `marked@17.0.1/lib/marked.umd.js` (the *unminified* UMD build despite the name) | 0 | 18.1.1 |
| `public/chart.umd.min.js` | Chart.js v4.5.1 | `48444a82d4edcb5b` | identical to `chart.js@4.5.1/dist/chart.umd.min.js` | 0 | 4.6.1 |

Provenance is clean: no tampering, banners are truthful. **marked skew: none** (npm dep locked `17.0.1` = vendored `17.0.1`). `public/fonts` (7 woff2: Inter, JetBrains Mono) is not JS and is a licence question, not a supply-chain one.

### Licences

Lockfile tally: MIT 95, Apache-2.0 7, BSD-2 3, BSD-3 1, ISC 2 — all permissive. Vendored: DOMPurify (Apache-2.0 / MPL-2.0), marked (MIT), Chart.js (MIT). **Division of labour:** this report records the tally only; the formal AGPL-compatibility and attribution pass, including `public/fonts` (no licence text ships alongside), stays with **LIN-1651**.

### Security Review gap

The 10-18/10-23 Security Reviews deferred the dependency audit ("not re-audited online" → LIN-620) and listed the vendored `public/*.min.js` as unaudited. That gap is **closed only for what this run verified**: the npm audit at HEAD, three byte-identical vendored libraries, one DOMPurify call site, and the ~20 sink consumers. Not verified: the production Node line and the production `req.ip` shape (both edge/builder behaviour, not in source).

---

## Follow-ups minted (cap ~3; under-created deliberately)

Searched first for existing tickets (DOMPurify, purify, vendored, Node 20, node version, express-rate-limit, proxy-addr, npm audit, commit SHA, pin actions, undici, Dependabot). Hits were LIN-620 (CVE refresh), LIN-1651 (licences), LIN-1456 (sibling has no CI) and unrelated markdown/limiter tickets; none covers the items below.

1. **Vendored DOMPurify 3.2.4 → 3.4.17 and audit coverage for vendored libs** (F1) → **LIN-3787**.
2. **Pin the Node runtime and move CI off EOL Node 20** (F3) → **LIN-3788**.

Not minted: the CVE refresh (**LIN-620**, commented), licences (**LIN-1651**), sibling `undici` (F4, note on **LIN-1456**), and F5/F8/F9/F10 (recorded only).

---

## Trend Ledger (stable finding names)

| Finding (stable name) | Severity | This run | Delta vs 2026-06-25 |
|---|---|---|---|
| `undici-advisory-cluster` | — | `undici` removed (LIN-688, `3ca297de`; guard `tests/unit/lin-688-undici-not-a-dependency.test.js`) | **resolved** |
| `mangodb-first-party-trust` | Info | v0.1.2 locked; 0.1.3/0.1.4 upstream | unchanged |
| `lockfile-integrity` | Info (clean) | clean; `npm ci` OK; signatures 108/108 | unchanged |
| `new-packages-this-cycle` | Info | 2 dev-only (acorn, acorn-walk; LIN-3550) | new (justified) |
| `npm-advisories-runtime` | Critical-rated / no reachable path | 7 pkgs (1C/3H/3M), 13 advisories | unchanged (misfiled at baseline), **worsened** (proxy-addr critical, ip-address →high) |
| `vendored-dompurify-drift` | Medium (latent) | DOMPurify 3.2.4, 22 advisories | new |
| `node-runtime-eol-unpinned` | Medium | CI Node 20 (EOL 2026-04-30); prod unknown | new |
| `sibling-simple-dispatcher-undici` | Low/Medium | undici 7.28.0 imported, 15 advisories | new |
| `resend-email-transport` | Info/Low | pinned-endpoint `fetch` to api.resend.com, no npm package (LIN-1892/LIN-3771) | new |
| `ci-action-tag-pinning` | Low | 5 distinct tag-pinned actions/images | new |
| `phantom-bson-import` | Info | `scripts/lin3014/capture-kpis.mjs:21` | new |
| `periodical-cadence-gap` | Info | ~4 months vs weekly | new |

### Running totals

| Metric | 2026-06-25 | 2026-10-23 (`2a26c7b1`) |
|---|---|---|
| Total resolved packages (excl. root) | 107 | **108** |
| Lockfile entries (incl. root) | 108 | 109 |
| Direct runtime dependencies | 11 | **10** |
| Direct dev dependencies | 2 | **4** |
| New packages this cycle | 0 (baseline) | **2** (dev) |
| Open CVEs, packages, full tree | 7 (3H/4M) | **7 (1C/3H/3M)** |
| Open CVEs, packages, `--omit=dev` | not recorded | **7 (1C/3H/3M)** |
| Open advisories, full tree and `--omit=dev` | not recorded | **13 (1C/3H/7M/2L)** |
| Non-registry / missing-integrity packages | 0 | **0** |
| Vendored client libs | 3 | 3 — DOMPurify 3.2.4, marked 17.0.1, Chart.js 4.5.1 |

---

## Verdict

**The tree is trustworthy and frozen; the risk is that nobody is watching it.** Lockfile integrity is clean and signature-verified, provenance of the two new dev packages is sound, no runtime dependency was added, and the baseline's only action item (`undici`) is resolved. But the baseline's CVE row was a misfiled package rollup, and the real set (7 packages / 13 advisories, including a new critical in `proxy-addr`) has sat unaddressed behind a stale LIN-620; on reachability evidence none of it is exploitable today, with `express-rate-limit` conditional on the unverified production `req.ip` shape. The largest new exposure is structural: the app's sole sanitiser is a vendored file 22 advisories behind that no instrument watched, and the Node line that now supplies the app's HTTP client is unpinned and, in CI, end-of-life. Two follow-ups minted; LIN-620 reconciled.

---

## Adversarial Second-Read

**Tier:** 2 — a fresh-context sub-agent with no memory of the report-writing turn; it was given only the report path and the question below.

**Question:** "What is the largest item in this window that this report missed or misfiled?"

**Reader's full answer (condensed to its content, none omitted):**
1. *Largest miss:* the new Resend email transport. LIN-3771 / LIN-1892 added `lib/email-transport.js`, which POSTs to `https://api.resend.com/emails` with `RESEND_API_KEY` via global `fetch`: a new third-party runtime service handling user email addresses and sign-in links, with a secret key, and no npm package, so the lockfile instruments and the "no new runtime dependency" verdict miss it. The report mentioned LIN-3771 only as a rate-limit consumer.
2. *Top finding:* partly disagrees. F1 is a defensible latent item, but F2 (the only item with a plausible exploit path, the `::ffff:` rate-limit collapse) and F3 (CI confirmed on EOL Node 20, bundled undici is the app's fetch) should rank at or above it; a critical advisory ranked below a Medium-latent item on a reachability argument reads as inconsistent.
3. *Errors:* F7's "no new runtime dependency" was true for npm only; F1's "no instrument watched" overstated (the baseline counted the three vendored libs, it just never audited versions); F1 is labelled "new" but the file was last touched in January (a first-time audit of old drift); F5's counts were a nit (3 actions + 2 images = 5 distinct).

**Disposition of the reader's points:**
- Resend transport: **verified** against `lib/email-transport.js` and `git log` (added 2026-09-27); added as F11 and a ledger row; F7 wording corrected.
- F1 overstatement and "new" label: wording corrected ("new" is meant as first-time-audited, stated here; the drift accrued over time).
- Ranking: retained. F1 ranks first on consequence (unmonitored sole sanitiser, no tracking at all) while F2's reachability evidence is shown beside its severity; F2 remains conditional on an unverifiable edge property, and F3's consequence is a posture gap with no demonstrated exploit. The reader's disagreement is recorded rather than adopted.

Adversarial second-read verdict: DISAGREE
Differed from top finding: YES
Disposition: fixed in place
