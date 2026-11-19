## 3. The model

### 3.1 Every record

| Field | Meaning |
|---|---|
| `id` | Allocated by the store, stable, never a position |
| `kind` | One of the declared kinds (3.2); fields are checked against it |
| `in` | The task it belongs to. A child task is `in` its parent. A record with no `in` belongs to the project as a whole |
| `by` | Who wrote it: a declared actor (3.2); `via` if relayed |
| `at` | When each version was written |
| `state` | The kind's starting state or one of its ends, with a `reason`. `handed-on` and `superseded` name the record that takes over |
| `to` | Who must act on it next: a declared actor, a task record, or `project` (whoever works in this project next). Required on the hand-off kinds (finding, question); optional on every other kind |
| `links` | `about` (its subjects), `on` (the exact versions it rests on, `id@v`; required on a verdict), `answers` (a decision to its question), `piece` (a task to its plan piece). Each type holds a list, except `answers` and `piece`, which hold one |
| versions | Every write (add, revise, end, link) is a new version with its `by`, `at` and, for a revise, its `reason`; earlier versions are kept. Any record can be read as of a time, or at a version. Any record may be revised except a task's `asked` |

### 3.2 Kinds and actors

*Kinds are data: one generic record plus `kinds.json`.*

| Kind | Holds | Own fields | Starts → ends |
|---|---|---|---|
| `task` | The order | `asked` (the person's words, fixed once written; a child made by breakdown has none and reads its piece, a child a person wrote keeps theirs), `done-when`, `ref` (the tracker's id for it, if any) | open → done, declined |
| `plan` | One piece of how a task will be done; a parent's plan is its pieces | `says`, `order` | kept → superseded |
| `finding` | Something someone must act on, including a verification to run | `says`, `how` (optional: how to verify or act); `to` | open → done, declined, handed-on |
| `question` | A call waiting on a decider | `asks`, `options`, `recommended`, `if-unanswered`; `to` | open → answered, withdrawn, handed-on |
| `decision` | What was decided and why, including a person's standing direction | `answer`, `why`, `scope` (optional: a task, covering it and every task under it; or `project`, covering every task) | stands → superseded, withdrawn |
| `verdict` | A judgement `on` one version of a plan piece or change | `judgement` (which one: plan-review, review, blind-read), `outcome` from that judgement's set, `reasoning` | stands → superseded, withdrawn |
| `lesson` | A lasting truth about the code or the work, for the project | `says` | holds → superseded, disproved |
| `change` | A handle on the work product: a PR, commit range or saved file; each new head is a new version | `ref`, `head` | open → merged, abandoned |
| `run` | One actor's session, `in` its task | `stage`, `account` (what it wrote for people, in full: its own words, as it would post them) | open → done |

**Outcome sets:** plan-review and review: approve, request-changes, needs-discussion (notes that come with an approval are findings). Blind-read: better, same, worse.

**Open** records are those in state `open` (task, finding, question, change, run). The other kinds start in a standing state (kept, stands, holds).

**Actors** are declared in `actors.json`: the names that may appear in `by` and `to`. For Harbour: its stages (design, plan-review, breakdown, survey-task, survey-place, scoping, implementation, leftover, review, blind-read, close-out), the autopilot, John, and Harbour itself (the system). Blindness (a judge that must not see another's judgement) is not the store's: retold judgements turn up in run reasons and revised findings, so filtering kinds can't hide them (walks 7–8). Harbour gives such a stage no brief and limits what it may read. These are the loop's actors, the same whatever codebase it works on; a different product using the layer would declare its own. Any actor may write any kind and end any record; which ones it should is its prompt's business and Harbour's.

### 3.3 What a write checks

Only shape, so a malformed record can't enter:
- the kind is declared; every field belongs to it and has its type; a verdict's outcome is in its set; a task's `asked` doesn't change once written;
- `by` is a declared actor; a `to`, where present, is a declared actor, a task record or `project`, and the hand-off kinds (finding, question) must have one;
- `in`, where present, is a task; every link resolves; a verdict has an `on`; `answers` and `piece` join the kinds named above;
- a state change goes to one of the kind's ends with a reason; `handed-on` and `superseded` name the record that takes over.

### 3.4 Views, computed when read

- **Open for a reader:** open records whose `to` is that actor, that task, or `project`.
- **Answered:** a question with a standing decision that `answers` it shows that decision beside it, whether or not its state has been ended yet.
- **Stale:** a verdict or decision, not ended, one of whose `on` links points to a version after which its target's content was revised (a change to its fields; not to its `to`, `in` or links), or to a target ended superseded, withdrawn, abandoned or disproved. Only direct links count. Shown as a flag that says which link moved and how (e.g. "on change-5@1, now @2").
- **Counts:** any `find` can return its count instead of its records, as of any time.
- **Under an ended task:** open records `in` or `to` a task that has ended. They reach its parent's brief (part 3); for a task with no parent, `find` shows them.

### 3.5 Reading: a brief, then queries

John: "previously an agent essentially got the brief, but then the ability to find much more information … we now have this rich data layer for it to find key bits of information, maybe research things if it wants" [checked, log "17 Nov"]. So the brief is small, deterministic and says what exists; the stage looks up the rest.

**A brief** is what an actor working on a task is given:
1. **The task and the person's words:** the task's id, `ref` and `done-when`; then the `asked` of the task and of each ancestor, verbatim.
2. **Its plan:** the current version of the task's `piece` (if superseded, the record that took over); for a task with no piece, every plan `in` it that is kept. In full to the actor a plan is addressed to; to others, its first paragraph and its id, to `get`.
3. **Addressed to it, in full:** open records `in` this task whose `to` is this actor; open records anywhere whose `to` is this task; open records `in` this task addressed to a stage whose run on this task has ended (left behind); and open records under a child task that has ended.
4. **What stands about this task:** verdicts and decisions `in` the task, or `about` or `on` its piece or its change, each with the version it rests on and the stale flag. An ancestor's decisions appear when `about` or `on` this task's piece, or when they carry a `scope` that covers it; a decision scoped to `project` covers every task.
5. **The project:** how many open records are addressed to `project`, and how many lessons hold, with how to look them up (`find --to project`, `find --kind lesson`, both with `--text`). The actor decides what is worth reading.
6. **Other open runs** in the project, other than the actor's own on this task: id, task and stage, so the actor can judge whether work elsewhere bears on its own.
7. **An index of what else is known:** every other open record `in` the task, one line each: id, kind, to, and the first line of what it says.
8. **The previous stage:** one line pointing to the latest ended run in this task by another actor: its id, stage and the first line of its account. The account itself, the stage's words in full, is read with `get`.

Ended records are left out. Each brief reports what it carries and its size in bytes of text.

**Queries:** `get <id>` (in full, with its versions; `<id>@<v>` for one version), `find` (by kind, in, addressee, state or text; `--count`), `show --task` (everything in the task, with states and flags). Every query takes `--as-of`. Queries are logged with who asked, so a walk can see what each stage went looking for.

**An LLM may smooth the brief** for the task at hand, as Harbour does today from ticket text; with records as input it does less of the work (John, log "17 Nov"). The model builds the deterministic part only. Harbour's code reads fields directly; it never parses a brief.

## 4. The model build

*A fresh subagent builds the model from §3 and this section only, in `walks/<n>/model/`. Nothing else is given. It is thrown away after its round.*

- **Form.** Node, ES modules, no dependencies. `kinds.json`, `actors.json`, `layer.mjs`, and one JSON store holding every record's versions and the query log. As small as it can be.
- **Store format,** so stores carry from one build to the next: `{next, records: {<id>: [<version>, …]}, log: [{at, by, cmd, args, asOf}]}`; each version is a full snapshot `{id, kind, v, op, at, by, via?, reason?, in?, to?, state, ended?: {reason, into?}, links: {<type>: <value or list>}, fields: {…}}`.
- **Commands** (CLI; JSON in and out; exit 0 ok, 1 usage, 2 refused with the reason):
  - Writes: `add <kind> '<json>'` (fields plus `in`, `to`, `links`), `revise <id> '<json>' --reason <r>`, `end <id> <state> <reason> [--into <id>]` (the record that takes over), `link <id> <type> <id[@v]>`. Each takes `--by <actor>`, and optionally `--via <name>` and `--at <time>`, so a finished task can be written in its own order.
  - `brief <actor> --task <id> [--as-of <time>] [--text]`: §3.5, with what it carries and its size.
  - Queries, each with `--by` and `--as-of`: `show --task <id>`, `get <id>[@<v>]`, `find [--kind] [--in] [--to] [--state] [--text] [--count]`.
- **Its own test,** run before any walk: each shape check refusing once, each command once, each view, and each part of the brief.

