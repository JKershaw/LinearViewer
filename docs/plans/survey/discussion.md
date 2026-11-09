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

### D3. Leftovers outside a change's area: a ticket or a note? ✓
*(earlier list: 1)*

**The question.** When a change spots something that needs doing outside its own area, where does it go: a new ticket, or a note in that area?

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

**Decision (9 Nov, John: "I agree with b"):**
- Outside-area finds go into that area's own note as a Waiting entry, not a ticket. They become a ticket only if they break something, block work, or touch safety. One home still holds: never both.
- Notes move when a change in that area is sized to take one on, through the drain (D12) in spare time, and through larger sweeps and specific tidy-ups run outside tasks. The Waiting count is read weekly beside the curve, so a growing pile shows.
- This changes Harbour's own leftover rule, so it goes in as an ask in John's words. The round-1 tickets filed under the old rule get re-homed in the backlog sort (D11).

**Notes:**
- **John's reasons:** "Good to know, not necessarily for now. Reduces a spiral out, especially on large codebases. Larger sweeps and specific tidy ups outside of tasks can still happen, making b fine." The sweeps and tidy-ups clause is his addition to the drafted answer.
- **Checked on main, 9 Nov:**
  - `LEFTOVER_RULE` (`lib/prompts/leftover-words.js`) still files outside-area finds as follow-ups at close-out.
  - `docs/areas/README.md` already says "Waiting entries are context, not scope", and its guard requires an entry's first cited path to map to the note's own area, so an outside find lands in the note of the area it belongs to.
- **For the outside team:** Harbour can't create a Jira issue yet, so close-out follow-ups would fail there. Notes live in the repo and work whatever the tracker.
- **Not yet answered:** whether to file the asks as each decision is made or collect them and file together at the end. Until John says, they're collected below in "Asks to file" and nothing is filed.

**Leads to:** a product ticket in your words if (b) or (c); triage of the four tickets in D11.

### D4. One tidy per area, and LIN-4346's mixed end ✓
*(earlier list: 9)*

**The question.** In round 1 one area ended mixed because the operator limited each area to one tidy. Should we go back and finish it, and is "one tidy per area" the right rule going forward?

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

**Decision (9 Nov, John: "Agreed"):** (a) now and (c) as the rule.
- Accept LIN-4346's mixed ending. Its loose edges, named in the blind reads, go into the right area notes as Waiting entries, so the next change there sees them. The "one look" hop in weeks 1–2 passes through the same code and can take them on if its size allows. Otherwise a tidy-up or the drain picks them up later.
- "One tidy per area" is retired. It was the operator's brake, not Harbour's rule. The size chosen at scoping decides how far a move goes, including its own edges, as Harbour already does.
- The edges are written into the notes through Harbour, as part of the backlog sort (D11), not by hand.

**Notes:**
- **John:** "It'd be nice to tidy everything, but for now this is fine and we'll be revisiting the area anyway at some point."
- **The recommendation changed from (b) now to (a) now** after D1 and D3. The "one look" hop works in the same look-first code during the gate weeks, so a separate tidy there would collide with it. And D3 made notes, not tickets, the home for known-but-not-now work.
- **Checked on main, 9 Nov:**
  - None of the edges are in an area note; they're only in the blind reads.
  - `lookFirstWait` still has 16 mentions across 7 files.
  - The size record (`lib/size-of-move.js`) picks from a closed list ("just the task", "a small tidy", "consolidate the decision this task touches", "rebuild the area", "wrong work") with err larger built in. Nothing in Harbour counts tidies.

**Leads to:** D11 (the sort writes the edges into the notes); no ticket of its own.

### D5. Rulings: what reaches you ✓
*(earlier list: 10)*

**The question.** What would make rulings better, given they mostly work today?

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

**Decision (9 Nov, John: "Agreed on D5"):**
- Rulings mostly work, so they stay as they are for now. The asker gives its own recommended choice. This session can add a proposal: an answer or a dismiss, with a reason. Nothing applies by itself, and the proposals are D2's light handholding.
- Duplicates: Harbour already merges the common repeats, and agents are told to check before asking. Nothing more is needed now.
- Rulings are a good candidate for a simpler version later: one dismiss instead of two, and a dismiss that doesn't wake the agent to tell it "this wasn't worth asking". The other finds go with it: proposals show only on the Rulings tab, and agreeing to one isn't recorded. This is "known, not now" (D3). It goes into the rulings area's note through the backlog sort, ready for a later tidy-up.
- The "rulings ask only real questions" hop leaves the gate weeks.

**Notes:**
- **How the answer narrowed.** The structure recommended above was dropped. John: "the rulings aren't actually too bad currently. A 'recommended dismiss' option and preventing duplicates would likely go a long way. Otherwise, it's basically fine and can be polished later."
- **My three wrong readings** of the recommendation layer led John to ask for a sub-agent to map the code. It did, from main at `b315e0e8f`, and I checked its main claims against the code:
  - **Two recommendation layers.** The asker's own `recommended` choice must be one of its options (`lib/session-telemetry.js`). Separately, proposals come through `suggest-answer` and `suggest-dismissal` (`routes/proxy-rulings.js`, LIN-2444 and LIN-2790): they need a read-write token and a reason, there's one per ruling, and a new one overwrites the old (`lib/dismissal-suggestions-store.js`). Proposals show only on Observation › Rulings (`public/observation.js`).
  - **Dismiss differs by surface.** The question card's dismiss sends "not worth asking: proceed on your best judgment" to a waiting run (`public/question-cards.js`, `public/common.js`). The Rulings tab's dismiss posts nothing.
  - **Duplicates.** Grouping is by lineage plus `decision_id`, plus the worker/autopilot join (LIN-3959, `lib/unanswered-decisions.js`). "Check before asking" and "merge shared causes" are prompt text only. The settled guard (LIN-4241) refuses a second answer.
  - Agreement to a proposal isn't recorded (`lib/dismissal-suggestions-store.js`).
- **John on the later tidy:** "A good candidate for a simplified version/tidy up. Eg the two dismiss options should be one, and it shouldn't wake the agent to say 'this wasn't worth asking'. It can be simpler. But, perhaps for later."
- **On LIN-4368:** it came from this session's authority, not from how rulings work: "not something to dwell on too much".

**Leads to:** a Waiting entry in the rulings area's note, written by the backlog sort (D11); no ticket now.

### D6. Your size choice per task, and settings in general ✓
*(earlier list: 7)*

**The question.** Who decides how big a move each task makes, and how do they choose? And what's the rule for settings in general?

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

**Decision (9 Nov, John: "Yes, I like it. I'm sure we'll refine it as we go"):**
- The size of each task is just another ruling: "how much tidying on this task?", with the sizes as options, each with a rough cost from the Survey, and a recommended pick that leans larger. It shows wherever rulings show, so there's no new page and no new system.
- A setting chooses who answers: ask me, or let the driving agent decide with the default (lean larger where it pays). Even on "ask me", it only asks when there's a real choice. A small, clear task stays just the task.
- A rule for all settings: a setting must make sense to a new user who doesn't know how Harbour works.
- One ask in John's words, after the gate. Fuzzy on purpose: what and why, not how.

**Notes:**
- **The shape is John's:** "I imagined a page a little like the rulings page, as that's our q&a feature really. Sometimes a driving agent will rule, sometimes it'll go to a human… We want to avoid building out some big complex system, and this could simply use rulings? Settings provides a nice few options, allowing users to always be asked, or follow some default." The picture he pointed to is the "How much to tidy" dial in *Toward Settled*.
- **Most of the plumbing exists** (main, `lib/size-of-move.js`): a person's size comment is already read by scoping as their ruling ("Decided by: a ruling"), and without one the record says "Decided by: the standing policy".
- **On the removed switch (LIN-4368)**, John: "the setting we removed wasn't wrong per se, just unusable". It was named after an internal concept, showed only the option you'd switch to, demanded a reason, and mixed who decides with which way to lean. The settings rule is what keeps that from recurring.
- **The recommendation moved** from a per-task menu as its own surface (with the UI work) to a size ruling, which needs no new surface.

**Leads to:** one ask (the size question as a ruling, with a plain setting for who answers), after the gate; added to "Asks to file".

### D7. Two Surveys, or one look? ✓
*(earlier list: 11)*

**The question.** Do all tasks need both Surveys before work starts?

**What we know.**
- The pair costs about $1.80 a ticket, roughly 30% of a small ticket.
- The two voices barely overlap and agree where they do. In the A/B, the place view changed what went into a choice, not which option was chosen.
- Look-first now runs the pair on every fresh ticket, including a Periodical's own review ticket.

**Options:**
- (a) keep both everywhere;
- (b) one look for small moves and both for larger ones;
- (c) skip the look on Periodical reviews and other advisory tickets.

**Recommendation:** (b) and (c), tried as one change on the session graph (D8, step 2) and measured.

**Decision (9 Nov, John: "D7 looks good"):** (a) for tasks that change code, plus Periodicals skipping the look.
- Keep both Surveys on every task that changes code. The two voices find different things, and that has been worth it.
- Periodical reviews skip the Surveys, since they don't change code.
- A conditional "one look for small tasks" can wait as a later optimisation, because it adds a branch for a small saving.
- This replaces the "one look for small moves" hop with a smaller change: Periodicals skip the Surveys, filed as one small ask in John's words. It touches the look-first code, so it can still take on LIN-4346's edges if its size allows (D4).

**Notes:**
- **John:** "feels like we're making it more complex by making it conditional (perhaps a later optimisation). And whilst it's tempted to do a single review, we did find benefits from two. Happy to skip for periodicals though."
- **Checked on main** (`lib/recommendation-look-first.js`): the sequence runs on any fresh leaf ticket with an As asked block. It's skipped only when there's a size record, a plan, a linked PR, an open blocker, a run waiting on a person, or a person's holding comment. Nothing excludes Periodical reviews.
- **The skip covers Periodicals only.** My wider "other advisory tickets" was dropped, because it would be another condition.

**Leads to:** one small ask (Periodicals skip the Surveys), added to "Asks to file"; D8.

---

## Part 3: the session graph

### D8. The order of changes to the graph ✓
*(earlier list: 13; ticket LIN-4395 filed)*

**The question.** What order should the loop's changes come in, and how do we know each one helped?

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

**Decision (9 Nov, John: "Yes, and keeps it simple"):**
- **Until the switch** (when Harbour carries the loop and we go to four in flight), two at a time:
  1. See each task's sessions (LIN-4395), so every change after is measured.
  2. No new mess before merge.
  3. Waiting moves into code: quiet "still waiting" wakes become code, and a stalled wait raises an alarm.
- **Alongside, two small ones:** Periodicals skip the Surveys (D7), and the weekly measure becomes a Periodical (D16).
- **The drain waits.** The weekly Waiting count shows whether notes pile up. If they do, D12 decides, and the first idea is a Periodical using what already exists, not a new system.
- **After the switch:** a cheaper builder where it meets the bar, then a warm builder with fresh judges, and faster CI.
- **Every change stays only if the blind read and the cost agree, and every change names what it retires.**

**Notes:**
- **"The gate" is now called "the switch."** John asked what a "gate week" was: "Our milestone to get Harbour carrying more? If so, happy for that to be when we switch." It's D1's gate, the point where running a week needs nothing clever from the agent running it.
- **The drain moved out** on John's worry that it "turns into a proper chunk of work". D3 already gives notes three ways to move, and D4 and D5 made "known, not now" deliberate. Autopilot already takes a landed Periodical "only when nothing can move" (`AUTOPILOT_PRECEDENCE`), which is idle time, so a drain needn't be a new mechanism.
- **Two hops left the stretch before the switch:** "rulings ask only real questions" (D5) and "one look" (D7). Plotting the Course still models them, so the page needs a refresh at a natural point.

**Leads to:** asks in John's words for steps 2 and 3 (LIN-4395 is filed); D12; D16.

### D9. Models ✓
*(earlier list: 4, 5 and 12, part)*

**The question.** Which models run our tasks, and how do we change them over time?

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

**Decision (9 Nov, John: "Perfect"):**
- **Until the switch:** our tasks run on Opus, given through John's kickoff.
- **After the switch:** back to the cheaper defaults we know are reliable. When a newer model in the same family is cheaper and better, we just change the default, and revert if it misbehaves. A cut-off answer now fails loudly, so a bad switch shows itself.
- **No new layer.** "Choose the model by the kind of work" (LIN-4348) isn't needed, and goes to the backlog sort to be closed.
- **No new key.** Harbour's existing key covers its own calls.

**Notes:**
- **John:** "Let's switch back to our cheaper options we know are reliable, after the gate. But, if we find a cheaper better model from the same family, we've yet to have a problem just switching. We can always revert. Happy to just change the defaults rather than adding a new layer."
- **The key was dropped** when John asked what it was for that we don't already have. Harbour already has its own OpenRouter key. The key in question was for a *worker*, to make live test calls before a switch: the "grant-key" option on LIN-4358's ruling `lin4358-decisive-row`, where John chose "build anyway". My Costs-reconciliation reason didn't hold, because only Harbour's own calls go through OpenRouter, and they already use its key. LIN-4358 piece 1 (whole or loud) makes a bad switch visible.

**Leads to:** the kickoffs (D10); LIN-4348 to close in the sort (D11).

---

## Part 4: the next round

### D10. The real tasks ✓
*(earlier list: 4)*

**The question.** What real work runs next, in what order, and how is it sized and measured?

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

**Decision (9 Nov, John: "I like it! We're not redoing it all, but we are cleaning up potentially a significant amount of tech debt"):**
- **Until the switch:** D8's loop changes, each run through the full loop, plus the backlog sort (D11).
- **After the switch, four in flight, each in a different area:**
  1. **Jira works for the loop:** Harbour can create Jira issues and hold the sealed ask, checked on John's Jira, which is already in real use.
  2. **The front end, left better than we found it:** browser code that shares rather than restates, still with no build step and no framework, taken slice by slice and starting small. The side rail and the sprinkling ride on the cleaner frame. This one wants more of John early: the size call, the first slice, reading the result.
  3. and 4. **Theseus moves on the next busiest clusters,** from the sort and the census.
- **Not tasks for now:** the runner (John sets up Simple Dispatcher at the company or uses the in-Claude-Code runner, and anything that breaks gets filed) and Costs (LIN-4341, later: the team is on subscriptions).
- **The rule:** "no build step, no framework" stays, and it's read as allowing the browser to import, as browsers do natively. That reading goes into the project's own notes, so agents stop restating code.
- **Sizing:** the default (err larger) unless John comments a size; the front end gets his call. **Measuring:** D1's five measures weekly, plus each task's session graph and blind read.

**Notes:**
- **John on the first audience** (outside team not named here): "I've logged in with Harbour on Jira and been using it for a few weeks and it's mostly fine except for the gaps that you've identified. I'm happy to set up either Simple Dispatcher internally in the company… and/or we can use the in-Claude-Code runner; both are fine options. We're on subscriptions so cost is less of an issue and Harbour is already significantly more efficient than the way the company's currently using AI. Side rail and other UI improvements are important purely because the current ones are just mostly the original ones and are due a bit of a sprinkling. But! The front end code is messy."
- **John on the cause:** "my gut says the UI issues trace back to one of my very first rules: no build step… it's the biggest target of the Theseus method… We don't need to tidy it all, but it's a perfect example where we can leave it better than we found it. Likely this will take a fair amount of hand holding."
- **Checked on main, 9 Nov:**
  - 44 browser files, about 35,100 lines, plus about 20,500 lines of CSS.
  - No browser file uses import or export, and there's no `type="module"` anywhere. Pages share through 66 globals on `window`.
  - The largest file is `public/observation.js` at 5,019 lines.
  - Nine browser files say they restate server logic. `public/cost-format.js`: "restated here because a browser IIFE has no module graph to lib/".
  - Seven parity tests exist to keep the copies in step, and 96 unit tests read browser files as text.
- **The recommendation moved:**
  - "their own runner" was dropped as a task;
  - Costs moved later;
  - the rail and the sweep came back in, on a consolidated front end, after John said the UI matters;
  - "a real Jira site" became John's own Jira.

**Leads to:** asks in John's words for Jira and the front end (after the switch); the reading of the rule into `CLAUDE.md` (with the front-end ask); D11; D13 and D14 for lanes 3 and 4.

### D11. Triage of the open tickets ◐
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

## Asks to file

Collected as decisions are made. Nothing here is filed yet. Each is read back to John word for word before filing.

| From | The ask, in short | State |
|---|---|---|
| D3 | Harbour's leftover rule: outside-area finds go into that area's note as a Waiting entry; a ticket only if they break something, block work or touch safety | Waiting for words |
| D1 → D10 | Jira works for the loop: Harbour can create a Jira issue (no ticket exists yet) and hold the sealed ask; checked on John's Jira. After the switch. The other Jira gaps already have tickets (LIN-4355, LIN-2805, LIN-2094, LIN-2026, LIN-2170, LIN-2008) and go through the sort (D11) | Waiting for words |
| D6 | The size of each task as a ruling, with a plain setting for who answers (ask me, or follow the default); asks only when there's a real choice. After the gate | Waiting for words |
| D7 | Periodical reviews skip the Surveys | Waiting for words |
| D8 | No new mess before merge (a blind read before merge, its findings fixed by the builder) | Waiting for words |
| D8 | Waiting moves into code: quiet "still waiting" wakes become code, and a stalled wait raises an alarm | Waiting for words |
| D10 | The front end left better than we found it: browser code that shares rather than restates, still with no build step and no framework, slice by slice; the side rail and the sprinkling on the cleaner frame. After the switch | Waiting for words |

## Decisions made

| Item | Date | Decision | Follow-up |
|---|---|---|---|
| (LIN-4395) | 8 Nov | File: a task shows the sessions that ran it, on one clock | Filed, Backlog; placed in D8 |
| D1 | 8 Nov | Goal: toward settled, a balance. Five measures (no new mess, the curve, speed, your seat, cost), read weekly. First stretch: "open the door" for a small Jira team on their own runner. Gate: two in flight until running it needs nothing complex. $3,500 a week. Targets set at gates. | D17's phases start with the gate; Jira gaps to D10 |
| D2 | 9 Nov | You: destination, asks word for word, the calls that are yours. This session: an agent, not a script; thinks freely, acts lightly, says so when it steps in. Harbour: kickoff to merge, taking on more as hops land. Rulings: light handholding for now. The role thins as work moves into Harbour. | Feeds D8, D10 and the "your seat" measure |
| D3 | 9 Nov | Outside-area finds become a Waiting entry in that area's note; a ticket only if it breaks, blocks or touches safety. Notes move by sized changes, the drain, and sweeps or tidy-ups outside tasks. | Ask: change the leftover rule; re-home round 1's tickets at D11 |
| D4 | 9 Nov | Accept LIN-4346's mixed end; its edges go into area notes through the backlog sort, for the "one look" hop or a tidy-up to take on. "One tidy per area" retired: the size chosen at scoping decides how far a move goes. | D11 writes the edges into notes |
| D5 | 9 Nov | Rulings mostly work and stay as they are. Duplicates handled enough. A simpler version later (one dismiss that doesn't wake the agent; proposals visible; agreement recorded), noted via the sort. | Note via D11; hop leaves the gate weeks |
| D6 | 9 Nov | The size of each task is a ruling (sizes as options with rough costs; recommended leans larger). A plain setting chooses who answers: ask me, or the driving agent with the default; it only asks when there's a real choice. Settings must make sense to a new user. | Ask after the gate |
| D7 | 9 Nov | Keep both Surveys on tasks that change code; Periodical reviews skip them. A conditional one-look waits as a later optimisation. | Small ask |
| D8 | 9 Nov | Until the switch, two at a time: see each task's sessions (LIN-4395), no new mess before merge, waiting moves into code; alongside, Periodicals skip the Surveys and the weekly measure as a Periodical. The drain waits. After the switch: cheaper builder, warm builder with fresh judges, faster CI. Each change kept only if the blind read and cost agree, and names what it retires. | Asks for steps 2 and 3 |
| D9 | 9 Nov | Opus via kickoff until the switch; then back to the reliable cheaper defaults. Same-family cheaper-and-better: just change the default, revert if needed. No new layer (LIN-4348 to close), no new key. | LIN-4348 closes in the sort |
| D10 | 9 Nov | Until the switch: D8's loop changes and the backlog sort. After: Jira works for the loop; the front end left better than found (shares rather than restates, still no build step or framework, slice by slice); two Theseus lanes. Runner and Costs not tasks for now. "No build step" read as allowing native browser imports. | Asks: Jira, front end |

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
