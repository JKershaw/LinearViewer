# Build notes: layer model (walk 2)

## CLI (`node layer.mjs`, JSON out, `--store <path>`, default `./store.json`)

Every write (add, revise, end, link) takes `--by <who>`, plus optional `--via <who>` and `--at <time>`.

- `add <kind> [--in <id>] [--to <addressee>] [--link <type>=<id>[@v]]… [--json '<fields>'] [--retro]`
- `revise <id> --reason <text> [--json '<merged fields>'] [--to <addressee>] [--in <id>]`
- `end <id> <state> <reason> [--to <takeover-id>]`
- `link <id> <about|on|answers|piece|same-as> <id>[@v]`
- `brief <stage> --task <id> [--as-of <time>] [--text]`; `show --task <id> [--as-of <time>] [--text]`; `check`; `hits`

`--by`: a `stages.json` key is a stage; any other name is an unrestricted person. `--to` takes a stage, person, or task/area id. `--retro` counts only when creating the store. Exit: 0 ok, 1 refused, 2 malformed.

## Choices

- Ids are `<kind>-<n>`. No field is required except by a rule, and no types are checked. `asked` is fixed; a child task's is empty.
- Open means the kind's starting state.
- One link per type. Linking again replaces it, which is how a record is re-affirmed. `on` pins the current version unless `@v` is given.
- `in` kinds are set per kind. `in` is optional for task, area and setting.
- Retro logs rule problems as hits. Malformed input is still rejected: an unknown kind, record, state or link type, bad JSON, a missing `--by` or reason, or an `--at` that goes backwards.
- Permissions: a stage ends its kinds and records addressed to it; closes also ends tasks and anything in one. design/plan-review/breakdown add only child tasks; implementation only revises an existing `piece`; a run's `stage` equals `--by`; only place (area → task) and persons change `to`.
- Rule 2 compares the plan's latest `at` with the finding's first `at`. Rule 3 counts decisions that still stand.
- Stale applies to open records only and is not transitive.
- Scope: a task id covers it and its descendants; anything else (a project) covers all. Paths overlap when equal or when one is a `/`-prefix of the other.
- Brief: parts 2–8 drop closed records. Part 4: standing verdicts/decisions in or linked to the task/ancestors, the piece, or open changes. Part 7: findings to areas overlapping the task's paths. Part 8: all open records in the task by state; ids only, full for closes.
- carries is open, addressed and stale counts. size is text chars and JSON bytes.
- `check` replays each version against the store before it.

## Not implemented

Nothing in §3–4. Walk 1's breaks are tested only as the spec names them.

## Result

layer.mjs 285 lines, test.mjs 169, kinds.json 79, stages.json 15. `node test.mjs` passes and leaves nothing behind.
