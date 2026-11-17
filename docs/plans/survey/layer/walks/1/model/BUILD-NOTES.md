# Build notes: walk 1 model

## CLI
All commands take `--store <path>` (default `./store.json`) and `--retro`. Writes also take `--by <who>` (required), `--via`, `--at <ISO>`.
- `node layer.mjs add <kind> '<json fields, plus optional in/to>'`
- `node layer.mjs revise <id> '<json changed fields; null removes>' <reason>`
- `node layer.mjs end <id> <state> <reason> [--target <id>]`
- `node layer.mjs link <id> <about|answers|same-as|on> <target>`
- `node layer.mjs brief <reader> --task <id> [--as-of <ISO>]`
- `node layer.mjs check`
- `node layer.mjs hits`

JSON out; exit 1 on refusal (names `field` or `rule`) or failures, 2 on usage.

## Choices (spec ambiguous or silent)
- Ids are `kind-n`. Refs are `kind-n`, `kind-n#piece` or `kind-n@version`. Any ref-shaped value must resolve (rule 6).
- `in` may be a free name. So may `to`, if the kind lists a non-kind addressee (stage, John, operator, decider). Names are unchecked.
- Required fields are the "what it is" fields. `asked` is optional and fixed.
- `pieces` is an object keyed by piece. `outcome` ∈ {pass, fail} (invented).
- Every write is a version, but only `revise` supersedes one.
- Rule 2: a finding `about` a plan ending `done` needs a plan revise after the finding's creation.
- Rule 3: refuses a second open or standing decision whose `basis`/`answers` is that question. A superseded or withdrawn one frees it.
- Rule 4: a revise auto-stales live verdicts on older versions (by `layer`). A verdict on a superseded or unversioned ref refuses or hits.
- Field checks refuse in both modes. Only §3.3 rules become hits. Rules are evaluated as of `--at`.
- Retro = store's flag (set at creation) or `--retro`.
- Out-of-order writes (per record) refuse.
- "Closed" means a non-live end. kinds.json `live` keeps stands/holds/kept in briefs.
- Brief:
  - The plan piece comes via the task's `about` links.
  - Areas are the task's `in` plus `about` links. Paths overlap by prefix.
  - Decisions and checks are those with `in` = task. Checks show as id+state only.
  - "Instructions" = open records addressed to the reader or the task.
  - `size.chars` excludes the summary line.

## Not implemented
- `run` and `setting` stay on paper, per the spec.
- There are no views or `get`.
- `handed-on` stores `target`, not a typed link.

## Size and result
`layer.mjs` is 256 lines and `test.mjs` is 108. `node test.mjs` passes, using a temporary store that it removes.
