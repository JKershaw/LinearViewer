# Incident: Railway security disclosure, and rotating every Harbour credential held in Railway

**Date:** 2026-10-21 to 2026-10-23
**Status:** Contained and rotated on 2026-10-23, at about 08:15Z. Email sign-in is switched off until LIN-3771 lands.
**Severity:** High potential, low actual. Every credential in Harbour's Railway variables was treated as exposed. No misuse of Harbour's credentials or database was found. harbour.cat stayed up, apart from a short database outage during the rotation.

## Summary

On 2026-10-21, Railway disclosed that an unauthorised third party "may have accessed encrypted environment variables and, for some of them, obtained the decrypted contents". Railway believed the aim was "compromising AI inference providers".

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
- **Out of scope** (John's decision): yap has no environment variables; Dash stays down; Harbour OS had its keys removed.

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

## Lessons

- **Backups.** Harbour's database had no scheduled backups. Daily backups have been on since 23 Oct.
- **The app connected to MongoDB as root.** Give it its own `readWrite` user on `linear-viewer` (follow-up ticket).
- **Public database endpoints widen exposure.** The operator's production route needed one, and an unused, empty MongoDB had been reachable since March. Both are now gone; the route is `railway ssh` (`docs/operator-execution.md`).
- **The 22 Sep incident record was wrong.** It credited a region move that had not taken effect; the database was still in a US region on 23 Oct. Verify an infrastructure change on the platform itself before crediting it with a fix. The record now carries a correction.
- **Rotation can depend on the platform's build pipeline.** It needed builds, which were paused for most tiers on 22 Oct. On 23 Oct it hit a Railway-side KMS error, which "Deploy Latest Commit" got around.
- **A `railway ssh` shell's environment is not the service's environment.** Read variables with `railway variables`.
- **There's no clean way to take Harbour offline on purpose.** → LIN-3770 (maintenance mode, switchable without a build).
- **The operator stalled overnight on a wrong guess.** It assumed a usage limit before reading the parked runs' reports. Read the last reports before guessing a cause.

## Related

- LIN-3769: triage
- LIN-3771: sign-in spam bot
- LIN-3770: maintenance mode
- LIN-3698: production MongoDB kernel drift
- `docs/incidents/2026-10-19-mongodb-kernel-ci.md`
- Railway status page, incident "Railway Platform Outage"; Railway's Preliminary Incident Report was due on 23 Oct
