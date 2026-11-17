# Seed log: replay-4450 (walk 4)

The store before 2026-11-13T13:44:54Z, on the walk 4 model. `bash seed.sh` runs from empty and exits 0: 65 records, 68 versions, no refusals. A `find` on a scratch copy shows nothing stale. The last write is at **2026-11-13T13:44:23.511Z** (decision-65).

**Ids** (the same as walk 3): parent LIN-4445 `task-53`. LIN-4450 `task-60`, piece `plan-54`. LIN-4451 `task-61` / `plan-55`. LIN-4452 `task-62` / `plan-56`. Areas: `providers` `area-1`, `llm-and-prompts` `area-2` (17 lessons, 26 findings), `other-features` `area-46` (1 lesson, 5 findings). Verdicts `verdict-57/58/59`, on `plan-54@2`, `plan-55@2` and `plan-56@2`. Breakdown decisions `decision-63/64/65`, on `verdict-57@1`, `verdict-58@1` and `verdict-59@1`.

Every record's kind, fields, words, times, writers, addressees, links and ends match the walk 3 seed, apart from the changes below.

## Changes from the walk 3 seed

1. **Plan-review's revisions are written by their real writer.** The three piece revisions (plan-54/55/56 v2, at 13:40:55.240–.242Z) were `--by Harbour --via plan-review`, a workaround for rule 6. They are now `--by plan-review` with no `via`. Their `--reason` loses the appended "(rule 6 refuses …; written by Harbour via plan-review.)", so it is the reason plan-review gave.
2. **The refused attempts are gone.** I removed the three `try revise … --by plan-review` calls, their "refused by rule 6" and "nearest acceptable" comments, and the `try()` helper. The header comment now says the seed is ported to walk 4.
3. **`--task` is removed.** It was on the revisions above, the only writes that carried it.
4. **`on` names a version.** The breakdown decisions' `on` changed from `verdict-N` to `verdict-N@1`, the version current at 13:44:23Z. The verdicts' `on` already named `@2`. `about` and `piece` links are left bare, which the model allows.
5. **`end --into`: no change needed.** The seed has no `end` writes.
6. **The final `check` is replaced.** The new model has no `check` command, so the call exits 1 with a usage error. A layer query is not a faithful stand-in, because queries append to the store's `log`. The seed now prints counts and the last write time with a read-only `node -e` that reads `store.json`.

## Notes

- No other write was refused. `layer.mjs` does check `--by` against `actors.json`, although BUILD-NOTES says "the store never refuses on who". Every writer here is declared, and `driving-session` is a `via` on John's write, so the check passes.
- I diffed the result against the `store.json` that was in this folder beforehand. That file was a partial run of the unported seed on the new model: it stopped at the first decision and had a stray v3 on each piece. Apart from those two things, every shared record is field-for-field identical.
- Carried over from walk 3: the done-when and paths of LIN-4451 and LIN-4452 come from the parent's plan. The Size record, the Surveys, the Design choice and the runs are still not written.
