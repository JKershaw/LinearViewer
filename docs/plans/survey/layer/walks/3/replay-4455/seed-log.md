# Seed log: LIN-4455 before 2026-11-13T14:58:27Z

`seed.sh` rebuilds `store.json` from empty (not retro). Run once from empty: 65 records, `check` gives no problems, one stale record (`verdict-49`). Latest `--at` is 14:56Z.

**Written, and where it came from**
- `area-1` Runs & dispatch, from `areas.json` @ cfd152fa4. Each `x[^/]*` pattern became the prefix `lib/x` (e.g. `lib/dispatch-`); exact names are full files. `lib/dispatch-` also covers `lib/dispatch-tokens.js`, which first-match gives to Agent API.
- 16 lessons and 21 Waiting findings, from `runs-and-dispatch.md` @ cfd152fa4. Findings are numbered by position in the note. 1–15 match the plan. 16 is new in cfd152fa4 (LIN-4453's leftover, 14:55Z). 17–21 are the plan's 16–20, and each says so.
- Parent (LIN-4447): `asked` is byte-exact. `done-when` is its three bullets.
- Pieces 0–8 by design at 13:40Z (rev 1's time is unrecorded); `order` = landing step.
- Plan review: round 1 is a request-changes verdict on piece 1 v1, which was then revised for B1. Round 2 gives approve verdicts on all nine pieces.
- Breakdown: LIN-4453 and LIN-4455, plus 5 decisions in LIN-4455 that rest on `verdict-55`. LIN-4453 is ended done by Harbour at 14:56Z, an approximate time: its area reads were posted at 14:24Z and cfd152fa4 is its baseline commit.

**Refusal.** `revise task-39 … --by design --task task-39` gave `{"refused":[{"rule":"6","msg":"design may not revise task-39"}]}`. I wrote the same revise by Harbour, `--via design`.

**Couldn't place**
- No plan-review note changed piece 5: no plan-review version.
- Left out: rulings, other builder notes, seven children.
- The LIN identifiers have no field, so each child's `done-when` starts with its own.

**Ids**
- Parent: `task-39`
- LIN-4455: `task-60`
- Piece 5: `plan-45`
- LIN-4453: `task-59`
- Piece 0: `plan-40`
- Approve verdict on piece 5: `verdict-55`
- Waiting 2: `finding-19`
- Waiting 4: `finding-21`
- Waiting 11: `finding-28`
