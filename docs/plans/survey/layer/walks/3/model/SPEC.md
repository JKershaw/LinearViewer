## 3. The model

### 3.1 Every record

| Field | Meaning |
|---|---|
| `id` | Stable, allocated by the layer, never a position |
| `kind` | One of the declared kinds (3.2); fields are checked against it |
| `in` | What it belongs to: a task or an area. A child task is `in` its parent; its ancestors are the chain of `in` |
| `by` | Who wrote it: a declared stage or a declared person (W2.3); `via` if relayed |
| `at` | When each version was written |
| `state` | The kind's starting state, or one of its declared ends, with `reason`. `handed-on` and `superseded` name the record that takes over |
| `to` | The addressee: a declared stage, a declared person, or a task or area record (W2.3). Only the hand-off kinds have one |
| `links` | The only relations, each declared once: `about` (its subject), `on` (the exact version it judges or rests on, written `id@v`; the current version if no `v`), `answers` (a decision to its question), `piece` (a task to its plan piece), `same-as` |
| versions | Every write (add, revise, link, end) keeps the previous version, and a reader may ask for any record as of a time. Only `revise` changes content, so only a revise moves what an `on` link rests on |

*Left out until a walk needs them:* an `evidence` field and the measured value as a field type (for now in a run's `account` or a verdict's `reasoning`).

### 3.2 Kinds

*Kinds are data, not code: one generic record plus `kinds.json`. Rule 0 (§3.3) defines open.*

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

**Stages** are declared in `stages.json`, each with the kinds it may add and any role. Harbour's pipeline as a starting point; another project declares its own:

| Stage | Writes | Role |
|---|---|---|
| design, plan-review, breakdown (parent) | plan, verdict, decision, task (children), finding, question | |
| survey-task | finding, question, check | |
| survey-place | finding, question, check, lesson | place |
| scoping | decision, finding | |
| implementation | plan (its piece), decision, finding, check, change (W2.8) | |
| leftover | finding, lesson, change (W2.9) | |
| review, blind-read | verdict, finding, check | |
| close-out | change, finding, check | closes |
| every stage | its run | |

**People** are declared in `people.json`: John, Harbour (the system itself, which writes areas, settings and seeds), and anyone else a project names. A person may add any kind.

### 3.3 Rules

Refusals at write time; in a retro fill they are logged as hits and the write goes through.
0. **Open** means a record's state is `open`: the kinds that start open are task, finding, check, question, change and run. Every other kind starts standing (stands, holds, kept). Briefs count only open records as open (W1.7, W2.5).
1. A task can't close while records addressed to it are open.
2. A finding `about` a plan piece can't end `done` unless the piece has a version written after the finding: the correction reached its source (trace 3a).
3. A question takes one decision (by `answers`); a second is refused (trace 3b).
4. A hand-off kind (finding, check, question) needs `to`, and it must be a declared stage, a declared person, or a task or area record; anything else is refused (W2.3). `handed-on` and `superseded` need the record that takes over.
5. `by` must be a declared stage or person, and a stage adds only the kinds it declares (W2.3). Links must resolve.
6. **Who may revise or end a record:** its writer; its addressee; any person; the stage with the closes role, for anything `in` its task and the task itself; and a stage of a task in an area, for that area's findings its work settled, with the reason (W2.9). Re-addressing an area's finding to the task is for the stage with the place role (W1.6). Implementation revises only its task's piece.
7. **A decision that `answers` a question ends the question `answered`,** by the layer, not the stage.

**Stale, computed when read** (W1.3, W1.4): a record whose `on` link points to a version that has been revised since, to a record that was superseded, withdrawn or abandoned, or to a record that is itself stale (W2.6), is *resting on a moved version*. Ending well (done, merged, answered) doesn't make anything stale. Briefs show it flagged; `check` lists them. Nothing is ended or refused for it: someone supersedes or re-affirms it.

### 3.4 Reading: a brief, then queries

John: "previously an agent essentially got the brief, but then the ability to find much more information … we now have this rich data layer for it to find key bits of information, maybe research things if it wants" [checked, log "17 Nov"]. So a brief is small and deterministic, and says what exists; the stage pulls the rest.

**A brief** is what a stage of a task is given, computed, never retold:
1. **The person's words** (W1.5): the `asked` of the task and of each ancestor, verbatim.
2. **Its plan piece:** the current version, through the task's `piece` link.
3. **Addressed to it, in full:** open records `in` this task whose `to` is this stage, and open records anywhere whose `to` is this task.
4. **What stands about this task** (W2.4): judgements and decisions `in` the task, or `about`/`on` its piece or its change, with the stale flag. An ancestor's decisions appear only if `about` or `on` this task's piece; a sibling's never.
5. **Its areas** (W2.2): each area one of whose `paths` is a prefix of one of the task's paths, by id and name, so a stage can address the place. If none matches, the brief says so.
6. **For the stage with the place role only** (W1.6): those areas' open findings, in full. No other work enters a task, except by that stage re-addressing a finding to it.
7. **An index of what else is known** (W2.1): every other open record `in` the task, and every lesson whose paths overlap the task's or its piece's, one line each: id, kind, to, and the first line of what it says. Enough to know it exists and look it up. Area findings stay out (part 6 only).

Closed records are left out. Each brief reports what it carries and its size; reported, never a test.

**Queries** the stage may run (W2.1): `get <id>` (a record in full, with its versions), `find` (by kind, area, path, addressee, state or text), and `show --task`. Every query is logged with who asked, so a walk sees what each stage went looking for.

**An LLM may smooth the brief** for the task at hand, as Harbour's brief does today from ticket text; with records as input it does less of the work (John, log "17 Nov"). The model builds the deterministic part only.

**Harbour's code** reads fields directly; it never parses a brief.

## 4. The model build

*A fresh subagent builds the model from §3 and this section only, in `walks/<n>/model/`. Nothing else is given. It is thrown away after its round.*

- **Form.** Node, ES modules, no dependencies. `kinds.json`, `stages.json` and `people.json` (§3.2); `layer.mjs`; one JSON store with every record's versions. As small as it can be.
- **Commands** (CLI, JSON in and out):
  - `add <kind>`, `revise <id>` (with a reason), `end <id> <state> <reason> [--to <id>]`, `link <id> <type> <id>`. Every write takes `--by <stage or person>`, and optional `--at` so a finished task can be written in its own order.
  - `brief <stage> --task <id> [--as-of <time>]`: §3.4, as JSON and plain text, with what it carries and its size.
  - `show --task <id> [--as-of <time>]`: everything `in` the task and its runs, with states and stale flags: what the task looks like at that moment.
  - `get <id>` and `find [--kind] [--area] [--path] [--to] [--state] [--text]`: queries, each logged with `--by`.
  - `check`: validates the store against §3.2–3.3 and lists stale records.
- **Retro mode.** A store created with `--retro` logs rule hits instead of refusing; `hits` lists them.
- **Its own test.** A short script exercising each rule once in each mode, each command once, the stale flag, and each of the brief's seven parts, and each query. Run before any walk.

