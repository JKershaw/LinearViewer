# Incident — Railway pauses new builds; a merged change waits to deploy

**Date:** 2026-10-20
**Duration:** Railway paused new builds from about 17:03Z (status incident [JUA1PC5H](https://status.railway.com/incident/JUA1PC5H), "New builds are temporarily paused"). Builds resumed in stages, and Railway resolved the incident at 20:56Z.
**Severity:** Low. harbour.cat stayed up and kept serving its running deployment (`1259e49c`). The only effect was a delayed deploy.
**Status:** Resolved. Railway resolved its incident at 20:56Z. Paused deploys were not queued, so merging this record to main re-triggered the deploy of `b815a930` and later. LIN-3732's post-deploy check of `/kpis` follows that deploy and is recorded on the ticket.

## What happened

LIN-3732 (KPI daily rollup, part B: running totals and a rate/total toggle on both KPI pages) merged as PR #2020 (`b815a930`) at 17:09:46Z. Today's earlier merges had gone live within minutes. This one had not appeared 37 minutes later: the harbour.cat footer still showed `1259e49`. The pipeline's close-out for LIN-3732 parked, because its post-deploy check of `/kpis` could not run against the old build.

John found the cause on Railway's status page. Railway had paused new builds for every workspace while it fixed a build problem. Running services were unaffected. Railway first said that builds triggered during the pause would stay queued. A later edit to its 17:18Z update said instead that deploys triggered during the pause "will need to be triggered again once we resume builds". So `b815a930` will not deploy by itself; it needs a fresh deploy trigger after builds resume. A later push to main is enough.

## Timeline (UTC, 20 Oct)

| Time | Event |
|---|---|
| 16:41 | PR #2019 (LIN-3727) merged; production deployed `1259e49c` normally. |
| 17:03 | Railway: "Investigating"; new builds paused for most workspaces. |
| 17:09 | PR #2020 (LIN-3732) merged as `b815a930`; its build queued. |
| 17:18 | Railway: "Identified"; new builds paused for all workspaces. |
| 17:29 | LIN-3732 close-out: merged, but production still serves `1259e49c`; post-deploy check deferred. |
| 17:46 | Operator: footer still `1259e49`, 37 minutes after the merge; asked John to look at Railway. |
| ~17:50 | John linked the Railway status incident. |
| 18:35 | Operator re-check: still paused. Railway's update now says paused deploys must be re-triggered after builds resume. |
| 19:10 | Railway: builds still paused for all workspaces; they will come back in stages. |
| 19:37 | Operator re-check: still paused; production still serves `1259e49c`. |
| ~20:5x | Railway: builds enabled for Enterprise, Pro, then Hobby workspaces, then all. |
| 20:56 | Railway: resolved. Deploys triggered during the pause "were not queued during the pause and will not start on their own". |
| 21:10 | Operator: production still on `1259e49c`. This record is merged to main to re-trigger the deploy. |

## What it taught

- **The deploy footer is the right first signal.** The close-out's habit of checking that production serves the merged commit caught this. Without it, the ticket would have been closed against code that was not live.
- **Check the platform status page before the deploy logs.** A deploy that has not appeared on a quiet day may be a platform pause, not a failed build.
- **After a platform pause, re-trigger.** Railway did not queue pushes made during the pause. The deploy of an already-merged commit needs a fresh push or a manual redeploy.
- **A held close-out is the right state.** The work is merged and the ticket stays open until production shows it, as here. It is not a problem to fix.
