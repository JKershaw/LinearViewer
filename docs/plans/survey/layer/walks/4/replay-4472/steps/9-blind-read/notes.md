# Notes: 9-blind-read (task-28)

**Written:** run-86 (run, ended `done`); verdict-87 (blind-read, `better`, on change-69@2); finding-88 (task-page.js export-block comment wrong, to close-out); finding-89 (time-words "once" over-claim vs server-only guard, to close-out, about decision-70@1); finding-90 (redundant shareTime test in summary-and-time, to close-out); finding-91 (`fmtWhen` stays in the loader, to task-1).
**Revised:** finding-73 v4 (to area-49): added session.js:257 / observation.js:517 and why adopting the leaf means converting session.js. I did not write a second finding for it.
**Ended/handed on:** none other. My read closed nothing.

**Looked up:** `show --task task-28` to see every record; `get change-69` for the head; `find --in area-49` (found finding-73 already covering the public/ copies); `find --kind area` (only area-49 exists); `find --text` for "nowhere to hide", "fmtWhen", "summary-and-time", "blind", "once" to rule out duplicates; decision-11/39 and finding-60/72 for context.

**Refusals:** none.

**Relied on outside brief/queries:** the PR diff itself at `ffa70b782` vs `5cf4f6aa2`: line numbers (task-page.js 903-904, time-words.js 10-11, session.js 257, observation.js 517), the comment wording, what `init` reads, the guard's walk roots, `fmtWhen`'s importers (~five), and that the base sha was `5cf4f6aa2` (no record holds the base).

**Brief carried but not needed:** most of part 2 (plan witnesses, review notes 2/7/8) and decisions 32-36 (breakdown and plan-review bookkeeping). Close-out F1-F3 and the two checks were only useful for avoiding duplicates.

**Couldn't place:** the areas `front-end-pages` and `runs-and-dispatch` have no records, so finding-89 went to close-out and finding-91 to task-1 instead of to those areas.
