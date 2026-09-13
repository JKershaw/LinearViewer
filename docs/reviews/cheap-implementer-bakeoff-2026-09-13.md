# Cheap implementer bake-off — 2026-09-13

Thirteen small implementation tickets run on three OpenRouter models through opencode, each
judged by an Opus review on the subscription, between 19:05Z on 12 September and 09:30Z on
13 September 2026. The question was whether a cheap implementer passes Opus review at
anything near the 84% first-pass rate the routing proposal measured for Sonnet, and what it
costs. This is the read LIN-2832 asked for. The decision it feeds, which preset runs the
fleet week, is left open for the operator; the recommendation is at the end.

Tracking: LIN-2828 (voyage log in comments), LIN-2831 (results table). Method and limits in
full: `docs/papers/harbour/cheap-implementer.md`.

## The short version

| Model | Tickets | First-pass | Approved within one round | Median implementation | Opus review per ticket |
|---|---|---|---|---|---|
| z-ai/glm-5.3 | 6 | 4 of 6 | 6 of 6 | 20 min | $4.90 API-equivalent |
| deepseek/deepseek-v4.1-flash | 5 (incl. one bonus) | 3 of 5 | 5 of 5 | 14 min | $4.45 |
| google/gemini-3.8-flash (control) | 2 | 1 of 2 | re-review pending on the second | 24 min | $2.87 so far |

Every one of the thirteen produced a PR with green CI on its first session. No session looped
on error recovery. No reviewer found a logic defect in any of the thirteen: all five
send-backs were second-order, a clipped layout, a docblock that overclaimed, a missing test
on the live path, stale prose that survived a rule change, and a monitoring job that reports
clean after fetching nothing.

## What the numbers say

**Implementation quality is indistinguishable between GLM and Flash on this sample.** Four of
six against three of five first-pass, both at 100% after one round. The difference is inside
the noise of thirteen tickets. Gemini's two are too few to place.

**Per-ticket cost on OpenRouter** is to be filled in from the operator's activity-page readout
at the pause; Harbour's own relay reports the final turn only (LIN-2835) and is not usable.
The two readings taken on 12 September put GLM at roughly $2 to $3.50 per ticket. Flash's
sessions read 100k to 300k cache-read tokens for under a cent relayed, and its list price is
a tenth of GLM's.

**Opus review is the expense and is nearly flat with ticket size.** Harbour prices the 21
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
neither cleared it cleanly on first pass. On quality they tie. On price Flash is an order of
magnitude cheaper on paper and its sessions were shorter. The recommendation is **Flash as the
fleet-week implementer via a preset, GLM as the fallback**, with the choice made final once
the operator's OpenRouter readout gives a per-model cost per ticket. The Sonnet-on-Bedrock
fallback in the plan was not needed.

Whether the winner becomes the workspace default for implementation or stays a preset is
LIN-2834's question and is deferred to the close-out.

## Not proven

- Per-model cost per ticket: pending the operator's readout.
- Whether any of the three models holds up on a ticket larger than an hour.
- Whether a cheap reviewer on a *different* model from the implementer does better than GLM
  reviewing GLM.
- The upstream host and quantisation OpenRouter routed each session to, which was not
  recorded.

## Sources

- LIN-2828 voyage log, LIN-2831 results table, LIN-2839 research comment (2026-09-13).
- PRs #1470 to #1482 on JKershaw/LinearViewer and #233 on JKershaw/simple-dispatcher.
- `GET /api/proxy/cost/{identifier}` for each ticket, read 2026-09-13T09:25Z.
- `docs/reviews/model-effort-routing-proposal-2026-09-11.md` for the Sonnet baseline.
