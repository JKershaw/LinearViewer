# Auth, accounts & workspaces

Area notes for `auth-accounts-and-workspaces` in the registry. Format and rules: README.md.

## Lessons

- To retire a logged workspace setting, take it out of `SETTINGS` in
  `lib/workspace-change-log.js` and keep its words in `summarizeWorkspaceEntry`. Its old rows
  then still read, are not undoable, and `undo` refuses them before `readCurrent` or `apply`
  runs. Removing only the Settings undo sink is not enough: the route falls back to writing a
  workspace feature flag. Leave the stored preference unread; don't migrate it (LIN-4393).

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
