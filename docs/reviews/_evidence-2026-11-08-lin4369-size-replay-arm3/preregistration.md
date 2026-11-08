# Pre-registration: LIN-4369, replay arm 3, the structural arm (written before any arm-3 scoping run)

Committed and pushed with the change it tests, the control's Survey pair, the rendered scoping
prompts and the run map, before any arm-3 scoping run. Arms 1 and 2 failed
(`../_evidence-2026-11-08-lin4369-size-replay/`, `../_evidence-2026-11-08-lin4369-size-replay-arm2/`).
John's ruling on LIN-4346 (decision `lin4346-size-after-arm2`, answered 8 Nov 08:15), recorded on
LIN-4369 at 08:15:58 and confirmed by his answer of 08:18:

> One more arm, structural not wording: record is a fixed size plus one sentence why, cuts, who
> decided, so how has no room; control swapped to a ticket whose Surveys find nothing to tidy

**This is the last arm.** If it fails any criterion, the work stops, LIN-4370 stays unstarted, and
all three arms go back to John.

## What is tested: the structure

The change at the commit that adds this file, against arm 2:

- **The record is four lines and nothing else**, in order: `**Size:**` one of the sizes;
  `**Why:**` one sentence; `**Cuts:** none`, or `**Cuts:**` then one bullet per cut;
  `**Decided by:**` one of the decided-by values (`lib/size-of-move.js` `RECORD_LINES`).
- **Code holds the shape**, not only the prompt: the piece-2 guard (`checkSizeRecord`) gains
  `SIZE_RECORD_SHAPE`, which refuses any other line, a size outside the list, a why of more than
  one sentence or more than 300 characters, a cut bullet that does not quote the As-asked block
  word for word, and a missing or unknown decided-by value.
- **Scoping's prompt** prints the four lines. It drops arm 2's prose limits (under 200 words,
  not a plan, no definitions, no backticks), and says the sizes weighed and open questions go in
  the stage's comment. Arm 2's lead and its definition of when a finding binds stay. Diff
  `prompts/scoping-<n>.md` against arm 2's.
- **A cut to `## As asked`, authorized by the ruling:** LIN-4369's ask says "cuts and open
  questions live in the record". Under this shape, open questions move to the stage's comment.
  John's ruling sets the record as "a fixed size plus one sentence why, cuts, who decided".

## The control, swapped: LIN-3960

The ruling swaps the control for "a ticket whose Surveys find nothing to tidy". LIN-998 is
retired as the control: its Survey pair (run in arm 1, reused in arm 2) found the cost stance
and the twin modules in the code it touches.

**LIN-3960**, "/styleguide: the anatomy text puts an unescaped `<workspace>` in the page HTML"
(Bug, Backlog, never worked, so its description is as filed). Filed 25 Oct 15:51 UTC. Its base is
`9da9bc2ba` (`main` when it was filed, `git rev-list -1 --first-parent --before=<filed>
origin/main`). Triage's comment of 16:39 is kept as the filing comment, as LIN-998's was. Its
Survey pair was run for this arm (`control-surveys/`), at that base, with the text as filed, with
arm 1's Survey brief and render path. The prompts are byte-identical in template to arms 1 and 2.

What the Surveys find, quoted from the two comments (`control-surveys/<kind>/comment.md`):
- **survey-task**: "the fix itself is small. The difficulty is the test the ticket asks for".
  Its fix is the ask, done at the cause: "Escaping in `settingsPieceSection` fixes the whole
  class". On scope: "I wouldn't widen it to a sweep of the whole page: the other interpolations
  in the page are hard-coded token names and builder output." It names nothing to tidy beyond
  the task.
- **survey-place**: "The area is getting better." "only one string contains `<`, `>` or `&`".
  The fix reuses the existing `escapeHtml`: "Don't write a local `esc` helper; that would make a
  second copy". "Nothing needs updating in a registry or doc." Under "Better, at a cost this
  task can carry" it suggests writing the escaping rule in the pieces' comment, and "Optionally"
  a second live sample of the placeholder. Under "Better still, not this task's" it names "a
  separate sweep, not a styleguide fix" across the page renderers.

So the pair finds no existing copy, tangle or mess to tidy in the code this task touches. What
it adds is a comment beside the fix, an optional sample, and a sweep it calls not this task's.
These are recorded here, in the Surveys' words, so the judge and John can weigh them. The
control costs one Survey pair, the one the ruling allowed for.

## Inputs (otherwise as arm 2)

- LIN-4178 at `10b2c82fb` with `parent-LIN-4176.md`; LIN-4252 and LIN-4253 at `29f14bf6e`. The
  same sealed tickets and the same arm-1 Survey comments (`tickets/ticket-<n>.md` in arm 1's
  folder), unchanged.
- LIN-3960 at `9da9bc2ba`: `tickets/ticket-3960.md` (sealed description, triage's comment, and
  the two Survey comments above).
- Scoping prompts rendered from this commit under `err-larger` (`setAt`
  2026-11-07T22:18:14.300Z), arm 1's render path.
- Each run gets a fresh `git clone --local` of its base, in a run directory with an opaque name.
  The directory holds `prompt.md`, `ticket.md`, `code/`, and for LIN-4178 `parent-LIN-4176.md`.

## Runs

- 12 scoping runs, 3 per ticket, in the shuffled order of `run-map.tsv` (`b01`–`b12`). Each is a
  fresh subagent given `brief-scoping.md` (arms 1 and 2's brief, byte-identical) without its
  title line, with only its directory filled in.
- Offline, as before: no record meets the guard's 422 and gets a second try. A record is scored
  as first written, which is stricter under the new shape check.

## Pass criteria

Criterion 1 is arm 1's with the control's identifier changed from LIN-998 to LIN-3960, the only
criterion change the ruling approved. Criteria 2, 3 and 4, and the paragraphs on who judges and
what is recorded, are byte-for-byte arm 1's (`70e9ec9e`). "This commit" in criterion 2 is the
commit that adds this file, so the guard scored is the one with the shape check.

## Pass criteria (fixed here)

The replay passes only if all four hold.

1. **The control stays small.** All 3 LIN-3960 records choose "just the task", with no extra piece
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

The result is recorded as it is. There is no fourth arm: the work stops, LIN-4370 stays
unstarted, and all three arms' evidence goes to John on LIN-4346 and LIN-4369. If it passes, PR
#2356 goes on to review as usual.
