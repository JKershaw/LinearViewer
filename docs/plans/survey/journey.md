# The journey so far: January to 17 November

*Written 17 Nov for John and for later sessions to refer back to. Built from seven readers' cited reports plus my own reading of the files named; checked by the parrot twice against John's words. Changed by adding, like the log.*

**How I put this together.** Seven fresh readers each took a slice (January–August, August–October, the papers, 2–12 Nov, 12–16 Nov, the leak traces and newest papers, the layer) and reported with line citations. I read your collected words (`my-words.md`), the log from 15 Nov on, the north star and the current design myself, and opened the lines the claims below rest on. The parrot read this against your words before it came to you. Where something is my reading rather than the record, I say so.

## The journey since January

**January–May: a viewer that learned to dispatch.** The first commit (4 Jan) was a read-only Linear roadmap viewer with one rule: no frameworks, no build step. Prompt templates and AI recommendations followed within a fortnight, a dispatch queue on 20 Jan, simple-dispatcher in February, and the API proxy for agents on 6 Mar. The April Pipeline page recorded that "every loop is amnesiac"; late May brought the drift notes and the first north star.

**June–July: autonomy, and finding out how much the system misreported itself.** Autopilot and its operating manual ("disposition, not procedure"), the Collectives, CI at merge, the rename to Harbour on 25 Jun, the close-out ledger, plan review, the credential broker and the hermetic suite. North star v2 (31 Jul) named the self-funding loop. The 3 Aug brief, *The bottleneck moved*, found ticket creation flat at about 190 a week while tickets reaching code fell 39%.

**August–September: passages, cost, and process outgrowing product.** Passages and the Flight Companion, rulings as machinery, lane day, the cost levers. By mid-September tasks were minting about two new tasks for every one closed (`tasks-generate-tasks.md`). On 19 Sep: the ladder, V1 ("one person, one task, one proven merge") and north star v3. The V1 passage set out on 26 Sep; an eight-line change took 41 sessions; the fleet paused, and the steady-base study found three-quarters of supervision was bookkeeping. From then on the measure was whether Harbour completes work correctly.

**October: rebuild instead of patch.** You named the pattern of fixes stacking on fixes, and the prompts were rebuilt (the routed prompt went from 104.5 KB to 9.5 KB). The parrot started that week. On 10 Oct V1 made port: a dress rehearsal on a repository Harbour had never seen. Then the coherence study (an unreconciled decision behind 45% of escaped defects), Theseus (ten design-first rebuilds cut the worst function in each file by 29–88%), consolidate-then-rebuild (17 Oct: eight tickets merged, zero behaviour differences on replay), the improvement cycles and the charter loop. The charter retro found the tidies clean (workspace-api 3,782 → 882 lines) but landing in the server while the changes bound in the browser.

**2 November: the survey.** Harbour did the ticket well, but a codebase is a place and nobody lives in it: no stage owned the condition of the code, and work spiralled (`why-work-spirals.md`). The aim became bringing codebases toward settled, Harbour's own included, starting with tidying where the change binds.

## The last month, and how the ideas built

- **2–5 Nov, the Survey and your question:** can a task leave the code cleaner than it started, the tipping point being a task that on average leaves it a little better. A stage asking "why is this difficult?" before work, loosened to an open answer after you questioned whether it steered too much; then the place ledger, blind scorers, tidy-first and an after step. What came out: finishing a move (deleting the copies) is what makes an area read better, and findings handed to someone placed to act get used (all four routed into live tickets were resolved or improved; all 17 filed as Backlog tickets sat unmoved). By 5 Nov the Survey was two Harbour stages.
- **6–9 Nov, moving the hand jobs into Harbour.** The paper (`cleaner-than-it-started.md`) and essays; round 1 of "Harbour carries the loop": five of six areas better for about $880 across 37 tickets, though the Stability Review still said not converging yet. The 8 Nov review found the hand-run session was the main source of error, and on 8–9 Nov you set the decisions: toward settled as the goal, the "open the door" stretch, $3,500 a week, and the measures, no new mess first.
- **10–13 Nov, the asks and the first gate.** A1–A11 ran through the loop; A1, a blind read before merge, went live on 12 Nov. Sixteen blind reads over 10–12 Nov came out 7 better, 7 mixed, 2 worse. The 13 Nov gate found Harbour largely carries the loop, and that the tightest knot was the loop's own machinery: building the loop was tangling it. You judged the gate passed and moved on to product work and tidies; north star v4 went in, and four lanes started (Jira, front end, Runs, LLM).
- **14 Nov, the second gate and the turn.** The Periodicals agreed the code got better (Drift: 7 resolved, 11 improved, none worse), but beside it the notes grew from 10.6 KB to 88.8 KB in six days, Waiting entries kept rising, and seven safety findings sat only in notes. My reading then: the loop had moved the mess from the code, which is checked, into the text around it, which isn't. That day's papers said why: steering text takes in 6.3 bytes for every byte removed and shrinks only by deletion; what agents need beyond code comes in four kinds (traps, homes, reasons, known work), each best kept where something keeps it true; parallel lanes do coordinate, but unreliably. With them came the essays *Nothing fights its shape*, *Notes across the border* and *Every choice was right at the time*, and your question of what shape each kind of information should take and where it should live.
- **15 Nov, the pause and the plan.** Your plan at the pause: understand where the loop leaks, why, and what it needs; build the smallest thing that meets that; then take an engine that doesn't leak to small projects and on to Jira. You also floated Harbour holding the primary data, with tickets as a backup and trackers syncing. The sittings that evening gathered your words, traced six tasks and Lighthouse, and wrote `picture.md`: information leaks down (children copy the parent's plan, errors included), up (corrections pile beside the source; one copied count drifted 26, 25, 23, 22, 12), across (lanes can't reach each other; asks go unanswered) and out (finds go to Waiting lists and stop); four causes, six needs. Then your frame (`shapes.md` §6): make the communication something code carries, with one general structure and declared shapes on it, as WordPress does, and LLMs as components inside it.
- **16 Nov, design on paper.** A design plan, the mapping (303 items placed on the frame), an inventory of what Harbour already has (`existing.md`), four avenues for building it (`avenues.md`), and a Yap spike in which a model turning prose into records had to guess who should act on 34 of 71. This session became the driver.
- **17 Nov, the layer.** Seen as a programmer would, the loop had become short-lived workers passing free text appended to shared places: text with no end leaks, every reading is a parse that can drift, and with no addressee every reader's input grows with the history. You proposed the method: a design doc revised in place, a minimal model rebuilt from it each round so nothing gets patched, and walks, cheapest first. Six rounds ran that day.

## The pointy end: the layer at round 6

**What it's for:** a proper home for what overloaded tickets and notes carry today, so tasks no longer travel as ever-growing text and Harbour itself does more of the bookkeeping. **What it is:** a well-structured store. A small set of record kinds (task, plan, finding, check, question, decision, verdict, lesson, area, change, run), each saying who wrote it, who must act on it next, its state and how it ends, and what it rests on, with every version kept. Writes are checked for shape only; views, counts and each stage's short brief are computed from what's held. Agents and Harbour act; the store keeps the books. Detail: `docs/plans/survey/layer/design.md` §3.

**What the walks showed**, replaying real finished tasks stage by stage with fresh agents:
- Everything that happened had a home.
- Hand-offs were addressed by the stage that wrote them. Filled in after the fact, 20 of 22 addressees had to be guessed; from walk 2 on, writers addressed their own.
- Retelling stopped once stages could look things up.
- Corrections replace the record instead of piling beside it, and briefs stop growing with the ticket's history.
- Stale now flags only judgements on a version that really moved.

**Where I drifted, and how it came back.** In round 3 I turned the shape checks into enforcement (who may write, when a task may close), which is workflow Harbour already does; round 4 went back to a plain store. In walks 5 and 6 I turned the comparison with today's tickets into a reading quiz and read its scores as a verdict on the design; that is set aside.

**Not yet shown.** No stage has written through round 6's fixes (a `to` on any record, superseded verdicts, "needs-discussion", area scope, blindness in queries). Every walk replayed what stages really wrote, so none did new work through the store. Traces 4 and 5, and Yap as the outside project for testing the design, haven't been walked. Not designed yet: how agents reach the store through the proxy, how the tracker shows records, pages for you, waking. And it isn't agreed: the design is mine until you've corrected it, and it's settled only once we both find it simple to use and much better than what exists.

**Corrections.** Today's readers found five errors in my own write-ups, each checked by me: walk 6 still reads its quiz as a verdict and reused walk 5's ticket-reader answers; `design.md` credits you with the two guards, which `shapes.md` marks as my reading; walk 5 overstates what the store caught; and walk 3's newsletter was an invented scene. When we start, I'll correct the design page and the walk write-ups in place, as walk 1's was, and add a log entry saying so; the log itself stays as written.

## Methods that have worked

1. **Rebuild, don't patch.** Gather scattered decisions into one place, rebuild from a fresh design, and replay old against new: on 17 Oct eight tickets merged with zero behaviour differences, and ten rebuilds cut the worst function by 29–88%. The layer rounds use the same idea: fix the design and rebuild the model, never patch it.
2. **Remove rather than add.** Steering text shrinks only by deletion (74% of real shrinkage) and by rewriting from a stated purpose (25%); trimming single rules gave nothing. Hence looser, not tighter; fixes remove things; measures report and never gate.
3. **Code keeps the books, models keep the judgement.** Code detects and the model decides; a lesson lands as code or a test before it lands as prompt text. The layer applies this to information.
4. **Finish the move, where the change binds.** A tidy that deletes its copies reads better, a partial one mixed; the after step lifted its area five times out of five; the fake-DOM census went from 56 to 6.
5. **Hand things to whoever can act.** Information handed to someone placed to act gets used; information left in a place piles up.
6. **Independent eyes.** Blind reads, which corrected my own optimistic tallies; a second document checking each paper (23 of 24 had a claim corrected); fresh readers before launch; and the parrot reading drafts against your words.
7. **Expectations before looking**, committed first: forecasts, predictions, each walk's `expect.md`.
8. **Cheapest test first, real work last:** a finished task filled in after the fact, then replays, then scenes, with motion only once the cheap checks hold.
9. **Hold the whole.** Your words as the source and the record never rewritten; re-reading the papers, essays and artifacts so the whole stays in view; short sittings started from a kickoff while one session holds the thread.

**What hasn't:** rules and checklists (prompts turning into lists, the size setting, gating on area reads); defining a thing sharply in order to count it, which is how tight definitions in the Periodicals let the leaks go unseen; filing work as new tickets; a session holding the loop together by hand. And my own patterns: agreeing too readily, drifting into machinery and quizzes nobody asked for, and verdicts before reading.

## Where that leaves us

On your first question, the record shows finished tasks going from spiralling to reading level or better, and consolidate-then-rebuild and Theseus improving the code on every target tried. On your plan, finding the leaks, why, and what's needed is done. Building the specific solution simply is the layer, at round 6 and not yet agreed. After it come integration, then small projects, then Jira. Parked with you and unchanged: the seven safety findings, LIN-4416, LIN-4210 and the paused lanes (LIN-4441, LIN-4445, LIN-4463).

## Since: walk 7, approval, and what's next (18 Nov)

- **Walk 7** (`layer/walks/7/results.md`): stages wrote through round 6 on LIN-4450, LIN-4446 and LIN-4469 (32 steps), and Yap's mobile thread was filled in after the fact. Every round 6 write that had never been tested worked; the only refusals were malformed writes; stale stayed quiet; what was open at each end was owned. Two faults, both from brief part 8 (the previous stage's whole account): it leaked the review's verdict to the blind read, and it swelled late briefs by 40–96%.
- **Design revised and approved.** Part 8 became a one-line pointer (the words stay in the run, read with `get`); blindness also covers judges' accounts; the verdict's `of` became `judgement`; open records under an ended task reach the parent's brief. John approved `layer/design.md` on 18 Nov with no further notes. A doc copy: https://claude.ai/artifact/WvYq7VFCu6r7aj9kWsbGb5.
- **Next, in order:**
  1. A short integration design on paper, on what Harbour already has: the store as one collection keyed by kind (the local-store pattern); agents reach it through proxy endpoints mirroring the model's commands; the brief built in code and fed to the prompt builder instead of ticket text; rulings as questions and decisions, the rulings page as John's view; the tracker as a synced summary; wakes driven by what is open for each reader. Each slice names what it retires. John reads and corrects it before anything is built.
  2. Build it through Harbour's own loop, one route per slice, removing the old route in the same move: hand-offs first (retires the Waiting lists, the `Retires:` conveyor, "record it as not run", answers as comments); then verdicts and runs (retires the comment classifier); then the plan as versioned state (retires the prune and the copy-down); then lessons and areas (retires the notes).
  3. Real work. **The first work through the upgraded Harbour is the parked work** (John, 18 Nov): the seven safety findings, LIN-4416, LIN-4210, and the paused lanes LIN-4441, LIN-4445, LIN-4463. Read against the 13–14 Nov baselines (notes growth, Waiting, sessions and cost per task, brief size, blind reads), reported, never gating. Then John's pet projects (Yap first, John as new user), then the Jira project.
- **Housekeeping:** the harbour.cat proxy token in the session scratchpad expires 19 Nov; a new one is needed before real work. Steps 1–2 are desk and repository work.

## 18–19 Nov: integration design drafted, paths removed, walk 8

- **The integration design.** Step 1's plan was agreed, with John's correction that knots are called case by case (tidy before, tidy after, or accept), not ruled out (`integration/plan.md`).
  - The census of today's code (`integration/census/`, 263 sites), draft 1, three checks and draft 2 are in `integration/`.
  - John's answers so far:
    - provider sync is a follow-up;
    - the parked work runs after slice 4;
    - the brief's temporary ticket section until slice 4 is fine ("a little temporary scaffolding is ok").
- **Paths removed.** John caught the area list assuming Harbour's own repository layout. An audit found path matching throughout both designs. The layer was revised by removal: no areas, no task, lesson or run paths, and `project` as an addressee.
- **Walk 8** confirmed the revision (`layer/walks/8/results.md`). Six more removals followed (log, "18–19 Nov"). The layer now has 10 kinds: task, plan, finding, question, decision, verdict, lesson, change, run, and the project as an addressee.
- **Next, in order:**
  1. Bring `integration/design.md` into line with the revised layer:
     - no areas: findings go to `project`;
     - the blind read through Harbour's route only;
     - findings with `how` instead of checks;
     - name who works the project pile down (likely the leftover step, one per build);
     - the plan rule.
  2. Then John's remaining integration questions, one at a time: the question kind's `on-answer` field, the actor list from the stage kinds, rulings as their own slice, slice 6, knots.
  3. The API review (how intuitive the record calls are for agents) before or during slice 1.
  4. Then build, slice by slice; the parked work runs after slice 4.
- **Housekeeping:** the harbour.cat token expired on 19 Nov; a new one is needed before real work.

## 19 Nov: integration design agreed

- **Draft 3** brought the integration design into line with the trimmed layer; a fresh recheck found nine more places out of line, all fixed.
- **John's seven questions,** answered one at a time, each removing something or deferring a guard until a reading shows the need: no `on-answer`; no actor list (`to` checked against what Harbour can brief); rulings their own slice 4; slice 6 waits on slice 1's count; knots accepted as a tax ("make it work, then make it good"); the blind read stays prompt-only, measured in slice 3; the project pile is a backlog John acts on.
- **The API review** (agents' own notes from walks 7–8): links accepted flat, a bare `on` pinned to the current version, an idempotent end, every problem named in one refusal; two layer clarifications (any end may name what took over; links only add).
- **Colour.** John asked for the context that makes the asks easy to follow: a leaks table from the traces, a before-and-after drawing, a scene per slice. The same goes into each slice's ticket.
- **Agreed** by John on 19 Nov (doc: https://claude.ai/artifact/62y2rpauvpedF8NRS4FqYh). Step 1 is done.
- **Next, in order:** the documents to main by pull request; a fresh harbour.cat token; slice 1 filed as a Harbour task under a parent, with its why and scene; each later slice filed as the one before lands; the parked work after slice 4.
