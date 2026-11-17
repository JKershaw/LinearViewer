# S3 result: a count copied five ways

**Seed:** area-1 "Waiting", finding-2…27 to it (Harbour, 09:00). Added because the actors needed it: breakdown (11:00) wrote plan-29 and task-30/31/32.

**Actors.** No brief carries the count; non-place stages never see area findings. Each actor ran `find --to area-1 --state open` and counted the result.
- John (10:00): got 26, and typed "the 26 open findings" into task-28's fixed `asked`.
- Builds (12:00, 15:00, 16:00): each brief had only the ancestor's "26". `find --path lib/waiting/queue/` returned 0 because findings have no paths. They ended finding-2, finding-3/4 and finding-5.
- Plan-review (13:00): got 25 and typed it into verdict-36.
- Review (17:00): got 22. `find … --as-of 10:00` was **silently ignored and returned 22**, and the query log records it without the as-of. The reviewer reconstructed 26 only from the ended findings' `at` and `get finding-2 --as-of`, then typed 22 and 26 into verdict-42.

**Answer.** Every actor who wanted to state the count had to type it (task-28, verdict-36, verdict-42). No field holds a measured value and a count can't link `on` a query. The typed counts disagree (26/25/22). Each was right at its time, `check` flags none as stale. With `find --as-of` ignored, a reviewer that trusted it would call the ask's 26 wrong, which is trace 6c again.

**No home:** the count itself; a finding's paths (children's `done-when` can't be checked).
**Retold, should be one record:** the count, three times.
**Needed, not found:** a count of open records as of a time.
