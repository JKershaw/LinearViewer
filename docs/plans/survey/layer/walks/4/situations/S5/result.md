# S5 result: proposals pile with nothing declining them

Actors (`model/actors.json`): `run`, `John`, `Lighthouse`. Seed: area-1 by Lighthouse.

**What each was given and did**
- Runs 14–18 Nov: Lighthouse added each day's task (task-3, -6, -10, -14, -18). Every brief was empty apart from area-1 "(0 open addressed to it)". Each run looked up `find --to John --state open`, added a run record and two questions to John, each with an `if-unanswered` lapse date. Run 1 added question-4 and -5. Runs 2–5 each added one new question (-8, -12, -16, -20) and one near-repeat (-9, -13, -17, -21). Each near-repeat carries `same-as` to the earlier question, which was ended `handed-on --into` it and keeps that question's date. Each run ended its run record and task done.
- John, 18 Nov: was shown 6 open questions and wrote nothing.
- Run 6, 19 Nov (task-22): was shown the same 6. It withdrew -13 and -21 under their own `if-unanswered`, and added question-24.

**Answer.** The pile stops growing: 6 open before run 6, 5 after, 11 written in all. Things end only because the runs end them, by handing on a near-repeat or by carrying out a lapse date they set themselves. The store does not decline or expire anything. A run sees a near-repeat as a repeat only by reading the `find` output itself. The brief never points to that list, and the store does not detect near-repeats (`--text` is a substring match).

**Gaps**
- A recurring run has no home without a task: a brief on an area is refused, so Lighthouse had to add one task per day.
- John's pile is not in a run's brief. Only a lookup the run chooses to make shows it.
- There is no "expired" or "parked" end. `withdrawn` mixes up "the asker took it back" with "the keeper stayed silent".
- `if-unanswered` is free text, so no deadline is checked.
- `same-as` holds one target. question-21 → -9 → -4 is reachable only hop by hop.

**Refusals in the scene:** none.
Probe, outside the scene: `end … handed-on --into <nonexistent id>` gave `"handed-on must name the record that takes over (--into)"`. That is right to refuse, but the message is misleading.
