# LIN-263 — manual spike results (one task, Opus reference + cheaper models)

Run of `scripts/eval/lin-263-spike.mjs`. **Task:** LIN-325 "Write the autopilot
operating manual" — the routing-eval *research gold case* (substance must be gathered
from the track record, not just restructured; the most discriminating route). **K=1,
temperature 0.** Quality judged **manually** by reading each output against the Opus
reference — no LLM judge (that's the point of a spike). Raw outputs + per-model
metadata in `lin-263-spike-out/`. Total spend for the run: **~$0.19.**

## Speed + cost (machine-captured)

| Model | Latency | Cost (OpenRouter) | out tok | `## Prompt` words | vs Opus cost |
|-------|--------:|------------------:|--------:|------------------:|:------------:|
| `anthropic/claude-opus-4.7` *(ref)* | 46.8s | $0.1097 | 2625 | 978 | 1× |
| `anthropic/claude-sonnet-4.6` | 41.7s | $0.0443 | 1743 | 905 | 0.40× |
| `anthropic/claude-haiku-4.5` | 22.3s | $0.0154 | 1869 | 902 | **0.14×** |
| `google/gemini-3-flash-preview` | **5.6s** | **$0.0051** | 759 | 382 | **0.05×** |
| `openai/gpt-5.4-mini` | 6.3s | $0.0084 | 949 | 482 | 0.08× |
| `deepseek/deepseek-v3.2` | 14.5s | **$0.0036** | 919 | 415 | **0.03×** |

## Quality (manual read vs the Opus reference)

Dimensions that matter for *this* task: routes to **research**; prescribes the ticket's
research method (B1–B4 / drift docs / `retro` lens / named episodes); holds the
"specifics that matter" (human-shaped, altitude, tolerant, descriptive, reference-don't-inline);
stays in lane (directs research, doesn't pre-write the doc); keeps the staleness check
+ Surface Assessment; clean output.

| Model | Route | Research method | Holds the specifics | Lane | Clean output | Verdict |
|-------|:-----:|:---------------:|:-------------------:|:----:|:------------:|---------|
| Opus 4.7 *(ref)* | ✅ research | ✅ full | ✅ all 5 | ✅ | ✅ | Reference. Adds an explicit completeness-check / surface-search step + episode-inventory deliverables the others omit. |
| Sonnet 4.6 | ✅ research | ✅ full | ✅ | ✅ | ✅ | Near-reference (902–905w body, same family). |
| **Haiku 4.5** | ✅ research | ✅ full | ✅ | ✅ | ✅ | **Standout.** Full-fat body, near-Opus substance, 7× cheaper / 2× faster. |
| Gemini 3 Flash | ✅ research | ✅ | ◐ compressed | ◐ "Draft the Drift entry" leans toward doing the writing | ✅ | Core intact, 22× cheaper / 8× faster. Drops the surface-search step; slightly lane-leaky. |
| GPT-5.4 Mini | ✅ research | ✅ | ✅ | ✅ | ✗ leaked meta-prompt scaffolding (`use EXACTLY one action…`, stray `DeferTo:`) into Reasoning | Correct + complete, but cosmetically leaky. Parser-safe (prompt body is clean). |
| DeepSeek V3.2 | ✅ research | ✅ | ◐ drops doc-shape constraints | ✅ | ✗ same scaffold leak | Correct, cheapest of all, but thinnest on the held constraints. |

## What we learned

1. **Routing is unanimous and easy.** All six chose `research` with sound reasoning.
   Picking the *next action* on this task does not need a frontier model.
2. **Opus quality is not required here.** **Haiku 4.5 matches the Opus reference
   closely** (902 vs 978 words, all specifics held, clean) at **0.14× the cost and
   ~half the latency.** This is the ticket's hypothesis, supported on its hardest route.
3. **The cheap non-Anthropic models are correct but lossier.** Gemini Flash is
   astonishing on speed/price (5.6s / $0.005) with the core intact, but compresses out
   the surface-search step and leans slightly out of lane. GPT-mini and DeepSeek both
   **leak meta-prompt scaffolding into their Reasoning** — cosmetic and parser-safe
   here, but a real, reproducible quality differentiator (and a prompt-robustness signal).
4. **Quality didn't track price monotonically.** Haiku (mid-cheap, Anthropic) beat the
   cheaper non-Anthropic models on fidelity; the cheapest (DeepSeek) was thinnest. The
   interesting frontier is *provider/family*, not just $.

## Honest caveats

n=1 task, K=1, **one route** (research), and a single human (me) as judge — directional,
not decisive. The scaffold-leak finding especially wants confirmation across more cases.
But the headline is robust enough to act on: **for next-prompt generation on this task,
Haiku is a drop-in for Opus, and the question worth chasing is how far down the cheap
tier holds before substance drops.**

## Suggested next iteration (cheap)

- Re-run the same spike on the **`implement`** (`SYN-9`) and **`plan`** (`SYN-5`) routes —
  the two most common in practice — to see if Haiku still holds and whether the
  cheap-model scaffold-leak recurs. Still < $0.20 each.
- If Haiku holds across all three routes, that alone justifies flipping the operator
  default off Opus for these tasks — *before* building any scored harness.
- Only build the full harness (constant LLM judge, price table, JSON scorecard) if/when
  the cheap tier looks close enough that **eyeballing can't separate them** — that's the
  point where automated scoring earns its cost.
