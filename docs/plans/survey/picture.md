# The picture: where information lives in the loop, and where it leaks

*Drawn 15 Nov from six traces of finished Harbour tasks (`trace-2026-11-15/`), as `plan.md` step 4 asks. Read by John on 15 Nov, with no corrections: "This reads great to me, and it all feels very tangible." (words §8). Marks are as on `situation.md`. Line numbers are on main at `6f6c5d2` unless a trace gives another commit. Nothing here is a design.*

**What was traced.** LIN-4450 (an ordinary task, traced by me), LIN-4455 (a tidy under autopilot), LIN-4472 (a front-end lane piece), LIN-4482 (a Seams & Tangles run), LIN-4474 (a piece built in simple-dispatcher) and LIN-4448 (a lane's parent). Each was 13–14 Nov, ran 7–9 sessions, and cost $9–21 [checked, cost records].

**Limits.** All six are Harbour's own work, from two days of one loop. Five readers and I are the same model family. No session's prompt, transcript or reading list could be reached, so "read by" below means "cited by" [checked: no endpoint returns them].

## 1. Where information lives

Eleven places turned up, and every task used most of them [checked across traces]:

| Place | What lives there |
|---|---|
| The ticket's description | The sealed ask. On a child, the ask is a slice of the parent's plan written by an agent (traces 1, 2, 3, 5). Below it: the size record, a Periodical's findings, and the close-out stub. It is pruned at close |
| The ticket's comments | One per stage: the surveys, review, blind read, leftovers, close-out, the autopilot summary, and ruling answers. Every one is posted under John's account (traces 1–5) |
| The parent ticket | The plan, design, plan review and breakdown; departures sent up by children; messages from other lanes; caveats carried up. It works as a switchboard: parent sessions, children, other lanes, the autopilot and John all write there, but no session is placed to answer it (trace 6) |
| The pull request and commits | What changed and what it retires. Often stale after later commits (traces 2, 3, 5) |
| The code and tests | The change itself. Also rules written as code comments, which the next task finds by reading code (trace 5) |
| Area notes (`docs/areas/`) | Lessons and Waiting entries, written by builds, leftover runs, close-outs and Periodicals |
| Other repository docs | The source map, the module map, Periodical reports and evidence folders |
| Harbour's stores | The rulings record (which holds scoping's reasoning), task snapshots (the pre-prune text), dispatch and cost rows, the model-routing log, the brief cache |
| Sessions' final messages | Scoping's reasoning. "Post no comment … your reasoning goes in your final message" (`lib/prompt-template-defs.js:492`) [checked] |
| Standing text | Prompt templates under `lib/`, the autopilot manual, the notes README, and directions written once in a ticket body ("settle engineering questions yourself") |
| Outside reach | John's Jira, a signed-in Safari or Firefox, production logs. Checks that need these cannot be run by any session (traces 1, 2, 3) |

## 2. How it moves, and where it leaks

The traces sort best by **direction of travel**. This sorting was named after looking, not before [my reading].

- **Down: copied whole, errors included.** The breakdown copies "the specific files, the approach, and the testing strategy the plan named for it" into each child (`lib/prompt-template-defs.js:431` at `e666c4b`) [checked by trace 5]. The child's ask is sealed: "nothing above it changes". Wrong premises arrived this way in traces 2, 3 and 5, two of them from the area note's own entries (trace 2) [checked by readers].
- **Up: corrections pile beside the source; they never fix it.**
  - The plan on the parent is never edited. Departures are added as comments beside it (traces 1, 2, 6), or stay on the child (trace 3), or reach the parent not at all (trace 5) [checked by readers].
  - So whoever reads next has to rebuild the truth from the ask, the parent's comments and the PR [my reading].
  - At the parent's close, the prune removed the plan that all seven children point to (`lib/prompt-template-defs.js:872` protects only sections a follow-up ticket cites) [checked by trace 6].
  - Copied counts go stale. The parent's Waiting count appears as 26, 25, 23, 22 and 12, each right at its own commit, and one comment calls an earlier figure wrong (trace 6) [checked by reader].
- **Across: nothing carries it but tickets and code.**
  - Three Periodicals ran in the same hour without knowing of each other (trace 4).
  - A rule simple-dispatcher's build wrote into a test header reached its sibling tasks only when they read the code, about two hours later (trace 5) [checked by readers].
  - Three asks from another lane, posted on LIN-4448's parent, got no reply. That lane went ahead on silence and used its fallback. Between 15:58 on 13 Nov and 10:30 on 14 Nov only autopilot wakes and one mistaken review ran on that parent (trace 6) [checked by reader].
- **Out of the task: into notes, or "to the person", where it stops.**
  - `LEFTOVER_RULE` sends larger finds to a note's Waiting list (`lib/prompts/leftover-words.js:41`). `CONSEQUENCE_TEST` sends a find to a ticket only if it breaks something, blocks work or touches safety (`:58`). Periodicals "mint no follow-up tasks" and send what has no note "to the person, never to a ticket" (`lib/periodicals.js:362,365`) [checked].
  - In trace 4 the same items went to the person two days running, and stopped in a closing comment both times.
  - "Then settle one waiting entry" (`lib/dispatch-leftover.js:152`) takes one entry out per build. Trace 5's leftover settled one and led to two new ones [checked by readers].
- **Out of reach: carried, not done.** A check that needs John's systems "never holds the close … record it as not run … then close" (`lib/prompt-template-defs.js:1062` at `5cf4f6aa2`) [checked by trace 3]. One such check passed through six places in trace 1, and another through nine comments in trace 3, then went to John as a runbook or not at all.
- **Retold at every step, and drifting with each retelling.**
  - Each stage restates the stages before it: the review restates the plan, close-out restates the review, the autopilot restates them all, and the parent restates the child.
  - The bulk-read gap appears six times in trace 1.
  - In trace 2 the stub records two of the PR's four departures.
  - In trace 5 a concern went round a loop, from note to survey to code comment to blind read and back into a note, and gained a claim ("the ruling … accepted this trade") that no source supports [checked by readers].
- **Written where no one checks it.**
  - The blind read's diff excludes `docs/areas/*.md`, `docs/reviews`, `docs/plans` and `docs/papers` (`lib/prompt-template-defs.js:1072`) [checked], so no outside reader ever sees the notes.
  - "Nobody reviews what you change after the approval" (`:833`) [checked].

## 3. Who decides, in practice

- **Standing text makes the person's calls.**
  - The size is "Decided by: the standing policy", err larger (`lib/size-of-move.js:12`) [checked].
  - The autopilot manual says an engineering question "it's yours — answer it" (`docs/autopilot-operating-manual.md:446`) [checked].
  - Yet any clause not delivered in full is a cut that only John may rule on (`lib/prompts/stage-kinds.js:27`; `lib/prompt-template-defs.js:489`) [checked].
- **The rules collide.** In trace 3 scoping asked John, and the autopilot settled the same question 26 seconds later; the build went ahead on the autopilot's call, and John's answer came after the build. In trace 5 a clause that both surveys showed was wrong waited 69 minutes for a ruling, while an automated suggestion said the lane could have settled it [checked by readers].
- **Questions and answers end up on different tickets.** A ruling is keyed by the session's loop, not by the ticket (`lib/unanswered-decisions.js:33-38`) [checked]. So on LIN-4448, John's answers sit in the parent's thread while the questions live only in Harbour's rulings record. One question was asked on the parent and answered on a child. A withdrawn ruling left a comment saying something false about what gates the merge (trace 6) [checked by reader].

## 4. What is still done by hand, or by the driving session

- **The autopilot holds the lane together.** On LIN-4448 it ran 67 wakes over 21 hours, $21.02 of the parent's $37.70. The whole lane came to $142, children included (trace 6) [checked by reader]. It settles engineering calls, writes the run summaries, and overrides the engine when the rules jam.
- **One near-deadlock was broken by hand.** Close-out refused because the latest review was a day-old Request Changes. The engine refused a new review while close-out was parked. The autopilot overrode it, "waiting would deadlock" (`lib/prompt-template-defs.js:828`; `lib/run-live-wait.js:18-19`) [checked by trace 6].
- **John answers rulings,** often after the work has moved on, and he is handed the checks no session can run: a Jira runbook in trace 1, the browser checks in trace 3 [checked by readers].
- **Close-out merges and comments under John's name.** Every comment and merge in these traces carries his account, so the record cannot show who wrote what (traces 1–6) [checked by readers].

## 5. What a task carries

*Revised by the outside test (§9): Lighthouse, with no tickets, also carries a lot, so the cause is wider than the ticket.*

- **Seven to nine fresh sessions.** In trace 1 each began by caching 63,000 to 97,000 tokens [checked]. That this is mostly the ask, the parent's plan and the thread so far is [my reading].
- **A child's start-up reading.** Its ask, plus pointers to the parent's description (20,805 characters in trace 1), a design of 12,934 and a plan review of 6,851; then both surveys, which in trace 3 found the same faults "in almost the same words" [checked].
- **What the ticket is used for.** It is at once the order, the plan's carrier, the stages' message bus, the archive and the place's memory. Its frozen top means it can't be kept true [my reading].

## 6. Why

[my reading, from the six traces and the lines cited above]

- **The only memory is what is written.** Each stage is a fresh agent and remembers nothing. So everything it needs from earlier, or wants to hand on, must be written somewhere the next agent will read.
- **Rules decide where each piece goes, and most of those places have no end.** Rules written as prompt lines and code send each kind of output to a fixed place: the ticket, a note, the person, or a final message. Most of those places have no way to close an entry.
- **The sources are frozen by design.** The sealed ask and the approved plan don't change, so every correction becomes one more piece written beside them.
- **No path runs sideways or back.** There is no path across to other work, or back to the source of an error. Information that needs to go there is retold as text and carried forward.
- **The leak is the sum of these.** Text piles up where the rules send it, and the same thing exists in several versions that drift apart.

## 7. What the loop seems to need

These are needs, not designs. Each comes from a trace above [my reading].

- A correction that reaches the place the error came from (the plan, the note entry), so the next reader doesn't have to rebuild it.
- A finding that moves once and then ends, rather than being restated by each stage.
- A check that needs the person's systems reaching the person as something to do, not as text carried forward.
- One account of who decided what, where the next session looks.
- The outside reader seeing everything a change writes, notes included.
- A way for parallel work to learn of each other while it runs, and an answer to whoever writes to a shared place.

## 8. Read against the essays, both ways

- **Where they agree.**
  - "Failures sit between the sessions" holds strongly: down, up, across and out are all between sessions.
  - "Nothing in the system ever asks a sentence to leave" holds for the notes and for carried "not run" items.
  - "A move is not an exit" holds in trace 5.
- **What the traces add.**
  - The sources are frozen by design, not merely kept by hand.
  - Rules collide over who decides.
  - Some writing is unreviewed by design.
  - Some checks no session can run.
  The essays sort by kind of information. The traces sort better by direction of travel [my reading].
- **Where the traces push back.** The essays' cure, "each kind should live where something keeps it true", was in effect what the area notes tried, and the notes are what leaked. In these traces the trouble comes less from a kind sitting in the wrong place than from rules that send things to places that have no end, beside sources that cannot change [my reading].

## 9. The outside test: Lighthouse

The expectations were committed before the look (`lighthouse-expectations.md`, `72f0001`). A reader who had not seen this picture then traced two Lighthouse tasks: LH044 weekly read 1 (15 Nov, a scheduled run) and LH004 (26 Sep, dispatched through a local Harbour). Its notes are in the session scratchpad, not this repository, as the plan says. Every fact below is [checked by the reader] unless marked.

| # | Expectation | Result |
|---|---|---|
| 1 | Lists with no end grow; a checked list doesn't | **Half held.** `schedule/due.csv` went from 73 rows to 505, and no row was ever removed. `proposals.md` went from nothing to 91 KB, with "Declined, parked and expired: (none yet)". The dated log in `programme.md` is 83 KB. **But** the checked list grew too: `due.csv` is what the checker reads. Its rows close; they are never removed |
| 2 | An editable source gets corrected in place | **Held, with a cost.** Task rows and checkpoints are corrected in place. Proposals append their corrections below wording that stays, the same pattern as Harbour. Ledgers (`runs.csv`, `costs.csv`) are overwritten, so earlier figures survive only in commit messages: no pile, but no history either |
| 3 | Retellings drift | **Partly held.** One unreviewed observation was copied into six places within 20 minutes, and a later study claimed that commits were missing when they were present. Within these two tasks the copies had not yet drifted |
| 4 | Checks out of reach are carried as text | **Not shown.** One owner-verification item, about the live kickoff, is carried. Nothing in these two tasks was repeated run after run |
| 5 | Standing text makes the choices, with no collisions | **Half held.** Standing text does choose: "claim everything due, soonest deadline first", and "sonnet for research", which led to first-draft errors. **But** the one rule set collides with itself: `AGENTS.md:32` says "The open issues on the repository are the queue", while `:14` and `runner.md:80` make every promise a row in `due.csv` |
| 6 | Nothing leaks across, unless runs overlap | **Held.** Runs do overlap: a Codex session ran across a scheduled run, and two dispatches ran together on 26 Sep. The blindness appeared: two overlapping sessions both allocated study LH051 |
| 7 | A task carries little | **Broke.** Before a task, a run reads roughly 130 to 270 KB (`AGENTS.md` alone is 33 KB, up from 12 KB; the brief is 50 KB), plus harness context per subagent. On 26 Sep a subagent was handed `AGENTS.md` at 3.4 KB |
| 8 | Information moved out of Harbour | **Held** (partly told by John's summary). The September Harbour store was git-ignored, and the repository keeps only exports. The subagent got only the ticket text, so its brief says "initiated by: unknown" |
| 9 | Writing nobody checks | **Held.** An unreviewed observation reached the public site by two routes, despite "before any public line changes". The driver's fixes after the second review were "not re-reviewed", as with Harbour's close-out |

**What this changes in the picture** [my reading]:
- **Most of the picture holds outside Harbour's own code**, in a project of the same lineage that runs one agent at a time. As noted in the expectations, that is weaker evidence than unrelated code would give.
- **§5, what a task carries, was wrong to blame the ticket alone.** Lighthouse has no tickets or parent plans, yet a run's starting reading grew about tenfold in seven weeks, as standing text and records piled up. The load comes from places with no end, not only from the ticket's shape.
- **§3, collisions, was wrong to blame several rule-holders.** One rule set, grown by additions, contradicts itself.
- **New:** correcting in place removes the pile beside a source, but loses the earlier value unless something keeps it.

*Side effect of the tracing: three readers' brief and recap reads saved new task snapshots on LIN-4472 and LIN-4482 (`routes/proxy-compute.js:1373` saves one on such reads) [checked by readers]. The last two readers were told not to call those endpoints.*

*Next, per the plan: John corrects this picture. Readings used, in sub-agent tokens: the six traces 236k, 307k, 271k, 242k and 288k (trace 1 was mine), and the Lighthouse trace 296k. The drift check on the plan used 107k. In dollars that is likely well under the plan's $100 [guess: the split between new and cached tokens is not reported].*
