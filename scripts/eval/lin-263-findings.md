# LIN-263 — Model benchmark: consolidated findings

Rolls up the planning note + four manual spikes into one place. Total spend across all
runs: **~$2.8**. Detail lives in `lin-263-model-benchmark-plan.md`,
`lin-263-spike-results.md`, `lin-263-spike2-results.md`, `lin-263-spike3-results.md`, and
`lin-263-spike4-results.md`; this is the synthesis.

## 🏁 Scorecard

Quality gate: a model must score **100% with no issues** on a call to pass it. **Overall
PASS** = passes every call we tested it on. Price = OpenRouter $/Mtok (input / output);
"per call" = observed cost on the ~5–6k-token task prompts in these spikes.

| Model | recommend | brief | recap | **Overall** | Price (in / out) | ~/call | Note |
|-------|:--:|:--:|:--:|:--:|---|--:|------|
| **GPT-5.4-Mini** ⭐ | ✅ | ✅ | ✅ | **PASS** | $0.75 / $4.50 | ~$0.005–0.015 | **new default** — only cheap model to pass all three |
| Claude Opus 4.8 | ✅¹ | ✅ | ✅ | PASS | $5 / $25 | ~$0.08–0.11 | reference; safe but ~6–15× costlier |
| Claude Sonnet 4.6 | ✅ | —² | —² | safe | $3 / $15 | ~$0.03–0.05 | recommend-validated; kept as safe fallback |
| Gemini 3.5 Flash | ✅ | ✅ | ❌ 0/3 | **FAIL** | $1.50 / $9 | ~$0.03–0.10 | thinks out loud before recap JSON → empty recap |
| Claude Haiku 4.5 | ❌ 0/3 | ✅ | ⚠️ 2/3 | **FAIL** | $1 / $5 | ~$0.01–0.04 | prior default; mis-reads dense tickets |
| DeepSeek V4-Flash | ❌ 1/3 | —² | —² | **FAIL** | $0.10 / $0.20 | ~$0.001–0.003 | cheapest, but shares the dense-leaf cliff |
| Qwen3.7-Plus | ❌ | —² | —² | **FAIL** | $0.40 / $1.60 | ~$0.006 | unparseable action line + 40–90s latency |

¹ Opus passed recommend but on the node case deferred to a *done* child once (K=1 noise) —
the cheap models picked the correct child. ² not tested on this call (eliminated earlier,
or kept only as a by-size-safe fallback).

> **Bottom line:** For the per-task LLM calls (recommend, brief, recap), **Opus is not
> necessary.** GPT-5.4-Mini is the only cheap model that passes all three; it is now the
> `DEFAULT_MODEL`, and the settings dropdown is curated to it + two safe higher-cost
> fallbacks (Sonnet 4.6, Opus 4.8). Haiku (prior default), Gemini 3.5 Flash, and
> DeepSeek V4-Flash each fail at least one call and were dropped from the list.
> Still untested: the roadmap narrative pipeline (separate multi-call path).

## Scope of what we actually tested

| Dimension | Covered | NOT covered |
|---|---|---|
| **Endpoint** | The **AI-generated next-prompt** only — `getRecommendation()` / `GET /api/proxy/recommend` (the "AI Generated prompt" / meta-prompt generator) | `brief`, `recap`, roadmap narrative, audit, periodicals — every *other* LLM call |
| **Task shapes** | A complexity gradient of leaves (trivial→research-gold), a synthetic dense embedded-plan leaf, **a real epic as a NODE** (`LIN-177`, `defer` path), and **a real large dense leaf** (`LIN-344`). Synthetic `SYN-*` + real `LIN-325`/`LIN-177`/`LIN-344` | Very long comment threads beyond ~5 comments, the epic cousins/siblings context path |
| **Models** | 8 distinct, current (Opus 4.8 / Sonnet 4.6 / Haiku 4.5 / Gemini 3.5 Flash / Qwen3.7-Plus / DeepSeek V4-Flash / GPT-5.4-Mini, + spike-1's set) | Gemini Pro tier, GPT-5.5 frontier, the `:free` tier |
| **Rigour** | spikes 1–2 at K=1; **spike 3 at K=3** on the hard cases. temp 0, routing auto-scored + manual body reads, Opus-as-reference | blind LLM judge, body-quality scoring at scale |

**Read everything below as directional (single-sample), high-signal but not yet decisive.**

## What we checked, and what we learned

### Endpoint checked: the AI-generated next-prompt (the meta-prompt generator)

This is the one the ticket names ("if we need a large model to *generate* our prompts").
Two spikes:

- **Spike 1** (one task, `LIN-325` research-gold, 6 models): all 6 routed `research`
  correctly; **Haiku matched Opus closely** at 0.14× cost; cheap non-Anthropic models
  were correct but lossier (Gemini Flash compressed; GPT-mini/DeepSeek leaked meta-prompt
  scaffolding into their output).
- **Spike 2** (6-task complexity gradient × 7 refreshed models): surfaced **a real,
  Haiku-specific cliff** — on a dense ticket that *embeds* a plan + multi-session scope
  (`SYN-12`), Haiku under-read the input (claimed "no plan exists" when the plan was
  right there) and over-fired to `research`, while Opus, Sonnet, Gemini 3.5 Flash,
  DeepSeek V4-Flash, and GPT-5.4-Mini all routed `breakdown` correctly.

### The five things we learned

1. **For next-prompt generation, frontier quality is not required on the tasks tested.**
   Multiple cheap models matched Opus 4.8's routing 5/5 (excluding one ambiguous case
   where Opus itself disagreed with the gold label).
2. **The risk is model-specific, not a clean price axis.** Haiku has a **context-fidelity
   cliff under input density** — it stops registering structured content already in the
   ticket and defaults to "go research." Newer, *cheaper* models (DeepSeek V4-Flash at
   78× less than Opus, GPT-5.4-Mini) did **not** share this failure.
3. **Best cheap candidates: GPT-5.4-Mini and Gemini 3.5 Flash** — both 6/6 routing.
   GPT-5.4-Mini is the efficiency standout: **$0.03 for the whole 6-task sweep, ~4–5s/call**
   (4× faster than the rest).
4. **Newest ≠ best fit.** Qwen3.7-Plus (newest model on the platform) was the worst
   operational fit: it failed to emit a parseable action line on trivial tasks and ran
   40–90s/call.
5. **The codebase model list was stale** — `AVAILABLE_MODELS` referenced opus-4.7,
   gemini-3-flash-preview, deepseek-v3.2. **Refreshed** it to current IDs (opus-4.8,
   gemini-3.5-flash / 3.1-flash-lite / 3.1-pro, gpt-5.4-mini / gpt-5.5, deepseek-v4-flash
   / v4-pro, kimi-k2.6:free), verified live against the OpenRouter `/models` API.

## Is Opus necessary? Can we recommend a cheap model for the meta-prompt generator?

**No, Opus is not necessary for the next-prompt generator — and yes, we can recommend a
fast, cheap model. The K=3 confirmation (spike 3) settled it.** GPT-5.4-Mini matched or
beat Opus 4.8 across synthetic, **real** (`LIN-344`), node/`defer` (`LIN-177`), and the
dense-leaf cliff case, at ~1/6 the cost and several× the speed.

- **The "real large task" answer is now tested, not assumed.** We ran a real 6-child epic
  through the **node/`defer` path** (the most complex meta-prompt, 6.5k words) and a real
  7.4k-char dense leaf. Cheap models handled both — and on the node case *every* cheap
  model picked the correct next child (`LIN-334`) while Opus's single run deferred to a
  *done* child (`LIN-332`). The hardest *path* (node) turned out to be the *easy* case for
  all models.
- **The real failure axis is dense-leaf reading, not size/complexity.** The one place
  cheap models split is a leaf whose body already contains a structured plan: **Haiku
  failed it 3/3, DeepSeek-V4-Flash 2/3**, while **GPT-5.4-Mini and Gemini 3.5 Flash were
  3/3**. So "it works on the most complex (node) case, therefore it's fine" is **not** a
  safe inference — the node case is the easy one.
- **The pick: GPT-5.4-Mini.** Robust everywhere, cheapest-fast. It was then confirmed on
  the *other* per-task calls too (spike 4): **brief 3/3, recap 3/3** — the only non-Opus
  model to pass recap. **Avoid Haiku, DeepSeek-V4-Flash, and Gemini 3.5 Flash as the
  default**: Haiku/DeepSeek fail the dense-leaf route, Gemini fails recap (chain-of-thought
  before the JSON → empty parse).
- **Scope limit:** verdict covers the **per-task calls** (recommend, brief, recap). The
  roadmap narrative pipeline (separate multi-call path) is **untested**.

## The operational gate — resolved

The workspace model is a **single global dial** (the settings UI: *"used for all LLM calls
in this workspace, including agent/proxy traffic"*). Because GPT-5.4-Mini passed all three
per-task calls, the global flip is safe without a per-endpoint override — so we took the
simpler path:

- **`DEFAULT_MODEL` → `openai/gpt-5.4-mini`** (was Haiku 4.5). The `e2e/workspace-model`
  default-fallback assertion was updated to match; unit suite green (1246).
- **`AVAILABLE_MODELS` curated to 3:** GPT-5.4-Mini (default) + Sonnet 4.6 + Opus 4.8 (safe
  higher-cost fallbacks). Haiku, Gemini 3.5 Flash, DeepSeek V4-Flash, and the rest were
  dropped because each fails a call. The free-text custom-model input remains for power users.

## Done / remaining

1. ✅ Refreshed `AVAILABLE_MODELS` to live OpenRouter IDs, then **curated** to validated +
   safe-by-size.
2. ✅ K=3 confirmation on hard/real cases — GPT-5.4-Mini validated for recommend.
3. ✅ Validated `brief` + `recap` (spike 4) — GPT-5.4-Mini passes both; Gemini disqualified.
4. ✅ Flipped `DEFAULT_MODEL` to GPT-5.4-Mini (global dial; safe because all per-task calls pass).
5. ▶ **Remaining:** spot-check the **roadmap narrative pipeline** under the new default
   before considering it fully covered. Build a scored LLM-judge harness only if the cheap
   tier ever gets too close to separate by eye — not needed so far; manual reads were decisive.
