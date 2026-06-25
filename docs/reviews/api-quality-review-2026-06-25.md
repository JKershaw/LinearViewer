# API Quality Review — 2026-06-25

**Task:** LIN-665 (periodical run; origin of the series). **Type:** review-only — no code,
docs, config, or secrets changed.
**HEAD:** `d9c51da` (Merge #617).
**Baseline:** the repository's own dominant conventions, not an imported ideal —
chiefly the `lib/errors.js` envelope `{ error: "<message>", ...extra }` and its helpers
(`jsonError` / `badRequest` / `unauthorized` / `notFound` / `serverError` / the structured
`errorEnvelope` / `classifyUpstreamError` / `workspaceUnavailableEnvelope`), the proxy
boundary status mapping (401/403→401, 404→404, 429→429, else→500), and the input bounds
`MAX_NAME_LENGTH` 1000 / `MAX_SEARCH_LENGTH` 500 / `MAX_COMMENT_LENGTH` 50000 in
`routes/proxy.js`.

> **First real run of this series.** LIN-361 (the first scheduled run) was **Canceled with
> no report and no comments**, so there is no prior `api-*` report under `docs/reviews/` to
> inherit decisions from. This report is the baseline the next run measures against. The
> provider-unification track (LIN-306 / LIN-307–311) is a known, deliberate direction and is
> **not** re-proposed here; it is cross-referenced where a finding overlaps it.

## How this was grounded

Source read at HEAD across the caller-facing surfaces, counts re-derived (never trusting
numbers quoted in the ticket):

| Surface | File | LoC | `lib/errors.js` helper use |
|---|---|---:|---|
| Linear API Proxy | `routes/proxy.js` | 4497 | yes (76 `jsonError` + 126 helper calls) |
| Workspace API | `routes/workspace-api.js` | 3019 | yes (1 raw-json outlier) |
| Dispatch API | `routes/dispatch.js` | 736 | yes |
| Linear CLI | `lib/linear-cli.js` | 1138 | n/a (JSON-on-stdout contract) |
| Autopilot/Observation data | `routes/dashboard.js` | — | **no (22 hand-rolled sites)** |
| Collective | `routes/collective.js` | — | **no (15 sites, 2 ad-hoc `detail`)** |
| Next-run | `routes/next-run.js` | — | **no (4 sites)** |
| Linear OAuth | `routes/auth.js` | 246 | partial (HTML via `renderErrorPage`) |
| OpenRouter OAuth | `routes/openrouter-auth.js` | 194 | no |
| Workspace mgmt | `routes/workspace.js` | 143 | yes (clean) |

**Headline.** The three primary external surfaces — proxy, dispatch, workspace-api — are in
good shape: scope/auth separation, workspace isolation, input bounds, and the 4xx/5xx split
are consistently enforced, and the LIN-650 SSRF-guarded attachment relay is solid (https-only,
exact-host allowlist, path-traversal block, `redirect: 'error'`, `image/*` enforcement, double
10 MB cap). The findings below are real but bounded. Three rise to HIGH: one genuine security
gap (OpenRouter OAuth callback has no CSRF/`state` binding), one cross-tenant correctness
ordering bug latent behind today's Linear-only deployment, and one broken machine contract
(the CLI's documented JSON-on-stdout guarantee does not hold on any error path).

---

## Severity-ranked findings

### 🔴 HIGH

#### H1 — OpenRouter OAuth callback has no `state`/CSRF binding (login-CSRF)
`routes/openrouter-auth.js:52-79` (initiate) and `:86-169` (callback). The flow stores only a
PKCE `codeVerifier` in session and never generates or validates a `state` nonce. PKCE protects
the *token exchange* against code interception; it does **not** protect the *callback* against
CSRF. An attacker who completes their own OpenRouter authorization can feed a victim (already
Linear-authenticated) a callback URL carrying the attacker's `code`, binding the **attacker's**
OpenRouter API key into the victim's session — the victim's AI prompts then run on, and are
billed to / observable via, the attacker's key. Linear's own flow does this correctly:
`routes/auth.js:107` rejects on `state !== req.session.oauthState`.
**Alignment:** mirror `auth.js` — generate a `state` nonce alongside the verifier in the
initiate step, persist it in session, and reject on mismatch in the callback. *(Promoted to a
follow-up.)*

#### H2 — Proxy write endpoints run the capability gate before the workspace-availability check
`routes/proxy.js:1879` and the seven sibling writes at `:1970`, `:2062`, `:2177`, `:2236`,
`:2285`, `:2324`, `:2384`. Every write calls `denyIfUnsupported(provider, …)` *before*
`if (!token) return workspaceUnavailable(...)`. When a workspace is unavailable
(`store_unreachable` / `session_expired` / `not_connected`), `resolveProviderAccess` still
returns a fallback provider object, so `provider.supports(op)` is evaluated first. For Linear
(supports everything) this is a harmless pass that then falls through to the correct 503 — so
it is **inert under today's Linear-only deployment**. But for any provider that does not support
the op, an unavailable workspace yields a misleading `422 CAPABILITY_NOT_SUPPORTED`
(non-retryable, `config` category) instead of the true `503 WORKSPACE_*` envelope
(retryable, `upstream`) — the wrong wait-vs-escalate signal for an automated operator. The read
endpoints already order it correctly (`:1411` checks `!token` first).
**Alignment:** move the `!token`/`workspaceUnavailable` check ahead of `denyIfUnsupported` in
the eight write handlers, matching the read order. Overlaps the LIN-306/581 provider track but
is a self-contained ordering fix, not a re-proposal of it. *(Promoted to a follow-up.)*

#### H3 — The Linear CLI's JSON-on-stdout contract breaks on every error path
`lib/linear-cli.js:1132-1135`. The documented contract is "CLI outputs JSON for easy parsing by
AI agents." On the happy path it holds, but the top-level catch emits
`console.error('Error:', error.message)` — plain text on **stderr** with exit 1 — for every
operational failure (network/GraphQL error, "Issue not found" at `:259`/`:427`/`:707`, invalid
relation type at `:625`, label not found at `:451`). An agent parsing stdout as JSON gets empty
stdout and must scrape stderr. Worse, the inline-arg `JSON.parse` at `:955` (`create-issue`) and
`:983` (`update-issue`) sit **outside** the per-command try/catch that guards the `--stdin` path
(`:947-953`, `:975-981`), so malformed inline JSON throws a raw `SyntaxError` stacktrace to the
top-level catch instead of the friendly "Invalid JSON" message the stdin path returns.
**Alignment:** emit a structured `{ error: <message> }` (and any `code`) to **stdout** on
failure so success and failure are parseable from one stream; wrap the inline `JSON.parse` calls
in the same try/catch the stdin path already uses. *(Promoted to a follow-up.)*

### 🟠 MEDIUM

#### M1 — `workspace-api.js` surfaces raw `error.message` to clients on ~14 responses
`routes/workspace-api.js:337, 506, 597, 635, 886, 888, 1314, 1388, 1428, 1491, 1593, 1595,
1654, 1717, 1816, 1818` attach `{ message: error.message }` to the response body. The
`serverError.json(res, msg, details)` helper does support a `message` detail field, so the shape
is legal — but passing the **raw thrown message** through risks leaking internal/store/upstream
detail (Linear GraphQL error text, stack-adjacent strings) to the browser, and is inconsistent
with `dashboard.js`, which deliberately logs the real cause and returns only a generic
`{ error: 'Could not …' }`. **Alignment:** keep the `console.error` server-side log and return
only a curated message, or route through `classifyUpstreamError` so only the vetted-safe
`detail` is exposed.

#### M2 — Error-envelope drift: three route files bypass `lib/errors.js` wholesale
- `routes/dashboard.js` — **22** hand-rolled `{ error: … }` sites, zero helper use
  (e.g. `:542, 570, 578, 583, 592, 594, 598, 630, 636, 647, 731, 736, 753, 755, 799, 805, 817,
  840, 867, 888, 890, 903`). Bodies happen to match the canonical `{ error }` shape, so this is
  consistency debt, not a wire break. The `keepalive.send(status, { error })` sites can't use the
  `res`-based helpers as-is and would need a small envelope-builder.
- `routes/collective.js` — **15** hand-rolled sites; `:285` and `:317` use the ad-hoc `detail`
  key (`{ error: 'Could not reach Yap', detail: error.detail }`) — a "half-envelope" (one
  `errorEnvelope` field grafted onto a bare body). These upstream/Yap failures are exactly the
  `category: 'upstream', retryable: true` case `errorEnvelope` exists for.
- `routes/next-run.js` — **4** hand-rolled sites; `routes/auth.js` / `routes/openrouter-auth.js`
  / `routes/pipeline.js` / `routes/task-chat.js` all hand-roll HTML errors via a *second*
  renderer (`renderErrorPage` from `render.js`) rather than `htmlError` from `lib/errors.js`.

  **Alignment:** route JSON sites through `jsonError`/`badRequest`/`notFound`; drop the bare
  `detail` key (or adopt the full `errorEnvelope`); converge on one HTML error renderer. Large,
  low-risk consistency sweep — left in the report, not promoted, to avoid overproducing work.

#### M3 — Dispatch `take` is not retry-safe (ambiguous 404 on re-take)
`routes/dispatch.js:648`. A second `take` of an already-claimed item returns
`404 "Item not found or already taken"`, indistinguishable from a never-existed item. A consumer
that times out *after* a successful claim but *before* reading the response cannot safely retry —
it sees a 404 and may silently drop the work. **Alignment:** on a same-token re-take, echo the
existing claimed item (200) or return a distinct `409 ALREADY_TAKEN` carrying the original
claimant, so retry callers can disambiguate. (`lib/proxy-dedupe.js` is the established pattern
for this class of non-idempotent-create disambiguation.)

#### M4 — `auth.js` maps an upstream Linear fetch failure to 500, not 502/503
`routes/auth.js:150-157`. A failure fetching org/viewer from Linear (an *upstream* blip) renders
as HTTP 500, reading to monitoring as a server bug. The repo already has `classifyUpstreamError`
(`lib/errors.js:155`) for exactly this distinction, and `routes/task-chat.js:234` correctly
returns 502 for the analogous "failed to load the task" upstream case. **Alignment:** classify
and return 502/503 for the upstream-fetch failure.

#### M5 — CLI: inconsistent output shape across commands; mutation `success:false` not surfaced
`lib/linear-cli.js`. The JSON shape varies per command with no envelope: `viewer` → bare object
(`:803`), `issues`/`teams`/`labels` → bare arrays (`:816`/`:838`/`:909`), `add-label` →
`{success,message,issue}` (`:920`), write mutations → raw provider payload (`:959`/`:990`). And a
mutation that returns `success: false` (`:580`/`:599`/`:616`/`:668`) is printed with **exit code
0** — a scripting agent keyed off exit code believes a failed mutation succeeded; the label/relation
paths also dereference `data.issueUpdate.issue.identifier` (`:498`) without a null guard, so a
`success:false, issue:null` payload throws a raw TypeError. **Alignment:** standardize one
envelope (`{ ok, data }` / `{ ok, error }`) or document the per-command shapes as the contract,
and `process.exit(1)` on mutation `success:false`. (Companion to H3.)

### 🟡 LOW

- **L1 — Doc-vs-code drift on the keepalive error body.** `routes/proxy.js:1391` documents
  long-running errors as `{ error, statusCode }`, but every actual post-flush error path emits
  `{ error, detail }` (e.g. `:2950, 3159, 3275, 3431, 4218`); no `statusCode` key is ever set. A
  consumer told to read `statusCode` will never find it. Fix the doc or the body — don't add a
  third key.
- **L2 — `auth.js` echoes missing env-var *names* to a public page.** `routes/auth.js:50-54,
  80-84` renders `Missing environment variables: LINEAR_CLIENT_SECRET, …` on a 503. The names
  aren't secret values, but it's low-grade config disclosure to anonymous callers; log specifics
  server-side, render a generic page.
- **L3 — `workspace-api.js:280` single helper-bypass outlier.**
  `res.status(500).json({ error: 'Failed to list prompt traces' })` — the one raw-json site in an
  otherwise-compliant file. Use `jsonError(res, 500, …)`.
- **L4 — Proxy `GET /search` ignores `limit`, hardcodes `first: 50`** (`routes/proxy.js:1571`).
  Every other collection read accepts a clamped `limit` (issues max 250 `:1479`, stack max 50
  `:2446`, dispatch max 100 `:4327`). Documented at `:1064`, so contract-accurate — minor
  pagination inconsistency only.
- **L5 — Proxy dispatch create: `issueUrl`/`issueIdentifier` skip the control-char guard.**
  `routes/proxy.js:3903`/`:3895` length-check but don't run `DANGEROUS_CHARS_REGEX`, unlike the
  sibling string fields `prompt`/`promptName`/`issueTitle`/`repo` (`:3912-3927`). These are stored
  and later rendered in dispatch UIs. Add the guard for parity.
- **L6 — Proxy 201-vs-200 inconsistency on association creates.** Label-add returns 200 on both
  "already present" (`:2357`) and "added" (`:2364`), so a caller can't distinguish a created
  association from a no-op by status alone; description append/replace also return 200
  (`:2108`). Defensible if labels/descriptions are modeled as updates — flagged as a naming/verb
  consistency note. (The comment-dedupe 200-vs-201 at `:2209` is intentional and documented.)
- **L7 — Dispatch `recent-prompts` GET/POST asymmetry on a missing store.**
  `routes/dispatch.js:442-444` (GET) returns `{ prompts: [] }` when `userPreferencesStore` is
  absent; `:466-468` (POST) returns 503 for the same missing dependency. Document the asymmetry or
  make POST a no-op success.
- **L8 — CLI `--file` with no path value silently misparses the output mode.**
  `lib/linear-cli.js:41-46` — a trailing `--file` leaves the path `undefined` and falls through to
  base64/metadata mode instead of erroring. Validate that `--file` is followed by a path.

---

## Dimension verdicts

- **Design consistency** — the *shape* (`{ error }`) is near-universal; the drift is in
  *routing* (M2: dashboard/collective/next-run/OAuth bypass the helpers) and a few status-code
  outliers (M4, L6). No conflicting envelope shapes on the primary external surfaces.
- **Input validation** — **clean** on the trust boundaries. Proxy enforces scope
  (`requireWriteScope` on every mutation), workspace isolation (`req.proxyUrlKey` from the
  validated token), and the MAX_* bounds at each create/update; collective/dashboard/workspace-api
  re-resolve ownership against `session.workspaces` and never trust the route key; the SSRF guard
  is solid. Minor gaps only (L5; CLI arg validation L8).
- **Error handling** — correct 4xx/5xx split throughout (incl. 409 for active runs, 422 for the
  capability gate, 429 free-tier). The watch-items are leakage-shaped: M1 (raw `error.message`)
  and the smaller M2/`detail` passthrough. No empty/swallowed catches found on the primary
  surfaces; the CLI is the exception (H3/M5).
- **Contract robustness** — backwards-compatible, source-neutral shapes are honored (proxy wire
  contract, collective `state` normalization, dashboard per-workspace degradation). The robustness
  gaps are retry-safety (M3 dispatch `take`) and the CLI machine contract (H3/M5).

## Class check

The findings are **not** isolated; two name a class, with all known instances listed:
- **Error-envelope routing drift** is a class (M2): instances in `dashboard.js` (22),
  `collective.js` (15), `next-run.js` (4), plus the dual-HTML-renderer split in
  `auth.js`/`openrouter-auth.js`/`pipeline.js`/`task-chat.js`, and the lone `workspace-api.js:280`
  outlier (L3). Named here; deliberately **not** expanded into the task.
- **CLI JSON-contract fragility** is a class (H3 + M5): error paths (`:1132`), inline-arg parse
  (`:955`/`:983`), per-command shape variance, and unsurfaced mutation `success:false`. Promoted as
  one follow-up scoped to the contract, not a per-symptom split.

The OpenRouter CSRF gap (H1) and the proxy capability-gate ordering (H2) were checked for siblings:
H1 is specific to the one OAuth flow that omits `state` (Linear's is correct); H2's eight write
sites are all listed.

## Test-level note

H1 (CSRF) and H2 (cross-provider ordering) are integration/route-level behaviors — their fixes
warrant route-level tests (a callback rejected on `state` mismatch; an unavailable non-Linear
workspace returning 503 not 422), not unit mocks. H3/M5 (CLI contract) are process-level and want
a thin spawn-and-parse test asserting stdout stays JSON on the error path.

---

## Follow-ups minted (top-3 by severity)

Per the cap, only the three HIGH findings were promoted to Linear tasks; **every** finding above
remains recorded here for the next run to promote what still matters. See the LIN IDs in the
task comment on LIN-665.

1. **H1** — OpenRouter OAuth callback: add `state`/CSRF binding.
2. **H2** — Proxy writes: check workspace-availability before the capability gate.
3. **H3** — Linear CLI: keep the JSON-on-stdout contract on error paths.
