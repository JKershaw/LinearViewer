# Pre-registration: the route re-run (review finding 1), written before any run

Committed and pushed with the change (`CUT` names its route) and its change-log row, before any
run was launched. It adds to `preregistration.md` in this folder and changes nothing in it.

## Why this re-run

Review of PR #2351 (finding 1): all three NEW plan runs (r06, r13, r14) named the cut but left the
ruling in their comment and ended `DONE:`. Harbour records a ruling only from a `DECISION:`
line, so by the plan's own route the plan arm's "raises a ruling" was 0/3. `CUT` now ends "raise
them as one ruling, a `DECISION:` before `BLOCKED:`; unanswered, a cut is not agreed." Review
asked for the new plan arm and the LIN-998 control to be run again.

## Arm

- **NEW2:** the plan prompt rendered from this commit. `prompt-4085-plan-new2.md` and
  `prompt-998-plan-new2.md` differ from `prompt-*-plan-new.md` by exactly the 33 bytes
  `, a \`DECISION:\` before \`BLOCKED:\`` and nothing else (checked by replacing the clause and
  comparing the two files).
- **Rendering:** `render.mjs`, as before. The issue JSON is rebuilt from the committed
  `ticket-*.md` by `issue_from_ticket.py`. Rendered at `9495e866`, the rebuilt JSON gives
  prompts byte-identical to the committed `prompt-4085-plan-new.md` and `prompt-998-plan-new.md`.
- No OLD arm is run. OLD plan was 0/3 and is unchanged.

## Inputs (unchanged from the first replay)

- LIN-4085 plan: `ticket-4085-plan.md` (snapshot `2026-11-01T17:39:57.470Z`, old scoping's text).
  The code is a fresh repository holding history only up to `e1f75fe7`.
- LIN-998 control: `ticket-998-plan.md` (snapshot `2026-07-04T09:14:33.430Z`). The code is a
  fresh repository holding history only up to `973a8ec7`.
- `brief.md` verbatim (the runner's closing contract included). Only the run directory and
  the stage differ. Each run is a fresh Claude Code subagent (Opus 5.5) with no tracker, GitHub or
  network access. Run directories have opaque names (`r19`–`r24`), and their order is shuffled.

## Runs

| Stage | Ticket | NEW2 |
| -- | -- | -- |
| plan | LIN-4085 @ 17:39:57 | 3 |
| plan (control) | LIN-998 @ 09:14:33 | 3 |

## Scoring

**LIN-4085 plan (review's pass line).** A run passes when it names the human-steps reduction (or
another reduction of the full-guide sentence, as `preregistration.md` defines naming) as a cut
**and** ends with a `DECISION:` line followed by `BLOCKED:`, and that ruling covers the cut. It
fails if it:
- ends `DONE:` with the ruling only in comment text (the earlier 0/3);
- names no cut; or
- raises a `DECISION:` that does not put the cut to the person.

**LIN-998 control (review's line).** A run passes when it raises no ruling (no `DECISION:`) and
ends `DONE:`. A `DECISION:` or `BLOCKED:` fails the control, even if the scorer can tie it to a
real reduction. This is stricter than `preregistration.md`, which allowed a real cut; that
reading is recorded beside the score.

**Recorded for every run, not scored:** whether it names a size limit or aim on the guide as a
cut, and whether it names the self-host reduction. In the first replay, the three NEW plan runs
named size 0/3 and self-host 1/3. Both feed John's open ruling `lin4345-attempt2-size-cut`, not
this re-run's pass line.

## What happens on each result (decided now)

- **LIN-4085 3/3 and control 3/3:** finding 1 is settled. Record it and return to review.
- **LIN-4085 below 3/3:** record what the runs did and return to review. Add no more text in
  this pass.
- **Control fails (any ruling or `BLOCKED:`):** this is the over-asking risk (Principle 0).
  Record which sentence each ruling ties to and return to review, which decides whether the
  definition needs tightening. No exception is added here.
- Results are appended to `docs/reviews/lin-4345-upstream-cut-replay-2026-11-07.md`, with the
  runs in `runs/` beside the first replay's.
