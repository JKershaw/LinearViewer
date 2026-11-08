# Pre-registration: LIN-4369, replay arm 2 (written before any arm-2 run)

Committed and pushed with the revised scoping text, its rendered prompts and the run map, before
any arm-2 run was launched. Arm 1 (`../_evidence-2026-11-08-lin4369-size-replay/`, pre-registered
in `70e9ec9e`) failed criteria 1, 2 and 3. The autopilot ruling on LIN-4369 (comment efde8688,
8 Nov 01:03) allows exactly one further arm: scoping's wording revised, the four pass criteria
unchanged, its own pre-registration committed first, a fresh judge, and no third arm.

## What is tested: the revised wording

Scoping's prompt at the commit that adds this file. Against arm 1 it changes four things and
nothing else (the full rendered prompts are in `prompts/`; `diff` them with arm 1's):

- **The lead** (the Goal's first line), which the selector also quotes. Was: "The ticket is
  unclear about its goal: settle what it should deliver and what done means. Read the code
  first." Now: "Settle how big a move this ticket makes, and why: what, never how. Read the code
  first." The ruling puts this change here, although the routing prompt is piece 4's, because it
  is the cause arm 1 pointed to.
- **When a finding binds**, added after "is the answer when the Surveys find nothing this task
  binds on": "A finding binds on this task only when the asked change would not work, or would
  leave the problem it fixes in place, without it; a finding that is nearby, deeper or merely
  worth doing does not, and goes in open questions as a possible ticket of its own."
- **The policy**: "With a standing policy, apply it and say so." becomes "With a standing policy,
  apply it and say so: it weighs the sizes a binding finding opens, and never makes a finding
  bind." The policy line itself (code, `lib/size-of-move.js`) is unchanged.
- **The record**: "(append it, or replace your own): what and why, never how, so no file, code,
  name to sweep or step; the builder works out the how." becomes "(append it, or replace your
  own), under 200 words: what and why, never how. It is not a plan, and plan writes what done
  means: no done conditions, settled details, figures, definitions, lists of cases or places to
  cover, wording a builder could copy into code or a comment, or facts about this machine. Name
  an extra by the behaviour it changes, in one sentence. No backticks, paths, code names or
  numbered lists: the proxy refuses them."

The size vocabulary, `RECORD_PARTS`, the guard (`checkSizeRecord`), CUT and the policy line are
byte-identical to arm 1.

## Inputs (as arm 1, reused)

- **The same tickets, bases and ticket text as filed** as arm 1: LIN-4178 at `10b2c82fb`,
  LIN-4252 and LIN-4253 at `29f14bf6e`, LIN-998 at `973a8ec77`; LIN-4178's parent LIN-4176 as
  arm 1 read it.
- **The same Survey comments.** Arm 2 does not re-run the Surveys. Each scoping run reads arm 1's
  `tickets/ticket-<n>.md` unchanged (the sealed description, the filing comments and that
  ticket's two Survey comments from arm 1). The Survey prompts are unchanged by this revision,
  and reusing their outputs keeps the scoping wording the only thing that differs between arms.
- **The scoping prompts** are rendered from this commit with the standing policy `err-larger`
  (`setAt` 2026-11-07T22:18:14.300Z), by the render path recorded in arm 1's results doc.
- **Code.** Each run gets its own `git clone --local` of the ticket's base clone (history only up
  to the base), in a run directory with an opaque name.

## Runs

- **Scoping:** 12 runs, 3 per ticket, in the shuffled order of `run-map.tsv` (`a01`–`a12`), each
  a fresh subagent given `brief-scoping.md` (arm 1's brief, byte-identical) with only its
  directory filled in. Outputs as arm 1: `output/description.md`, any `output/comment.md`, and
  `output/final.md` with its outcome line and any `DECISION:`.
- The brief mentions no sizes, guard, copies, how, or what is expected.
- **Offline, so stricter than live**, as arm 1: no record meets the guard's 422 and gets a second
  try. A record is scored as first written.

The four criteria below are copied byte-for-byte from arm 1's pre-registration (`70e9ec9e`,
`../_evidence-2026-11-08-lin4369-size-replay/preregistration.md`): not loosened, reworded or
reweighted. "This file" in them means this file; "this commit" means the commit that adds this
file, where `lib/size-of-move.js` is unchanged from `70e9ec9e`.

## Pass criteria (fixed here)

The replay passes only if all four hold.

1. **The control stays small.** All 3 LIN-998 records choose "just the task", with no extra piece
   of work named. 3 of 3.
2. **Every record passes the piece-2 guard.** For each of the 12 runs,
   `checkSizeRecord(live, next)` (`lib/size-of-move.js` at this commit) returns `{ ok: true }`,
   with `live` the sealed description and `next` that description, a blank line, and the run's
   `output/description.md`. Run in code, by the author; the command is in the results doc. A run
   that writes no `## Size of the move` section fails this criterion.
3. **No record tells the builder how** (LIN-4178, LIN-4252, LIN-4253; 9 records). The fresh reader
   finds, in no record, a list of names to sweep, or wording a builder could copy into the code or
   turn into a comment. One such record fails the criterion.
4. **Every size that cuts the ask raises a `DECISION:`.** For every record whose chosen size is
   smaller than the ask or "wrong work", or that names a cut to the `## As asked` block, the run's
   final message carries a `DECISION:` line. Any record without one fails the criterion.

**Who judges.** Criterion 2 is code. Criteria 1, 3 and 4 are judged by a fresh session that built
none of this: a subagent started after every run has finished, given this file's criteria
verbatim, the sealed tickets, the Survey comments and the 12 runs' outputs, and nothing about how
the template was written. Its verdict is copied into the results doc unedited.

**Recorded, not scored:** whether each record reads back through `readSizeRecord` with a size and a
decided-by; the size and decided-by of every record; whether a larger size names its extra as its
own piece that may stop; and the Surveys' cost.

## If it fails

The result is recorded as it is. Per the ruling, there is no third arm: the run stops, piece 4
(LIN-4370) stays unstarted, and both arms' evidence is handed back to John on LIN-4346 and
LIN-4369. Arm 1's evidence stays in the PR either way.
