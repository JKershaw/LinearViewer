# Avenues: four ways the design could go

*Drafted 16 Nov under `design-plan.md` §2, from `mapping.md` (M) and `existing.md` (E). Marks are as on `situation.md`. Everything here is [my reading] unless marked.*

*This holds no recommendation (words §10). Cost is left out of the comparison. Each avenue says what it adds, what it replaces and what ends each new thing (words §9). Each is drawn clean first, and only then says what existing functionality it would use (words §10).*

## 1. What all four share: the shapes catalogue

The frame is chosen: one general structure with declared shapes on it (words §9, shapes §6). This catalogue fills the frame in from the mapping. Every field cites the mapping rows that need it, so nothing is designed ahead of the evidence (shapes §3 B, first risk). The avenues differ in how they hold, write, wake and read these shapes, not in the shapes themselves, except where §2 says so.

### Every record carries

| Field | Why | Rows |
|---|---|---|
| A stable id, never a position | References broke when they pointed by position or at rebased commits | T2.13, T2.34, LB.17 |
| Its kind | The declared shape, with checked fields | shapes §6 guards |
| What it belongs to: a task, an area, a project | Some records span repositories | T5.1 |
| Who wrote it | Every comment shows John; a keeper's "agree" was typed by an agent; a review was relayed | P4.4, LA.2, LB.1, LB.13, T5.9 |
| Earlier versions, kept | Corrections in place lost history in Lighthouse; snapshots kept it in Harbour | P9.2, LA.16, T1.15 |
| Its state, and an end | Places with no end are where text piles up | P6.2, §8 |
| Links that resolve: to records, and to commits, PRs and file paths | Dangling citations; decisions cited wrongly | T3.16, T5.23, LB.20 |
| "Same as": a link proposed when it duplicates another record | Two surveys in the same words; one decision filed twice | T1.13, T2.10, T4.20 |

**A measured value is a field type, not a shape:** the value, plus the commit it was taken at, plus how it was taken. A summary cites it and never retypes it (T3.5, T3.20, T5.28, T6.23, T6.26; mapping §6 group 6).

### The shapes

| Shape | Holds | Its own fields | Written by | For | Ends | What code does | Rows |
|---|---|---|---|---|---|---|---|
| **task** | The order | `asked`: the person's words, fixed. For a child, a link to its plan piece, never an agent's words under the person's heading (T1.2). Also `kind`, `parent`, `blocks`, `done-when`, `window` | John, or the driving session for him (marked as relayed); a breakdown creates children | Every stage of it | done / declined | Refuses to close while records addressed to it are open; children read their plan piece's current version | T1.1, T1.2, T2.1, T2.6, T3.1, T3.6, T4.1, T4.4, T5.5, T6.1, LA.6, LB.3 |
| **plan** | How the task will be done | `body`; `pieces`, each linkable; each version's reason (a departure) | The plan stage; new versions by builds and children; pieces by the breakdown | The tasks that link to it | Kept when its task closes; nothing prunes it | A new version flags each child whose piece changed | T1.3, T1.9, T2.3, T2.12, T3.2, T3.7, T5.2, T5.6, T6.7, T6.15 |
| **finding** | Something someone must act on | `says`, `about` (a path, area, plan piece or record), `addressee` (a stage, this task, a named task, a lane, an area, John), end reason | Any stage | Its addressee | done / declined / handed on | Reaches the addressee (§2 differs here); a task cannot close over findings addressed to it; counts are computed | T1.4, T1.5, T2.9, T2.21, T4.12, T4.15, T6.20, T6.33 |
| **check** | A verification that needs the person's systems | `what`, `why it needs the person`, `how` (runbook), `result` | Any stage | John, or an operator | done / declined | On John's page, re-surfacing on a timer as shelved rulings do (E4). A parent reads its state instead of retelling it | T1.4, T1.14, T2.20, T2.26, T3.28, T3.31, T6.30, T6.32 |
| **question** | A call waiting on a decider | `asks`, `options`, `recommended`, `if unanswered`, `reasoning`, `suggested answer`, `anchor task`, `blocks` | Any stage | One decider, resolved from a setting by kind of question (D6) | answered / withdrawn / shelved | Reaches the decider; refuses a second decider (T3.14); an answer attaches to the anchor task wherever it is given (T3.21, T6.10) and wakes the asker | T3.13, T3.15, T3.30, T5.8, T5.22, T6.5, T6.10, T6.19, T6.24, T6.27 |
| **decision** | What was decided, by whom, on what basis | `answer`, `decider`, `basis` (a question, a setting, a policy), `why` | The decider | Whoever reads its task | stands / superseded / withdrawn | Attaches to its question or task; summaries cite it | T1.6, T3.12, T3.14, T5.10, T6.4, LA.2, LB.11 |
| **verdict** *(candidate)* | A judgement on one version of something | `on` (a PR head or plan revision), `outcome` from the kind's fixed set, `ledger` (linked findings and checks) | Review, blind read, plan review, second read | Gates and close-out | stands / superseded, automatically when its subject moves | Gates read the outcome field, not prose (E8) | T1.12, T2.20, T3.28, T4.9, T6.17, T6.28, T6.30, LB.15 |
| **lesson** *(candidate)* | A lasting truth about the code | `says`, `about` (paths or an area), `evidence`, `checked at` (a commit) | Builds, leftover runs, reviews | An area | holds / superseded / disproved | Enters the reading of tasks that touch its paths; flagged when those paths change | T1.11, T2.2, T2.18, T3.19, T3.24, T3.26, T5.13, T5.16 |
| **area** *(candidate)* | The place | `name`, `paths` | John, or a breakdown | An addressee for findings and lessons | retired | The next task to touch its paths receives its open findings and lessons. Routing into live tasks is what worked before (log:1449) | T1.5, T3.27, T3.37, T4.23, T5.23 |
| **run** *(candidate)* | One session's work | `task`, `stage`, `model`, `times`, `state`, `cost`, `claims` (paths) | Harbour | Harbour and John | done | Live runs are who is working; overlapping claims are flagged or refused | T1.16, T2.21, T3.35, T4.24, T5.30, T6.34, LA.8, LA.16, P9.6 |
| **setting** *(candidate)* | A choice John makes once | `key`, `value`, `scope`, with a log of changes | John | The components | replaced | Deciders and models resolve from settings, never from prompt text | T3.36, LB.6, P3.1, and the who-decides lines in T1.1, T3.1, T6.1 |

### Four catalogue choices for John

These all come out of the mapping. None is decided here.
1. **`ask` dissolves.** A request to another lane is a `question` whose decider is that lane (T6.6, T6.13, T6.14), or a `finding` addressed to it (T2.21). Silence then leaves the question open, never consent. This also removes the clash between `ask` and the task's ask (mapping §7).
2. **`who is working` becomes the live view of runs.** It is not a shape of its own.
3. **A measure becomes a field type.** It is not a shape.
4. **The candidates.** Verdict, lesson, area, run and setting would be in. Task is needed by everything. Each is John's yes or no.

### Two answers the same in every avenue

- **Need 5, the reader sees everything.** The outside reader is given the change's diff, plus every record the task wrote. In avenue C the records are in the diff anyway.
- **Duplicates.** When a record is written, a model proposes "same as" links. It never merges anything. This is the pattern of the dismissal suggestions: an agent may propose, never act (E4).

## 2. The four avenues

The avenues differ on the questions the mapping shows matter (`design-plan.md` §2):
- where the structure lives
- how agents write to it
- how earlier values are kept
- how an addressee is reached
- what each reader is given

### A. Records in Harbour, written by checked calls, addressees woken by code

- **Where it lives.** One collection in Harbour's store. Items of every declared kind, with checked fields and links, as the local store already holds several kinds (E, the general structure).
- **How it is written.** Agents write records through checked calls. A call with a missing or wrong field is refused, as the proxy already refuses a leftover answer without its line (E2). Prose lives inside fields: `says`, `body`, `reasoning`.
- **History.** Every write keeps the previous version of the record.
- **How addressees are reached.** Push. When a record opens with an addressee, code wakes it:
  - A stage of a running task gets it in its next prompt.
  - A lane's session is woken, as a child now wakes its parent (E5, E14).
  - John sees his records on one page, re-surfacing on timers (E4).
  - An area's records go to the next task that touches its paths.
- **What each reader is given.** A brief computed from records: the task, its plan piece's current version, the open records addressed to it, its decisions, and the lessons for its paths. Closed records are left out.
- **The tracker and the repository.**
  - The tracker gets one rendered section, which is replaced, never appended to. John keeps reading Linear.
  - Nothing new goes into the repository.
- **Any project.** Works with or without git and with or without a tracker, because Harbour holds the records. It needs Harbour.
- **Adds:**
  - the collection and its declarations
  - the checked calls
  - the wake rules
  - the computed brief
  - John's page
- **Replaces:**
  - the comment-based routes (M §4, R1–R7)
  - the prune
  - the notes, whose entries move in
  - rulings keyed by loop
  - the comment classifier
- **What ends each new thing:**
  - Each record ends at its declared end.
  - The writing in two places, during the move, ends when the last prose route is deleted.
- **Would use:**
  - the store pattern, and the local store's single collection
  - the up-chain wake
  - the rulings machinery and its re-surface timer
  - the run-proposal pattern
  - model routing, as a setting
  - dispatch and cost rows, as runs
  - the brief and recap, fed records instead of text
- **What it risks:**
  - Two copies while moving.
  - Agents learning the calls, which the spike in §5 tests.
  - The repository and anyone outside Harbour see nothing unless Harbour renders it.

### B. A log of events in Harbour: state is computed, addressees subscribe

- **Where it lives.** An append-only log in Harbour's store. Each entry is a typed, checked event: `finding raised`, `finding re-addressed`, `plan revised`, `verdict given`, `question answered`, `run claimed`, `merged`.
- **How it is written.** Agents emit events through checked calls. Code emits the engine's own facts.
- **History.** The log is the history. Any record's current state is computed from its events, and so is its state at any earlier time.
- **How addressees are reached.** Subscriptions. Each addressee (a stage, a lane, John, an area) subscribes to events addressed to it, and code delivers them.
- **What each reader is given.** Views computed from the log for that reader. Closed things fall out of the view by construction.
- **The tracker and the repository.** As A.
- **Any project.** As A.
- **Adds:**
  - the log and its event types
  - the subscriptions
  - the views
- **Replaces:** as A.
- **What ends each new thing:**
  - Records end by an event.
  - The log itself has no end, but nobody reads it whole; only the views read it.
- **Would use:**
  - the repository's append-only log pattern (`lib/close-out-events-store.js`, header: "Mirrors this repo's append-only-log pattern") [checked]
  - model routing's change log
- **What it risks:**
  - Changing an event's type later is a known cost of this pattern.
  - Hand repair is harder: a mistake is fixed by a new event, not an edit.
  - More machinery than A.
  - Retelling becomes impossible, which is the point. But so does a quick fix by hand.

### C. Records as checked files in the project's repository: runs pull what is due

- **Where it lives.** A folder in the project's own repository: one file per record, typed, with the declarations as a schema file. A checker in the tests requires the fields, an end and an addressee on every hand-off, resolving links, and no duplicate ids (shapes §3 C).
- **How it is written.** Agents write record files in their PR. John's answers and checks reach the files through commits, by Harbour or by him.
- **History.** Git.
- **How addressees are reached.** Pull. Each run reads the records addressed to it when it starts. A scheduled run picks up what is due, as Lighthouse's daily run does. John's to-dos are rendered from the files.
- **What each reader is given.** A script computes it from the files.
- **The tracker and the repository.**
  - The repository holds everything.
  - Harbour, the tracker and any site render from it.
  - Runs and settings stay in Harbour, because they are Harbour's own.
- **Any project.** Works without Harbour, because this is Lighthouse's shape. It needs git, and it puts Harbour's files in the person's repository, where "Harbour is a passenger" (log:3609).
- **Adds:**
  - the folder and its schema
  - the checker
  - the view script
  - the scheduled pull
- **Replaces:**
  - the notes, which become records
  - the ticket as the plan's carrier
  - the comment-based routes
- **What ends each new thing:**
  - The checker's demands end each record.
  - Closed files stay in the tree unless something moves them out. Lighthouse's closed rows still added to what runs read (picture §9 #1).
- **Would use:**
  - the census-test pattern, for the checker (E12)
  - `areas.json`, for areas (E13)
  - the area-notes guard (E9)
- **What it risks:**
  - Branches can't see each other until they merge (trace 4).
  - Nothing is woken except by a schedule.
  - Lighthouse's evidence: its lists grew, its standing text grew, and two runs took LH051 (picture §9).

### D. Agents keep writing prose: a model in Harbour turns each output into records

- **Where it lives.** As A.
- **How it is written.** Agents write as they do now: comments, final messages, notes. After each stage, a model call in Harbour reads the output and writes the records it carries: findings with addressees, checks, questions, plan versions, verdicts. This is the comment classifier (E8) widened from headings to content, and the scan, which already finds operator decisions in task text (`lib/scan.js`, `lib/task-decisions-store.js`) [checked headers].
- **History, waking and what each reader is given.** As A.
- **The tracker and the repository.** As A. The prose also stays where it is written.
- **Any project.** As A. It could also read Lighthouse's files.
- **Adds:**
  - the collection, as A
  - an extraction call per stage output
  - the wake rules and the computed brief
- **Replaces:**
  - the routes, as A
  - but the prose stays, so the retelling is not removed at its source
- **What ends each new thing:**
  - Records end as in A.
  - The prose has no end of its own.
- **Would use:**
  - everything A would
  - the scan, the recap and the classifier
- **What it risks:**
  - A second model's reading stands between the writer and the record. A misread addressee is a lost hand-off.
  - It keeps the prose, the classifier and the comments that John cautioned against inheriting (words §10, E's list).
  - Prompts change least.

## 3. Where they differ

### The axes

| | A | B | C | D |
|---|---|---|---|---|
| Where it lives | Harbour's store | Harbour's store, as a log | The project's repository | Harbour's store |
| Who writes the record | The agent, by checked call | The agent, by checked event | The agent, as a file in its PR | A model in Harbour, from the agent's prose |
| Earlier values | Versions per record | The log | Git | Versions per record |
| How an addressee is reached | Code wakes it | It subscribes | It pulls at start, or on a schedule | Code wakes it |
| Needs Harbour | Yes | Yes | No | Yes |
| Needs git | No | No | Yes | No |

### Each direction of travel (picture §2)

| Direction | A | B | C | D |
|---|---|---|---|---|
| Down | Children link to the current plan piece | The same, as a view | The same, through files on main | As A |
| Up | A correction is the plan's next version | A `plan revised` event | A correction to the plan file, in the PR | As A, if the extraction spots the departure |
| Across | A question or finding to the lane wakes it at once | Delivered by subscription at once | Seen only after the PR merges | As A, if the extraction finds the addressee |
| Out of the task | The addressee is woken, or the next task touching the area | The same, by subscription | Read by whichever run next pulls | As A, after extraction |
| Out of reach | A check on John's page, re-surfacing | The same | A file that must be rendered somewhere for John | As A |
| Retold | Summaries computed | Views computed | Script output | Computed, but the prose retellings stay |
| Written where no one checks | The reader gets the diff plus the task's records | The same | In the diff by construction | As A |

### Each cause (picture §6)

| Cause | A | B | C | D |
|---|---|---|---|---|
| The only memory is what is written | The records are that memory | The log is that memory | The files are that memory | Records plus the prose they came from |
| Places with no end | Every record has an end | Every record has an end; the log does not, and is never read whole | Every record has an end; closed files stay in the tree | As A for records; the prose has none |
| Sources frozen by design | The plan is versioned; the task's words stay fixed | The same | The same, in git | The same |
| No path sideways or back | Wake | Subscription | None until merge | Wake, after extraction |

### What each reader is given

| Reader | A | B | C | D |
|---|---|---|---|---|
| A stage | A brief computed from open records | A view computed from the log | A script's view of the files | As A |
| Harbour's code | Fields, read directly | Events and views | Files, through a reader | Fields, after extraction |
| John | One page of his records, plus the tracker's section | The same | A rendering of the files | As A |
| The tracker | One section, replaced | The same | Rendered from the files | As A, plus the prose it already has |

### Kinds of project

| Project | A | B | C | D |
|---|---|---|---|---|
| Harbour, on Linear | Yes | Yes | Yes, with files in its repository | Yes |
| Lighthouse: files, no tracker, one agent at a time | Only if it runs on Harbour | The same | Its own shape, already | Could read its files |
| No git | Yes | Yes | No | Yes |
| No tracker | Yes, through the local workspace | Yes | Yes | Yes |
| Not run through Harbour | No | No | Yes | No |

### The misfits (mapping §8)

None of the four changes:
- the engine's rules, including the near-deadlock
- systems out of reach
- the prompt text's own growth
- the work product itself

C changes the tracker's single account in one respect: the writer of a file is git's committer. A, B and D can hold the true writer as a field, but the tracker still shows one account.

## 4. Walkthrough

*Expectations first, in `design-expectations.md` §3, committed before this section was written.*

WALKTHROUGH_PLACEHOLDER

## 5. Spikes

SPIKES_PLACEHOLDER
