# LIN-263 — Model benchmark: consolidated findings (so far)

Rolls up the planning note + three manual spikes into one place. Total spend across all
runs: **~$2.09**. Detail lives in `lin-263-model-benchmark-plan.md`,
`lin-263-spike-results.md`, `lin-263-spike2-results.md`, and `lin-263-spike3-results.md`;
this is the synthesis.

> **Bottom line (updated after the K=3 confirmation):** For the next-prompt generator,
> Opus is **not** necessary. **GPT-5.4-Mini** matched or beat Opus 4.8 across synthetic,
> real, node/`defer`, and dense-leaf cases at K=3, at ~1/6 the cost and several× the
> speed. Do **not** default to Haiku or DeepSeek-V4-Flash — both repeatably fail the
> dense-embedded-plan leaf. The one remaining gate is operational: the workspace model is
> a single global dial (covers `brief`/`recap` too), so flip the recommend default only
> after validating those or adding a per-endpoint override.

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
- **The pick: GPT-5.4-Mini.** Robust everywhere, cheapest-fast. **Gemini 3.5 Flash** is
  the robust backup (pricier — it's $1.50/$9 — and slower). **Avoid Haiku and
  DeepSeek-V4-Flash as the default** despite their price: both repeatably fail the
  dense-leaf case.
- **Scope limit:** verdict covers the **next-prompt generator only**. `brief`, `recap`,
  roadmap narratives are **untested**.

## The one remaining gate is operational, not quality

The settings UI states the workspace model *"is used for all LLM calls in this workspace,
including agent/proxy traffic"* — it's a **single global dial**, not per-endpoint. So a
default flip to GPT-5.4-Mini would also move `brief`/`recap`/roadmap, which we haven't
benchmarked. Two clean ways forward:

- **(a)** Validate `brief` + `recap` on cheap models first (same lean spike), then flip
  the global workspace default; **or**
- **(b)** Add a small per-endpoint model override (the recommend path already accepts
  `options.model` — the seam exists) and flip just the recommend endpoint now.

## Recommended next steps (cost-conscious)

1. **(done) Refresh `AVAILABLE_MODELS`** — landed in this branch (11 current models,
   verified live; settings dropdown re-rendered and confirmed).
2. **(done) K=3 confirmation** — GPT-5.4-Mini validated as the recommend-endpoint pick.
3. **Decide the flip mechanism** — global default (needs step 4 first) vs per-endpoint
   override (ship now). Recommend **(b)** for the recommend endpoint: lowest blast radius.
4. **Widen to `brief` + `recap`** with the same lean spike before any *global* default
   change.
5. **Build a scored harness only if** the cheap tier ever gets too close to separate by
   eye. We are not there — manual reads were decisive throughout.
