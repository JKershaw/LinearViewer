# S3 result: a count copied five ways

**Seed (Harbour):** area-1 and finding-2…27, each `in`/`to` area-1.

**Actors**
1. John (10:00): `find --to area-1 --state open --count` gave 26. Wrote task-28 with its scope stated as that query, not as 26.
2. implementation (12:00): its brief said "26 open addressed to it". It opened run-29 and ended finding-2.
3. plan-review (13:00): its brief said 25. There was no plan. Wrote verdict-30 (approve-with-notes) `on` task-28@1, with no number.
4. implementation (15:00 and 16:00): briefs said 25 and 23. run-31 ended finding-3 and finding-4. run-32 ended finding-5.
5. review (17:00): brief said 22. Re-ran the query `--as-of` 10:00, 13:00 and 17:00, which gave 26, 25 and 22. Wrote verdict-33 (request-changes), with no number.

**Answer:** No actor had to type the count. The brief computes it as-of, and `find --count --as-of` gives back any earlier figure, so no two readings disagree. Each is right at its time. A number goes stale only if an actor puts it in prose. Nothing prevents that, and nothing flags it.

**Gaps**
- Ending a finding leaves no link to the run that ended it, only prose ("fixed by run-29"). So the reviewer can't tell this task's ends apart from another task's ends.
- `links` holds one value per type, so run-31 couldn't link both of its findings.
- The brief shows only today's count. Getting the ask-time figure takes a lookup the reviewer must know to run.
- `find --area` gave 0, because findings have no paths. That is an easy wrong count.
- `to: area-1` was accepted unchecked. No actor's `find --to` surfaces those findings.
- The read log stamps the real clock, not `--as-of`.
- No breakdown actor exists, so the builds ran inside task-28, and the review verdict rests on the task.

**Refusals:** none.
