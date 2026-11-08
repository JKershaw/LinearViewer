# Scoping writes the size record, replay arm 2 (8 November 2026)

Arm 1 (`lin-4369-size-replay-2026-11-08.md`) failed criteria 1, 2 and 3. The autopilot ruling on
LIN-4369 (comment efde8688) allowed exactly one further arm: revise scoping's wording, keep the four
pass criteria byte-for-byte, commit a new pre-registration before any run, use a fresh judge, and
**no third arm**: "If it fails any criterion, stop, leave piece 4 unstarted, and hand back to John
with both arms' evidence."

This is evidence for review, not a CI result. The pre-registration, the revised prompts and the run
map were pushed in `5965fd4d`, before any arm-2 run. A setup error was found mid-run and recorded
in an addendum (`8ea4b988`) before any rerun (see "The voided runs" below). Run outputs and guard
results were pushed in `1b2fed28`, before the judge's verdict.

## Result: arm 2 fails criterion 3, so the replay fails and the work stops here

| Criterion (unchanged from `70e9ec9e`) | Arm 1 | **Arm 2** | Judged by |
| -- | -- | -- | -- |
| 1. The control stays small: all 3 LIN-998 records are "just the task", no extra | fail, 0 of 3 | **pass, 3 of 3** | fresh reader |
| 2. Every record passes the piece-2 guard | fail, 5 of 12 | **pass, 12 of 12** | code (`checkSizeRecord`) |
| 3. No record tells the builder how (LIN-4178, 4252, 4253) | fail, 2 of 9 clean | **fail, 5 of 9 clean** (a02, a04, a08, a15 fail) | fresh reader |
| 4. Every size that cuts the ask raises a `DECISION:` | pass, 6 of 6 | **pass, vacuously**: no record named a cut | fresh reader |

The revision fixed what it aimed at. The control stays small, and no record carries code-shaped how.
It did not stop the how that is written in plain words. All three LIN-4253 records, and one
LIN-4178 record, give the builder a definition or invariant the ask does not contain. By the
ruling, there is no third arm. Piece 4 (LIN-4370) does not begin, and both arms' evidence goes to
John.

## Per run

| Run | Ticket | Size | Decided by | Guard | `DECISION:` | Reader, crit. 3 |
| -- | -- | -- | -- | -- | -- | -- |
| a03 | LIN-998 | just the task | policy | pass | no (no cut) | n/a (control: pass) |
| a09 | LIN-998 | just the task | policy | pass | no (no cut) | n/a (control: pass) |
| a11 | LIN-998 | just the task | policy | pass | no (no cut) | n/a (control: pass) |
| a13 | LIN-4178 | consolidate | policy | pass | no (no cut) | pass (borderline) |
| a14 | LIN-4178 | consolidate | policy | pass | no (no cut) | pass (borderline) |
| a15 | LIN-4178 | consolidate | policy | pass | no (no cut) | **fail**: "a lineage gets the same figure whatever shape its rows arrive in", ready to become a test assertion |
| a05 | LIN-4252 | just the task | policy | pass | no (no cut) | pass |
| a06 | LIN-4252 | just the task | policy | pass | no (no cut) | pass |
| a10 | LIN-4252 | just the task | policy | pass | no (no cut) | pass |
| a02 | LIN-4253 | just the task | policy | pass | no (no cut) | **fail**: defines both traits ("The trait must carry the one meaning the dispatch preamble gates today"); says which test to write |
| a04 | LIN-4253 | just the task | policy | pass | no (no cut) | **fail**: "offered" is "whether it carries a route"; the read-only trait named "for what it gates" |
| a08 | LIN-4253 | just the task | policy | pass | no (no cut) | **fail**: "define the trait by what it gates today, the dispatch mandate, apart from the reading-pass intent and read-only workflow wording" |

Every record reads back through `readSizeRecord` with a size and a decided-by
(`_evidence-2026-11-08-lin4369-size-replay-arm2/guard-results.tsv`). Every record is within a few
words of 200.

## What the outputs show

- **The control is fixed.** All three LIN-998 records say the Surveys' findings (cost, duplicate
  calls, twin modules) are real but not needed for the ask, and put them under open questions.
  None adopt the Surveys' narrowing to paid keys or missing-only sections, and two say outright
  that it would be a cut. Arm 1 sized up 3 of 3 and blocked on a free-tier cut.
- **The policy now enlarges only where a finding binds.** LIN-4178 is "consolidate" 3 of 3: each
  run finds that the shared cost read prices nothing on the row shapes production sends, so the
  asked rewiring would blank the surfaces. LIN-4252 and LIN-4253 are "just the task" 6 of 6. The
  reader flags that LIN-4178's case rests on a claim that piece 1 (LIN-4177) under-delivered,
  which no one has checked.
- **The how moved from code shape to plain-word definitions.** The guard and the record's word cap
  removed lists of names, code spans and done-conditions. But on LIN-4253 every run settles the
  design question the Surveys raised and the ask left to the builder (what "read-only" and
  "offered" mean), and writes the answer as a definition. The prompt bans "definitions", yet 3 of
  3 runs wrote one. The reader also notes that the LIN-4252 records settle a builder's choice (the
  fake serializes its tree) in words that pass the criterion. That suggests deciding the size and
  deciding the design are hard to separate in one pass of scoping.
- **No run named a cut, so criterion 4 was not exercised.** Arm 1 had six cutting records; arm 2 has
  none. On substance, the reader finds one narrowing that was not named: a02 rules that a pinned
  test list of stage names is allowed, against the ask's "No hand-kept list of stage names
  remains".
- **Runs on the same ticket still disagree on details**: LIN-4178 on whether mapping the run page's
  loops is the task or the extra; LIN-998 on whether stopping duplicate in-flight generations is
  part of the task (a03), a possible ticket (a11) or not needed (a09).

## The voided runs

Arm 1's LIN-4178 run directories held the parent's description as `parent-LIN-4176.md`, and
`ticket.md` points to it. Arm 2's setup left it out of `a01`, `a07` and `a12`. `a01` finished and
said the file was missing; `a07` and `a12` were stopped unfinished. The addendum (`8ea4b988`)
voided all three before any rerun, whatever they had written, and replaced them with `a13`–`a15`
set up as arm 1's. `a01`'s output is kept as `runs/a01-void/` and is not scored. Every other run's
inputs match arm 1's run directories.

## The fresh reader's verdict

A subagent started after every scored run had finished. It was given a folder holding only the
criteria (copied verbatim), the run map of the 12 scored runs, the sealed tickets with their
Survey comments, LIN-4176's description, and each run's `description.md` and `final.md`. It was
given nothing about how the template was written or revised. Its verdict is reproduced unedited in
`_evidence-2026-11-08-lin4369-size-replay-arm2/reader-verdict.md`. Its overall line:

> Overall: FAIL. Criterion 3 does not hold.

## Limits

- **n = 3 per ticket, two arms.** The arms differ only in scoping's wording, with the same tickets,
  bases, Survey comments, brief and model. The comparison shows direction, not effect size.
- **Offline, so stricter than live on criterion 2**, as in arm 1. Here that does not matter: no
  record was refused.
- **The reader is a subagent of the session that ran arm 2.** It had none of the build's context,
  only the folder above. It is not an independent person. Arm 1's reader was a different subagent.
- **All runs were Claude Code subagents on Opus 5.5**, not necessarily the model a live scoping
  dispatch would use.
- **The Surveys were not re-run.** Arm 2 reuses arm 1's Survey comments, so the scoping wording is
  the only difference between arms. Different Survey comments could move the sizes.

## Setup and commands

As arm 1 (see its results doc for the snapshot, base-clone and render commands), with these
differences:

- **Prompts.** `node render.mjs <repo at 5965fd4d> tickets/issue-<n>.json scoping
  prompts/scoping-<n>.md`, the same render script, so `diff` against arm 1's prompts shows exactly
  the revised wording.
- **Runs.** 12 scored runs (`a02`–`a06`, `a08`–`a11`, `a13`–`a15`; `run-map.tsv`), each a fresh
  subagent given `brief-scoping.md` without its title line (as arm 1), with only its directory
  filled in. The run directory held `prompt.md`, `ticket.md` (arm 1's `tickets/ticket-<n>.md`),
  `parent-LIN-4176.md` for LIN-4178, and `code/`, a `git clone --local` of the base clone. Every
  clone was clean afterwards.
- **Guard** (criterion 2), arm 1's `guard.mjs` against `lib/size-of-move.js` (unchanged since
  `70e9ec9e`), output in `guard-results.tsv`.

No runnable script is committed under `docs/reviews`.
