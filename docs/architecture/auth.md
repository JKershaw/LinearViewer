Scope: authentication — Linear OAuth 2.0 and related auth flows. Moved verbatim from CLAUDE.md (LIN-2896).

## Authentication

### Linear OAuth 2.0

```
GET /auth/linear     → Redirect to Linear OAuth (with state parameter)
GET /auth/callback   → Exchange code for access token, store in session
GET /logout          → Destroy session, redirect to login
```

- Sessions stored in MongoDB (production) or MangoDB file-based storage (development)
- Tokens expire after 24 hours (with automatic refresh)
- State parameter validated to prevent CSRF

### Personal Access Token (PAT) Mode

For local development without OAuth configuration:

1. Get a personal API key from: https://linear.app/settings/api
2. Set `LINEAR_ACCESS_TOKEN=lin_api_xxxxx` in your `.env` file
3. Start the server — you'll be logged in automatically

PAT mode:
- Auto-creates a session on first visit (no OAuth redirect)
- Single workspace only (tied to the token's organization)
- Token never expires (no refresh needed)
- OAuth still works alongside PAT if OAuth vars are configured
- Logout destroys session, but next visit re-creates it automatically

### OpenRouter OAuth (PKCE)

Users can connect their OpenRouter account for AI recommendations:

```
GET  /auth/openrouter            → Consent interstitial (LIN-2412): grant or decline durable
                                   unattended-use consent. Renders Harbour's own page — it does
                                   NOT redirect off-site. Both choices proceed to /begin.
POST /auth/openrouter/begin      → Begin the PKCE OAuth flow (S256). `consent=granted` stashes the
                                   pending-consent intent; anything else clears it, so declining
                                   still connects the key — only consent is withheld.
GET  /auth/openrouter/callback   → Exchange code for API key; persist durably per account, and
                                   record consent only when /begin stashed the intent
POST /auth/openrouter/consent    → Retroactive consent for an ALREADY-connected account
                                   (409 `not_connected` when no durable key exists)
POST /auth/openrouter/disconnect → Remove stored API key (clears the consent flag in the same write)
```

- Uses PKCE flow with S256 code challenge method
- Returns a permanent API key (no expiry, no refresh needed)
- API key persisted durably per account in `lib/user-preferences.js` as the single source of
  truth (LIN-498); `req.session.openRouterApiKey` is only a request-scoped mirror
- **Consent, not the key, is the opt-in bit** (LIN-2412). `openRouterDurableConsentAt` is a
  sibling account-owned preference gating *unattended* use only; it is deliberately NEVER
  mirrored into `req.session` (pinned by `tests/unit/settings-route-consent-census.test.js`)
- Interactive requests fall back to the `OPENROUTER_API_KEY` env var if no OAuth connection.
  Unattended consumers do NOT: `resolveConsentedKeyForGroup`
  (`lib/openrouter-key-resolver.js`) requires key **and** consent and returns `null` on any
  miss — never env, never free tier

### GitHub App (Installation)

Users can log in with — or add — a GitHub source via a **GitHub App installation** flow
(migrated from a plain OAuth App; LIN-541/703/761). `routes/github-auth.js` is its own
multi-step router:

```
GET  /auth/github           → Redirect to the GitHub App install page (repo picker)
GET  /auth/github/callback  → Mint an installation token from installation_id, show repo-select page
POST /auth/github/link      → Write the binding: linkProvider(workspace, 'github', repo, creds)
```

- **Three-step flow**: install (repo picker) → callback mints an installation token → link writes the provider binding.
- **Two entry points share the routes**: the landing "Continue with GitHub" (`mode: 'new'`) and the
  settings "Add a source" (`mode: 'add-source'`). Intent is carried in the **session `mode`**, not the
  OAuth `state` — both drive the same three routes.
- App-JWT internals (installation-token mint, user-to-server OAuth exchange) live in
  `lib/providers/github/app-auth.js`. `getMissingGitHubConfig()` there is the **single config
  predicate** — an empty result means the flow can be started and completed — and is the shared guard
  for both the `/auth/github` route and the settings add-source affordance.
- **Not env vars**: `GITHUB_API_BASE`, `GITHUB_OAUTH_AUTHORIZE_URL`, and `GITHUB_OAUTH_TOKEN_URL` are
  **hardcoded consts** in `app-auth.js` (the App migration centralized them as literals), not
  `process.env` reads — do not document them as environment variables.

### Email magic link (LIN-1892)

Email is an **identity type** on the durable account (`accounts.identities[]`,
`provider: 'email'`, `scope: <normalised address>`), **not** a workspace provider —
there is no `lib/providers/email`. Logic lives in `lib/email-auth.js`; the thin HTTP
layer is `routes/email-auth.js`; pages are `lib/render-email-auth.js` and
`lib/render-account-home.js`.

```
GET  /auth/email          → Form (mints a send nonce), or "You're signed in" for a live account
POST /auth/email/send     → One "check your inbox" page for every address
GET  /auth/email/confirm  → Confirm page (mints a confirm nonce); NEVER consumes the link
POST /auth/email/confirm  → CSRF checks → N2 guard → consume → sign in → /account or first workspace
GET  /account             → Account home for a signed-in account with zero workspaces
```

**Availability** — `lib/email-availability.js` (zero imports) is the one predicate
behind the transport, the 503s, the landing-hero CTA (threaded as `emailEnabled`) and the
landing navbar CTA (which calls it directly). `resolveEmailTransportKind(env)`:
`'resend'` needs `RESEND_API_KEY` + `EMAIL_FROM` + a valid `EMAIL_LINK_ORIGIN`;
`'console'` needs `EMAIL_TRANSPORT=console` and not production; `'capture'` needs
`EMAIL_TRANSPORT=capture` under `NODE_ENV=test`; anything else is `null` (off).
`NODE_ENV` only refuses or scopes — it never turns email on. Only this module and
`lib/email-transport.js` read the email variables; `server.js` takes its startup line and
refusal warning from it (pinned by `tests/unit/email-import-boundary.test.js`).

**Link origin** — emailed links are built from `EMAIL_LINK_ORIGIN`, never from the
request's `Host`: a forged `Host:` on `/auth/email/send` would otherwise mail a victim a
genuine token pointing at another host. Resend without it resolves to off; console/capture
fall back to the request origin (their links reach only the server log / test outbox).

**Links** — 32 random bytes (base64url), stored only as SHA-256 (`email-magic-links`,
`_id` = hash), 15-minute expiry enforced by every query, `peek` never consumes, `consume`
is an atomic `findOneAndUpdate` (single use). Sends are throttled per address (3 / 15 min)
and per IP (10 / 15 min), and every send answers with the same page (no enumeration).
A TTL index removes dead rows a day after expiry.

**Login-CSRF (G1)** — `POST /auth/email/confirm` is refused (403, nothing consumed) unless,
in this order and before any token is touched: (a) `Sec-Fetch-Site` is absent or
`same-origin`; (b) the session holds this browser's confirm nonce, minted by its own GET of
the confirm page, bound to the token, at most 15 minutes old, and single use. The session
cookie is `sameSite:'lax'` (`lib/session-options.js`, shared with the tests), so a
cross-site POST carries no cookie and so no nonce. The confirm page is served with
`frame-ancestors 'none'`, `X-Frame-Options: DENY`, `no-store` and `no-referrer`. The send
form carries a send nonce, so a cross-site send can't plant a session in a victim's browser.
Opening a link in another browser is supported: that browser's GET mints its own nonce and
shows an "asked for from another device" notice.

**N2 — a sign-in link never attaches an email to a live account.** If the session already
holds account P, the confirm proceeds only when the address is already on P (checked
before and again after consume); otherwise 409 with no confirm button and nothing
consumed, attached or offered. Attaching an email to a live account is a separate,
account-bound link mode (LIN-1892 S3). A sign-in-mode confirm never produces a merge offer.

**Session** — the confirm carries `workspaces`/`accountId`/`identityAuthenticatedAt`
across `regenerate()`, then calls `establishAccount(…, 'email', emailNorm, {}, null)`: a
`null` workspace writes no account↔workspace edge. Preferences and the theme cookie are
rehydrated like the provider callbacks.

**Zero-workspace accounts (N1)** — a session with `accountId` and no workspaces is signed
in, not signed out: `/`, `/swipe`, `/swim` and `/ship` redirect it to `/account`, and PAT
auto-login (`lib/pat-session.js`) skips it. Connecting GitHub from `/account` reuses the
`github:<userId>` container (the LIN-2802 fresh-container gate requires an existing
workspace). Workspaces don't follow a person to a new device yet (follow-up behind LIN-2149).

### Free Tier (Rate-Limited)

When `OPENROUTER_FREE_TIER_KEY` is set, users without an OpenRouter connection get limited free prompts:

- API key source priority: user OAuth > env key > free tier key > none
- Per-workspace daily limit: 20 prompts (resets at midnight UTC)
- Global hourly limit: 50 prompts across all workspaces
- Uses atomic check-and-increment (`tryUse()`) to prevent race conditions
- Footer shows `ai: ● free (N/20)` status; settings page shows usage info
- Returns 429 with usage metadata when limits exceeded
- Free-tier calls are **clamped to one model**, ignoring the workspace preference and any
  per-request override, so a free user can never bill an arbitrary/expensive model against
  the operator's shared key (LIN-513). The clamp lives in the `forceDefault` branches of
  `resolveWorkspaceModel`/`resolveAiOperationModel` (`lib/workspace-preferences.js`) and
  returns **before** the prefs lookup, so it fails closed. `resolveRoadmapModelOverride`
  (`routes/workspace-api.js`) is the same gate on the LIN-819 per-request override path.
- The **value** it clamps to is `resolveFreeTierModel()` (`lib/openrouter.js`, LIN-1333):
  `OPENROUTER_FREE_TIER_MODEL` when set to a curated `AVAILABLE_MODELS` id, else
  `DEFAULT_MODEL`. Only that value is configurable — the precedence above is unchanged.
  It **fails closed**: an uncurated value is ignored (never passed unchecked to
  OpenRouter) and warned about once at startup via `getFreeTierModelConfigWarning()`,
  since a silent downgrade would otherwise hide the operator's typo. The var is scoped to
  the free tier: workspaces with no stored preference keep getting `DEFAULT_MODEL`, so the
  two can diverge (e.g. a cheaper free tier than the paid default).


### Workspace ownership (LIN-1892)

A workspace's **owner** is its `role: 'owner'` edge in `account-workspaces`. It is
written by `bindAccountToWorkspace` (`lib/account-workspace-store.js`), only for an edge
that is a fresh insert and, when its own lookup runs, sorts first among the workspace's edges
by `(createdAt, _id)`; the `account_workspaces_one_owner` partial unique index
(`lib/db-indexes.js`) keeps concurrent first binders to one. Under a race the owner is
whichever of them marks first, which need not be the earliest `createdAt` (it is stamped
before the write lands). Read it with `getWorkspaceOwnerAccountId(workspaceId,
accountStore)`, which resolves a merged owner to its survivor and returns `null` when there's
no owner edge. This is unrelated to the credential-scope `ownerAccountId`.

The owner edge is what gates the **runner copy** (LIN-3131 / LIN-3059 S2b): a session may mint
one only when `getWorkspaceOwnerAccountId` says it owns the workspace. The mint route
(`routes/proxy-tokens-admin.js`, `POST .../api/proxy/tokens` with `{ "runner": true }`) calls
`ProxyTokenStore.mintGrantBootstrap` with **server-resolved** grants `['take','dispatch']` — a
client can never name a grant (`400 GRANTS_NOT_CLIENT_SETTABLE`) — and a fixed `runner` lifetime
profile (1h bootstrap / 24h working, `lib/proxy-scopes.js`). The owner seam is
`lib/workspace-owner.js`'s `checkWorkspaceOwner`, late-bound in `server.js` via
`proxyTokenStore.setOwnerCheck(...)` after `accountWorkspaceStore` exists; unwired, erroring, or a
corrupt `mergedInto` chain fails closed as `503 OWNER_CHECK_UNAVAILABLE`. Ownership refusals are
`409 WORKSPACE_OWNER_UNSET` (no owner edge) and `403 GRANT_OWNER_ONLY` (a different account owns
it); `503 GRANT_OWNERLESS` is a session with no account. Any signed-in member may list and revoke
runner credentials from the Proxy page, and revoking one revokes its whole lineage. `dispatch` is
**enforced** on the three enqueue routes (`requireGrant('dispatch')`, LIN-2884 T3 / LIN-3136): the
runner copy carries it, as do the owner's driver copies (`{ "purpose": "driver" }`, `['dispatch']`
only, the 48h `worker` profile) and the orchestrators the server declares it for (kickoff child,
owner Autopilot dispatch, feedback autopilot).

The same owner edge also gates the **legacy dispatch-token mint** (LIN-3137 / LIN-2884 J5). A
legacy dispatch token is a never-expiring take path, so only the workspace owner may mint one:
`POST /workspace/:urlKey/api/dispatch/tokens` reuses the same owner seam and refusal vocabulary —
`403 GRANT_OWNER_ONLY` (a different account owns it), `409 WORKSPACE_OWNER_UNSET` (no owner edge),
`503 GRANT_OWNERLESS` (the session has no account), `503 OWNER_CHECK_UNAVAILABLE` (seam unwired,
throwing, or a corrupt `mergedInto` chain) — and writes nothing on any refusal. This is a **mint
gate only**: existing tokens keep authenticating (the verify path has no owner branch), and
`GET`/`DELETE` on the same path are unchanged.

Workspaces that already have an edge when this lands get **no** owner automatically;
assigning them is an operator decision (LIN-1892 Open decision 2). Until an owner is assigned,
the owner-gated mints (the runner copy and the legacy dispatch token) refuse with
`409 WORKSPACE_OWNER_UNSET`. A workspace with **no**
edge at all (seen only in sessions: the dry-run's bucket (c)) can't be told apart from a new
one, so the first sign-in after deploy that binds it makes that account its owner, and it
leaves bucket (c). Run the dry-run **before** deploying to see that population.
To see the numbers, run the read-only dry-run
against the store (`MONGODB_URI`, else the MangoDB dir `HARBOUR_DATA_DIR`/`./data`):

    node scripts/dry-run-workspace-ownership.mjs --s1-deployed-at 2026-10-01T00:00:00Z

It prints a summary, then JSON:

- (a) workspaces with one canonical account;
- (b) workspaces with more than one;
- (c) workspace ids seen in sessions with no edge. This is a lower bound, since sessions last 30 days;
- (d) accounts with only local identities;
- (e) workspaces first bound after the given deploy instant that still have no owner, i.e.
  a crash between the insert and the owner mark. (e) is only computed with `--s1-deployed-at`.

It uses only `find`/`countDocuments`, and never prints a session id, token or identity
credential.
