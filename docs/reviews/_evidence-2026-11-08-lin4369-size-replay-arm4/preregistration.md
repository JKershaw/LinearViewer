# Pre-registration: LIN-4369, replay arm 4 (written before any arm-4 scoping run)

This file is committed and pushed before any arm-4 scoping run, together with the code it tests,
its rendered prompts and its run map.

What came before:
- Arm 3 (`f4547e84`), the structural arm, failed criterion 2. Its guard refused 10 of 12 records
  as first written. Eight of those refusals were a why that is one sentence joined by a
  semicolon: the guard counted `;` as a sentence break, but the prompt never said so.
- Arm 3 passed criteria 1, 3 and 4. Its fresh reader found, unscored, that the how had moved into
  scoping's comments.

John's ruling on LIN-4369 (decision `lin4369-after-arm3`, 2026-11-08 09:58) chose this option,
quoted:

> One more arm: guard accepts a semicolon-joined sentence and the prompt says so; scoping writes
> the record and no comment

The same option, as offered on LIN-4346 (comment cc4376af), added "(the judge scores comments
too)". Check 5 below is that clause.

## What is tested

This is the code at the commit that adds this file. Arm 4 changes only these two things against
arm 3:

- **The why's one sentence may be joined by semicolons.** The guard's sentence rule
  (`lib/size-of-move.js`) now ends a sentence only at `.`, `!` or `?` followed by more text. The
  why's line in the record shape, rendered for scoping from `RECORD_PARTS`, now reads "one
  sentence, at most 40 words, where a semicolon may join clauses and a full stop ends it: what this
  size delivers and why". Everything else about the shape is unchanged: four lines and nothing
  else, the sizes, the 40-word cap, cuts quoting the ask, and decided-by.
- **Scoping posts no comment.** One sentence is added: "Post no comment: the record is all you
  write on the ticket, and your reasoning goes in your final message." The proxy guard cannot
  hold this, because comments go through another endpoint, so check 5 measures it.

Nothing else changes: the definition of binds, the policy line, the cut line, the lead, CUT
(rendered once), and the brief. The full prompts are in `prompts/`; `diff` them with arm 3's.

## Inputs (as arm 3, reused)

The tickets, bases, ticket files, Survey comments and parent file are byte-identical to arm 3's
(`../_evidence-2026-11-08-lin4369-size-replay-arm3/`):
- **LIN-1512, the control:** `tickets/ticket-1512.md` there, with its own Survey pair, at
  `921abf747`.
- **LIN-4178, 4252 and 4253:** arm 1's ticket files and Survey comments, at their arm-1 bases.
  LIN-4178's run directories hold `parent-LIN-4176.md`.

The scoping prompts are rendered from this commit with the standing policy `err-larger`, by the
render path in arm 1's results doc. Each run gets its own `git clone --local` of its base clone.

## Runs

- **Scoping:** 12 runs, 3 per ticket, in the shuffled order of `run-map.tsv` (`d01`–`d12`, seed
  20261109).
- Each run is a fresh subagent given `brief-scoping.md`, arm 1's brief byte for byte, which still
  names where a comment would go. Only its directory is filled in.
- The brief says nothing about sizes, the guard, copies, how, comments or what is expected.
- **Offline, so stricter than live:** each record is scored as first written.

## About the criteria

Criterion 1 is arm 3's: the control is LIN-1512. Criteria 2, 3 and 4, and the paragraphs that
follow them, are byte for byte arm 1's (`70e9ec9e`). In them, "this file" means this file, and
"this commit" means the commit that adds this file. Here `checkSizeRecord` holds the shape with
the semicolon rule as described above.

Check 5 is added from the words of the option John chose. **The replay passes only if criteria
1–4 and check 5 all hold.**

## Pass criteria (fixed here)

The replay passes only if all four hold.

1. **The control stays small.** All 3 LIN-1512 records choose "just the task", with no extra piece
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

**5. Scoping writes no comment** (from the chosen option: "scoping writes the record and no
comment"; "the judge scores comments too"). Judged by code: for every one of the 12 runs,
`output/comment.md` is absent, or empty once whitespace is trimmed. Any run that writes a
comment fails the check.

The fresh reader also applies criterion 3's test to each run's `final.md` and to any comment
written, and reports what it finds. Final messages are not posted on the ticket, so that report
is recorded, not scored.

## If it fails

The result is recorded as it is. The work stops, LIN-4370 stays unstarted, and all four arms'
evidence goes back to John. The PR stays marked "do not merge".

## If it passes

PR #2356 goes on to normal review. LIN-4370 (piece 4) may begin only after that review.
