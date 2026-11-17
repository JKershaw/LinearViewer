# Layer model — build notes (walk 6)

Built from design.md §3–4 only. `node layer.mjs <cmd> … [--store <file>]`; every flag may sit anywhere in argv.
Output is JSON on stdout (`brief --text`: plain text). Exit 0 ok, 1 usage `{"usage": …}`, 2 refused `{"refused": …}`.
Store defaults to `./store.json`; created empty (`{next:1, records:{}, log:[]}`) if missing.

## Commands
Writes (all need `--by <actor>`; optional `--via <name>`, `--at <time>`, default now):
- `add <kind> '<json>'`: fields plus `in`, `to`, `links`. → the new version.
  `add finding '{"in":"task-3","to":"implementation","says":"b.js leaks","links":{"about":"plan-4"}}' --by review`
- `revise <id> '<json>' --reason <r>`: fields merged (`null` deletes one); `in`/`to` replaced if present; each link type given replaces that type.
  `revise plan-4 '{"says":"Fix b first, with a test"}' --reason clarified --by breakdown`
- `end <id> <state> <reason> [--into <id>]`: `end finding-9 handed-on moved --into finding-8 --by implementation`
- `link <id> <type> <target[@v]>`: adds to a list type, replaces a single type. `link task-3 piece plan-4 --by breakdown`

Reads (`--by <actor>` and `--as-of <time>` optional; every read is appended to `log`):
- `brief <actor> --task <id> [--as-of T] [--text]`: `brief implementation --task task-3 --text`
- `show --task <id>`: the task plus every record directly `in` it, ended ones too, with flags. `show --task task-3 --by review`
- `get <id>[@<v>]`: current version + view flags + `versions`; `@v` gives that one snapshot. `get plan-4@1`
- `find [--kind k] [--in id] [--area id] [--path p] [--to x] [--state s] [--text t] [--count]`: `find --to john --state open --count`

Views appear as extra keys on returned records (never stored): `stale` (verdict/decision), `answered` (question), `overlaps` (open run).
Brief JSON: `task, asked, plan, addressed, stands, areas, runs, index, account` (parts 1–8), plus `carries` (count per part) and `bytes` (size of the text rendering).

## Choices where §3–4 were open
- Ids: one global counter, `<kind>-<next>`; `next` advances only on a successful add.
- Actor names lowercase: `john`, `harbour`, `autopilot` alongside the stage names. `blind` is a list in `actors.json`.
- Kind data: `kinds.json` gives field types (`string`, `list` of strings, `number` for `order`, `task-or-area` for `scope`), `start`, `ends`, plus `handoff` (needs `to`), `fixed` (`asked`), `needs` (`on` on verdict), `outcomes` (keyed by `of`). Link rules live in `layer.mjs`.
- A verdict needs a valid `of` and an `outcome` from that set (a missing one is "not in its set").
- `on` written without `@v` is pinned to the target's current version at write time. Other links keep what was given.
- Links resolve against the whole store, whatever the time (a write never refuses on when). Field values in JSON must have their type; only links accept single-or-list.
- `in` is optional on every kind. Not enforced: a child task having no `asked`, a lesson being `in` an area, ending an already-ended record (allowed; it just adds a version).
- Missing `reason` on `end` is a shape refusal (exit 2), not usage. `revise` without `--reason` is usage (exit 1).
- A query `--by` must name a declared actor (else refused); it's optional and logged as `null` if absent. `brief` logs its actor.
- No `--as-of`: the latest version of each record (even one written with a future `--at`). With it: the last version in store order with `at ≤ T`.
- `--text` takes a value only for `find`; elsewhere it's a switch. The command is the first positional that is a command name.
- Stale: compares the pinned version's `fields` with the current version's (key-order-insensitive); reports `on X@v, now @<current v>`, or `on X@v, now <state>` if the target ended superseded/withdrawn/abandoned/disproved.
- Find: `--in` is direct membership; `--area` = records `in` the area or whose `paths`/`claims` overlap its paths; `--path` matches `paths` and `claims`; `--text` is a case-insensitive substring of the fields' JSON.
- Brief: "in the task" means directly `in`. A run's actor is its `by`. "Left behind" = addressed to an actor (not the reader) with an ended run in this task and no open one. "Its change" = any change `in` the task. A decision appears in part 4 when it is `in` the task, `about`/`on` the piece or a change, or its `scope` is the task, an ancestor, or an area overlapping the task's paths. A superseded piece is followed through `ended.into`. Part 7 excludes records already shown in parts 2–6 (the reader's own open run is listed there). Part 8 picks the ended run by another actor with the latest current `at`. "What it says" = the first of `says, asks, what, answer, reasoning, account, done-when, name, asked`, else the first string field.
- Blind actors: verdicts by others are dropped from the brief and from `find`/`show`; `get` of one is refused as "no record".
- Query log `args` = positionals plus flags other than `--store`, `--by`, `--as-of` (those go in `by`/`asOf`).

## Not built
No LLM smoothing (§3.5 says the model builds the deterministic part only). No locking for concurrent writers. No read-at-version for whole briefs (`--as-of` only).
