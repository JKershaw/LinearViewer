# Cheap implementer bake-off — 2026-09-13

Thirteen small implementation tickets run on three OpenRouter models through opencode, each
judged by an Opus review on the subscription, between 19:05Z on 12 September and 09:30Z on
13 September 2026. The question was whether a cheap implementer passes Opus review at
anything near the 84% first-pass rate the routing proposal measured for Sonnet, and what it
costs. This is the read LIN-2832 asked for. The decision it feeds, which preset runs the
fleet week, is left open for the operator; the recommendation is at the end.

Tracking: LIN-2828 (voyage log in comments), LIN-2831 (results table). Method and limits in
full: `docs/papers/harbour/cheap-implementer.md`. Updated 13 September afternoon with the
close-outs and the floor run.

## The short version

| Model | Tickets | First-pass | Approved within one round | Median implementation | OpenRouter per ticket | Opus review per ticket |
|---|---|---|---|---|---|---|
| z-ai/glm-5.3 | 6 | 4 of 6 | 6 of 6 | 20 min | about $3.75 | $4.90 API-equivalent |
| deepseek/deepseek-v4.1-flash | 5 (incl. one bonus) | 3 of 5 | 5 of 5 | 14 min | about $0.45 | $4.45 |
| google/gemini-3.8-flash (control) | 2 | 1 of 2 | 2 of 2 | 24 min | about $3.55 | $3.61 |

Every one of the thirteen produced a PR with green CI on its first session. No session looped
on error recovery. No reviewer found a logic defect in any of the thirteen: all five
send-backs were second-order, a clipped layout, a docblock that overclaimed, a missing test
on the live path, stale prose that survived a rule change, and a monitoring job that reports
clean after fetching nothing.

## What the numbers say

**Implementation quality is indistinguishable between GLM and Flash on this sample.** Four of
six against three of five first-pass, both at 100% after one round. The difference is inside
the noise of thirteen tickets. Gemini's two are too few to place.

**Per-ticket cost on OpenRouter, from the operator's activity export** (hourly totals per
model, 12 September 19:00Z to 13 September 09:59Z): GLM-5.3 $34.68, Gemini 3.8 Flash $7.07,
DeepSeek V4.1 Flash $2.27, plus $2.85 of Harbour's own calls on GPT-5.6 Sol and GPT-5.4 Mini.
$46.86 in all, about £35. The GLM figure covers its nine implementation sessions, the
blocked LIN-2415 run and all thirteen shadow reviews; split by session-minutes that is about
$22.50 for implementation, $3.75 a ticket, and $12 for the shadows, about $0.95 each. Flash's
five tickets cost $2.27 together, about $0.45 a ticket, eight times cheaper than GLM for the
same approval rate. Gemini's two cost $3.55 each, GLM's price for a worse and smaller
record. Harbour's own relay reports the final turn only (LIN-2835) and is not usable for
any of this.

**Close-out costs as much as review.** The thirteen approved PRs were merged by thirteen
Opus close-outs on 13 September, in batches of four: every one merged and set Done in one
session, no send-backs, no conflicts, `main` green throughout on both repositories. $1.62 to
$8.88 each, $51.95 in all, median nine minutes. Review plus close-out is about $8.80 of Opus
per cheap-implemented ticket; the implementer's share is $0.45 to $3.75.

**A cheap close-out on an empty ledger worked once.** LIN-2697's close-out ran on DeepSeek
V4 Flash 0731: PR #1485 merged, suite re-run on the landed commit, Done set, one outside
follow-up filed (LIN-2856), 13 minutes, $0.001. The Opus control on LIN-2637 merged
PR #1486 and set Done in three minutes for $3.44; the dispatcher marked it COMPLETED but
Harbour never received the terminal marker, and the dispatch was aborted by hand after
three hours. One each; the empty-ledger case is worth five more.

**The floor run: DeepSeek V4 Flash works, two cheaper models do not.**

| Model | Tickets | PRs with green CI | Opus verdict | Relayed cost |
|---|---|---|---|---|
| deepseek/deepseek-v4-flash-0731 | 2 | 2 | LIN-2697 Approve first pass, empty ledger; LIN-2637 one missing test, fixed test-only, approved on re-review | under $0.01 for three sessions |
| openai/gpt-oss-120b | 2 | 0 | not reviewed: `[done]` after 6 s and 15 tokens on LIN-2504, `[failed]` after 1 min on LIN-2708 claiming a file on `main` does not exist | under $0.01 |
| meta-llama/llama-3.1-8b-instruct (control) | 1 | 0 | not reviewed: heartbeat frozen at 10 min, aborted at 49 min, no usage relayed | none relayed |

Two more cold shadow pairs came with it: agreement on both, including the LIN-2637 missing
test, which the GLM shadow named before Opus posted.

**Opus review is the expense and is nearly flat with ticket size.** Harbour prices the 22
reviews of this round at $2.26 to $4.79 each from their relayed tokens, five to nine minutes
each, about $60 of API-equivalent in total, which is about one and a half points of the
weekly window at the LIN-2087 calibration. A one-line doc change cost $2.54 to review; a
414-line change cost $4.79. The saving from a cheap implementer therefore scales with the
ticket, and this bake-off's deliberately small tickets understate it.

**A cheap reviewer agrees with Opus on clean PRs and misses the second-order finding cold.**
Thirteen shadow reviews on GLM, using the identical prompt Opus received: eleven full
agreements, one same-finding-stricter-call (LIN-2760, where Opus asked the operator and GLM
blocked), and one miss (LIN-2573, where GLM approved a scan that reports clean after fetching
nothing, formed before Opus posted). Two of the agreements on Request Changes verdicts were
re-derivations with the Opus comment already visible on the thread, because the proxy's
issue read returns the whole thread; only LIN-2573's was genuinely cold.

**The failures were not the models.** Seven launches died during the round: three to
OpenRouter's $20 daily cap on the key (12 September, 20:50Z onward), two to opencode's
cached model catalog refusing the three-day-old `deepseek-v4.1-flash` id while a fresh cache
accepted it, one to a 20-second readiness bound missed under CPU load from a claude-code
cold start, and two shadow sessions that hung after the cap. LIN-2839's research read the
host logs and found no concurrency ceiling: twelve opencode servers ran side by side with
120 ms boot times. Every failure was invisible from Harbour, which saw only exit codes; that
is LIN-2837.

## Findings that change how the fleet week should run

1. **Use the bigger tickets.** Review cost does not shrink with the ticket. A cheap
   implementer on a two-hour ticket saves far more per Opus review than on a ten-minute one.
2. **Keep the review on Opus.** The one cold shadow miss was exactly the kind of finding a
   fleet week needs caught: a monitoring job that lies. A cheap reviewer is a fine second
   opinion and not yet a gate.
3. **Watch the visual surface.** GLM's one hard miss was a layout it never looked at. For a
   ticket that touches a page, either add a screenshot step or expect a re-review round.
4. **Fix the two relay gaps before reading a week's cost.** LIN-2835 (usage is final-turn
   only) and LIN-2837 (provider refusals arrive as exit codes) each cost hours of diagnosis
   this round.

## Recommendation

Both GLM-5.3 and DeepSeek V4.1 Flash cleared the 70% bar on approval-within-one-round and
neither cleared it cleanly on first pass. On quality they tie. On price Flash is eight times cheaper per ticket on the operator's
meter, and its sessions were shorter. The floor run puts the older `deepseek-v4-flash-0731`
in the same class on two tickets at a lower list price, and puts gpt-oss-120b and an 8B
model below the line where the harness produces work at all. The recommendation is **Flash
as the fleet-week implementer via a preset, GLM as the fallback**; the older Flash is a
candidate for the same preset once it has more than two tickets behind it. A fleet week of forty medium tickets on
Flash would cost under $50 on OpenRouter against about $180 of Opus review API-equivalent,
which is where the money goes. The Sonnet-on-Bedrock
fallback in the plan was not needed.

Whether the winner becomes the workspace default for implementation or stays a preset is
LIN-2834's question and is deferred to the close-out.

## Not proven

- Per-model cost per ticket is an hourly-total split by session-minutes, not a per-session
  read; GLM's implementation and shadow costs share one bucket.
- Whether any of the three models holds up on a ticket larger than an hour. Untried is
  not unfavourable: the tickets were small because they were safe to try.
- Whether a cheap close-out holds beyond one empty-ledger ticket.
- Whether a cheap reviewer on a *different* model from the implementer does better than GLM
  reviewing GLM.
- The upstream host and quantisation OpenRouter routed each session to, which was not
  recorded.
- Why gpt-oss-120b did nothing and the 8B model hung: model, opencode's tool calling on
  that model, or the host. The per-session opencode log would say; Harbour cannot.

## Sources

- LIN-2828 voyage log, LIN-2831 results table, LIN-2839 research comment (2026-09-13).
- PRs #1470 to #1482 on JKershaw/LinearViewer and #233 on JKershaw/simple-dispatcher, all
  merged 2026-09-13; floor PRs #1485 and #1486, merged 2026-09-13.
- `GET /api/proxy/cost/{identifier}` for each ticket, read 2026-09-13T09:25Z and, for the
  close-outs and floor, 2026-09-13T12:30Z, and for the two step-4 close-outs 2026-09-13T17:15Z.
- `docs/reviews/model-effort-routing-proposal-2026-09-11.md` for the Sonnet baseline.
