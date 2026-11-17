# Build notes: walk 4 model

Built from design.md §3–4 only. `node layer.mjs …` prints JSON on stdout. Exits: 0 ok, 1 usage (`{"usage": …}`), 2 refused (`{"refused": "<reason>"}`).
`--store <path>` (default `./store.json`), `--text` and every other flag may appear anywhere in argv.
The store holds `{next, records: {id: [versions]}, log}`. Each version is a full snapshot: `id kind v op by [via] at [reason] [in] [to] state [stateReason] [into] links …fields`.

## CLI

Writes take `--by <actor>` (required) and optionally `--via <name>` and `--at <time>` (default now).
- `add <kind> '<json>'`: `node layer.mjs add finding '{"in":"task-3","to":"implementation","says":"Fix the loop"}' --by review`
- `revise <id> '<json>' --reason <r>`: `node layer.mjs revise change-5 '{"head":"def"}' --reason "new head" --by implementation`
- `end <id> <state> <reason> [--into <id>]`: `node layer.mjs end finding-7 handed-on moved --into finding-8 --by implementation`
- `link <id> <type> <id[@v]>`: `node layer.mjs link task-3 piece plan-4 --by breakdown --at 2026-01-04T00:00:00Z`

Reads take `--as-of <time>`. Queries require `--by`. All reads, the brief included, are logged as `{at, by, q}` with `--store` stripped from `q`.
- `brief <actor> --task <id> [--as-of <t>] [--text]`: `node layer.mjs brief implementation --task task-3 --text`
- `show --task <id>`: `node layer.mjs show --task task-3 --by review`
- `get <id>[@v]`: `node layer.mjs get task-3@1 --by John`
- `find [--kind] [--in] [--area] [--path] [--to] [--state] [--text] [--count]`: `node layer.mjs find --to implementation --state open --count --by John`

## Choices where §3–4 left it open

- Records are stored flat (`asked`, `says` and the rest sit beside `id` and `in`). Input JSON may hold only kind fields plus `in`, `to` and `links`. Any other store-set key (`state`, `by` …) is refused.
- `revise` merges the given fields over the latest version, and links merge too. There is no way to delete a field.
- `links` is an object with one value per type. `link` sets or replaces that type, so `same-as` holds a single target.
- `on` must be `id@v` on every kind, not only on verdicts. `@v` must name a version that exists.
- A verdict must carry both `of` and `outcome`, and `outcome` must be in `of`'s set.
- `in` is optional on every kind (top-level tasks and areas have none). When present it must be a task or an area.
- `scope` is typed as "a task id that exists". `order` is a number, and `options`, `paths` and `claims` are string arrays.
- "A child task has no `asked`" is not enforced, because §3.3 doesn't list it.
- `end` refuses any state that is not one of the kind's ends, so a record can't be reopened. Ending an already ended record is allowed. `--into` is required for handed-on/superseded and accepted, unchecked, on other ends.
- Versions are ordered by `v`. `--as-of T` takes the last version by `v` whose `at` ≤ T, and a record with none doesn't exist as of T. `get id@v --as-of T` only finds versions with `at` ≤ T.
- Paths overlap when one is a plain string prefix of the other: `lib/a` overlaps `lib/ab`.
- Stale: the record is in its start state, its `on` target has a later version made by `revise` (a later end or link doesn't count), the target is superseded, withdrawn or abandoned (only these three, as listed), or the target is itself stale. Cycles are guarded.
- Answered: a question gets `answered: {id, answer, why}` from the first standing decision that `answers` it.
- Overlap view: `show --task` returns `overlap`, which lists pairs of open runs that share a claimed path where at least one run is in the task.
- `find --area A`: records whose `paths` or `claims` overlap A's paths, not records `in` A (`--in` covers that). `--path` uses the same rule. `--text` is a case-insensitive substring match over the record's JSON.
- `find` returns ended records too unless `--state` is given. The brief always leaves ended records out.
- Brief part 1 lists the task and then its ancestors, upward. Records without `asked` are skipped.
- Brief part 2 shows the current version of the `piece` target and ignores any `@v`. It is left out if that plan has ended. It does not follow `into`.
- Brief part 4: "its change" means any change record `in` the task. Scope covers the task when `scope` is the task or one of its ancestors.
- Brief part 7: an open record already in part 3 is not repeated. "What it says" is the first line of the kind's first string field that has a value.
- Size: `bytes` is the UTF-8 byte length of the text rendering. The JSON form has `carries` (item count per part) and `bytes`. `--text` ends with a `-- carries …; N bytes` footer, which is not counted.
- Queries log their `--by` without checking that it is a declared actor. The store never refuses on who or when.

## Not built

- No LLM smoothing of the brief (§3.5 says the model builds the deterministic part only).
- No standalone overlap or open-for-reader command: open-for-reader is `find --to X --state open`, and overlap lives in `show` and brief part 6.
- No locking: concurrent writers to one store file can lose updates.
