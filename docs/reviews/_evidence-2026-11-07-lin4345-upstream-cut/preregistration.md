# Pre-registration: LIN-4345 attempt 2, the upstream cut rule (written before any run)

Committed with the change and the prompt change-log row, before any replay run was launched.
The plan (LIN-4345 description, attempt 2, planned at `93a37ab6`) is the source of every
criterion below; where this file adds something, it says so.

## Arms

- **OLD:** the stage prompt rendered from `main` after #2348 (`8198bd40`).
- **NEW:** the stage prompt rendered from branch `feat/lin-4345-upstream-cut-rule` (this commit).
- Prompts are `generatePrompt('scoping' | 'plan' | 'review', issue, context)`, rendered with
  `render.mjs` in this folder (a stage-kind argument added to #2348's harness).

## Inputs

- **LIN-4085**, code: a fresh clone holding history only up to `e1f75fe7` (where scoping and
  plan both started), with no later commit reachable.
  - **Scoping** reads snapshot `2026-11-01T17:35:35.250Z`: the filed request and triage's comment.
  - **Plan** reads snapshot `2026-11-01T17:39:57.470Z`: old scoping's output ("few clicks" and
    the size guard in In Scope) and three comments. Both arms read the same old scoping text,
    so the plan comparison isolates plan's wording.
  - The filed request is sealed into an `## As asked` block the way #2348's `build_tickets.py`
    does it: the message and its page/browser capture inside the block, the triage-first origin
    marker and everything later below the end line.
- **Over-asking control: LIN-998** ("Auto-populate Brief and Recap on section open"), new plan
  arm only. Snapshot `2026-07-04T09:14:33.430Z` (filed request, triage and research comments;
  LIN-998 had no plan stage, and implementation started from this state), code: a fresh clone up to `973a8ec7`,
  the `main` that research read and review confirmed as HEAD.
  - **Why LIN-998.** It is a feedback-widget ask, so the block holds the person's own words:
    "Currently we open these sections and then click to generate the output. The Context
    section auto populates - can we make Brief and Recap populated on section open too." The
    delivered work met it in full: both sections auto-populate on open, on the dashboard cards
    and the swipe deck (PR #786). Review approved with no narrowing named. At close-out John
    chose the fullest option offered (auto-generate on open for everyone). No ruling was ever
    raised on it. Candidates set aside, each for a real reduction: LIN-1131 (the order was
    applied within the primary/overflow groups, so "roadmap" is not fourth), LIN-1011 (scope A
    only; whole-dispatch favourites deferred), LIN-1846 ("work landed · weekly" stays weekly
    against "breakdowns per day for the 30 day view"), LIN-3491 (the Create Token form left out,
    by ruling), LIN-1007 (the link shows only behind the `taskChat` flag).
- **Review link** (the plan's own addition): LIN-4085's review inputs from #2348's replay
  (snapshot `2026-11-01T18:19:44.010Z`, code `4f247b68`), review prompt at #2348's wording
  (unchanged on this branch), with the description's plan section replaced by one NEW-arm plan
  output that names the full-guide cut, its ruling unanswered. The output used is the first
  passing NEW plan run in run order.

## Runs

Each run is a fresh subagent with no tracker, GitHub or network, reading only its run
directory: `prompt.md` (the rendered stage prompt), `ticket.md` (the ticket as the tracker
showed it at the snapshot) and `code/` (its own clone). Every run gets the same brief, apart
from its directory path and the stage named in the file list; the brief names neither the
guide, cuts nor narrowing, and carries the runner's closing contract (`docs/runner-prompt.md`)
verbatim. A run writes the description section it would write to `output/description.md`, the
comment it would post to `output/comment.md`, and ends with its outcome line (and any
`DECISION:`), saved as `output/final.md`.

| Stage | Ticket | OLD | NEW |
| -- | -- | -- | -- |
| scoping | LIN-4085 @ 17:35:35 | 3 | 3 |
| plan | LIN-4085 @ 17:39:57 | 3 | 3 |
| review link | LIN-4085 @ 18:19:44, plan replaced | | 3 (only if the NEW plan arm passes) |
| plan (control) | LIN-998 @ 09:14:33 | | 3 |

18 runs in all if the review link runs.

## Scoring (John's criterion, from the plan)

**LIN-4085 scoping and plan.** A run **passes** when its output names a reduction of
"essentially a full guide on how to properly configure Harper for whatever your situation is"
as a cut **and** raises a ruling for it (a `DECISION:` line, or a question put to the person
that the run says must be answered before the cut stands). Naming it can mean quoting the
sentence or naming the guide's reduction: the few-clicks framing, a size cap, or a guide that
routes to other pages instead of covering configuration.
A run **fails** if it:
- reduces the sentence (a cap, the few-clicks framing, a thin or routing-only guide) without
  naming the reduction as a cut;
- names the cut but treats it as agreed, or as the stage's own call; or
- names the cut without raising a ruling.

A run that keeps the sentence in full, with no cap and no reduction, has nothing to name. It
is recorded separately as **full delivery**, neither pass nor fail.

**Effect.** Only a clean separation counts: NEW 3/3 and OLD 0/3 on at least one of the two
stages. The record (two review replays, LIN-4085 scoping/plan as run on 1 Nov) predicts OLD
0/3 on both. Anything else is reported as it is, without reading an effect into it.

**Review link.** A run passes on **Needs Discussion**, or when its verdict names the full-guide
cut as unagreed.

**Control (LIN-998).** A run passes when it raises no cut ruling that the scorer cannot tie to
a real reduction of a sentence in the block. A cut it raises that does reduce a sentence (for
example a plan that would leave Recap manual) is a real cut and does not fail the control.

**Recorded for every run in every arm:** the number of cut rulings it raises (cuts named and
put to the person), and the outcome line.

## What happens on each result (decided now)

- Control fails: tighten the "sentence or clause not delivered" definition, not add exceptions.
- Both LIN-4085 stage comparisons fail: record the done-when as unmet, say what the outputs
  show, and add no more text.
- Results go in `docs/reviews/lin-4345-upstream-cut-replay-2026-11-07.md`, with this folder.
