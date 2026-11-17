## 3. The model

### 3.1 Every record

| Field | Meaning |
|---|---|
| `id` | Stable, allocated by the layer, never a position |
| `kind` | One of the declared kinds (3.2); fields are checked against it |
| `in` | What it belongs to: a task, an area, a project |
| `by` | Who wrote it (a stage, a run, John, Harbour), and `via` if relayed |
| `at` | When each version was written |
| `state` | Open, or one of the kind's declared ends, with `reason` |
| `to` | The addressee, on every hand-off kind |
| `links` | Typed: `about`, `answers`, `same-as`, `on` (a version of a record, or a PR head) |
| versions | Every write keeps the previous version. A reader may ask for any record as of a time; a retro walk needs this to read a brief as of a stage's start |

*Left out until a walk needs them* (`avenues` §1, §5): an `evidence` field (run or read), more link types, and the measured value as a field type.

### 3.2 Kinds

*Provisional. These are `avenues` §1's catalogue with John's four open choices taken one way, because a model can't be built without taking them some way: `ask` folded into `question`/`finding`; who-is-working as a view of `run`; measure left out (3.1); all five candidates in. For each choice, the walk reports what happened under it and what the other way would have done, so it informs the choice rather than settling it. John: "It feels like all these details will come out in the wash, as we iterate." [checked, 17 Nov]*

*Kinds are data, not code: one generic record plus `kinds.json`. So a kind costs a line of declarations, not a branch of the program. In motion, a stage is given only the few kinds it writes.*

*Walk 1 builds the first nine. `run` and `setting` stay on paper: walk 1's run rows stay outside as Harbour's own records, and the size policy is a decision whose basis is `policy`. The walk reports where it missed them.*

| Kind | Holds | Own fields | `to` | Ends |
|---|---|---|---|---|
| `task` | The order | `asked` (the person's words, fixed; a child links to its plan piece instead), `done-when`, `parent` | — | done, declined |
| `plan` | How it will be done | `pieces` (each linkable); each new version needs a `reason` | — | kept; superseded by a version |
| `finding` | Something someone must act on | `says`, `about` | a stage, a task, an area, John | done, declined, handed-on (to a named record) |
| `check` | A verification needing the person's systems | `what`, `why-person`, `how` | John or an operator | done, declined |
| `question` | A call waiting on a decider | `asks`, `options`, `recommended`, `if-unanswered` | one decider | answered, withdrawn, shelved |
| `decision` | What was decided, on what basis | `answer`, `basis` (question, setting or policy), `why` | — | stands, superseded, withdrawn |
| `verdict` | A judgement on one version of something | `outcome` (from the kind's fixed set), `on` | — | stands; stale when its subject moves |
| `lesson` | A lasting truth about the code | `says`, `about` (paths), `checked-at` | an area | holds, superseded, disproved |
| `area` | The place | `name`, `paths` | — | retired |
| `run` | One session's work | `task`, `stage`, `model`, `claims` (paths) | — | done |
| `setting` | A choice John makes once | `key`, `value`, `scope` | — | replaced |

### 3.3 Rules the code enforces

In motion, each is a refusal at write time. In a retro walk the history already happened, so a rule that would have refused is logged as a hit (the record, the rule, the time) and the write goes through; the hits are what the walk reads. Each rule, with its source:
1. A task can't close while records addressed to it are open (`avenues` §1, task).
2. A finding about a plan piece can't end as built differently without a newer version of that plan (`avenues` §4, trace 3a).
3. A question takes one decision; a second decider is refused (trace 3b).
4. A verdict goes stale when the version it is `on` is superseded (`avenues` §1, verdict).
5. Every hand-off kind (`finding`, `check`, `question`) needs `to` and an open state with declared ends (the second guard).
6. Links must resolve.

### 3.4 Reading: briefs and views

- **A brief** is what a reader is given, computed, never retold. For a stage of a task, as of a time:
  - the task's `asked`, and the current version of its plan piece;
  - open records addressed to this stage or this task;
  - decisions on the task;
  - lessons and open findings for the paths and areas it touches;
  - open checks, by state only.

  Closed records are left out. What it carries is reported: how many open things, and how many of them are instructions, alongside its size. Size is reported, never a test: the aim is load, not length (§1).
- **Views** are computed the same way: John's page (everything open addressed to him), counts (never typed), who is working (live runs), and a task's whole record (for the outside reader, need 5). Not built for walk 1.
- **Harbour's code** reads fields directly; it never parses a brief.
- **The tracker** is not designed yet (§6).

### 3.5 Waking

The model has no waking. An addressee finds what is open for it when its brief is computed. In a retro walk, "who would have been woken" is read off the briefs. Waking is tested in motion.

## 4. The model build

*A fresh subagent builds the model from this section and §3 only, in a new folder `walks/<n>/model/`. Nothing else is given. It is thrown away after its round.*

- **Form.** Node, ES modules, no dependencies. One declarations file (`kinds.json`, the kinds built this round, with their fields, ends and addressees from §3.2); one program (`layer.mjs`); one store file (JSON, every record with its versions). As small as it can be.
- **Commands** (CLI, JSON in and out):
  - `add <kind>` with fields: checked against `kinds.json`; refusal names the field or the rule.
  - `revise <id>` with changed fields and a reason: a new version.
  - `end <id> <state> <reason>`.
  - `link <id> <type> <id>`.
  - `brief <reader> --task <id> [--as-of <time>]`: §3.4, as JSON and as plain text, with its size.
  - `check`: validates the whole store against §3.2 and §3.3 and lists every failure.
- **Time.** Every write takes an optional `--at`, so a finished task can be filled in its own order and read as of any moment.
- **Retro mode.** A store opened with `--retro` logs rule hits (3.3) instead of refusing; `hits` lists them.
- **Its own test.** A short script that exercises each rule in §3.3 once in each mode, and each command once. It is written from this page too, and run before the walk.

