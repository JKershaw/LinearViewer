---
title: What has each model been seen to do on Harbour's tasks?
version: 2
date: 2026-09-13
authors: [Claude, John Kershaw]
model: by hand, by the session that conned the cheap-implementer bake-off, over the read-write proxy; the runs it reports ran as their own lineages say
grounded_at: c4724419 (LinearViewer), d3c27c4 (simple-dispatcher)
cites: [docs/papers/harbour/cheap-implementer.md (v4, 2026-09-13), docs/reviews/cheap-implementer-bakeoff-2026-09-13.md, docs/reviews/model-effort-routing-proposal-2026-09-11.md, docs/papers/harbour/capability-ledger-method.md (v1, 2026-09-13), LIN-2831 (results, close-out and floor tables, 2026-09-13), LIN-2828 (voyage log, 2026-09-12 and 2026-09-13), PR #1470 to PR #1482, PR #1485, PR #1486, LIN-2856, simple-dispatcher PR #233, LIN-2772 and PR #1487, LIN-2121 and PR #1488, LIN-2787 and PR #1489, LIN-2771 and PR #1491, LIN-2153 and LIN-2322 (research, plan and plan-review comments, 2026-09-13), LIN-2828 (voyage log, 2026-09-13 evening)]
---

# What has each model been seen to do on Harbour's tasks?

Opus 5 does every step and is the judge. Sonnet 5 does implementation and plan at the
gate's own standard. The two DeepSeek Flash models on opencode implement grounded tickets to
Opus's review standard whether the ticket is small, an hour long across a provider and its
docs, or thin with no plan at all; they carry a stepped run; they write research that an
Opus plan-review takes seriously; and they close out a reviewed ticket correctly once a
human has read the ledger. Their plans have not yet cleared the plan-review gate, which
sends most plans back once and theirs back twice. GLM-5.3 implements the same small shapes
at eight times the price and reviews well enough to be a second opinion. Gemini 3.8 Flash
did two small tickets at GLM's price. gpt-oss-120b and Llama 3.1 8B produced no work on
this harness. This is the second edition of the ledger `capability-ledger-method.md`
describes, rewritten from the evening of 13 September's experiments; git holds edition 1.
An entry that is not here is unknown, and an unknown pair routes to Opus.

## The shapes this edition can speak to

Most cheap-model tickets below are one shape: a description that already contained the
plan, files and lines named, under an hour's work, touching tests, docs or library code with
a unit suite, in a repository whose CI proves most of the claim. Call that a **grounded
small ticket**. Edition 2 adds four more shapes, one ticket each, all on the Flash models:
a **grounded hour-plus ticket** across a provider, a proxy route, its docs contract and a
regression test (LIN-2787); a **thin ticket** with no plan in the description, where the
model had to research, plan and implement in one session (LIN-2121); a **client-side page
behaviour** ticket with unit and end-to-end coverage, run single-shot (LIN-2772) and
**stepped** in four beats with an Opus-class session at the wheel (LIN-2771); and the
**research** and **plan** kinds on two tickets each, judged by an Opus plan-review. It also
adds **close-out**, on empty and on non-empty ledgers. No cheap model has yet been tried on
a **visual layout**, a **data path, credential or contract** change beyond LIN-2787's read
path, a **multi-session** ticket, or a **lane**.

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

**Reviews as a second opinion, not a gate.** Nineteen shadow reviews on the identical Opus
prompt: sixteen agreed with Opus, two were stricter on the same or an adjacent finding, one
missed the hardest finding of its round, a scan that reports clean on an empty fetch. Of
the seven verdicts formed before Opus posted, five agreed, one was stricter (an unpinned
rollback exit Opus had not flagged, LIN-2772), and one was that miss. On LIN-2121 it saw
the same data-path surface as Opus and graded it an outside monitor where Opus probed the
magnitude and made it a hard gate. It finds the surfaces; where it differs is grading.
About $0.95 a review in the bake-off, $0.01 to $0.03 relayed for the evening's four.

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

**Carries a thin ticket alone.** LIN-2121 had no plan, one paragraph and a recommendation.
It read the code, stamped the identifier at the one mint site, wrote the scoped-read test
red first, surfaced its own cross-surface effects with a not-proven note, and opened a
green PR in about thirty minutes. Opus found one hard gate item it had understated, a
KPI attribution flip on a data path, and the same session fixed it in a follow-up with the
reviewer's probe as the test. Merged and Done. One ticket.

**Closes out a reviewed ticket.** LIN-2121's own close-out, after a human read the ledger:
merged, verified on the landed commit, Done, in two minutes. Its first launch died before
any tool ran (the opencode server was not ready in twenty seconds); the retry worked.

**Not tried:** a page, anything over an hour, research, plan. Its launch is the one that
failed twice on LIN-2787's prompt with an HTTP 500 from the opencode server before any
tool ran, while it completed LIN-2121 in the same hour; the failure is the harness's, not
the model's.

## DeepSeek V4 Flash, 0731 (opencode, OpenRouter, no effort field)

**Implements grounded small tickets; two of two within one round.** LIN-2697 approved
first pass with an empty ledger in 10 minutes; LIN-2637 sent back for one missing test on
a second call path, fixed in a test-only commit and approved on re-review, 28 minutes plus
16. Under a cent relayed for the three sessions. Cheaper on OpenRouter's list than V4.1
Flash. Two tickets is too few to prefer it; enough to keep trying it, and on bigger
tickets than these.

**Implements an hour-plus grounded ticket across a provider and its docs.** LIN-2787: the
Linear provider's team-scoped label query, the proxy docs contract, the instructions
catalogue and a regression test observed red with the ticket's exact symptom, 35 minutes,
green PR. Opus and the shadow each found the same inherited pagination item cold; the docs
caveat Opus asked for was done in-session. Merged and Done. One ticket, so a reason to give
it another, not a boundary.

**Implements a client-side page behaviour ticket single-shot.** LIN-2772: proposal
persistence in the Flight Companion client, a red-first end-to-end test, three red-first
unit tests and one mutation check, 23 minutes. The shadow was stricter than Opus on one
unpinned rollback exit; the same session pinned it on request. Merged and Done.

**Carries a stepped run.** LIN-2771, four beats drip-fed into one warm session by the
conning session: a grounding map that caught its own wrong-repo slip; the wall-clock
anchor with three red-first tests each mutation-witnessed; the stop-reason half with four
more, plus a server-rendered attribute it argued the ticket's rule required; then push, PR
and CI, during which it merged main and resolved a conflict with LIN-2772 itself. Every
beat reported its decisions rather than burying them. Opus and the shadow approved
conditionally on the same two surfaces; the three items were closed in one follow-up.
Whether stepping beat single-shot cannot be read from one pair, because the stepped ticket
was the harder of the two; what can be read is that the beat discipline produced the most
legible work of the day.

**Writes research an Opus plan-review takes seriously.** LIN-2153 and LIN-2322, each in
under 25 minutes for a third of a cent: file-and-line citations across both repositories,
the relevant papers read, a per-provider comparison table, a staleness check that found one
ticket's motivation had grown since filing, and on LIN-2153 the finding that the proposal
collides with the manual's own doctrine. Neither plan-review faulted the research.

**Plans that go round twice.** On both tickets the Flash plan was sent back twice by Opus
plan-review, each time on the class bound rather than a member: a class bounded by symbol
where the behaviour was the class, then a grep pattern blind to a syntactic family. Six
of seven checks passed on the second round. The gate sends 88% of plans back once and a
third back twice, so two rounds is within the population, and the thread stopped there.
One second-round plan session hung for an hour with no output and was aborted; the retry
finished in 17 minutes.

**Closes out reviewed tickets, empty ledger or not.** Four close-outs: LIN-2697 (empty
ledger), LIN-2772, LIN-2787 and LIN-2771 (non-empty, each after a human read and accepted
the items on the ticket). Each merged, verified on the landed commit, set Done, cited the
acceptance item by item, and filed only outside items. LIN-2787's ran the review's own
post-deploy check against the live site; LIN-2771's built a five-scenario browser repro
against a server with no AI key to discharge the one item nobody had, unasked. Two to ten minutes each, under a cent each. The
Opus control on LIN-2637 did the same in three minutes for $3.44 and its terminal marker
never reached Harbour.

**Not tried:** a visual layout, a lane, a multi-session ticket, review as a gate, and a
ticket whose ledger a human has not read first.

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
- The subscription's share of a cheap-implemented ticket was two Opus sessions, review and
  close-out, about $8.80. On the evening's four landed tickets it was one: the Opus review,
  $2.83 to $4.25, with implementation, follow-ups and close-out on Flash for under a cent
  a ticket. The condition was that a human read the ledger before the cheap close-out ran.
- The harness broke where the models did not. Three of the evening's launches died before
  any tool ran, with seven or eight opencode servers up on one host: two HTTP 500s on the
  first message, one server not ready in twenty seconds. One plan session hung for an hour.
  Every retry worked. The runner's five-minute stall note carries a fixed placeholder
  session id and is not a signal.

## Method

Read from the dispatch lineages under `sessionId: LIN-2828-bakeoff` via
`GET /api/proxy/cost/{identifier}` on 13 September (the bake-off in the morning, the
experiments in the evening), the review, shadow, plan-review and close-out comments on
each ticket, LIN-2831's tables, and the routing proposal's 30-day read for the Opus and
Sonnet entries. The evening's experiments were conned by the same session that wrote this
edition, which also acted as the stepper's orchestrator and as the reader of each ledger
before a cheap close-out; John ratified the experiment list and may reverse any acceptance
by comment. Task shape was judged by reading each ticket's description. The
OpenRouter per-ticket figures are the operator's hourly export split by session-minutes,
because Harbour's relay reports the final turn only (LIN-2835).

## Limits

One run of small tickets chosen to be safe, one evening of one ticket per new shape, plus
one 30-day read of the defaults. Every new shape rests on one ticket, so each new sentence
is a first sighting, not a rate. The stepper comparison is confounded: the stepped ticket
was the harder of the pair. The two plan threads were confounded by the conning session's
own concurrent merges moving HEAD under one of them. The ledger acceptances that preceded
three cheap close-outs were written by the conning session on John's mandate, not by John.
The shape vocabulary is a reading, not a measurement. In particular it
should not be read as a ranking: the models with the thinnest entries are the ones with
the least evidence, not the least ability.

## Next

- Run the fleet week with this edition consulted by hand, and write edition 2 from every
  place it was wrong or silent.
- Give DeepSeek V4 Flash 0731 five more grounded small tickets, and Flash V4.1 one page,
  one thin ticket and one over an hour, each named as an experiment on its ticket. Then
  go bigger: a multi-session ticket or a short lane on whichever Flash did best.
- Run five more cheap close-outs, each with a human reading the ledger first, and count
  what each filed against the review's outside list.
- Give Flash a plan on a ticket whose class is small enough to bound in one query, and
  see whether the second round clears when nothing moves under it.
- Run the stepper pair the other way round, the easier ticket stepped, before reading
  anything about stepping from LIN-2771.
- Read the opencode logs for the gpt-oss-120b and Llama sessions before they rotate.
- Add stepper entries: the same shapes, stepped, on a model that failed them single-shot.
