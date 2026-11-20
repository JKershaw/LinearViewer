# The live Waiting import, run 20 Nov 2026 (LIN-4505)

A dated record of the production import, kept because the code that wrote production is in no commit. It was
`scripts/records-import.mjs` and `lib/records/import-apply.js` at `c08a9a898` with one change to `applyManifest`
(below), staged inside the app service's container. The change and its witness were deleted with the importer in
`LIN-4505`'s retirement commit, so they never existed in git on their own. This file stands in for them. The
importer is retired; do not run it again (a re-run finds everything present).

## How it ran

- Route: `railway ssh` into the app service (`harbour-cat`, workspace `linearviewer`), which has Node and the deployed
  build (it carries the manifest fix `e44a842d1`). The database has no public endpoint, so nothing ran from outside.
  Every write went through the checked path (`writes.js`: `dryCheckWrite`, then `checkWrite`), never mongosh.
- Notes: the area notes at `5664cbe47`, the last commit before the LIN-4495 cutover (124 Waiting bullets, 13 notes),
  copied into the container. The staged copy was removed afterwards.
- Before any write: 29 open records to the project, none `via: import`. The dry run reported nothing already there.
- Order: dry run, then `--apply`, then a dry run again (idempotence).

## The change to `applyManifest`

At `c08a9a898` the manifest import skipped a parked ticket that was already claimed for a task (a conflict, no
write). Three tickets (`LIN-4441`, `LIN-4445`, `LIN-4463`) were claimed for open tasks under random ids from before the
ticket-task id rule. The run's version, for a claim that names a task record:

- attached the ticket's findings under that existing task, and
- added the manifest's `done_when` to that task when it had none, through the checked `writes.revise` (with a reason).

A claim that names no record kept the skip (LIN-4494's rule). Witnessed red on the previous code: the LIN-4505 case in
`tests/unit/lin-4494-importer.test.js`, which skipped the three tickets' findings. That test was deleted with the importer.

## Outputs

| Run | Waiting entries (124 bullets: 117 findings, 7 Security Review tasks) | Parked-ticket manifest |
|---|---|---|
| Dry run | 125 to create, 0 already there, 0 refused, 0 malformed | 15 to create, 0 refused; 3 conflicts; 3 done-when "would add" |
| `--apply` | 125 created, 0 refused | 15 created, 0 refused; 3 conflicts; 3 done-when "added" |
| Re-run (dry) | 125 already there, 0 to create | 15 already there; 3 done-when "already set" |

The full output of each run is in PR #2474's description. The first imported record is dated
`2026-11-20T13:06:49.033Z` (recorded as `records.coveredFrom` in `waiting-series.json`). Production then held 140
`via: import` versions (125 notes records, 15 manifest records).

## What attached to the three claimed tasks (10 findings, 3 revisions)

| Ticket | Task | Revised (checked `revise`, `via: import`) | Imported findings attached |
|---|---|---|---|
| LIN-4441 | `task-8d3762c2` | v2, done-when added | `finding-7de79939`, `finding-a827e536`, `finding-f16adfcf` (3) |
| LIN-4445 | `task-69be3c4e` | v2, done-when added | `finding-2eab091d`, `finding-34f6dbbc`, `finding-62fd07e1`, `finding-830d4d1d` (4) |
| LIN-4463 | `task-4d9a849e` | v2, done-when added | `finding-03cc96ae`, `finding-1d43b897`, `finding-51f911b8` (3) |

Total: 3 + 4 + 3 = **10** attached findings. (The retirement commit message says 13; that was a miscount, corrected
here and in the PR.) The manifest's per-ticket notes were not imported; they remain in git at `c08a9a898`, under
`scripts/records/parked-tickets.json`.
