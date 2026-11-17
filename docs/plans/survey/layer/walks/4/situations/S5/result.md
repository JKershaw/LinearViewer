# S5 result: proposals pile with nothing declining them

Actors: `run`, `John`, `Lighthouse`. Seed: area-1.

**What each was given and did**
- Runs 14–18 Nov (tasks -3, -6, -10, -14, -18): every brief was empty except area-1 "(0 open addressed to it)". Each run did a `find --to John --state open`, added a run record and two questions to John with `if-unanswered` lapse dates; ended its run and task. Run 1 added question-4 and -5. Runs 2–5 each added one new question (-8, -12, -16, -20) and one near-repeat (-9, -13, -17, -21). Each near-repeat links `same-as` the earlier one, ended `handed-on --into` it.
- John (18 Nov): saw 6 open, wrote nothing.
- Run 6 (19 Nov, task-22): saw the same 6, withdrew -13 and -21 under their own `if-unanswered`, and added question-24.

**Answer.** The pile stops growing: 6 open before run 6, 5 after. Things end only because runs end them, by handing on near-repeats or by carrying out lapse dates they wrote themselves. Nothing declines or expires on its own. A run spots a repeat only by reading the `find` output itself. The brief never points there.

**Gaps**
- A recurring run has no home without a task: a brief on an area is refused.
- John's pile is not in a run's brief. Only an optional lookup shows it.
- There is no expired or parked end. `withdrawn` mixes "the asker took it back" with "the keeper stayed silent".
- `if-unanswered` is free text, so no deadline is checked.
- `same-as` holds one target, so the chain question-21 → -9 → -4 can only be followed hop by hop.

**Refusals in the scene:** none. (Probe: `--into` a nonexistent id, rightly refused, misleading message: `"handed-on must name the record that takes over (--into)"`.)
