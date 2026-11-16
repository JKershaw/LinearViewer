# Shapes: three ways the loop could meet its needs

*Drafted 15 Nov for step 2 of the build sitting, from `picture.md`, the six traces and `my-words.md`. Marks are as on `situation.md`. Code facts are on main at `6f6c5d2`. Nothing here is built or filed. John's choice and frame are in §6. At his word, cost is left out of the shapes; the build plan states it, as his step 3 asks.*

## 1. Shapes that repeat

John asked me to look for larger patterns. Five shapes recur across the traces and Lighthouse [my reading, each from the lines cited]:

1. **Information handed to someone placed to act gets used. Information left in a place piles up.**
   - **Used:** surveys read by the next stage (trace 2 rows 9–10); review's ledger worked through by close-out (trace 2 row 20; trace 4 row 13); Lighthouse's `due.csv` rows, which the runner claims and closes (picture §9 #1).
   - **Piled up:**
     - departures written beside the plan (traces 1, 2, 6)
     - Waiting entries: 118 across 12 notes on main [checked, my count]
     - "to the person" lists in closing comments, with the same items two days running (trace 4)
     - three asks on a parent that nobody was placed to answer (trace 6)
     - Lighthouse's `proposals.md`: 91 KB, with "Declined, parked and expired: (none yet)"
   - **The record saw this once before.** Four findings routed into live tasks were all resolved, while 17 filed as Backlog tickets were all unmoved: "Pull worked where push sat" (log:1449), and "the loop's tickets are not where owners look" (log:1450) [reported]. A ticket has an owner and a state, so those two alone were not enough. What worked had an addressee that was running, or would be woken.
2. **Each cure moved the sink; none gave it an end.**
   - Findings went to Backlog tickets, then into live tasks.
   - Then, after John's steer to try without routing ("as if in a repo where they can't be assumed", log:1516), they went to the notes' Waiting lists, and from Periodicals "to the person".
   - Each move was a new sentence in a prompt. The notes were the essays' cure, and they leaked (picture §8).
3. **One place does several jobs, so it can't be both fixed and current.** The ticket is at once order, plan carrier, message bus, archive and memory (picture §5). The person's words must stay fixed while the plan beside them must change, so corrections go beside it. Lighthouse's `AGENTS.md` is both instructions and queue definition, and contradicts itself (`:32` against `:14`).
4. **Where things go is written as prose, so code can't see whether they got there.**
   - `LEFTOVER_RULE`, `CONSEQUENCE_TEST`, "say so on the parent", "record it as not run" and "to the person" are each a prompt line.
   - Prose rules pile up and collide: scoping against the autopilot (trace 3), `AGENTS.md` against itself.
   - Code can't notice a missing hand-off. Trace 2's builder never posted its Leftovers. Nothing noticed until close-out wrote them and counted them done.
5. **Writing outside "the change" escapes the reader.** The blind read can't see the notes, and close-out's edits after approval go unread. In Lighthouse, fixes made after review were not re-reviewed, and an unreviewed observation reached the public site.

## 2. What they suggest

[my reading] Under all five, the loop moves two different things and treats both as text:
- **State:** what was asked, the current plan, what was decided. It wants one current copy, corrected in place, with earlier values kept. Lighthouse showed that correcting in place loses the earlier values unless something keeps them.
- **Hand-offs:** something someone must do or answer, such as a finding, a check for John, a question, or an ask to another lane. It wants an addressee who is placed to act, and an end (done or declined) that something can see.

The six needs sort cleanly:
- Needs 1 and 4 are state.
- Needs 2 and 3 are hand-offs.
- Need 6 is both: an ask is a hand-off, and who is working on what is state.
- Need 5 is about checking, and stands apart.

**Caution.** These two kinds were named after looking, not before. But so were the essays' kinds, and the notes they led to leaked. The difference I see is that these are the classical pair: a record, and a work item with an addressee and a state. The point from §1.1 still holds: an addressee only helps if it will be woken.

## 3. Three shapes

| Need | A. Subtract | B. Harbour keeps it | C. The repository keeps it |
|---|---|---|---|
| 1. A correction reaches the source | By a prompt line | Yes, by code | Yes, through the PR |
| 2. A finding moves once, then ends | It ends by being dropped | Yes | Yes, if the checker enforces ends |
| 3. John's checks reach him as to-dos | No: they vanish | Yes, on a page like rulings | Weakly: a line in a file that nothing wakes |
| 4. One account of who decided | No | Yes | Yes |
| 5. The reader sees everything written | The same small change in all three | The same | By construction, if the blind read stops excluding paths |
| 6. Parallel work learns of each other | No | Yes | No: branches can't see each other until they merge |

### A. Subtract: keep today's places, delete the routes into places with no end

- **What it does.**
  - Builds edit the parent's plan in place instead of commenting beside it. Harbour's task snapshots already keep earlier versions (`lib/task-snapshot-store.js`) [checked].
  - A find is either done in the task or dropped: no new Waiting entries, no "to the person" lists.
  - The close-out prune goes, and the blind read sees the notes.
- **What it removes.** The leftover routing lines and the one-entry-per-build conveyor (`lib/prompts/leftover-words.js`), the Periodicals' "to the person" route (`lib/periodicals.js:365`), the prune (`lib/prompt-template-defs.js:872`), and departures as comments. In time, the 118 Waiting entries.
- **What it leaves alone.** Everything else: the ticket as the heart, comments as the bus, rulings, the stages.
- **What it risks.**
  - Losing things that matter: "A large backlog isn't actually a problem as long as we're not losing important things in the mix" (disc:484).
  - It leans on surveys finding things again. They do (trace 3: both found the same faults "in almost the same words"), but at a cost every time.
  - Checks that need John would vanish instead of being carried, which is worse than now.
  - It works by editing prose, the shape (§1.4) that grew the problem.
- **What ends it.** It adds nothing, so nothing new needs an end.

### B. Harbour keeps the state and the hand-offs as data; the tracker shows them

- **What it does.** For each task, Harbour holds a small record in its own store, as it already does for local workspaces (`local-issues` in `lib/local-store.js`), for rulings and for snapshots [checked]. The record holds:
  - the ask, in the person's words, fixed
  - the current plan, edited in place, with earlier versions kept
  - decisions: who decided what, when and why, written by code when a ruling is answered or a call is settled
  - open hand-offs, each with one addressee (a stage, another lane, or John) and a state

  Code wakes the addressee. It shows John's hand-offs on a page like rulings: his D6 idea was that "this could simply use rulings?" (disc:290). It won't let a task close silently while hand-offs addressed to it are still open. The tracker gets one rendered section, which is replaced, not appended to.
- **What it removes.**
  - comments as the bus between stages, and departures written beside the plan
  - the parent as switchboard
  - the Waiting lists: moved in, then the files go
  - the "to the person" route and the carried "not run" lines
  - the prune
  - rulings keyed by session loop rather than by task
  - the prose lines that do the routing today

  Copied counts become computed ones.
- **What it leaves alone.** The stages and the selector, the judgement in the prompts, the code in the repository, the tracker integrations as they are, and Linear as the place John reads.
- **What it risks.**
  - **A data shape designed ahead of the evidence:** "Trying to figure it all out in advance will be a fool's errand" (disc:484). The answer is one field at a time, each taken from a trace.
  - **Two copies while moving,** tracker text and record, which is the very drift being fixed. So each slice deletes the route it replaces, in the same change.
  - **Hand-offs becoming a new list with no end.** So ends are checked by code, and closed hand-offs leave what later sessions read. Lighthouse's closed rows stayed in the file and still added to the load.
  - **Who gets which question stays a policy,** and the policy is John's. B puts each question in one place with one addressee; it doesn't choose the addressee.
  - **It is the biggest build** of the three.
- **What ends it.**
  - A hand-off ends when its addressee closes it, or when it is handed on explicitly at close.
  - The record ends with its task. Later tasks read only the hand-offs addressed to them.
  - Writing in both places ends when the last prose route is deleted.
- **This is not the full sync.** Moving every tracker behind a local workspace (log:4141–4142) is this shape taken further. None of the six needs calls for it, so it stays John's later call [my reading].

### C. The repository keeps it as checked files

- **What it does.** Each project keeps typed files: one per task (ask, plan, decisions, hand-offs), and the notes as data. That was John's idea: "simply saving the notes as TS" (log:3966). A checker in the tests requires an addressee and an end on every hand-off, no duplicates, and references that resolve. Every write goes through a PR, and git keeps earlier values.
- **What it removes.** Notes as prose, the ticket as plan carrier, and the part Harbour's stores play in task state.
- **What it leaves alone.** Harbour as dispatcher, the tracker and the stages.
- **What it risks.**
  - **We already have evidence, because this is Lighthouse's shape** (picture §9). Its checked rows close, which is good. But its lists still grow (`due.csv` went from 73 to 505 rows), its standing text grew from 12 to 33 KB, and two overlapping sessions both took LH051.
  - **Branches can't see each other until they merge.** Trace 4's three Periodicals met only at a merge conflict.
  - **It needs git, where Harbour's runs don't** (`lib/run-closeout-state.js:278`, situation §2).
  - **It puts Harbour's files in the person's own repository,** where "Harbour is a passenger" (log:3609).
  - **A failing check hands off to whoever runs next,** without naming anyone.
- **What ends it.** The checker. The scaffolding ends once the notes are converted.

## 4. The traces and Lighthouse, walked through

Each row is a moment from the trace [checked by its reader]. Each cell says what I expect would have gone differently [my reading].

### Trace 3: LIN-4472, a lane piece

| Moment | A | B | C |
|---|---|---|---|
| The brief's suite list and its name search were wrong. Both surveys said so, but the parent's plan was never corrected | The build edits the parent's plan, if the prompt line is followed | The build edits the plan, and the parent and piece 3 read the current one. The old version is kept | The plan file is corrected in the PR, and reviewed |
| Scoping asked John. 26 s later the autopilot settled it, and the build went ahead on its call. John's answer came after the build, on the wrong ticket. The decision ended with four accounts | Unchanged | One question with one addressee: either John's and open, or the autopilot's and shown to John as decided. John's answer lands in the task's decisions, wherever he clicks | One decisions file, but the 26-second race happens outside any PR, so both calls get written |
| The Safari and Firefox checks were carried as "not run" through nine comments | Dropped: John never hears of them | One to-do on John's page, open until he does it or declines it. The parent reads its state, so nobody retells it | A line in a file, and nothing tells John |
| Close-out's edits after approval went unread, and the leftover run left the PR body stale | Unchanged, unless need 5's change rides along | The same | Read by construction, if the blind read includes everything |

### Trace 6: LIN-4448, a lane's parent

| Moment | A | B | C |
|---|---|---|---|
| Three asks from LIN-4458 and LIN-4459 got no reply, so that lane went ahead on silence | Unchanged | Each ask is a hand-off to this lane, and code wakes it. The asking lane sees "open" instead of inferring consent | The ask sits on the other lane's branch until it merges |
| Questions sat in Harbour's rulings and answers on the parent. One was asked on the parent and answered on a child. A withdrawn ruling left a false line | Unchanged | Every decision goes on the task's own list, whichever session asked. A withdrawal changes the entry's state | One file per task. But John's answers come through Harbour, so something must commit them |
| The Waiting count was copied as 26, 25, 23, 22 and 12 | Gone with the Waiting lists | Computed from the hand-offs, never copied | Computed by the checker |
| The prune removed the plan that seven children point to | No prune | The plan is a field, and nothing prunes it | The file stays |
| The close nearly deadlocked on a stale review and a parked close-out | Unchanged | Unchanged: it comes from two engine rules, not from information leaking | Unchanged |

### Lighthouse: no tickets, one agent per run

| What the trace found | A | B | C |
|---|---|---|---|
| `proposals.md` grew to 91 KB, and nothing in it was ever declined | Stop writing it | Each proposal is a hand-off to John, with an end | Already this shape. The checker would demand ends |
| An unreviewed observation was copied to six places in 20 minutes, and onto the public site | Fewer places to copy into | One entry, linked rather than copied, and review sees its writes | The copies are in the diff, so review could see them |
| Two overlapping sessions both took LH051 | Unchanged | Harbour records which tasks have sessions running. Using that to refuse a second claim is new [my reading] | Unchanged: separate branches |
| `AGENTS.md` grew from 12 to 33 KB and contradicts itself | Unchanged | Unchanged for Lighthouse's own text. In Harbour, the routing lines move into code | Unchanged |

B helps Lighthouse only if it runs on Harbour again.

## 5. What I would choose

**B, built from the two hand-offs that already work** [my reading]:
- **It is the only shape that meets needs 3 and 6,** the two where something has to be woken.
- **It replaces prose with code instead of adding prose.** That matches "We want all this looser, not tighter." (log:3855), and John's "benefits of deterministic code and data structures" (words §8). A leans on prompt lines, and C on a checker that no one is placed to answer.
- **It holds for any project run through Harbour,** with or without git or a tracker, and it keeps Harbour a passenger in the person's repository.
- **It needn't start from nothing.** The rulings page is already a hand-off to John with a state, and routing into a live task already worked (log:1449). B generalises those two.
- **A's deletions are inside B.** Each slice of B deletes the prose route it replaces.

**Where the record pulls against this.** On 4 Nov, John asked to try without routing, "as if in a repo where they can't be assumed" (log:1516), and routing into live tasks has not run since. B brings back a kind of routing. It keeps the hand-offs in Harbour rather than in the repository, so they still hold in any repo [my reading].

**What would change my choice.** If losing some things is better than building anything, choose A. If the record should sit in the code, readable and diffable there, choose C and accept what Lighthouse shows.

**The first slice** belongs to the next step. My lean is hand-offs first, because three of the six needs involve them (2, 3 and 6) and the evidence for pull is strongest. The plan as state would come second [my reading].

## 6. John's choice: a data layer that carries the information

*Recorded 15 Nov from this sitting's messages (words §9). John read it the same evening (words §10).*

**His words:**
- "my mental model was simply converting the communication problem into a code problem, covering every aspect."
- "Eg Wordpress and it's database allows unlimited shapes, without bloat. Computer science and the simple systems in Harbour can easily support this, with LLMs both in Harbour and running as agents as components in the system."
- "I actually meant more the data structure. But you're right: there's specific shapes of things holding and processing information. That describes the data layer we need, which carries the information, correctly."
- On cost: "I'm unsure we need to include budget in this discussion at all, at least at this stage."

**What I take it to mean** [my reading, for John to correct]:
- **One general data structure.** WordPress keeps every kind of content in a few tables: one for items of any type, one for their fields, one for the links between them. A new shape is added as data, not as a new table, place or prompt line.
- **Specific shapes declared on it.** Some shapes hold information: a plan, a finding, a check, a question and its decision, an ask. Others process it: Harbour's code, and LLMs both inside Harbour and running as agents.
- **The communication becomes code.** Who wrote a record, who it is for, its version and its end are held as data and acted on by code. What is inside a record stays the models' writing.
- **It is B from §3 in its general form.** A has no store at all. C is the same structure with git as its database and nothing running on it.

**The six needs as shapes on it** [my reading: a first sketch, not a design]:

| Need | Shape | Its end | Whom it reaches | Prompt text it replaces |
|---|---|---|---|---|
| 1 | `plan`, with earlier versions kept | Its task closes | The tasks reading it | "say so in a comment on the parent"; the prune |
| 2 | `finding` | done / declined | Its addressee: this task, the area's next task, a lane, or John | The leftover routing, the Waiting lists, "to the person" |
| 3 | `check` | done / declined | John | "record it as not run … then close" |
| 4 | `question`, then `decision` | answered / withdrawn | One decider, chosen by a setting John controls (D6, disc:290) | Rulings keyed by session; "settle it yourself" in a ticket body |
| 5 | None: what the reader sees is drawn from everything the task wrote | — | — | The reader's list of excluded paths |
| 6 | `ask`, plus who is working on what | answered / declined | The lane it is for | The parent as switchboard |

Summaries and counts are drawn from the records rather than retold. A new need adds a shape, not a new place.

**Two guards, taken from WordPress** [my reading]:
- **Declared shapes with checked fields.** Untyped extra fields sprawl. This is John's "so they get checks" (log:3966), and what Harbour's tidies keep reaching for: "each collection declared once with all its facts" (`broad-options.md:21`).
- **No shape without its end and its addressee.** WordPress keeps every revision by default (from memory, not checked here), which is the same pile with no end. "If a thing's end is written when it is made, nothing has to be hunted down later" (`nothing-fights-its-shape.md:109`).

**Next:** John read this section on 15 Nov: "It reads fine, if lacking the details we're figuring out next." and "The frame is a sketch, not a design." (words §10). So a design comes before any first slice, under `design-plan.md`.
