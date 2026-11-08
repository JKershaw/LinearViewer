# Scoping writes the size record, replay arm 4 (8 November 2026)

Arm 3 (`lin-4369-size-replay-arm3-2026-11-08.md`) failed only criterion 2. Its guard refused 10 of
12 records as first written. Eight of those refusals were a why that is one sentence joined by a
semicolon, which the guard counted as a sentence break although the prompt never said so. Arm 3's
reader also found the how had moved into scoping's comments.

John's ruling on LIN-4369 (decision `lin4369-after-arm3`, 09:58) chose: "One more arm: guard
accepts a semicolon-joined sentence and the prompt says so; scoping writes the record and no
comment".

This is evidence for review, not a CI result. The commits went in this order:
- `b1416f87`: the code.
- `18dc80e0`: the pre-registration, pushed before any arm-4 scoping run.
- `03cd671f`: run outputs, guard results and the comment check, pushed before the judge's verdict.

## Result: arm 4 passes every pre-registered condition

| Condition | Arm 1 | Arm 2 | Arm 3 | **Arm 4** | Judged by |
| -- | -- | -- | -- | -- | -- |
| 1. The control stays "just the task", 3/3 (arms 1–2: LIN-998; arms 3–4: LIN-1512) | fail, 0/3 | pass, 3/3 | pass, 3/3 | **pass, 3/3** | fresh reader |
| 2. Every record passes the piece-2 guard | fail, 5/12 | pass, 12/12 | fail, 2/12 | **pass, 12/12** | code |
| 3. No record tells the builder how (LIN-4178, 4252, 4253) | fail, 2/9 | fail, 5/9 | pass, 9/9 | **pass, 9/9** | fresh reader |
| 4. Every size that cuts the ask raises a `DECISION:` | pass, 6/6 | pass, vacuously | pass, vacuously | **pass, vacuously** | fresh reader |
| 5. Scoping writes no comment (arm 4 only) | n/a | n/a | n/a | **pass, 12/12** | code |

By the pre-registration, PR #2356 now goes to normal review. LIN-4370 (piece 4) may begin only
after that review.

## Per run

| Run | Ticket | Size | Decided by | Guard | Comment | Reader, crit. 3 |
| -- | -- | -- | -- | -- | -- | -- |
| d05 | LIN-1512 | just the task | policy | pass | none | n/a (control: pass) |
| d11 | LIN-1512 | just the task | policy | pass | none | n/a (control: pass, borderline) |
| d12 | LIN-1512 | just the task | policy | pass | none | n/a (control: pass) |
| d01 | LIN-4178 | a small tidy | policy | pass | none | pass |
| d07 | LIN-4178 | a small tidy | policy | pass | none | pass (borderline) |
| d09 | LIN-4178 | a small tidy | policy | pass | none | pass |
| d02 | LIN-4252 | just the task | policy | pass | none | pass (borderline) |
| d03 | LIN-4252 | just the task | policy | pass | none | pass (borderline) |
| d10 | LIN-4252 | just the task | policy | pass | none | pass (borderline) |
| d04 | LIN-4253 | just the task | policy | pass | none | pass |
| d06 | LIN-4253 | just the task | policy | pass | none | pass |
| d08 | LIN-4253 | just the task | policy | pass | none | pass |

`guard-results.tsv` has the details. No run raised a `DECISION:`, none named a cut, and every clone
was clean afterwards.

## What the outputs show, including what a reviewer should weigh

- **The record holds.** Every record is four lines with a single-sentence why, and none carries
  how in a form the reader counts.
  - "Err larger" enlarges only LIN-4178, to "a small tidy" 3/3. The runs found that the shared cost
    read misses the row shapes production sends.
  - The control and the two tidies stay "just the task" 9/9.
  - Sizes agree across all three runs on every ticket, which did not happen in arms 1–3.
- **The passes rest on borderline calls the reader names.**
  - **Criterion 1:** d11 mentions two nearby moves, only to say "the move works without" them. A
    stricter reading of "no extra piece of work named" fails d11.
  - **Criterion 3:** the reader counts only code-shaped wording or detail beyond the ask. Under that
    reading, d02, d03 and d10 ("parses, serializes and repaints") and d07 ("public projection,
    run-page loops") are borderline. If any one-line summary a builder could paste as a header
    counts, those records fail.
- **The how moved again, into the final message.** No run wrote a comment. But the reader's
  recorded check-5 report finds that all 12 final messages tell the builder how, usually many times
  over: element ids, file paths, test rules ready to copy, and line numbers.
  - In this replay, final messages are not posted on the ticket.
  - Live, a run's final message is its `[done]` report: it reaches the run page and whatever is
    woken by it, though not the ticket's description.
  - Whether a builder reads that report is a question for piece 4 (LIN-4370), which decides how
    scoping is run, and for review.
  - In every arm, closing one channel has moved the how to the next one: done-means sections,
    then definitions, then the comment, now the final message. The record itself is now clean.
- **Criterion 4 is still unexercised.** No run named a cut in arms 2, 3 or 4, so the `DECISION:`
  path is tested only by arm 1 and the unit tests.

## The fresh reader's verdict

A subagent started after every run had finished. It was given a folder holding only:
- the criteria, verbatim;
- the run map;
- the tickets with their Survey comments, plus LIN-4176's description;
- each run's `description.md` and `final.md` (no run wrote a `comment.md`).

It judged criteria 1, 3 and 4 and wrote the check-5 report. Its verdict is unedited in
`_evidence-2026-11-08-lin4369-size-replay-arm4/reader-verdict.md`:

> Criterion 1: PASS
> Criterion 3: PASS
> Criterion 4: PASS

## Limits

- **n = 3 per ticket across four arms.** Each arm changed the scoping text, and arms 3 and 4
  changed the guard. Arm 4 differs from arm 3 only in the semicolon rule and the no-comment
  sentence.
- **Offline, so stricter than live on criterion 2.** Arm 4 passed it as first written.
- **The readers are subagents of the session that ran the arm.** They saw only their folders. They
  are not independent people.
- **All runs were Claude Code subagents on Opus 5.5.**
- **Inputs were reused.** LIN-4178, 4252 and 4253 reuse arm 1's Survey comments, and LIN-1512
  reuses arm 3's.

## Setup and commands

As in arm 3 (see its results doc), with these differences:
- prompts rendered from `18dc80e0`;
- runs `d01`–`d12` in the order of `run-map.tsv` (seed 20261109);
- the guard is `lib/size-of-move.js` at `18dc80e0`;
- check 5 is `[ -f comment.md ] && [ -n "$(tr -d '[:space:]' < comment.md)" ]` per run, recorded
  in the `comment` column of `guard-results.tsv`.

No runnable script is committed under `docs/reviews`.
