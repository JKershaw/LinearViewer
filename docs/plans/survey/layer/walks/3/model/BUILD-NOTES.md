# Build notes (walk 3 model)

## CLI: `node layer.mjs <cmd> … [--store path]` (default `./store.json`), JSON out

Every write takes `--by W [--at T]`; `revise`/`end` also `[--task T]`.

- `add <kind> '<json>' [--via X]`: JSON = fields + `in`, `to` (stage, person, or task/area id), `links` (`{"on":"plan-4@2"}`). Ids are `<kind>-<n>`.
- `revise <id> '<json>' --reason R`: merges fields; `"to"` re-addresses.
- `end <id> <state> <reason> [--to <id>]`: `--to` = the record taking over.
- `link <id> <type> <target[@v]>`: one link per type; relinking replaces (re-affirms an `on`). `on` without `@v` pins the current version.
- `brief <stage> --task <id> [--as-of T] [--text]`: JSON, or plain text; reports carries and size.
- Queries (`--by` required; logged to the store's `queries` as `{at, by, query, args, returned}`): `show --task <id> [--as-of T]`, `get <id> [--as-of T]`, `find [--kind] [--area] [--path] [--to] [--state] [--text]`.
- `check` → `{problems, stale}`. `hits` → `{retro, hits}`.
- `--by` = a stage in stages.json or a person in people.json (`John`, `Harbour`). A stage passes `--task <id>` for the task it is working on (rule 6). `--retro` on the command that creates the store makes it retro.
- Exit 0 ok, 1 usage, 2 refused (`{refused:[{rule,msg}]}`).

## Ambiguities: what I chose

- Versions count every write. Stale = a *revise* after the pinned v, a target in kinds.json `moves` (superseded/withdrawn/abandoned only), or a stale target.
- As-of = each record's highest version with `at` ≤ T.
- Closed = in an end state.
- An area's finding = a finding `to` the area. Task areas match by plain string prefix. Lessons overlap by prefix either way.
- Rule 2: needs a *revise* of the piece with `at` after the finding's creation.
- Rule 1 counts `to` only. Rule 3: any other `answers` decision blocks, whatever its state. Rule 7 ends only an open question, with `by: "layer"`.
- Rule 6: the addressee includes a stage whose `--task` is the record's `to`. "In its task" means direct `in`. Area-settled findings may be ended (not revised) by a stage whose task covers the area. Re-addressing an area finding to a task: the place stage or a person only. Implementation has role `piece` in stages.json and revises a plan only if it is its task's `piece`. `link` has no rule-6 check.
- Field checks cover unknown fields, types, the outcome set, and `asked` (fixed; empty in a child). Non-hand-off kinds may not have a `to`. `in` must be a task or area.
- Brief: an ended piece is omitted. "Its change" = changes `in` the task.
- `find --area` matches `in`/`to`; `--text` is case-insensitive.
- Retro logs rule and field violations. Usage errors and unknown kinds or ids are always refused.

## Not implemented

- `check` can't re-verify rule 6 (the actor's task is unknown). `--task` is trusted. A run's `stage` isn't tied to its writer.

## Size and test

layer.mjs 321 lines, test.mjs 191, kinds.json 43, stages.json 13, people.json 1. `node test.mjs` → `ok: 103 commands checked`, and the temp store is removed.
