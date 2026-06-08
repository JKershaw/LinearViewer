# LIN-263 — spike 5: GPT-5.4-Mini reliability vs context size (negative result)

> **Follow-up: LIN-355** — because this synthetic eval could not reproduce the live
> failure, the hunt for mini's real limits moves to **real, large tasks from other
> projects** (Simple Dispatcher / DevOps & Tooling / General) + prod instrumentation.
> This doc is the "what we ruled out" baseline for that ticket.

Field report (John): GPT-5.4-Mini occasionally returns **malformed or incomplete**
recommendations on large-ish contexts; a rerun fixes it. This set of spikes tried to
reproduce that as a reliability-vs-size curve, scoring each run with the **real production
parser** (`parseRecommendationResponse`) and tallying the failure mode.

## Runs

| Spike | Path | Content | Sizes | K | Models | Result |
|-------|------|---------|-------|---|--------|--------|
| 5  | buffered | clean prose | 0–40 comments | 5 | mini, gpt-5.5, opus-4.8 | **0 failures** |
| 5b | buffered | messy (code/JSON/tables + **pasted prior prompts** with `## Reasoning`/`## Prompt`/`→ **action**` markers) | 40–120 comments (~14k tok) | 10 | mini, gpt-5.5 | **0 failures** |
| 5c | **streaming** (`getRecommendationStream`, the UI path) | messy | 20–120 comments | 8 | mini | **0 failures** (streamed deltas reconstruct exactly to the structured prompt) |

**~79 mini runs, zero malformed/incomplete**, in both the buffered and streaming parsers,
up to ~14k input tokens. The simple hypothesis — "large/messy context breaks mini" — is
**not supported** by what we could synthesize.

Secondary findings:
- **GPT-5.5 (the non-mini) was also 100% reliable** — but ~6× the cost and ~5× slower
  (mini ~9s vs gpt-5.5 ~45–58s at these sizes). Good as an escalation/retry target, poor
  as a blanket default.
- Opus 4.8: 100% reliable (reference).
- Cost/latency scale gently with context for mini (40c≈$0.04/9s; 120c≈$0.15/10s).

## Interpretation (corrected)

This eval measured the WRONG axis. **Field reality (per John): the failing calls were
*fast, but wrong*** — well-formed output with incorrect content. That rules out
timeout/truncation/transport entirely.

The flaw: spike 5's pass/fail gate only checked **format validity** (parseable + has an
action line + non-empty prompt + not `finish_reason: length`). **A confidently-wrong but
well-formed recommendation passes that gate.** So "~79 runs, 0 failures" never tested
*correctness* — and it used synthetic, not real, context. Both gaps are why the failure
didn't show here.

What this baseline DID establish (still useful): mini holds format/completeness robustly
to ~14k synthetic tokens in both parsers, and GPT-5.5/Opus are 100% reliable on format
too. The open question — *is the content correct on real large tasks?* — moves to
**LIN-355**, which judges correctness (against a reference) on real ticket context, not
formatting on synthetic context.

## Next (→ LIN-355)

The right test judges **correctness on real large tasks**, not format on synthetic ones:

1. Run mini on real large ticket contexts and **judge the content** (right action?
   grounded, complete prompt? key constraints kept?) against an Opus/GPT-5.5 reference —
   the axis this spike skipped.
2. **Instrument prod**: capture the meta-prompt + output + model for real recommendations
   so we can inspect the actual large-context inputs that produced wrong output.
3. Likely fix to validate: **escalate to a stronger model for large/complex tasks**
   (threshold or retry-on-low-confidence), not a global default change.

Harnesses (`lin-263-spike5{,b,c}.mjs`) are parameterized (`SIZES`, `K`, `CONTENT`,
`MODELS`) and re-usable — but a correctness judge + real-task corpus must be added (LIN-355).
