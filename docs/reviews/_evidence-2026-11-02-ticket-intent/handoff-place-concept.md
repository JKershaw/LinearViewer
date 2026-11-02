# Handoff: the place, and the shape John holds by hand (2 November 2026)

You're picking up a conversation with John Kershaw, who runs Harbour. Your job is to **think the concept through with him**, not to build it. An earlier session (the one that wrote this) keeps following the work in progress: essay v4 and the live Costs and UI streams. You don't need to babysit those. Read them when they're useful.

## The idea in one paragraph

Coding agents make good contractors. Given a work order, they do the job, usually well, and leave. But a codebase is a place, and nobody lives in it:
- The agent that notices a loose stair is held to its ticket, so it notes the stair and walks on.
- What it learned is filed under the job, not the place, so the next agent finds the stair again.
- Kent Beck's first half, "make the change easy", belongs to no stage.

Every task is looked after. Nobody's job is the place. Agents look after the place well and cheaply *when someone points them at it*, and between those bursts it decays again. What's missing is standing and continuity, not capability.

## Where the conversation has got to: John's metaphor

John's latest framing, which resonated strongly:

- **His focus is like a magic forcefield in a film.** Someone holds out a hand and keeps their attention fixed, and the shape holds. The Costs and UI streams are John "manually forcing a shape of work". That's what started this whole line of thought.
- **There are layers of shape:**
  - Harbour's default behaviour (the task pipeline) is one shape.
  - A passage is a more complex shape, made mostly of the first kind.
  - John is holding a shape more complex again.
- **Harbour in operation is the projector.** The shape it projects is the change being applied to a system or codebase. Like a film, it's best appreciated in motion rather than as stills, and zoomed out so you don't see the pixels.
- **The goal:** explore that shape from the outside, and work out how to make it something Harbour naturally makes.

Readings the earlier session offered, which John agreed with or built on:

- **The evidence fits the metaphor.** Every time the hand moved, the shape dissolved:
  - For sixteen days, 11 to 26 October, one operator session did the resident's work across four episodes: the coherence loop (LIN-3449), Theseus rounds 1 to 3, the improvement cycles (LIN-3613), and the charter's Theseus loop on the interface (LIN-3490). It survived two compactions. It ended when the frame moved: John turned the charter to the interface. Essay v4 found this. It corrects an earlier reading that the resident ended when its session did.
  - After the loop was parked on 23 October, the count of decisions held in more than one place went from 43 to 54 in the edition after.
  - Costs paused on 25 October, when the effort moved to the interface, and had to restart from a fresh map.

  The shape was never missing. What was missing was something to hold it. v4 puts it this way: continuity of *method* was largely solved, through the code-shape kit, the census and a runbook. Continuity of *standing* was not. No Drift & Coherence report has landed since 23 October, even though it is weekly, because that cadence is a fallback floor, not a trigger.
- **Frames versus continuity.**
  - Harbour projects frames well: each task is a sharp, correct frame.
  - Passages string frames into a scene.
  - John's hand supplies the continuity between frames: the next frame follows from the last. In Costs this is visible, because the "Note after tidy N" becomes ticket N+1.
- **Structure versus attention.** The hand seems to do two jobs:
  - *Structure* could plausibly be built: one move at a time, a notebook kept with the place, each ticket written from the last note, and the question "what did the ticket get wrong?"
  - *Attention* is the part that seems to need a resident: deciding what's next, noticing when the screen feels wrong, and judging whether the place actually got better.

  How much of the field is each is an open question.
- **Stills versus motion explains the investigation's early failures.** Almost everything measured early was a still at full zoom: per-ticket coverage labels, per-ask counts. It found 95% of the pixels correct and missed the picture. The things that showed the shape were all in motion:
  - the coherence ledger's 43 → 54;
  - steady-base's growth curves;
  - the Costs notes read in order;
  - the essay's own versions.
- **The resident may first need a way to watch the film.** Harbour's surfaces show tasks, which are frames. Nothing shows the place changing over time, zoomed out. John pictures the place as fractal: a system diagram at the top (initially just Harbour and Simple Dispatcher), a single function at the bottom, and the tangles in between. The way through is "bubbles popping and forming larger bubbles".

## Open questions worth exploring (not a plan)

- How much of the shape is structure Harbour can hold, and how much is attention that needs a resident?
- Where does the place's memory live? John said he'd reopen his founding decision that **the ticket is the source of truth**. It conflates three things: the record of the job, the documentation and plans, and the place's memory. Costs uses a ticket as a notebook ("Don't dispatch or plan this ticket"), which is a halfway house.
- Inside the flow or around it?
  - Theseus deliberately "adds no stage to that pipeline". It's a campaign that wraps tickets from the outside.
  - John's hunch is a **step inside the pipeline**: after research and before plan, or just before the first change, since many tickets skip research. It would answer to the estate and to the human's intent, draw on the periodicals or its own judgement, raise rulings (likely scoping questions), and make tidying what the task touches part of the job.
- What would let Harbour, and John, watch the place in motion?
- Is the Costs "bar for a ticket" a pattern that generalises, or is it local by nature? It's a list, but it's local to one area, revised from evidence each round, and most of its lines grant freedom or remove things. Perhaps the distinction that matters isn't rule versus no rule. It may be a living bar kept with the place versus a frozen rule added to every prompt.
- What does "textbook style" mean as a fuzzy ideal the resident steers toward?

## The record behind it, briefly

**The investigation.** It started from LIN-4085, an A/B test: one feature built by a single session and by Harbour's stages. The first hypothesis was that intent leaks as a ticket moves through stages, and it didn't hold up:
- 94% of requests survive verbatim.
- A coverage check of 254 tickets found 94.7% of asks delivered.
- About 1 ticket in 9 was reduced on scope without a human decision.
- There was no detectable difference between open and concrete tickets.

Reframes followed:
- Tickets can be a monkey's paw: a paragraph settled too early into a spec.
- Judge by looking, not by measuring.
- John's **three-body problem**: how tasks are written, how they're interpreted (probably fine), and how complex the code is. On clean code tickets land; on tangled code they spiral.
- Then the place.

The full working, with sources, is in `investigation-notes.md`, in this folder.

**The code's side, already on the Library shelf:**
- **`steady-base`:** the code only grows, fastest at the gates, and fixes land as prose.
- **`coherence-as-it-grows`:** scattered decisions sit behind 45% of escaped defects (27% of those found by use). "Deletion finishes"; review-and-file does not.
- **`consolidate-then-rebuild`:** on 17 October, eight untangling tickets all merged and worked, for two of John's ruling presses.
- **Since 1 September:** 965 commits, +78,900 lines, about 100 that shrink code, nearly all from tickets whose job was removal.
- **Friction left alone:** the field "improvement noticed, not required" appears 158 times.

**What Harbour has tried before.** John: "I knew I'd already tried this... dozens of times."

- **Periodicals.** Sixteen of them (`lib/periodicals.js`). They're inspectors that sit outside the timeline of tasks: they report, mint a few tickets into the same queue, and leave. Their remits are split so none double-flags, so none holds the whole place.
- **Passages' maintenance leg.** It reserved budget to run the inspectors. John says it missed the point.
- **The Surface Assessment** at the end of research (`lib/prompt-template-defs.js:512`):
  - LIN-192 (June) asked "would a refactor make this land better?", which was a place-loyal question.
  - On LIN-391 it invented a seam nothing called.
  - LIN-397 tied every refactor to a need in *this* ticket. Push became pull.

  Lesson: the June misfire *added* structure, while the October successes *removed* it.
- **The Theseus method** (`docs/theseus-method-long.md`, plus `theseus*.md` and `rebuild-*.md` in the Library):
  - It has five moves: Find, Own, Free the seam, Consolidate, Rebuild. A replay judge checks behaviour.
  - Each move is predicted, then scored.
  - It distinguishes two kinds of mess: tangled-inside, which rebuild fixes, and scattered-between, which only consolidation fixes. Seven rebuilds in a row left every scattered decision as scattered as before.
  - An operator session acted as the resident. It ended when the frame moved, not when the session did (see above).
  - Its rule against adopt-later helpers: "Delete in the same change. A helper that callers may adopt later is one more copy."
  - Its annotated reading list already covers much of the outside literature: Lehman, Brand, Parnas, Fowler, Feathers, clone studies.
- **The coherence loop (LIN-3449).** A session pointed agents at the Drift & Coherence backlog, and it was cleared the same day. Then it was parked and the place decayed again.

**Failure modes the record already holds** (essay v3's "What could still make it fail"):
- "Adopt-on-next-touch, no sweep" was tried and adoption stayed flat: a fresh file imported the shared helpers *and* wrote eight raw copies beside them.
- A new step is a new gate, and gates are where prose collects.
- A step loyal to the place will find something on every task unless it answers to a need.

**John's cheap test, for later.** Hand-run a custom stage over past tickets:
- Use the coherence census as the answer key: `knownDecisions` and `twins` in `docs/papers/harbour/coherence-as-it-grows-census.json`, and `perPr` in `-exposure.json`.
- Classify what the stage proposes as a real fix, partial coverage, or another rule or patch.
- Include tickets in clean areas, to see whether it stays quiet.

Essay v4's Next gives a concrete version: about ten past tickets that touched a known scattered decision and five that didn't, from June to 8 October. Each is run at its base commit, blind to what came after. The step counts as finding the prize only if it names a decision that later caused an escaped defect. "Make it work, then make it good." A natural later test of the metaphor is to *lower the hand*: let Costs run a tidy or two from its own notes, with John only answering rulings, and see what holds.

## The live streams (John's hand-held shapes)

- **Costs, LIN-3936.** The record ticket is the area's notebook:
  - **The goal:** "the only behaviour to preserve is the outcome: tokens and costs are tracked."
  - **The rhythm:** one tidy at a time toward a Theseus rebuild. So far: LIN-4129, LIN-4130, LIN-4134, LIN-4136/LIN-4137, and LIN-4147 in flight.
  - **After each tidy, two questions:** did the area get cleaner, and *what did the ticket get wrong?* The next ticket is written from that note.
  - **"The bar for a Costs ticket"** is kept on the record ticket and revised from evidence.
- **UI round 3, LIN-4040** (slices under LIN-4105: LIN-4113, LIN-4114, LIN-4139, LIN-4140). John looks at the live product and says what he sees; the operator turns that into slices. It came after code rounds gave task state one owner.

  This work belongs to its own session. Read it, don't steer it.

## The essay

`docs/papers/harbour/tasks-are-tasks.md`, live at harbour.cat/library/tasks-are-tasks. It's the anchor for the developing idea: each version adds a layer, without over-polishing.

| Version | Ticket | What it was |
|---|---|---|
| v1 | LIN-4131 | Read as a report |
| v2 | LIN-4135 | The argument, with a fresh-reader check built in |
| v3 | LIN-4138 | Folded in the shelf and the earlier attempts |
| v4 | LIN-4146 | Merged as `7770ab37`. Adds Theseus and one role across four episodes: method outlives the session, standing doesn't. Weighs inside versus outside the flow, with a middle shape. Fills out "what is different this time", and specifies John's test in Next. |

LIN-4133 holds corrections owed to the earlier essay, `one-feature-twice`.

## How to work with John (learned the hard way in this session)

- **Lead with judgement.** Answer conversationally, keep it short, and give a recommendation rather than a survey. He likes probing, casual exploration and metaphor.
- **Don't reach for rules.** The essay ends "Rules are more work orders." If you catch yourself proposing a checklist, stop.
- **Don't swap measurement in for judgement.** Agents can just *look*. Don't build rating schemes, and never hand John rating or review work an agent could do.
- **Don't over-specify.** Write tickets at the level of the idea, not as specs. The monkey's paw is the failure mode being studied, so don't commit it.
- **Use Harbour's normal process.** Research and essays go through Harbour tickets and autopilot (`POST /autopilot/kickoff`), not in-session agents. Ask the work to save its findings somewhere durable: LIN-4128 finished to spec and saved only to its ticket.
- **Keep a "parrot".** John asked for one: a subagent that acts as a voice on your shoulder, steering you away from the tendencies above. It replies in at most three sentences. Consult it before substantive moves. It caught real slips here.
- **File no tickets or rules unless John asks.**
- **Keep to the access limits:**
  - Respect the proxy's 60 requests a minute.
  - Never print tokens.
  - Don't read Flight Companion transcripts: consent was asked and never given.
  - Public Library pages carry no configuration details, tokens or session links, and name no private individuals beyond John.
