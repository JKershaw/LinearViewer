# Waiting fixture

Copied from docs/areas/auth-accounts-and-workspaces.md at bf2d1575f (LIN-4494): the ## Waiting section only, for the importer test on a shallow checkout.

## Waiting
- `lib/email-auth.js`: `normalizeEmail` only trims and lowercases, so plus and dot aliases of one inbox each get a fresh per-address budget; and a provider refusal (quota, suspension) is logged by name only behind the same "check your inbox" page, so the silent lockout returns at Resend's limit. Not latent: the hosted email door is on (Onboarding & Cold-Start Review, 11 Nov.). (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `lib/session-options.js`: `NODE_ENV==='production'` is the only production signal for seven controls (the `SESSION_SECRET` refusal, both secure cookies, `trust proxy`, the HTTPS 301, HSTS, the console-email refusal); unset, each fails open silently. Waiting: a second signal, or a boot refusal when hosted without it. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `routes/jira-auth.js`: a Jira sign-in's workspace is keyed on the person (`jira:<accountId>`),
  as GitHub's is, while Linear's is keyed on the organisation. So each teammate who presses
  "Continue with Jira" gets a separate workspace over the same site, with its own owner, run
  controls and runner key, and their runners can take the same issue unseen. Nothing joins
  them or says so, and Settings' "member" copy cannot hold there. That is a team-workspace
  decision bigger than a tidy; the missing invite itself is v1's deferral. (Onboarding &
  Cold-Start Review, 11 Nov.; `docs/reviews/onboarding-cold-start-review-2026-11-11.md`.)
- `lib/task-share-store.js`: share tokens are hashed by their own sha256-hex helper, the same
  digest as `hashHarbourToken` (`lib/harbour-token-format.js`), which the proxy, dispatch and
  feedback stores and the proxy limiter now share. A share token is not a Harbour-format token (no
  prefix), so whether it takes the same helper is a naming call, not a fix. (LIN-4451 leftovers.)
