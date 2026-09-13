---
title: Can a cheap model implement Harbour tickets to Opus's review standard, and what does it cost?
version: 2
date: 2026-09-13
authors: [Claude, John Kershaw]
model: the conning session wrote this by hand over the read-write proxy; the implementations it dispatched ran z-ai/glm-5.3, deepseek/deepseek-v4.1-flash and google/gemini-3.8-flash on opencode (no effort field), the gating reviews claude-opus-5 on claude-code at effort medium, the shadow reviews z-ai/glm-5.3 on opencode, as the dispatch lineages under sessionId LIN-2828-bakeoff report
grounded_at: 5b3e5990 (LinearViewer), 135991f (simple-dispatcher)
cites: [LIN-2828 (comments 2026-09-12 and 2026-09-13), LIN-2831 (results table, 2026-09-13), LIN-2839 (research comment f415b68a, 2026-09-13), LIN-2830 (comments 401bfecc and d6eb6469), LIN-2573 (comment a0d9de81), PR #1470 to PR #1482 (2026-09-12 and 2026-09-13), simple-dispatcher PR #233 (2026-09-12), simple-dispatcher/opencode-runner.js@135991f:383-387, simple-dispatcher/config.js@135991f:1093, simple-dispatcher/admission.js@135991f:33-37, docs/reviews/model-effort-routing-proposal-2026-09-11.md, docs/reviews/cheap-implementer-bakeoff-2026-09-13.md]
---

# Can a cheap model implement Harbour tickets to Opus's review standard, and what does it cost?

Yes, on small tickets, and the review is the cost. Thirteen tickets were implemented by
three OpenRouter models through opencode over an evening and a morning, 12 to 13 September
2026, each judged by an Opus review. Eight passed first time and every one passed within
one round. No reviewer found a logic defect; the five send-backs were all second-order, a
layout, a docblock claim, a missing test, stale prose, a monitor that reports clean on an
empty fetch. Each Opus review cost $2.26 to $4.79 API-equivalent regardless of the ticket's
size, so the 22 reviews of the round cost about $62, which is about one and a half points
of the weekly subscription window. The implementations cost a few dollars each on GLM and
cents on Flash, on readings Harbour's own relay cannot make. The seven launch failures in
the round were a daily spend cap, a stale model catalog, and CPU starvation, none of them
the model.

## Findings

**Every ticket produced a reviewable PR on its first session, and none looped.** Thirteen
tickets, thirteen PRs with green CI, from three models the runner had never run before, with
no human touch between dispatch and verdict. Harbour's own five-hour session watchdog and
error-recovery pathology, the failure mode the dash-analysis found in three quarters of
sessions, did not appear once.

**First-pass rates tie between GLM and Flash; both reach 100% after one round.**

| Model | Tickets | First-pass | Within one round | Median implementation |
|---|---|---|---|---|
| z-ai/glm-5.3 | 6 | 4 | 6 | 20 min |
| deepseek/deepseek-v4.1-flash | 5 | 3 | 5 | 14 min |
| google/gemini-3.8-flash | 2 | 1 | 2 | 24 min |

The routing proposal's Sonnet baseline is 84% first-pass over 115 cases. Thirteen is too few
to place either model against it, but seven of thirteen first-pass with every miss recovered
in one round is not obviously worse.

**The misses are all second-order, and they are the misses a test would not catch.** LIN-2830:
a grid with 792 px of fixed columns inside a 263 px card, clipped by the site's overflow
rule, in a change whose logic and tests were correct. LIN-2647: a header rewritten to remove
an overclaim that introduced a new overclaim in the same sentence. LIN-2575: a correct change
at four sites, one of which, the live path, no test pinned. LIN-2838: a rule changed in code
and left standing in four places of prose, one served to agents. LIN-2573: a new scheduled
scan that reports clean when it fetches nothing. Opus found each with a measurement, not a
reading: rendered widths, a five-minute clock advance, a full-suite mutation, a prose census,
an empty-fetch run.

**Review cost is flat with size, so the saving scales with the ticket.** Harbour prices Opus
reviews from their relayed tokens at $2.26 to $4.79, five to nine minutes each. The one-line
CLAUDE.md change cost $2.54 to review; the 414-line readout change cost $4.79. The review
regrounds, mutation-checks and writes a ledger whatever the diff, so on a ten-minute ticket
the review is most of the cost, and on a two-hour ticket it would be a fraction. A bake-off
of small tickets, chosen small for safety, understates what a cheap implementer saves.

**Harbour cannot see what an opencode session cost.** The runner posts the usage of the one
message it awaited, which is the final step (`opencode-runner.js:383-387`), so the relayed
figure for a thirty-minute GLM session was $0.027 against $3.45 on the OpenRouter meter, and
Flash sessions relayed under a cent. Filed as LIN-2835. Until it lands, per-ticket cost is
whatever the operator reads off the activity page, and this paper carries no per-model
figure.

**A cheap reviewer agrees with Opus when the PR is clean and misses the second-order
finding cold.** Thirteen shadow reviews on GLM used the identical prompt Opus received, with a
header naming them shadows and forbidding any write beyond one comment. Eleven agreed in
full. One (LIN-2760) found the same case Opus raised as a ruling for the operator and blocked
on it instead. One (LIN-2573) approved, before Opus posted, the scan that reports clean on an
empty fetch. The two Request Changes agreements (LIN-2575, LIN-2838) were formed with the
Opus comment already on the thread, because the proxy's issue read returns every comment;
the shadow said so itself. So the cold evidence is one miss on one hard finding, and the
warm evidence is that GLM reproduces Opus's findings when it can see them.

**The failures were the plumbing's, and every one was invisible from Harbour.** Seven
launches died: three to a $20 daily spend cap on the OpenRouter key (12 September from
20:50Z, found the next morning), two to opencode's cached model catalog refusing the
three-day-old `deepseek-v4.1-flash` id while a server with a fresh cache accepted it, one to
a 20-second readiness bound missed while a claude-code cold start pushed host load from 2 to
16 on ten cores, and two shadow sessions that hung after the cap and were aborted at a
hundred minutes. LIN-2839's research, an Opus session reading the host's own logs, found no
concurrency ceiling: twelve opencode servers ran side by side with 120 ms boots, and the
conning session's working cap of four was a selection artefact. Harbour saw an exit code
for each; the actionable text sat in a per-session log nobody reads (LIN-2837).

**A model that reads "no code changes" and parks is worth recording.** LIN-2415, dispatched
in error, forbids code. GLM confirmed the prerequisite deploy, found the real cause of the
missing stamp, a trailing newline, wrote a runbook and parked BLOCKED in four minutes. The
fix it implied became LIN-2838, implemented by Flash and approved the same morning.

## Method

Twelve small tickets whose descriptions were already the plan, plus one filed during the
run, were ratified on LIN-2828: six for GLM, four for Flash, two for Gemini as a control, one
bonus for Flash. No Todo ticket in the workspace carried a reviewed plan, so each was
dispatched straight to implementation with the verb pinned, from a conning session over the
read-write proxy: `POST /api/proxy/recommend-and-dispatch` with `kind: implementation`,
`harness: opencode`, the model id, `target: cli`, `appendProxyContext: true` and
`sessionId: LIN-2828-bakeoff`. On `[done]` an Opus review was dispatched the same way with
`kind: review` and no model, so the workspace defaults (claude-code, opus, medium) applied.
The review's stored prompt was read back from `GET /dispatch/{id}/prompt`, its access block
cut, a shadow header prepended, and the result dispatched as `kind: custom` on GLM. A
Request Changes verdict was answered by a fix round on the same model and a re-review.
Verdicts are the `DONE:` line of each review's feedback and the review comment on the
ticket. Durations and review prices are Harbour's `/cost` lineages, read 09:25Z on 13
September. The results table is LIN-2831's description; every event is a comment on
LIN-2828.

## Limits

Thirteen results, all small, none over an hour, chosen by the person running the bake-off.
Per-ticket implementation cost is unmeasured: the relay is wrong by two orders and the
operator's meter readings were cumulative and shared. The shadow reviewer is the same model
as one of the implementers, and eleven of its thirteen verdicts were on PRs Opus also
approved, where agreement is cheap; its one cold test was a miss. Gemini had two tickets. The
upstream host and quantisation behind each session was not recorded. The failure-rate figure
for the harness is inflated by one configuration fault (the cap) and one catalog race that a
week-old model id would not have hit.

## Next

- Read the operator's OpenRouter activity page per session and put a per-model cost per
  ticket in this paper's third edition.
- Run a fleet week on medium tickets, where the review-to-implementation ratio is the
  interesting one, and measure the saving per Opus review rather than per ticket.
- Give a cheap reviewer on a *different* model from the implementer a cold pass on PRs
  where Opus found a blocking defect, and count what it catches. One miss is a hint.
- Find the lower floor: two tickets each on `deepseek/deepseek-v4-flash-0731` and
  `openai/gpt-oss-120b`, one on `meta-llama/llama-3.1-8b-instruct` as the control.
