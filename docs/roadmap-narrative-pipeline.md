# Roadmap Narrative Pipeline

*A design document. Last updated 2026-05-24.*

> Companion to `direction-layer-proposal.md`. That document argues for adding a
> north star primitive and an LLM analyzer. This one specifies the narrative
> pipeline that orchestrates the analyzer's output across multiple reading
> layers, anchored on a discovery from interactive use: the same roadmap data
> can be read at three distinct levels of abstraction, and each level answers
> a different question for a different audience.

## Summary

The current Roadmap narrative produces a single output — a TPM-style "what was delivered, where things stand" read of the deterministic data summary. Through interactive use, three increasingly aspirational reframings of that same data emerged as independently valuable: the technical read, a product-perspective synthesis, and a high-level vision-style story projecting current direction forward. Each is a useful artifact on its own; together they form a progressive zoom that maps to real audiences (engineering, product, exec/customer). With a north star input added, a fourth output becomes possible — a judgment of current work against stated intent — and a fifth — the gap between trajectory and intent, which is the most actionable output the entire pipeline produces.

This document proposes a five-step pipeline that generates each layer as a streamed section, with deliberate decisions about which layers chain from prior context and which read fresh from source data.

## Background: the discovery

The current Roadmap narrative is intentionally constrained to be empirical and unembellished. Its system prompt forbids editorializing, projections, and any language that interprets work beyond stating facts. The result is a faithful but technical read — useful as the true read of the project, less useful for audiences who need to understand what the work *means*.

In testing, a chat follow-up to the default narrative — *"Give me this as a narrative, product perspective"* — produced a markedly more readable output. Same data, looser constraints, product persona. A second follow-up — *"Stepping back to think of the project as a whole, its North Star, and progress, give me a higher level version of this, telling the story of [project name] and its potential"* — produced a third output that read as compelling and aspirational.

The third output was illuminating for two reasons. First, it felt qualitatively different from the first two — it had narrative arc and stakes. Second, it was generated without any north star input. The LLM filled the normative vacuum by extrapolating from observed direction of travel: it took the current vector of shipped work and projected it forward.

That is a distinct epistemic move from either of the prior layers. The technical and product layers describe *what is*. The third layer describes *where this is heading if it continues*. With a north star input, a fourth distinct read becomes possible: *how well current work serves stated intent*. The gap between the third and fourth is the drift signal the direction-layer proposal is built around.

## The three (and then five) layers

The pipeline produces five outputs, mapping cleanly to three epistemic registers:

| Layer | Register | Question it answers |
| --- | --- | --- |
| 1. Technical | Empirical | What was delivered and where does the work stand? |
| 2. Product | Empirical (synthesized) | What does this work mean? What themes does it form? |
| 3a. Trajectory | Extrapolative | Where is this heading if the current vector continues? |
| 3b. North star reading | Normative | How well does current work serve stated intent? |
| 4. Gap | Reflective | Where does trajectory diverge from intent, and what does the gap suggest? |

Two structural observations:

- **3a and 3b are siblings, not parent and child.** Neither is "the truth." The truth — to whatever extent it exists — lives in the gap between them. Visual framing should reflect this; rendering one before the other or one larger than the other will anchor the reader on it.
- **3a remains useful in the absence of a north star.** It is the aspirational reading the third chat reframe produced. If the north star primitive does not exist yet for a workspace, the pipeline degrades cleanly to layers 1, 2, and 3a — which is itself a meaningful product.

> **Update (LIN-317, 2026-06-05): orchestration moved from client to server.**
> This document originally specified *client-side* orchestration — the server
> embedded the full `roadmapModel` in the page and the client sent a slice of it
> back on each per-layer call. On large workspaces that request body crossed the
> `express.json` 250kb cap and the layer call failed with an instant HTTP 413
> before any LLM ran. The pipeline is now driven by a single server endpoint
> (`POST /workspace/:urlKey/api/roadmap/generate`): the server fetches Linear
> **once**, builds the model into a request-local variable, and streams every
> layer over **one** SSE connection, each event tagged with its layer id. The
> sequencing, chaining, and degradation rules below are unchanged — only *where*
> the orchestration runs moved. Per-layer failures now emit a `layer-error`
> event on the shared stream and the pipeline continues; the model never crosses
> the wire, so the payload-size cliff is gone and the five per-layer fetches can
> no longer observe inconsistent snapshots.

> **Update (LIN-300): orientation — per-task compass bearings.**
> A follow-up step rides the same server-orchestrated stream after the narrative
> layers (only when a north star is set). It adjudicates each *not-yet-started*
> candidate task (in-progress work stays on the ship; terminal/duplicate states
> are already filtered by `buildExecutionQueue`) against the fixed north star,
> producing a compass **bearing** on the 8-point set `{N, NE, E, SE, S, SW, W,
> NW}` plus a one-sentence reason and an off-compass flag. Unlike the
> prose layers it is **not** streamed token-by-token: the server accumulates the
> full output, parses it with `parseOrientationLines`, and validates each
> bearing against the 8-point vocabulary (an un-archived task with an invalid
> bearing is dropped; an archived task is kept with an empty bearing). The result
> is emitted as one structured `orientation` SSE event the client stashes and
> persists via `saveReport` into the report-history store's `orientation` field
> (plumbed in LIN-299), and also renders on the roadmap page as a visible result
> (LIN-324/D) so the operator can confirm generation worked. The ship view
> (LIN-301) reads that field — no LLM call on the ship side. The bearing
> vocabulary is shared three ways: the prompt emits it, the generate route
> normalizes it, and the ship view maps bearing→angle; the store's
> `normalizeOrientation` enforces field *shape* only, not the vocabulary.
> Kept as a *separate* prompt (`lib/prompts/roadmap-orientation-template.js`) so
> the five plain-text narrative layers keep their plain-text rendering contract
> and adjudication stays cleanly isolated from narrative evaluation.
>
> **Update (LIN-324): line format, not JSON.** The orientation output is a flat
> line format — one line per candidate, `IDENTIFIER | BEARING | reason`, with
> `OFF` marking an off-compass (archived) task — *not* JSON. The JSON contract
> failed silently on real-sized workspaces: a token-cap overrun truncated the
> array mid-element and `JSON.parse` then threw on the whole response, discarding
> every bearing already produced. `parseOrientationLines` commits to this one
> format and recovers gracefully — a truncated trailing line costs at most that
> one line — but it does **not** accept other shapes (JSON, wrapper objects,
> full-word bearings, markdown). Genuine format drift therefore parses to nothing
> usable, and the route surfaces that as a `notice` on the orientation event
> (the same surfacing covers a missing north star and a safety-cap tail-drop)
> rather than emitting a silent `[]`.

## The pipeline

Five LLM calls, each producing a string (six with the digest). The context
passed to each prompt is just the concatenation of what came before that is
relevant. No agentic recursion, no tool calls, no orchestration logic beyond
sequencing and string concatenation — now executed server-side in one request
closure (see the LIN-317 note above) rather than across independent client
calls.

```
0. Data        →  summary       (deterministic, no LLM)
1. Technical      summary                  → tech
2. Product        summary + tech           → product
3a. Trajectory    summary + tech + product → trajectory   ┐ run in
3b. North Star    summary + north_star     → ns_reading   ┘ either order
4. Gap            north_star + trajectory + ns_reading → gap
5. Digest         tech + product + trajectory + ns_reading + gap (+ north_star) (+ position) → digest   (generates last, renders first)
```

Each output is streamed to the UI as it generates. Partial states are sensible products: if layer N fails or has not run yet, layers 1..N-1 still ship.

### Chaining decisions

Three context decisions are baked into the diagram and worth naming.

**Layer 2 chains from layer 1.** The product view is a genuine refinement of the technical view — it synthesizes themes from what layer 1 enumerated. Chaining makes the synthesis legible to the model rather than asking it to redo the work.

**Layer 3a chains from layer 2.** Trajectory is the forward extrapolation of the product synthesis. Without that scaffolding, the model would re-derive themes before projecting, producing a more cluttered output. With it, the trajectory reads as "the same view, projected."

**Layer 3b skips the chain.** A judgment against intent should not be shaped by prior empirical framings — they would anchor the evaluation. Layer 3b reads the source summary and the north star directly. This is the one place where the discovery flow ("each layer chains from the last") and the design intent diverge, and the design intent should win: the gap analysis only makes sense if 3a and 3b stand on epistemically comparable bases, and the way to achieve that is to keep the normative read source-grounded.

**Layer 4 takes the two forked outputs plus the north star itself.** Earlier layers were scaffolding; the gap is a direct comparison. Pulling 1 and 2 back in dilutes the output.

## Per-prompt considerations

### Layer 1 — Technical narrative

Already exists as `lib/prompts/roadmap-narrative-template.js`. Persona is technical program manager. Rules are tight: no editorializing, no projections, no estimate talk. Lens is empirical state — "what is."

This layer protects the property that there is always a true, unembellished read everyone can return to. Its constraints should not loosen. The other layers exist precisely so this one does not need to.

### Layer 2 — Product perspective

Persona: product manager translating engineering work into user and business meaning.

Loosen the no-editorializing rule — allow value framing words ("matures," "consolidates," "lays foundation"). Keep the no-projections rule. Product framing without forecasts.

Pitfalls:

- Re-stating layer 1 in slightly different words. The prompt must require *synthesis of themes*, not re-narration.
- Inventing user impact the data does not support. Every value claim must cite specific shipped work.

### Layer 3a — Trajectory / aspirational

Persona: strategist reading the direction of travel forward. Lens: extrapolation, explicitly forward-looking. Allow value-rich, aspirational language.

Critical constraint: every projection must be hedged — "at this pace," "if this continues," "the work suggests a direction toward." Unqualified future statements are forbidden.

Pitfalls:

- This is *implicit* direction, not *recommended* direction. The prompt must make the distinction explicit. Phrase to include: *"Describe where the current vector points if extended, not what should happen."* Without this, the trajectory output silently becomes a recommendation, which is exactly the drift-as-rationalization mode the direction-layer proposal warns against.
- When the data is mixed or scattered, the prompt must allow the model to say so. Forcing coherent direction from incoherent data is dishonest.

### Layer 3b — North star reading

Persona: critical evaluator scoring work against a fixed rubric. Not a cheerleader. Lens: normative judgment.

Fresh from data — do not reference layers 1 or 2.

Required output shape: per-project (or per-cluster) classification — *aligned* / *necessary maintenance* / *drift* / *archive candidate* — plus an overall alignment read.

Pitfalls:

- Reinterpreting the north star to fit the work. Strong instruction: *"The north star is fixed; describe how work aligns to it, never how the north star might be revised to match."*
- Vague north stars produce vague readings. Allow the model to flag *"this part of the north star is too vague to score against"* rather than fudging the call.
- Cite both sides: specific tasks and specific north star phrases.

### Layer 4 — Gap analysis

Persona: advisor presenting findings to a decision-maker. Not recommending resolution.

Required structure: *where they agree* / *where they diverge* / *questions this raises*.

Pitfalls:

- The direction-layer proposal's central warning: do not propose updating the north star to match the trajectory, and do not propose changing the trajectory to match the north star. Surface tensions, never resolve them. Explicit phrasing to include: *"You are flagging tensions for a human to adjudicate."*
- False alignment. If trajectory and intent largely agree, say so plainly. Do not manufacture conflict to look insightful.
- False divergence. If they disagree, name specific phrases and specific work. No vague "some misalignment exists."

Cap output length around 200–300 words. The gap is the punchline; long gap analyses dilute it.

### Digest — at-a-glance summary (the synthesis layer)

Persona: an editor writing the lede that sits at the very top of the reading.

Added after the original five-layer design, the digest is the answer to a
structural problem the five layers created: five full-length, equal-weight
sections in pipeline order, with the most actionable finding (the gap) buried
last and no top-level read for someone who wants the picture in under a minute.
The digest reads *all* the layers above it — and, since LIN-1110, one
deterministic input of its own — and tells the story of where the project stands
as a short connected narrative — a few flowing paragraphs, not a labelled form.
It weaves six beats into one throughline:

- **what we shipped** — what was actually delivered (headline, not a list).
- **where we are along the roadmap** — position against the plan: how far
  through the work we are, what is in flight, the shape of it right now. This is
  the one beat with a deterministic source — a compact position block derived
  from the roadmap model (see the LIN-1110 note below). Position, never ETA.
- **where this is heading** — the (hedged) direction of travel, drawn from the
  trajectory layer; the one beat that answers "are we close / what's our
  heading?" at the top of the page. Earned optimism about the far outlook is
  allowed; dates and numeric forecasts are not.
- **what's pulling us sideways** — the alignment force: drift away from the north
  star, competing pulls, scope moving away from stated intent. Sourced
  *exclusively* from the north-star reading and the gap analysis (layers 3b/4).
- **what's slowing us down** — the delivery friction: blockers, stale or
  unassigned critical-path work, bottlenecks. Sourced from layer 1.
- **the one decision** — the open question the human must adjudicate, hoisted out
  of the gap analysis's "questions this raises" (where it was a buried
  parenthetical) to the top of the page. It states the question; it does not
  answer it.

Each force beat carries its own "if there is genuinely no material force here,
say so plainly — do not manufacture one" escape. Two beats create two slots to
fill, so the escape has to be stated per beat or the split trades one vague risk
sentence for two invented ones.

> **Update (LIN-416): narrative lede, not a four-slot form.** The digest was
> originally a rigid form emitting four verbatim labelled slots (`SHIPPED:` /
> `WHERE WE ARE:` / `THE RISK:` / `THE DECISION:`). In use the result read formal
> and un-narrative — a fill-in-the-blanks form rather than the story of progress
> the surface is for, and it leaned on none of the model's reasoning. LIN-416
> loosened *only this layer* (the five narrative layers are unchanged): the same
> beats are now woven into flowing prose, a **heading** beat was added (the
> ticket's "are we close / what's our heading?"), and the prompt asks the model
> to reason over the layers internally before writing. Nothing downstream parsed
> the slot labels, so the change is prompt-text only. The protected layer-1
> empirical read is untouched; the digest just inherits trajectory's existing
> aspirational license for the far outlook.

> **Update (LIN-1110): narrative and roadmap-focused — six beats, ~250 words,
> and the layer's first deterministic input.** The ask recurred three weeks
> after LIN-416: the lede was still too compressed to orient a reader, and it
> could not reliably say where the work stood. Three changes, this layer only.
>
> **The risk beat split in two.** "The one risk" forced one force where the
> report explicitly asked for several, and it collapsed two genuinely different
> questions — *what is pulling us sideways* (alignment) and *what is slowing us
> down* (delivery) — into one sentence. They are now separate beats with
> separate sources. The old "name which kind it is" instruction is deliberately
> dropped: with separate beats the beat itself carries the kind, and keeping it
> produced label-like prose in a layer whose whole point is that it does not read
> as a form.
>
> **The length target moved with the beat count**, from ~150 words to ~250 with
> a hard ceiling of ~320. The number is *derived*, not drifted: the governing
> intent — "a lede a busy reader can absorb in under a minute" — is unchanged and
> stays adjacent to the number in the prompt, and six beats at ~40 words each is
> where it lands. If a reviewer later trims a beat, the budget should move with
> it. The budget is stated in **two messages** (system and user), so a guard on
> it has to read both.
>
> **The digest now receives model data.** This is the first time this layer has
> — the "reads *all* the layers above it" framing needs that qualifier. Position
> facts previously reached the digest only if layer 1 happened to mention a
> percentage, which was non-deterministic on precisely the fact the ticket
> existed to guarantee, and invited the model to invent a number under pressure
> to fill the beat. `buildRoadmapDigestMessages` takes one new optional input,
> `roadmapModel`, and `summarizeRoadmapPosition()` (in the digest template, with
> the layer that consumes it) serializes a compact position block: per project
> name, progress percent, done/total/remaining and in-progress count, plus
> critical-path depth. Projects are ranked deterministically by **activity, not
> size** (in-progress desc → remaining desc → percent desc → name asc), capped at
> five with a "+N more" tail, and the prompt tells the model to lead with the
> first and give the rest at most a clause — determinism in the serializer,
> brevity in the prompt.
>
> **The whitelist is load-bearing.** The milestones that block is derived from
> are `projectTimeline()` output, so they carry `projectedStart`,
> `projectedEnd`, `weeksRemaining`, `confidenceLow` and `confidenceHigh` —
> exactly the numbers house policy forbids here. The serializer therefore reads
> a **whitelist** of fields by name; never a blacklist, never a spread, which
> would leak the next projection field anyone adds. Velocity is excluded for the
> same reason one step removed: a rate invites forecasting by arithmetic. Two
> tests pin this — one against a hand-built fixture, one against real
> `projectTimeline` output in `roadmap-integration.test.js`. The latter is not
> optional: the roadmap e2e spec runs in `testMode`, which returns the mock layer
> *before* `buildMessages()` is called, so no e2e test can reach this code.

Two deliberate differences from the other layers:

- **It generates last but renders first.** It needs every layer above as input,
  so it is the final LLM call; but its placeholder sits at the top of the
  reading, and the client streams into it last. While the layers below generate,
  the top slot shows a "summarises once the reading below completes" pending
  state rather than sitting empty.
- **No *visible* reasoning block.** Every other layer prints an internal
  REASONING section before its prose. The digest does not — it is told to reason
  over layers 1–4 internally (so the synthesis is genuinely reasoned, not
  slot-filling) but to print only the lede, because a reasoning dump at the very
  top of the page would defeat the "legible at a glance" purpose.

Degradation: the digest has two optional inputs, and they degrade
**independently** — neither branch nests inside the other.

- **No north star** → no ns_reading and no gap, which are the *only* sources for
  the "what's pulling us sideways" beat. That beat is therefore **suppressed
  outright**, leaving a five-beat, delivery-only digest, and the decision beat
  reports that no alignment decision is forced. It is deliberately *not* redrawn
  from delivery signals or from parallel project activity: sideways pull is a
  claim about intent, and inferring it from anything else is exactly the
  manufactured risk the per-beat escape exists to prevent.
- **No position data** (no model passed, no projects, or nothing meaningful in
  it) → no labelled position section is emitted at all, and the position beat
  **softens** to prose-sourced, with an explicit instruction not to state figures
  it was not given. Softened, not dropped: the layers below can still support a
  qualitative read, and a fresh workspace's digest should still say where things
  stand.

Both absent at once — the fresh-workspace shape — is the furthest degradation: a
five-beat, delivery-only, prose-sourced-position digest. The digest still runs
from layers 1/2/3a. It needs at least layers 1 and 2 to have produced content; if
they failed, the digest is skipped.

Projection policy: this layer is now covered by the same house rule as the
narrative layer, enforced by a second mechanism. `PROJECTION_RISK_TYPES`
(`roadmap-narrative-template.js`) filters *risk types* out of layer 1's summary;
the digest's position whitelist (`summarizeRoadmapPosition`) keeps *milestone
forecast fields* out of the synthesis layer. Two arms of one policy on different
data — they should not be merged or made to import each other.

Cost note: the digest is a sixth LLM call, so a full run consumes one more
free-tier unit than before. Acceptable for an occasional, button-driven feature.

## Cross-cutting rules

All five prompts share three rules. Repeat them in each prompt rather than relying on a shared system message — repetition is safer than hoping a top-level instruction gets respected through five distinct calls.

- Plain text only — no markdown. Output renders in a monospace UI.
- Use original task and project names on first mention; after that a short, recognizable short-form is allowed (full name first, short reference after) so prose doesn't read like a list of database keys. No inventing names, no altering identifiers (e.g. LIN-123).
- Cite specific items when making claims. Vague claims are not claims.

## Failure modes

Each layer can fail independently and the page is still a sensible product at every partial state:

- No north star configured → fork only runs 3a; the gap section becomes a CTA to set a north star.
- 3b fails → trajectory still ships; no gap analysis.
- 3a fails → north star reading still ships; no gap analysis.
- Layer 4 fails → both forked sections render; the gap section shows a retry.
- Layers 1 or 2 fail → fall back to the deterministic page that already exists.

UI should distinguish "not yet" (still streaming) from "not available" (north star not configured) from "failed" (retry possible). They are three different things and conflating them makes the partial states look broken when they are not.

## Open questions

**When does the pipeline run?** This is a feature that runs occasionally, not on every page load, which removes most of the cost pressure. But it still needs an interaction model. Options:

- Explicit button ("generate reading") — user-driven, predictable, slow
- Auto on page load with caching keyed on (north_star_revision, data_snapshot_hash) — invisible to user, fast on repeat visits
- Hybrid: layer 1 auto, layers 2–4 on demand — cheap first impression, expensive only when requested

The explicit button is probably right for the first iteration. Caching can come later once the loop is validated.

**What does "data snapshot hash" cover?** If the north star has not changed and only one new task has shipped, do we re-run the whole pipeline or reuse cached output? Defining staleness precisely matters once caching is in.

**Where does the north star itself live?** The direction-layer proposal suggests "a file on disk that I copy in and out of a text input on the Roadmap page" for the first pass. This pipeline depends on that input existing. The UX for capturing and editing the north star is out of scope for this document but is the gating dependency for layers 3b and 4.

**Visual framing of the fork.** Rendering 3a and 3b as true sibling sections — equal heading weight, side by side or stacked with identical treatment — is part of the design, not just styling. If one renders larger or earlier, readers anchor on it as "the answer." The framing this design depends on is that *neither* is the answer; the gap is.

## Relationship to the direction-layer proposal

`direction-layer-proposal.md` argues for the north star primitive and proposes two LLM operations: alignment scoring ("get a reading") and reflexive north star feedback ("feedback on the north star").

This pipeline subsumes the first ("get a reading" = layer 3b) and adds three siblings around it. The trajectory layer (3a) and gap analysis (4) are new additions — not contemplated in the proposal — and address something the proposal hints at without naming: drift can only be detected by comparing intent against the *implicit* direction the work is currently pointing, not against state alone. Trajectory + gap make the proposal's drift detection actually computable.

The reflexive operation ("feedback on the north star") is not in this pipeline. It belongs as a separate, parallel feature — its job is to score the rubric, not the work, and folding it into a layered narrative would dilute both. It should remain the second button on the page, distinct from the layered narrative the pipeline produces.
