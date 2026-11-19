# Layer model — build notes (walk 9)

Files: `kinds.json` (kinds, outcome sets, link types, takeover ends), `actors.json`, `layer.mjs`, `store.json` (empty), `test.mjs` (`node test.mjs`: uses a temp store through `LAYER_STORE`).

Store: `store.json` beside the script, or the path in `LAYER_STORE`. Output is JSON on stdout. Exit 0 ok, 1 usage, 2 refused; errors print `{"error":"<reason>"}`.

## Writes (each takes `--by <actor>`, optional `--via <name>`, `--at <time>`)

Each returns the new version snapshot `{id, kind, v, op, at, by, via?, reason?, in?, to?, state, ended?, links, fields}`.

- **add** — fields flat at the top level, plus `in`, `to`, `links`:
  `node layer.mjs add finding '{"in":"task-3","to":"review","says":"Footer count is off by one","how":"run the footer test","links":{"about":["change-5"]}}' --by implementation --via Harbour`
- **revise** — merges: given fields replace, `null` removes; `in`/`to` replace; `links` replace per type given:
  `node layer.mjs revise change-5 '{"head":"def456"}' --reason "new head" --by implementation`
- **end** — `end <id> <state> <reason…> [--into <id>]`:
  `node layer.mjs end plan-2 superseded "rewritten after review" --into plan-7 --by design`
- **link** — list types (`about`, `on`) append; `answers`, `piece` replace:
  `node layer.mjs link verdict-6 on change-5@2 --by review`

## Reads

- **brief** `<actor> --task <id> [--as-of <t>] [--text]`:
  `node layer.mjs brief implementation --task task-3`
  Returns `{actor, task, asOf, carries, bytes, parts}`; `parts` = `task` (id, ref, done-when, `asked` of task and ancestors, nearest first), `plan`, `addressed`, `stands`, `project` (two counts + lookup commands), `runs`, `index`, `previous`. `carries` = ids of every record the brief names; `bytes` = size of the text rendering. `--text` prints only the text rendering.
- **get** `<id>[@<v>] --by <actor> [--as-of <t>]`:
  `node layer.mjs get change-5 --by review` — the current snapshot (with `flags`) plus `versions`; `get change-5@1` returns that one version.
- **find** `[--kind] [--in] [--to] [--state] [--text] [--count] --by <actor> [--as-of <t>]`:
  `node layer.mjs find --to review --state open --by review` — `{records:[…]}`, or `{count:n}` with `--count`.
- **show** `--task <id> --by <actor> [--as-of <t>]`:
  `node layer.mjs show --task task-3 --by review` — `{task, records}`: the task and every record `in` it, any state, with flags.

Every record a read returns carries computed `flags` when they apply: `answered` `{by, answer}` (question), `stale` `["on change-5@1, now @2"]` (verdict/decision not ended), `under-ended-task` (open record in or to an ended task). Reads (brief included) append `{at, by, cmd, args, asOf}` to the log.

## Choices where the spec was silent or ambiguous

- Ids are `<kind>-<n>` from the store's single `next` counter (matches the spec's `task-3`, `change-5`).
- `add`/`revise` JSON is flat: fields at the top level beside `in`, `to`, `links`; a nested `fields` key is refused with "put fields at the top level".
- Misplaced keys are refused with where they belong: link at top level → "put it under links"; `to`/`in` under links → "top level"; another kind's field → "it belongs to <kind>"; `by`/`via`/`at` → "use --<flag>"; `state` → "use end".
- Shape checks run in a fixed order and the first failure is reported (one reason per refusal).
- A verdict must carry `judgement` and `outcome` (the outcome set can't be checked otherwise); no other field is required.
- `on` links must name a version (`id@v`); other link values may be `id` or `id@v`; a given version must exist.
- `answers`/`piece` targets are checked by kind (question, plan); `on` targets are not limited to plans/changes.
- Revise may change `in`, `to`, links and fields; only a task's `asked` is fixed once written (a task with none may gain one). Ended records may still be revised.
- Ending an already-ended record is refused; `--into` is refused on ends other than handed-on/superseded, and must resolve.
- `end` joins all words after the state into the reason, so quoting is optional.
- `--at`/`--as-of` accept anything `Date` parses and are stored as ISO UTC. "As of t" = the highest version whose `at` ≤ t; a record with no such version doesn't exist yet.
- `brief` without `--as-of` reports the current time as its `asOf`; other queries without it read the latest versions.
- `find --in project` matches records with no `in`; `--text` is a case-insensitive substring over the record's field values; other filters are exact.
- Stale: compares the pinned version's fields to the current fields (key order ignored); "now @n" is the target's current version number. Only `on` links count.
- A brief's own run (open run in the task by the actor) is left out of parts 6 and 7.
- "Left behind" (part 3): addressed to an actor whose run in this task (matched by `stage`, else `by`) has ended and who has no open run there.
- "Under an ended child" (part 3) covers direct child tasks only.
- Part 2: the piece is followed through `superseded … into` to the current plan; plans with no piece are ordered by `order`. "First paragraph" = text up to the first blank line.
- Part 4 targets are this task, its piece, the plans and changes in it (any state); decisions anywhere with a `scope` of this task, an ancestor, or `project`.
- Part 7 lists open records in the task not already carried by parts 2–6; "what it says" is the first present of says, asks, answer, reasoning, account, asked, done-when, head, ref, stage.
- Part 8: "latest" = latest `at` of the run's current version (its end).
- Queries check that `--by` is a declared actor; brief logs its actor as `by`.
- Unknown flags (e.g. `--store`) are usage errors listing the command's flags.
- A missing store file is treated as empty and created on first write.
