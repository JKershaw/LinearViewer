# Notes: 1-survey-task (task-28)

**Written** (all in task-28, `to` implementation):
- finding-50: text slicers pinned to the IIFE indent (about plan-10@2)
- finding-51: two executing suites missing from the plan's list (about plan-10@2)
- question-52: two real duplicate helpers vs the session-fit rule against serving changes (about decision-32@1). It has options and a recommendation. I left it open for implementation to settle.
- finding-53: importWorld sets up less than loadWorld, so prefer static imports (on change-48@2)
- check-54: run the two e2e specs, or cite CI
- finding-55: minor (label-listener regex, Waiting entry tidy) (about plan-10@2)
- finding-56: first moves
- run-57: added, then ended `done`.

Nothing revised, ended or handed on. question-3 and question-6 are task-1's and are already answered by decisions.

**Looked up:**
- `show`/`get task-28`, to see the done-when.
- `find --in task-1` and `show --task task-27`, for piece 1's outcome and the change record I built on.
- question-3, question-6, decision-15 and decision-20, for the Waiting entry and the loader.
- `find --text` on each helper or suite name, to check for duplicates. There were none.

**Refusals:** none.

**What my real output relied on that neither the brief nor a query gave me:** the repo at 17faa83f4 itself. That covers:
- the line numbers and indent strings in the lin-3975 suites;
- proposal-refresh and task-run-links;
- relativeWords/relativeAgo and formatElapsed/fmtDuration, plus the lib import counts (22 and 4);
- what loadWorld provides compared with importWorld, and Node 25's navigator;
- the e2e spec names;
- the census value of 102, and the golden diff of 7 tags.

**What the brief carried that I didn't need:** task-1's full ask, decision-33 (plan-review due) and most of verdict-25's reasoning.

**Couldn't place:** the brief's part 1 shows task-28 with an empty `asked`, and it omits task-28's done-when. I only found that through `get`.
