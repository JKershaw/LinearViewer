# Auth, accounts & workspaces

Area notes for `auth-accounts-and-workspaces` in the registry. Format and rules: README.md.

## Lessons

- To retire a logged workspace setting, take it out of `SETTINGS` in
  `lib/workspace-change-log.js` and keep its words in `summarizeWorkspaceEntry`. Its old rows
  then still read, are not undoable, and `undo` refuses them before `readCurrent` or `apply`
  runs. Removing only the Settings undo sink is not enough: the route falls back to writing a
  workspace feature flag. Leave the stored preference unread; don't migrate it (LIN-4393).

## Waiting

- `lib/email-auth.js`: `normalizeEmail` only trims and lowercases, so plus and dot aliases of one inbox each get a fresh per-address budget; and a provider refusal (quota, suspension) is logged by name only behind the same "check your inbox" page, so the silent lockout returns at Resend's limit. Latent while `EMAIL_TRANSPORT=off`. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
- `lib/session-options.js`: `NODE_ENV==='production'` is the only production signal for seven controls (the `SESSION_SECRET` refusal, both secure cookies, `trust proxy`, the HTTPS 301, HSTS, the console-email refusal); unset, each fails open silently. Waiting: a second signal, or a boot refusal when hosted without it. (Security Review, 10 Nov.; `docs/reviews/security-review-2026-11-10.md`.)
