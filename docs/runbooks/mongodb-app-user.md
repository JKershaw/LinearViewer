# MongoDB app user: harbour-cat's own least-privileged login (LIN-3772)

> **Status: planned, not done.** As of this note, harbour-cat still connects to MongoDB-harbour as
> the `mongo` root user. Nothing below has run in production. The cutover (create the user, set the
> variables, switch harbour-cat, deploy, verify) is John's decision and is **not part of closing
> LIN-3772's PR**. Each production step needs John's approval, one ticket step each.

## Why

The Railway security incident (`docs/incidents/2026-10-22-railway-security-disclosure.md`) found that
harbour-cat's `MONGODB_URI` is a reference to `${{MongoDB-harbour.MONGO_URL}}`, which is the root
credential. A leaked app credential is therefore root on the database server. The app needs
nothing like that.

## Design

**Role.** One user, `harbour-cat-YYYYMM`, created in database `linear-viewer`, with roles
`[{ role: 'readWrite', db: 'linear-viewer' }]` and nothing else.

**`dbAdmin` is not needed.** `createIndex` (including TTL, unique, sparse and partial options) is an
action of `readWrite`, so the boot-time `ensureIndexes` in `lib/db-indexes.js` works as is. TTL
deletion runs as a server-internal thread, not as the user who created the index. `dbAdmin` would
only add `collMod` (changing an existing index's options), `planCache*` and `$indexStats`, and no
runtime code issues any of them. Changing an existing index's options is an **operator/root action
only**; do not design the app around `dbAdmin` or `collMod`.

This was measured, not only inferred: the real `server.js`, `NODE_ENV=production`, against a local
`mongod --auth` as a `readWrite@linear-viewer`-only user. All 70 `INDEX_SPECS` applied with 0
failures (on an empty database, and as no-ops on an existing one), the TTL index built and deleted
expired rows, all scheduler jobs registered, `/health` returned 200, and the same user was refused on
`admin`, `config`, `local` and any other database, and refused `createUser`, `grantRolesToUser`,
`serverStatus`, `collMod` and `planCacheClear`.

**What stays on root (operator only).** `currentOp` / `serverStatus` reads
(`docs/runbooks/harbour-degraded.md`), `planCacheClear` in
`scripts/explain-paged-lists-lin3163.js` (best-effort, wrapped in `try/catch`), and the roughly 22
operator scripts that take an explicit URI. The runtime has exactly one `MONGODB_URI` consumer
(`server.js`, `MONGODB_URI` into `db('linear-viewer')`), and it does not change. **No runtime code
change.**

**The root credential** stays, for operator use only. harbour-cat stops holding it. Railway's
Regenerate still covers only root, and once harbour-cat no longer holds root, using it no longer
takes harbour-cat down.

### Variable layout on MongoDB-harbour

| Variable | Value |
|---|---|
| `HARBOUR_CAT_MONGO_USER` | the dated user name, e.g. `harbour-cat-202610` |
| `HARBOUR_CAT_MONGO_PASSWORD` | 64 hex characters (`openssl rand -hex 32`) |
| `HARBOUR_CAT_MONGO_URL` | `mongodb://${{HARBOUR_CAT_MONGO_USER}}:${{HARBOUR_CAT_MONGO_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:27017/linear-viewer?authSource=linear-viewer` |

On harbour-cat: `MONGODB_URI=${{MongoDB-harbour.HARBOUR_CAT_MONGO_URL}}` (today:
`${{MongoDB-harbour.MONGO_URL}}`). The password lives on MongoDB-harbour so rotation is still one
place. The connection goes over the private domain; no public endpoint exists or is needed.

## Rules for every production step

- **Never print a secret.** `railway variable list` in any form (plain, `-k/--kv`, `--json`) prints
  raw values (railway 5.23.3 help), so **no step in this runbook lists variables**. Do not echo,
  `cat` or `env` a secret either, and never end a `--eval` in the password. If a later edit adds a
  variable check, it must mask **inside the JSON filter** and compute its pass condition there as a
  boolean (never `sed`/`awk`/`cut` after `jq -r`, which splits a value with an embedded newline and
  prints the password; never a mask-only check whose pass condition is read by eye).
- Set the password with `railway variable set KEY --stdin` (CLI 5.23.3), which keeps it out of argv
  and shell history. It lives in a `chmod 600` file on the operator host (macOS, so no `/dev/shm`
  there), as with `lin3014_read`. Delete the file after step 2.
- **At no point may a service's stored variables differ from its running deployment without a deploy
  being approved.** Every `variable set` below either names a variable nothing references yet, or is
  itself the approved deploy.
- **`railway ssh` is restricted to the command a step names.** No other remote commands; temp files
  only under `/dev/shm` in the container, deleted afterwards. A `railway ssh` session's environment
  is not the service's environment (Railway adds its own tokens); see `docs/operator-execution.md`.
- `passwordPrompt()` needs a TTY, so steps 1 and 1b use an interactive
  `railway ssh -p fc7abe0d-2c3b-403d-88a3-d61c470729a7 -e production -s MongoDB-harbour` session.
  Whether the one-shot `railway ssh -- '<cmd>'` form allocates a pty has not been checked, so this
  note does not use it for those steps.

## Production steps (for John to run or approve; none has run)

Project `fc7abe0d-2c3b-403d-88a3-d61c470729a7`, environment `production`. There is **no step 4**:
the numbering is kept so cross-references hold (steps 3 and 4 of the earlier draft are one deploy).

**0. Read-only pre-check (John approves).** Bounds what step 1 and the step 2 outage can touch.

```sh
railway ssh -p fc7abe0d-2c3b-403d-88a3-d61c470729a7 -e production -s MongoDB-harbour -- \
  'mongosh --quiet "mongodb://$MONGOUSER:$MONGOPASSWORD@localhost:27017/?authSource=admin" --eval "printjson(db.getSiblingDB(\"admin\").runCommand({usersInfo:{forAllDBs:true}}).users.map(u=>({user:u.user,db:u.db,roles:u.roles})))"'
```

Expected today: `mongo` (root), possibly `lin3014_read`. Also list which services reference
MongoDB-harbour variables (the Railway dashboard, not `railway variable list`). Every one of them
loses its database for the length of the step 2 quiet window, so size the window from this result.

**1. Create the password file and the user (John approves).** On the operator host:

```sh
umask 077
mkdir -p ~/.harbour/secrets
printf %s "$(openssl rand -hex 32)" > ~/.harbour/secrets/harbour-cat.pass
```

Then, in an interactive `railway ssh ... -s MongoDB-harbour` session as root (mongosh against
localhost: `mongosh --quiet "mongodb://$MONGOUSER:$MONGOPASSWORD@localhost:27017/?authSource=admin"`),
run the following. At the `passwordPrompt()`, paste the password from `pbcopy < ~/.harbour/secrets/harbour-cat.pass`
(run on the operator host); never `cat` the file.

```js
db.getSiblingDB('linear-viewer').createUser({
  user: 'harbour-cat-YYYYMM',
  pwd: passwordPrompt(),
  roles: [{ role: 'readWrite', db: 'linear-viewer' }]
})
```

**1b. Spot check as the new user, before anything points at it (John approves).** In an interactive
`railway ssh ... -s MongoDB-harbour` session, open mongosh **as the new user, not root** (no
password in the command line; mongosh prompts for it on the TTY, so paste it as in step 1):

```sh
mongosh --quiet "mongodb://localhost:27017/linear-viewer?authSource=linear-viewer" -u harbour-cat-YYYYMM
```

```js
db.runCommand({ connectionStatus: 1 }).authInfo.authenticatedUserRoles
db.getSiblingDB('admin').getCollectionNames()          // must be refused
db.getSiblingDB('test').getCollectionNames()           // must be refused
```

`authenticatedUserRoles` must be exactly `[{ role: 'readWrite', db: 'linear-viewer' }]`. This proves
the credential, and its least privilege, with no blast radius. It is the check that stands in for a
pre-deploy value check on harbour-cat, which this runbook does not have (see Residual risk).

**2. Set the three variables on MongoDB-harbour, as a variable-change deploy, in a quiet window
(John approves).** Nothing references the three new names yet (harbour-cat's `MONGODB_URI` still
points at `MONGO_URL`), so the stored-but-undeployed gap is harmless.

```sh
# a. the password, from the file, never argv; staged only
railway variable set -s MongoDB-harbour HARBOUR_CAT_MONGO_PASSWORD --stdin --skip-deploys \
  < ~/.harbour/secrets/harbour-cat.pass

# b. user and URL in ONE call, WITHOUT --skip-deploys: this call is the MongoDB-harbour deploy
railway variable set -s MongoDB-harbour \
  'HARBOUR_CAT_MONGO_USER=harbour-cat-YYYYMM' \
  'HARBOUR_CAT_MONGO_URL=mongodb://${{HARBOUR_CAT_MONGO_USER}}:${{HARBOUR_CAT_MONGO_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:27017/linear-viewer?authSource=linear-viewer'
```

Single quotes keep the shell off `${{`. Do **not** use `railway redeploy -s MongoDB-harbour` for this:
its help says it redeploys "the latest deployment", and forum answers (unverified, not official
documentation) say a redeploy reuses the original configuration snapshot and does not pick up staged
changes. The deploy that carries the new variables must be the variable-change deploy in (b). When it
is a deploy, `mongod` restarts: a short database outage for every service step 0 listed, hence the
quiet window.

Delete the local password file once (b) has succeeded: `rm -P ~/.harbour/secrets/harbour-cat.pass`
(on macOS; `rm -P` overwrites first).

Then check recovery: `/kpis` returns 200 once `mongod` is back. A harbour-cat deploy that **boots**
during the outage does not reconnect on its own: `server.js` runs `await dbClient.connect()`
unguarded, before the `unhandledRejection` backstop, so the process exits after server selection
times out, and recovery depends on Railway's default restart policy (not configured in the repo,
`[unbuilt: LIN-1756]`). If harbour-cat crash-looped, run `railway redeploy -s harbour-cat`. (A harbour-cat
instance that was already running reconnects by itself.)

**3. Point harbour-cat at it, which is the deploy (John approves).** The rollback is in hand first.

```sh
railway variable set -s harbour-cat 'MONGODB_URI=${{MongoDB-harbour.HARBOUR_CAT_MONGO_URL}}'
```

Single-quoted, and **without** `--skip-deploys`: this one command stores the value and deploys
harbour-cat, so there is no window between "stored" and "approved".

**Rollback** (kept directly under step 3; it also deploys at once):

```sh
railway variable set -s harbour-cat 'MONGODB_URI=${{MongoDB-harbour.MONGO_URL}}'
```

**5. Verify.** "The app is up" is not enough: `ensureIndexes` turns every failed build into a
`[db-indexes] skipped` warning (`ensureIndexes` in `lib/db-indexes.js`), so boot succeeds even when
indexes fail.

- a. The deploy log, for at least an hour, has **zero** `[db-indexes] skipped` lines and no
  `Unauthorized`.
- b. `mongod`'s `Successfully authenticated` log line shows the **new user**. (`$currentOp` does not
  show the users of idle pooled connections, so it cannot serve as this check.) This is the check
  that matters most: if `MONGODB_URI` rendered **empty**, `server.js:279-281` does not fail, it
  boots on file storage inside the container. `/kpis` returns 200, there is no `[db-indexes]
  skipped` line, and user writes go to an ephemeral disk. Only this line catches it.
- c. `/kpis` returns 200, and the spot check from 1b passes again as the new user (a re-check).
- d. Same hour: zero `[scheduler] job "…" … failed` lines (`lib/scheduler.js`: tick, acquire, run).
  Every job's lock acquire writes `scheduler-locks`, so an auth fault shows up there.

**If any of (a) to (d) fails: run the rollback first, diagnose afterwards.**

**Residual risk, named and accepted.** Step 3 has no pre-deploy value check. A typo in the
`HARBOUR_CAT_MONGO_URL` template would fail step 3's deploy at `await dbClient.connect()`
(`server.js:283`, unguarded), with no healthcheck to hold the old deployment
(`harbour-degraded.md`, `[unbuilt: LIN-1756]`); a reference that **renders empty** fails silently
onto file storage (5b). Either way the outage lasts until the rollback runs, so roll back first.
Mitigations: the template is copied from this note, not typed; it parses offline with the repo's
`mongodb` driver on fake values (user, `authSource`, database and host as intended; note this check
accepts an empty *password*, and does not cover an empty render); 1b has proven the user; step 5 and
the one-command rollback bound the rest.

## Rotation

Railway's Regenerate covers the root user only. **Do not change the app user's password in place.**
Measured: connections already pooled keep working, but every new connection fails until harbour-cat
redeploys. Rotate with a **new dated user** instead:

1. Create `harbour-cat-<next YYYYMM>` with a new password file (step 1).
2. Spot-check it as in 1b, before any variable names it.
3. Update the variables on MongoDB-harbour as in step 2: PASSWORD with `--stdin --skip-deploys`, then
   USER and URL in one call without `--skip-deploys`, so the variables never name a user that does
   not exist yet.
4. `railway redeploy -s harbour-cat`, so harbour-cat picks up the new credential.
5. Verify as in step 5.
6. Only then `dropUser` the old one.

**Exception to the rule above.** Unlike the first cutover, these `variable set` calls change
`HARBOUR_CAT_MONGO_USER` / `_PASSWORD`, which harbour-cat already references through
`HARBOUR_CAT_MONGO_URL`. That is safe because both users exist throughout, so either pairing of old
or new credentials that a deploy could pick up is a working one, except in one window: between the
separate PASSWORD set and the USER/URL set (seconds). A harbour-cat deploy landing inside it would
pair the new password with the old user, or the reverse. Keep it short by running the USER/URL call
immediately after the PASSWORD call.

Cost: one short MongoDB-harbour outage per rotation (the step 2 deploy), accepted. The variables stay
in one place.

## Open questions

- John must approve and run the cutover; this PR cannot close it out.
- Whether a `--skip-deploys` variable set resolves for a referencing service without redeploying
  MongoDB-harbour. Left open: nothing above depends on it, and it is why a rotation could not skip
  the MongoDB-harbour deploy. Not established, so nothing here claims it "resolves by construction".
- Whether sealing `HARBOUR_CAT_MONGO_PASSWORD` is safe.
- `lin3014_read` may still exist in production. Drop it (and delete
  `~/.harbour/secrets/lin3014_read.*`) or rotate it: undecided. Its only route, the public proxy, is gone.
- No auth-enabled CI `mongod` runs a `readWrite`-only `ensureIndexes` witness
  (`.github/workflows/test.yml`'s `mongodb` service has no auth). A regression guard worth building,
  not this ticket's cause.
