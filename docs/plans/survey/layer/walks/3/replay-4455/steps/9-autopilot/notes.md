# 9: autopilot run summary vs. the layer

## Line by line (`show --task task-60`)

- **Outcome: merged as 192e1f81f, Done.** Held: task-60 end reason, change-82 v4.
- **Surveys, "three mismatches".** Held differently: run-72 and run-78 record five survey finds (66, 68, 69, 71, 74) and question-67. Comment titles not held.
- **Scoping.** Held: decision-79, run-80.
- **Five beats, ROOT 7b0e3f56, per-beat commits.** Held differently: run-81 describes the beats. The session ROOT and the four beat SHAs are missing.
- **Review: conditional Approve, 9/9 mutations.** Held: verdict-90, run-95. Comment id 70c1e9dc is missing.
- **Blind read "better".** Held: verdict-96.
- **Close-out comments e119199c, d67626c0.** Held differently: run-103 credits e119199c to leftover, not close-out. d67626c0 is missing.
- **Evidence I read myself.** The facts are held (change-82, finding-92, run-108), but only as close-out's account. My separate check is not held.
- **Retires / Waiting 2, 4, 11.** Held: task-60 done-when and end reason, run-103.
- **Post-deploy check not run.** Held: check-94, open to John.
- **Larger finds in area notes.** Held: finding-99/100/101 to area-1. They appear by id in the task-60 reason, but not as records in `show`.
- **LIN-4458/4459 unblocked.** Not held. decision-64 records only that LIN-4455 blocks them.
- **No rulings.** Held: run-108.
- **Beat 2 test re-pointed, not weakened.** Held: finding-89(a) and its reason.

## Writes as autopilot (both refused, exit 2)

- `add run`: `{"rule":"5","msg":"run-109: by autopilot is not a declared stage or person"}`
- `add finding` (siblings unblocked): `{"rule":"5","msg":"finding-109: by autopilot is not a declared stage or person"}`

## Is the summary needed?

Mostly no. About 11 of 14 lines are already held, with ids, and better sourced. Three things are worth keeping: the conductor's separate verification, the siblings being unblocked, and the session/beat references. The layer has no actor that can write them.
