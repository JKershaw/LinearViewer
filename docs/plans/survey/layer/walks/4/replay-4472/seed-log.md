# Seed log: replay-4472 (walk 4 model)

`seed.sh` rebuilds `store.json` from empty on `../model/layer.mjs`. It is the walk 3 seed, ported. One run gives 81 records and 85 versions, with no refusals and an empty read log. It exited 0 on the first run after the port.

**Ids** (the new model allocates `<kind>-<n>` the same way, so every id matches walk 3)
- Parent LIN-4463: `task-1`.
- This task, LIN-4472: `task-28`. Its piece is `plan-10` (v2).
- Sibling LIN-4471: `task-27` (done). Its piece is `plan-9` (v2). Its change is `change-48` (merged).
- Plan review's verdicts: `verdict-24` on `plan-9@2` and `verdict-25` on `plan-10@2`.
- Areas: `area-49` is Front end: browser code, and `area-50` is Front end: server-rendered pages.
- Last write: 2026-11-13T17:22:00Z (areas, findings, lessons). The moment is still 17:22:38Z.

**Changes from the walk 3 seed**
1. Plan review's piece revisions (`plan-9` v2, `plan-10` v2) are now written `--by plan-review`, not `--by design`. Old rule 6 refused them, and the new model checks shape only.
   - The two `expect_refused` calls are removed, along with the `expect_refused` helper.
   - The sentence "Plan-review's notes; written --by design because rule 6 refused…" is cut from both reasons. The rest of each reason is unchanged.
2. `--task @@P@@` is removed from those two revises, because the new CLI's writes don't use `--task`.
3. The `on` links now name a version (`id@v`). The 15 breakdown and LIN-4471 decisions that pointed at a bare verdict now point at `verdict-24@1` or `verdict-25@1`, which was the current version at 16:05 and 16:31. The verdicts already pointed at `@2` of the pieces.
4. `node layer.mjs check` is gone, because the new CLI has no `check`. A read query (`find`, `show`) would add an entry to the store's log, so I didn't use one. In its place, a plain `node -e` reads `store.json` and prints the record count, the version count and the last `at`. The store is not touched.
5. The header comment now names walk 4.

**Looked for, nothing to change**
- No `setting` records: the walk 3 seed wrote none, so none became a `decision`.
- No `end … --to`. Both ends are `merged` and `done`, so neither needs `--into`.
- No rule-5 workaround is marked in the walk 3 seed or log. These writes are kept as walk 3 wrote them:
  - `task-1` `--by John --via driving-session`.
  - Harbour's 4 brief questions, the areas, findings and lessons.
  - The ends of `change-48` and `task-27`, both `--by Harbour`. Comment ee778c0f is the evidence for them, but the material I read doesn't say who wrote it. If the autopilot merged PR #2431, these two ends should be `--by autopilot`. Not verified.
- Every kind, field, word, time, writer, addressee and link is otherwise byte-identical to walk 3.
