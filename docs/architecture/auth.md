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

