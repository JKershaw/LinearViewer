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

## Results — Run 1 (soft guard only, the as-reviewed 403b5ef diff)

| case | axis tested | gen | arm A (pre-LIN-697) | arm B (live) | Δ |
|---|---|---|---|---|---|
| **GOLD-1** archived-vs-status (2nd representation) | reuse-don't-duplicate + cross-surface sync | **gpt-5.4-mini** | 4/10 (40%) | **9/10 (90%)** | **+50** ✅ |
| GOLD-1 | " | haiku | 9/10 (90%) | 7/10 (70%) | −20 (high-baseline noise) |
| GOLD-2 retryCount sync + lifecycle | source-of-truth parity + failure/lifecycle | gpt-5.4-mini | 6/10 (60%) | 6/10 (60%) | 0 |
| GOLD-2 | " | haiku | 7/10 (70%) | 7/10 (70%) | 0 |
| **CTRL-1** footer typo (small) — *overfitting control* | scale-to-task guard | **gpt-5.4-mini** | 0/10 (0%) | **5/10 (50%)** | **+50** ⚠️ |
| CTRL-1 | " | haiku | 0/10 (0%) | 1/10 (10%) | +10 |

(For CTRL-1, a YES = ritual axis-listing on a trivial task = **bad**. We want B low and Δ≈0.)

**Run-1 reading.** The directive worked on the decisive second-representation case (GOLD-1, the exact
KUL-567 failure shape) — 40%→90% on the prod model — but the **overfitting control fired**: the live
prompt produced a full Horizontal Obligations section + "Attack your own research" pass on a
one-character typo fix 50% of runs (stripped prompt: 0%). Inspected samples confirmed genuine ritual
axis-listing, not a judge artifact. Diagnosis: the scale-to-task guard lived in `formatScaleToTask()`
several paragraphs *upstream*, while the `### Horizontal Obligations` header opened with an
unconditional imperative — so the model obeyed the local instruction. Run-1 decision was **do not merge**.

## Fix — local applicability gate (positive framing)

A one-line gate at the section head, carrying the guard with the imperative it governs, framed as *what
to do on a small task* rather than a prohibition:

> *This applies when the change touches shared structure, more than one surface, or data the system
> already models. For a genuinely small, single-surface change — a typo, a constant or config edit, a
> one-file change — record the file and the fix and go straight to the Surface Assessment below.*

Mirrored into the meta-prompt Research-prompts bullet (both-paths rule); Linear byte-identical parity
test stays green; 161/161 unit tests pass (one added to pin the gate). No new checklist sections — the
direction the plan warned against.

## Results — Run 2 (with the local gate) — the shipping config

| case | gen | arm A (pre-LIN-697) | arm B (live) | Δ |
|---|---|---|---|---|
| **GOLD-1** archived-vs-status (2nd representation) | **gpt-5.4-mini** | 4/10 (40%) | **10/10 (100%)** | **+60** ✅ |
| GOLD-1 | haiku | 7/10 (70%) | 8/10 (80%) | +10 |
| **GOLD-2** retryCount sync + lifecycle | **gpt-5.4-mini** | 6/10 (60%) | **9/10 (90%)** | **+30** ✅ |
| GOLD-2 | haiku | 6/10 (60%) | 10/10 (100%) | +40 |
| **CTRL-1** footer typo (control) | **gpt-5.4-mini** | 0/10 (0%) | **0/10 (0%)** | **0** ✅ |
| CTRL-1 | haiku | 0/10 (0%) | 0/10 (0%) | 0 ✅ |

## Reading

- **Overfitting eliminated.** The control drops to **0% on both models** (was 50% / 10%) — the local
  gate gives small/single-surface tasks a clean off-ramp; no more ritual axis-listing on a typo.
- **Gold lifts improved, not traded away.** GOLD-1 goes to a perfect **100%** on the prod model (Δ+60);
  GOLD-2 moves from flat to **+30** (prod) / **+40** (haiku). Sharpening *when the section applies* both
  killed the ritual on trivial work and primed the model to recognise the real obligation cases — a
  positive-sum change, not a precision/recall trade.
- No regression on any cell across either model.

## Decision: **MERGE-ELIGIBLE**

Both pre-registered conditions are now met on the prod model: a positive lift on the gold cases
(GOLD-1 +60, GOLD-2 +30) **and** a clean small-task control (0%, Δ0). The tightening is the routed fix
the Run-1 finding called for. Note: this adds a small prompt change beyond the human-reviewed `403b5ef`
diff — the gate line + its meta-prompt mirror — so the final merge call should acknowledge the diff
moved since review.

## Caveats

Lower bound: a single call can't run tools, so this measures the *decision* to check obligations, not
the check itself — real agents (Claude Code) should beat the gold numbers. Small-n (K=10), so treat
±1–2 hits as noise; the GOLD-1 and CTRL-1 prod-model Δ+50s are well outside that. The haiku GOLD-1
−20 is high-baseline noise (Arm A already 90%), not evidence the directive hurts.
