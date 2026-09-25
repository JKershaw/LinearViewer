# Runbook — Harbour is degraded

For when harbour.cat's database-backed reads (dispatch list, rulings, `/kpis`, the live
and observation views) start hanging or timing out. Written after the 2026-09-22
incident (LIN-2993; incident record: `docs/incidents/2026-09-22-harbour-db-reads-hang.md`).
A workspace halt request exists (LIN-2994), but the runner does not yet honor it (pending
LIN-2995); there is still no deep-health endpoint (LIN-2999). Every step below marked
**[unbuilt]** is a placeholder until its ticket lands.

## First moves

1. **Stop your own polling first.** Whatever loop or script is watching Harbour, stop it
   before doing anything else (LIN-2993 description).
2. **Do not cascade-abort as a first move.** On 2026-09-22 a precautionary cascade abort
   queued 19 aborts for 2 running sessions; each aborted session was counted as errored,
   and the observation feed's resulting per-session Linear lookups added a burst of load
   on top of the feed request that was already hanging on the degraded Mongo link — an
   **amplifier, not the trigger**, of the 546–573 s holds (LIN-2994, LIN-2998; LIN-2993
   comments `ba819bcd`, `825a549b`). This contradicts the "harmless"/"safe no-op" wording
   still live in `docs/dispatch-integration.md:623`, `docs/dispatch-integration.md:624`
   and `lib/proxy-instructions.js:763` — that correction belongs to **LIN-2998** and is
   not made here; treat a cascade abort as **not safe** while Harbour is degraded,
   whatever those three say.
3. **Request a workspace halt (LIN-2994); the runner doesn't act on it yet (LIN-2995).**
   `POST /api/proxy/dispatch/halt` with body `{"mode":"pause"}` (or `"stop"`) records a
   halt **request** that the next poll carries. It needs a read-write proxy token —
   **mint one before an incident**, not during it (see *Halt caveats* below). The runner
   does not yet honor the request (pending LIN-2995). The only way to stop the runner
   right now is **on the host** (stop or kill the dispatcher process directly).
   `DELETE /api/proxy/dispatch/halt` **clears the request**; clearing it does not by
   itself change what a running session does. Runner-local halt stays
   **[unbuilt: LIN-2995]**. Mechanism: `routes/proxy-halt.js:44` (GET), `:75` (POST),
   `:108` (DELETE). Full contract:
   [Operator Halt](../proxy-integration.md#operator-halt-lin-2994-decision-4).

## Halt caveats

1. **Decision 2 residuals:**
   - A cold cache or a freshly restarted process, plus a failed halt read: the halt is
     silently omitted from the poll (`routes/dispatch.js:80-88`,
     `lib/workspace-halt.js:110-111`).
   - The cache is per-process (`lib/workspace-halt.js:43-53`), so two containers
     overlapping during a deploy can briefly disagree.
   - `Promise.race` bounds the wait at 1.5 s but does not cancel the query
     (`routes/dispatch.js:53,55-66`; LIN-2997), so a poll can wait up to 1.5 s.
   - Concurrent writes: the cache keeps whichever write finished last, not what the
     database committed last. After simultaneous writes, re-read with `GET` and
     re-issue if needed.
2. **Full-outage limit:** the poll's token check (`routes/dispatch.js:207`) and item
   read (`routes/dispatch.js:1429`) have no time limit. A database outage fails the
   poll with a 500, and the runner gets no `halt`. The proxy verb needs the database
   too: a token check (`routes/proxy.js:527`) plus the write. A halt does not get
   through a full outage — the cache covers only the halt read.
3. **Decision 4:** under degradation, use the proxy verb, not the dashboard, with the
   token minted in advance.
4. **`stop` amplifier:** once LIN-2995 lands, `stop` flows abort → error
   (`routes/dashboard.js:89`) → Linear hydration. That path is bounded by
   `FEED_HYDRATION_CAP = 5` (`routes/dashboard.js:123`) and by the number of running
   sessions. It is owned by **LIN-2998**: referenced here, not fixed.
5. **No server-side enforcement:** `POST /api/dispatch/take` does not check the halt
   (`routes/dispatch.js:1547`).
6. **Deliberate Harbour OS exclusion:** `target:'local'` is never polled
   (`routes/dispatch.js:625-676`), so a halt never reaches it. See the `local` row in
   [the poll contract](../dispatch-integration.md#target-routing).

## Dispatch a read-only host investigator

A dispatch with no `repo` runs in the workspace's default folder
(`docs/dispatch-integration.md:964`). Railway access comes from **the host's own linked
Railway CLI** — the agent environment carries no `RAILWAY_TOKEN` or Railway API access
(LIN-1756). Run `railway` from a directory linked to the Harbour project (on 2026-09-22,
the host's `LinearViewer` checkout) — an unlinked directory won't resolve the service.
**This read-only limit is enforced only by the dispatch prompt, not mechanically** —
there is no code-level guard preventing a write command.

**Allowed (read-only):**
- `railway deployment list`
- `railway logs`, `railway logs --http`, `railway logs -s <service>`
- `railway metrics --raw`
- Read-only `mongosh` via `railway run`, on the public proxy URL (LIN-2993 comment
  `8b2bcfa4`), with the query written to a quoted-heredoc script file and run with
  `--file`, not `--eval`:

  ```sh
  cat > "${TMPDIR:-/tmp}/ro.js" <<'EOF'
  printjson(db.currentOp({active:true, secs_running:{$gt:5}}))
  EOF
  railway run -s MongoDB-harbour -- sh -c 'mongosh "$MONGO_PUBLIC_URL" --quiet --file "$0"' "${TMPDIR:-/tmp}/ro.js"
  ```

  Write the script under `${TMPDIR:-/tmp}`, not the linked checkout from the previous
  section — that checkout is a repo working tree the investigator is told not to edit,
  and a bare `cat > ro.js` would leave an untracked file in it (LIN-3001 runtime witness
  `73dd0ead`).

  Both parts of this form matter: `sh -c` lets `$MONGO_PUBLIC_URL` expand inside
  `railway run`'s child environment rather than the operator's own (unset) shell, and the
  quoted heredoc (`<<'EOF'`) keeps the query's own `$` operators — `$gt`, `$gte` — out of
  any shell's expansion, since they'd otherwise be stripped the same way `--eval "…"`
  would strip them. This is the form the investigator's session actually ran (LIN-3001
  reviews `a531d11f` and `f2d755d1`; investigator session `46c06407`).

  Restricted to: `db.currentOp({active:true, secs_running:{$gt:5}})`,
  `db.serverStatus()` (connections, globalLock, WiredTiger cache, opcounters), and
  `db.getSiblingDB('linear-viewer').stats()`. `MONGO_PUBLIC_URL` carries no database
  path, so mongosh lands on its default `test` database; `currentOp` and
  `serverStatus()` cover the whole server regardless, but a database-scoped read like
  `db.stats()` must select `linear-viewer` explicitly or it silently reports on the
  empty `test` database instead of erroring (LIN-3001 runtime witness `73dd0ead`). Never
  print the connection string — pass it through the environment.
- A read-only `find`/`explain("executionStats")` on the slow view's own query, to compare
  server execution time against payload bytes — this is what actually discriminated the
  2026-09-22 incident: the feed's history read (`dispatch-history`, filtered by `urlKey`
  and a 30-day `dispatchedAt` window, `prompt` excluded) executed in 29 ms on the server
  but returned a 32 MB payload (LIN-2993 comment `8b2bcfa4`). Its `dispatchedAt` filter
  also uses a `$` operator (`$gte`), so write it into a script file the same way — the
  quoted-heredoc `--file` form above, not `--eval`. **Select the database explicitly:**
  as with `db.stats()` above, `MONGO_PUBLIC_URL` lands on mongosh's default `test`
  database, where `dispatch-history` doesn't exist — the query still runs and returns
  0 documents instead of erroring, which reads as a healthy empty result rather than a
  wrong-database mistake. Scope the collection with
  `db.getSiblingDB('linear-viewer').getCollection('dispatch-history')…` (LIN-3001
  runtime witness `73dd0ead`). **Caveat:** pulling the payload itself adds load over an
  already-degraded link, so prefer `explain` over fetching the full result where the
  discrimination doesn't require it.

  **This `mongosh`-via-`railway run` allowance is a deliberate, bounded relaxation.**
  The original investigator dispatch (`10022ce7`) forbade `railway run` against
  production outright. The con's own follow-up (`3fc09da4`, citing `1df2ffb0`) asked for
  the `currentOp`/`serverStatus`/`db.stats()` reads above, and the investigator ran them
  successfully — no writes, no `killOp`, no index builds (LIN-2993 comments `1df2ffb0`,
  `243ce77e`, `8b2bcfa4`). The investigator's own history-read `find` went one step
  further than that request, and is included here because it's the read that actually
  discriminated the cause. The relaxation is bounded to these specific reads; it does not
  extend to any other `railway run` use.

**Forbidden:** restart, redeploy, rollback, scale, variable changes, `railway variables`
output, DB writes, index builds, `railway up`, any other `railway run` invocation,
printing secrets or connection strings, opening PRs or making edits. Minimise probes
against harbour.cat itself. End with a **Findings** comment on the incident ticket.

**Getting a second pass:** a dispatch with `followUpTo` set to the investigator's own
dispatch id resumes that same session with a new instruction, delivered via the Stop
hook at the session's next stop — this is how the 2026-09-22 investigator got the
`mongosh` follow-up mid-incident.

## Logs and metrics

- `railway logs` (app) and `railway logs --http` (per-request timing).
- `railway logs -s MongoDB-harbour` for the database's own logs.
- `railway metrics --raw` for both services, per-minute CPU/memory/requests.
- **Caveat:** Railway drops log lines above 500/s, which can destroy the exact evidence
  an incident needs (LIN-2232).
- **Caveat:** Railway serves no HTTP logs for a deploy that has since been removed, so
  per-route behaviour from before the incident's onset is not recoverable (LIN-2993
  comment `ba819bcd`, "What I couldn't establish").

## Reading Railway's graphs

| What you see | What it actually means |
|---|---|
| A deploy marker on the graph | The container's **creation** time, not go-live — the container typically serves ~8 minutes later. Use `railway deployment list` / `railway logs <id>` for real start/stop times (LIN-2993 comment `7905184c`) |
| A step up in the memory graph | Can be two containers **overlapping during a deploy handover**, not a leak — the graph sums both (LIN-2993 comment `1fbe8f73`) |
| p99 latency capped at ~30 s | Railway's own edge cap, not the true hold time — real holds reached 595 s on 2026-09-22. Use `railway logs --http` for actual request duration (`1fbe8f73`) |
| Requests graph drops to ~0 | Can be a partial final bucket, not a real collapse — check per-minute `railway metrics --raw` before calling it a drop (`1fbe8f73`) |
| Dashboard DB-stats view hangs or errors (`SSH command failed`) | **This is Railway's own SSH path to the container, not a mongod-health signal.** It says nothing about the database (LIN-2993 comment `8b2bcfa4`; also noted in LIN-3000's description as a verification caveat) |
| `/health` returns 200 | Confirms only that the process is up, not that its dependencies (Mongo, Linear) are healthy — deep health is **[unbuilt: LIN-2999]** |

## Restart vs rollback

Quoted as written, from the incident's authoritative remedy (LIN-2993 comment
`9e91955a`):

> **Now:** no rollback. A restart isn't needed while things hold. Restarting won't fix a
> slow link anyway; it only drops hung requests (low risk, a ~30 s blip). If the hangs
> come back, check Railway's private-network and region status before anything else.

That remedy doesn't state a general rollback rule. **The following is this runbook's own
inference**, not a direct quote, drawn from `9e91955a`'s Evidence 1 (the failures began
on the *previous* container; `a5f4383`'s go-live at 19:25:38Z came *after* the ~19:15Z
onset, which is why it was ruled out) and LIN-2993 comment `7905184c` (deploy markers lag
go-live by ~8 minutes): a deploy whose actual go-live time comes *after* onset is ruled
out as the cause, the way `a5f4383` was. Only a deploy whose go-live *precedes* onset is
a rollback candidate — restart the current service rather than rolling back, unless you
can show the current deploy's go-live precedes onset. Check go-live via `railway
deployment list`/`railway logs <id>`, not the graph marker.

**Both restart and rollback are John's call** (LIN-2993 description: "Restart, redeploy,
rollback, variable changes and database writes are John's call. The agent recommends; it
doesn't act on production.").

**No rollback runbook exists yet** (LIN-372, closed on a manual statement with no
in-system artefact) — there is no documented rollback procedure to follow here.

## Links

Health and halt mechanisms this runbook wants to point to:

- **Workspace halt (shipped, LIN-2994)** — a pause/stop *request*, which the runner does
  not yet honor (pending LIN-2995). See
  [Operator Halt](../proxy-integration.md#operator-halt-lin-2994-decision-4) and *Halt
  caveats* above.
- **[unbuilt: LIN-2995]** — runner-local halt / auto-pause, independent of Harbour.
- **[unbuilt: LIN-2999]** — deep health read + early warning.
- **[unbuilt: LIN-1756]** — Railway deploy settings (healthcheck path, draining,
  overlap) not yet applied.
- **LIN-2998** — owns correcting the "harmless"/"safe no-op" cascade wording named
  under *First moves* above; not corrected by this runbook.
- **LIN-372** — no rollback runbook exists; see *Restart vs rollback* above.
