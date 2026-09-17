Scope: environment variables and configuration. Moved verbatim from CLAUDE.md (LIN-2896).

## Environment Variables

```
LINEAR_CLIENT_ID        OAuth client ID from Linear
LINEAR_CLIENT_SECRET    OAuth client secret from Linear
LINEAR_REDIRECT_URI     Callback URL (must match Linear OAuth app config)
LINEAR_ACCESS_TOKEN     Personal API key for auto-authentication (optional, bypasses OAuth)
SESSION_SECRET          Secret for signing session cookies
PORT                    Server port (default: 3000)
MONGODB_URI             MongoDB connection string (optional, uses file storage if not set)
MONGODB_TEST_URI        Test-only: real MongoDB for tests/unit/mongo-smoke.test.js (LIN-1337). NOT a runtime var. Deliberately separate from MONGODB_URI so a developer's production URI can't be hit by the suite's concurrency probes. Unset locally skips the suite explicitly; CI sets it via a mongo:8.0 service container and hard-fails if missing
OPENROUTER_API_KEY      Server-side OpenRouter API key (optional, users can connect via OAuth)
OPENROUTER_REDIRECT_URI Callback URL for OpenRouter OAuth (optional, defaults to /auth/openrouter/callback)
OPENROUTER_FREE_TIER_KEY Server-side API key for free tier users (optional, enables rate-limited free prompts)
OPENROUTER_FREE_TIER_MODEL  Model free-tier requests are clamped to (optional, default openai/gpt-5.4-mini). Must be a curated AVAILABLE_MODELS id; anything else is ignored (warned at startup) and the free tier stays on the default. Free-tier only — does not move the default for workspaces with no stored model preference
FREE_TIER_DAILY_LIMIT   Per-workspace daily free-prompt limit (optional, default 20)
FREE_TIER_HOURLY_LIMIT  Global hourly free-prompt limit across all workspaces (optional, default 50)
GITHUB_CLIENT_ID        GitHub App user-to-server OAuth client ID (required for GitHub login/binding)
GITHUB_CLIENT_SECRET    GitHub App user-to-server OAuth client secret (required for GitHub login/binding)
GITHUB_APP_ID           GitHub App ID, used to sign the App JWT (required for GitHub login/binding)
GITHUB_APP_PRIVATE_KEY  GitHub App private key (PEM), used to sign the App JWT (required for GitHub login/binding)
GITHUB_APP_SLUG         GitHub App slug, used to build the install URL (required for GitHub login/binding)
GITHUB_REDIRECT_URI     Callback URL for GitHub user-to-server OAuth (optional; falls back to the App's default callback when unset)
GITHUB_PROJECTS_REDIRECT_URI  Callback URL for the github-projects provider (optional; falls back to GITHUB_REDIRECT_URI)
DISPATCH_OWNERLESS_BROKER_COMPAT  Whether ownerless (createdBy:null) tokens are still tolerated (optional, default ON). Set to off/false/0/no to restore strict owner-required minting. Its reach is EVERY bootstrap mint, structurally (LIN-1582): `ProxyTokenStore.createToken` itself throws on a `kind: 'bootstrap'` mint with no `createdBy`, so no call path — present or future, including the test-only `/test/create-proxy-token` — can mint one, and ownerless inheritance is impossible rather than merely unused. The three production sites additionally refuse ahead of the store so the policy surfaces in each one's own idiom rather than as a raw throw: `POST /api/dispatch/broker-token` 503s an ownerless caller, `provisionBootstrapToken` refuses (fail-closed for a claude-code dispatch, a dropped best-effort block for a prose harness — Collective's prose branch routes through it), and `POST /workspace/:urlKey/api/proxy/tokens` 503s a `bootstrap: true` request from a session with no accountId (its non-bootstrap path is untouched). `exchangeBootstrapToken` is deliberately NOT gated — it mints `kind: 'standard'`, so an already-issued ownerless bootstrap stays exchangeable and the compat population is never stranded mid-flight. Fails SAFE — only an explicit off-value switches strictness on, so an unset var or a typo leaves the compat lane running. ORDERING: the host runner authenticates with an ownerless pre-LIN-1397 dispatch token, so re-issue that token as OWNED (create one while signed in; `GET .../api/dispatch/tokens` reports `hasOwner`) BEFORE switching this off, or the runner's own mints start 503ing. See lib/ownerless-token-policy.js (LIN-1447/LIN-1448/LIN-1582)
YAP_BASE_URL            Yap chat server base URL for the experimental Collective live view (optional, defaults to https://yap.jkershaw.com)
YAP_PASSWORD            Yap server password (optional, sent as Bearer auth on Yap calls)
PLAN_FEE_MONTHLY_USD    Operator-configured plan-fee amount for the /kpis cost-per-terminal-marked-task card's cash headline (optional, no default — unset or non-numeric both read as null via lib/plan-fee-config.js, same `|| null` convention as DEPLOY_*, so the card renders "—" until set). Schema/config only as of LIN-1958: the amortisation rule that would turn this into a cash-per-task figure (period, workspace scope) is not yet implemented
WEEKLY_BUDGET_USD_PER_POINT  Overrides the $-per-weekly-window-point calibration factor the /kpis burn gauge (lib/weekly-budget.js, LIN-2118) uses to turn windowed $ spend into an estimated % of the subscription window (optional; defaults to the one recorded LIN-2087 correlation, ≈$39.65/point)
WEEKLY_BUDGET_CHECKPOINT_PERCENT  An operator-entered current-window-% reading, paired with WEEKLY_BUDGET_CHECKPOINT_AT, that recalibrates the burn gauge (optional; ignored — falls back to a telemetry-only estimate from zero at reset — unless its paired timestamp falls inside the CURRENT Thursday-06:00Z-reset window)
WEEKLY_BUDGET_CHECKPOINT_AT  ISO timestamp of the WEEKLY_BUDGET_CHECKPOINT_PERCENT reading above (optional; both vars are read together, see lib/weekly-budget.js)
```

The five `GITHUB_*` required vars are the exact set in `GITHUB_REQUIRED_ENV` (`lib/providers/github/app-auth.js`); `getMissingGitHubConfig()` reports which are unset. `GITHUB_API_BASE`, `GITHUB_OAUTH_AUTHORIZE_URL`, and `GITHUB_OAUTH_TOKEN_URL` are **hardcoded consts**, not environment variables — do not add them here.

