# Adding a Direction Layer to LinearViewer

*A thinking document. Last updated May 2026.*

> **2026-05-16 revision note.** An earlier draft described the Ship view as
> "unbuilt" and the Roadmap feature as "shelved." Both were stale: the Ship
> view exists as a working prototype (`lib/ship-layout.js`, `lib/render-ship.js`)
> with a deterministic `heading` primitive that routes cards to its FORWARD
> sector, and the Roadmap is a complete feature behind the `roadmap` flag
> (default off), with deterministic + LLM layers already wired. This revision
> updates the framing to reconcile what exists with what the MVP needs to add.

## Summary

LinearViewer is an experimental workbench for orchestrating AI coding agents against a Linear backlog. Through daily use, a structural gap has emerged: the project has many views that show *what* work exists, but none that show *whether the work is pointed anywhere worth going*. This document argues that gap reflects a broader shift — AI-augmented development has moved the bottleneck of software work from execution to direction-setting — and proposes a small experiment as the first step toward closing it: a "north star" document plus an LLM analyzer with read-only Linear access, producing both alignment scoring of current work and feedback on the quality of the north star itself. It's framed as the MVP for what would later become a fuller direction layer, eventually visualized by the unbuilt Ship view.

## Context: LinearViewer today

Despite the name, LinearViewer isn't really a viewer. It's an opinionated workbench for orchestrating AI coding agents against a Linear backlog. The project serves two audiences in one app — humans who navigate and decide what to work on, and AI agents who execute and report back — and treats the prompt as the unit of value that flows between them, carrying enough Linear context to make agent work actually useful.

The shape of the project is a set of deliberately overlapping experiments. There are multiple views (tree, swipe, swim, pipeline), each a different theory of what makes a backlog feel navigable. There are two paths for generating prompts (handwritten templates and AI-generated via meta-prompt over the same template set), kept in sync as a controlled comparison. There are four transport layers for getting prompts to agents (dispatch queue, proxy API, Linear CLI, llms.txt + data attributes), at four different coupling levels. The no-frameworks, server-rendered, vanilla-JS constraint isn't aesthetics — it keeps the iteration cost of trying yet another shape low enough that experimentation stays cheap. The overlap among views and transports isn't sprawl; it's the methodology.

What's missing, and what this document is about, is a layer the project has implicitly been building toward without naming.

## The problem: what the existing views can't show

The starting observation: in most software groups, the backlog never ends. There's a well-trodden literature on why — Lehman's Laws of software evolution (continuing change, increasing complexity), Parkinson's, Hofstadter's, and the simple fact that in modern agile practice the product backlog was never meant to be finishable. It's a wishlist representing everything anyone has ever wanted; the sprint backlog or WIP is the actually-committed slice. "Backlog never empties" is partly tautological.

But beneath that observation is a sharper one. The standard taxonomy of work — features, bugs, chores — has no category for *the core logic itself*. Pivotal Tracker formalized features/bugs/chores; most modern trackers have some version. None of them gives the system's core logic its own status, because the core isn't *work*. It's the substrate the work happens on. Fred Brooks called this the distinction between essential complexity (the irreducible difficulty of the actual problem domain) and accidental complexity (everything else: tooling, frameworks, integration glue, perf tuning). The backlog is almost entirely accidental. The essential part — the domain model, the invariants, the reason the software exists — gets touched only as a side effect of feature work, and tends to ossify because nobody schedules a ticket called "think about whether our core abstraction still fits."

This is the founding observation of Domain-Driven Design: teams pour effort into the periphery while the core domain drifts. It's why big rewrites happen — not because the features got bad, but because the core got buried under so much accreted accidental work that nobody can find or change it anymore. The backlog hides it rather than protecting it.

The visualization views in LinearViewer don't escape this. Tree view shows hierarchy. Swim shows lanes. Pipeline shows flow. Each answers *"how is the work organized and navigable?"* None of them answer *"is the work pointed somewhere worth going?"* They make state legible. They don't make direction legible.

That's the gap.

## The shift: why this matters now

The above is a longstanding problem. What makes it urgent now is a structural shift in how software gets made.

In a human-only team, the friction of writing code limited how much accidental work got produced. Every line had to pass through a human mind. The brake on accidental complexity growth was implicit in the speed of execution itself. With AI-augmented development, that brake is gone — and three coupled phenomena follow.

**First, accidental work now self-generates.** AI suggests a fix; the fix needs a new module; the module needs tests; the tests need fixtures. The accidental shell expands as a byproduct of using the tool, not as a deliberate choice.

**Second, the accidental work is less understood than before.** Previously, every line of accidental work was at least mentally indexed by the person who wrote it. Now you can have changes in your codebase you only loosely understand. Accidental work isn't just larger; it's less navigable, less reviewable, more likely to interact badly with the core.

**Third, direction-setting hasn't sped up the way execution has.** Coding got 5–10× faster. Knowing what to code didn't. The gap between rate-of-work-production and rate-of-intent-formation has widened drastically.

The thesis:

> AI-augmented development has decoupled the rate of accidental-complexity growth from the rate at which engineers can re-orient toward direction. Tools designed for the previous regime — flat lists, Kanban columns, sprint planning — implicitly assumed those rates were coupled: that the friction of doing work was also the friction of thinking about it. That assumption no longer holds.

Direct evidence: my own arc through AI-augmented development passed through stages — copy-paste via chat UI; in-SDK hints; Claude Code completing functions; expanding documentation to let it flourish; moving repetitive prompts into templates; building a task tracker that wraps those templates; letting the AI choose the next prompt; and now experimenting with a foreman that dispatches work autonomously. At each stage, the AI absorbed the previous bottleneck, and my attention concentrated on the layer above. The constant: **the bottleneck moves but doesn't disappear — it goes upstream**. And what's at the top? Direction. "Are we going somewhere worth going?" — the question no foreman, template, or meta-prompt can answer for you.

LinearViewer was built for the lower layers. The direction layer is where it now needs to go.

## The constructive answer: a direction layer

The project has, without naming it, been building two kinds of instrument:

- **State views** (tree, swipe, swim, pipeline) — legibility of where work currently is
- **Direction views** (the Ship view prototype) — legibility of whether work is pointed at the goal

These read from different layers. State views read the task graph from Linear. A direction view would need an additional input: the goal itself.

The Ship prototype already encodes the *shape* of a direction view: a central rect for in-progress, a reserved FORWARD sector for whatever the goal is, port/starboard for projects, aft for bugs, drift for unassigned work. What it doesn't yet have is a non-task-shaped source of goal-ness. Today its `heading` is configurable to a Linear project or label — deterministic, cheap, but inheriting exactly the task-shaped pathologies described below. The MVP in this document is the missing intent input the prototype's FORWARD sector is waiting for.

Linear doesn't have a primitive for that. Its data model is built around things that get finished — tasks, projects, milestones, cycles. A goal isn't shaped like any of those. It's *unbounded, ongoing, normative* — the measure against which tasks are judged, not a thing to be completed. Trying to express it as a Linear task is a category error: it would inherit task-shaped pathologies (can be archived, can be marked done, can be deprioritized) precisely because Linear is built around things that get finished.

So a direction layer needs a primitive that doesn't currently exist in the system: a **north star**.

The north star should be:

- **Prose** — markdown, because that's the format humans and LLMs both treat as native
- **Singular per project** — one north star per project being worked on, not a list (running parallel competing north stars against a single project would be incoherent)
- **Native to LinearViewer** — not stored in Linear, because Linear doesn't accommodate its shape
- **Read-only from Linear's perspective** — the AI/alignment layer reads Linear to score against the north star; Linear doesn't need to know about the north star

This is the first piece of content in the project that has no analogue in Linear. That's a feature, not a problem: **Linear is for execution; the north star is for intent; the workbench is the place where intent governs execution.**

### A note on track record

LinearViewer has rich track record data — completed tasks, durations, recent activity. It's tempting to use that as the basis for direction. But track record is one layer too low. It's *empirical* (what happened); a north star is *normative* (what should happen). Extrapolating from empirical to normative is using past behavior as the definition of the goal — exactly the drift the direction layer is supposed to detect.

Track record still has a role, just a different one: it becomes a **sensor**, not a navigator. Once a north star exists, the track record can be measured against it — alignment of completed work, rate of forward progress, drift detection. Track record + north star = "are we going where we said we were going?" Track record alone = "are we going somewhere?" The second question is much less useful, which is why the earlier Roadmap experiment — which derived summaries from Linear data alone — never felt quite right. It was producing empirical output when the moment called for normative.

## The proposal: north star + LLM analyzer

The MVP for a direction layer is small. It doesn't need a new visualization. It doesn't need tag-based grouping. It doesn't need feedback mechanisms that close the loop. It needs:

1. A north star document (prose, markdown, stored alongside the project)
2. An LLM analyzer that reads current Linear state (via the existing deterministic summary, not live tool calls) and scores it against the north star
3. A UI surface to invoke it and display results

The Roadmap feature — currently behind the `roadmap` feature flag (default off) — is a gift here. It already has: a deterministic layer (`lib/roadmap.js`) that summarises velocity, execution queue, critical paths, risks, blockers, and stale-task signals; a page renderer with AI-populated sections; and two SSE-streaming LLM endpoints (`narrative`, `chat`) that both feed the model a pre-computed text snapshot. The repurposing is small: the north star is the new input, and the LLM's job changes from *describe what's there* to *judge it against intent*. The same summarization pattern carries over — the model reads text, not tools.

### The two buttons

The interaction is two buttons on what was the Roadmap page:

- **"Get a reading"** — runs alignment analysis: score current work against the north star, identify front-lane (advancing) vs side (necessary but not advancing) vs rear (drag) vs candidate-for-archive items, report on overall directional health.
- **"Feedback on the north star"** — runs reflexive analysis: based on actual reading of the data, surface where the north star itself is weak, vague, missing coverage, or out of step with what's being worked on.

Both buttons hit the same LLM with the same context. The difference is the prompt: one asks the model to score the data; the other asks it to score the rubric.

### The dual operation

The forward analysis ("get a reading") produces:

- Items that materially advance the north star
- Items that look directional but aren't (drift candidates worth flagging)
- Items that are necessary maintenance, not advancing
- Items that don't fit either (archive candidates)
- A summary metric: what percentage of current attention is aligned

The backward analysis ("feedback on the north star") produces:

- *Specificity gaps* — phrases that are hard to score against because too many items come up "partially aligned"
- *Alignment tension* — stated direction is X, but observable WIP suggests Y; which is true?
- *Coverage gaps* — emerging clusters of work the north star doesn't address
- *Dead-letter parts* — phrases that haven't influenced any work in N weeks
- *Sharpening suggestions* — concrete replacements for vague phrases

Same model. Same data. Dual operation, single feature.

### Implementation sketch

For the first pass, the north star can be a file on disk that I copy in and out of a text input on the Roadmap page. No CRUD UI, no editor, no versioning. The point is to validate the loop, not to build a north star management system. Once the loop is validated, the storage and UI can mature.

The heavier work is in how the LLM is invoked. Two new prompts plug into the existing `streamChat` infrastructure:

1. Accept the north star as primary input
2. Receive the deterministic Linear summary (the same one the Roadmap narrative consumes — already token-efficient and grounded)
3. Produce structured output for either the forward or backward analysis, with per-item alignment classifications legible enough to drive downstream consumers (including, eventually, the Ship view's FORWARD sector)
4. Be cheap enough to run repeatedly during a working day — the default model (`anthropic/claude-haiku-4.5`) is sized for this

That last point matters more than it sounds. The value of the direction layer is partly continuous attention — drift detected weekly is much less useful than drift detected daily. If a reading costs cents and takes seconds, it gets run. If it costs dollars and takes minutes, it doesn't.

Choosing snapshot-summarization over live tool calls is deliberate: the deterministic layer already produces a compact, faithful representation of current state, and feeding it as text keeps each reading a single API call with no agentic recursion. Tool calls remain an option if a future iteration needs drill-down (e.g. fetching a specific issue's comments to judge alignment) — but the MVP doesn't.

## Risks and open questions

**Drift-as-rationalization.** The largest risk. If the LLM notices behavior diverging from the stated north star, the wrong response is "update the north star to match the behavior." That defeats the purpose — the north star exists precisely to give a fixed reference that *can* diverge from behavior. The LLM should surface tensions but never resolve them; the human decides whether the north star or the behavior is the thing to change. UI should make this explicit: present tensions as *"things for you to adjudicate,"* not *"suggested updates."*

**North star specificity calibration.** A vague north star ("build a great product") yields vague alignment scores. A specific one ("reduce time-from-task-pick to first-PR by 50%") yields tight ones. The MVP's first job is partly to discover what level of specificity makes the scoring useful. The "feedback on the north star" button is specifically designed to help here — it surfaces specificity gaps as the first input loop iterates.

**LLM scoring is probabilistic.** Some alignment judgments will be wrong. That's fine for an instrument — the direction layer doesn't need to be authoritative, it needs to be useful enough to provoke attention. But it puts pressure on the analyses to be *legible*: when the LLM scores an item as drift, it should explain why, so the human can quickly decide whether to trust the call. Opaque scores are useless.

**What counts as "useful."** The MVP needs a usefulness threshold to clear. Tentative bar: after a working day of having access to the buttons, can I describe whether my work was directional, without having to think about it manually? If yes, the layer is doing its job. If I'm still doing the direction-checking in my head, the LLM isn't earning its keep.

## Future: ship view and beyond

The proposal above is deliberately upstream of the Ship view's *intent layer*, but not of the visualization itself — that already exists as a prototype. The Ship view is a centripetal visualization: a central rect for in-progress items, a reserved FORWARD sector for whatever the goal is, port/starboard quadrants subdivided by project, an aft sector for bugs, and a drift rim for unassigned work. The prototype's current `heading` primitive accepts a Linear project or label and routes matching cards to FORWARD by deterministic string match. That works, but it's exactly the task-shaped category error the proposal warns about: a Linear primitive standing in for an intent, with the empty FORWARD arc as the only honest signal when the heading doesn't fit.

The intended state is for the forward lane to be defined by *alignment with the north star*, not by category — a feature ticket that doesn't move a KPI doesn't earn front-lane status. The MVP produces exactly the signal that would replace the prototype's heading: per-item front/side/rear/archive classifications from the LLM analyzer, which `assignLane` can consume as a third `heading.kind: 'north-star'` mode alongside the existing `'project'` and `'label'`.

So the right sequencing is to build and validate the scoring first, then wire it into the existing Ship view as an additional heading source. If the scoring works, the Ship prototype becomes a visualization of the MVP's output rather than the current heuristic. If the scoring doesn't work, the prototype is unaffected — it falls back to the project/label heading it already supports.

Two things worth noting about the future direction:

**Phase awareness.** Projects have different geometry at different stages. A 0→1 project has a sparse forward lane that's nearly the whole picture. A mature project has all four directions populated. A pivot resets what counts as forward. A sunset shrinks forward and grows the rear. The Ship view shouldn't have one fixed appearance — it should be aware of project phase, and the LLM is what could detect which phase the project is in.

**The methodology may not transfer.** The state-layer methodology of running multiple competing shapes (tree, swipe, swim, pipeline) has worked well. It may not transfer to the direction layer. At the direction layer, the north star and the project being worked on are singular; running competing instruments against the same singular goal might be incoherent rather than methodologically productive. The right experimental discipline at the direction layer might look different — fewer competing shapes, more iteration on a single shape against varied projects and phases.

---

The proposal is small. The thesis it serves is large. The bet is that the small proposal is enough to validate the largest claim the thesis makes: that direction-setting is the layer where the bottleneck now lives, and that purpose-built tooling at that layer is meaningfully better than the implicit human-only direction-setting most projects rely on.

If the MVP earns its keep — if I find myself actually using the two buttons during real work, and finding the output useful — the case for the rest of the direction layer is made. If it doesn't, the thesis needs sharpening before any more is built on top of it. Either way, the experiment is small enough to be worth running.
