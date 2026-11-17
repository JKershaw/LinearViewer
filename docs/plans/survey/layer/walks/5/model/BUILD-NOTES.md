# Model build notes (walk 5)

Built from design.md §3–4 only. `node layer.mjs <cmd> …`, store `--store <path>` (default `./store.json`). Every flag may sit anywhere in argv. Output is JSON on stdout (`brief --text` prints text). Exit 0 ok; 1 usage `{"usage": …}`; 2 refused `{"refused": …}`. `node test.mjs` runs the test in a temp dir and deletes it afterwards.

## CLI
- `add <kind> '<json>' --by <actor> [--via <name>] [--at <time>]`: JSON holds fields plus `in`, `to`, `links`. Prints the new version.
  `add finding '{"says":"fix x","in":"task-4","to":"implementation"}' --by review`
- `revise <id> '<json>' --reason <r> --by <actor> [--via] [--at]`: given fields are merged in; `in`/`to` replaced; each link type given is replaced.
  `revise change-9 '{"head":"def"}' --reason "new head" --by implementation`
- `end <id> <state> <reason> [--into <id>] --by <actor> [--via] [--at]`
  `end plan-3 superseded redone --into plan-20 --by breakdown`
- `link <id> <type> <id[@v]> --by <actor> [--via] [--at]`: adds to a list type, replaces `answers`/`piece`.
  `link lesson-13 about area-1 --by survey-place`
- `brief <actor> --task <id> [--as-of <t>] [--text]`: parts 1–7 plus `carries` (count per part) and `bytes` (size of the text form).
  `brief implementation --task task-4 --text`
- `show --task <id> --by <actor> [--as-of <t>]`: the task and every record `in` it, each with id, kind, v, state, to, first line, stale flags and answered.
  `show --task task-4 --by John`
- `get <id>[@<v>] --by <actor> [--as-of <t>]`: no @v gives the current record plus `versions`; @v gives that one version.
  `get change-9@1 --by John`
- `find [--kind k] [--in id] [--area id] [--path p] [--to x] [--state s] [--text t] [--count] --by <actor> [--as-of <t>]`
  `find --to implementation --state open --by implementation`

Ids are `<kind>-<n>` with one counter for the whole store. The store is `{next, records: {id: [versions…]}, log: [...]}`. Each version is a full snapshot: `id kind v op at by via? reason? in? to? state ended? {reason, into?} links fields`.

## Where the page was open, I chose
- **as-of:** the version shown is the highest `v` whose `at` ≤ T. A record with no such version doesn't exist yet. With no `--as-of` you get the latest version, whatever its `at`. Times are normalised to ISO; a time that won't parse is a usage error.
- **`on` without `@v`** is pinned to the target's current version at write time. Other link types keep exactly what was written.
- **Stale:** a target counts as revised only by a `revise` version written after the pinned one, so `end` and `link` versions don't count. Of the end states, only superseded, withdrawn, abandoned and disproved make a record stale; any other end doesn't. A record that rests on a stale record is flagged "which is stale". Ended records are never stale.
- **`in`** is optional, since top-level tasks and areas have no parent. The page says runs sit in a task, lessons in an area and child tasks carry no `asked`; none of these is enforced.
- **`asked`** can be set once on a task that has none. After that, any change is refused.
- **Revise/end/link** apply to the latest version, whether or not the record has ended. Ending an already-ended record is allowed.
- **Missing argument vs bad value:** a missing `--by`, `--reason` or positional, bad JSON or an unknown flag is usage (1). An end reason given as an empty string is refused (2). A record that isn't found is refused (2).
- **Queries require `--by`**, but it isn't checked against actors.json. `brief` logs its `<actor>` (or `--by`). Every query and brief is appended to `log` in the store as `{at, by, cmd, args, asOf}`. There is no command that reads the log.
- **Answered:** a question shows `answered: {id, v, answer}` from a decision in state `stands` whose `answers` points at it.
- **Overlap** has no command of its own. It shows up as brief part 6, and through `find --kind run --state open --path p`, because `find --path` and `--area` match on `paths` and on `claims`.
- **find:** `--in` matches direct children only. `--area` matches records `in` the area or with paths overlapping its paths. `--text` is a case-insensitive substring search over the fields.
- **Brief:**
  - Part 1 lists `asked` for the task and each ancestor that has one.
  - Part 2 follows `superseded` and `--into` to the live piece and lists the pieces it replaced.
  - Part 4 targets the piece, any piece it replaced and every change `in` the task. It includes any decision whose `scope` is the task or an ancestor. Decisions and verdicts `about` or `on` those targets are matched wherever they live, not only in ancestors.
  - Part 7 leaves out what parts 3 and 6 already show.
  - A blind actor still sees its own verdicts.
  - `brief` refuses an actor that isn't declared and an id that isn't a task.
- **Lists of fields** (`paths`, `options`, `claims`) must be JSON arrays. A single value is accepted only for list-type links.

## Not built
- A way to delete fields or clear `in`/`to` on revise.
- Concurrency control (the store is read, then written with an atomic rename).
- A reader for the query log.
- Validation that a field's text is non-empty.
