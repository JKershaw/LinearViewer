# Layer model — build notes

`node layer.mjs <command> …`. Store: `store.json` beside the script, or `$LAYER_STORE`. JSON on stdout; exit 0 ok, 1 usage, 2 refused; errors are `{"error":"<reason>"}`. `node --test test.mjs` runs the model's own test against a temporary store.

## Writes (each takes `--by <actor>`, optional `--via <name>`, `--at <time>`)

- `add <kind> '<json>'` — `node layer.mjs add finding '{"in":"task-3","to":"review","says":"Fix the lint"}' --by implementation`
- `revise <id> '<json>' --reason <r>` — `node layer.mjs revise change-4 '{"head":"def"}' --reason "new head" --by implementation`
- `end <id> <state> <reason> [--into <id>]` — `node layer.mjs end plan-2 superseded "rewritten" --into plan-22 --by design`
- `link <id> <type> <id[@v]>` — `node layer.mjs link decision-10 answers question-9 --by John`

Each returns the new version snapshot `{id, kind, v, op, at, by, via?, reason?, in?, to?, state, ended?, links, fields}`.

## Reads

- `brief <actor> --task <id> [--as-of <t>] [--text]` — `node layer.mjs brief implementation --task task-3`. Returns `{actor, task, asOf, carries, bytes, parts}`; `parts` = `task` (id, ref, done-when, `asked` list for the task then each ancestor), `plan`, `addressed`, `stands` (full records with `stale`/`answered` flags), `project` (`open`, `lessons`, `lookup`), `runs` (`{id, task, stage}`), `index` (`{id, kind, to, says}`), `previous` (`{id, stage, account}` first line, or null). `carries` counts each part; `bytes` is the byte length of the text rendering. `--text` prints only the text rendering.
- `get <id>[@<v>] --by <actor> [--as-of <t>]` — `node layer.mjs get change-4 --by review`. Without `@v`: the current version (with flags) plus `versions` (all versions as of the time). With `@v`: that version alone.
- `find [--kind k] [--in task] [--to x] [--state s] [--text words] [--count] --by <actor> [--as-of <t>]` — `node layer.mjs find --to project --state open --by design`. Returns an array of current records with flags, or `{count}`.
- `show --task <id> --by <actor> [--as-of <t>]` — `node layer.mjs show --task task-3 --by John`. Returns `{task, records}`: every record `in` the task, ended or not, with flags.

Flags (views, computed when read): `stale: ["on change-4@1, now @2" | "on plan-2@1, now superseded"]` on a standing verdict/decision; `answered: <decision>` on a question; `underEnded: <task id>` on an open record `in`/`to` an ended task. Queries (get/find/show) append `{at, by, cmd, args, asOf}` to the store's `log`.

## Choices where the spec was silent or ambiguous

- Ids are `<kind>-<n>` from one global counter `next` (matches the spec's "change-5" example).
- Times are normalised to ISO-8601 UTC; as-of picks, per record, the highest version whose `at` ≤ the time. `--at` earlier than a record's previous version is accepted, not refused.
- A bare id in an `on` link is pinned to the target's current version at write time; other link types store what was given.
- `link` appends to list types (no duplicates) and replaces single types (`answers`, `piece`).
- `revise` merges fields; `in`, `to` and given link types replace; fields and `in`/`to` cannot be removed. Adding `asked` to a task that had none is allowed ("fixed once written").
- Ending an already-ended record is refused. Missing id/state is usage (1); a missing or empty reason is a refusal (2).
- `--into` must resolve to an existing record of any kind; it is allowed on any end, required on `handed-on`/`superseded`.
- No field is required except `to` on hand-off kinds and `on` on verdicts; a verdict's `outcome` is refused unless its `judgement` is given and the outcome is in that set.
- Field types: text, number, list (of text), actor (`run.stage`), scope (task id or `project`), judgement, outcome.
- Not-found record/task and an undeclared `--by` on a query are refusals (2); a missing `--by` is usage (1). Unknown flags are usage.
- A run's stage is its `stage` field, else its `by`. "The actor's own run", "left behind" and "another actor" in the brief use the stage.
- Left behind (part 3): `to` is a stage that has at least one run in this task and all of them have ended.
- "Under an ended child" (part 3) covers direct children only; for a parentless task the `underEnded` flag shows them in any `find`.
- Part 4 targets are the task's `piece`, the plan that took over from it, and every `change` in the task; about/on links from any task count. Decisions with `scope` = the task, an ancestor, or `project` are included.
- Part 7 lists every open record in the task not already carried in parts 2–4 or 6 (so the actor's own open run appears there); "what it says" is the first line of the kind's first text field present.
- Part 8 picks the latest ended run (by its current version's `at`) in the task whose stage is not the actor.
- Blind: verdicts by others are hidden everywhere (a `get` of one is refused as not found); runs whose stage is a judgement name (plan-review, review, blind-read) lose `account` unless by the blind actor.
- `find --text <words>` is a case-insensitive substring search over the record's fields; the brief's lookup hints read `find --to project --text <words>` / `find --kind lesson --text <words>`.
- `brief` is not logged (only queries are); the log `at` is wall-clock time, not `--as-of`.
- `brief`'s `asOf` is the given time or now; the text rendering is fixed headings `## 1.`…`## 8.` with `(none)` for empty parts.
- "Open for a reader" is not its own command: it is `find --to <actor|task|project> --state open`, and the brief's parts 3 and 5.
