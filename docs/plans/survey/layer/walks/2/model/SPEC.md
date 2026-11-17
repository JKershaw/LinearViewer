## 3. The model

### 3.1 Every record

| Field | Meaning |
|---|---|
| `id` | Stable, allocated by the layer, never a position |
| `kind` | One of the declared kinds (3.2); fields are checked against it |
| `in` | What it belongs to: a task or an area |
| `by` | Who wrote it (a stage, John, Harbour), and `via` if relayed |
| `at` | When each version was written |
| `state` | The kind's starting state, or one of its declared ends, with `reason`. `handed-on` and `superseded` name the record that takes over |
| `to` | The addressee. Only the hand-off kinds (`finding`, `check`, `question`) have one, and they must |
| `links` | The only relations, each declared once: `about` (its subject), `on` (the exact version it judges or rests on), `answers` (a decision to its question), `piece` (a task to its plan piece), `same-as` |
| versions | Every write keeps the previous version. A reader may ask for any record as of a time |

*Left out until a walk needs them:* an `evidence` field and the measured value as a field type (for now in a run's `account` or a verdict's `reasoning`).

### 3.2 Kinds

*Kinds are data, not code: one generic record plus `kinds.json`.*

| Kind | Holds | Own fields | Starts → ends |
|---|---|---|---|
| `task` | The order | `asked` (the person's words, fixed; a child's is empty), `done-when`, `paths` (where the work is expected; updatable) | open → done, declined |
| `plan` | One piece of how a task will be done (W1.4); a parent's plan is its pieces, `in` the parent | `says`, `paths`, `order` | kept → superseded |
| `finding` | Something someone must act on; `to` a stage, a task, an area or John | `says` | open → done, declined, handed-on |
| `check` | A verification needing the person's systems; `to` John | `what`, `why-person`, `how` | open → done, declined, handed-on (W1.2) |
| `question` | A call waiting on one decider; `to` the decider | `asks`, `options`, `recommended`, `if-unanswered` | open → answered, withdrawn, handed-on |
| `decision` | What was decided and why; rests `on` a verdict or setting, or `answers` a question, or neither (the ask) | `answer`, `why` | stands → superseded, withdrawn |
| `verdict` | A judgement `on` one version of a plan piece or change (W1.1) | `of` (plan-review, review, blind-read), `outcome` from that judgement's set, `reasoning` | stands → withdrawn |
| `lesson` | A lasting truth about the code, `in` an area | `says`, `paths`, `checked-at` | holds → superseded, disproved |
| `area` | The place | `name`, `paths` | kept → retired |
| `change` | A handle on the work product, a PR or commit range; each new head is a new version (W1.3) | `ref`, `head` | open → merged, abandoned |
| `run` | One stage's session, `in` its task | `stage`, `claims` (paths), `account` (its own summary, in its words) | open → done |
| `setting` | A choice John makes once | `key`, `value`, `scope` (a project, or a task and all under it) | stands → replaced |

**Outcome sets:** plan-review and review: approve, approve-with-notes, request-changes. Blind-read: better, same, worse. Notes worth acting on are findings `about` the verdict.

**Stages** are declared in `stages.json`, each with the kinds it may write and any role. The layer refuses a write of a kind the stage doesn't declare. Harbour's pipeline as a starting point; another project declares its own:

| Stage | Writes | Role |
|---|---|---|
| design, plan-review, breakdown (parent) | plan, verdict, decision, task (children), finding, question | |
| survey-task | finding, question, check | |
| survey-place | finding, question, check, lesson; may re-address an area's finding to the task | place |
| scoping | decision, finding | |
| implementation | plan (its piece), decision, finding, change | |
| review, blind-read | verdict, finding, check | |
| close-out | change, finding, check; ends and hand-ons of anything raised in the task | closes |
| every stage | its run; ends of records addressed to it | |

### 3.3 Rules

Refusals at write time; in a retro fill they are logged as hits and the write goes through.
1. A task can't close while records addressed to it are open.
2. A finding `about` a plan piece can't end `done` unless the piece has a version written after the finding: the correction reached its source (trace 3a).
3. A question takes one decision (by `answers`); a second is refused (trace 3b).
4. A hand-off kind needs `to`. `handed-on` and `superseded` need the record that takes over.
5. Links must resolve; a stage writes only the kinds it declares.

**Stale, computed when read** (W1.3, W1.4, W1.7): a record whose `on` link points to a version that has a newer version, or to a record that has ended, is *resting on a moved version*. Briefs show it flagged; `check` lists them. Nothing is ended or refused for it: someone supersedes or re-affirms it.

### 3.4 Reading: briefs

A brief is what a stage of a task is given, computed, never retold:
1. **The person's words** (W1.5): the `asked` of the task and of each ancestor, verbatim.
2. **Its plan piece:** the current version, through the task's `piece` link.
3. **Addressed to it:** open records whose `to` is this stage or this task.
4. **Standing judgements and decisions** on the task, its piece, its change and its ancestors, with the stale flag.
5. **Settings** whose scope covers the task.
6. **Lessons** whose `paths` overlap the task's or its piece's `paths`: knowledge, not instructions.
7. **For the stage with the place role only** (W1.6): open findings addressed to the areas the task's paths fall in. No other work enters a task, except by that stage re-addressing a finding to it.
8. **Raised in this task, still open** (whoever they are addressed to), by state; in full for the stage with the closes role.

Closed records are left out. Each brief reports what it carries (open things, how many addressed to it) and its size; reported, never a test.

**Harbour's code** reads fields directly; it never parses a brief.

## 4. The model build

*A fresh subagent builds the model from §3 and this section only, in `walks/<n>/model/`. Nothing else is given. It is thrown away after its round.*

- **Form.** Node, ES modules, no dependencies. `kinds.json` and `stages.json` (§3.2); `layer.mjs`; one JSON store with every record's versions. As small as it can be.
- **Commands** (CLI, JSON in and out):
  - `add <kind>`, `revise <id>` (with a reason), `end <id> <state> <reason> [--to <id>]`, `link <id> <type> <id>`. Every write takes `--by <stage or person>`, and optional `--at` so a finished task can be written in its own order.
  - `brief <stage> --task <id> [--as-of <time>]`: §3.4, as JSON and plain text, with what it carries and its size.
  - `show --task <id> [--as-of <time>]`: everything `in` the task and its runs, with states and stale flags: what the task looks like at that moment.
  - `check`: validates the store against §3.2–3.3 and lists stale records.
- **Retro mode.** A store created with `--retro` logs rule hits instead of refusing; `hits` lists them.
- **Its own test.** A short script exercising each rule once in each mode, each command once, the stale flag, and each of the brief's eight parts, including walk 1's breaks as cases. Run before any walk.

