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

## The pipeline

Five LLM calls, each producing a string. The context passed to each prompt is just the concatenation of what came before that is relevant. No agentic recursion, no tool calls, no orchestration logic beyond sequencing and string concatenation.

```
0. Data        →  summary       (deterministic, no LLM)
1. Technical      summary                  → tech
2. Product        summary + tech           → product
3a. Trajectory    summary + tech + product → trajectory   ┐ run in
3b. North Star    summary + north_star     → ns_reading   ┘ either order
4. Gap            north_star + trajectory + ns_reading → gap
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
