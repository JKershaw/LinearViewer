# Incident: Railway security disclosure, and rotating every Harbour credential held in Railway

**Date:** 2026-10-21 to 2026-10-23
**Status:** Contained and rotated on 2026-10-23, at about 08:15Z. Email sign-in is switched off until LIN-3771 lands.
**Severity:** High potential, low actual. Every credential in Harbour's Railway variables was treated as exposed. No misuse of Harbour's credentials or database was found. harbour.cat stayed up, apart from a short database outage during the rotation.

## Summary

On 2026-10-21, Railway disclosed that an unauthorised third party "may have accessed encrypted environment variables and, for some of them, obtained the decrypted contents". Railway believed the aim was "compromising AI inference providers". Railway's preliminary report (22 Oct) and a targeted notice on 23 Oct came later; see "Follow-up" below.

Railway's response:
- notified upstream providers, who revoked keys proactively;
- invalidated every Railway API token;
- revoked storage-bucket credentials;
- paused builds and brought them back by tier;
- asked customers to "immediately revoke and reissue all environment variables".

Harbour runs on Railway, so every secret in its variables was in scope. The work was triage, containment and rotation, run by the operator with read-only agents on the dispatcher host, while John made each change on the Railway and provider websites.

## Timeline (UTC)

| Time | Event |
|---|---|
| 21 Oct, evening | Railway's disclosure and email. Builds paused. |
| 22 Oct 04:17 | Railway invalidates all API tokens. |
| 22 Oct ~06:00 | John puts the Harbour pipeline on hold. |
| 22 Oct 06:19 | Triage agent (LIN-3769) stops at its first check: the laptop's `railway` CLI is logged out (`invalid_grant`). |
| 22 Oct 06:25–06:36 | Triage run 2 finds four services in the Harbour project, public TCP proxies on both MongoDB services, and no misuse since the disclosure. It also finds a sign-in spam bot (LIN-3771). |
| 22 Oct ~07:20–07:30 | John takes yap, Dash and Harbour OS offline and disables public networking on both MongoDB services. |
| 22 Oct ~07:40 | OpenRouter emails that the exposed keys were revoked automatically. The keys had spend limits, and usage shows nothing untoward. |
| 22 Oct 06:51–07:02 | Triage runs 3 and 4 account for every authenticated public-endpoint session before the disclosure (see "Misuse"). |
| 22 Oct | Rotation held until John is back at the machine. |
| 23 Oct ~07:10 | MongoDB-harbour backed up; daily backups turned on. |
| 23 Oct ~07:15 | MongoDB-harbour moved from a US region to EU West, next to harbour-cat, and `MONGO_PUBLIC_URL` removed. |
| 23 Oct ~07:30 | MongoDB password regenerated. The Regenerate button is under the database's Database tab → Config → Connection, not under Settings. harbour-cat loses its database until it redeploys. |
| 23 Oct ~07:35 | harbour-cat redeploy fails inside Railway: `seal the secrets … KMS encrypt … Permission … denied on … cryptoKeys/variables-kek`. "Deploy Latest Commit" succeeds at ~07:42. |
| 23 Oct ~07:45 | The dispatcher reports both workspaces auth-stopped after 401s during the outage (LIN-3695 back-off working as designed). John stops the dispatcher until the rotation is done. |
| 23 Oct ~07:55–08:15 | App secrets rotated one at a time, against each provider's documentation, then deployed together, verified and the old ones revoked. |
| 23 Oct 08:13 | Dispatcher restarted; polling cleanly. |
| 23 Oct ~08:25 | An unused, empty second MongoDB service, publicly reachable since March, is deleted. |
| 23 Oct 08:22 | LIN-3771 read-only check: the bot sent 47 sign-in emails since 20 Oct 16:47Z. |
| 23 Oct ~08:55 | Email sign-in switched off with `EMAIL_TRANSPORT=off`. |

## What was in scope (names only)

- **harbour-cat:**
  - `MONGODB_URI` (a reference to `${{MongoDB-harbour.MONGO_URL}}`);
  - `SESSION_SECRET`;
  - `GITHUB_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY`, both belonging to the one GitHub App;
  - `LINEAR_CLIENT_SECRET`;
  - `JIRA_CLIENT_SECRET`;
  - `RESEND_API_KEY`;
  - `OPENROUTER_FREE_TIER_KEY`.

  Production has no `OPENROUTER_API_KEY`. Workspace LLM calls use the OAuth key stored in the database.
- **MongoDB-harbour:** the root password, plus `MONGO_URL` and `MONGO_PUBLIC_URL`.
- **Out of scope** (John's decision):
  - yap has no environment variables.
  - Dash stays down. Its variables were not rotated, so rotate them before it comes back up.
  - Harbour OS held GitHub keys. They were deleted from Railway and rotated at GitHub.

These services make up every Railway project in the workspace ("John Kershaw's Projects").

## Rotation (each step checked against the provider's own documentation)

| Secret | How |
|---|---|
| MongoDB password | Railway "Regenerate", then redeploy harbour-cat. Railway's docs warn against changing it by hand: the variable and the database would fall out of sync. |
| GitHub App private key | New key, set and deployed, then the old key deleted. An App can hold up to 25 keys, so there was no downtime. |
| GitHub client secret | New secret, then the old one deleted after verifying. |
| Linear client secret | "Rotate secret". The old secret stops working at once; existing workspace tokens refresh with the new one. |
| Jira client secret | Regenerated in the Atlassian developer console. |
| Resend | New key with Sending access only, restricted to the domain, then the old key removed. |
| `SESSION_SECRET` | New random value. It only signs the browser session cookie (`server.js`), so the only effect was one sign-out. |
| OpenRouter free tier | New key with a $20/day limit. OpenRouter had already revoked the old key. |

**Verified after the deploy:**
- `/kpis` returns 200, and database reads work;
- `/auth/github` and `/auth/linear` redirect correctly, so GitHub's PEM-shape check passes;
- John signed in with Linear and used the GitHub workspace.

## Misuse

**Before the disclosure, through the public endpoint:** every authenticated session matches an approved production step:
- 19 Oct: LIN-3632, LIN-3693, LIN-3697 and LIN-3618;
- 20 Oct: LIN-3731 and LIN-3734.

The single connections on 14, 16, 18 and 20 Oct never authenticated: scanners, one of which sent HTTP to the Mongo port.

**Since the disclosure:** only harbour-cat's private address, plus the triage's own reads. No auth failures, and no foreign users, databases, collections or accounts.

**`GH_TOKEN` / `RAILWAY_API_TOKEN`:** one agent reported these in the database container. They appear only inside a `railway ssh` shell, which Railway's ssh session adds. They are not in the `mongod` process, in any service's variables, or locally, so there was nothing of Harbour's to rotate.

## The sign-in spam bot (found during triage; LIN-3771)

From 2026-10-20 16:47Z, a bot sent 47 sign-in requests to `POST /auth/email/send`, and Resend delivered most of the emails.
- **Senders:** 18 IPs, each sending at most 4, with 46 old, spoofed user agents.
- **Recipients:** each address was sent to only once, and none belonged to an account. No link was used.
- **Why the limits didn't stop it:** it stayed under Harbour's per-IP and per-address limits.

This looks like "subscription bombing", which pushes real people's addresses through many sites' forms. Email sign-in is off with `EMAIL_TRANSPORT=off`; delete the variable to turn it back on. LIN-3771 adds rate limits and a bot check before re-enabling.

The bot started at 16:47Z on 20 Oct, inside Railway's attack window (see "Follow-up"). Nothing links the two: the bot targeted addresses with no account and used no link. It is recorded here so the overlap isn't rediscovered later.

## Follow-up: Railway's preliminary report and the 23 Oct notice

**Railway's preliminary report** ([blog.railway.com/p/preliminary-report-october-security-incident](https://blog.railway.com/p/preliminary-report-october-security-incident), 22 Oct) adds:

- **How:** the attacker escalated privileges through Railway's build infrastructure, then reached its CI credentials. The aim was AI provider keys "to perform distillation attacks".
- **When:**
  - The attack window opened at **13:58Z on 20 Oct**, a day before the disclosure.
  - Encrypted variables were queried, and a subset decrypted, between 07:25Z and 09:18Z on 21 Oct.
  - Railway confirmed the attacker had no remaining access at **03:32Z on 22 Oct**.
- **Scope:**
  - At most 1.85% of workspaces (about 100,000) had variables potentially compromised.
  - Railway can't tell which variables were decrypted, so it sent every stored key to the providers for revocation.
- **Railway's own resets:**
  - every Railway access token and user session;
  - every Railway GitHub App installation;
  - all storage-bucket credentials.

  Source-code access is not yet ruled out.

**The 23 Oct notice.** Railway emailed the workspace admin because its variable names matched the attacker's search pattern for AI and cloud keys; `OPENROUTER_FREE_TIER_KEY` is the likely match. Railway "cannot confirm whether or not your secret environment variables were decrypted". The notice is an update to the existing incident, not a new one.

**The new start time doesn't change the misuse finding.** The MongoDB check above covers every authenticated session from 14 Oct, so it already spans the real window.

**Railway's asks, against what was done:**

| Railway's ask | Status |
|---|---|
| Rotate sensitive variables | Done 23 Oct for harbour-cat and MongoDB-harbour. Harbour OS GitHub keys deleted and rotated. Dash is down, so rotate its variables before it returns. |
| Update variables and redeploy dependent services | Done; see "Verified after the deploy". |
| Remove public network access to databases | Done 22–23 Oct. |
| Review AI key usage | OpenRouter revoked the keys itself; usage showed nothing untoward. |
| Review other provider activity | Resend checked by John; nothing unusual. |
| GitHub audit logs and installed app access | Repository side checked 23 Oct (below). Still to do: the account-level checks below. |
| Registry logs (Docker Hub etc.) | Not applicable: no service pulls from a private registry. |
| Recreate CLI and CI credentials, reconnect GitHub | The laptop's `railway` CLI was logged out by Railway's reset, and no CI workflow in either repo uses a Railway token. "Deploy Latest Commit" succeeded on 23 Oct. |

**GitHub, repository-side check (23 Oct).** Covered both repos (`JKershaw/LinearViewer`, `JKershaw/simple-dispatcher`) and every branch, from 13:00Z on 20 Oct onwards.

- **Commits:** every commit is authored by John or Claude.
- **Pushes to `main`:** every one is a merge of John's own PR. The seven commits committed straight to LinearViewer's `main` on 21 Oct are the rebase-merges of #2029 and #2030; their commit times match those PRs' merge times.
- **Workflows and dependencies:** no change in the window to `.github/`, `.claude/`, `package.json` or `package-lock.json`.
- **Actions runs:** every run in simple-dispatcher was triggered by `JKershaw`. LinearViewer has had no `workflow_dispatch` runs since 13 Sep.
- **Collaborators:** LinearViewer has only `JKershaw`. simple-dispatcher also has `KulchoAI` with write access; confirm it is expected. It has no commits in the window.

**Not visible from the repos (John to check at github.com):**

- **The Harbour GitHub App.** A leaked private key can mint installation tokens for every account that installed the app, not just John's repos. Check the app's installations and its Advanced tab (recent deliveries) for 20–23 Oct.
- **The account security log** (Settings → Security log), for 20–23 Oct.
- **Installed GitHub Apps and OAuth apps** (Settings → Applications). The Railway app was reset by Railway.

## Lessons

- **Backups.** Harbour's database had no scheduled backups. Daily backups have been on since 23 Oct.
- **The app connected to MongoDB as root.** Give it its own `readWrite` user on `linear-viewer`: design and production steps are in `docs/runbooks/mongodb-app-user.md` (LIN-3772); the cutover is pending John's approval.
- **Public database endpoints widen exposure.** The operator's production route needed one, and an unused, empty MongoDB had been reachable since March. Both are now gone; the route is `railway ssh` (`docs/operator-execution.md`).
- **The 22 Sep incident record was wrong.** It credited a region move that had not taken effect; the database was still in a US region on 23 Oct. Verify an infrastructure change on the platform itself before crediting it with a fix. The record now carries a correction.
- **Rotation can depend on the platform's build pipeline.** It needed builds, which were paused for most tiers on 22 Oct. On 23 Oct it hit a Railway-side KMS error, which "Deploy Latest Commit" got around.
- **A `railway ssh` shell's environment is not the service's environment.** Do not inspect secrets with `railway variable list`: it prints raw values (`docs/runbooks/mongodb-app-user.md`).
- **There's no clean way to take Harbour offline on purpose.** → LIN-3770 (maintenance mode, switchable without a build).
- **The operator stalled overnight on a wrong guess.** It assumed a usage limit before reading the parked runs' reports. Read the last reports before guessing a cause.

## Related

- LIN-3769: triage
- LIN-3771: sign-in spam bot
- LIN-3770: maintenance mode
- LIN-3698: production MongoDB kernel drift
- `docs/incidents/2026-10-19-mongodb-kernel-ci.md`
- Railway status page, incident "Railway Platform Outage"
- Railway's disclosure: https://blog.railway.com/p/security-disclosure-wednesday-october-21st
- Railway's preliminary report (22 Oct): https://blog.railway.com/p/preliminary-report-october-security-incident
