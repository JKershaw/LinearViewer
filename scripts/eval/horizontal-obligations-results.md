# Horizontal Obligations A/B eval — results (LIN-697)

Harness: `scripts/eval-horizontal-obligations.mjs`. Methodology: `docs/prompt-change-validation.md` §5.
Run date: 2026-06-26. Generators: `openai/gpt-5.4-mini` (prod default) + `anthropic/claude-haiku-4.5`
(cheap cross-check). Judge held constant on `anthropic/claude-haiku-4.5`. K=10 per arm per cell, temp 0.7.

**Arms (the prompt is the only variable):**
- **Arm B** = the live `research` prompt (`generatePrompt('research', issue, ctx).prompt`).
- **Arm A** = the same prompt with the **entire LIN-697 contribution stripped** — the
  `### Horizontal Obligations` + `### Attack Your Own Research` block AND the symmetric
  duplicate-representation sentence in Surface Assessment. Both strip targets must match or the
  harness throws (no silent A==B). Arm A is therefore the genuine *pre-LIN-697* research prompt.

Evidence is **not pre-solved** (the ceiling-effect trap): each gold case gives only what a ticket
author would have seen — a clean grep of the *new* symbol (0 hits, it doesn't exist yet) plus the
one model/render file an author opens, which *contains* the existing representation but never labels
it a duplicate. We measure the **decision** to enumerate obligations / spot the duplicate.

Gold-case ground truth = the documented **KUL-567 / HAR-697 retro** (LIN-697 description): an
implementation that landed "locally right but globally wrong" because the research characterised
*what it built* and skipped *what it had to hold true against* — it added a **second representation**
of something already modelled and missed cross-surface sync / lifecycle. GOLD-1/GOLD-2 re-encode that
failure shape at author-visible-evidence fidelity (the literal KUL-567 code lives in another project).

## Results

| case | axis tested | gen | arm A (pre-LIN-697) | arm B (live) | Δ |
|---|---|---|---|---|---|
| **GOLD-1** archived-vs-status (2nd representation) | reuse-don't-duplicate + cross-surface sync | **gpt-5.4-mini** | 4/10 (40%) | **9/10 (90%)** | **+50** ✅ |
| GOLD-1 | " | haiku | 9/10 (90%) | 7/10 (70%) | −20 (high-baseline noise) |
| GOLD-2 retryCount sync + lifecycle | source-of-truth parity + failure/lifecycle | gpt-5.4-mini | 6/10 (60%) | 6/10 (60%) | 0 |
| GOLD-2 | " | haiku | 7/10 (70%) | 7/10 (70%) | 0 |
| **CTRL-1** footer typo (small) — *overfitting control* | scale-to-task guard | **gpt-5.4-mini** | 0/10 (0%) | **5/10 (50%)** | **+50** ⚠️ |
| CTRL-1 | " | haiku | 0/10 (0%) | 1/10 (10%) | +10 |

(For CTRL-1, a YES = ritual axis-listing on a trivial task = **bad**. We want B low and Δ≈0.)

## Reading

- **The directive works where it matters.** On the prod model, the decisive second-representation
  case (GOLD-1 — the exact KUL-567 failure shape) jumps **40% → 90%, Δ+50**. The live prompt reliably
  gets the research to flag that the new `archived` flag duplicates the existing `status` lifecycle and
  must stay in sync across the server + client sidebar filters, where the stripped prompt misses it 60%
  of the time. This is a real, prod-model lift on the case the change exists for.
- **GOLD-2 is flat (Δ0), not a regression.** The sync/lifecycle obligations on the dispatch-retry case
  were already surfaced ~60–70% by both arms; the directive neither helped nor hurt there.
- **The overfitting control FIRES on the prod model.** On gpt-5.4-mini the live prompt produces a full
  Horizontal Obligations section (all four axes) **plus** an "Attack your own research" pass on a
  **one-character typo fix** — 50% of runs, vs **0%** for the stripped prompt (Δ+50). Inspected samples
  confirm it's genuine ritual axis-listing (each axis named, mostly concluding "n/a / lands cleanly"),
  not a judge artifact; the judge was if anything conservative. haiku mostly resists (10%), so the
  overfit is prod-model-specific — and the prod model is the one that ships.

## Decision: **DO NOT MERGE (yet)**

Per the pre-registered decision rule (LIN-697 plan watch-item + the dispatch directive): a positive
lift is necessary but **not sufficient** — the small-task control must also show no overfitting. It
does not. The scale-to-task guard (`formatScaleToTask()` in `lib/prompt-formatters.js`, which names
the new `/obligations` sub-steps) is **too weak to suppress the obligation tax on small/single-surface
tasks on the prod model**. Merging as-is would ship exactly the "ritual compliance / attention thins on
trivial work" failure the LIN-697 plan named as the thing to watch for.

This is a **good** result for the directive's core idea and a **fail** for its current guard wording.

## Routed next action

Tighten the scale-to-task wording so a genuinely small / single-surface research task **skips the
Horizontal Obligations + Attack passes entirely** on gpt-5.4-mini (not just lists them as "n/a"), then
re-run `ONLY=CTRL-1 GEN_MODELS=openai/gpt-5.4-mini node scripts/eval-horizontal-obligations.mjs` and
confirm CTRL-1 Arm B drops back toward 0% **without** regressing GOLD-1 Arm B (must stay ≥ ~80%).
Candidate levers (do NOT add more checklist sections — that's the wrong direction the plan warned about):
- Make the guard a hard *gate* at the top of the obligations block ("If the task is a typo, a constant/
  config change, or a one-file edit, STOP here — do not produce a Horizontal Obligations section"),
  rather than a soft "skip the heavier sub-steps" hint several paragraphs upstream.
- The both-paths rule applies: the same tightening must land in the meta-prompt Research-prompts bullet,
  and the Linear byte-identical parity test must stay green.

## Caveats

Lower bound: a single call can't run tools, so this measures the *decision* to check obligations, not
the check itself — real agents (Claude Code) should beat the gold numbers. Small-n (K=10), so treat
±1–2 hits as noise; the GOLD-1 and CTRL-1 prod-model Δ+50s are well outside that. The haiku GOLD-1
−20 is high-baseline noise (Arm A already 90%), not evidence the directive hurts.
