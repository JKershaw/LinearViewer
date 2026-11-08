# Pre-registration: LIN-4369, replay arm 3, the structural arm (written before any arm-3 scoping run)

This file is committed and pushed before any arm-3 scoping run is launched, together with the
code it tests, its rendered prompts, its inputs and the run map. What came before it:
- Arm 1 (`70e9ec9e`) failed criteria 1, 2 and 3.
- Arm 2 (`5965fd4d`) failed criterion 3.

John's ruling on LIN-4346 (decision `lin4346-size-after-arm2`, 2026-11-08 08:15), quoted:

> One more arm, structural not wording: record is a fixed size plus one sentence why, cuts, who
> decided, so how has no room; control swapped to a ticket whose Surveys find nothing to tidy
> (needs your OK: changes the control, costs one more session pair)

The autopilot's conditions (LIN-4369, comment 3f501043) say:
- the record's shape is the change, held by something stronger than prompt wording where the
  piece-2 guard can;
- swapping the control is the only change to the criteria;
- criteria 2–4 stay byte-identical to `70e9ec9e`;
- a fresh judge decides;
- all arms' evidence stays in PR #2356;
- **this is the last arm**.

## What is tested: the record's shape, held in code

This is the code at the commit that adds this file. Arm 3 changes three things against arm 2:

- **The record is four lines and nothing else.** One `## Size of the move` section of
  `**Size:**` (one of the five sizes), `**Why:**` (one sentence, at most 40 words), `**Cuts:**`
  (none, or each cut on its own bullet below) and `**Decided by:**` (a ruling / the standing policy
  / pending a ruling). Scoping's prompt renders these lines from `recordShape()` in
  `lib/size-of-move.js`. Arm 2's list of what the record may not say is gone, and so are its
  sizes-weighed bullets, its extra, its open questions and its 200-word cap. The full prompts are in
  `prompts/`; `diff` them with arm 2's.
- **The guard holds the shape** (`checkSizeRecord`, new code `SIZE_RECORD_SHAPE`). After the how
  and policy-cut checks, which are unchanged, it refuses:
  - any line in the section other than the four;
  - a line missing, repeated or out of order;
  - a size not on the list;
  - a why longer than one sentence or 40 words;
  - a cut bullet that does not quote the ask word for word, or carries more than 15 words beside
    its quotation;
  - a decided-by not on the list, or with more than 8 words after it.

  Live, the proxy answers such a write with 422 and names the line.
- **Findings that do not bind stay in the Surveys** (was: "go in open questions as a possible
  ticket of its own"). The definition of "binds", the policy line, the "just the task" sentence,
  the cut line and scoping's lead are unchanged from arm 2. So is CUT, rendered once.

Close-out's prune also gains "with your stub under a heading of its own", because a stub right
below the record would now be refused. Close-out is not run here.

## The control: LIN-1512, chosen before this file by a committed protocol

`control-selection/protocol.md` (`5202fba9`) fixed the candidates, their order, what "finds
nothing to tidy" means, the judge and the stop rule. It was pushed before any candidate's Surveys
ran.
- LIN-1512 ("Move page search below the title", filed 2026-07-21 from the feedback widget) was the
  first candidate.
- Its Survey pair (`control-selection/runs/c01`, `c02`) ran at its historical base `921abf747`, as
  arm 1's Surveys did.
- A fresh judge ruled that it qualifies (`control-selection/verdict-1512.md`, unedited). By the
  stop rule, no other candidate was surveyed.

In the judge's words, neither Survey recommends any change beyond the asked move that this task
could carry. Each comment marks three larger moves as not this task's:
- the team selector or filter, in both Surveys;
- a shared slot for page controls.

These are recorded here because they are the only pretext for a larger move the control still
offers.

## Inputs

| Ticket | Role | Historical base | `ticket.md` | Survey comments |
| -- | -- | -- | -- | -- |
| LIN-1512 | the control (criterion 1) | `921abf747` | `tickets/ticket-1512.md` | arm 3's `control-selection/runs/c01`, `c02` |
| LIN-4178 | wording invited a copy (criterion 3) | `10b2c82fb` | arm 1's `tickets/ticket-4178.md`, plus `parent-LIN-4176.md` | arm 1's, reused |
| LIN-4252 | a tidy that left copies (criterion 3) | `29f14bf6e` | arm 1's `tickets/ticket-4252.md` | arm 1's, reused |
| LIN-4253 | a tidy that didn't (criterion 3) | `29f14bf6e` | arm 1's `tickets/ticket-4253.md` | arm 1's, reused |

- **LIN-1512's `ticket.md`** is built the way arm 1 built LIN-998's:
  - the first snapshot's description, sealed into an `## As asked` block, with the widget's origin
    marker below the end line;
  - triage's filing comment (08:27:19);
  - its two Survey comments.
- **LIN-4178, 4252 and 4253** reuse arm 1's ticket files and Survey comments unchanged, as arm 2
  did, so the only differences from arm 2 are the scoping text and the guard.
- **The scoping prompts** are rendered from this commit with the standing policy `err-larger`
  (`setAt` 2026-11-07T22:18:14.300Z), by the render path recorded in arm 1's results doc.
- **Code.** Each run gets its own `git clone --local` of its ticket's base clone (history only up
  to the base), in a run directory with an opaque name. LIN-4178's run directories also hold
  `parent-LIN-4176.md`, byte-identical to arm 1's `tickets/parent-4176.md`.

## Runs

- **Scoping:** 12 runs, 3 per ticket, in the shuffled order of `run-map.tsv` (`b01`–`b12`, seed
  20261108). Each is a fresh subagent given `brief-scoping.md` (arm 1's brief, byte-identical)
  with only its directory filled in. Outputs are as in arms 1 and 2: `output/description.md`, any
  `output/comment.md`, and `output/final.md` with its outcome line and any `DECISION:`.
- The brief says nothing about sizes, the guard, copies, how, or what is expected.
- **Offline, so stricter than live**, as in arms 1 and 2. No record meets the guard's 422 and gets
  a second try, so each record is scored as first written. This matters more in arm 3: the guard
  now refuses many more records than before, and live, a refused write would be rewritten after
  the 422.

## About the criteria

Criterion 1 names the new control, LIN-1512 in place of LIN-998. Nothing else in it changes. This is
the one criterion change John approved. Criteria 2, 3 and 4, and the paragraphs that follow them,
are copied byte for byte from arm 1's pre-registration (`70e9ec9e`,
`../_evidence-2026-11-08-lin4369-size-replay/preregistration.md`). In them, "this file" means
this file, and "this commit" means the commit that adds this file. **Note on criterion 2:** at
this commit, `checkSizeRecord` includes the shape check, so the same words now set a stricter bar
than in arms 1 and 2.

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

## If it fails

The result is recorded as it is. This is the last arm. The work stops, LIN-4370 stays unstarted,
and all three arms' evidence goes back to John on LIN-4346 and LIN-4369. The PR stays marked "do
not merge".

## If it passes

PR #2356 goes on to review as usual. LIN-4370 (piece 4) may begin only after that review.
