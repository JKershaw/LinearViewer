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

## Interpretation (honest)

The failure is real but our offline harness doesn't trigger it. The trigger is therefore
something these fixtures don't capture. Prime untested suspects:

1. **Transport / timeout truncation.** Production runs through Heroku; the recommend
   endpoint has a documented H12/H15 timeout history. A slow call on a huge real epic cut
   mid-stream looks exactly like "incomplete," and a faster rerun completing matches
   "rerun fixes it." This is the leading hypothesis.
2. **Real-content shapes** we didn't model: images/attachments, very long single comments,
   the full epic/node context (siblings/cousins/children at scale), or the appended
   proxy-context block.
3. **Sub-1% nondeterminism** — below what ~79 runs can detect.

## Recommendation (make it reliable without pinning the exact trigger first)

1. **Retry-on-parse-failure** in `getRecommendation` / `getRecommendationStream`: if the
   parse throws or `finish_reason === 'length'`, retry once — optionally **escalating** to
   GPT-5.5 or Opus 4.8 on the retry. This operationalizes "a rerun fixes it" and is the
   cheapest durable win. (Both parsers already expose the failure cleanly.)
2. **Instrument real failures**: when a recommendation fails to parse or truncates in
   prod, log the meta-prompt + raw output + `finish_reason` + token counts + model. One
   week of *real* failing inputs will pin the trigger faster than more synthetic spikes.

Harnesses (`lin-263-spike5{,b,c}.mjs`) are parameterized (`SIZES`, `K`, `CONTENT`,
`MODELS`) so this is re-runnable once we have a real failing case to seed from.
