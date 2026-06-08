# LIN-263 — Model benchmark for the "AI Generated" next-prompt: research + plan

Research notes and the recommended approach for a **small, cost-conscious first
benchmark** of the AI-generated next-prompt endpoint across a range of models.
This is the research deliverable for LIN-263 — **not** the implementation.

Re-grounded against HEAD (post the Jun 8 comment), not the original ticket prose:
the original `/benchmarking` folder proposal is superseded — eval/benchmark infra
already exists under `scripts/eval*`, and the task is now the narrow model-sweep
described in the Jun 8 comment.

---

## 1. Existing eval infrastructure (what's actually at HEAD)

All eval harnesses are standalone `scripts/eval*.mjs` scripts that call OpenRouter
**directly** (`fetch('https://openrouter.ai/api/v1/chat/completions')`, `OPENROUTER_API_KEY`
env, `temperature`, `max_tokens`, 4×-backoff retry). None are wired into `lib/`.

| File | Evaluates | Judge | Reusable here |
|------|-----------|-------|---------------|
| `scripts/eval-research-routing.mjs` | The **routing decision** (`→ **action**`) from a txt snapshot of the meta-prompt. Single `GEN_MODEL`/run. | Deterministic (parses the action line — no judge) | Case corpus w/ known-correct actions; the `call()`+backoff helper |
| `scripts/eval-prompt-scaling.mjs` | Prompt **length / lane / inflation** of the generated prompt. Rebuilds the **LIVE** meta-prompt from lib exports. Single `GEN_MODEL`/run. | LLM-judge, **constant** `JUDGE_MODEL` (default `anthropic/claude-haiku-4.5`), YES/NO rubric | **`buildMeta()`** (faithful live meta-prompt reconstruction) + **`judge()`** pattern — the two load-bearing pieces |
| `scripts/eval-completeness-check.mjs` | Handwritten plan-prompt directive | LLM-judge, constant model, YES/NO | `judge()` pattern |
| `scripts/eval/phase4-distillation-probe.mjs` | Upstream-distillation mechanism | LLM-judge | reference only |

**Answers to the specific questions:**

- **Invoke a prompt against an arbitrary model & capture output?** Yes — every script
  takes a `GEN_MODEL` env var and posts to OpenRouter. **One model per run**; a
  multi-model sweep is a `for`-loop the scripts don't have yet (trivial, additive).
- **Capture latency & cost?** **No — this is the one real gap.** `grep` across
  `scripts/` for `Date.now`/`usage.cost`/`prompt_tokens`/`latency` finds nothing
  (only prose). The live `getRecommendation` reads `data.usage.completion_tokens`
  but not `prompt_tokens` and never times the call; the eval scripts ignore `usage`
  entirely. Quality is measured; **price and speed are not recorded anywhere.**
- **LLM-as-judge harness?** Yes, but only **absolute rubric YES/NO on a constant
  judge model**. There is **no pairwise / "review outputs against each other"**
  judge (the original ticket's no-fixed-baseline idea). That's a thin new wrapper.
- **How results are recorded?** **Manually** — console output hand-transcribed into
  markdown like `scripts/eval/lin-260-results.md` (records generator, judge, K,
  date-prose, the table). No JSON sidecar, no automated timestamping, no git-SHA stamp.

## 2. Target endpoint (the unit under test)

`getRecommendation(issue, context, options)` in **`lib/openrouter.js`** (and its SSE
twin `getRecommendationStream`); exposed as `GET /api/proxy/recommend/{id}`.

- **Inputs:** `issue` + `context` (`project`, `parent`, `siblings`, `children`,
  `comments`, `cousins`, `focusedChild`, `featureFlags`) → `buildMetaPrompt()` →
  `buildMetaPromptTemplate()` (the ~5k-token meta-prompt).
- **Output:** `{ reasoning, prompt, truncated, recommendedAction, deferTo, completionTokens }`.
  The **`prompt`** field (the body under `## Prompt`) is the artifact being judged.
- **Model is already a parameter:** `options.model`, default `DEFAULT_MODEL =
  'anthropic/claude-haiku-4.5'`. **Fully separable** — no Opus-only coupling to undo.
  - *Staleness note:* the ticket says "we just use Opus for everything." The code
    **default** is Haiku 4.5; Opus is the operator's per-session/settings choice, not
    a hardcode. Doesn't change the task, but worth recording.

`scripts/eval-prompt-scaling.mjs` already reconstructs this exact live meta-prompt
offline (`buildMeta(issue, context)`), so the benchmark can drive the real endpoint
shape with zero lib changes.

## 3. Candidate tasks (known "next" step)

Reuse the **synthetic fixtures already embedded in the eval scripts** — they encode a
known-correct next action, are leaf-shaped exactly as the proxy sends, and (unlike live
Linear tickets) **don't drift**, which is what makes the benchmark repeatable. Proposed 3,
one per dominant route:

1. **`implement` —** `SYN-9` "reject dispatch prompts longer than 50k chars" (single
   surface, mirror an existing validation). Known next: a tight implement prompt.
2. **`plan` —** `SYN-5` "add pagination to the issues list (API + UI)" (multi-surface,
   no plan yet). Known next: a plan prompt that names both surfaces.
3. **`research` —** `LIN-325` verbatim "write the autopilot operating manual" (the gold
   case in the routing eval — substance must be gathered first). Known next: a research prompt.

These give judgeable, agreed-upon "right answers" without inventing new fixtures. (A
real Linear task can be swapped in later for the follow-up pass.)

## 4. Model shortlist (reachable via OpenRouter)

Drawn from identifiers the codebase **already references** (`AVAILABLE_MODELS` in
`lib/openrouter.js` + eval defaults) — not invented. Reachability via OpenRouter should
be confirmed with a 1-token ping at run time (IDs float). Cost-conscious first pass = **6 models**:

| Model id | Bucket |
|----------|--------|
| `anthropic/claude-haiku-4.5` | Anthropic (cheap) |
| `anthropic/claude-sonnet-4.6` | Anthropic (mid) |
| `anthropic/claude-opus-4.7` | Anthropic (frontier — the incumbent / reference) |
| `google/gemini-3-flash-preview` | Google (latest, cheap) |
| `openai/gpt-5.4-mini` | popular + cheap |
| `deepseek/deepseek-v3.2` | popular + cheap (best-value frontier) |

Held back for pass 2 (keep pass 1 small): a second Google tier (e.g. a Gemini 3 Pro
if reachable), `qwen/qwen3-coder:free`, `deepseek/deepseek-r1:free`.

## 5. Scoring approach (quality is the judged axis; price + speed are metadata)

The deliverable is a table of **quality, price, speed**.

- **Quality —** reuse the existing `judge()` pattern with a **constant Anthropic judge**
  (recommend `anthropic/claude-sonnet-4.6` as judge so the judge ≠ most of the contestants;
  Opus-as-judge is an option but pricier). Two viable framings:
  - **(Recommended) Opus-as-reference, relative judgment.** "We know Opus works." For each
    task, judge each model's prompt against the **Opus output for the same task** —
    *"is this as complete/actionable as the reference? better / equal / worse?"* This
    directly answers the ticket's question ("where's the limit below Opus?") and is cheaper
    than full round-robin. The constant judge removes the self-preference confound.
  - *Alt:* absolute rubric (names the surface / states the change / asks for verification —
    the `QUALITY_RUBRIC` already in `eval-prompt-scaling.mjs`), scored 0–3. Use if a
    fixed reference feels too anchoring. Round-robin pairwise is **out of scope for pass 1** (N²).
- **Price —** read `usage.prompt_tokens` + `completion_tokens` from each OpenRouter
  response and multiply by a small per-model price table (or request
  `usage:{include:true}` and read OpenRouter's reported `cost`). **New code** — nothing
  records this today.
- **Speed —** wall-clock `Date.now()` around the (non-streaming) generation call;
  optionally also time-to-first-token if streaming. **New code.**

## 6. Cost ceiling for the first pass

**3 tasks × 6 models × K=2 runs = 36 generation calls**, plus 36 judge calls.
Per generation: ~5k-token input, ~0.6–1.5k-token output. Only the 2 Opus runs/task
(~6 calls) are expensive (~$0.15 each); the rest are cents or free. Judge calls on a
mid Anthropic model are ~2k-token input / few-token output (sub-$0.10 total).

**Budget the first pass at < $3 (realistically ~$1–2).** Commit to it explicitly;
start with `ONLY=`/`K=1` on one task to smoke-test wiring before the full 36.

## 7. Repeatability (the "useful in future" requirement)

For a later re-run to be comparable, record/fix: **(a)** frozen fixtures (the SYN/LIN
cases in code, not live Linear); **(b)** `temperature: 0` + `K≥2` to average residual
non-determinism; **(c)** exact model ids **+ run date** (OpenRouter aliases float);
**(d)** a snapshot of the meta-prompt used (regenerate from lib at run time, since the
live prompt changes — same discipline as `regen-baseline.mjs`); **(e)** the judge model
id + rubric text; **(f)** git SHA + timestamp. Persist a **JSON sidecar** next to the
human-readable results md (today's recording is markdown-only) so a diff between runs is mechanical.

---

## Recommended approach (one-paragraph summary)

Add a standalone `scripts/eval-model-benchmark.mjs` (following the established
`scripts/eval-*.mjs` pattern) that reuses `eval-prompt-scaling.mjs`'s live-meta-prompt
reconstruction (`buildMeta`), loops the 3 fixtures × 6-model shortlist at `K=2,
temperature=0`, **times each call and reads `usage` for tokens→cost**, judges quality
with a constant Anthropic judge using **Opus-as-reference relative scoring**, and emits
both a markdown table (quality/price/speed) and a JSON sidecar stamped with model ids,
judge id, git SHA, and timestamp. Budget < $3. **Iteration loop:** if cheap models
(Haiku/Flash/mini/DeepSeek) score at-reference on all three tasks, expand to pass 2
(more tasks + the held-back models, then other endpoints — `brief`, etc.); if they fall
over, narrow to find the cheapest tier that still matches Opus per route.

## Surface Assessment

**Surface Assessment: yes, implementation can land cleanly.** No preparatory refactor is
required. The target endpoint is already model-parameterized (`options.model`, default
Haiku — not Opus-coupled); the live meta-prompt is already reproducible offline
(`buildMeta` in `eval-prompt-scaling.mjs`); and the LLM-judge pattern already exists and
is copy-pasteable. The benchmark is a **net-new standalone script**, so the only new
work — a model-sweep loop, latency timing, token→cost capture, and a relative/pairwise
judge wrapper — is additive code inside that new script, **not** a change to any shared
harness or to `lib/`. (The one genuine gap, that no existing harness records price or
speed, is part of this benchmark's own implementation, not a blocking change elsewhere.)
