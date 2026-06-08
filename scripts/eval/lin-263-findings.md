# LIN-263 — Model benchmark: consolidated findings (so far)

Rolls up the planning note + two manual spikes into one place. Total spend across all
runs: **~$1.32**. Detail lives in `lin-263-model-benchmark-plan.md`,
`lin-263-spike-results.md`, and `lin-263-spike2-results.md`; this is the synthesis.

## Scope of what we actually tested

| Dimension | Covered | NOT covered |
|---|---|---|
| **Endpoint** | The **AI-generated next-prompt** only — `getRecommendation()` / `GET /api/proxy/recommend` (the "AI Generated prompt" / meta-prompt generator) | `brief`, `recap`, roadmap narrative, audit, periodicals — every *other* LLM call |
| **Task shapes** | Leaf tickets across a complexity gradient: trivial→simple→medium→inflation-trap→multi-session→research-gold. Mostly synthetic `SYN-*` fixtures + one **real** dense ticket (`LIN-325`) | **Node/epic shapes** (parent + focusedChild → `defer` routing), very long comment threads, the epic cousins/siblings context path |
| **Models** | 8 distinct, current (Opus 4.8 / Sonnet 4.6 / Haiku 4.5 / Gemini 3.5 Flash / Qwen3.7-Plus / DeepSeek V4-Flash / GPT-5.4-Mini, + spike-1's set) | Gemini Pro tier, GPT-5.5 frontier, the `:free` tier |
| **Rigour** | K=1, temp 0, routing auto-scored + manual body reads, Opus-as-reference | K≥3 repeats, blind LLM judge, body-quality scoring |

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

**For the next-prompt generator, on everything we've tested: no, Opus is not necessary —
and yes, we can recommend a fast, cheap model — with one caveat and one confirmation step.**

- **The honest "real large task" answer:** the most realistic case we ran (`LIN-325`, a
  genuine dense in-progress ticket) was handled well by cheap models. But we have **not**
  yet stress-tested the *hardest real shapes* — epic/`defer` node routing and very long
  comment threads — where density is highest and where Haiku's cliff suggests cheap
  models are most at risk. So we can recommend a cheap default **for this endpoint** with
  confidence on leaf tasks, and should confirm on a couple of node/epic cases before
  calling it system-wide.
- **The caveat:** **don't pick Haiku** as the cheap default despite its Anthropic
  pedigree — it's the one cheap model with a reproducible density cliff. Pick
  **GPT-5.4-Mini** (front-runner: 6/6, cheapest-fast) or **Gemini 3.5 Flash**.
- **Scope limit:** this verdict covers the **next-prompt generator only**. `brief`,
  `recap`, and the roadmap narratives are **untested** — each is a follow-up (the ticket
  anticipated this). Don't generalize "cheap is fine" to them yet.

## Recommended next steps (cost-conscious)

1. **(done) Refresh `AVAILABLE_MODELS`** — landed in this branch.
2. **Confirmation pass (~$1):** 2–3 more *dense / real* tickets (incl. one epic/`defer`
   node shape) at **K=3**, scoring GPT-5.4-Mini · Gemini 3.5 Flash · DeepSeek V4-Flash ·
   Haiku 4.5 against Opus 4.8. If the non-Haiku cheap models hold, **propose flipping the
   operator default for the recommend endpoint to GPT-5.4-Mini** (and reconsider whether
   `DEFAULT_MODEL` Haiku is the right cheap floor given its cliff).
3. **Then, and only then, widen:** repeat the same lean spike on `brief` and `recap`.
4. **Build a scored harness only if** the cheap tier gets close enough that eyeballing
   can't separate candidates — that's the point where an LLM judge + price table earns
   its cost. We are not there yet; manual reads are still decisive.
