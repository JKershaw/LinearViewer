# Incident — harbour.cat database-backed reads hang on a degraded cross-region link

**Date:** 2026-09-22
**Duration:** onset ~19:15Z, recovering by ~19:47–19:52Z, structurally resolved ~20:35Z
after MongoDB-harbour moved to the app's own EU region (LIN-3000 comment `4a531223`)
**Severity:** Degraded — database-backed reads (proxy dispatch list, rulings, `/kpis`,
the live and observation views) hung 27–595 s. Static pages, small-document reads
(poll/take/feedback) and CPU on both sides were unaffected. No data loss.
**Status:** Resolved (LIN-2993 comments `cfc1d6bd`, `1bff86f8`). Root cause mechanism at
**medium-high** confidence; why the link degraded is **low-medium**, not established.

> **All times UTC.** Clock provenance is called out per row below: Railway's dashboard
> screenshots were read in GMT+1, and deploy markers on Railway's graphs are *creation*
> times, not go-live times (LIN-2993 comment `7905184c`) — misreading either one points
> suspicion at the wrong deploy.

---

## What happened

From ~19:15Z, proxy reads that hit MongoDB-harbour (dispatch list, rulings, `/kpis`,
live-console and observation feeds) began hanging for tens of seconds to minutes, while
static pages and small-document reads (poll/take/feedback) kept working normally
(LIN-2993 description). The investigation's own first hypothesis — that harbour-cat was
waiting on outbound Linear calls with no timeout — turned out to be wrong; the
discriminating evidence was a read-only `mongosh` check showing a feed read completed in
29 ms on the server but returned a 32 MB payload (LIN-2993 comment `8b2bcfa4`). The
revised, authoritative finding is that large reads (up to 32–64 MB per cache fill) were
crossing a degraded EU West ↔ US East network link between the app and its database
(LIN-2993 comment `9e91955a`).

## Timeline (UTC)

| Time (UTC) | Clock | Event |
|---|---|---|
| ~19:00–19:23 | system (`railway logs`) | Old container `85891c1c` serving; two later deploys (#1546 LIN-2975, #1543 LIN-2981) later ruled out as cause — neither adds a query (LIN-2993 comment `7905184c`) |
| **~19:15–19:20** | session feedback | **First failures** seen by the con's own watch (LIN-2993 description) |
| 19:23:00–19:25:45 | system | `#1546` container `2e03587f` serving. Railway's graph showed its deploy *created* at 20:14 GMT+1 — read at the time as go-live, ~8 min too early (`7905184c`) |
| 19:23:09 | system | Memory graph peaks at 1.28 GB — two containers (`85891c1c`→`2e03587f` handover) overlapping, not a leak (LIN-2993 comment `1fbe8f73`) |
| 19:25:38 | system | `#1547` (`a5f4383`) container `68d764ab` goes live and serves cleanly for the rest of the incident (`7905184c`) |
| ~19:30 | operator instruction | LIN-2974 autopilot tree **cascade-aborted** on John's instruction as a precaution; the con's own polling stopped at the same time (LIN-2993 description) |
| 19:33:34 | system (`railway logs -s MongoDB-harbour`) | Only slow query in the whole window: a 262 ms full scan. Mongo itself stayed healthy throughout (LIN-2993 comment `8d05d859`) |
| 19:35–19:37 | session feedback | The cascade abort's batch of newly-errored sessions is picked up by the observation feed's per-session Linear error lookups (LIN-2993 comment `1fbe8f73`; LIN-2994) |
| ~19:40:51 | system | Two observation `sessions` requests, held 546–573 s, released together right after a Linear `AbortError timedOut` (LIN-2993 comment `825a549b`) |
| 19:41–19:47 | system | Recovering — proxy calls down to 0.3–1.8 s (`825a549b`) |
| ~19:42 | dispatch record | Read-only host investigator dispatched with no `repo` (dispatch `10022ce7`); a concurrent `repo=LinearViewer` dispatch was refused `422 UNKNOWN_REPO`, `knownRepos: []` (LIN-2993 comment `9459e3d2`) |
| 19:42:53 | session feedback | Con's follow-up (`3fc09da4`) requests read-only `mongosh` via `railway run`, relaxing the investigator's original "no `railway run`" limit (LIN-2993 comment `1df2ffb0`) |
| 19:51:24 | session feedback | **Discriminating test:** `mongosh` shows Mongo healthy (no long ops, no queued locks); the feed's history read executes in 29 ms on the server but returns a 32 MB payload (LIN-2993 comment `8b2bcfa4`) |
| 19:51:54 | session feedback | Authoritative root cause posted (LIN-2993 comment `9e91955a`), superseding the earlier, wrong-lead findings (`ba819bcd`) |
| 19:52–~20:04 | probe | A 12-minute probe's worst read is 2 s (LIN-2993 comment `cfc1d6bd`) |
| 20:07:58 | session feedback | Incident **effectively resolved**; follow-ups filed (`cfc1d6bd`) |
| ~20:35 | verification (LIN-3000 comment `4a531223`) | MongoDB-harbour moved to the EU region and verified: dispatch list 1.2–1.5 s, rulings 0.7–1.0 s, `/kpis` 0.24–0.32 s |

## Root cause

Quoted as written, at its stated confidence (LIN-2993 comment `9e91955a`, which
**supersedes** the earlier `ba819bcd`):

> **Most likely:** the network link between the harbour-cat app (EU West) and
> MongoDB-harbour (US East) slowed sharply. Every cold fill of the live, observation,
> rulings and KPI views copies the whole 30-day `linearviewer` dispatch history, **32 MB**
> (64 MB with prompts), across that link. The link slowed down and those big reads went
> from ~1.6 s to 5–10 minutes. Confidence: **medium-high** that big transfers over a
> degraded link are the mechanism.
>
> **Why the link degraded** is unconfirmed (**low-medium**). The best clue: Harbour's
> outbound connections to Linear were being reset over the same period, which points to
> a network problem on Railway's side. Neither side's CPU explains it.
>
> **Ruled out (high confidence):** `a5f4383`/#1546/#1543, a slow or locked MongoDB, a
> full disk, a memory leak or OOM, and an unbounded Linear wait.

## The wrong lead

The investigation's first hypothesis was that the stalled routes awaited an outbound
Linear call with no timeout (LIN-2993 comment `e18708f8`) — plausible, since Linear had
been intermittently timing out and returning 503s since ~18:09Z (LIN-2993 comments
`2f86843b`, `9bdf9f90`). It was disproved directly: none of the stalled paths (rulings,
live-console, the dispatch list, `/kpis`) call Linear at all; they are Mongo-only. The
only Linear wait in the affected surfaces — the observation feed's error lookup — has a
15 s × 3-attempt timeout, far short of the 27–595 s holds observed (LIN-2993 comment
`8b2bcfa4`).

## Amplifiers

The cascade abort issued as a precaution at ~19:30Z made the incident worse, not better:
it queued **19 aborts when only 2 sessions were still running**, and every aborted
session was counted as errored, so the observation feed then ran a Linear lookup for
each one — the exact call chain that produced the 546–573 s holds noted above (LIN-2994;
LIN-2993 comment `1fbe8f73`).

This incident contradicts the "harmless"/"safe no-op" framing that currently appears in
three places in this repo's own contract text — `docs/dispatch-integration.md:591`,
`docs/dispatch-integration.md:592`, and the live proxy `/instructions` at
`lib/proxy-instructions.js:710`. None of them are corrected here; that correction is
**LIN-2998**'s (stop three load amplifiers), which this record routes to rather than
silently rewording.

## What worked

- **Stopping the con's own polling** as soon as the failures were noticed (LIN-2993
  description).
- **Dispatching a read-only host investigator** (`10022ce7`, followed up `3fc09da4`),
  which posted findings to the ticket as it worked and delivered the discriminating
  `mongosh` test that overturned the wrong lead (LIN-2993 comments `8b2bcfa4`,
  `9e91955a`).

## What didn't

- **The cascade abort** — see *Amplifiers* above.
- **Reading Railway's dashboard DB-stats hang as a mongod-health signal.** The CLI
  reported `database stats unavailable: SSH command failed` — Railway's own SSH path to
  the container, unrelated to mongod (LIN-2993 comment `8b2bcfa4`; also noted as a
  verification caveat in LIN-3000's description).
- **The "outbound Linear waits" lead** — see *The wrong lead* above.

## What is NOT established

- **Why the EU↔US-East link degraded.** Confidence low-medium; Harbour's own outbound
  Linear resets over the same window are a clue, not a confirmed cause (LIN-2993 comment
  `9e91955a`).
- **The `422 UNKNOWN_REPO`, `knownRepos: []` refusal at ~19:42Z** (LIN-2993 comment
  `9459e3d2`). This record does **not** attribute it to Linear slowness. A related but
  distinct question — why the known-repos inventory stayed empty *after* recovery — was
  investigated separately under LIN-3003 and closed as not-a-bug: John had deliberately
  removed the `repo=` lines from the Linear project descriptions, unrelated to this
  incident (LIN-3003, resolution comment `bf03d89f`). That closure explains the
  post-recovery state; it does not establish what caused the single mid-incident refusal
  above.
- **Per-route behaviour before 19:25Z.** Railway returns no HTTP logs for removed
  deploys, so there is no way to see how individual routes behaved at the ~19:15Z onset
  (LIN-2993 comment `9e91955a`, "What I couldn't establish").

## Follow-ups

| Ticket | State (2026-09-23) | Note |
|---|---|---|
| LIN-2994 | Backlog | Workspace halt (pause/stop) reaching the runner even when Harbour is degraded |
| LIN-2995 | Backlog | Runner-local halt / auto-pause, independent of Harbour |
| LIN-2996 | In Progress | Stop copying the full 30-day history on every cache fill |
| LIN-2997 | Backlog | Bound Mongo and outbound waits (fail fast instead of hanging) |
| LIN-2998 | Backlog | Stop the three load amplifiers, including the cascade-safety wording above |
| LIN-2999 | Backlog | Deep health read + early warning |
| LIN-1756 | Todo | Apply Railway deploy settings (healthcheck, draining, overlap) |
| LIN-1795 | Backlog | Fleet drain |
| LIN-3000 | **Done** | Move MongoDB-harbour to the app's EU region — the structural fix, verified (`4a531223`) |
| LIN-3003 | Canceled | Investigated the post-recovery empty known-repos inventory; not a bug (see *What is NOT established*) |
