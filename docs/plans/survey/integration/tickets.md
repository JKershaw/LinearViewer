# Tickets: the layer in Harbour

*Drafted 19 Nov for John to read before anything is filed. Same shape as `asks.md`. The design is agreed (`integration/design.md`, cited here at `claude/cool-rubin-6acj5j@92838c5cf`). The parent and slice 1 are filed together; each later slice is drafted and filed as the one before lands, from what that slice really left. Not filed yet.*

## P. The parent

**Title:** The layer in Harbour: records instead of appended text, in five slices

**Repository:** JKershaw/LinearViewer (Harbour).

**What this is for.** Harbour's stages pass free text appended to tickets, comments and area notes. Text written with no end grows: the area notes went from 10.6 KB to 88.8 KB in six days, and 111 Waiting entries are open. Every reading is a fresh parse that can drift: one copied count read 26, 25, 23, 22 and 12 across a parent's comments. And with no addressee, every reader is handed the whole history: in one traced task, each of seven sessions began by caching 63,000 to 97,000 tokens.

The layer is a store of records. Each hand-off has a writer, an addressee, a state and an end, so it reaches one reader and stops when it's done. Agents reason; the store keeps the books. It has been designed on paper, rebuilt as a small model nine times and walked on three real finished tasks and an outside project. The integration design, agreed on 19 Nov, says how it becomes part of Harbour in five slices, each deleting the route it replaces in the same move. That matters: 9 of the 27 process changes since June are still half-finished, with 19 old paths kept beside new ones.

**What we want.**
- The five slices, in order, each a child task filed as the one before lands:
  1. a store, run ids, and hand-offs as findings;
  2. the plan as versioned records;
  3. verdicts and changes;
  4. rulings, and the brief's temporary ticket section goes;
  5. lessons.
- A sixth (wakes for open records) only if slice 1's readings show hand-offs sitting.
- After slice 4, the parked work (the seven safety findings, LIN-4416, LIN-4210, LIN-4441, LIN-4445, LIN-4463) is the first real work through it.

**Done when**
- slices 1–5 are merged, each having deleted what it says it retires;
- each slice's readings were taken before it landed and reported after, never as a gate;
- the parked work has run through the upgraded Harbour and been read against the 13–14 Nov baselines.

**This task is a container: its children are the slices; don't work it directly.**

**Where to read:** `docs/plans/survey/integration/design.md` and `docs/plans/survey/layer/design.md` on branch `claude/cool-rubin-6acj5j` at `92838c5cf` (on main once slice 1 lands). The full record (census, checks, walks, log) stays on that branch.

## S1. Slice 1

**Title:** Layer slice 1: a records store, run ids, and hand-offs as findings; the Waiting lists and the `Retires:` conveyor go

**Repository:** JKershaw/LinearViewer (Harbour). simple-dispatcher needs no change: it forwards any `/api/proxy/*` path.

**What this is for.** Finds that belong to someone else leave the task today and stop:
- larger finds go to an area note's Waiting list. The notes grew from 10.6 KB to 88.8 KB in six days, 111 entries are open, and seven safety findings sat only in notes. The leftover step settles one entry per build, and in one trace it settled one and led to two new ones;
- finds "to the person" stop in a closing comment: in one trace the same items went that way two days running;
- a check that needs John's own systems is "recorded as not run" and passed on: through six places in one trace, nine comments in another;
- asks between lanes go unanswered: three asks posted on LIN-4448's parent got no reply, and that lane went ahead on silence.

Today the review lists outside finds in a ledger comment, close-out parses it and writes them into a note's Waiting list, and a later leftover must name one in a `Retires:` line or it sits. After this slice, the review writes a finding addressed to close-out, or to the project; close-out sees it in full in its brief and ends it when done. In the walks, every hand-off addressed by its writer reached its reader, and every record addressed to a stage was ended by the task's last step.

**What we want.** The design's §1–3, §8–9 and slice 1 row (`integration/design.md`) are the how; in short:
- **The store:** one collection of records, every version kept, with the shape check, the views and the brief built fresh from the layer page's §3. The round 9 model (`layer/walks/9/model/`, its test of 52 cases) is a reference, not the source.
- **Agents reach it through the proxy,** with calls laid out as the API review found agents expect: flat bodies, a bare `on` pinned to the current version, every problem named in one refusal (`integration/checks/api-review.md`).
- **Who wrote a record is filled by code from the run,** never sent by the agent. Each dispatch row gets its id before its prompt, the preamble names the run, and a write names it. (Why: a build's held session also runs its leftover step on the same token; without the run, the leftover's findings would be filed as implementation's.)
- **No actor list:** a record's addressee is checked against what Harbour can brief (a task, the project, a stage kind, a person by the name the workspace shows), and a miss is refused with the names that would work.
- **Run and task records;** tasks found or made by ticket id.
- **Findings for every hand-off:** the ledger's not-run items, review and blind-read finds, leftovers, asks to a parent or sibling, and finds about the codebase addressed to the project. A verification is a finding with `how`.
- **The brief behind today's door** (`GET /api/proxy/brief/<id>?run=`), built from records, with today's ticket section kept after it until slice 4.
- **Pages:** records on the task page, the run's account on the session page, what is open for the person on Home's "Waiting on you", and a project page listing the backlog, numbered oldest first, where a person makes a record a task or declines it.
- **A one-off import:** the 111 Waiting entries become findings to the project; the seven safety entries become seven tasks under one parent; the parked tickets are filled into records.
- **Retired in the same move:** writing and reading the Waiting lists; the `Retires:` conveyor and its 422; the leftover step's duty to settle one entry; the ledger's item parse and counts; the blind read's three classes. The census rows for each are in the design's slice table.
- **This slice's pull request adds** `docs/plans/survey/layer/design.md` and `docs/plans/survey/integration/design.md` to main.

**Not in this slice:** the plan, verdicts, rulings and lessons (slices 2–5); a guard on the blind read's reads (it stays prompt-only, as today); wakes for open records.

**Witness:** the contract tests; and walk 8's three tasks (LIN-4450, LIN-4446, LIN-4469) replayed through the proxy on a temporary store, their seeds ported to the current kinds (a check becomes a finding with `how`; an approve-with-notes becomes `approve` plus findings). Walk 8's records are on `claude/cool-rubin-6acj5j` under `docs/plans/survey/layer/walks/8/`.

**Readings before it lands,** reported after, never a gate: notes bytes and the Waiting count; brief bytes; sessions and cost per task, against 13–14 Nov. From this slice on, also: records addressed to a stage or task with a held run, and how long each sat (this decides whether wakes are ever built).

**Done when**
- an agent's hand-off is a record addressed by its writer, reaches its addressee's brief in full, and is ended by whoever acts on it;
- nothing writes or reads a Waiting list, and the `Retires:` conveyor is gone;
- the backlog is on the project page, numbered, and a person can make a record a task or decline it there;
- the replays pass through the proxy, and the readings are reported;
- Harbour still works for every route that hasn't moved yet.

**Every change names what it retires. Questions:** settle engineering questions yourself; only John's calls (product, money, authority, what to retire) go to him as rulings.
