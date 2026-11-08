---
title: Which model should each Harbour call run on, and which should the free tier run on?
kind: paper
version: 2
date: 2026-11-08
authors: [Claude, for John Kershaw]
revision: "Version 2 (LIN-4358 close-out, 8 Nov 2026) adds the Disposition section under The free tier (John's rulings of 12:41 and 12:54 UTC) and updates what the allowlist's comment says. No figure or recommendation changes."
model: frontier tier, a Claude Code subagent on LIN-4358; reads only, no model calls, no spend
grounded_at: 936f52b7d (LinearViewer, branch feat/lin-4358-catalog-models)
cites: [https://openrouter.ai/api/v1/models (461 models, read 2026-11-08 11:14 UTC), docs/papers/harbour/cheaper-capacity.md (2026-10-23), docs/papers/harbour/cheaper-capacity-benchmarks.csv (AA rows accessed 2026-10-23; Vals rows 2026-10-12 to 2026-10-22), docs/papers/harbour/model-choice.md, scripts/eval/lin-263-findings.md, scripts/eval/recommend-baseline/2026-10-01-dense-paid/calls.jsonl, docs/areas/llm-and-prompts.md (the Haiku 5.5 Waiting entry), lib/llm-jobs.js, lib/model-routing.js, lib/openrouter.js, lib/call-budget.js, lib/workspace-preferences.js, lib/agent-turn.js, lib/brief.js, lib/recap.js, lib/scan.js, lib/session-summary.js, lib/run-summary.js, lib/run-paragraph.js, lib/feedback-title.js, lib/observer-pass.js, routes/workspace-api-roadmap.js, routes/ship-biscuit.js, routes/workspace-api-scan.js, routes/task-chat.js, scripts/replay-brief.mjs]
---

# Which model should each Harbour call run on, and which should the free tier run on?

On the catalog read 8 Nov 2026 11:14 UTC and the Library analysis of 23 Oct 2026, John's
sense is right, for one model. OpenAI's GPT-6 Luna (`openai/gpt-6-luna`) costs
$0.10 in and $0.50 out per million tokens, against $0.75 and $4.50 for today's default,
GPT-5.4 Mini, and is ahead of it on every independent board that scores both. I recommend
it for the free tier and for 14 of the 16 Harbour calls, each only after that call has been
shown to come back whole on real tasks. Two calls stay put. The routing call (`recommend`)
stays on GPT-5.4 Mini: it picks the stage every dispatch follows, it is the only call with a
repeated dense-ticket pass (LIN-263), and it costs about two cents. The brief stays on
GPT-6.1 Sol: nothing cheaper scores higher in either source, and Sol comes out whole.
Claude Haiku 5.5 scores above Luna at the same base price in both sources, but every Haiku
5.5 option waits on the LIN-4352 brief replay (`docs/areas/llm-and-prompts.md`). Harbour's
own calls are a small bill ($54 on October's 271 Done tickets, `cheaper-capacity.md`
Method), so on John's key the case is quality; on the free tier, which bills the operator's
shared key, price matters too.

## Two benchmark sources, kept apart

**Catalog (8 Nov).** OpenRouter's `/api/v1/models` attaches Artificial Analysis figures
(`benchmarks.artificial_analysis`). Of the 379 models that are not `:batch` variants, 145
carry at least one figure. 56 carry the intelligence index, 122 the coding index, and only
33 carry both. The catalog states no index version and no reasoning effort.

**Library (23 Oct).** `cheaper-capacity-benchmarks.csv` copied the AA leaderboard by hand.
Its figures are at the "best listed effort", which is `max` for most rows, and it records
the index as "v4.3.x per secondary sources". Its Vals rows (Terminal-Bench 4.0, Vibe Code
Bench) are independent runs with one harness each.

The two AA sources agree at the top and drift apart lower down:

| Model | Catalog 8 Nov | Library 23 Oct | Gap |
|---|---|---|---|
| Claude Opus 5.5 | 59.1 | 58 | +1.1 |
| GPT-6 Astra | 56.9 | 53 | +3.9 |
| GPT-6.1 Sol | 54.6 | 52 | +2.6 |
| Claude Sonnet 5.5 | 54.5 | 56 | −1.5 |
| Claude Haiku 5.5 | 36.5 | 43 | −6.5 |
| GPT-5.6 Terra | 32.3 | 42 | −9.7 |
| GPT-6 Luna | 27.9 | 38 | −10.1 |
| DeepSeek V4.1 Flash 1017 | 28.6 | 45 | −16.4 |
| GLM-5.3 Flash | 27.8 | 42 | −14.2 |

The gap is not one shift: near zero for frontier models, 6–16 points down for the cheaper
ones above (Kimi K3, not shown: 27). That fits a revised index that is harder at the bottom,
or figures taken below the Library's `max` effort. The catalog states neither, so I cannot
tell which. It matters because the order among cheap models depends on the source: the
Library puts DeepSeek V4.1 Flash (45) above Haiku 5.5 (43) and Luna (38); the catalog puts
Haiku 5.5 (36.5) above DeepSeek (28.6), Luna (27.9) and GLM-5.3 Flash (27.8), which sit
level. Both agree that Sol 6.1 and Sonnet 5.5 sit level near the top, that Haiku 5.5 is
above Luna, and that both are far above Haiku 4.5 (catalog 7.4). The tables below use the
catalog, with the Library figure beside it where one exists.

**GPT-5.4 Mini has no intelligence figure in either source.** The catalog gives only the
older pair, coding 56.1 and agentic 17.9, so it cannot be put on Luna's scale directly.
Three indirect readings:

- **Independent boards (Library, Vals).** Terminal-Bench 4.0: Mini 2.52, Luna 13.64
  (22 Oct). Vibe Code Bench: Mini 47.97, Luna 81.65 (20 Oct).
- **Luna's predecessor.** GPT-5.6 Luna carries the older pair and beats Mini on both
  (coding 71.4, agentic 42.1), with an intelligence figure (23.8) below GPT-6 Luna's.
- **Comparable models.** Of ten non-free catalog models with coding 43–59 and an
  intelligence figure, nine score 4.4–18.9 and one (Solar Pro 4) 28.2. So Mini probably
  sits below Luna's 27.9: an inference, not a measurement.

## Recommendation by call

Each call is a job in `lib/llm-jobs.js`; its model comes from the workspace's routing
table (Settings › Models), falling back to `DEFAULT_MODEL` (`openai/gpt-5.4-mini`). "Now"
is the code default; John's table may differ, and I could not read it. The brief's move to
Sol on 7 Nov is a workspace setting, not code. "+ headroom" means `lib/call-budget.js` adds
reasoning headroom from the catalog and, unless the call allows partial output, retries
once and then refuses rather than return part of an answer. Prices are catalog $/1M.

| Call | What it needs | Now | Recommended | $ in/out | AA intel, catalog / Library | Why | Gate before moving |
|---|---|---|---|---|---|---|---|
| recommend | 8000 bare cap, sent by its own fetch, outside the call-budget layer; no tools; ~24k tokens in (median, 1 Oct baseline) | gpt-5.4-mini | **keep gpt-5.4-mini** | 0.75/4.50 | — / — (coding 56.1, agentic 17.9) | Picks the stage; the only call with a K=3 dense-leaf pass. A misroute costs an agent session. The call costs ~$0.02 | Luna only after `scripts/eval-recommend-baseline.mjs` and LIN-263's dense-leaf cases (SYN-12, LIN-344) pass at K=3 |
| brief | 3000 + headroom, refuses partial; no tools; ~8.3k in | gpt-6.1-sol (7 Nov) | **keep gpt-6.1-sol** | 2/10 | 54.6 / 52 | Whole since 7 Nov. Nothing cheaper scores higher; Sonnet 5.5 ties at the same price | Cheaper options: gpt-6.1-terra ($1/$5, 51.3 / —), gpt-6-luna, or Haiku 5.5 **only if the LIN-4352 replay passes**. For any of them, `scripts/replay-brief.mjs` on LIN-4352 must print block [2] WHOLE with four sections |
| recap | 1500 + headroom; JSON; no tools | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | 7.5× cheaper in, 9× out; ahead on every board both appear on | W, and the JSON parses non-empty (Gemini 3.5 Flash failed here, LIN-263). `scripts/eval/lin-263-spike4.mjs` checks brief and recap once its `MODELS` list is edited |
| scan | 1000 + headroom; JSON decisions; no tools | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as recap | W; move with scan-retire |
| scan-retire | 1000 + headroom; a re-scan that decides retirement | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | same prompt as scan | W, on a task with one live and one stale decision |
| run-summary | 400 + headroom | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | short prose; price is most of the difference | W |
| session-summary | 150 + headroom (also the precompute) | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as above | W |
| run-paragraph | 220 + headroom | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as above | W |
| feedback-title | 60 + headroom | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as above | W |
| observer-pass | 500 + headroom; workspace key, never free tier | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as above | W |
| task-chat | 1500 + headroom; **tools** (drops to no tools if the model is not known to be tool-capable) | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | Tool use is where Mini is weakest (agentic 17.9); GPT-5.6 Luna has 42.1; GPT-6 Luna's AA coding-agent figure is 41.1 (Library mirror) | T |
| flight-companion | 4000 + headroom per hop; **tools**, including `send_follow_up`; up to ~44k in per turn (e37d20e0) | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as task-chat. Sol is the higher-quality fallback if Luna fails T | T on a boot, a typed turn and an auto-wake turn |
| roadmap | 8000 prose + reasoning (an explicit bound where the catalog says thinking is on by default, else headroom); partial allowed, no retry | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | LIN-263 never tested this pipeline on any model | R |
| roadmap-orientation | 2000–16000 by candidate count + reasoning; JSON array | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as roadmap | R |
| roadmap-chat | 8000 prose + reasoning; partial | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as roadmap | R |
| ship-biscuit | 6000 prose + reasoning; temperature 0.5; partial | gpt-5.4-mini | gpt-6-luna | 0.10/0.50 | 27.9 / 38 | as roadmap | one edition generated whole |

Gates:

- **W (whole).** Set the job's model for John's workspace only (Settings › Models), run it
  on three real tasks, one dense (LIN-4352 or LIN-344), and read the LLM call log: every
  call ends `finishReason=stop` (first attempt or the one retry), nothing is refused, and
  the output reads right against GPT-5.4 Mini's for the same task. Only the brief has a
  replay script, so for the rest the routing table and the call log are the test.
- **T (tools).** W, plus one turn that calls a read tool and one that proposes a follow-up,
  both whole. Add `openai/gpt-6-luna` to `SUGGESTED_MODEL_IDS` first: on a cold catalog
  `supportsTools()` falls back to that list, and a model missing from it runs without tools.
- **R (roadmap).** One full generation with every layer ending `stop`, on a warm catalog.
  Since LIN-4358 the reasoning split comes only from the catalog (an explicit bound when
  it says `mandatory` or `default_enabled: true`, as it does for Luna; headroom otherwise);
  on a cold cache these calls send a bare prose cap and may show a cut-off layer, because
  they take partial output and are not retried.

Haiku 5.5 could replace Luna on any row: the same base price ($0.10/$0.50; $0.50/$2.50
over 100k prompt tokens) and higher in both sources (36.5 / 43; Terminal-Bench 4.0 36.36
against 13.64). Only if the LIN-4352 replay passes (block [2] WHOLE, `finishReason=stop`,
any retry row accepting the reasoning bound), and then with its own dense-ticket check,
because Haiku 4.5 is the model LIN-263 saw mis-read dense tickets three times in three.

## The free tier

**Today.** Free-tier calls bill the operator's shared `OPENROUTER_FREE_TIER_KEY`.
`resolveFreeTierModel()` (`lib/openrouter.js`) returns `OPENROUTER_FREE_TIER_MODEL` if it
is in `FREE_TIER_MODEL_IDS`, else `DEFAULT_MODEL`; the clamp (`lib/workspace-preferences.js`)
ignores workspace preferences and per-request overrides. So one model serves 15 of the 16
calls on the free tier (observer-pass resolves without the clamp). I could not read the
production environment; if the variable is set, the tier may already run on another of the
ten allowed ids.

**Recommendation: `openai/gpt-6-luna`.**

- **Better on the evidence.** Terminal-Bench 4.0 13.64 against 2.52; Vibe Code Bench 81.65
  against 47.97 (Vals, Library, 20–22 Oct). Catalog AA intelligence 27.9 against none; its
  predecessor beats Mini on the catalog's coding and agentic fields.
- **Same family as the validated default.** Same `reasoning` field (optional, on by default
  at medium); 1.05M context (Mini 400k); 128k output; tools. Listed since 22 Sep 2026, no
  expiry date.

**Price.** $0.10 in and $0.50 out per 1M ($0.20/$0.75 above 272k prompt tokens), against
Mini's $0.75/$4.50.

| Typical call | GPT-5.4 Mini | GPT-6 Luna |
|---|---|---|
| Brief, 8,300 in + 3,000 out | 8,300 × $0.75/1M = $0.00623; 3,000 × $4.50/1M = $0.01350; **$0.0197** | 8,300 × $0.10/1M = $0.00083; 3,000 × $0.50/1M = $0.00150; **$0.00233** |
| …plus 2,000 hidden reasoning tokens (billed as output) | + $0.0090 = $0.0287 | + $0.0010 = $0.0033 |
| Recommend, 24,200 in + 580 out (Mini's median, 1 Oct) | $0.0182 + $0.0026 = **$0.0208** | $0.0024 + $0.0003 = **$0.0027** (Luna's output length unmeasured) |
| Flight Companion hop, 44,000 in + 1,000 out | $0.0330 + $0.0045 = **$0.0375** | $0.0044 + $0.0005 = **$0.0049** |

That is 7.5–8.5 times cheaper per call. The 8,300-token brief input is the ticket
discussion's figure; this paper did not measure it.

**What has to change** (none of it done here): add `openai/gpt-6-luna` to
`FREE_TIER_MODEL_IDS`, whose comment names this gate; add it to
`SUGGESTED_MODEL_IDS` for the cold-catalog tool fallback; set
`OPENROUTER_FREE_TIER_MODEL=openai/gpt-6-luna` and check that
`getFreeTierModelConfigWarning()` reports nothing at startup. Moving the free tier also
moves free-tier `recommend`, which this paper otherwise keeps on Mini.

**What must be shown whole before switching.** Every free-tier job, on Luna, through a
free-tier session: recommend (its gate above); brief (`replay-brief.mjs` on LIN-4352 with
`openai/gpt-6-luna`, block [2] WHOLE); recap, scan and scan-retire (W, JSON parsing);
run-summary, session-summary, run-paragraph and feedback-title (W); task-chat and
flight-companion (T); the three roadmap calls and ship-biscuit (R). The tier has one model,
so if any job fails it stays where it is.

**Disposition (8 Nov 2026, John's rulings on LIN-4358).** The free tier stays on GPT-5.4
Mini. `FREE_TIER_MODEL_IDS` stays an allowlist, not a price ceiling, and pickers get no
benchmark column (ruling `lin4358-free-tier-and-quality-source`, 12:41 UTC). GPT-6 Luna stays
this paper's recommendation, **evidence pending**: no free-tier job has been run on it, and
LIN-4358 closed without that run (ruling `lin4358-luna-evidence`, option `stay-mini`, 12:54
UTC). The move needs the whole-job run above, done with an OpenRouter key, followed by the
changes listed under What has to change. The per-call rows above are still recommendations,
each behind its own gate. No call moved with this paper.

**Alternative, conditional.** Claude Haiku 5.5 has the same base price and scores higher
in both sources. It is not in the free-tier allowlist either: `lib/openrouter.js` says it
was deliberately left out. It qualifies only after the LIN-4352 replay passes and the same
job list is shown whole. Above 100k prompt tokens its price rises fivefold.

## Candidates considered

From the live catalog (8 Nov): tool-capable models with an AA figure, plus those Harbour
uses now. Reasoning is mandatory/optional, `default_enabled` (? where absent), default
effort. Terminal-Bench 4.0 is Vals via the Library (22 Oct).

| Model | $ in/out | Context | Max out | Reasoning | AA intel / coding / agentic (catalog) | AA intel (Library) | TB 4.0 |
|---|---|---|---|---|---|---|---|
| anthropic/claude-opus-5.5 | 4/20 | 1M | 128k | mandatory, ?, high | 59.1 / — / — | 58 | 65.2 |
| openai/gpt-6.1-sol | 2/10 (>272k 4/15) | 1.05M | 128k | mandatory, on, medium | 54.6 / — / — | 52 | 55.05 |
| anthropic/claude-sonnet-5.5 | 2/10 | 1M | 128k | mandatory, ?, high | 54.5 / — / — | 56 | 64.1 |
| openai/gpt-6.1-terra | 1/5 (>272k 2/7.5) | 1.05M | 128k | optional, on, medium | 51.3 / — / — | — (listed 26 Oct) | — |
| anthropic/claude-haiku-5.5 | 0.10/0.50 (>100k 0.50/2.50) | 1M | 128k | optional, ?, medium | 36.5 / — / — | 43 | 36.36 |
| openai/gpt-5.6-terra | 2/12 (>272k 4/18) | 1.05M | 128k | optional, on, medium | 32.3 / 76.7 / 43.2 | 42 | 22.73 |
| google/gemini-3.8-flash | 0.825/4.125 | 1.05M | 65k | mandatory, on, medium | 30.8 / 76.3 / 40.2 | 41 | 19.7 |
| minimax/minimax-m3.1-flash | 0.15/0.60 | 1.05M | 524k | mandatory, ?, max | 29.1 / — / — | 43 | — |
| deepseek/deepseek-v4.1-flash-1017 | 0.006/0.50 | 1.05M | 944k | optional, on, high | 28.6 / — / — | 45 | 31.8 |
| **openai/gpt-6-luna** | 0.10/0.50 (>272k 0.20/0.75) | 1.05M | 128k | optional, on, medium | 27.9 / — / — | 38 | 13.64 |
| z-ai/glm-5.3-flash | 0.034/0.083 | 1.05M | 131k | mandatory, on, max | 27.8 / 71.5 / 50.9 | 42 | — |
| openai/gpt-5.6-luna | 0.20/1.20 | 1.05M | 128k | optional, on, medium | 23.8 / 71.4 / 42.1 | — | 11.62 |
| anthropic/claude-sonnet-5 | 2/10 | 1M | 128k | optional, on, high | — / 71.5 / 43.6 | — | 10.6 |
| openai/gpt-5.6-sol | 4/20 (>272k 8/30) | 1.05M | 128k | optional, on, medium | — / 78.3 / 47.4 | — | — |
| openai/gpt-5.4-mini | 0.75/4.50 | 400k | 128k | optional, off (measured on), medium | — / 56.1 / 17.9 | — | 2.52 |

**Why not the cheaper ones.** GLM-5.3 Flash, DeepSeek V4.1 Flash and MiniMax M3.1 Flash
cost less than Luna and, on the catalog, score level with it or above it on coding and
agentic. I do not recommend them now. GLM and MiniMax make reasoning mandatory at `max`
effort, a latency and cut-off risk on 60–400-token calls, and Harbour has run none of the
three on these calls. LIN-263's cheap open-weight models failed: DeepSeek V4-Flash, an
earlier build, mis-routed the dense leaf twice in three, and Qwen3.7-Plus gave unparseable
action lines at 40–90 seconds a call. Luna comes from the family Harbour's call layer was
built around. They are the next candidates once Luna's gates have run. GPT-6.1 Terra costs
half Sol's price and scores 3.3 points below it; it is the brief's cheaper option, but was
listed on 26 Oct and has no Library or Vals figure.

## What this cannot tell you

- **Harbour's own tasks.** AA indexes and Terminal-Bench measure general reasoning and
  agentic coding. Harbour's calls read one dense ticket and write fixed-shape prose or
  JSON. LIN-263 found failures no benchmark predicted: Haiku 4.5 said "no plan exists"
  with the plan in the ticket body; Gemini 3.5 Flash wrote its reasoning before the recap
  JSON and left the recap empty; the newest model, Qwen3.7-Plus, fitted worst. The catalog
  shows which model is likely to be better, not that it will hold a call's shape, so every
  row above has a gate.
- **Reasoning behaviour under Harbour's caps.** The catalog's reasoning flags are not
  reliable. On 7 and 8 Nov it said `default_enabled: false` for GPT-5.4 Mini, which Harbour has
  measured spending hidden reasoning (LIN-1000, LIN-1665). It gives no `default_enabled`
  for Haiku 5.5. Why Haiku 5.5 stopped mid-brief on 7 Nov is still unproven.
- **Which index.** The catalog states no AA version or effort, and for cheap models its
  figures sit 6–27 points below the Library's, so rankings among them are soft.
- **Latency, uptime and provider.** None of these is in `/api/v1/models`. OpenRouter may
  serve one model from several providers, and this paper did not check the endpoints.
- **Volumes.** Token counts were read for recommend (1 Oct baseline) and one Flight
  Companion turn (e37d20e0). The other calls' input sizes were not measured.

## How to re-run

```sh
curl -s https://openrouter.ai/api/v1/models > models.json
python3 -I candidates.py models.json 1.25   # optional ceiling on output $/1M
```

```python
import json, sys
CURRENT = {'openai/gpt-5.4-mini', 'openai/gpt-6.1-sol', 'anthropic/claude-haiku-5.5',
           'anthropic/claude-sonnet-5', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-sol'}
ceiling = float(sys.argv[2]) if len(sys.argv) > 2 else 99
rows = []
for m in json.load(open(sys.argv[1]))['data']:
    if m['id'].endswith((':batch', ':free')):
        continue
    aa = (m.get('benchmarks') or {}).get('artificial_analysis') or {}
    idx = [aa.get(k) for k in ('intelligence_index', 'coding_index', 'agentic_index')]
    tools = 'tools' in (m.get('supported_parameters') or [])
    p = m['pricing']
    pin, pout = float(p.get('prompt') or 0) * 1e6, float(p.get('completion') or 0) * 1e6
    if m['id'] not in CURRENT and not (tools and any(v is not None for v in idx) and pout <= ceiling):
        continue
    r = m.get('reasoning')
    rs = '-' if r is None else '%s, on=%s, %s' % (
        'mandatory' if r.get('mandatory') else 'optional', r.get('default_enabled', '?'), r.get('default_effort'))
    rows.append((idx[0] or 0, m['id'], pin, pout, m.get('context_length'),
                 (m.get('top_provider') or {}).get('max_completion_tokens'), tools, rs, *idx))
for row in sorted(rows, reverse=True):
    print('%-40s %7.3f %7.3f %9s %7s %-5s %-28s %5s %5s %5s' % row[1:])
```

Long-context tiers are in `pricing.overrides`, keyed by `min_prompt_tokens`. The Library
column comes from `cheaper-capacity-benchmarks.csv`, not from this script.
