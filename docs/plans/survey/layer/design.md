# The layer: design (work in progress)

*Started 17 Nov at John's request (log, "17 Nov"). This page is revised in place, never appended to; git keeps its history. Each walk's results live in `walks/`, and the page carries only what they changed. Marks are as on `situation.md`: [checked], [reported], [my reading], [guess]. Lines with no mark are design, which is mine until John corrects it. Round 2 (17 Nov) folds in walk 1; changes cite its breaks as W1.1–W1.7 (`walks/1/results.md`).*

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

**What it is not** (`mapping` §8) [checked]: the work product itself (code, PRs, CI), the engine's rules (the near-deadlock), systems out of reach (John's Jira), and the tracker's single account. Records link to these; they don't hold them. It cures the memory half of the loop. Judgement stays with the models ("Code holds the sequence and watches the seams; models keep the judgement", `between-the-sessions.md:168`) [checked].

**What it would replace in Harbour**, if a design is ever built (`avenues` §2 A): the comment routes, the notes, the prune, rulings keyed by loop, and the comment classifier. The model replaces nothing; it runs beside Harbour and touches none of it.

## 2. How we learn: the method

John: "a small minimal MVP, and we take it for a walk and see a) if it's better than the current system, and b) where it still breaks (and why)." "If we rebuild it each time, we can intentionally avoid patching to fix issues." [checked, log "17 Nov"]

- **Rounds.** Each round: this page → a model built from §3–4 alone by a fresh subagent → walks → results in `walks/` → this page revised and refactored back. The next round rebuilds from scratch. A break is fixed here, never patched in the code.
- **Walks, cheapest first.** Finished tasks filled in after the fact; then stages replayed one at a time (§5); motion only "once we're confident with those cheap checks" [checked, John].
- **The previous walk is re-run on each rebuild,** so a changed result traces to a changed page, not to rebuild variation.
- **Expectations first,** committed to `walks/<n>/expect.md` before looking.
- **Add, then refactor back** (John: "We need to add here to cover things, then "refactor" then back") [checked]. Before each rebuild the page is refactored, asking first what can go.
- **Measures report, never gate** (log:3876) [checked].
- **Limits.** Every agent is one model family. A retro fill is extraction from prose and guessed 20 of 22 addressees in walk 1, so it can't test routing (W1, limit). A replay fixes each stage's work to what really happened, so it can't show what a better brief would have changed.
- **This page is the answer, for now, to John's worry about this work** ("dozens, if not hundreds, of different strands and ideas … inevitably we'll lose pieces of that information") [checked, log "17 Nov"]: it holds the best version so far and points to the rest.
- **What ends `walks/`:** the walk folders leave the branch once John agrees a design; this page cites the commit, and git keeps them.

## 3. The model

### 3.1 Every record

| Field | Meaning |
|---|---|
| `id` | Stable, allocated by the layer, never a position |
| `kind` | One of the declared kinds (3.2); fields are checked against it |
| `in` | What it belongs to: a task, an area, a project |
| `by` | Who wrote it (a stage, John, Harbour), and `via` if relayed |
| `at` | When each version was written |
| `state` | The kind's starting state, or one of its declared ends, with `reason`; `handed-on` and `superseded` name the record that takes over |
| `to` | The addressee, on every hand-off kind |
| `links` | Typed: `about`, `answers`, `same-as`, `on` (a version of a record) |
| versions | Every write keeps the previous version. A reader may ask for any record as of a time |

**Starting states** (W1.7): hand-off kinds start `open`. Every other kind starts in its standing state (a decision `stands`, a lesson `holds`, a verdict `stands`), so a brief counts as open only what is waiting on someone.

*Left out until a walk needs them:* an `evidence` field and the measured value as a field type (walk 1 left test counts and CI results unplaced; for now they sit in a run's `account` or a verdict's `reasoning`).

### 3.2 Kinds

*Provisional. `avenues` §1's catalogue with John's four open choices taken one way: `ask` folded into `question`/`finding`; who-is-working a view of `run`; measure left out; all five candidates in. Walk 1 added `change`. John: "It feels like all these details will come out in the wash, as we iterate." [checked, 17 Nov]. Kinds are data, not code: one generic record plus `kinds.json`.*

| Kind | Holds | Own fields | `to` | Starts → ends |
|---|---|---|---|---|
| `task` | The order | `asked` (the person's words, fixed; a child's is empty), `done-when`, `parent` | — | open → done, declined |
| `plan` | **One piece** of how a task will be done (W1.4). A parent's plan is its pieces, in order | `says`, `paths`, `order`; each new version needs a `reason` | — | kept → superseded |
| `finding` | Something someone must act on | `says`, `about` | a stage, a task, an area, John | open → done, declined, handed-on |
| `check` | A verification needing the person's systems | `what`, `why-person`, `how` | John | open → done, declined, handed-on (W1.2) |
| `question` | A call waiting on a decider | `asks`, `about`, `options`, `recommended`, `if-unanswered` | one decider | open → answered, withdrawn, shelved, handed-on |
| `decision` | What was decided, on what basis | `answer`, `basis` (a question, setting, verdict or the ask), `why` | — | stands → superseded, withdrawn |
| `verdict` | A judgement on one version of something | `of` (plan-review, review, blind-read), `outcome` from that judgement's set, `reasoning`, `on` (W1.1) | — | stands → stale, withdrawn |
| `lesson` | A lasting truth about the code | `says`, `paths`, `checked-at` | an area | holds → superseded, disproved |
| `area` | The place | `name`, `paths` | — | kept → retired |
| `change` | A handle on the work product: a PR or commit range. Each new head is a new version (W1.3) | `ref`, `head` | — | open → merged, abandoned |
| `run` | One session's work | `task`, `stage`, `claims` (paths), `account` (its own summary, in its words) | — | open → done |
| `setting` | A choice John makes once | `key`, `value`, `scope` (a project, or a task and everything under it) | — | stands → replaced |

**Outcome sets** (W1.1): plan-review and review: approve, approve-with-notes, request-changes. Blind-read: better, same, worse. Notes worth acting on are findings linked `about` the verdict, not prose inside it.

### 3.3 Rules the code enforces

In motion and in replay, each is a refusal at write time. In a retro fill, a rule that would have refused is logged as a hit and the write goes through.
1. A task can't close while records addressed to it are open.
2. A finding `about` a plan piece can't end `done` unless that piece has a version written after the finding: the correction reached its source (trace 3a).
3. A question takes one decision; a second decider is refused (trace 3b).
4. A verdict goes stale when the version it is `on` is superseded. That includes a `change` getting a new head (W1.3) and a plan piece getting a new version (W1.4, per piece only).
5. Every hand-off kind needs `to`. `handed-on` and `superseded` need the record that takes over.
6. Links must resolve.
7. **A decision whose basis goes stale is flagged**, not ended: it appears in briefs marked "resting on a stale verdict" until someone supersedes or re-affirms it (W1.4).

### 3.4 Reading: briefs and views

**A brief** is what a stage of a task is given, computed, never retold:
1. **The person's words** (W1.5): the `asked` of the task and of each ancestor, verbatim, nearest last. The person's intent reaches every stage of every child.
2. **Its plan piece:** the current version, with any verdicts on it.
3. **Addressed to it:** open records whose `to` is this stage or this task.
4. **Decisions** on the task and its ancestors, with rule 7's flag.
5. **Settings** whose scope covers the task.
6. **Lessons** whose `paths` overlap the plan piece's `paths`: knowledge, not instructions.
7. **The place, for one stage only** (W1.6): the open findings of the areas the task's paths fall in go to the stage whose job is the place (in Harbour, survey-place), and to no other. That stage may take one on by re-addressing it to the task, and it is recorded who chose. No other work enters a task. Walk 1 showed the alternative, every stage seeing every area finding, rebuilding the `Retires:` conveyor's pull.
8. **Open checks on the task,** by state; in full for the stage that closes the task.

Closed records are left out. Each brief reports what it carries (open things, how many addressed to it) and its size; size is reported, never a test.

**Views:** John's page (everything open addressed to him), counts (never typed), who is working (open runs), a task's whole record (for the outside reader, need 5). Not built until a walk needs them.

**Harbour's code** reads fields directly; it never parses a brief. **The tracker** is not designed yet (§6).

### 3.5 How a stage meets the layer

A stage is given three things: its brief; the kinds it may write, with their fields; and one instruction: *write what you found as records, each addressed to whoever must act; end what you closed; link what you built on; put your own account in your run.* Its prose lives in its run's `account`, read by people and never routed.

What each stage writes, as a starting point (in Harbour's pipeline; another project's stages would declare their own):

| Stage | Writes |
|---|---|
| survey-task, survey-place | finding, question, check, lesson; survey-place may re-address an area finding to the task |
| scoping | decision (size, cuts) |
| implementation | plan (new version of its piece), decision, finding, change |
| review, blind-read | verdict, finding, check |
| close-out | ends and hand-ons; change (merged); finding, check |
| every stage | its run |

### 3.6 Waking

No waking yet. An addressee finds what is open for it when its brief is computed. Tested in motion.

## 4. The model build

*A fresh subagent builds the model from §3 and this section only, in `walks/<n>/model/`. Nothing else is given. It is thrown away after its round.*

- **Form.** Node, ES modules, no dependencies. `kinds.json` (the kinds, fields, addressees, starting states, ends and outcome sets of §3.2); `layer.mjs`; one JSON store with every record's versions. As small as it can be.
- **Commands** (CLI, JSON in and out):
  - `add <kind>` with fields; `revise <id>` with changed fields and a reason; `end <id> <state> <reason> [--to <id>]`; `link <id> <type> <id>`.
  - `brief <stage> --task <id> [--as-of <time>]`: §3.4, as JSON and plain text, with what it carries and its size.
  - `check`: validates the store against §3.2–3.3, including rule 7's flags.
- **Time and author.** Every write takes `--by`, and optional `--at` so a finished task can be written in its own order.
- **Retro mode.** A store created with `--retro` logs rule hits instead of refusing; `hits` lists them.
- **Its own test.** A short script that exercises each rule once in each mode, each command once, and the brief's eight parts. Run before any walk.

## 5. Walks

**Walk 1** (done): LIN-4450 filled in after the fact. Results: `walks/1/results.md`. The shapes held a real task; briefs were 8–16% of the tracker text; seven breaks, folded in above.

**Round 2:**
1. **Re-fill walk 1** on the rebuilt model, as a check that W1.1–W1.7 are fixed and nothing regressed. One fresh agent, the same material.
2. **Walk 2: stages replayed one at a time.** For each task, each stage in order is a fresh agent given its brief from the layer as it stands, that stage's real output from the history ("what you did this session"), and the kinds it may write (3.5). It writes its own records, choosing addressees and ends. After each step the task is snapshotted: what is open, for whom, and the next stage's brief. Each stage also notes anything its real output relied on that its brief didn't carry.
   - Tasks: LIN-4450 first (the control, against walk 1), checked before the others; then LIN-4472 (trace 3: a question to John settled by the autopilot 26 seconds later, his answer landing on another ticket) and LIN-4455 (trace 2: a tidy under autopilot).
   - What it tests that walk 1 couldn't: routing written by the stage; whether a brief built only from earlier stages' records is enough for the next; how load grows across a task's life.

**What would count as a break,** each with why: a stage that can't place what it found; a brief missing what its real output relied on, or carrying what it didn't need; routing that sends a thing nowhere or to the wrong reader; load that grows with the task's history rather than with what is open; a rule refusing something that was right.

## 6. Open

- **John's:** the four catalogue choices and the avenue (`avenues` §1, §6). The model takes the choices provisionally and lives in one store with checked calls, roughly avenue A, because a model has to live somewhere and that is the simplest to build. John has not ruled on either; he expects them to settle as we iterate.
- **From walk 1, not yet answered:** should a task close over checks it raised? (They are addressed to John, so rule 1 lets it.)
- **Not yet designed:** waking; how the tracker shows records; John's page.

## 7. Sources

- John's words for this step: log, "17 Nov" (this branch).
- The frame: `shapes` §6. The needs and causes: `picture` §6–7. The catalogue and the avenues: `avenues`. Everything placed: `mapping`. What Harbour already has: `existing`.
- Traces: `trace-2026-11-15/` (peaceful-euler). Walk 1: `walks/1/`.
- Papers: `steering-text.md`, `coherence-as-it-grows.md`, `between-the-sessions.md`, `nothing-fights-its-shape.md` (main).
