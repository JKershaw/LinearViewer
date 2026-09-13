---
title: What has each model been seen to do on Harbour's tasks?
version: 1
date: 2026-09-13
authors: [Claude, John Kershaw]
model: by hand, by the session that conned the cheap-implementer bake-off, over the read-write proxy; the runs it reports ran as their own lineages say
grounded_at: 85584846 (LinearViewer), d3c27c4 (simple-dispatcher)
cites: [docs/papers/harbour/cheap-implementer.md (v3, 2026-09-13), docs/reviews/cheap-implementer-bakeoff-2026-09-13.md, docs/reviews/model-effort-routing-proposal-2026-09-11.md, docs/papers/harbour/capability-ledger-method.md (v1, 2026-09-13), LIN-2831 (results, close-out and floor tables, 2026-09-13), LIN-2828 (voyage log, 2026-09-12 and 2026-09-13), PR #1470 to PR #1482, PR #1485, PR #1486, simple-dispatcher PR #233]
---

# What has each model been seen to do on Harbour's tasks?

Opus 5 does every step and is the judge. Sonnet 5 does implementation and plan at the
gate's own standard. Three cheap models on opencode, GLM-5.3, DeepSeek V4.1 Flash and
DeepSeek V4 Flash, implement small, well-grounded, test-heavy tickets to the point where
Opus approves them within one round, and none has been tried on anything else. Gemini 3.8
Flash did the same on two tickets at GLM's price. gpt-oss-120b and Llama 3.1 8B produced no
work on this harness. This is the first edition of the ledger `capability-ledger-method.md`
describes. It is rewritten, never appended to; git holds every earlier edition. An entry
that is not here is unknown, and an unknown pair routes to Opus.

## The shapes this edition can speak to

Every cheap-model ticket below is the same shape: a description that already contained the
plan, files and lines named, under an hour's work, touching tests, docs or library code with
a unit suite, in a repository whose CI proves most of the claim. Call that a **grounded
small ticket**. The one exception was a page, and it is noted. No cheap model has been
tried on a **thin ticket** (no plan in the description), a **page** beyond that one, a
**data path, credential or contract** change, a **multi-session** ticket, a **lane** of
several tickets, or any kind other than implementation. The **stepper** variant has no
entries for any model.

Read every "not tried" below as exactly that. The bake-off chose small tickets because
they were safe to try, not because the models were expected to fail on larger ones, and
nothing in this edition is evidence either way about a shape a model has not been given.
The absent-entry rule routes an unknown pair to Opus for safety; it is a routing default,
not a prediction. A model whose entry is thin is a model worth giving a bigger ticket to,
on a ticket that says so.

## Opus 5 (claude-code, effort high or medium)

**Does every step.** Autopilot, research, plan, plan-review, implementation, bug, review,
close-out, breakdown, triage, and the rare kinds, across 1,068 sessions in the 30 days to
11 September (routing proposal, "Where the money goes"). It is the judge for every other
entry here: every verdict below is an Opus review at effort medium, and every merge an
Opus close-out.

**Costs what it costs regardless of the ticket.** Review $2.26 to $4.79 and close-out $1.62
to $8.88 on the bake-off's thirteen small tickets, each four to eighteen minutes, flat with
the size of the change. Implementation on Opus is the one place the data argues against
it: nine sessions, five approved first pass, at four times Sonnet's median cost, probably
chosen for hardness.

**Not tried:** nothing relevant. Effort levels below high have one week of stamped data and
no gate outcomes yet.

## Sonnet 5 (claude-code, effort high)

**Implements to the gate's standard.** 97 of 115 implementations approved first pass at the
Opus review gate, median $4.54 and 19 minutes, over the 30 days to 11 September. This is
the baseline every cheap model is measured against, and the bake-off's tickets were smaller
than Sonnet's typical one.

**Plans as well as Opus at a fifth of the price.** 5 of 43 plans approved first pass against
Opus's 2 of 13; the gate sends nearly every plan back once by design, so the two are the
same number. $1.74 against $9.48.

**Not tried:** review, close-out, research as defaults. Triage on Sonnet is proposed, not
measured.

## GLM-5.3 (opencode, OpenRouter, no effort field)

**Implements grounded small tickets.** Six tickets, 12 to 13 September: four approved first
pass, six within one round (LIN-2830, LIN-2572, LIN-2628, LIN-2760, LIN-2647, LIN-1220).
The two send-backs were a layout it never looked at and a docblock rewritten with a new
overclaim; no logic defect. Median 20 minutes, about $3.75 a ticket on the operator's
OpenRouter meter, which makes it the dearest of the cheap models for the same result.

**Reads "no code changes" and parks.** Given LIN-2415, a ticket that forbids code, it
confirmed the deploy, found the real cause of the missing stamp, wrote a runbook and parked
BLOCKED in four minutes.

**Reviews as a second opinion, not a gate.** Fifteen shadow reviews on the identical Opus
prompt: thirteen agreed with Opus, one was stricter on the same finding, one missed the
hardest finding of the round, a scan that reports clean on an empty fetch. Of the three
verdicts formed before Opus posted, two agreed, one on a second-order missing test, and one
was that miss. About $0.95 a review.

**Failed on a page.** LIN-2830's readout grid was 792 px of fixed columns in a 263 px card.
Correct logic, correct tests, never rendered. The one page any cheap model has been given.

**Not tried:** anything but grounded small implementation and shadow review. Its six
implementations and the LIN-2415 park give no reason to expect it to fail on a larger or
thinner ticket; that is simply unmeasured.

## DeepSeek V4.1 Flash (opencode, OpenRouter, no effort field)

**Implements grounded small tickets at an eighth of GLM's price.** Five tickets: three
approved first pass, five within one round (LIN-688, LIN-2575, LIN-2671, LIN-2645,
LIN-2838). The send-backs were a live path no test pinned and a rule changed in code but
left standing in four places of prose. No logic defect. Median 14 minutes, about $0.45 a
ticket on the operator's meter, sessions shorter than GLM's. This is the recommended
fleet-week implementer via a preset.

**Not tried:** a page, a thin ticket, anything over an hour, any other kind. Five for
five within one round on this shape is a reason to try the next shape, not a ceiling.

## DeepSeek V4 Flash, 0731 (opencode, OpenRouter, no effort field)

**Implements grounded small tickets; two of two within one round.** LIN-2697 approved
first pass with an empty ledger in 10 minutes; LIN-2637 sent back for one missing test on
a second call path, fixed in a test-only commit and approved on re-review, 28 minutes plus
16. Under a cent relayed for the three sessions. Cheaper on OpenRouter's list than V4.1
Flash. Two tickets is too few to prefer it; enough to keep trying it, and on bigger
tickets than these.

**Not tried:** everything else.

## Gemini 3.8 Flash (opencode, OpenRouter, no effort field)

**Implements grounded small tickets at GLM's price.** Two tickets as the bake-off's control:
LIN-1857 approved first pass; LIN-2573 sent back for a scheduled scan that reports clean
after fetching nothing, fixed and approved. About $3.55 a ticket. No reason on this
evidence to choose it over Flash.

**Quoted a planted secret in a PR body.** Its LIN-2573 PR description reproduced the
fixture Linear key in full and tripped GitHub's secret scanning. Not a code defect; a
handling one worth knowing about.

**Not tried:** everything else. Two clean results on this shape say nothing against it on
any other.

## gpt-oss-120b (opencode, OpenRouter)

**Produced no work on two grounded small tickets.** LIN-2504: `[done]` after six seconds
and fifteen output tokens, no tool call, no change. LIN-2708: `[failed]` after a minute,
claiming `public/observation.js` and the function the ticket names do not exist; both are
on `main`. Under a tenth of a cent each. Whether this is the model, opencode's tool
calling on it, or the upstream host is not known; the per-session opencode log would say.
Until it does, this model has no entry for any shape. That is not a verdict on the
model: two non-events on one harness in one hour could be the plumbing, and a fixed
harness or a different ticket has not been tried.

## Llama 3.1 8B Instruct (opencode, OpenRouter)

**Hung.** The deliberate low control. LIN-2407, one test to write: heartbeat frozen at ten
minutes, aborted at 49, no usage relayed, no PR. No entry for any shape. One hung session
is one hung session; it does not say the model cannot do the work.

## What every cheap-model entry has in common

- The failures a model made were second-order: a layout, a docblock, a test not written, prose
  not updated, a monitor that lies. None was a logic defect, and each was found by an Opus
  review that measured rather than read.
- The failures the harness made were plumbing: a spend cap, a stale catalogue, a hung session,
  a model that reports done without acting. Each was invisible from Harbour until someone
  read the feedback.
- The subscription's share of a cheap-implemented ticket is two Opus sessions, review and
  close-out, about $8.80. The implementer's share is $0.45 to $3.75.

## Method

Read from the dispatch lineages under `sessionId: LIN-2828-bakeoff` via
`GET /api/proxy/cost/{identifier}` on 13 September, the review, shadow and close-out
comments on each ticket, LIN-2831's tables, and the routing proposal's 30-day read for the
Opus and Sonnet entries. Task shape was judged by reading each ticket's description. The
OpenRouter per-ticket figures are the operator's hourly export split by session-minutes,
because Harbour's relay reports the final turn only (LIN-2835).

## Limits

One run of small tickets chosen to be safe, plus one 30-day read of the defaults. The
cheap-model entries rest on two to six tickets each. The shape vocabulary is a reading, not
a measurement. Nothing here says what happens on a ticket over an hour, a thin ticket, a
page, or a stepped run, and the ledger should not be read as if it did. In particular it
should not be read as a ranking: the models with the thinnest entries are the ones with
the least evidence, not the least ability.

## Next

- Run the fleet week with this edition consulted by hand, and write edition 2 from every
  place it was wrong or silent.
- Give DeepSeek V4 Flash 0731 five more grounded small tickets, and Flash V4.1 one page,
  one thin ticket and one over an hour, each named as an experiment on its ticket. Then
  go bigger: a multi-session ticket or a short lane on whichever Flash did best.
- Read the opencode logs for the gpt-oss-120b and Llama sessions before they rotate.
- Add stepper entries: the same shapes, stepped, on a model that failed them single-shot.
