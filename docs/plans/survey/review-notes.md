# Review notes: the whole thread, read in date order (8 Nov 2026)

John's ask, after round 1 and a compaction: read all the relevant notes and docs in date order, think it through, report with analysis, then give a view on how we proceed — short term, and long term against our goals and Harbour's bigger picture and roadmap. Make notes as you go.

These are the reading notes, written as I go. The report comes after.

## Reading order

| # | Date | Doc |
|---|---|---|
| 1 | 3 Oct | `docs/papers/harbour/like-a-skilled-developer.md` |
| 2 | 25 Oct | `docs/plans/costs.md` |
| 3 | 29 Oct | `docs/papers/harbour/why-work-spirals.md` |
| 4 | 1 Nov | `docs/papers/harbour/one-feature-twice.md` |
| 5 | 2 Nov | `docs/papers/harbour/tasks-are-tasks.md` |
| 6 | 2 Nov | `docs/plans/survey.md`, `docs/plans/survey/prompt.md` |
| 7 | 2–3 Nov | `log.md` (spikes), round-2 and round-3 forecasts |
| 8 | 4 Nov | offshoot prompts, `broad-options.md`, `place-ledger.md`, log |
| 9 | 5 Nov | `notes-2026-11-05.md`, log, `task-size-and-cost.md` |
| 10 | 6–7 Nov | `cleaner-than-it-started.md`, `the-place-became-somebodys-job.md`, log |
| 11 | 7–8 Nov | log (round 1), area notes in both repos, Stability Review run 5, `round1-results.md` |
| 12 | now | `docs/north-star.md`, LIN-4341/4342/4343 and the roadmap |

## Notes

### 1. *Like a skilled developer* (3 Oct, essay, Flight Companion with John)
- **Diagnosis:** the stages see the cause and write it down instead of fixing it. In 37 sampled tickets, 231 off-frame observations: 46% noted and left, 28% filed as follow-ups (over half never worked), 17% acted on, 6% to John, 3% dropped. The cause was fixed in 10 of 37, usually by a route outside the pipeline.
- **Archive facts it leans on:** 2.1 tickets created per one closed over sixty days; half of filings never worked; 23 of 40 unworked filings were the parent's own unfinished scope. Plan review sent back 83 of 94 plans, always for one more list item, never a different design.
- **Why:** every stage asks "does *this ticket* need it?", never "is this the cause?". Prompts are shaped like code (~240 KB), each rule a scar paid on every run.
- **The aim, in John's terms:** a skilled developer owns the problem, fixes at the cause, refactors when that's simpler, and leaves the code calmer. Only what John would need to tell the team about first goes to him; "large" is that, not size or effort.
- **Teacup and storm:** Harbour's own defences (tests pinning prose, the size freeze, plan review's verify-only, breakdowns' "do not redesign") squeeze a sweeping change into line-level edits. They should give way to John's intent.
- **It names us:** "Briefs to agents should carry intent, not slices, and that includes the Flight Companion's." The operator's habit of writing the how is a month old in the record.
- **Its success measure:** fewer recurrences, fewer orphaned follow-ups, code that settles instead of creeping upward. Forward check: deepest finding fixed at the cause more often than 10 of 37.
- **Read against round 1:** the spiral is the 2.1-per-closed pattern again, this time from the operator; the setting is the Flight Companion writing a slice (a mechanism) instead of intent; the Stability Review's "creeping upward" is the success measure not yet met.

### 2. `docs/plans/costs.md` (25 Oct, design note; the source for LIN-4341)
- **John's ask:** "a lovely, simple, tidy way for people to easily understand costs, in a way that makes optimisation both easy and safe for an average user." Token cost at list price is the primary figure; what you paid is a layer on top, never blended.
- **The smell:** cost computed in five places, none reconciling. John: "figures not matching is a smell of complexity and tangles in the underlying code."
- **Order:** tidy first (Theseus: own, free the seam, consolidate), then rebuild into one read model, backfill, the page, and optimising last. John: "We can change behaviour [if] it's an improvement. We just tidy first."
- **It leaves the how to the build:** "It does not choose files, functions or schemas." But it's long and decision-heavy (ten decisions, a seven-step order). It predates the survey loop and the "err larger" answer, so the loop will need to size it, not follow the seven steps as tickets.
- **What has moved underneath it since:** LIN-4263 (`/cost` per dispatch, 5 Nov), LIN-4358 (model facts from the OpenRouter catalogue; the hand price table is gone), and the round's own `/cost` use. Some of "What is true now" is stale.
- **Round-1 bearing:** the reconciliation check needs a scoped OpenRouter key, the same wall LIN-4358's Luna evidence hit. A capped key would serve both.

### 3. *Why work spirals* (29 Oct, paper, LIN-4020)
- **The engine is inside a ticket:** research names classes, the plan must work from them, and plan-review sends back any missing member. Fuzzy concepts ("blue") have no sharp edge in code, so each round finds one more member, and each is written into the one description the next stage reads.
- **The loop code reads a flat count of one as convergence** and grants more rounds (bound 3, ceiling 5). LIN-4009: five send-backs, two rulings to continue, and the defect that mattered (a default-blue link) was found by post-build review, not by any class bound.
- **Amplifiers:** scattered code makes edges hard to find; stage output piles up in one description; rules are added about six times as often as they're removed, none with a retirement condition. "The part of a fleet that is counted but not limited grows."
- **John, 29 Oct:** "the agents too prescriptively following too prescriptive rules through too prescriptive pipeline stages." The archive: "Harbour executes the words it is given rather than holding the intent behind them."
- **Read against round 1:** our spiral was the same shape one level up. Across tickets, not inside one: every find counted as a ticket, and nothing limited ticket count until the counterweights. And the counterweights are themselves rules added with no retirement condition, living in one session's briefs. The 6:1 add/remove ratio is the thing to watch in Harbour's own prompt text: the Stability Review saw prompt-contract churn double (13% → 28% of landings) during the round.

### 4. *One feature, built twice* (1 Nov, essay, LIN-4085's A/B)
- **The test:** one feature built by a single fast session (21 minutes, $21.51) and by Harbour's pipeline (71 minutes to checked production, cost only estimated). Blind score 30/35 for the fast build, 27/35 for Harbour. The fast build still left a Host-header flaw; Harbour's 4-minute review found the missing test that would have shown the same class of flaw.
- **The turn:** the intent was lost at the first hand-off. "A full guide" became "sequence the human's few clicks" at scoping; the plan applied the prompt-size budget to a public guide; review approved against the plan. Every later stage checked scoping's brief, not the request.
- **The idea (the thesis for Harbour's roadmap):** Harbour's stages bundle two jobs. *Capability* (splitting into fresh sessions) now costs more than it gives. *Accountability* still pays: keep the intent intact, judge independently, land with proof, measure across runs, and, as a proposal, accept work from any builder. "Building is becoming a commodity… Independence is structural."
- **Spine and branches** (a proposal, not tried): one warm builder from research to fixes; fresh judges branch off at the gates with the original request. John's version: save the task's information better first, then hold it in one continuous session "like a cache over the record".
- **What would shrink under this reading:** splitting production across fresh sessions, the scaffolding around building prompts, sessions per ticket.
- **Read against round 1:** LIN-4345 (the sealed "As asked" block) is this essay's "first fix is cheap", now built. LIN-4348 (choosing the contractor, parked) is its "accept work from any builder". Spine-and-branches hasn't been tried yet; it's the essay's biggest open bet, and the Stability Review's evidence (more prompt text, more stages' contracts) runs the other way from "what would shrink".

### 5. *Tasks are tasks, and the codebase is a place* (2 Nov, essay v5; the survey's founding document)
- **Diagnosis:** agents are good contractors, but "nobody's job is the place". Three things follow:
  - the one who feels the friction is held to the ticket ("improvement noticed, not required" appears 158 times);
  - what's learned is filed under the job (John would reopen one decision: the ticket as source of truth, which conflates the job's record, the plans and the place's memory);
  - nobody owns the first half of Beck's "make the change easy, then make the easy change".
- **Numbers:** since 1 Sep, 965 commits grew the app by ~78,900 lines; ~100 shrank it, nearly all from tickets whose job was removal. Of 190 escaped defects, 86 (45%) trace to one decision held in several places. Changes touching a scattered decision are ~5× the size and sent back more than twice as often. Prompts grew 5–6× June–Sept, then were frozen (568k → 343k bytes in the first week through two real removals; held, not lightened, since).
- **Tried before:** inspectors (periodicals minting tickets nobody worked), a budget (Passages), a question turned to serve the ticket (Surface Assessment → "push vs pull"), authority (Scope and Authority, cause of *this* task). **What worked was a session doing the resident's work** (the coherence loop, Theseus rounds: on 17 Oct, eight tickets, 95 → 26 places, John's cost "two presses on ruling cards"). It ended when John turned the frame: "continuity of method was largely solved, and continuity of standing was not."
- **John's images:** the forcefield (his attention is a hand held out to keep a shape; "every time the hand moved, the shape dissolved"); the ball (where a diff *binds*); settled is a balance, not smallness; the trig point ("toward settled, or away"), "including our own".
- **The answer:** forecast first. A spine (the pipeline as is) and an offshoot asking "why is this difficult?", with a menu: just drill / small tidy first / consolidate the decision / Theseus on the area. It advises; it doesn't gate. Periodicals become the place's film and stop minting. The code holds what the place is; a small notebook kept with the area holds where it's going; the ticket keeps only what was done. Tidying goes under the stack in autopilot's order (pull, idle time).
- **The cautions:** build no new nouns; a new step is a new gate, and gates are where prose collects; pull, not push; "textbook style" travels by worked examples, not rules; **do it in one area first**.
- **The charter-retro caution:** tidying where a change doesn't bind moves stone without settling it (`routes/` grew overall while the moved files shrank).
- **Read against round 1, this is the yardstick:**
  - Built as the essay asked: Surveys = the offshoot (LIN-4248); area notes = the notebook (LIN-4347); Periodicals as film that mints nothing (LIN-4349); autopilot's order puts landed-lane work below real work (LIN-4382).
  - Against its cautions: round 1 added steps (look-first runs both Surveys before scoping, even on a Periodical's review ticket: push, not pull); added prompt text (contract churn 13% → 28%); added a noun nobody asked for (the size setting, removed); ran six areas at once on Harbour's own machinery rather than "one area first".
  - The Stability Review's whole-not-converging is the charter-retro caution again: each touched area got tidier, while what the round added (machinery) grew the whole.
  - Standing: round 1's purpose was to move the resident's standing from this session into Harbour. Partly done. The counterweights stayed in my briefs, so Harbour's own close-outs still filed four tickets.

### 6a. `docs/plans/survey.md` (2 Nov working document; main's copy is kept current by Harbour's own builders through LIN-4393)
- **The aim:** Harbour brings codebases **toward settled**, its own included. The Survey asks "why is this difficult?" before a task and returns a menu (just drill / small tidy / consolidate / Theseus), each option priced in what it buys *this* task.
- **What's known:** the pipeline is faithful to the ticket (94% of requests survive word for word; 94.7% of asks delivered). Friction is noticed and left. The resident existed for 16 days (11–26 Oct) and ended when the frame moved.
- **Two live streams John was holding by hand on 2–3 Nov:** Costs (LIN-3936; a record ticket as notebook, one tidy at a time toward a rebuild, a "bar" revised from evidence) and UI round 3 (LIN-4040; five planned groups became 17 tickets, `lib` +1,900 lines, unit tests +13,000: "settles where it is aimed and relocates mass everywhere else"). **These are the two "real tasks" waiting now (LIN-4341 costs, LIN-4342/4343 UI).**
- **The Survey's own rules:**
  - "Spike 2 is the verdict; spikes 1 and 3 are calibration": only a forecast made before the work tests the claim.
  - **Asked twice:** the builder answers the same question after merge. "The Survey doesn't need to be right; it needs to be wrong in a way the after-answer can show."
  - **Who compares the pairs:** John with the operator. "Each comparison ends in a line taken *out* of the Survey's prompt… or 'none, and why'… Without it, the pairs become one more report and the Survey grows like every other gate. Removing lines is the smallest part of John's hand that can't yet be lowered."
  - It advises and never gates; pull, not push; keep it out of the review loop.
- **How it runs now (LIN-4346/4370):** code runs survey-task, survey-place, then scoping on *every* fresh ticket with no size record. Code reads only whether each ran, never what it said. So it's advisory in content but mandatory in sequence, which is a drift from "pull, not push", and is the root of round 1's question 9 (it ran on a Periodical's review ticket).
- **Working rules:** research and writing go through Harbour; **file tickets only when John asks**; judge by looking, no rating schemes; write tickets at the level of the idea.
- **Cautions:** no new nouns; taste by example; **one area first, "generalise only when the hand feels lighter there"**; independent hands; builders defend their detours; push vs pull; a new step is a new gate.
- **Open question still open:** "How much of John's hand is structure Harbour can hold, and how much is attention that needs a resident?" Round 1 was a direct test of this.
- **Gap against round 1:** I don't recall round 1 comparing Survey forecasts with builders' after-answers and taking lines out of the Survey's prompt. The "asked twice" rhythm seems to have lapsed once the Surveys moved into Harbour (check the log for 5–6 Nov).

### 6b. `prompt.md` (the Survey prompts and their history)
- **The prompts got simpler as they got better.** Survey v0 → v1 → v2 were a structured menu (where it binds, why, four options, a prediction, what you couldn't check). Round 2's side arm, **open-0**, asked only the open question, with no menu, no checklist and nothing Harbour-specific, and it replaced v2. A second voice, **global** (the place, code only), and a **step-back** (only when the two disagree) were added. That's the "briefs, not programs" lesson from 3 Oct, shown on our own instrument.
- **The after-questions (q1–q7)** went to the builder at merge. q6 ("what did your change leave behind…") is the ancestor of LIN-4347's leftover question at `[done]`. q7 asked whether a deliberately larger scope paid for itself.
- **Since LIN-4248** the live text is the `survey-task` template in the code, held in one place.
- **Gap to check:** after the Surveys moved into Harbour, did anyone keep sending the after-questions and comparing pairs? LIN-4347 kept q6's spirit (leftovers) but not q1–q5 (why was it difficult; what did the ticket get wrong).

### 7a. Log, 2–3 Nov: the spikes (lines 1–366)
- **Verdict at 16:20 on 3 Nov:** the Survey works as a *surveyor*, not just a reviewer. On three live tickets, forecasts written before any work named where the change would bind and what a plain build would leave behind, and then it happened:
  - S4: the left-behind pill tables became LIN-4159 within hours, and review's regression landed where the forecast pointed;
  - LIN-4110: the cause of a flake read from code, a warning that the ticket's own fix would weaken the guard, and the seam the builder then built, better placed;
  - S5: the 12px pin collision that became two rulings.
- **Its blind spot is one class:** things you only learn by drawing or running (CSS draw order, phone pixel budgets, test seeding, the runtime cascade). v2 added "say what you couldn't check", and on LIN-4110 that list was the builder's first checks.
- **Builders asked "why was this difficult?" (1a):** seven answers, all concrete and causal. Every one named a decision held in several places, or shared test state. Each "first" was a small complete tidy or a consolidation, with a sized payoff (a third to a half of the diff, a review round, a day of E2E runs). None asked for Theseus; none said "just drill".
- **Two instruments, two halves (1b):** the census catches decisions *spelled* the same; builders catch decisions *meant* the same but spelled differently (parent/children in three to five structures; the ruling count in four places).
- **Weaknesses:** the menu recommended "just drill" past copies it had found (C1 escapes *are* copies left behind), and scale was badly under-forecast (2 prerequisites predicted for S3, 11 tickets actual).
- **Best-attested tangle:** per-worker-key test state with no single reset, named by three independent hands; the census was silent.
- **Operating lessons:**
  - a finished session can be asked within the 6 h reap window;
  - a follow-up wakes its lineage's autopilot;
  - follow up only on Done tickets whose autopilot has ended (I touched a live one);
  - book the next wake *before* any step that might block on a prompt (the overnight stall);
  - the UI operator rightly wanted John's own word before resuming real work.
- **Drift and Coherence's own top finding on 3 Nov repeated the essay:** "No 10-23 follow-up moved." Inspectors report; nothing with standing acts.
- **Reading now:** this was the Survey at its best. It was read-only, cheap (3–5 minutes a run), forecast-before-work, judged against what happened, and every prompt change came from a named miss (v1 even dropped a line). The rigour came from comparing forecast and after-answer. That comparison is what lapsed later.

### 7b. Log, 3 Nov: round 2, the plumbing tickets (lines 367–499)
- **First time acting on the forecast:** the recommended option was written onto the ticket before dispatch, and "just drill" went as written (warnings withheld to keep the test clean). Five tickets (LIN-4164–4168), filed at the level of the idea before any Survey. **All five worked live within about two hours**: sessions resumable for days, every text reply relayed, quiet follow-ups that wake no one, one reset for test state.
- **Question 5 paid off:** "measure disk first" changed LIN-4164's shape (record kept 7 days, clone dropped and re-cloned on resume) and found `sessions.json` growing about 20×.
- **John's rulings carried taste the menu lacked:**
  - LIN-4167, "No: keep the manual redeploy after green re-runs… it is a sign of grit in the gears, so warrants human attention." Sometimes the difficulty is useful and should stay visible.
  - LIN-4164's clone window: 24 h, and he cleared disk himself.
- **open-0, the side arm** (John: "perhaps our prompt is too guiding?"): on five tickets the open question did at least as well as v2, and better on three (the deciding measurement, the ruling, a hidden holder). Asked openly, "do first" was never a tidy but a **preparation**: measure, experiment, write the failing test, take the inventory, ask John. That's the TDD switch, unprompted.
- **John, 19:25:** "We want a pretty free form answer, and the temptation will be to specialise for Harbour as that's the shape of the code we're working with."
- **Builders, three for three, named a *one-interface* tidy** (one predicate, one cache shape, one posting helper) that no Survey version offered. "Which things here do the same job through different interfaces?" is the question nobody asks before the work.
- **Grit:** a "no" ruling left LIN-4167 with no owner (its autopilot had ended), so nothing closed it.
- **Reading now:** round 2 is the model of what "carry the weight" can look like when the tickets are small, independent and plumbing-shaped: two hours, five live, cheap. The round-1 contrast is sharp (six machinery tickets → 37, about $880).

### 7c. Log, 3–4 Nov overnight: round 3, Costs (lines 500–860) + `round-3/forecasts.md`
- **John's goal:** "closing the loop on tracking costs and tokens." Overnight, about nine hours:
  - Costs rebuild 1 (LIN-4176): one cost read for every surface, unknown shown as unknown and never $0, six engines deleted;
  - LIN-4127: usage relay on by default;
  - four quality-of-life tickets from builders' friction (LIN-4180–4183);
  - LIN-4181: clean `main` on the runner host, 3,859 tests and 0 failures;
  - LIN-4196: the mutation runner gets its own copy;
  - rebuild 2 (LIN-4195, one record per model request): pieces 0, 1, 2 and 5 live. It was then held at its live measurement gate.
- **Acting on the forecast worked.** Every open-0 "do first" was a preparation (a baseline, an inventory, a characterisation table, a corpus, a witness order). LIN-4127's witness avoided the exact trap named. Rebuild 2's plan *is* the Survey's order. LIN-4196's baseline found the fake mutation score the Survey predicted.
- **John's two new after-questions earned their place:** "if this area were how you'd want it, what would this ticket have been?" got a one-owner or one-seam answer from **14 of 14** builders, each sizing its ticket at a fraction of what it became ("a one-word default change", "about 60 lines and a fixture").
- **Recurring lessons:**
  - proving costs more than changing;
  - the commonest quiet failure is **a check that can't fail** (five times in one night);
  - "NOT RUN: needs production access" appeared on five tickets (John: use the Railway CLI; builders don't know it's there).
- **The close-out leak, first seen here:** "the bar's 'follow-ups listed, not filed' was ignored again. Close-out filed LIN-4191 to LIN-4194, as tidy 5's did. A bar line hasn't reached the close-out stage in two tickets running." **Round 1 saw the same thing a third time (LIN-4388/4389/4390/4392).** It's a product behaviour, not a brief problem, and it's been known since 4 Nov.
- **The essay's loop ran end to end:** builders' after-answers became quality-of-life tickets (John: "Happy for you to file and dispatch a few small tickets… as we go"), and those tickets fixed the friction.
- **To check for the forward view:** did rebuild 2 finish (LIN-4200 gate, LIN-4201 read switch, LIN-4203 stop snapshots)? It's the foundation LIN-4341 (costs) stands on.

### 8a. Log, 4 Nov morning: "is the Survey a drill by other means?" (lines 861–1040)
- **John's question:** we've measured whether the Survey makes a task land well, not whether the work cleans the codebase. "Agents lean towards the drill, so the Survey may be the drill by other means." He approved Periodicals filing follow-ups (top-down push beside the Survey's bottom-up pull).
- **The evidence leaned his way.** Every acted-on "do first" was a preparation for *this* change. The cleaning came only from tickets that were themselves cleanups. No Survey on a feature ticket had yet caused a tidy.
- **The scripted before-and-after was the first whole-place measure, and it found round 1's finding four days early:**
  - every consolidation added more production code than it removed (Costs rebuild 1 +377 net, one test reset +472);
  - all 8 new production files fell into the map's catch-all ("Other features");
  - new two-way knots appeared (Costs ↔ Runs, Costs ↔ LLM).

  "The tidy pulled by the task cleaned the task's own area and tangled the wider one." **Locally right, globally tangled is the same shape as round 1's "per-move better, whole not converging".**
- **The step-back** (a nudge to the same session): 12 of 13 chose a middle option that leaves something for the next task, and 6 changed their choice in substance. The broad option was usually "the right direction, but its own ticket". It surfaced a third option for John on LIN-4167 (a no-secret "did it go live" check).
- **The global offshoot backtest:** from the base it saw the place-level consequence (cost has no home on the map) that local Surveys and builders didn't. It didn't see second-order coupling (consumers importing the new owner back); only measuring at merge does. Caution: "give it a home in `areas.json`" is a guide edit and the cheapest way to move the numbers.
- **The loop John asked for** ("what would it take… for tasks to finish with a cleaner codebase than they started with?"):
  1. local Survey, global offshoot, step-back;
  2. build;
  3. **a per-task place change at merge** (map and census, base against merge; it reports, never gates; a worse place pulls a tidy-after);
  4. a tally of broad options by area, pulled when named twice;
  5. the Costs meter shows the payback.

  "Cleaner" read at codebase level: no new module without a home, no unnamed new two-way link, fewer places per decision, copies deleted, big units no bigger.
- **John:** "we're at the try-anything-and-see-if-it-works stage… only once we have a reliable system should we finalise it."
- **Reading now:** the per-task place change (`experiments/place-change/place-change.mjs`) is exactly the instrument that would have shown round 1's whole-place drift on each merge. As far as I recall it never became a product step; round 1 used area blind reads only. **Check later whether it survived.**

### 8b. Log, 4 Nov 08:00–11:00: forward trial 1, the Periodicals, the tipping point (lines 1040–1215)
- **Two voices work as a pair.** On rebuild 2's pieces 4 and 6, open-0 was about *proving* the change and global about *where it leaves things*. The step-back weighed the global answer (it checked it and corrected a line) and absorbed its cheap moves. The ticket got checkable "at merge" criteria (files gone, single owners, where new code lives).
- **Rulings:** John: "add recommendations to rulings, then I can approve." That's the suggest-answer habit, the root of the later click-trap risk.
- **The tally of broad options** (`broad-options.md`): eight named by more than one task. The strongest were:
  - one Stop tail in `hook.js`;
  - **settings as one described list**;
  - a shared harness for the heavy test tier, later named four times.

  Bottom-up push and pull meeting.
- **The four Periodicals, 4 Nov, are the before-picture of round 1's Stability result:**
  - Seams: "placement hiding growth"; `cost-read` is a new hub.
  - Drift: the aimed consolidation held, and our window made several new small copies.
  - Code Quality: "Did simplification keep up with feature growth? **No.**" +4,172 decision points against −430 retired; the worst units' owner tickets all Backlog.
  - Stability: "**Not yet settled.** Nothing is spiralling, but the rate of change has not settled." CI wall time 4.9 → 8.23 min since September.
- **So round 1's Stability headline ("not converging yet", CI 7.87 → 8.55) is a continuing trend, not news.** Round 1 raised the rate further (landings 17 → 26 a day).
- **"Push alone doesn't land… the missing wire is routing":** the Periodicals' findings sat exactly in the ground the next tasks would rewire, and nothing told those tasks. The experiment routed findings into LIN-4201/4203 ("carry what you cheaply can, name what you don't"). That's the ancestor of area notes read by the next change.
- **Q6 works without a map:** builders notice the place when asked; nobody had asked before.
- **Two gaps in where the Survey sits:**
  - a ticket filed mid-lineage skips the loop (LIN-4212);
  - the place view missed a twin on the parent but caught it on the piece's own text.

  "The Survey belongs at the start of every ticket that will change code." **That's why LIN-4346's look-first now runs on every fresh ticket. The cost of that universality is round 1's question 9.**
- **John's tipping point:** "when a task truly does (on average) leave the codebase in a better place once finished, even a little, we're in a really strong place. **Even if we rely on things like periodicals when we want to improve not tied to a ticket.**"
- **This is the key to reading round 1.** John's goal is per task, and he explicitly allowed the whole to be improved by a separate, Periodical-type mechanism. Round 1's blind reads say the per-task balance has tipped (5 of 6 better). The Stability Review's whole-not-converging is the part John assigned to the other mechanism, and that mechanism hasn't acted yet: Periodicals now feed notes and mint nothing, and nothing takes a tidying move from the notes in idle time.

### 8c. `place-ledger.md` (4–6 Nov): one row per merged ticket. The method's most important correction
- **My own scoring was biased, and the blind scorer exposed it.** Ledger: baseline −0.38, surveyed rows +0.84. Two independent blind passes reading only code: baseline +0.38 / +0.50, surveyed +0.37 / +0.37. "**Main question: failed.** The blind scorer rates the loop's rows no better than the baseline's." I was harsher on the baseline (scored against the map) and kinder to forward rows (credited what was averted). "**From here, the balance column is the blind read.**"
- **What reads better, per commit:** deletions; a priced tally row done as its own task; a tidy-after as its own ticket; features whose change *was* removing a second path or a flag. Ordinary features that add capability read mixed, neutral or worse. The blind scorer's strongest pattern: "**One X titles are mostly true at the centre and not at the edges**."
- **Tidy-first round (5 Nov):** where the tidy *finished* its job (deleted every copy it named), it and its follow-on read better. Where it stopped short ("a helper that callers may adopt later is one more copy"), both read like the control.
- **The "after" step:** five of five areas lifted to better, better (parent + edges tidy-after), at about +45–50% of the parent's cost, nearly all of it fixed legs (two Surveys, plan, review, close-out, autopilot). **Stop rule:** a tidy-after that reads better, better gets no tidy-after of its own; further edges go to the notebook. The residues got smaller and more test-side each time.
- **The pair baseline (6 Nov):** 1 of 4 ordinary pre-loop pairs read better, and that one was itself a consolidation. Corrected: "what reads better is consolidation (deleting copies), and the loop's finished moves are consolidations." **It does not compare loop against no loop.** That's the circularity limit, still open.
- **Routing works; pushing doesn't:** all four Periodical findings routed into in-flight tasks were resolved; all 17 pushed as Backlog tickets were unmoved.
- **Ticket history in comments:** named in at least six blind reads on 5 Nov, "a house habit, not one ticket's fault, so it's one for John". **Round 1's reads named it in every area again.** Known for three days and not acted on.
- **Read against round 1:**
  - The round-1 pattern (first read mixed, after the tidy better: LIN-4347, LIN-4378) replicates the 5 Nov after-step. LIN-4346 is the first area where the tidy didn't lift it.
  - **Why LIN-4346 broke the pattern:** its one tidy (LIN-4393) was a feature removal, not an edges tidy-after aimed at the residues its blind reads named (`lookFirstWait` through 6–7 seams, patterns written twice, `isLiveRun` beside `liveOnAnchor`, scoping's stale description, the prose parser). So the counterweight "one tidy per area" was spent on undoing a mistake. The after-step method was never applied to that area's edges. That's the real answer to question 3.
  - LIN-4378's tidy "rode the close-out" (no new ticket, no fixed legs) and was the cheapest area. **A tidy-after that rides the close-out avoids the ~45–50% fixed-leg overhead**: a product shape worth considering.

### 8d. Log, 4 Nov 11:00–11:50: pricing, John's call, Claude plays the human (lines 1211–1340)
- **John:** "we're fighting a natural urge to just land the work. The best path may be a big chunk of refactoring then the small change. More work for the task, less work in future for the global."
- **The pricing follow-up** turns "not this task's" into a decision: what the absence has cost (tally namings, builders' "how small it would have been"), against what the refactor costs done first as its own piece. It can come out as "do it first", "fold it in" or "its own ticket, now queued", each better than "someday". The harness row priced at ~1.5–2 sessions of absence against ~half a session to build. "Folding it into the next task has been tried three times; each time it was 'not this task's'." Filed as LIN-4219, the first tally row to become a task on price.
- **John, the product principle (11:10):** "It's *my* call. **Eventually a task is chosen, surveyed, and the user decides how much to tidy up.** Agents can recommend, but we can see they're not quite the right shape. We're breaking the 'natural' flow of tasks. But, don't need to worry about how this actually lands. If we can show the process works, everything else is pretty straightforward."
- **John (11:20):** "I'm happy, for the sake of this process, for you to play the role of the human. If you can choose a large enough option, we may get the improvements we're looking for."
- **This is the root of the size-of-the-move story:**
  - 4 Nov: the user decides per task, from a surveyed menu.
  - 7 Nov: "err larger" as the standing answer for this process.
  - My brief turned that into "a setting a person makes once".
  - 8 Nov: John met it as unusable, "given we'll give users a per task breakdown of options to choose from".

  The product vision was always **per-task choice from the Survey's menu, with a hands-off default**. The setting contradicted it by being global and unexplained. **The discussion item "settings in general" is really "where does the per-task size choice live in the product?"**
- **Forward trial 2 (A/B on the global voice):** it changed the *contents* of the choice (placement, corrections) but not the *option*. The effect was about the size of the run-to-run difference between two open-0 sessions. "The place view doesn't depend on Harbour's map": it worked on simple-dispatcher from code alone.
- **Reading now:** "Claude plays the human" was a research grant, "for the sake of this process". Round 1 inherited it ("err larger"), and the operator then built product mechanisms around a research-time role. The roles question (discussion item 1) should separate what's research scaffolding from what's product behaviour.

### 8e. Log, 4 Nov afternoon and evening (lines 1340–1535)
- **Results that day:** the harness (LIN-4219, five pieces) all landed. LIN-4203 shrank simple-dispatcher by ~930 lines net, the first ticket to make the place smaller. LIN-4187: letting the Survey *run* one test found the cause before work began ("cause unknown" → "cause known"). LIN-4218: one Stop table, with a latent bug found by running, preserved in the refactor and filed separately (don't mix a refactor with a behaviour change). Costs rebuild 2 Done.
- **Lessons recorded that day:**
  - routing Periodical findings into in-flight tasks works (4 of 4); pushing them doesn't (17 of 17 unmoved). "The loop's tickets are not where owners look";
  - **price a larger extra like any other piece, and give it its own piece** (LIN-4201's "loading part of the read" was mispriced as free and split off);
  - the Periodical is still needed as the film (the task view missed the erasure gap and the stale prose);
  - letting Surveys run tests makes them see more.
- **John, 17:50, the method he endorsed:** "our process of refining, trying it on real work, and measuring from time to time, is pretty good. The risk is the prompts becoming lists, rules added… I'd be happy to just keep running as we have, until we're confident." And: "Happy for prompts to expand, I'm just adding a counterbalance to the temptation to make it a big list of rules, which end up over specialising on Harbour's shape." **The generality test:** would the sentence make sense on a codebase that isn't Harbour? If not, it belongs in the codebase's own records.
- **John on hosting:** Railway isn't integrated through Harbour yet, so builders not knowing the CLI is "not a fault, and not a design either… for later". On credentials: "whatever is going to be easiest to land is best."
- **John's overnight steer (21:20), towards portability:** try without routing the Periodicals, "as if in a repo where they can't be assumed"; the global voice reads code alone; err on the side of larger tidies, still priced as their own pieces; Survey every ticket we start; skip the step-back when the voices converge; a blind second scorer; an ordinary feature ticket through the loop.
- **Reading now, for the roadmap:** John was steering the method towards something that works on *any* codebase (no maps, no Periodicals assumed, general prompts). That's the product direction: Harbour's loop has to work on a customer's repo, not only on Harbour with its rich records.

### 8f. Log, 4–5 Nov overnight: code only, no routing, the first ordinary features (lines 1535–1890)
- **John's portability steer held up.** The code-only global saw the place without reports or maps (on simple-dispatcher too). Its one cost: nobody tends the map's homes (2 of 8 rows left a homeless file).
- **Ordinary features through the loop (LIN-4144, 4151, 4048, 4143):**
  - **The forecast corrected the ticket every time.** LIN-4048's bug was already fixed, and the obvious fix would have re-added an owner removed on purpose: the Survey's biggest single save. LIN-4143's premise was stale. Two acceptance lines were wrong.
  - My ledger said all positive. **The later blind reads said otherwise:** LIN-4241 worse/worse, LIN-4242 and LIN-4243 mixed, LIN-4048 neutral; only LIN-4151 and LIN-4143 better. Ordinary features add capability, and capability reads mixed at the edges.
- **Lessons recorded, all general:**
  - err larger *in pieces*, and honour a voice that says "keep separate" (it's pricing a coupling you can't see);
  - a stop rule on the optional extra works;
  - when voices disagree on a *fact*, check the fact (a minute's read); keep the step-back for disagreements about what to do;
  - ask "who else must learn about it" of the *chosen scope*, not only of the ticket;
  - let prose about a joint state land once, with the last piece;
  - try "what are the cases this change must handle, and which does the code treat as the same?";
  - builders' q6 is the best source for copies, but kind to its own work and blind to the map (3 of 5 matched).
- **Operational gaps seen:**
  - the runner stopped polling at 21:01, and nothing relaunches a dead dispatcher by design (John restarted it);
  - **a ruling is withdrawn automatically when its ticket closes**, so an open scope question silently lost its owner (I filed LIN-4246). Same family as LIN-4167's "a 'no' leaves a ticket with no owner".
- **John, 5 Nov 08:00:** "the offshoots look like new prompt types for tasks. So move the prompts into Harbour, keep triggering stages by hand… with Claude as orchestrator and judge. If that works and keeps improving, write it up, and only then think about a fuller integration."
- **Reading now:** the "fuller integration" John deferred is what round 1 became (look-first in code, the size record, autopilot's order). The ordering he set was: works → keeps improving → write-up → only then integrate. Round 1 integrated after the write-up (the cleaner paper, 6 Nov), so the order was followed. Whether "keeps improving" was established before integrating is the debatable part (the blind reads said consolidations read better; ordinary features mixed).

### 9a. `notes-2026-11-05.md` (5 Nov morning, updated to the 6 Nov pause)
- **The correction, recorded at the top:** "What stands is how the Surveys changed the work (stale premises caught, obvious copies avoided). What doesn't stand is the claim that tasks now leave the place better than before the loop."
- **By the afternoon the operator's scope call carried about fifteen working rules**:
  - big moves early; larger extras as their own pieces with stop rules; honour "keep separate";
  - a partial move leaves a ratchet; a sweep starts by writing its check;
  - test names, not counts; write the scope as instructions, not descriptions;
  - a piece that makes an earlier claim false retires it; check a fact rather than step back;
  - a tidy-after that reads better, better gets none of its own; and more.

  **These are rules, accreting in the operator layer**: the very "prompts becoming lists" risk John named, one level up. They lived in this session. **Few reached Harbour in round 1** (the size record, look-first, err larger). The stop rule, the ratchet, "keep separate", the after-step and the blind reads are still the operator's. That's evidence for the roles discussion: much of the method is still a hand.
- **John's framing (5 Nov):**
  - a network of tasks, not a line;
  - **two dials: "make no new mess", always on; "how much to tidy", the human's budget, where anything above zero is investment.**
- **That's the product shape the size setting mis-rendered.** Dial 1 is a guarantee Harbour gives on every task. Dial 2 is a per-task budget chosen from the Survey's priced menu, with a hands-off default.
- **John (15:25): "Cost is measured, not optimised."** Doing the "after" inside the lineage was parked as a later optimisation (three builders named it).
- **Cost facts (LIN-4257):** a floor of ~$5–7 a ticket (median 44% of a ticket's cost) that rises with landed size through review rounds; the Survey ~$2 a ticket; keep-alive is the biggest bill; each extra disc pays the floor again.
- **Next steps proposed on 5 Nov, still open:**
  - "**Run the loop on a codebase that isn't Harbour or simple-dispatcher**, the real test of generality";
  - "**begin to think about finalising**: what does a person see? What does it cost per ticket?";
  - future controls ("the same tasks on a tidy codebase and on a copy with planted duplication").
- **Queued at the 6 Nov pause, to check now:** LIN-4297, 4318, 4320, 4325–4328, 4301–4303, 4256. If they're still open, that's a dozen unfinished tickets from before round 1, which matters for "converging".
- **"Reread the grounding papers from time to time" (John, 5 Nov):** this review is that.

### 9b. Log, 5 Nov morning: into Harbour's hands; blind result; John's reading (lines 1886–2000)
- **LIN-4248:** the Survey became two Harbour stages (`survey-task`, `survey-place`), triggered by hand, with no routing code. Blind reads: mixed, mixed (a careful capability change that follows the registry pattern without reducing it). Friction: the place stage didn't know which repo the ticket was in.
- **John's reading of the blind result (09:00):** "the Survey tends more towards being **the research step** than the high-level view that identifies the clean-up areas. We have a general shape that's easy to improve iteratively… **the Surveys could find things that become tasks done *before* the main task**."
- **What moved the needle:** a clean-up as its own task (tidy first, tidy-after), deletions, features whose change removed a second path. "The needle moves when the clean-up is its own task."
- **Explored, not decided, on 5 Nov:**
  - the place view's clean-up becomes its own task, merged first;
  - the blind read becomes the standard at-merge balance;
  - the place voice asks what is *already* doubled next to the change;
  - **open-0 may in time fold into the research stage.**
- **Overlap never removed:** "Removing the Surface Assessment and any other overlap waits for a later stage." In round 1 the look-first route runs two Surveys and then scoping on every fresh ticket. **Check whether research still runs after the Surveys**, i.e. whether a ticket pays for two research passes. If so, it's a ready simplification for Harbour itself (LIN-4350, "folding repeated rules into one", is parked).
- **John (10:45):** reread the essay and the papers from time to time. They remind us why, and which traps to avoid ("a step bounded by its ticket sees one copy of a decision that lives in many"; "tidying where a change does not bind moves stone"; "delete in the same change").

### 9c. Log, 5 Nov midday: tidy first, Hanoi, cost, two dials (lines 2000–2140)
- **The tidy-first round:** a tidy first moves the needle when it *finishes* (deletes its copies). LIN-4253 read better twice, and its follow-on LIN-4251 landed a scope larger than its ticket in about 40 minutes on the tidied ground. A partial tidy behaves like no tidy on the still, but showed in the film: LIN-4246's follow-on found a user-facing focus bug the old fake hid.
- **John, "Towers of Hanoi" (11:35):** the size of the move "has a fuzzy edge… that's why 'the human' decides the size of the move". Big moves early. Even a smaller scope "should" make the next go smoother. So: judge a partial tidy by the film, not the still; **a partial move leaves a ratchet** (a census whose count can only fall).
- **Cost (LIN-4257):**
  - the fixed legs are a floor of ~$5–7 a ticket (median 44%), rising with landed lines, likely through review rounds;
  - the Survey pair is ~$1.8–2 a ticket, ~30% of a small one;
  - **every extra move pays the floor again**, so fewer, larger moves are cheaper (Hanoi, in money);
  - keep-alive dominates the big totals;
  - "the Survey's judged balance does not discriminate": a third hand against my scoring.
- **Lessons for the human role:**
  - a proof-of-no-change constraint can invite a copy;
  - **a "record"-effect ruling doesn't hold the lineage**, so a proposal that changes the order lands too late;
  - a blind read's specific claims are claims, not facts. The Survey before a tidy-after checks them (it corrected a NaN claim).
- **John (13:55):** "we have almost a before, during, and after tidying up step."
- **John (14:10), the product promise:** we're turning a linear series of steps into a network of tasks and agents that can work on "the seemingly unbounded space of tangles and nests". **"Eventually a ticket with a small budget goes straight through without making additional mess, and any increase in the budget improves the codebase, making it cheaper, easier and more reliable afterwards."** Standing we can measure is more useful than the economic argument. Two dials: (1) make no new mess, always on and cheap; (2) how much to tidy, the human's budget.
- **The first "after" trial:** LIN-4263 mixed, mixed; with LIN-4276 (a small tidy-after of the named edges), better, better. About 40 minutes plus a floor.
- **Read against round 1:**
  - Dial 1 ("make no new mess") isn't yet automatic in Harbour. In round 1 new mess at the edges is *recorded* (leftovers question, area notes) but not *removed* unless the operator files a tidy (one per area).
  - Dial 2 ("how much to tidy") became "err larger", then the setting, then removed.
  - So the product promise is half-built. The blind reads' "edges" pattern is exactly what dial 1 has to absorb.

### 9d. Log, 5 Nov afternoon and evening: the after-step, cost, three instruments (lines 2140–2310)
- **The after-step went three of three** (then five of five): a small tidy-after of the blind reads' named edges, Survey-checked first, lifted every area to better, better. Track A turned around too (partial move → ratchet → the big move in pieces; census 56 → 25).
- **Builders on the tidy-after's price:** "Barely, on cost". The floor dwarfs a 20-line fix, but the separate pass found a real double-count a warm builder would have missed.
- **"The cheapest 'after' is not making the copy"** (dial 1): two of the four copies the after-steps gathered came from constraints in my own scope calls.
- **John (15:25):** "cost is an optimisation for later. Right now we just want to know: does the task actually leave the codebase cleaner? We're happy to pay a premium for that at the moment, to prove the central idea is holding and worth pursuing." The "after inside the lineage" was parked.
- **John (19:50):** "**early days, but the idea has legs**"; dispatch Periodicals as I see fit.
- **Circularity named:** "today's blind reads are partly circular. A reader names copies, we fix them, and a reader of the same prompt says better." So the Periodicals became the independent check: Drift, Seams and Comprehension-Debt over the window. "**No instrument says worse for any area the loop touched… Overall: better, small, which is the honest size of it.**"
- **What the instruments each see:**
  - blind reads judge copies inside a change;
  - Seams judges couplings between areas;
  - Drift checks against the base (the blind reads overcharge a change for inherited debt);
  - Comprehension-Debt found the stale-status-claims habit unprompted (about one a day, from work landing in pieces).
- **Lessons for the human role:**
  - **my scope text becomes the builder's comments**: write instructions, not descriptions;
  - pieces that share a hand-edited list run in sequence (three mechanics rulings in an hour from parallel pieces conflicting on one census list);
  - a piece that makes an earlier claim false retires it in the same change;
  - "the existing tests are the witness" was weaker than it read three times (mutation-check first).
- **The important comparison for round 1:** on 5 Nov the whole-place check used *three coherence instruments* (Drift, Seams, Comprehension-Debt) and said "better, small". **Round 1's only whole-place instrument was the Stability Review**, autopilot's pick. It measures *pace and growth* (landings a day, CI time, suite size, evidence bytes), not coherence.
  - So "converging doesn't yet hold for the whole" is true in Stability's sense: the rate isn't settling and the repo grows faster.
  - Round 1 has *no* coherence reading at whole-place level. Drift, Seams and Code Quality were all due ("landed") and weren't run.
  - Short-term fix: run them over the round's window, as on 5 Nov. That's a cheap check that keeps to the "Periodicals mint nothing" contract.

### 10a. Log, 5 Nov night to 6 Nov noon: sweeps, integration, the paper (lines 2310–2496)
- **More operator-made copies:** "my scope broke my own rule" (a partial sweep with no ratchet); "another rule-induced copy, mine" (a counts rule led a builder to copy a fixture). The rule that came out of it, from two builders independently: **"a sweep starts by writing its check… A grep is not a definition of done."**
- **John on integration (6 Nov 08:00):** "perhaps *how* we do this is best left until after the write-up"; a new feature, so adding and tweaking is fine. **The human calls stay human:** either "a human call (nice UI, etc)" or "like this session runs: a human instructs/gives authority to an agent". So **the authority grant is itself one of the human calls**. The first explicit grant came at 08:50 ("I grant you authority", LIN-4313).
- **The write-up was planned in two pieces:** a technical paper (first) and an essay for a fresh human reader.
- **John (09:35), the purpose of round 1 in his words:** the operator's mistakes "are what I'd expect to happen when you're holding the reins… **that's why we're moving those points you hold into Harbour, so agents at this altitude don't need to provide judgement.**"
- **And:** "**let's not undersell that this actually works**": even if per ticket it's "simply not making things worse", "it still means the trend is towards a better, simpler, easier to maintain codebase."
- **His hypothesis: larger standalone tidies from the Periodicals may be what moves the needle.**
- **The paper (LIN-4315, `cleaner-than-it-started.md`): "Tasks on average: not shown. Areas and finished moves: yes, on few cases."** It corrected me: "no instrument found an area the loop touched getting worse" was false (Seams: other features, worse as a map). It also found a real Harbour bug: issue reads silently capped at 50 comments (LIN-4322).
- **The blind-read prompt lived only in my scratchpad** ("one more judgement point that lived only in my hands. A blind-read stage in Harbour would carry its own text"). **Still true after round 1:** blind reads are operator-run, from a scratchpad template.
- **Never run: Next 1, John's hypothesis** (larger standalone tidies on the Periodicals' worst areas). It was set for discussion at the 6 Nov pause, and round 1 ("Harbour carries the loop") came instead. **It's the mechanism John proposed for exactly the whole-codebase convergence the Stability Review says is missing.** Strong candidate for what comes next.

### 10b. Log, 6 Nov afternoon: baseline, independent readings, paper v2 (lines 2496–2620)
- **Next 2:** the pair baseline read better on 1 of 4 against the after-step's 6 of 6. Corrected the same day: it shows pairing isn't the cause, not loop against no loop. "**Consolidation reads better, and the loop's finished moves are consolidations.**"
- **Independent readings after the paper:** Seams run 9 and Drift run 5 both gave "no area worse… better, small". A new residue pattern: **production bent to the test fake.** The rule: fix the fake, never bend production.
- **LIN-4322** fixed the 50-comment cap and the close-out gate that could read a stale review. The live check passed (143 comments).
- **John (15:20):** the paper "reads as though not much improved", perhaps because it's formal reporting. My reading: it led with "Tasks on average: not shown", was written against advocacy, was frozen before the strongest evidence, and never showed what the tidier code looks like.
- **Paper v2 headline:** "Areas read better in both passes, where one of four ordinary pairs did; the Periodicals broadly agree on direction; tasks on average: not shown." Nine area readings over fifteen tickets, all better in both passes; no pass read one worse.
- **Process friction:** the notebook kept on a branch needed a third hand sync to main ("a list kept by hand goes stale"): "either edit it on main, or give the live record a home in Harbour". **Still unresolved:** this branch's `log.md` is ahead of main again by the whole of round 1.
- **The log's clock headings drift** up to ~1.5 h from git and comment times on 6 Nov. Cite git and comment times.

### 10c. Log, 6–7 Nov: the essay's four versions and the 7 Nov step-back (lines 2604–2760)
- **The essay took four versions, and the difference was the brief and the contractor:**
  - v1 was cautious ("the defensiveness comes from the house process as much as from the writer");
  - v2 was patched in layers mid-draft, "and the seams show";
  - v3 was written whole, but to a checklist brief on the default implementation model (Haiku), and the checklist's seams came back as predicted;
  - **v4 (LIN-4340): one writer on Opus, from a plain ~440-word brief parroted against John's words, in about 11 minutes.** It was the clearest of the four, and merged on John's go-ahead as *Clearing up as it goes*.

  "The clearest evidence so far for **the plain brief and the right contractor**." The lesson for me: write the whole brief before the builder starts.
- **John's forcefield, corrected:** the question isn't "can the hand stay?" but "**what holds the more complex shape, so the hand can move without it dissolving?**" The direction: Harbour holds it, and the hand moves **from holding to shaping** through the human calls.
- **The 7 Nov step-back with John: "the photocopy".** Each hand-off loses intent and gains detail:
  - the Surveys are plain and gave the best judgement;
  - review checks against the plan;
  - close-out reads only review's ledger;
  - the prune deletes the plan's reasons;
  - Survey findings reach the pipeline only through my hand-written scope.

  "**My habit mirrors the agents'. I add rules beside rules, as they add code beside code.**"
- **The 7 Nov counterweights:**
  - plain briefs in the client's words that every step reads directly (a hub, not a relay);
  - a rule-of-three consolidation, keeping incidents as test cases;
  - the parrot on briefs;
  - the right model (implementation routes to Haiku by default, wrong for prose).
- **These became round 1:** LIN-4345 (the hub: a sealed "As asked" block), LIN-4350 (rule-of-three consolidation), LIN-4348 (choosing the contractor), LIN-4346 (size), LIN-4347 (leftovers to notes), LIN-4349 (Periodicals), and then LIN-4358 and LIN-4378.
- **Reading now:** two of the 7 Nov counterweights were parked in round 1's spiral response. **LIN-4348** (the right contractor) is the factor LIN-4340 showed was decisive. **LIN-4350** (fold repeated rules into one) *is* a tidy of Harbour's own prompts: the "Theseus for the prompts" the essay named and the direct answer to the Stability Review's prompt-churn finding. **Check why they were parked** (8 Nov 10:15–10:25). If it was "nothing new unless it blocks or tidies", LIN-4350 arguably qualified as a tidy.

### 11a. Log, 7 Nov: round 1 filed; LIN-4345 (the hub) lands (lines 2742–2900)
- **Filed at John's call** ("file the upgrades following our own practices, and run them through the loop"): LIN-4344, a record ticket with six children, LIN-4345–4350. Each was Surveyed at its own base; size calls plain (what and why) and parroted; the loop version logged per ticket.
- **The photocopy caught live:** `lib/brief.js`, which every stage reads first, was told to "supersede stale original wording", and it reversed LIN-4345's own brief. LIN-4351–4353 built the sealed "As asked" block, the brief composer, the proxy guard and the judging prompts.
- **The first measured case of instruction failing where structure works:** the new review wording still approved the thin guide. A per-sentence replay (12 runs) found that **review catches a cut that was named and misses one that wasn't, whatever its wording**. The lever is upstream. John answered "keep-upstream": whatever decides the size and scope names each cut in plain words and routes it to a ruling. That's the one-feature-twice remedy, arrived at by measurement.
- **John's guidance through the day:**
  - "everything new runs on Opus for now";
  - then (15:00) "**build the everyday loop, not the research rig.** We want to make it easy for us, or anyone, to run the loop simply. Whilst building it we have extra checks, but these may not be needed in the product";
  - "opus where we're unsure. If it's a typical harbour operation we know the settings are good";
  - on models: "this should be automated (eg data from open router)" → LIN-4358;
  - "If we find a model that's better and cheaper, I'm happy to move the free tier to it."
- **Pieces read mixed at merge** (copies added, nothing deleted). The tidy-after (LIN-4354, four pieces) then lifted the area: better, better.
- **Recurring patterns already visible on day one:**
  - plan labels leaking into code comments ("beat 3", "witness 4");
  - close-out filing follow-ons (LIN-4355, LIN-4356);
  - the brief model choice exposing stale hand lists;
  - my own size calls sometimes skipped the parrot (noted).
- **The question behind discussion item 9 was first asked here:** "are two separate Surveys needed, or was that research design? One look at both the task and the place might do, at half the fixed cost."
- **Reading now:** John's "build the everyday loop, not the research rig" is the clearest steer of round 1 and the right yardstick for what comes next. Blind reads, after-questions, the ledger and the two-voice Survey are research rig; area notes, the sealed ask, cut naming and the leftovers question are everyday loop.

### 11b. Log, 7–8 Nov night: LIN-4346, LIN-4347, the outage (lines 2900–3010)
- **Finishing turned the area, three times in a day:** LIN-4345 (eight merges) better, better; PR #2351 + LIN-4367 better, better. Every single piece had read mixed.
- **John, overnight:** "ideally not blocking the work on me where possible". Kickoff goals then carried "settle engineering questions yourself; rulings only for John's calls", after LIN-4358 blocked overnight on an engineering call raised as a ruling.
- **Where the setting came from, precisely:**
  - John's standing answer "err larger";
  - my 7 Nov brief: "a setting a person makes once";
  - LIN-4346's Surveys: "put the standing policy in workspace preferences";
  - my size call's done-when: "running the loop means setting the policy once and filing a ticket";
  - LIN-4368: a `sizePolicy` preference.

  Each step was faithful to the one before. **The Surveys also warned:** "the operator's scope rules were 'how' and caused copies, so auto-writing scope repeats it unless the format forbids how."
- **The size replay failed, pre-registered, and the build stopped itself correctly.** "An agent writing scope drifts into how, just as my hand-written scopes did." Wording got most of the way; the last part needed structure (a fixed size plus one sentence of why). Same lesson as the seal and named cuts.
- **LIN-4347 (leftovers):**
  - landed in both repos;
  - **the product loop went live unprompted**: leftover runs fired, tidied inside their own PRs, wrote area notes, and **found and fixed its own bug within two hours with no hand on it** (LIN-4375).
  - But the area read mixed, mixed even after its tidy-after: the first time a tidy-after didn't turn an area.
  - "**An area note now defends that code staying put: notes can harden into rules.**" A second tidy-after (LIN-4377) went against "one tidy per area" before that rule existed.
- **The outage:** LIN-4376's close-out crawled all 4,315 issues with retry-on-429 and used up the shared per-IP limiter for the whole fleet for about an hour. The broker hid it as a bare 502; my first guess (an expired credential) was wrong, and a read-only investigation agent found it from logs in 15 minutes. **John:** "Harbour's goal is to be simple code… let's not swing far in the other way." LIN-4378 (per credential, back off on 429) was kept small on purpose.
- **Operator errors:** I read a ruling option by its first half (two suggestions conflicted). The same ruling raised on two loops asks John twice.
- **Reading now:** the night shows both halves of the thesis at once. Harbour *did* carry the loop (leftovers, notes, a self-fixed bug, cut naming). Every mechanism that worked was *structure* (seal, named cut, fixed size record). Every failure that night traces to something unbounded or unstated: a crawl with no budget, an operator's "how", a note that hardened into a rule.

### 11c. Log, 8 Nov daytime: the spiral, the counterweights, the setting (lines 3010–3100)
- **The spiral, counted (10:15):** six tickets became about seventeen. The sources:
  - tidy-afters (convergence working);
  - incidents (LIN-4358, LIN-4378);
  - "err larger" read as more pieces;
  - a check that failed and came back as new work (LIN-4369, arms 1–4);
  - the operator filing every find.

  **John: "the spiral came from this session (the only non-regimented session in the loop, precisely what we're moving away from). That's Harbour's whole value, anecdotally proven."**
- **Why LIN-4348 and LIN-4350 were parked:** at the 10:25 finishing line, as "for the next set", alongside the counterweights (nothing joins unless it blocks or tidies; one tidy per area per move; a check that fails twice goes to John; err larger = one fuller change). They were parked for scope, not judged unneeded.
- **The click-trap:** both of my suggested options on LIN-4358 asserted that John had done something ("output pasted"). He approved as designed, recording something nobody did. Lessons:
  - for the operator, never suggest an option that asserts the person did something;
  - for Harbour, an answer that needs a person's action shouldn't be one-click approvable.

  It recurred twice more that day ("I've deployed main"; err-larger needing a hand action in Settings).
- **"Finishing turns the area":** LIN-4377 (LIN-4347's second tidy-after) better, better; LIN-4378 better, better after a tidy that **rode its own close-out** (no new ticket); LIN-4358 better, better; leftovers to the notes each time, nothing filed. The first leftover to go the whole way through the counterweight: area read → notes → no ticket.
- **Copies invited by my wording, again:** LIN-4378's "fix it in both brokers" invited two copies of the retry policy (the same lesson as LIN-4178's ticket wording).
- **Three deploy rulings for one shared event** (GitHub's incident blocking Railway's builds), each from a different close-out. "Harbour has no notion of a shared blocker that one answer can settle." Production caught up on its own at 12:02 ("wait it out").
- **The Periodicals' new contract worked live:** LIN-4387 (Seams run 10) and LIN-4391 (design review) minted no tickets and wrote area notes. Both also committed raw evidence at scale (~87k and ~118k lines): the evidence-in-git question.
- **The setting:** see the 14:00 account (seven steps). The root: "the operator, the only unregimented part of the loop, stepped down to how and acted fast… Every check in the loop reads from the same altitude as the brief, so none of them could see that the feature itself was the mistake." Then I compounded it twice. **John: "Please stop taking actions which compound mistakes."**
- **LIN-4346's area read mixed, mixed**, and most of the worse side traced to the setting. LIN-4393 removed it cleanly in 45 minutes. The parrot, now told to look for "how", cut how out of both my brief and my size call. The seal refused my hand-written "## As asked".
- **Engineering calls raised as rulings kept recurring** (LIN-4358's decisive row, LIN-4370's live-scoping wait): "close-out treats any difference from the wording as John's call."
- **Reading now:** the day's most important sentence is John's: the spiral came from the one non-regimented session. Every serious problem of round 1 came from the operator:
  - the spiral's extra tickets;
  - the setting;
  - the click-traps;
  - the copy-inviting wording;
  - the hand-steering.

  Every mechanism Harbour gained held up live (seal, cut naming, leftovers, notes, Periodicals minting nothing, autopilot's order). **That's the strongest result of the whole thread, stronger than the blind-read tally.**

### 11d. Log, 8 Nov afternoon: the close of round 1 (lines 3100–3151)
- **Retro data:** four tickets were filed by running close-outs during the round (LIN-4388, 4389, 4390, 4392). "The habit of turning a find into a ticket is in Harbour too, not only in this session. It's quieter there." **The third sighting of the close-out filing habit** (tidy 5 on 3 Nov, rebuild 1 on 4 Nov, round 1). LIN-4355/4356 on 7 Nov make it four tickets more.
- **LIN-4393** removed the setting: 28 files, +267/−404, 45 minutes from John's call, no hand-steering. **LIN-4346's area still read mixed, mixed** afterwards. Its remaining worse items are its own code, not the setting: `lookFirstWait` hand-threaded through six or seven seams, how-patterns written twice, `isLiveRun` beside `liveOnAnchor`, scoping's stale description, ~120 lines of prose parsing, docs naming the wrong function.
- **LIN-4349** read slightly better, slightly better: autopilot's order in one leaf; Periodicals mint nothing; `landed` computed purely.
- **The notes did their job once, visibly:** LIN-4346's parent close-out picked up a deferred Waiting entry (scoping reads the area notes) and removed it, with nothing filed.
- **Harbour corrected its own tail** (LIN-4349's review found the in-budget way). My suggestion to accept an extra session rested on a premise Harbour disproved.
- **The round's Periodical** (autopilot's own pick, Stability, oldest landed lane): it stalled for about an hour on a pending-external wait that didn't notice its worker had ended. A failsafe woke it, and it completed for $7.21 with no tickets.
  - Its headline: "Not converging yet. The rate of change went up."
  - Gaps it showed: no worker-ended detection; look-first ran both Surveys on an advisory review ticket.
- **Final:** six Done, two parked, about $880 across 37 tickets. LIN-4346 had the largest spend after LIN-4345, including the $111 pre-registered replay.

### Synthesis so far (before area notes, Stability and the roadmap)
1. **One diagnosis, five sightings:**
   - stages see the cause and write it down (3 Oct);
   - prescriptive rules spiral (29 Oct);
   - intent is lost at the first hand-off (1 Nov);
   - nobody owns the place (2 Nov);
   - the photocopy (7 Nov).

   Round 1 built structural answers to the hand-off and place parts: the seal, named cuts, leftovers to notes, Periodicals as film, autopilot's order.
2. **What worked, every time, was structure, not wording:** the seal, named cuts at scoping, the fixed size record, a ratchet census, a sweep's check as its definition of done, Periodicals forbidden by census from filing tickets. **What failed was unstated or unbounded:** the operator's "how", a crawl with no budget, a note hardening into a rule, close-outs' filing habit, rulings asking for a hand action.
3. **The operator was the main source of error, measurably:**
   - my own scoring was biased (blind scorers overturned it);
   - my scope wording invited copies about six times;
   - my briefs carried how (the setting);
   - I filed every find (the spiral);
   - my suggestions asserted actions (click-traps);
   - I hand-steered.

   John's reading, "that's why we're moving those points you hold into Harbour", is borne out.
4. **The honest size of the cleanliness result:**
   - per ticket (ordinary features), not shown;
   - per finished move (consolidations plus their tidy-afters), better, consistently, on a partly circular instrument, with Periodicals saying "better, small" on 5–6 Nov;
   - the whole, not converging in pace and size (Stability, 4 Nov and 8 Nov).

   John set the goal per task and allowed the whole to come from Periodical-type work, and that mechanism (Next 1: larger standalone tidies from the Periodicals' worst areas) has never been run.
5. **Much of the method is still a hand:** blind reads, the stop rule, ratchets, "keep separate", the parrot, the after-step, pricing follow-ups, and choosing what to tidy and when. Round 1 moved about six hand jobs into Harbour; about as many remain.
6. **Harbour's own growth is the tension:** every formal feature is more Harbour (prompt contract churn 13% → 28%; the size-budget test acting as a change log; notes near their caps). The thread's own warnings (no new nouns; a new step is a new gate; rules 6:1) apply to Harbour's own machinery, and Theseus for the prompts (LIN-4350) was parked.

### 12. Stability Review run 5 (`docs/reviews/stability-review-2026-11-08.md`), read in full
- **The headline,** "Not converging yet", rests on rate and size, not mess:
  - landings 17.1 → 25.6 a day;
  - net source +1.09k → +1.56k lines a day;
  - delete/add 0.63 → 0.35;
  - CI median 8.32 → 8.55 min (the only monotonic signal, driven by runtime tests 22,757 → 24,772 in four days);
  - evidence bytes `docs/reviews` 38% of the repo (`docs/papers` adds 17%; the two trees took 93% of the window's byte growth).
- **Its own nuances, which the results note under-states:**
  - **F2 prompt churn (28%) is mostly round 1 itself:** "ten of the 32… are a single programme on 11-07 and 11-08… **a burst, not a standing rate**".
  - **F3 evidence weight is governance output, not product churn.** 96% of added review lines are Periodical evidence; papers are research output. "It does not feed the code it reviews" but costs clone size and reading.
  - F5: simple-dispatcher had three days with no PRs (absent supply), and 98% of its added lines are tests (hardening).
  - **F6: `lib/dispatch-store.js` 3,967 → 4,530 lines (+14%), touch rate doubled.** Includes LIN-4347's leftover knowledge, which an area note then defended.
  - F7: the Home/task-page cluster is settling.
  - F8: rewrites eased, no repeats.
  - F9: the size setting was withdrawn 15.4 hours after it was built (partly: the size record and guard remain).
  - F10: tickets minted to landings, 1.43 (from 1.65).
  - The scope audit: `docs/areas` is a new standing surface (one landing in six).
- **Round 1's own footprint on main, measured here** (LV `e63c2f69..b315e0e8`, 38 landings):

  | Bucket | Added / deleted | Net |
  |---|---|---|
  | Production | +6,709 / −2,500 | **+4,209** |
  | Tests | — | +9,799 |
  | Fixtures | — | +2,159 |
  | `docs/reviews` | +223,523 | — |
  | `docs/areas` | — | +423 |

  Simple-dispatcher: production +180, tests +1,335. Harbour's production JS went **202,945 → 206,782 lines**.
- **What it means:**
  1. "Not converging" is mostly the research programme's own activity: building Harbour's loop, plus Periodicals and papers producing evidence. It would be surprising to converge *while* building the machinery.
  2. But the essay's success measure was "code that settles instead of creeping upward", and Harbour's production code crept up by ~4k lines to carry six hand jobs. That's the price of "Harbour carries more". Whether it's net simpler depends on the hand jobs it retired, which aren't counted in lines.
  3. **Harbour itself is a ~207k-line JavaScript control plane.** "Harbour's goal is to be simple code" and the trig point "including our own" are a long way off. The biggest lever for Harbour's own simplicity is subtraction in Harbour, not addition.

### 13. Area notes and the rules as they now stand in the product
- **Size now:** LinearViewer notes hold 25 lessons and **56 Waiting entries** across 11 areas; simple-dispatcher holds 4 lessons and **10 Waiting**. The two busiest notes (llm-and-prompts 83 lines, runs-and-dispatch 87) are nearing the 6 KB cap. The README is careful: one home per leftover, cite files not lines, prune lessons that no longer bind.
- **`LEFTOVER_RULE`, written once in the product:**
  - in the area and fix-sized: fixed on the PR;
  - in the area but larger: a Waiting entry;
  - **outside the area: a follow-up only close-out files.**

  So **the four tickets close-outs filed in round 1 followed Harbour's own rule**. My counterweight ("leftovers go to the notes, not tickets") was a stricter operator rule that contradicted the product's. Discussion item 2 is really: should an outside-area leftover be a ticket ("a filed follow-up will be done") or a Waiting entry in *that* area's note? The guard already supports the latter.
- **Autopilot's order** (`AUTOPILOT_PRECEDENCE`): goal, then due Periodical, then the stack, then a landed Periodical when nothing can move. **Nothing takes a Waiting entry.** Notes drain only when a ticket in the area sizes larger ("Waiting entries are context, not scope").
  - So the film writes to the notes, and nothing schedules the drain.
  - 66 known items have no path except opportunistic pickup. LIN-4346's close-out picking up one entry is the only drain so far.
  - **This is the missing half of convergence:** the 2 Nov essay's "idle-time chisel" (take one tidying move from the notebook when nothing else is pending) and John's Next 1 (larger standalone tidies on the worst areas).
- **Notes can harden into rules** (LIN-4347's defending note). The README's "prune lessons that no longer bind" is the right counter, and the size cap enforces it, but nothing checks a lesson's truth.

### 14. The bigger picture: `docs/north-star.md` (v3, 19 Sep) and the three real tasks
- **North star:** "Harbour keeps human intent in command of AI execution… completes verified backlog work at a cost and cadence a solo operator can sustain… and proves every word." The thread's findings map onto its sentences:
  - "**Verified beats claimed**": "cleaner" is still verified only by operator-run blind reads, not by Harbour.
  - "**Cost per verified task, visible and falling**": LIN-4341 is this page.
  - "**Follow-on tasks and wakes per verified task are tracked taxes**": the spiral and close-out follow-ups.
  - "**False-escalation rate is a headline KPI** ('why was I asked this?')": the engineering calls raised as rulings, the duplicate deploy rulings and the click-traps.
  - "**Finish transitions before starting capabilities**": finishing moves is what reads better.
  - "**Complexity that breaks legibility is a defect even when locally justified**": Harbour's 207k lines and the "one owner at the centre, a copy at the edge" pattern.
  - "**Meet a developer at the saved prompt**", the ladder: the survey loop lives only at the top rung (a standing loop). The size setting was a global switch where the ladder wants a per-task choice.
- **LIN-4341 (Settings › Costs):** a plain, purpose-and-feel brief with "Done when" and no how. It sits on tidied ground (`cost-read`, rebuilds 1 and 2, `/cost` per dispatch) but needs workspace totals by day, history past 30 days, calls with no workspace, and cost around model changes. Its reconciliation needs the same capped OpenRouter key that blocked Luna and the Haiku replay.
- **LIN-4342 (the side rail):** Theseus the navigation; every page's frame.
- **LIN-4343 (UI sweep 4):** 23 items, page by page.
- **On the two UI tickets:** both are broad, cross-cutting design asks, the kind that spiralled before (round 3: five groups → 17 tickets; the brand-blue five rounds). The sweep depends on the rail's frame, so they run in sequence.
- **Open tickets from the thread:** 14 from 4–6 Nov (LIN-4210, 4214, 4256, 4275, 4297, 4301–4303, 4318, 4320, 4325–4328) and 8 from round 1 (LIN-4348, 4350, 4355, 4356, 4388–4390, 4392), plus the records LIN-4344 and LIN-3936. LIN-4390 (Periodical prompts grant merge authority the dispatch gate reserves) is an authority defect, not a tidy.
- **Model choice is still a hand:** the kickoff goals say "use opus". With LIN-4348 parked, an operator-free run falls back to the routing defaults (Haiku implementation, Sonnet plan). That's a dependency for the next round.

### Final synthesis → see `review-2026-11-08.md`
The report and my view (short and long term) are written up there from these notes.

### 15. Checked at the end: the paper v2 itself (`cleaner-than-it-started.md`, headline, limits and Next read directly)
- **The headline matches the log's account:** "Areas read better in both passes, where one of four ordinary pairs did; the Periodicals broadly agree on direction; tasks on average: not shown."
- **Its Next 1 is its own top recommendation:** "Test whether larger standalone tidies move the worst areas… against the same areas left alone. **That is the test that could move the net direction, and this window cannot make it.**" Never run.
- **Its Next 2** (an untouched-area baseline) and **Next 6** ("test the structure argument": would a guard or a derived list have stopped the operator's mistakes?) are also unrun. Next 6 is the same conclusion as this review's "structure worked; wording didn't".
- The later essays (*The place became somebody's job*, *Clearing up as it goes*) I read through the log's record of them, not in full.
