# The layer: design (work in progress)

*Started 17 Nov at John's request (log, "17 Nov"). Revised in place each round; git keeps its history, the log keeps why, and each walk's results live in `walks/`. Marks are as on `situation.md`: [checked], [reported], [my reading], [guess]; "[checked wording]" means the words were checked, not the claim. Lines with no mark are design, mine until John corrects it.*

*Short names. Files on `claude/peaceful-euler-thz7ct` at `fff543172` are cited by name: `picture`, `shapes`, `mapping`, `existing`, `avenues`, `design-plan`, `my-words`. Essays and papers are under `docs/papers/harbour/` on main.*

## 1. What it is for

**The problem, in programming terms** [my reading, taken up by John: "Very good point about how the current data structure is strings appended"]. Before agents, the developer's head was the memory and the tracker a coordination aid on top of it. With many stateless stages, the loop is short-lived workers passing free text appended to shared places: ticket, comments, notes, prompts. That is a stringly-typed system:
- **Text written with no end leaks.** The area notes grew from 10.6 KB to 88.8 KB in six days (log:3909) [reported].
- **Every LLM reading is a parse, so retold facts drift.** One count was copied as 26, 25, 23, 22 and 12 (trace 6) [checked].
- **Broadcast with no addressee** means every reader's input grows with the history. In trace 1, each of seven sessions began by caching 63,000 to 97,000 tokens [checked].
- **Behaviour is patched by adding text.** John: the agents "become great contractors, following the rules precisely, but not actually giving us the software development process and results that we want", and information that "doesn't really have a home … compounds into tasks being much larger than they need" [checked, log "17 Nov"].

**The frame** (John, `shapes` §6) [checked]: "a data layer that carries the information", one general structure with declared shapes on it, with LLMs as components inside Harbour and as agents.

**What it is: a well-structured store.** John: "the data layer doesn't _act_ per say, agents act. Just like how tickets don't act." "This really doesn't need to be complex, it just needs to be correct for what Harbour needs." [checked, log "17 Nov"] Agents and Harbour write records and read them back. The store checks that each record has the right shape, keeps every version, and computes views from what it holds. Harbour and its agents decide who acts and when.

**John's two guards, as shape** (`shapes` §6): declared kinds with checked fields (types); and every record has a state with declared ends, and every record that hands something on has its addressee (a lifetime and ownership). Both are checked when a record is written, as a database checks a schema.

**The pressure it aims at is mental, not prompt length.** John: "I'm less worried about the prompt length, and more the cognitive pressures" [checked, log "17 Nov"]. People overlook subtraction, more so "under cognitive load" (`steering-text.md:204-206`, citing Adams et al. 2021) [checked]; code understanding collapses past about 32,000 tokens, and agents re-derive instead of reusing (`coherence-as-it-grows.md:182`) [checked wording]. So each reader is given what is addressed to it, the person's words and what is known about the paths it touches, and looks up the rest.

**Agents reason; the store keeps the books.** John: "ideally the agent is just doing its reasoning … and everything else is held through a sensible deterministic natural feeling system which we've had great success with using the proxy" [checked, log "17 Nov"]. Choosing who must act on something, and ending what one's work closed, is reasoning, and only the writer can do it. Ids, versions, links, counts, staleness and what a stage is given are bookkeeping, done by code. In Harbour, agents would reach the store through the proxy.

**What it is not** (`mapping` §8) [checked]: the work product (code, PRs, CI), Harbour's workflow and engine rules, systems out of reach (John's Jira), or the tracker's own account. Records link to these; they don't hold them. Judgement stays with the models ("Code holds the sequence and watches the seams; models keep the judgement", `between-the-sessions.md:168`) [checked].

**What it would replace in Harbour**, if built (`avenues` §2 A): the comment routes, the notes, the prune, rulings keyed by loop, and the comment classifier. The model replaces nothing; it runs beside Harbour and touches none of it.

## 2. How we learn: the method

John: "a small minimal MVP, and we take it for a walk and see a) if it's better than the current system, and b) where it still breaks (and why)." "If we rebuild it each time, we can intentionally avoid patching to fix issues." [checked, log "17 Nov"]

- **Rounds.** This page → a model built from §3–4 alone by a fresh subagent → walks → results in `walks/` → this page revised and refactored back. The next round rebuilds from scratch. A break is fixed here, never patched in the code.
- **Walks, cheapest first:** a finished task filled in after the fact; then stages replayed one at a time, each a fresh agent given its brief, its real output and the store to query; then short scenes from the traces' leak moments. Real work only once John is "satisfied fully" [checked, log "17 Nov"].
- **Each rebuild re-runs the previous walk,** so a changed result traces to a changed page.
- **Expectations first,** committed to `walks/<n>/expect.md` before looking.
- **Add, then refactor back** (John: "We need to add here to cover things, then "refactor" then back") [checked]. Each round asks first what can go.
- **Measures report, never gate** (log:3876) [checked].
- **Limits.** Every agent is one model family. A replay fixes each stage's work to what really happened, so it shows what the store holds and finds, not what a better brief would have changed.
- **This page holds the best version so far and points to the rest,** the answer for now to John's worry about losing strands [checked, log "17 Nov"].

## 3. The model

### 3.1 Every record

| Field | Meaning |
|---|---|
| `id` | Allocated by the store, stable, never a position |
| `kind` | One of the declared kinds (3.2); fields are checked against it |
| `in` | What it belongs to: a task or an area. A child task is `in` its parent |
| `by` | Who wrote it: a declared actor (3.2); `via` if relayed |
| `at` | When each version was written |
| `state` | The kind's starting state or one of its ends, with a `reason`. `handed-on` and `superseded` name the record that takes over |
| `to` | The addressee, required on the hand-off kinds (finding, check, question) and on no other: a declared actor, or a task or area record |
| `links` | `about` (its subject), `on` (the exact version it rests on, `id@v`; required on a verdict), `answers` (a decision to its question), `piece` (a task to its plan piece), `same-as` |
| versions | Every write (add, revise, end, link) is a new version with its `by`, `at` and, for a revise, its `reason`; earlier versions are kept. Any record can be read as of a time, or at a version. Any record may be revised, ended or not |

### 3.2 Kinds and actors

*Kinds are data: one generic record plus `kinds.json`.*

| Kind | Holds | Own fields | Starts → ends |
|---|---|---|---|
| `task` | The order | `asked` (the person's words, fixed once written; a child task has none), `done-when`, `paths` | open → done, declined |
| `plan` | One piece of how a task will be done; a parent's plan is its pieces | `says`, `paths`, `order` | kept → superseded |
| `finding` | Something someone must act on | `says`; `to` | open → done, declined, handed-on |
| `check` | A verification needing the person's systems | `what`, `why-person`, `how`; `to` | open → done, declined, handed-on |
| `question` | A call waiting on a decider | `asks`, `options`, `recommended`, `if-unanswered`; `to` | open → answered, withdrawn, handed-on |
| `decision` | What was decided and why, including a person's standing direction | `answer`, `why`, `scope` (optional: a task id; the decision covers that task and every task under it) | stands → superseded, withdrawn |
| `verdict` | A judgement `on` one version of a plan piece or change | `of` (plan-review, review, blind-read), `outcome` from that judgement's set, `reasoning` | stands → withdrawn |
| `lesson` | A lasting truth about the code, `in` an area | `says`, `paths`, `checked-at` (the commit it was last true at) | holds → superseded, disproved |
| `area` | A place in the code | `name`, `paths` | kept → retired |
| `change` | A handle on the work product: a PR, commit range or saved file; each new head is a new version | `ref`, `head` | open → merged, abandoned |
| `run` | One actor's session, `in` its task | `stage`, `claims` (paths it expects to touch), `account` (its own summary) | open → done |

**Outcome sets:** plan-review and review: approve, approve-with-notes, request-changes. Blind-read: better, same, worse.

**Open** records are those in state `open` (task, finding, check, question, change, run). The other kinds start in a standing state (kept, stands, holds).

**Paths overlap** when one is a prefix of the other. Every view and brief part that matches paths uses this.

**Actors** are declared in `actors.json`: the names that may appear in `by` and `to`. For Harbour: its stages (design, plan-review, breakdown, survey-task, survey-place, scoping, implementation, leftover, review, blind-read, close-out), the autopilot, John, and Harbour itself (the system). Another project declares its own. Any actor may write any kind and end any record; which ones it should is its prompt's business and Harbour's.

### 3.3 What a write checks

Only shape, so a malformed record can't enter:
- the kind is declared; every field belongs to it and has its type; a verdict's outcome is in its set; a task's `asked` doesn't change once written;
- `by` is a declared actor; the hand-off kinds (finding, check, question) have a `to` that is a declared actor or a task or area record, and no other kind has one;
- `in` is a task or area; every link resolves; a verdict has an `on`; `answers` and `piece` join the kinds named above;
- a state change goes to one of the kind's ends with a reason; `handed-on` and `superseded` name the record that takes over.

### 3.4 Views, computed when read

- **Open for a reader:** open records whose `to` is that actor, task or area.
- **Answered:** a question with a standing decision that `answers` it shows that decision beside it, whether or not its state has been ended yet.
- **Stale:** a record that is not ended and whose `on` link points to a version revised since, to a record superseded, withdrawn or abandoned, or to a record that is itself stale. Ending well (done, merged, answered) makes nothing stale. Shown as a flag.
- **Counts:** any `find` can return its count instead of its records, as of any time.
- **Overlap:** open runs whose `claims` share a path.

### 3.5 Reading: a brief, then queries

John: "previously an agent essentially got the brief, but then the ability to find much more information … we now have this rich data layer for it to find key bits of information, maybe research things if it wants" [checked, log "17 Nov"]. So the brief is small, deterministic and says what exists; the stage looks up the rest.

**A brief** is what an actor working on a task is given:
1. **The person's words:** the `asked` of the task and of each ancestor, verbatim.
2. **Its plan piece:** the current version, through the task's `piece` link.
3. **Addressed to it, in full:** open records `in` this task whose `to` is this actor, and open records anywhere whose `to` is this task.
4. **What stands about this task:** verdicts and decisions `in` the task, or `about` or `on` its piece or its change, each with the version it rests on and the stale flag. An ancestor's decisions appear when `about` or `on` this task's piece, or when they carry a `scope` that covers it; a sibling's never.
5. **Its areas:** each area whose paths overlap the task's, by id and name, with the number of open records addressed to it, so the actor can address the place and look up what is waiting there.
6. **Open runs** of other tasks whose claims share a path with this task.
7. **An index of what else is known:** every other open record `in` the task, and every lesson whose paths overlap the task's, one line each: id, kind, to, and the first line of what it says.

Ended records are left out. Each brief reports what it carries and its size in bytes of text.

**Queries:** `get <id>` (in full, with its versions; `<id>@<v>` for one version), `find` (by kind, in, area, path, addressee, state or text; `--count`), `show --task` (everything in the task, with states and flags). Every query takes `--as-of`. Queries are logged with who asked, so a walk can see what each stage went looking for.

**An LLM may smooth the brief** for the task at hand, as Harbour does today from ticket text; with records as input it does less of the work (John, log "17 Nov"). The model builds the deterministic part only. Harbour's code reads fields directly; it never parses a brief.

## 4. The model build

*A fresh subagent builds the model from §3 and this section only, in `walks/<n>/model/`. Nothing else is given. It is thrown away after its round.*

- **Form.** Node, ES modules, no dependencies. `kinds.json`, `actors.json`, `layer.mjs`, and one JSON store holding every record's versions and the query log. As small as it can be.
- **Commands** (CLI; JSON in and out; exit 0 ok, 1 usage, 2 refused with the reason):
  - Writes: `add <kind> '<json>'` (fields plus `in`, `to`, `links`), `revise <id> '<json>' --reason <r>`, `end <id> <state> <reason> [--into <id>]` (the record that takes over), `link <id> <type> <id[@v]>`. Each takes `--by <actor>`, and optionally `--via <name>` and `--at <time>`, so a finished task can be written in its own order.
  - `brief <actor> --task <id> [--as-of <time>] [--text]`: §3.5, with what it carries and its size.
  - Queries, each with `--by` and `--as-of`: `show --task <id>`, `get <id>[@<v>]`, `find [--kind] [--in] [--area] [--path] [--to] [--state] [--text] [--count]`.
- **Its own test,** run before any walk: each shape check refusing once, each command once, each view, and each part of the brief.

## 5. Walks

Walks 1–3 are in `walks/1/`–`walks/3/`. What they established about storing and finding: everything that happened had a home; written after the fact, 20 of 22 addressees had to be guessed, while stages writing live chose them unprompted; retelling stops when stages can look things up; briefs stop growing with the ticket's history [checked, results files]. None of these rested on the rules earlier rounds put on who may write or close [my reading]; walk 4 re-runs them without.

**Walk 4: walk 3 again, on this model.** The same three task replays (LIN-4450, LIN-4472, LIN-4455), from the same real outputs and parent state, and the same six scenes (`walks/3/situations/scenes.md`).
- **The question:** is everything that happened stored, addressed, ended or rightly open, and could each stage find what it needed?
- **A break,** each with why: something with no home; a hand-off to no reader; a thing retold that should be one record; something a stage needed that neither its brief nor a query gave it; a write refused that was right, or accepted that was malformed.
- **Listed, not scored** (John: "we don't need to worry too much about where the mistakes are coming from" if deterministic code or a full implementation will absorb them) [checked, log "17 Nov"]: the model's rough edges.

## 6. Open

- **John's:** the catalogue choices and the avenue (`avenues` §1, §6). The model lives in one store with checked calls, roughly avenue A, because a model has to live somewhere.
- **Not yet designed:** how the proxy exposes the store to agents; how the tracker shows records; pages for people (John's view, counts).

## 7. Sources

- John's words for this step: log, "17 Nov" (this branch).
- The frame: `shapes` §6. The needs and causes: `picture` §6–7. The catalogue and the avenues: `avenues`. Everything placed: `mapping`. What Harbour already has: `existing`.
- Traces: `trace-2026-11-15/` (peaceful-euler). Walks: `walks/1/`–`walks/3/`.
- Papers: `steering-text.md`, `coherence-as-it-grows.md`, `between-the-sessions.md`, `nothing-fights-its-shape.md` (main).
