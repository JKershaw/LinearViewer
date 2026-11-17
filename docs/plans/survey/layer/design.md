# The layer: design (work in progress)

*Started 17 Nov at John's request (log, "17 Nov"). This page is revised in place, never appended to; git keeps its history. Each walk's results live in `walks/`, and the page carries only what they changed. Marks are as on `situation.md`: [checked], [reported], [my reading], [guess]. Lines with no mark are design, which is mine until John corrects it. Round 2 folded in walk 1 (breaks W1.1–W1.7, `walks/1/results.md`); round 3 folds in walk 2 (W2.1–W2.10, `walks/2/results-4450.md`).*

*Short names. Files on `claude/peaceful-euler-thz7ct` at `fff543172` are cited by name: `picture`, `shapes`, `mapping`, `existing`, `avenues`, `design-plan`, `my-words`. Essays and papers are under `docs/papers/harbour/` on main.*

## 1. What it is for

**The problem, in programming terms** [my reading, taken up by John: "Very good point about how the current data structure is strings appended"]. Before agents, the developer's head was the memory, and the tracker was a coordination aid on top of it. With many stateless stages, the loop is short-lived workers passing free text appended to shared places: ticket, comments, notes, prompts. That is a stringly-typed system:
- **Text written with no end leaks.** The area notes grew from 10.6 KB to 88.8 KB in six days (log:3909) [reported].
- **Every LLM reading is a parse, so retold facts drift.** One count was copied as 26, 25, 23, 22 and 12 (trace 6) [checked].
- **Broadcast with no addressee** means every reader's input grows with the history. In trace 1, each of the seven sessions began by caching 63,000 to 97,000 tokens [checked].
- **Behaviour patched by adding text.** John: "the agents themselves become great contractors, following the rules precisely, but not actually giving us the software development process and results that we want", and the information that "doesn't really have a home … compounds into tasks being much larger than they need" [checked, log "17 Nov"].

**The frame** (John, `shapes` §6) [checked]: "a data layer that carries the information", one general structure with declared shapes on it, "converting the communication problem into a code problem, covering every aspect", with LLMs as components both inside Harbour and as agents.

**Two guards** (`shapes` §6): declared shapes with checked fields (types), and no shape without its end and its addressee (ownership and a lifetime).

**The pressure it aims at is mental, not prompt length.** John: "I'm less worried about the prompt length, and more the cognitive pressures" [checked, log "17 Nov"]. The papers: people overlook subtraction, and find it "less often under cognitive load" (`steering-text.md:204-206`, citing Adams et al. 2021) [checked]; code understanding collapses past about 32,000 tokens, and agents re-derive instead of reusing (`coherence-as-it-grows.md:182`) [checked wording]. So each reader carries only what is addressed to it, plus the person's words and what is known about the paths it touches.

**Agents reason; the system keeps the books.** John: "ideally the agent is just doing its reasoning … and everything else is held through a sensible deterministic natural feeling system which we've had great success with using the proxy" [checked, log "17 Nov"]. Choosing who must act on something and when it ends is reasoning, and only the writer can do it [my reading]: walk 1 couldn't recover it from prose (20 of 22 guessed) and walk 2's stages did it unprompted [checked]. Ids, versions, links, counts, staleness and hand-on chains are bookkeeping, and belong to code. In Harbour the agent would meet the layer through the proxy.

**What it is not** (`mapping` §8) [checked]: the work product itself (code, PRs, CI), the engine's rules (the near-deadlock), systems out of reach (John's Jira), and the tracker's single account. Records link to these; they don't hold them. It cures the memory half of the loop. Judgement stays with the models ("Code holds the sequence and watches the seams; models keep the judgement", `between-the-sessions.md:168`) [checked].

**What it would replace in Harbour**, if a design is ever built (`avenues` §2 A): the comment routes, the notes, the prune, rulings keyed by loop, and the comment classifier. The model replaces nothing; it runs beside Harbour and touches none of it.

## 2. How we learn: the method

John: "a small minimal MVP, and we take it for a walk and see a) if it's better than the current system, and b) where it still breaks (and why)." "If we rebuild it each time, we can intentionally avoid patching to fix issues." [checked, log "17 Nov"]

- **Rounds.** Each round: this page → a model built from §3–4 alone by a fresh subagent → walks → results in `walks/` → this page revised and refactored back. The next round rebuilds from scratch. A break is fixed here, never patched in the code.
- **Walks, cheapest first.** Finished tasks filled in after the fact; then stages replayed one at a time (§5); motion only "once we're confident with those cheap checks" [checked, John].
- **Each rebuild is checked against the previous walk** (re-run, or replayed as a control), so a changed result traces to a changed page, not to rebuild variation.
- **Expectations first,** committed to `walks/<n>/expect.md` before looking.
- **Add, then refactor back** (John: "We need to add here to cover things, then "refactor" then back") [checked]. Before each rebuild the page is refactored, asking first what can go.
- **Measures report, never gate** (log:3876) [checked].
- **Limits.** Every agent is one model family. A retro fill is extraction from prose and guessed 20 of 22 addressees in walk 1, so it can't test routing (W1, limit). A replay fixes each stage's work to what really happened, so it can't show what a better brief would have changed.
- **This page holds the best version so far and points to the rest,** the answer for now to John's worry about losing strands [checked, log "17 Nov"]. The walk folders leave the branch once John agrees a design; git keeps them.

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

## 5. Walks

Walks 1 and 2 are done (`walks/1/results.md`, `walks/2/results-4450.md`); their breaks are folded in above.

**Walk 3: three tasks and a set of situations,** on the round 3 model. John: "running it through just a bunch of tests and tasks and situations to really see if we are now containing everything" [checked, log "17 Nov"].
- **Task replays,** as walk 2 (seed the parent's part, then each stage a fresh agent with its brief, its real output and its kinds), now with queries allowed and logged:
  - LIN-4450, the control against walk 2;
  - LIN-4472 (trace 3: scoping's question to John settled by the autopilot 26 seconds later, his answer landing on another ticket);
  - LIN-4455 (trace 2: a tidy under autopilot).
- **Situations:** short scenes from the traces' leak moments the three tasks don't cover, each played by two or three agents on the model, from its trace's own words:
  - lanes asking each other and going ahead on silence (trace 6a);
  - a withdrawn ruling that left a false line behind (trace 6b);
  - a count copied five ways (trace 6c);
  - two overlapping sessions claiming the same item (Lighthouse c);
  - proposals piling with nothing declining them (Lighthouse a);
  - a small task on a project with neither git nor a tracker (paper walk).
- **The question for each:** is everything that happened contained, routed to a reader, ended or rightly open; and what did each stage have to go looking for?
- **What would count as a break,** each with why: something that happened with no home; a hand-off to no reader; a thing retold that should be one record; a stage that needed something it couldn't find by brief or query; a rule refusing something right.
- **Not scored as breaks, but listed** (John: "we don't need to worry too much about where the mistakes are coming from" if deterministic code or a full implementation will absorb them) [checked, log "17 Nov"]: the model's rough edges, and the expected miss of Harbour's standing rules, which have no record yet (W2.10).
- **After walk 3,** real work through the layer, or building it into Harbour, waits until John is "satisfied fully that the parts that were experimenting with are holding" [checked, log "17 Nov"].

## 6. Open

- **John's:** the four catalogue choices and the avenue (`avenues` §1, §6). The model takes the choices provisionally and lives in one store with checked calls, roughly avenue A, because a model has to live somewhere and that is the simplest to build. John has not ruled on either; he expects them to settle as we iterate.
- **Later configuration** (John, log "17 Nov"): how a session ends (a PR, staging, production) and Harbour's standing rules now in its prompts and code (W2.10). I have placed two more questions here as my reading, not John's ruling: whether a task may close over checks it raised (rule 1 lets it), and over an approval resting on a moved head (W2.7, shown, not stopped).
- **Not yet designed:** waking (an addressee finds what is open for it when its brief is computed); views beyond `show` (John's page, counts, who is working); how the tracker shows records; how the proxy exposes the layer to agents.

## 7. Sources

- John's words for this step: log, "17 Nov" (this branch).
- The frame: `shapes` §6. The needs and causes: `picture` §6–7. The catalogue and the avenues: `avenues`. Everything placed: `mapping`. What Harbour already has: `existing`.
- Traces: `trace-2026-11-15/` (peaceful-euler). Walk 1: `walks/1/`.
- Papers: `steering-text.md`, `coherence-as-it-grows.md`, `between-the-sessions.md`, `nothing-fights-its-shape.md` (main).
