# The layer: design (work in progress)

*Started 17 Nov at John's request (log, "17 Nov"). This page is revised in place, never appended to; git keeps its history. Each walk's results live in `walks/`, and the page carries only what they changed. Marks are as on `situation.md`: [checked], [reported], [my reading], [guess]. Lines with no mark are design, which is mine until John corrects it.*

*Short names. Files on `claude/peaceful-euler-thz7ct` at `fff543172` are cited by name: `picture`, `shapes`, `mapping`, `existing`, `avenues`, `design-plan`, `my-words`. Essays and papers are under `docs/papers/harbour/` on main.*

## 1. What it is for

**The problem, in programming terms** [my reading, taken up by John: "Very good point about how the current data structure is strings appended"]. Before agents, the developer's head was the memory, and the tracker was a coordination aid on top of it. With many stateless stages, the loop is short-lived workers passing free text appended to shared places: ticket, comments, notes, prompts. That is a stringly-typed system:
- **Text written with no end leaks.** The area notes grew from 10.6 KB to 88.8 KB in six days (log:3909) [reported].
- **Every LLM reading is a parse, so retold facts drift.** One count was copied as 26, 25, 23, 22 and 12 (trace 6) [checked].
- **Broadcast with no addressee** means every reader's input grows with the history. In trace 1, each of the seven sessions began by caching 63,000 to 97,000 tokens [checked].
- **Behaviour patched by adding text.** John: "the agents themselves become great contractors, following the rules precisely, but not actually giving us the software development process and results that we want", and the information that "doesn't really have a home … compounds into tasks being much larger than they need" [checked, log "17 Nov"].

**The frame** (John, `shapes` §6) [checked]: "a data layer that carries the information", one general structure with declared shapes on it, "converting the communication problem into a code problem, covering every aspect", with LLMs as components both inside Harbour and as agents.

**Two guards** (`shapes` §6): declared shapes with checked fields (types), and no shape without its end and its addressee (ownership and a lifetime).

**The pressure it aims at is mental, not prompt length.** John: "I'm less worried about the prompt length, and more the cognitive pressures" [checked, log "17 Nov"]. The papers: people overlook subtraction, and find it "less often under cognitive load" (`steering-text.md:204-206`, citing Adams et al. 2021) [checked]; code understanding collapses past about 32,000 tokens, and agents re-derive instead of reusing (`coherence-as-it-grows.md:182`) [checked wording]. So the layer's first job on the read side is that each reader carries only what is open and addressed to it.

**What it is not** (`mapping` §8) [checked]: the work product itself (code, PRs, CI), the engine's rules (the near-deadlock), systems out of reach (John's Jira), and the tracker's single account. Records link to these; they don't hold them. It cures the memory half of the loop. Judgement stays with the models ("Code holds the sequence and watches the seams; models keep the judgement", `between-the-sessions.md:168`) [checked].

**What it would replace in Harbour**, if a design is ever built (`avenues` §2 A): the comment routes, the notes, the prune, rulings keyed by loop, and the comment classifier. The model replaces nothing; it runs beside Harbour and touches none of it.

## 2. How we learn: the method

John: "a small minimal MVP, and we take it for a walk and see a) if it's better than the current system, and b) where it still breaks (and why)." "If we rebuild it each time, we can intentionally avoid patching to fix issues." [checked, log "17 Nov"]

- **Rounds.** Each round: this page → a model built from §4 alone by a fresh subagent → a walk → results in `walks/` → this page revised. The next round rebuilds from scratch. A break is fixed here, never patched in the code.
- **Walks, cheapest first.** First, finished tasks filled in after the fact: "see how it fits, see how the information comes out". Motion (live stages writing to it) comes "only once we're confident with those cheap checks" [checked, John].
- **The same walk is re-run on each rebuild,** so a changed result traces to a changed page, not to rebuild variation.
- **Expectations first.** Before each walk, what the design predicts and what would count as a break are written to `walks/<n>/expect.md` and committed before looking.
- **Add, then refactor back** (John: "We need to add here to cover things, then "refactor" then back") [checked]. A walk's lessons may grow this page; before the next round, the page is refactored, asking first what can go.
- **Measures report, never gate** (log:3876) [checked].
- **Limits named up front.** Every agent is one model family. Filling a task in after the fact is extraction from prose, the weak arm of the Yap spike, which guessed addressees in 34 of 71 records (`avenues` §5) [checked]. So retro walks test the shapes and the reading, not who writes. Writing is tested in motion.
- **This page is also the answer, for now, to John's worry about this work** ("dozens, if not hundreds, of different strands and ideas … inevitably we'll lose pieces of that information") [checked, log "17 Nov"]: it holds the best version so far and points to the rest, so nothing rests on one session's memory. Holding this project's own strands in the model is a later walk if John wants it [my proposal].
- **What ends `walks/`:** like the mapping and avenues (`design-plan`, "Where things live"), the walk folders leave the branch once John agrees a design; this page cites the commit, and git keeps them.

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

## 5. Walks

### 5.1 Walk 1: LIN-4450, filled in after the fact

**Why this task.** It is the smallest trace (16 rows), an ordinary task, and it holds the loop's typical leaks [checked, trace 1]:
- one finding (the bulk-path gap) retold six times, ending as a note entry with no owner;
- a live probe proposed before coding that became "not verified", then "not run", a piece of its own, two runbooks and a hand-back;
- a plan never changed while five departures sat beside it as a comment on the parent;
- a size decided "by the standing policy";
- fixes after approval that nobody re-read.

**Material.** The ticket and its comments (LIN-4450 and the parts of LIN-4445 it points to), PR #2421, and Harbour's run records, as the trace read them through Harbour's read-only proxy and GitHub. On 17 Nov the proxy reset the connection; access is checked before the walk starts. The trace itself is not given to the filler, so that the walk tests the material, not the trace's reading of it.

**Steps.**
1. Expectations committed (`walks/1/expect.md`).
2. The model is built and its own test passes.
3. **Fill.** A fresh subagent, given §3, the model and the material, writes the records stage by stage in the order and at the times they happened, as each stage would have. Where the material doesn't say who must act or who decides, it writes its best answer and marks it `guessed`. Anything it can't place goes to an unplaced list with the reason.
4. **Read out.** For each of the seven stages, the brief as of that stage's start, against what that stage could read on the tracker then (ticket text plus the pointed-to parent text, a lower bound on what it started with).
5. **Check by script and by me:**
   - **Fit.** Every one of trace 1's 16 rows lands on a record, or is on the unplaced list. Placings that stretched a kind are noted.
   - **Retelling.** How many records the bulk-path gap and the live probe become, against six and seven retellings today.
   - **Rules.** Where the trace says something went wrong, does a §3.3 rule hit, and would refusing have helped or got in the way? For example: close-out while the probe check and the bulk-path finding are open; the departures forced into plan versions; the size decision showing its basis as a policy, not John.
   - **Out.** Whether each brief answers what its stage needed (from the trace's "what they did with it"); anything a stage used that its brief lacks; what each brief carries that its stage didn't need. Sizes reported beside today's text.
   - **Guesses.** How many addressees and deciders were `guessed`: where the prose didn't carry routing.
6. Results in `walks/1/results.md`, each line marked. Then this page is revised and refactored back (§2), and the walk is re-run on a rebuilt model before anything else.

**What would count as a break**, each reported with why it broke (fuller list in `expect.md`): a row with no home that should have one; a kind taking unlike pieces; a brief missing something its stage used, or carrying what it didn't need; a rule that would have refused something that was right.

### 5.2 After walk 1

More finished tasks filled the same way: the other five traces and Lighthouse. Motion comes only when John judges the cheap checks hold.

## 6. Open

- **John's:** the four catalogue choices and the avenue (`avenues` §1, §6). The model takes the choices provisionally (3.2) and lives in one store with checked calls, roughly avenue A, because a model has to live somewhere and that is the simplest to build. John has not ruled on either; he expects them to settle as we iterate. Rebuilding each round keeps both cheap to change.
- **Access** to the ticket material for walk 1 (5.1).
- **Not yet designed:** waking (3.5); how the tracker shows records; how agents meet the calls in motion.

## 7. Sources

- John's words for this step: log, "17 Nov" (this branch).
- The frame: `shapes` §6. The needs and causes: `picture` §6–7. The catalogue and the avenues: `avenues`. Everything placed: `mapping`. What Harbour already has: `existing`.
- Trace 1: `trace-2026-11-15/1-LIN-4450.md` (peaceful-euler).
- Papers: `steering-text.md`, `coherence-as-it-grows.md`, `between-the-sessions.md`, `nothing-fights-its-shape.md` (main).
