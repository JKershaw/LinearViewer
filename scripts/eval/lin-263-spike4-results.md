# LIN-263 — spike 4: validating GPT-5.4-Mini on the OTHER calls (brief + recap)

Run of `scripts/eval/lin-263-spike4.mjs`. Exercises the **real production functions**
(`generateBrief` / `generateRecap`) with each model on three real dense tickets
(`LIN-344`, `LIN-177`, `LIN-325`), so the test is byte-faithful to the app. Deterministic
viability gates + a manual quality read. Run spend: **~$0.7**.

**Pass criteria (must be 100% with no issues):**
- **brief** — emits all 4 fixed sections (`## Current` / `Constraints` / `Open questions`
  / `Changelog`), in order, non-trivial.
- **recap** — parses to **valid, non-empty** JSON (`done`/`pending`/`deviations`).
  `parseRecapResponse` silently returns an empty recap on malformed output, so empty = fail.

## Results

| Model | brief (3 tasks) | recap (3 tasks) | brief latency | recap latency |
|-------|:---------------:|:---------------:|:-------------:|:-------------:|
| Opus 4.8 *(ref)* | **3/3 PASS** | **3/3 PASS** | 19–29s | 12–15s |
| **GPT-5.4-Mini** | **3/3 PASS** | **3/3 PASS** | **~5s** | **~2–3s** |
| Gemini 3.5 Flash | 3/3 PASS | **0/3 FAIL** | 11–14s | ~7s |
| Haiku 4.5 | 3/3 PASS | 2/3 (flaky) | 10–28s | 7–15s |

## What we learned

1. **GPT-5.4-Mini is fully viable on brief AND recap** — 3/3 on both, and *much* faster
   than the others (brief ~5s vs Opus ~25s; recap ~2–3s vs Opus ~13s). Combined with the
   recommend results, **it passes all three per-task LLM calls** — the only non-Opus model
   that does.
2. **Gemini 3.5 Flash is NOT viable for recap (0/3).** Diagnosed from the raw output:
   it emits a chain-of-thought preamble *before* the JSON (`"…→ 73 chars. All look well
   under limits.{…"`) and hits `finish_reason: length` at the 1500-token cap before
   closing the object → the parser recovers nothing. It ignores the system prompt's "reply
   with a single JSON object and nothing else." A real model-behavior failure, not a
   parser nit — so Gemini would be a **bad global default** despite passing recommend+brief.
3. **Haiku is flaky on recap (2/3)** — one empty recap (`LIN-177`), same empty-fallback
   failure mode. Another mark against keeping it as the default.
4. **brief is the easy call** — every model produced the 4-section contract. recap (strict
   JSON-only) is the discriminating one, exactly the kind of format-fidelity task where
   weaker/over-talkative models fall down.

## Implication

This closes the loop the recommend benchmark opened: the workspace model is a single
global dial, and **GPT-5.4-Mini is the one cheap model that holds across recommend, brief,
and recap.** Safe to make it the default. Gemini 3.5 Flash is explicitly disqualified as a
default (recap), and is omitted from the curated settings list for that reason.

*(Untested surface: roadmap narrative pipeline — a separate multi-call path, out of scope
for this pass.)*
