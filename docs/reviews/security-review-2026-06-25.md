# Security Review — 2026-06-25 (periodical run, LIN-669)

**HEAD reviewed:** `d9c51da` · **Origin:** periodical Security Review (LIN-354) · **Prior run:** LIN-602 (baseline, `203f4ee`, 2026-06-23)
**Mode:** review-only — no code/config/secret changes. Cold re-grounding against live handlers at HEAD.

> **Note on the missing baseline report.** LIN-602 claimed `docs/reviews/security-review-2026-06-23.md`, but it was never committed to any branch (absent from the working tree and `git log --all`). The baseline survives only as LIN-602's Linear closing comment + its follow-up tasks. **This report is committed** so the ledger persists for the next run.

---

## Verdict

**No exploitable Critical found.** The highest-blast-radius surface — **tenant/workspace isolation on the consumer proxy** — remains **clean with no regression** after LIN-589 (wire-contract), LIN-581 (per-workspace provider selection), and LIN-649/650 (attachment relay). Credential surface is **clean across the working tree AND full git history**.

The new surfaces since the baseline introduce **one High** (feedback SVG stored-XSS) and several Mediums. Findings: **1 High · 4 Medium · 3 Low · 0 Critical**, plus 3 carried-open baseline follow-ups.

**Follow-ups minted this run (top 3 by severity, capped):** the High XSS, the GitHub OAuth over-grant, and the attachment-relay SSRF defense-in-depth gap. Everything else is recorded below for the next run.

---

## 1. Tenant / workspace isolation — CLEAN, no regression (verified)

The single auth gate `authenticateProxyToken` (`routes/proxy.js:602-630`) pins `req.proxyUrlKey` from the token store (`lib/proxy-tokens.js:194-198`) and is the **only** writer of that value. All 30 consumer call sites resolve access via `resolveProviderAccess(req.proxyUrlKey)` / `resolveWorkspaceAccess(req.proxyUrlKey)` — nothing else. Grep for request-supplied `body.urlKey` / `query.urlKey` / `workspaceId` overrides on the consumer surface returned **zero hits**; the consumer routes are unprefixed (`/api/proxy/*`) with no `:urlKey` path segment to trust.

- **Mutations gated on `readWrite`** via `requireWriteScope` (`routes/proxy.js:635-640`) on every write route; capability gate `denyIfUnsupported` → clean 422 (`687-696`).
- **Dispatch take/feedback bound to ownership:** `takeItem` atomic `findOneAndDelete({_id, urlKey})` (`lib/dispatch-store.js:319-350`); `addFeedback` enforces both `{_id, urlKey}` scope AND `takenByTokenLabel === tokenLabel` (`lib/dispatch-store.js:603-656`).
- **LIN-581 provider selection** reads the provider name from the session owning the urlKey (`server.js:1108`), never from request input; `injectedProvider` is test-only (`server.js:1197` passes none in prod).
- **Attachment relay** (`routes/proxy.js:1769-1866`) resolves the egress token from `req.proxyUrlKey`; the `md:` handle encodes only a URL, never a workspace selector — cross-workspace fetch is impossible.

## 2. Exposed credentials — CLEAN (working tree + full history)

`git grep` over the tree and `git log -p --all -S` over history for Linear (`lin_api_`/`lin_oauth_`), OpenRouter (`sk-or-`), GitHub (`gho_`/`ghp_`/`ghs_`/`github_pat_`), AWS/Google/Slack prefixes, and PEM private keys found **only**:
- Placeholders: `.env.example`, `README.md`, `CLAUDE.md` (`lin_api_xxxxx`).
- Test fixtures: `gho_abc`/`gho_token`, `lin_api_test`/`lin_api_secret9999`, `sk-or-v1-test`, `lin_oauth_SECRET_TOKEN` in `tests/unit/*`. `render-settings.test.js:79` actively asserts the token is **not** rendered.
- History scan returned no live literals. `.env` is **not tracked**.

No live secret in tracked content. New `gho_*`/`github_pat_*` formats (LIN-541) added to the scan set — clean.

---

## Findings (severity-ranked)

### H1 — [HIGH] Feedback screenshot → stored XSS via SVG through the same-origin image proxy `→ minted`
`parseFeedbackImage` (`routes/workspace-api.js:210-244`) performs **no content-type allowlist and no magic-byte check** — it trusts the client-declared `contentType`. The `accept="image/*"` input (`public/feedback-widget.js:145`) is client-side only. An attacker can POST `data:image/svg+xml;base64,<svg><script>…</script></svg>` directly. Bytes are PUT to Linear's CDN, the `assetUrl` is embedded in the ticket (`:2172`), and on later render the `<img src>` is rewritten to the **same-origin** proxy `/workspace/:urlKey/api/image?url=…` (`public/app.js:655`). That proxy's only guard is `contentType.startsWith('image/')` (`routes/workspace-api.js:1989`) — which `image/svg+xml` passes — and it relays the upstream content-type verbatim with **no `Content-Disposition` and no `X-Content-Type-Options: nosniff`** (`:2005-2007`). There is **no CSP / helmet anywhere** in `server.js` to backstop it. SVG served inline same-origin executes its `<script>`.
**Blast radius:** script execution in the session origin of any user/operator who views the feedback image → session-scoped actions + workspace data exfiltration. The image proxy weakness pre-existed, but the **new** untrusted-upload ingress makes it reachable with attacker-controlled bytes.
**Fix direction:** raster content-type allowlist (`image/png|jpeg|gif|webp`) + magic-byte verify in `parseFeedbackImage`; send `X-Content-Type-Options: nosniff` + `Content-Disposition: attachment` (or reject `image/svg+xml`) in `/api/image`.

### M1 — [MEDIUM] GitHub OAuth requests over-privileged scope `repo read:org` `→ minted`
`lib/providers/github/index.js:345` requests `scope: 'repo read:user read:org'`. `repo` grants **full read/write to ALL of the user's private repositories** (code, not just issues) for a feature that only needs issue read/write on one selected repo. A token leak therefore exposes the user's entire private codebase.
**Fix direction:** migrate to a GitHub App with fine-grained per-repo *Issues: read & write*; or, short-term, drop `read:org` and document the `repo` over-grant as an accepted V1 risk.

### M2 — [MEDIUM] Attachment-relay SSRF guard is host-allowlist-only — no IP/range guard, no DNS-rebind protection `→ minted`
The relay (`routes/proxy.js:1769-1866`) validates only the **hostname string** against a 3-entry allowlist (`uploads.linear.app`, `cdn.linear.app`, `linear.app`, `:1802`). There is **no `dns.lookup` + private-range check** and **no connect-time IP re-validation** anywhere in the repo, so the resolved IP `fetch` connects to is never inspected (DNS-rebind / TOCTOU). No denylist of `127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (link-local / cloud metadata), `::1`, `fc00::/7`. The sensitive payload at risk is the **workspace Linear OAuth Bearer token** sent on egress (`:1825`): if an allowlisted host ever resolves to an attacker-influenced address, that token is delivered to it.
**Currently mitigated** by the tiny exact-host allowlist; would become High if the allowlist widens or is ever made user-influenced. `redirect: 'error'` (`:1826`) and content-type/size caps (`:1835`, `:1841/:1847`) are correctly in place.
**Fix direction:** resolve the hostname, reject if the resolved IP is in any private/link-local/ULA/loopback range, and pin the connection to the vetted IP — defense-in-depth beyond the allowlist.

### M3 — [MEDIUM] Feedback endpoint: no rate limit + 12 MB permissive body parser (DoS / AI-cost amplification) `→ recorded`
The feedback route has no rate limiter (no app-wide limiter exists in `server.js`). Each authenticated POST creates a Linear ticket (`:2211`), optionally makes a billed OpenRouter LLM title call that can draw on the shared free-tier key (`:2199`), and enqueues a dispatch job (`:2217`) — loopable for ticket/queue spam + AI budget burn. `feedbackBodyParser = json({ type: () => true, limit: '12mb' })` (`:2040`) buffers up to 12 MB of any content-type per request; the 10 MB image cap is enforced post-decode (`:2165`), so raw body + ~9 MB decoded Buffer co-exist. Bounded to authenticated workspace members. Containment of the parser to this route is correct (`:2028-2035`).

### M4 — [MEDIUM] GitHub repo slug / issue number interpolated into API paths unencoded `→ recorded`
`lib/providers/github/client.js:69-104` interpolates `repo` and `number` into `/repos/${repo}/issues/${number}` without `encodeURIComponent` (contrast `enc(label)` at `:104`). `REPO_SLUG_REGEX = /^[\w.-]+\/[\w.-]+$/` (`routes/github-auth.js:37`) permits `.`-only segments, so a scope like `a/..` renders `/repos/a/../issues` → `/repos/issues`. Practical exploitability low (slug comes from the user's own authenticated repo picker, queries only their own token's scope), but a latent path-injection foot-gun.
**Fix direction:** `encodeURIComponent` each segment, or tighten the regex to reject `.`-only segments.

### L1 — [LOW] GitHub OAuth `state`/`oauthIntent` not single-use
`req.session.oauthState` is validated (`routes/github-auth.js:108`) but never cleared on a successful callback (contrast `githubPending`, deleted at `:205/:219`), allowing same-session replay of the callback until the next login. Minimal blast radius; identical pre-existing pattern in the Linear path (`routes/auth.js:107`), not a LIN-541 regression.

### L2 — [LOW] Declared `contentType`/`filename` forwarded unsanitized to provider upload
`parseFeedbackImage` passes client-declared `contentType`/`filename` into `provider.uploadFile` → Linear `fileUpload` (`lib/providers/linear/index.js:1578-1588`); filename is only scrubbed when synthesised (`:240`), not when client-supplied (`:226`). Linear validates server-side, but the declared content-type is the lever for H1.

### L3 — [LOW/systemic] No Content-Security-Policy / helmet app-wide
`server.js` sets no CSP, no `helmet`, no `X-Content-Type-Options`. This is the missing backstop that would neutralise H1 and harden every render surface. Folded into H1's actionable fix; recorded here as a standing systemic gap.

---

## Carried baseline follow-ups (still open — verified live at HEAD, NOT re-minted)

| Task | Finding | Status at HEAD |
|------|---------|----------------|
| **LIN-618** (+ older **LIN-376**) | Standing `readWrite` token in plaintext dispatch prompt preamble (`routes/proxy.js:416-474`, self-flagged `SECURITY DEBT`, 48h-TTL partial mitigation) | **Still live.** Backlog. Unchanged by audited tickets. |
| **LIN-619** | `SESSION_SECRET` fails open to hardcoded default in production (warn-only) | **Still live.** Backlog. |
| **LIN-620** | Dependency CVEs via `npm audit fix` | **Still live.** Backlog. Set has shifted since baseline: now **7 vulns (3 high / 4 moderate)** — `path-to-regexp <0.1.13` (high, ReDoS), `undici 7.x` (high, multiple), `qs`/`body-parser`/`express` (moderate). All `npm audit fix`-able. LIN-620's scope still covers this. |

**H1-from-baseline (prompt injection):** untrusted Linear/issue content interpolated into worker prompts with no data/instruction separation (`lib/prompt-formatters.js`, `lib/openrouter.js`, dispatch fan-out) remains design-inherent and **deliberately unpromoted** — needs a design decision, not an auto-picked task. Confirmed still present at HEAD; the new feedback ingress (M3) adds another untrusted-text → AI-prompt path of the same class.

Prior hardening confirmed intact (no regression): LIN-193/201 (proxy security), LIN-109 (dispatch hardening), LIN-650 (image relay — see M2 for the residual defense-in-depth gap).

---

## Class check

- **H1 SVG XSS** is one instance of a class: *untrusted bytes served same-origin through `/api/image` with no nosniff/disposition and no CSP*. The same proxy fronts all Linear-authored uploads; the feedback ingress is simply the first **attacker-controlled** source. Fixing only the feedback parser without hardening `/api/image` + adding CSP leaves the class open — both are named in H1's fix direction.
- **Prompt-injection** (baseline H1 + feedback M3) is a class spanning every untrusted-text → AI-worker-prompt path; tracked as a standing design decision, not expanded here.
- **SSRF defense-in-depth** (M2): the relay is the only current external-fetch-with-credential path; the Yap client and OAuth callbacks use fixed hosts. Isolated to the relay at HEAD.

## Severity summary

| Sev | Findings |
|-----|----------|
| Critical | 0 |
| High | H1 (feedback SVG stored-XSS) |
| Medium | M1 (GitHub scope over-grant), M2 (relay SSRF defense-in-depth), M3 (feedback DoS/cost), M4 (GitHub URL encoding) |
| Low | L1 (state single-use), L2 (upload metadata), L3 (no CSP/helmet) |
| Carried | LIN-618/376, LIN-619, LIN-620; baseline prompt-injection (unpromoted) |
