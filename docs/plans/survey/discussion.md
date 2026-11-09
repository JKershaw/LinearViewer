# Toward settled: the discussion, and the plan onward

Started 8 November 2026, after round 1 (LIN-4344). This is the live record of the discussion with John. We work through the items in order, and each item gets its decision written here as it's made. The order runs from the goal, through the rules of the loop and the next round, to bending the curve and the roadmap, so finishing the list leaves us at the start of the plan.

**How to use it**
- **Status marks:** ○ open, ◐ in discussion, ✓ decided, → deferred (with where to).
- **For each item:** what we know, the options, my recommendation, then **Decision** and **Notes**, filled in as we go, and **Leads to**: the tickets, notes or rules it changes.
- **The log stays the step-by-step record.** This file holds the agenda and the decisions. When an item is decided, the log gets one line pointing here.
- **One home for everything.** Every open item ends as a ticket in a phase, a Waiting entry in an area note, or closed.

**Sources:** `review-2026-11-08.md` (report and view), `review-notes.md` (reading notes), `round1-results.md`, `log.md`, and the page *Toward Settled* (claude.ai artifact, private to John).

---

## Baseline: where things stand on 8 November

The roadmap's measures start from these.

| Measure | 8 Nov | Source |
|---|---|---|
| Source lines added a day | ~2,390 | Stability Review run 5 (delta 4 Nov → 8 Nov) |
| Source lines deleted a day | ~830 | same |
| Net source growth | **+1.56k lines a day** | same |
| Lines deleted per line added | **0.35** (0.63 in run 4) | same |
| Harbour production JavaScript | **206,782 lines** (202,945 before round 1) | `lib`, `routes`, `public`, `server.js` at `b315e0e8f` |
| CI median wall time | **8.55 min**, rising in every window since September | Stability Review F1 |
| Runtime tests | 24,772 (22,757 on 4 Nov) | same |
| Landings a day | 25.6 (17.1 in run 4) | same |
| Tickets minted per landing | 1.43 (1.65 in run 4) | Stability Review F10 |
| Waiting entries in area notes | **66** (56 Harbour, 10 runner); 29 lessons | `docs/areas/` in both repos |
| Evidence weight | `docs/reviews` 84.4 MB, 38% of repo bytes; with `docs/papers`, 55% | Stability Review F3 |
| Open tickets from this work | 22, plus records LIN-4344 and LIN-3936; LIN-4395 new | Appendix A |
| Cost per ticket, round 1 | about $24 at API rates ($880 over 37 tickets) | `/cost` |
| One task's session graph | LIN-4393: 8 sessions, $14.94, 54 min first Survey to merge; ~200 tokens read back per token written | `/cost?perDispatch=true` |
| Area reads, round 1 | 5 of 6 better; LIN-4346 mixed | blind reads CA–CN |

---

## Part 1: the frame

### D1. The goal and its measures ✓
**The question.** What are we aiming for, how do we plan toward it, and what do we read each week to know it's working?

**What we know.**
- Goal: Harbour brings codebases toward settled, including its own.
- John's tipping point: on average a task leaves the code a little better, and the bigger improvements can come from Periodical-type work.
- Two dials: no new mess (always on), how much to tidy (per task).
- The north star (v3) already makes cost, false escalations, follow-on tasks and legibility first-class.

**Proposal: four measures, read weekly.**
1. **No new mess per task:** ordinary tickets read neutral or better in a blind read.
2. **The curve:** net production lines, deletions per addition, CI time, Waiting entries, tickets per landing.
3. **Your seat:** questions to you that are really yours (false-escalation rate), and runs that need no operator.
4. **Cost per finished task:** visible and falling.

**Recommendation:** adopt these four, with the baseline above. Make the curve the Stability Review's headline.

**Decision (8 Nov, John: "Agreed, perfect"):**
- **Goal:** Harbour brings codebases toward settled, including its own. Settled is a balance, not smallness.
- **How we plan:** pick a destination for each four-week stretch and work back from it. Take hops early, because they make every later step cheaper. Read the curves weekly and adjust.
- **First stretch, "open the door":** a small outside team on Jira, who already use agents, can hand Harbour real tasks on their own runner.
- **Gate:** stay at two in flight until a week's work needs nothing from the agent running it beyond filing words, starting runs and recording results.
- **Budget:** $3,500 a week at list prices, about $100 of it for measuring.
- **Five measures, read weekly, in this order when they clash:**
  1. **No new mess:** ordinary tickets read neutral or better in a blind read.
  2. **The curve:** net production lines a week is the headline; deletions per addition, CI time, Waiting entries and tickets per landing sit beside it.
  3. **Speed:** time and sessions per ticket.
  4. **Your seat:** questions that were really yours, and runs that needed no operator.
  5. **Cost per finished task:** measured, not optimised, for now.
- **No targets yet:** keep the 8 November baseline above and set targets at each gate.

**Notes:**
- **How we got here.** The four proposed measures became five when John asked about speed ("fast tickets"). The destinations came from his "different optimums… working backwards… given a weekly budget". The hops came from "hops… making later steps more efficient". The gate came from his "what if we gate on an agent running not needing to do anything complex?".
- **The model behind it.** Shown on the page *Plotting the Course* (claude.ai artifact, private). Scripts are in the session scratchpad (`model/push.js`, `model/gate.js`).
  - **With the gate:** two weeks at two in flight doing the hops and the Jira gaps, then four in flight with the four levers that remove work (sort hard, one first audience, Theseus moves, bring your own runner).
  - **Result:** milestone 1 (anyone can sign in and get a good prompt) lands in about week 3; milestone 2 (an outside team can hand Harbour a task) in about week 4.8, at about $1,600 a week, leaving about $1,800 a week spare once measuring is counted.
  - **Without the gate**, with the Jira gaps also included: 2.3 and 3.8 weeks. The gate costs about a week and removes the hand as the main risk at four in flight. (The 1.9 and 3.4 weeks quoted in chat on 8 Nov left the Jira gaps out of the ungated row.) At two in flight the whole way, milestone 2 is about week 7.6.
  - **The floor:** about 2.5 weeks (things that must happen in order, plus a week of real use).
- **Jira, read from the code on 8 Nov:**
  - Harbour reads, edits, comments on and labels Jira issues, with OAuth sign-in.
  - It can't create a Jira issue, so on Jira the loop can't file a follow-up, mint a Periodical or file a sealed task.
  - Also open: LIN-4355 (the As asked block), LIN-2805 (the ticket walk knows only `LIN-` IDs), the real-site checks (LIN-2094, LIN-2026, LIN-2170) and boards and sprints (LIN-2008).
- **What still needs the hand**, and so stands between us and the gate:
  - the blind read before merge;
  - filtering rulings;
  - noticing stalled waits;
  - piecing together a task's sessions (LIN-4395);
  - scheduling the Waiting notes;
  - reading the curve each week.

  Each has a hop in the plan.

**Leads to:** the roadmap's measures and first stretch (D17, whose phases now start with the gate); the Stability Review's headline (D16); D2 (the four usual actions are what the gate reads, not a rule for the operator); D11 (the backlog sorted against "open the door"); the Jira gaps as tickets in your words, at D10.

### D2. Roles: you, this session, Harbour ✓
*(earlier list: 8 and 17)*

**The question.** Who does what from here on: you, this session, or Harbour? In round 1 the worst problems came from this session acting outside its role, while Harbour's own steps behaved, yet some hand work (the blind reads, draining the notes) still matters. What should each of us own now, and where is it heading?

**What we know.**
- The spiral, the size setting, the click-traps, the copy-inviting wording, my generous scoring and the hand-steering all came from this session. John: "the spiral came from this session (the only non-regimented session in the loop…). That's Harbour's whole value."
- The hand still does real work:
  - the blind reads;
  - where a tidy goes and when to stop;
  - ratchets on partial moves;
  - pricing "not this task's";
  - the parrot;
  - choosing Opus;
  - draining the notes.
- Your forcefield: the hand moves from holding the shape to shaping it.
- Your three calls: the size of the move, rulings, granting authority.

**Options.**
- (a) This session keeps operating, with tighter rules.
- (b) This session records only; you file and approve, and Harbour runs.
- (c) No operator: you and Harbour alone, with this session's research done by Harbour tickets.

**Recommendation:** (b) for the next round, aiming at (c).
- Each remaining hand job either becomes a product feature (through the phases below) or retires as research scaffolding.
- My own rules: say what and why only; never hand-steer a running session; put your words on a ticket and let the loop run; parrot every brief and look specifically for "how"; never suggest a ruling option that asserts you did something.

**Decision (9 Nov, John: "Yes, spot on"):**
- **You:** set where we're heading. Write or approve every ask, word for word. Make the calls that are really yours: the size of a move, the rulings that reach you, what to retire, what to hand over. Accept the roadmap.
- **This session:** an agent, not a script. I think freely and act lightly.
  - Usually that means filing your words, starting runs, reading the results and recording them.
  - I still use judgement: I notice what's off, explain it, recommend, and step in where it plainly helps.
  - Doing less is what makes me reliable, so I lean that way.
  - When I step in beyond the usual, I say so and note why. Anything that keeps coming up is something for Harbour to carry.
  - Asks that start as my idea are read back and approved by you before they're filed.
- **Harbour:** everything from kickoff to merge. It takes on more as the hops land.
- **Rulings, for now:** a little handholding. I suggest answers, and it becomes a light touch as Harbour settles more engineering calls itself.
- **Where it ends up:** this session's part thins out as the work moves into Harbour. It isn't cut to a fixed list. The gate in D1 still counts how often running a week needs more than the usual, but that's a reading of Harbour, not a rule for me.

**Notes:**
- **Close to option (b), but with judgement kept.** My first draft made the gate's four actions (file words, start runs, read results, record) into the whole of this session's role. John: "the point of having this session be an agent not a script is to be flexible and be able to reason. The draft is right, but would be too rigid as written… Simply doing less makes you far more reliable anyway, and this is all slowly moving into Harbour."
- **On rulings:** "a little bit of handholding is fine for now, but it'll slowly become a light touch."
- **Recaps from here on** give the question as well as the drafted answer (John's ask on 9 Nov).
- **The hand jobs listed above now each have a place to go:**
  - blind reads: the "no new mess" hop (D8);
  - draining notes: the drain hop (D12);
  - choosing Opus: D9;
  - the parrot: retired when only your words, or words you approved, are filed;
  - where a tidy goes and pricing "not this task's": the size record and the leftover rule (D3, D4, D6).

**Leads to:** D8 (the blind read moves into the product), D10 (how the next round runs), and the "your seat" measure (steps beyond the usual, noted with why).

---

## Part 2: the rules of the loop

### D3. Leftovers outside a change's area: a ticket or a note? ◐
*(earlier list: 1)*

**What we know.**
- Harbour's `LEFTOVER_RULE`:
  - in the area and fix-sized: fixed on the PR;
  - in the area but larger: a Waiting entry;
  - outside the area: a follow-up only close-out files.
- So LIN-4388, 4389, 4390 and 4392 followed the product's own rule. Closing tickets filed LIN-4355 and 4356 on 7 Nov.
- My round-1 counterweight ("notes, not tickets") contradicted the rule.
- The area-notes guard already supports a Waiting entry in another area's note.

**Options.**
- (a) Keep: outside-area leftovers become tickets.
- (b) They become a Waiting entry in that area's note, and only something that blocks or breaks becomes a ticket.
- (c) Ticket, but held below real work and capped.

**Recommendation:** (b). It converges, keeps one home per item, and puts outside-area finds where the next change in that area reads them. Defects that break something still get a ticket.

**Decision:** —

**Notes:** —

**Leads to:** a product ticket in your words if (b) or (c); triage of the four tickets in D11.

### D4. One tidy per area, and LIN-4346's mixed end ○
*(earlier list: 9)*

**What we know.**
- Finishing a move turned the area better in every other case (five of five on 5 Nov; four areas in round 1).
- LIN-4346's one tidy was spent removing the setting, not on the edges its reads named:
  - `lookFirstWait` threaded by hand through six or seven seams;
  - "how" patterns written twice;
  - `isLiveRun` beside `liveOnAnchor`;
  - scoping's stale description;
  - about 120 lines of prose parsing;
  - docs naming the wrong function.
- The "one tidy" limit was an operator counterweight against the spiral, not a product rule.

**Options.**
- (a) Accept the mixed end, and leave the residues as Waiting entries.
- (b) One edges tidy-after for LIN-4346, under the stop rule.
- (c) Replace "one tidy per area" with a size decided up front: the move includes its own edges tidy.

**Recommendation:** (b) now, and (c) as the rule. The tidy-after is the measured way to finish a move. The limit should come from the size of the move chosen at the start, not from a count afterwards.

**Decision:** —

**Notes:** —

**Leads to:** possibly one ticket; the rule in D6 and D8.

### D5. Rulings: what reaches you ○
*(earlier list: 10)*

**What we know.** Round 1 sent you:
- engineering calls as rulings (LIN-4358's decisive row; LIN-4370's live-scoping wait);
- three deploy rulings for one GitHub incident;
- one ruling twice, on two loops (child and autopilot);
- recommended options that needed a hand action they didn't state.

The north star counts false escalations as a headline cost.

**Options:** improve the wording in prompts, or build it into the structure:
- a ruling must say which of your calls it is;
- an option that needs your action can't be approved in one click;
- one answer settles a blocker that several loops share;
- a ruling isn't raised twice for one decision.

**Recommendation:** structure, in your words, as one ticket. Wording alone hasn't held anywhere in this work.

**Decision:** —

**Notes:** —

**Leads to:** one product ticket.

### D6. Your size choice per task, and settings in general ○
*(earlier list: 7)*

**What we know.**
- 4 Nov: "a task is chosen, surveyed, and the user decides how much to tidy up."
- 8 Nov: the setting made "zero sense"; "a default option for hands off operation is fine"; "we'll give users a per task breakdown of options to choose from."
- The size record and the err-larger default now live in code.
- The Survey already writes a priced menu: just the task, a small tidy, consolidate, rebuild the area.

**Options:**
- (a) the default only, no surface;
- (b) the Survey's priced menu shown on each task as a choice, with the default applied when you don't choose;
- (c) both, plus a rule for settings generally: a global setting must be one a new user understands without knowing how Harbour works.

**Recommendation:** (c), with the per-task menu as the surface. Settings stay few and plain.

**Decision:** —

**Notes:** —

**Leads to:** a product ticket (it may belong with the UI work, LIN-4342/4343).

### D7. Two Surveys, or one look? ○
*(earlier list: 11)*

**What we know.**
- The pair costs about $1.80 a ticket, roughly 30% of a small ticket.
- The two voices barely overlap and agree where they do. In the A/B, the place view changed what went into a choice, not which option was chosen.
- Look-first now runs the pair on every fresh ticket, including a Periodical's own review ticket.

**Options:**
- (a) keep both everywhere;
- (b) one look for small moves and both for larger ones;
- (c) skip the look on Periodical reviews and other advisory tickets.

**Recommendation:** (b) and (c), tried as one change on the session graph (D8, step 2) and measured.

**Decision:** —

**Notes:** —

**Leads to:** D8.

---

## Part 3: the session graph

### D8. The order of changes to the graph ○
*(earlier list: 13; ticket LIN-4395 filed)*

**What we know.**
- The graph's nodes are contexts and its edges are hand-offs through the record.
- In LIN-4393 the build was $6.95 of $14.94, and sessions read back ~200 tokens per token written.
- The session papers:
  - orientation is 6–26% of tokens;
  - 77% of supervision is bookkeeping;
  - no sampled decision after a wake rested on memory alone;
  - the fixed legs cost $5–7 a ticket.
- LIN-4395 asks Harbour to show every task's graph. That turns each future version from a design into a measurement.

**The proposed order: one change per real task, kept if the blind read and the cost agree.**
1. A blind read before merge, with its findings fixed by the builder while it's warm. This un-parks the "tidy-after inside the run" you parked on 5 Nov as a cost question; it's the "no new mess" dial.
2. One look instead of two for small moves (D7).
3. Quiet wakes go to code.
4. A cheaper builder where its bar is met.
5. One warm builder with fresh judges (spine and branches).
6. A drain that works off the notes in idle time (D12).

**Recommendation:** adopt the order. Start step 1 with the next real task (D10). LIN-4395 runs early so the graphs are visible.

**Decision:** —

**Notes:** —

**Leads to:** step 1 as a ticket in your words; LIN-4395's place in the order.

### D9. Models ○
*(earlier list: 4, 5 and 12, part)*

**What we know.**
- Routing defaults:
  - Haiku builds;
  - Sonnet plans, closes out, runs autopilot and triage;
  - Opus reviews and researches;
  - Opus is given per ticket through the kickoff "where we're unsure".
- LIN-4348 (choose the model by the kind of work) is parked.
- Essay v4 showed the model and a plain brief matter a great deal for writing.
- For Harbour's own calls, LIN-4358 recommends Luna for the free tier and 14 of 16 calls, once it proves it comes back whole. Proving that needs about 16 live calls and a key no worker has.
- The same key would let Costs (LIN-4341) reconcile against OpenRouter's own figures.

**Options:**
- Opus via your kickoff for the next round, or LIN-4348 first.
- A capped worker OpenRouter key: yes or no, and at what cap.

**Recommendation:**
- Opus via your kickoff for the real tasks (your call, per task), with LIN-4348 kept for phase 4.
- A capped key, yes, small and scoped. It unblocks Luna's evidence and the Costs reconciliation.

**Decision:** —

**Notes:** —

**Leads to:** the kickoffs in D10; one key, set up by you.

---

## Part 4: the next round

### D10. The real tasks ○
*(earlier list: 4)*

**What we know.**
- **LIN-4341, Costs:** about ten places show cost. It's the north star's headline number, and it stands on ground the loop already tidied.
- **LIN-4342, the side rail:** Theseus the navigation.
- **LIN-4343, the polish sweep:** 23 items, "nothing repeats itself".
- All three are consolidation-shaped. Broad UI asks are where spirals began before (UI round 3: five groups became 17 tickets).

**Recommendation.**
- **Order:** Costs, then the rail, then the sweep, one at a time. The sweep depends on the rail's frame.
- **Size:** each is sized as a consolidation that deletes what it replaces. That's your size call when its Survey comes back.
- **This session:** records only.
- **Measured per task:**
  - tickets opened against closed;
  - rulings, and how many were "why was I asked?";
  - cost;
  - the session graph;
  - a blind area read at the end;
  - a Periodical over the window.

**Decision:** —

**Notes:** —

**Leads to:** phase 1 and phase 2.

### D11. Triage of the open tickets ○
*(earlier list: 3; the list is in Appendix A)*

**My first pass, for you to change.**
- **Run first:** LIN-4390 (Periodical prompts grant merge permission that the dispatch gate withholds: an authority defect) and LIN-4392 (a second stage can start beside a live one).
- **Run when their area is next touched, or fold into one batch:** LIN-4325–4328 (paging), LIN-4302, LIN-4320, LIN-4389 (stale prose and lists), LIN-4301 (stale status claims), LIN-4388.
- **To the area notes as Waiting:** LIN-4297, LIN-4303, LIN-4256, LIN-4318, LIN-4356, LIN-4355.
- **Rulings that need you:** LIN-4210 (what "no halt" means on a cold cache).
- **Probably close:** LIN-4214, if LIN-4203's fix overtook it (check first).
- **Keep:** LIN-4275 (paper v2, from 12 Nov) as you decide in D21; LIN-4348 (D9) and LIN-4350 (D14), placed in phases.

**Decision:** —

**Notes:** —

**Leads to:** the backlog emptied into phases, notes or closed.

---

## Part 5: bending the curve

**How it bends.** Flat means deleting as much as we add: today ~2,390 lines a day added against ~830 deleted. Since September, almost every shrinking change came from a ticket whose job was removal. Deletion has to become routine, and additions have to stop leaving copies. The five moves:

1. no new mess (D8);
2. the real tasks sized as consolidations (D10);
3. easy removal decisions (D13);
4. routine deletion (D12, D14);
5. a weekly measure (D16).

### D12. The drain ○
*(earlier list: 2)*

**What we know.**
- 66 Waiting entries, and nothing schedules them.
- Autopilot's order has no rank that takes one.
- The paper's first "Next", and your hypothesis, is larger standalone tidies on the worst areas, measured against areas left alone. It never ran.

**Options:**
- (a) an idle-time slot that takes one Waiting entry at a time;
- (b) larger standalone tidies on the worst areas, each your size call;
- (c) both.

**Recommendation:** (c). (b) is the experiment that decides whether the whole codebase can settle. (a) keeps the notes from becoming a second backlog.

**Decision:** —

**Notes:** —

**Leads to:** phase 3.

### D13. Surface census and removals ○
*(curve move 3)*

**What we know.**
- Retiring a whole surface is the only move that deletes thousands of lines at once.
- The side rail forces the question for every surface: does it earn a place? Its own brief says "a place that can't do anything yet for this person stays out until it can".
- Harbour has many surfaces:
  - views in three tiers;
  - several providers and harnesses;
  - sixteen Periodicals;
  - experiments (Collective, Passages and others).
- `/kpis` and the run records can show use.

**Recommendation:** during the rail, a census of every surface with its use. Each one earns its place, goes behind a flag, or is retired, with one ruling from you each. This is where the curve bends fastest, and it's your call because it's product.

**Decision:** —

**Notes:** —

**Leads to:** rulings during LIN-4342; removal tickets in phase 3.

### D14. Finish transitions, retire scaffolding ○
*(curve move 4; earlier list: 12, part)*

**What we know.**
- The north star: "Finish transitions before starting capabilities".
- Our method adds code: guards, censuses, characterisation goldens and ratchets. Research scaffolding remains too: two Survey voices, after-questions, replay folders, `experiments/`.
- The test estate grows fastest (CI 8.55 min). `test-estate.md` asks which tests earn their keep.
- `lib/dispatch-store.js` grew 14% in four days.
- LIN-4350 (fold rules together) is parked, and prompt-contract churn doubled during round 1.

**Recommendation.**
- **Standing rules:**
  - every migration ends with its scaffolding deleted;
  - a guard whose count reaches zero retires itself;
  - a golden goes once its refactor has landed;
  - research scaffolding retires when the product has its own version.
- **In phase 3:** un-park LIN-4350; a test-estate pass; a Theseus move on `dispatch-store.js`.

**Decision:** —

**Notes:** —

**Leads to:** phase 3 tickets; rules that live in code or tests rather than prose.

### D15. Evidence in git ○
*(earlier list: 6)*

**What we know.**
- 55% of repository bytes are evidence, and the two evidence trees took 93% of the window's byte growth.
- Two Periodicals on 8 Nov committed ~87k and ~118k lines of raw evidence.
- It doesn't feed the code, but it costs clone size and reading.

**Options:**
- (a) keep it all;
- (b) keep reports, and prune raw evidence after a window;
- (c) move raw evidence out of the repository, keeping a pointer and a checksum.

**Recommendation:** (c) for new evidence, (b) for old.

**Decision:** —

**Notes:** —

**Leads to:** one ticket in your words.

### D16. Measure it weekly ○
*(curve move 5; folds into D1)*

**Recommendation:**
- The Stability Review runs weekly with the curve as its headline: net lines, deletions per addition, CI time, Waiting entries, tickets per landing.
- Drift and Seams read coherence at each phase gate.
- Round 1 has none yet, so one reading over its window opens phase 0.

**Decision:** —

**Notes:** —

**Leads to:** the Periodicals' cadence; phase 0's coherence reading.

---

## Part 6: the roadmap

### D17. Shape, and who writes it ○

**Proposal.**
- **Anchor:** the north star stays. The trig point is the goal, with D1's four measures.
- **Everything has one home:** the open tickets, the 66 notes, the papers' "Next" lists and these decisions each go to a phase, a note, or closed.
- **Four streams, as Linear projects, so Harbour's own Roadmap view draws them:**
  - **The loop:** no new mess, then the drain, then the warm builder.
  - **Product:** Costs, the side rail, the sweep.
  - **Subtraction:** Harbour's own codebase.
  - **Evidence:** the weekly measures, a test on a codebase that isn't Harbour, and the papers.
- **Gates buy evidence, never dates.** At most about five tickets in flight per phase, run one at a time.
- **Harbour writes it:** after the discussion, one ticket in your words asks Harbour to draft the roadmap from this record. You accept it, the same way the north star was made.

**The phases:**

| Phase | What it does | Gate |
|---|---|---|
| 0. Now | This discussion; triage (D11); a coherence reading of round 1; the baseline recorded | Decisions made; backlog triaged |
| 1. See it, and no new mess | LIN-4395; a blind read before merge; Costs through that loop | Ordinary tickets read neutral or better |
| 2. Stop the growth | The rail and the sweep sized as consolidations; each capability names what it retires; the surface census | Net growth near zero for two weeks |
| 3. Bend | The drain; larger standalone tidies; finishing transitions; the test estate; LIN-4350; evidence out of git | More deleted than added, sustained |
| 4. Warmer and cheaper | Warm builder with fresh judges, cheaper models, code conducting, LIN-4348; then a codebase that isn't Harbour | Cost per task falling while area reads stay good |

**Recommendation:** adopt the shape. File the drafting ticket once Parts 1–5 are decided.

**Decision:** —

**Notes:** —

**Leads to:** the roadmap ticket; Linear projects.

---

## Part 7: retro and housekeeping

### D18. Retro counts ○
*(earlier list: 14)* Tickets opened against closed in round 1, tagged by cause (tidy, incident, expansion); check retries (LIN-4369, arms 1–4); rulings that were engineering calls; times a suggested answer claimed you'd done something; blind reads against cost per area.

**Recommendation:** count once, from the log and `/cost`, and record the counts here.

**Decision:** —  **Notes:** —

### D19. Alarms between sessions ○
*(earlier list: 15)*

**What we know.**
- Round 1's hour-long wait (an orchestrator didn't notice its worker had ended).
- The rate-limit storm (a 429 reported as a 502).
- The September papers: 92 of 107 incidents were invisible to any single session, and six simple rules caught 9 of 19 hours earlier.

**Recommendation:** fold into D8, step 3 (code holds the sequence), with the two round-1 cases as the first alarms.

**Decision:** —  **Notes:** —

### D20. Ticket history in code comments ○
*(earlier list: 16)*

**What we know.** Named in every blind read since 5 Nov. Comprehension-Debt sharpened it: the debt is status claims that go stale, and line-number pointers.

**Recommendation:** a check in code, not a prompt rule. It fits D14.

**Decision:** —  **Notes:** —

### D21. Small items ○
*(earlier list: 18)*
- **The benchmark column in model pickers:** with LIN-4342/4343.
- **Paper v2 (LIN-4275):** a scheduled task in this session fires on 12 Nov at 09:41 UTC and needs a fresh proxy token. Keep or cancel?
- **This branch's log is ahead of main by all of round 1.** Sync once at the end of the discussion, or leave the research record on the branch and cite it at a pin?

**Decision:** —  **Notes:** —

---

## Decisions made

| Item | Date | Decision | Follow-up |
|---|---|---|---|
| (LIN-4395) | 8 Nov | File: a task shows the sessions that ran it, on one clock | Filed, Backlog; placed in D8 |
| D1 | 8 Nov | Goal: toward settled, a balance. Five measures (no new mess, the curve, speed, your seat, cost), read weekly. First stretch: "open the door" for a small Jira team on their own runner. Gate: two in flight until running it needs nothing complex. $3,500 a week. Targets set at gates. | D17's phases start with the gate; Jira gaps to D10 |
| D2 | 9 Nov | You: destination, asks word for word, the calls that are yours. This session: an agent, not a script; thinks freely, acts lightly, says so when it steps in. Harbour: kickoff to merge, taking on more as hops land. Rulings: light handholding for now. The role thins as work moves into Harbour. | Feeds D8, D10 and the "your seat" measure |

## Appendix A: open tickets from this work (8 Nov)

| Ticket | State | Title |
|---|---|---|
| LIN-4210 | Backlog | Halt poll on a cold cache: decide what 'no halt' means when the store read fails (needs John's ruling, LIN-3024) |
| LIN-4214 | Backlog | Simple-dispatcher: SD_WORKER_USAGE_RELAY=0 does not stop request-record posts from the fail, cancel, stall and reap seams |
| LIN-4256 | Backlog | Go's displayed state should follow /state; state.go kept only for the press (and share one "run ended" rule with cadenceStatus) |
| LIN-4275 | Backlog | Paper v2: size against cost, as a chart (is it a straight line?) — not before 12 Nov |
| LIN-4297 | Backlog | loadWorld is the cheap path for a new client witness (markup option, one common.js route, one click helper, derived consumer list) |
| LIN-4301 | Backlog | Retire the stale status claims and orphan pointers born in the 10-23 → 11-05 window, and restore the dropped Claude-family cross-repo note (LIN-4300 R1/R4) |
| LIN-4302 | Backlog | Override kind list: VERB OVERRIDE lists 15 of the 19 template keys the route accepts |
| LIN-4303 | Backlog | Remove the remaining DOM method-presence guards in public/ (12 hits in 8 files, plus contains/querySelectorAll spellings) |
| LIN-4318 | Backlog | The app mints Periodicals by id; no grant decision reads prompt text |
| LIN-4320 | Backlog | CLAUDE.md:107 lists the enqueue routes without POST /periodicals/{id}/mint |
| LIN-4325 | Backlog | Page the prompt-context nested issue reads (LIN-4322 follow-up) |
| LIN-4326 | Backlog | Page detail-surface comments and cycle issues (LIN-4322 follow-up) |
| LIN-4327 | Backlog | Page dashboard tree relations (LIN-4322 follow-up) |
| LIN-4328 | Backlog | Page workspace-level Linear lists (LIN-4322 follow-up) |
| LIN-4348 | Backlog | Choose the contractor by the kind of work |
| LIN-4350 | Backlog | Fold rules together: plainer, more general instructions |
| LIN-4355 | Backlog | Accept `_…_` as the As asked end line so Jira can hold the block |
| LIN-4356 | Backlog | live-console E2E: .lc-pulse mobile width pin (319) fails on macOS overlay scrollbars |
| LIN-4388 | Backlog | Stage selector rule 1 dates an ended run by its end time, so a person's comment posted mid-run reads as already acted on |
| LIN-4389 | Todo | Advisory Periodicals still describe minting that no longer happens (Stability lead-in; adversarialRead/gapAudit default clauses) |
| LIN-4390 | Todo | Periodical prompts grant the run merge authority over its docs-only notes/report PR, contradicting the dispatch review/close-out gate |
| LIN-4392 | Backlog | recommend-and-dispatch can start a second, different stage beside a live one (the duplicate guard is keyed by kind) |

Also open:
- **Records:** LIN-4344 (round 1), LIN-3936 (Costs).
- **New:** LIN-4395 (the session graph).
- **The real tasks:** LIN-4341, LIN-4342, LIN-4343.
