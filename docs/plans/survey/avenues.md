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

Each moment is from its trace [checked by its reader]. Each cell says whether the avenue changes what happened, and why [my reading].

### Trace 3: LIN-4472, a lane piece

| Moment | A | B | C | D |
|---|---|---|---|---|
| **a.** The brief's suite list and name search were wrong. Both surveys said so; the parent's plan was never corrected | **Partly.** The surveys' findings point at the plan piece. But the frame does not make the build write the plan's next version: that needs a rule that a finding about a plan piece cannot close as "built differently" without a new version. Without it, this rests on the agent, as today | **Partly**, for the same reason | **Partly.** The same, though review sees whether the plan file changed in the diff | **Partly, and weaker.** The extraction must also recognise "built five suites" as a departure |
| **b.** Scoping asked John. The autopilot settled it 26 s later, the build went ahead, and John's answer came after, on another ticket. Four accounts | **Changes.** One question, with one decider from the setting for its kind. A second decider is refused. John's answer attaches to the question wherever he gives it | **Changes**, as A, by events | **Partly.** The checker catches two answers to one question, but only at the next CI run, after the build went ahead | **Partly.** The extracted records refuse the autopilot's call, but its comment still stands in prose, and a stage reading the ticket would act on it |
| **c.** The Safari and Firefox checks were carried as "not run" through nine comments | **Changes.** One check on John's page, re-surfacing. The parent reads its state | **Changes**, as A | **Partly.** A file John sees only once it is merged and rendered | **Changes.** "What CI did not prove" is a clear heading to extract from |
| **d.** Close-out's edits after approval went unread; the PR body went stale | **Partly.** The edits are visible to a reader of the task's records, but nobody reads after close-out unless the design adds a reader. A PR body rendered from records stays current | **Partly**, as A | **Partly.** In the diff, but still with no reader after close-out | **Partly**, as A |
| **e.** LIN-4154, open in Backlog and largely settled by this work, was found by no stage (added from the mapping, T3.37) | **Changes, if** an area also surfaces open tasks about its paths, not only findings. The build touched those paths | **Changes, with the same if** | **Changes, if** the run's view includes the area's files | **Changes, as A** |

### Trace 6: LIN-4448, a lane's parent

| Moment | A | B | C | D |
|---|---|---|---|---|
| **a.** Three asks from LIN-4458 and LIN-4459 got no reply; that lane went ahead on silence | **Changes.** Each is a question whose decider is this lane. It sits open in the brief of the lane's autopilot, which was waking all night (67 wakes). The asking lane sees "open", not consent | **Changes**, as A | **Unchanged.** The asks sit on another lane's branch until it merges | **Changes.** "Please reply on LIN-4447" and "tell me on LIN-4458" are plain enough to extract |
| **b.** Questions sat in rulings and answers on the parent. One was asked on the parent and answered on a child. A withdrawn ruling left a false line | **Changes.** Each question is anchored to its task. A withdrawal changes its state, and anything citing it is a link that shows the state | **Changes**, as A | **Changes, more slowly.** John's answers reach the files by commit | **Partly.** The records change, but the false line stays in the child's comment |
| **c.** The Waiting count was copied as 26, 25, 23, 22 and 12 | **Changes.** Counted from open records, never copied | **Changes**, as A | **Changes.** Counted by the script | **Partly.** Counted, but agents still write counts in their prose |
| **d.** The prune removed the plan that seven children point to | **Changes.** No prune | **Changes** | **Changes** | **Changes** |
| **e.** The close nearly deadlocked on a stale review and a parked close-out | **Unchanged.** A verdict that goes stale when its subject moves leaves close-out still needing a new review, and the engine still refuses one while close-out is parked | **Unchanged** | **Unchanged** | **Unchanged** |

### Lighthouse: no tickets, one agent per run

| Moment | A | B | C | D |
|---|---|---|---|---|
| **a.** `proposals.md` grew to 91 KB, and nothing in it was declined | **Changes, if** Lighthouse runs on Harbour. Each proposal is a question to the keeper, re-surfacing until it ends | **The same** | **Partly.** The checker shows how many are open, but nothing brings them back to the keeper | **The same as A** |
| **b.** One unreviewed observation was copied to six places in 20 minutes, and onto the public site | **Changes the copying, if** on Harbour: one record, linked. Publishing only what has passed a verdict is a further rule, not in the frame | **The same** | **Changes the copying:** one file, linked, and the site already builds from files. The same further rule is needed | **Partly.** The prose copies stay |
| **c.** Two overlapping sessions both took LH051 | **Changes, if** on Harbour: ids allocated by the structure, and a second claim refused | **The same** | **Partly.** If ids come from a counter file, the clash shows as a merge conflict. Otherwise unchanged | **The same as A** |
| **d.** `AGENTS.md` grew from 12 to 33 KB and contradicts itself | **Partly.** The choices in it that are settings ("claim everything due, soonest first", "sonnet for research") move out. The rest is unchanged | **The same** | **Partly**, if its settings move to a settings file | **The same as A** |

### What the walkthrough adds

- **The frame does not by itself send a correction upward** (trace 3a). Every avenue needs one more rule, in code: a finding about a plan piece cannot close as "built differently" without the plan's next version. This is a design rule, not a shape.
- **D differs from A wherever prose stays readable** (3b, 6b, 6c, Lighthouse b). Stages and people can still act on the prose, so the records do not replace it at the source.
- **C's weakness is all on one side.** It loses wherever information must move before a merge: 3b, 3c, 6a, Lighthouse c.
- **The area needs to surface open tasks about its paths, not only findings** (3e).
- **Two moments need rules beyond the frame in every avenue:** a reader after close-out (3d), and publishing only what has passed a verdict (Lighthouse b).
- **No avenue does worse than today at any moment** [my reading].

## 5. Spikes

### Spike 1: agents writing shapes, A against D

*Run 16 Nov on Yap at `14f7e92`, item 18 (a CLI client). Expectations were committed first (`design-expectations.md` §4, `7459bf7`). The raw outputs are in the session scratchpad, as notes on an outside project. The shapes given were `avenues.md` §1's, cut to those a survey writes. Counts are [checked: by script over the outputs]; the readings are [my reading].*

**What ran:**
- **Arm A.** A fresh agent surveyed the task and wrote only records.
- **Arm D.** A fresh agent surveyed it in prose: 141 lines, 17 KB. A second agent, given only that prose and the shapes, extracted the records.

**What came out:**

| | Arm A: the writer writes records | Arm D: a model extracts them from prose |
|---|---|---|
| Records | 44 (40 KB) | 71 (32 KB), more of them near-duplicates from splitting compound points |
| `finding` | 19: build 13, scoping 2, review 1, two areas, one other task | 35: build 29, person 3, scoping 1, review 1, one area |
| Addressees | Chosen by the writer | Inferred by the extractor in 34 of 71 records ("the survey almost never says who should act") |
| `question` | 12: product 5, engineering 4, person-only 2, scope-cut 1 | 21: product 18, engineering 2, person-only 1 |
| "If unanswered" | Stated by the writer: "requiring … `if_unanswered` made me say who acts and what happens by default" | "Not stated by the survey" in 17 of 21 |
| `check` | 3: the hosted proxy's timeouts, installed Node versions, real terminals | 0: the prose mentions the hosting only in passing |
| `lesson` | 5 | 10, eight of them the web UI's conventions |
| Unplaced | 2: a priority ranking; things it could not verify | 1: the survey's provenance (its commit, which claims were run) |
| Points lost | — | None found. Spot-checks of three points only the prose had all found them |

**What it teaches:**
- **Who writes the record matters most for addressees and deciders.** Prose rarely says who must act, or who decides. So D's extractor guessed addressees for half its records, and labelled 18 of 21 questions "product", which would route them all to John. On the frame, the addressee and the decider are what code acts on. So in D the extractor's guesses would decide where work goes.
- **Writing in shapes sharpened the writing.** Arm A said that requiring an addressee and a default "made each record sharper". It also wrote three real checks for the owner, which the prose never named as such.
- **Shapes absorbed more than I expected.** "How the code works today" became lessons in both arms, not unplaced background.
- **Content is not lost by extraction.** Every point checked survived. D's risk is misrouting, not forgetting.
- **Limits.**
  - One run per arm. Arm A's and arm D's surveys each found a few points the other did not, which with one run cannot be put down to how they wrote.
  - All three agents are one model family.
  - The task is small and needs no out-of-reach systems.

**What it adds to the catalogue** [my reading, from what the arms could not place]:
- **An evidence field on every hand-off,** marking whether the point was run or only read. Both arms reached for it: one used `why`, the other left provenance unplaced.
- **A "relates to" link beside "same as".** One subject (the package not running when installed) needed four records for four readers, and without links it reads as repetition.
- **An `about` that can name the plan piece or task** where code does not exist yet.
- **A priority across records, and an "unverified" state.** These are noted, not yet traced to a Harbour row.

### Spike 2: replay, not run

The replay (`design-plan.md` §2) would load one trace's pieces into each avenue's structure and ask it the questions the sessions had to rebuild. It has not run. The walkthrough above answered those questions on paper for 14 moments. What the replay would add is a measure of how much smaller each reader's starting text becomes. It can run in the next sitting if John wants that number before choosing.

## 6. Where this stands

- **Done in this step:**
  - the catalogue (§1)
  - four avenues (§2), compared on every axis, direction, cause, reader, kind of project and misfit (§3)
  - walked through 14 moments (§4)
  - one spike (§5)
  - expectations committed before each look, and marked after (`design-expectations.md` §3–§4)
- **For John:**
  - the four catalogue choices (§1)
  - which avenue, or which combination, or back to the avenues (`design-plan.md` §2)

  The table in §3 is the side by side. It holds no recommendation. If John wants my reading, it comes after he has read the table.
- **Then, under the plan:**
  - Yap's Harbour-run task goes into the mapping.
  - The chosen design is written in full and walked through every trace row.
  - Two break readers attack it.
  - The held-back project (Herd or Harbour OS) tests it.
  - A drift check against John's words, then John corrects it.
