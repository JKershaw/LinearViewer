# LIN-263 — spike 2: complexity gradient × refreshed models (the Haiku cliff)

Run of `scripts/eval/lin-263-spike2.mjs`. Hunts the *"Haiku is fine until complexity X,
then falls off"* cliff. 6 tasks ordered by ascending complexity × 7 models, K=1, temp 0.
Routing decision auto-scored against the known-correct action (a cheap, strong cliff
proxy); latency + OpenRouter cost machine-captured; bodies dumped to `lin-263-spike2-out/`
for the manual read. Spend: **~$1.13** (spike 1 + 2 together ≈ $1.32).

## 0. Model research (answering "did you check the latest/best?")

I had **not** — spike 1 reused the stale `AVAILABLE_MODELS` list in `lib/openrouter.js`.
Queried the live OpenRouter `/models` API (340 models). Corrections, as of 2026-06-08:

| Codebase list (stale) | Current latest | Note |
|---|---|---|
| `claude-opus-4.7` ($5/$25) | **`claude-opus-4.8`** ($5/$25, May 27) | Same price, newer → re-baselined the reference on 4.8 |
| — Sonnet/Haiku | `claude-sonnet-4.6` ($3/$15), `claude-haiku-4.5` ($1/$5) | Still the latest of their tier (no newer exists) |
| `gemini-3-flash-preview` ($0.50/$3) | **`gemini-3.5-flash`** ($1.50/$9), **`gemini-3.1-flash-lite`** ($0.25/$1.50) | Pro tier = `gemini-3.1-pro-preview` ($2/$12) |
| `deepseek-v3.2` | **`deepseek-v4-flash`** ($0.10/$0.20!), `deepseek-v4-pro` ($0.43/$0.87) | V4-Flash is the cheap-frontier shock |
| `gpt-5.4-mini` ($0.75/$4.50) | `gpt-5.5` family also out; `gpt-5.4-nano` ($0.20/$1.25) | kept mini for continuity |
| `qwen3-coder` | **`qwen3.7-plus`** ($0.40/$1.60, Jun 3) | newest model on the platform |

**`lib/openrouter.js` `AVAILABLE_MODELS` should be refreshed** (separate small change).

Spike-2 model set: `opus-4.8` (ref), `sonnet-4.6`, `haiku-4.5`, `gemini-3.5-flash`,
`qwen3.7-plus`, `deepseek-v4-flash`, `gpt-5.4-mini`.

## 1. The routing grid (the cliff view)

✓ = correct route, ✗ = wrong:

| Complexity | opus-4.8 | sonnet-4.6 | haiku-4.5 | gemini-3.5-flash | qwen3.7-plus | deepseek-v4-flash | gpt-5.4-mini |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 1 trivial (→implement) | ✓ | ✓ | ✓ | ✓ | ✗ none | ✓ | ✓ |
| 2 simple (→implement/plan) | ✓ | ✓ | ✓ | ✓ | ✗ none | ✓ | ✓ |
| 3 medium *(→plan, ambiguous)* | ✗ research | ✓ | ✗ research | ✓ | ✓ | ✗ research | ✓ |
| 4 inflation-trap (→impl/plan) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **5 multi-session (→breakdown)** | ✓ | ✓ | **✗ research** | ✓ | ✓ | ✓ | ✓ |
| 6 research-gold (→research) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

## 2. The cliff is real, it's Haiku's, and it's mechanistic

**Task 5 (`SYN-12`, migrate MangoDB→MongoDB) is the clean discriminator** — its description
*literally contains* `## Plan`, enumerated surfaces, dependency arrows, and `## Scope:
Needs multiple sessions`. The correct route is unambiguous (`breakdown`). **Only Haiku
missed it** — and the reasoning shows *why*:

- **Haiku** wrote: *"No implementation plan exists… no dependency arrows documented…"* —
  **both factually false**; that content is right there in the ticket. It under-read the
  dense ticket and over-fired to `research`.
- **DeepSeek-V4-Flash ($0.0015/call)** read the same ticket correctly: *"the ticket
  already contains a plan with enumerated surfaces and explicit dependency arrows…
  commits to 'Needs multiple sessions'"* → `breakdown`. Perfect.

**The cliff is a context-fidelity failure under density**, not raw task difficulty:
when a ticket carries structured signal (an embedded plan, multi-surface scope), Haiku
stops registering what's already given and defaults to "go gather more." That matches
John's field observation exactly — Haiku is fine on thin/terminal tasks and falls off
when the *input* gets dense, regardless of the headline task size.

## 3. The other findings

- **It's not a simple cheap=bad axis.** Excluding the ambiguous task 3 (see caveats),
  `deepseek-v4-flash`, `gpt-5.4-mini`, `gemini-3.5-flash`, and `sonnet-4.6` all matched
  Opus **5/5 on routing** — including the multi-session breakdown Haiku flubbed. Several
  *newer, cheaper* models out-read Haiku.
- **gpt-5.4-mini is the efficiency standout:** 6/6 routing, **$0.03 total, 28s total**
  (~4–5s/call, 4× faster than anything else).
- **deepseek-v4-flash is the value shock:** 5/5 (ex-task-3) at **$0.0067 total — 78×
  cheaper than Opus** — and it caught the Haiku-cliff case.
- **Newest ≠ best fit: `qwen3.7-plus` was the worst operational fit** — emitted no
  parseable `→ **action**` line on the two trivial tasks (prompt-format-robustness
  failure) and was painfully slow (40–90s/call, 350s total).

### Per-model totals (all 6 tasks)

| Model | route hits | total $ | total latency |
|---|:--:|--:|--:|
| opus-4.8 *(ref)* | 5/6 | $0.5233 | 150s |
| sonnet-4.6 | 6/6 | $0.2225 | 195s |
| haiku-4.5 | 4/6 | $0.0819 | 105s |
| gemini-3.5-flash | 6/6 | $0.2160 | 93s |
| qwen3.7-plus | 4/6 | $0.0427 | 351s |
| deepseek-v4-flash | 5/6 | **$0.0067** | 138s |
| gpt-5.4-mini | 6/6 | **$0.0325** | **28s** |

## 4. Honest caveats

- **Task 3 (`SYN-5` pagination) is a weak discriminator** — its gold label is `plan`,
  but **Opus itself routed `research`** (so did Haiku + DeepSeek). When the reference
  model disagrees with the label, the label is contestable (research is a defensible
  read of "add pagination"). I excluded it from the clean-cliff count rather than score
  it against everyone. The clean cliff stands on task 5 alone, where the label is solid.
- **n=1 task per complexity level, K=1, one human judge.** Directional. The mechanism
  (context-fidelity under density) is a hypothesis from one vivid reasoning trace — worth
  confirming with a few more dense-ticket cases at K≥3.
- Routing is a *proxy* for quality. I read the bodies on the hard cells; the models that
  routed correctly also produced reasonable bodies, but body quality wasn't scored.

## 5. What this changes for the recommendation

The operator question was framed as "Opus vs Haiku." The data reframes it:

1. **Don't default to Haiku.** It has a specific, reproducible weakness — under-reading
   dense tickets and over-firing to `research` — that newer cheap models don't share.
2. **Best cheap-default candidates: `gpt-5.4-mini` or `gemini-3.5-flash`** (6/6 routing,
   fast, cheap). `gpt-5.4-mini` is the front-runner: 6/6, $0.03, 4–5s/call.
3. **`deepseek-v4-flash` is worth a serious look** as the value floor (5/5 ex-task-3 at
   78× cheaper than Opus), pending a prompt-format-robustness check across more cases.
4. **Skip `qwen3.7-plus`** for this harness until the format/latency issues resolve.
5. **Next cheap iteration (~$1):** confirm the density-cliff mechanism with 2–3 more
   *dense* tickets (embedded plans / multi-surface) at K=3, scoring `gpt-5.4-mini`,
   `gemini-3.5-flash`, `deepseek-v4-flash`, `haiku-4.5` against `opus-4.8`. If the
   non-Haiku cheap models hold, propose flipping the operator default to `gpt-5.4-mini`
   (or `gemini-3.5-flash`) — *before* building any scored harness. Also: refresh
   `AVAILABLE_MODELS` in `lib/openrouter.js`.
