# Layer model: build notes

`node layer.mjs <cmd> …`. The store is `store.json` beside the script, or the file named by `LAYER_STORE`. Output is JSON on stdout. Exit 0 means ok. Exit 1 is a usage error and exit 2 a refusal; both print `{"error": "<reason>"}` to stdout. Writes take `--by <actor>` and may also take `--via <name>` and `--at <time>`. Queries take `--by` (required) and `--as-of <time>`.

## Commands
- `add <kind> '<json>'`: fields plus `in`, `to` and `links`. Example: `add finding '{"in":"task-3","to":"implementation","says":"Fix y"}' --by review` returns the new version, with id `finding-<n>`.
- `revise <id> '<json>' --reason <r>`: merges fields; `null` deletes a field. `in`, `to` and `links` may also be given. Example: `revise change-6 '{"head":"def"}' --reason "new head" --by implementation`
- `end <id> <state> <reason> [--into <id>]`. Example: `end plan-4 superseded replaced --into plan-17 --by breakdown`
- `link <id> <type> <id[@v]>`: list types append and single types replace. Example: `link task-3 piece plan-4 --by breakdown`
- `brief <actor> --task <id> [--as-of t] [--text]`. Example: `brief review --task task-3 --text`
- `show --task <id>`. Example: `show --task task-3 --by review`
- `get <id>[@v]`. Example: `get change-6@1 --by review`
- `find [--kind --in --area --path --to --state --text] [--count]`. Example: `find --to review --state open --by review`

## What reads return
- `get <id>`: the current snapshot plus flags, and `versions` (every version). `get <id>@v` returns that single snapshot.
- `find`: current snapshots with flags, or `{count}`. `--in` matches only the direct `in`. `--path` matches by segment overlap against `paths` (or a run's `claims`). `--area` returns records `in` the area or whose paths overlap the area's. `--text` is a case-insensitive substring search over fields.
- `show --task`: `{task, records, overlap}`. `records` is the task and everything whose `in` chain leads to it, ended records included. `overlap` is `[{runs:[a,b], paths}]` for open runs whose claims share a path, where at least one of the two runs is in the task.
- Flags, computed at read time:
  - `stale: ["on change-6@1, now @2"]`, or `"on plan-4@1, plan-4 ended superseded into plan-17"`. Only `fields` changes count; changes to `to`, `in` or links do not.
  - `answeredBy: <decision>` on a question that a decision still standing `answers`.
- The open view for a reader is `find --to <reader> --state open`. Counts are `find … --count --as-of t`.
- Blind actors (blind-read): `find`, `show` and `brief` leave out verdicts written by anyone else, and `get` of such a verdict is refused (exit 2).
- `brief` returns `{actor, task, asOf, carries, bytes, parts}`. `carries` lists the ids in each part. `bytes` is the byte length of the `--text` rendering, and `--text` prints that rendering on its own.
  1. `task`: `{id, ref, done-when, paths, asked:[{id, asked}]}`, for this task and then each ancestor that has an `asked`.
  2. `plan`: the current `piece`, following `ended.into` past superseded plans. With no piece, every kept plan `in` the task.
  3. `addressed`: every open record falling into at least one of these groups: `to` this task; `in` the task and `to` this actor; `in` the task and `to` an actor whose run on this task has ended and who has no open run there (left behind).
  4. `stands`: decisions and verdicts that have not ended and that are `in` the task, or `about`/`on` its piece (the current or the linked plan) or a change `in` the task. Also any decision whose `scope` covers the task. Each has `restsOn` and the stale flag.
  5. `areas`: `[{id, name, open}]` for areas that are not retired and whose paths overlap the task's. `open` counts open records `to` that area.
  6. `runs`: open runs whose claims overlap the task's paths, leaving out the actor's own runs on this task.
  7. `index`: `{id, kind, to, says}` lines. These cover the other open records `in` the task (those not already in parts 3 and 6) and the lessons that hold and overlap the task's paths. `says` is the first line of the kind's first text field.
  8. `previous`: `{run, by, account}` of the latest ended run in the task by another actor, or `null`.
- Every query, `brief` included, appends `{at, by, cmd, args, asOf}` to `log`. Refused queries are not logged.

## Choices where §3–4 was silent or ambiguous
- **Ids** are `<kind>-<n>`, where `n` is the store's global `next`. This follows §3.4's example "change-5".
- **`in`** is optional on every kind; a root task or an area has none. When `in` is present it must be a task or area. I did not enforce that a run must be `in` a task or a lesson `in` an area.
- **`on` without `@v`** is pinned to the target's current version at write time. Other link types store the reference as it was given, and a `@v` must exist.
- **`asked`** cannot change at all after `add`, which includes setting it later on a child task. Every other field and `in`/`to` may be revised, even on an ended record.
- **Ending** an already-ended record is refused, because the end must start from the starting state. `--into` is allowed on any end but must resolve.
- **Verdict** must have both `of` and `outcome`, since an absent outcome is not in the set. `scope` must be a task or area id.
- **A run's actor**, for "own run" and "left behind", is the `by` of the run's first version, not its `stage` field. The verdict "own" test for blind actors also uses the first version's `by`.
- **Stale "now @v"** names the latest version that changed content, not the latest version overall.
- **as-of** takes, for each record, the highest version with `at <= t`. Writes with an earlier `--at` are not refused.
- **Brief part 4:** a scoped decision appears wherever it lives, not only when it is in an ancestor. "Its change" means any change `in` the task.
- **Brief part 3** uses the direct `in` only. Records in child tasks are not pulled up. Part 7 does the same.
- **Brief part 4** for a blind actor still shows the actor's own verdicts.
- **Errors** go to stdout as JSON so that a single stream always carries JSON.
- **The test** uses a temporary store through `LAYER_STORE`. The checked-in `store.json` stays empty.
