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

- **Never print a secret.** `railway variable list` (in any form) prints raw values, so **do not use
  it to inspect secrets in this runbook**. Do not echo, `cat` or `env` them either.
- If you must mask output, mask **inside** the `jq` filter and fail closed. Do not mask line by line
  after `jq -r`.
- Set secrets with `railway variable set KEY --stdin` (CLI 5.23.3), which keeps the value out of argv
  and shell history. Generate the password into a `chmod 600` file under `/dev/shm`, as with
  `lin3014_read`, and delete it afterwards.
- **Do not leave stored variables that differ from the running deployment without an approved
  deploy.** That is why step 3 below is the approved deploy and carries no `--skip-deploys`.
- **`railway ssh` is restricted to the single quoted command a step names.** No interactive shell
  except step 1, no other remote commands, temp files only under `/dev/shm`, deleted afterwards.
  A `railway ssh` session's environment is not the service's environment (Railway adds its own
  tokens); see `docs/operator-execution.md`.
- `passwordPrompt()` needs a TTY. Steps 1 and 5c use an interactive `railway ssh -s MongoDB-harbour`
  session for that reason.

## Production steps (for John to run or approve; none has run)

Project `fc7abe0d-2c3b-403d-88a3-d61c470729a7`, environment `production`.

**0. Read-only pre-check.** List existing users with `usersInfo` using `forAllDBs: true` (one quoted
`railway ssh` command, root, localhost, per `docs/operator-execution.md`), and check which services
reference MongoDB-harbour variables. Expected today: `mongo` (root), possibly `lin3014_read`.

**1. Create the user** through `railway ssh -s MongoDB-harbour` as root, in `linear-viewer`:

```js
db.getSiblingDB('linear-viewer').createUser({
  user: 'harbour-cat-YYYYMM',
  pwd: passwordPrompt(),
  roles: [{ role: 'readWrite', db: 'linear-viewer' }]
})
```

**2. Set the variables** on MongoDB-harbour with `railway variable set <KEY> --stdin --skip-deploys`
(user, password, URL; the URL value is the template in the table above). `--skip-deploys` here avoids
restarting MongoDB. Open question: whether a `--skip-deploys` variable set resolves for a
referencing service without redeploying MongoDB-harbour is **not yet established**; treat the result
of step 3 as the test. Open question: whether sealing the password variable is safe is also
unresolved; do not seal it until that is answered.

**3. Point harbour-cat at it** and deploy: set harbour-cat's `MONGODB_URI` to
`${{MongoDB-harbour.HARBOUR_CAT_MONGO_URL}}` **without** `--skip-deploys`, so this step is the
approved deploy and stored variables never differ from what is running.

**4. Deploy** (if step 3 did not already trigger it) and watch the boot.

**5. Verify.** "The app is up" is not enough: `ensureIndexes` turns every failed build into a
`[db-indexes] skipped` warning (`lib/db-indexes.js`), so boot succeeds even when indexes fail.

- a. The deploy log, for at least an hour, has **zero** `[db-indexes] skipped` lines and no
  `Unauthorized`.
- b. `mongod`'s `Successfully authenticated` log lines show the new user. (`$currentOp` does not show
  the users of idle pooled connections, so it cannot serve as this check.)
- c. `/kpis` returns 200, and a spot check as the new user (interactive session, `passwordPrompt()`):
  `db.runCommand({ connectionStatus: 1 })` reports exactly `readWrite@linear-viewer`, and reads on
  `admin` and on any other database are refused.

**Rollback.** Point `MONGODB_URI` back at `${{MongoDB-harbour.MONGO_URL}}` and redeploy.

## Rotation

Railway's Regenerate covers the root user only. **Do not change the app user's password in place.**
Measured: connections already pooled keep working, but every new connection fails until harbour-cat
redeploys. Rotate with a **new dated user** instead:

1. Create `harbour-cat-<next YYYYMM>` (step 1).
2. Update `HARBOUR_CAT_MONGO_USER` and `HARBOUR_CAT_MONGO_PASSWORD` (step 2). The URL variable
   follows because it references them.
3. Redeploy harbour-cat and verify (steps 3 to 5).
4. Only then drop the old user.

There is no outage and the variables stay in one place.

## Open questions

- John must approve and run the cutover; this PR cannot close it out.
- Whether a `--skip-deploys` variable set resolves for a referencing service without redeploying
  MongoDB-harbour (step 2).
- Whether sealing `HARBOUR_CAT_MONGO_PASSWORD` is safe.
- `lin3014_read` may still exist in production. Drop it or rotate it: undecided.
- Railway's behaviour for redeploy versus staged variable changes is not fully sourced here; this note
  claims only what was measured or is stated above. One risk, not confirmed from source: a fresh
  harbour-cat boot during a MongoDB-harbour quiet window could crash-loop and need a redeploy.
