# Pre-registration: LIN-4369, scoping writes the size record (written before any run)

Committed and pushed with the template change, the rendered prompts, the ticket inputs and the
briefs, before any replay run was launched. The source of every criterion is LIN-4369's `## As
asked` block and LIN-4346's approved plan (revision 1, piece 3); where this file adds something,
it says so.

## What is tested

Scoping's prompt on this branch: its output is one `## Size of the move` section (LIN-4369),
under John's standing policy `err-larger` (his ruling of 7 Nov 22:18 on LIN-4346). There is one
arm. Nothing is compared with the old scoping text: the old text writes no size record, so the
criteria below cannot be scored on it.

## Inputs

One Survey pair per ticket, then three scoping runs per ticket.

| Ticket | Why it is here | Historical base | Text as filed (snapshot) | Comments filed with it |
| -- | -- | -- | -- | -- |
| LIN-4178 | its wording invited a copy (`docs/plans/survey/place-ledger.md`, row LIN-4178) | `10b2c82fb` (`main` when it was filed) | 2026-11-03T23:03:01.849Z | piece 1's merge note, 23:02:00 |
| LIN-4252 | a tidy that left copies (Finding 9) | `29f14bf6e` | 2026-11-05T10:14:22.854Z | none |
| LIN-4253 | a tidy that didn't | `29f14bf6e` | 2026-11-05T10:14:58.332Z | none |
| LIN-998 | the small, clear control (LIN-4345's control) | `973a8ec77` | 2026-07-04T09:08:31.785Z (description unchanged from filing) | triage's filing comment, 09:06:37 |

- **The ticket text as filed** is each ticket's first task snapshot (`GET /issues/{id}/snapshots`),
  sealed into an `## As asked` block the way LIN-4345's harness did: the whole filed description
  inside the block, except LIN-998's feedback-widget origin marker, which goes below the end line.
  Later text is left out, including the hand-written scope added to LIN-4252 and LIN-4253 at
  10:21 and the historical Surveys of LIN-4252 and LIN-4253 (replaced by this replay's own).
- **LIN-4178 is a breakdown child.** Its scoping runs also see the parent, LIN-4176, as its
  description read at 2026-11-03T21:48:31Z (unchanged at 23:03:13). LIN-4176 has no size record.
- **The Survey prompts** are rendered from this branch (`generatePrompt('survey-task' |
  'survey-place', …)`; byte-identical to `main` at `eeda7e44` for the same input) with the ticket
  text as filed, and the base pinned: each `{BASE}` is replaced by the ticket's base, and the brief
  says that `origin/main` resolves to it and `code/` is already checked out there.
- **The scoping prompts** are rendered from this branch with the standing policy set to
  `err-larger` (`setAt` 2026-11-07T22:18:14.300Z), the same object `loadSizePolicy` returns.
- **Code.** Each run gets its own clone holding history only up to the ticket's base (one ref; no
  later commit reachable), in a run directory with an opaque name.

## Runs

- **Surveys:** 8 runs (`survey-task` and `survey-place` for each ticket), each a fresh Claude Code
  subagent given `brief-survey.md`. Each writes the comment it would post.
- **Scoping:** 12 runs, 3 per ticket, each a fresh subagent given `brief-scoping.md`, reading its
  rendered prompt and `ticket.md`: the sealed description, the comments filed with the ticket, and
  that ticket's two Survey comments from this replay. Each writes the section it would add below
  the block (`output/description.md`), any comment, and its final message with its outcome line
  (`output/final.md`), including any `DECISION:`.
- Neither brief mentions sizes, the guard, copies, how, or what is expected.
- **Offline, so stricter than live.** No run reaches the proxy, so no record meets the guard's 422
  and gets a second try. A record is scored as first written.

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

The result is recorded as it is, the failure is reported on LIN-4346, and piece 4 (LIN-4370) does
not begin. A prompt change made after seeing these outputs is a new arm with its own
pre-registration, never a re-score of this one.
