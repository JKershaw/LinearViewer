# Scoping writes the size record, replay arm 3, the structural arm (8 November 2026)

Arm 1 (`lin-4369-size-replay-2026-11-08.md`) failed criteria 1, 2 and 3. Arm 2
(`lin-4369-size-replay-arm2-2026-11-08.md`) failed criterion 3.

John's ruling on LIN-4346 (decision `lin4346-size-after-arm2`) allowed one more arm, "structural
not wording". The record becomes a fixed size, one sentence of why, its cuts and who decided, and
the control becomes a ticket whose Surveys find nothing to tidy. **It is the last arm.**

This is evidence for review, not a CI result. It was committed and pushed in this order:
- `5202fba9`: the control-selection protocol, before any candidate Survey;
- `96ad5a3c`: the control's Surveys and its qualification verdict;
- `f3df8d60`: the code;
- `f4547e84`: the pre-registration, before any scoping run;
- `89a295b8`: the run outputs and guard results, before the judge's verdict.

## Result: arm 3 fails criterion 2, so the replay fails and the work stops here

| Criterion | Arm 1 | Arm 2 | **Arm 3** | Judged by |
| -- | -- | -- | -- | -- |
| 1. The control stays small, 3 of 3 "just the task" (arms 1–2: LIN-998; arm 3: LIN-1512) | fail, 0 of 3 | pass, 3 of 3 | **pass, 3 of 3** | fresh reader |
| 2. Every record passes the piece-2 guard | fail, 5 of 12 | pass, 12 of 12 | **fail, 2 of 12** | code (`checkSizeRecord`, which now holds the shape) |
| 3. No record tells the builder how (LIN-4178, 4252, 4253) | fail, 2 of 9 clean | fail, 5 of 9 clean | **pass, 9 of 9 clean** (one close call, b04) | fresh reader |
| 4. Every size that cuts the ask raises a `DECISION:` | pass, 6 of 6 | pass, vacuously | **pass, vacuously**: no record named a cut | fresh reader |

The record's shape did what it was built for: for the first time, no record carries how (criterion
3). But the guard that holds the shape refused 10 of the 12 records as first written, and
criterion 2 requires every record to pass. By the ruling this is the last arm. Piece 4 (LIN-4370)
does not begin, and all three arms' evidence goes back to John.

## Per run

| Run | Ticket | Size | Decided by | Guard (first write) | `DECISION:` | Reader, crit. 3 |
| -- | -- | -- | -- | -- | -- | -- |
| b01 | LIN-1512 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | n/a (control: pass) |
| b02 | LIN-1512 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | n/a (control: pass) |
| b06 | LIN-1512 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | n/a (control: pass) |
| b09 | LIN-4178 | consolidate | policy | **refused**, why-too-long (41 words) | no (no cut) | pass |
| b10 | LIN-4178 | consolidate | policy | pass | no (no cut) | pass (borderline) |
| b12 | LIN-4178 | a small tidy | policy | pass | no (no cut) | pass |
| b07 | LIN-4252 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | pass |
| b08 | LIN-4252 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | pass (borderline) |
| b11 | LIN-4252 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | pass |
| b03 | LIN-4253 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | pass |
| b04 | LIN-4253 | just the task | policy | **refused**, why-sentences (two sentences) | no (no cut) | pass (the close call) |
| b05 | LIN-4253 | just the task | policy | **refused**, why-sentences (a semicolon) | no (no cut) | pass |

`guard-results.tsv` has each refusal's kind and line. Every record reads back through
`readSizeRecord` with a size and a decided-by, and every record has exactly the four lines: no
record failed on an extra line, a missing line, a size off the list, a cut or a decided-by.

## What the outputs show

- **The criterion-2 failure is mostly the semicolon rule, and that rule is my design error.**
  - Eight of the ten refusals have a why that is one grammatical sentence joined by a semicolon,
    under 40 words.
  - The guard counts `;` as a sentence break, but the prompt says only "one sentence" and never
    says a semicolon counts.
  - The other two are real: b04 writes two sentences, and b09 writes 41 words with a semicolon.
  - Live, each refusal would get a 422 naming the line and could be rewritten. Offline, as
    pre-registered, each is scored as first written.
  - This is recorded, not re-scored. Under the pre-registration a guard or prompt changed after
    seeing these outputs would be a new arm, and the ruling allows none.
- **The shape removed the how from the record.** All nine criterion-3 records describe the result
  in plain words. None names a file, an identifier or a list of places, and none writes a
  definition the builder could copy, which arm 2's LIN-4253 runs did 3 of 3.
  - The reader's close call is b04: "whether it runs under the read-only dispatch mandate", a
    scope definition that its comment wants put in a docstring. "A stricter reader would fail b04,
    and that alone would fail the criterion."
- **The how moved into the comments.** The reader's unscored answer: almost every run's
  `comment.md`, and several final messages, tell the builder how. They name line numbers,
  functions and files to update, and say what a header or docstring should say. For example:
  - b08: "`slot.outerHTML =` repaints at lines 1095, 1120, 1149, 1997 and 2009";
  - b11: "the new fake's header should say it's the one to use for new client tests".

  Criterion 3 scores only the record. On the real trail a builder reads the comment too, so the
  hand-off still says how. It just no longer says it in the record.
- **The control stays small.** All three LIN-1512 runs chose "just the task" with no extra.
  - All three rejected triage's panel-only suggestion: the reporter's "search" is the toggle, so
    moving only the panel would be a cut.
  - The policy enlarges only LIN-4178: consolidate twice and a small tidy once. That rests, as in
    arm 2, on each run finding that the shared cost read prices nothing on the row shapes
    production sends.
  - LIN-4252 and LIN-4253 stay "just the task" 6 of 6.
- **No run named a cut**, so the `DECISION:` path was not exercised in arm 2 or arm 3.

## The control and how it was chosen

`_evidence-2026-11-08-lin4369-size-replay-arm3/control-selection/` holds the protocol, the
candidate inputs, the Survey prompts, the two Survey comments and the qualification verdict.
- The protocol (`5202fba9`) was pushed before any candidate's Surveys ran. It fixed three
  candidates in order, all small feedback-widget tickets like LIN-998: LIN-1512, LIN-1007,
  LIN-1695. It also fixed what "finds nothing to tidy" means, the judge and the stop rule.
- LIN-1512 qualified first: "neither Survey recommends a tidy, consolidation, rename, shared
  helper or other change beyond the asked change that this task could carry". No later candidate
  was surveyed.
- The only larger moves its Surveys mention are ones they mark as not this task's: the team
  selector, and a shared slot for page controls.

## The fresh reader's verdict

A subagent started after every run had finished. It was given a folder holding only:
- the criteria, verbatim;
- the run map;
- the tickets with their Survey comments, and LIN-4176's description;
- each run's `description.md`, `final.md` and `comment.md`.

It was told nothing about how the template or the guard was written, and it judged criteria 1, 3
and 4. Arms 1 and 2's readers did not see `comment.md`; this reader did, to answer the unscored
question above. Its verdict is unedited in `_evidence-2026-11-08-lin4369-size-replay-arm3/reader-verdict.md`:

> Criterion 1: PASS
> Criterion 3: PASS
> Criterion 4: PASS

## Limits

- **n = 3 per ticket, three arms.** Each arm changed the scoping text (and in arm 3 the guard),
  and arm 3 changed the control. This is direction, not effect size.
- **Offline, so stricter than live on criterion 2**, as in arms 1 and 2. In arm 3 this decides
  the result, because the shape guard refuses far more than the how guard did. How runs rewrite
  after a 422 is not measured.
- **The readers are subagents of the session that ran arm 3.** They had none of the build's
  context, only their folders, and are not independent people. The qualification judge and the
  replay judge were separate subagents.
- **All runs were Claude Code subagents on Opus 5.5.**
- **LIN-4178, 4252 and 4253 reuse arm 1's Survey comments.** LIN-1512's Surveys ran once.

## Setup and commands

As in arm 1 (see its results doc for the snapshot, base-clone, render and guard commands), with
these differences:
- **Control inputs.** `GET /issues/LIN-<n>/snapshots` and `GET /issues/LIN-<n>`. The first
  snapshot's description is sealed into an `## As asked` block with the widget's origin marker
  moved below the end line. Triage's filing comment is kept, and the base is
  `git rev-list -1 --first-parent --before=<createdAt> origin/main`. Result:
  `control-selection/tickets/`.
- **Control Surveys.** `node render.mjs <repo at 5202fba9> control-selection/tickets/issue-1512.json
  survey-task|survey-place <out>` with `{BASE}` pinned to `921abf747`. Each ran as a fresh
  subagent given arm 1's `brief-survey.md` (runs `c01`, `c02`).
- **Prompts.** `node render.mjs <repo at f4547e84> <issue.json> scoping prompts/scoping-<n>.md`.
  `diff` them against arm 2's prompts to see exactly what changed.
- **Runs.** 12 scored runs, `b01`–`b12`, in the order of `run-map.tsv` (seed 20261108). Each was a
  fresh subagent given arm 1's `brief-scoping.md` without its title line, with only its directory
  filled in. Each directory held `prompt.md`, `ticket.md`, `parent-LIN-4176.md` for LIN-4178, and
  `code/`, a `git clone --local` of the base clone. Every clone was clean afterwards.
- **Guard** (criterion 2): arm 1's `guard.mjs` against `lib/size-of-move.js` at `f4547e84`,
  which includes `SIZE_RECORD_SHAPE`. Output: `guard-results.tsv`.

No runnable script is committed under `docs/reviews`.
