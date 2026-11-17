# Seed log: LIN-4455 before 2026-11-13T14:58:27Z (walk 4 model)

`seed.sh` rebuilds `store.json` from empty on the walk 4 model. It ran clean on the first try: exit 0, 65 records, 68 versions, an empty query log. The last write is `end task-59 done` by Harbour at 2026-11-13T14:56:00Z. The content (kinds, fields, words, times, writers, addressees, links and ends) is the walk 3 seed's, except for the changes listed below.

**Ids** (the same as in walk 3: this model also numbers ids `kind-N` from one shared counter)
- Area Runs & dispatch: `area-1`. Lessons `lesson-2`…`lesson-17`. Waiting 1–21: `finding-18`…`finding-38`.
- Waiting 2: `finding-19`. Waiting 4: `finding-21`. Waiting 11: `finding-28`.
- Parent LIN-4447: `task-39`. Pieces 0–8: `plan-40`…`plan-48`.
- This task LIN-4455: `task-60`. Its piece, piece 5: `plan-45`.
- Sibling LIN-4453: `task-59` (ended done). Its piece, piece 0: `plan-40`.
- The round 1 request-changes verdict: `verdict-49`, on `plan-41@1`. It is stale because piece 1 was revised.
- The round 2 approve verdicts: `verdict-50`…`verdict-58`. The one on piece 5 is `verdict-55`.
- Breakdown decisions in LIN-4455: `decision-61`…`decision-65`, each on `verdict-55@1`.

**Changes from the walk 3 seed**
1. The parent's `paths` revise (13:40Z) is now written `--by design`. Walk 3 wrote it `--by Harbour --via design` because rule 6 refused it. The workaround comment, including the refused command line with its `--task`, is gone. `task-39` v2 now has `by: design` and no `via`.
2. Every `on` link names a version (`id@v`), the one current when the link was written:
   - Round 1 verdict: `plan-41@1`, written before piece 1's revise.
   - Round 2 verdict on piece 1: `plan-41@2`, written after it.
   - The other round 2 verdicts: `@1`.
   - The five decisions: `verdict-55@1`.
3. The final `node layer.mjs check` call is gone, because the new model has no `check` command and a query would add an entry to the store's log. In its place, the script counts the records by reading the file directly.
4. The header comment now names walks/4.

**Asked for but not present in this seed**
- The walk 3 seed has no `setting` record, no `end … --to`, no `--task` on any live write, and no rule 5 workaround. Its only workaround was the rule 6 one above. Nothing needed changing for these.
- No write was refused, so no other fix was needed.
