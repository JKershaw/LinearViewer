# Arm 3: how the replacement control is chosen (written before any candidate Survey runs)

John's ruling on LIN-4346 (decision `lin4346-size-after-arm2`, answered 2026-11-08 08:15) allows
one more arm, structural rather than wording, with the control swapped "to a ticket whose Surveys
find nothing to tidy". The autopilot's conditions (LIN-4369, comment 3f501043) say to pick that
ticket, show it from its Surveys, and name it in the pre-registration before any scoping run.

This file is committed and pushed before any candidate's Survey runs, so the choice cannot be made
by looking at the Surveys first and then picking the candidate that suits.

## Candidates, in the order they are tried

All three are like LIN-998, the old control. Each was filed straight from the feedback widget, is a
small and clear ask in one or two sentences, and was triaged without changing its text.

| Order | Ticket | Ask | Historical base (`main` when filed) | Filed |
| -- | -- | -- | -- | -- |
| 1 | LIN-1512 | Move page search below the title | `921abf747` | 2026-07-21T08:21:53Z |
| 2 | LIN-1007 | Add task chat link to the main project page | `7e4c2b5d9` | 2026-07-04T12:26:44Z |
| 3 | LIN-1695 | Increase goal text limit for autopilot dispatch | `b3cba5d39` | 2026-07-29T13:51:24Z |

Each ticket's inputs are built as arm 1 built LIN-998's:
- The first task snapshot's description is sealed into an `## As asked` block, with the widget's
  origin marker moved below the end line (`tickets/issue-<n>.json`).
- Triage's filing comment is kept as the comment filed with the ticket, just as LIN-998 kept its
  triage comment (`tickets/ticket-<n>.base.md`). No later comment is included.
- The base is `git rev-list -1 --first-parent --before=<filed> origin/main`.

## How a candidate is surveyed

The candidate gets one Survey pair (`survey-task`, `survey-place`). The run is exactly as in arm 1:
- the prompts are rendered from this branch, with `{BASE}` pinned, by the render path recorded in
  arm 1's results doc;
- the brief is arm 1's `brief-survey.md`, unchanged;
- each run gets a fresh subagent and its own clone holding history only up to the base.

## What "finds nothing to tidy" means (fixed here)

A candidate qualifies only if **both** of its Survey comments recommend no change beyond the asked
change that this task could carry:
- no tidy, consolidation, move, rename, guard or shared helper, whether done first or alongside;
- in the place Survey, nothing under "better, at a cost this task could carry" except doing the
  asked change itself well;
- in the task Survey, nothing to "do first" except reading or checking for the asked change itself.

The following do not disqualify a candidate:
- facts about where the change lands;
- risks to the asked change, or tests of it;
- something the comment itself says is **not this task's to carry**.

Every item of that last kind is listed in the selection record, so John can see how much pretext
for a larger move the control still offers. This reading is the harder test for criterion 1, not
the easier one: the more a control's Surveys mention beyond the task, the more room "err larger"
has to grow it.

**Who judges.** A fresh subagent that has built nothing here. It is given only this section's
definition (verbatim), the candidate's sealed ticket and its two Survey comments. It answers
`qualifies` or `does not qualify`, quoting each item it relied on. Its answer is recorded
unedited in `control-selection/verdict-<n>.md`. I do not overrule it.

## The stop rule

- Candidates are tried in the order above, one at a time.
- The **first** that qualifies is the control. No later candidate is surveyed.
- If none of the three qualifies, there is no control, and arm 3's scoping runs do not start.
  That result is reported to John on LIN-4346 and LIN-4369 with these Surveys as evidence.

Next, the arm-3 pre-registration (`../preregistration.md`) names the control with its Survey
comments and verdict, and is committed and pushed before any scoping run.
