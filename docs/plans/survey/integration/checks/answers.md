# Answers to the checks on draft 1

*18 Nov. Each find from `break-read.md`, `paper-walk.md` and `drift-read.md`, with where draft 2 answers it. "Open" means it is left for John, or not answered.*

## Break read

| # | Find | Draft 2 |
|---|---|---|
| 1 | Slice 1 drops comments from the brief | §3: the ticket section is kept until slice 4, and the prompt keeps its thread line |
| 2 | `by` from the token fails on held sessions and copy tokens | §2: the write names its run; the id is allocated before the prompt; copy tokens write as the person |
| 3 | Actors don't cover the stages; `john` is hard-coded | §1: actors are the 20 stage kinds plus `autopilot`, `harbour` and `person:<accountId>` |
| 4 | Area records arrive in slice 5 | §9: imported in slice 1; §3: part 5 lists every area until paths are set |
| 5 | Blind read loses its isolation | §3: still no brief; given the change id; the blind flag applies to its queries |
| 6 | Chat tools read the brief cache | §3: the cache is kept until slice 4, when chat reads the records brief (placement C4-44) |
| 7 | The question protocol spans two repos | §5: SD and the runner kit are unchanged; Harbour turns their feedback into records; the scripts are in slice 4 |
| 8 | Nothing resumes on an answer | §5: the browser resume is kept and carries out `on-answer` |
| 9 | Areas per repo vs per workspace | §9: area records are per workspace, imported from the repo's `areas.json`. **Open** for multi-repo workspaces; it doesn't arise before Yap |
| 10 | The PR-set rule is not shape | §4: stays in Harbour's route |
| 11 | No join from run record to item; non-done markers | §4: `runRecordId` on the row; marker as end reason; `[skipped]` ends nothing |
| 12 | Summaries are read back | §7: readers skip Harbour's mark |
| 13 | Double wake in slice 6 | §6: skips records from the waiting run's own children |
| 14 | More callers of retired modules | Placement C3-41 (words only, the kind stays); slice 2 notes Ship Biscuit; slice 4 names the replay scripts |
| 15 | Knots understated | §1 and §10: four one-way edges in slice 1, named |
| 16 | Contradictions (recap; pointer lines; byte pin) | §3: recap in slice 4. Placement C1-07: both halves; the pin changes in slices 1 and 5 |
| 17 | Uncached model call per brief | §3: the kept section uses today's model and cache unchanged |

## Paper walk

| # | Find | Draft 2 |
|---|---|---|
| B1 | Wake and custom rows name no stage | §2: the stage is resolved from the parent, as `stampForWakeParent` does |
| B2 | A held session keeps its first token | §2: the signalled prompt names its own run |
| B3 | Area records needed in slice 1 | §9 |
| B4 | Regexes vs prefixes | §9: converted once by hand, with a test against `areas.json` |
| B5 | Sibling tickets have no task record | §2: tasks are found or made by tracker id |
| B6 | Change head lags the verdict | §4: the head is refreshed at the verdict write |
| B7 | Blind read: no brief, no change id, PR-set check | §3, §4 |
| B8 | Plan-review verdict has no plan (slice 2) | §10: the plan moves to slice 2, verdicts to slice 3 |
| B9 | Comment amendments drop out | §3: ticket section kept |
| B10 | John's read has no door | §8: the task page writes `by` the person |
| B11 | Records with no reader | §5: the rulings page includes records left under an ended task with no parent. `to: harbour` is not a reader. **Open**: a short note in the kinds that `harbour` writes but is never addressed |
| B12 | A stage can't find its run | §3: the brief header names it |
| Q1 | Which kinds per slice | Each slice's prompts direct its kinds. Surveys write findings in slice 1 and keep a one-line comment for look-first until slice 3 (C3-14) |
| Q2 | Wake stage; answer-wake kind | §2: resolved from the parent; the browser resume (§5) |
| Q3 | "Parked" | §6 now says held waiting on the task, not C3-51 |
| Q4 | `via` | §2: import and scan only |
| Q5 | Task found by `ref`; child `in` parent | §2 |
| Q6 | Whose plan in slices 1–2 | Moot: the ticket section is kept, and the plan moves in slice 2 |
| Q7 | Kinds outside the actors | §1: all 20 stage kinds |
| Q8 | Bootstrap carries item and stage | §2: the write names its run, so the token doesn't need to |
| Q9 | Record ops for restricted stamps | §2: the record routes are open to all writing tokens |
| Q10 | Who ends a change `merged` | §4: Harbour, on the merge it records |

## Drift read

| # | Find | Draft 2 |
|---|---|---|
| 1 | Per-stage write gate on records | §2: none; ticket stamps unchanged |
| 2 | One resume rule | §5: the three effects are kept (`on-answer`, flagged as an addition) |
| 3 | Blind-read guard and PR set | §4 |
| 4 | Store version check | §5: the answer route refuses an ended question; not the store |
| 5 | Hard-coded `john` | §1: person actors; the owner is John's case |
| 6 | Kinds in code | §1: `kinds.json` as data; actors from the stage kinds |
| 7 | Porting the throwaway model | §1: written from §3; the model is a reference, its checks the contract |
| 8 | `scope` clash | §1: `workspace` |
| 9 | Tracker neither backup nor sync | §7: backup in summary, people's comments inward; direction is §11.2 |
| 10 | `via` for the autopilot | §2: the autopilot writes as itself |
| 11 | Length | Appendix moved to `placement.md`; §0 cut |
| Missing | Real work as the test; building on a half-switched Harbour; safety as tasks; Yap | §11.1; §10's opening; §9; §1 (another project supplies its actors) |
| Questions | 11.1–11.3 weren't John's | Dropped or decided. John's questions now: parked work timing, tracker direction, the two additions, rulings order, slice 6, knots |
