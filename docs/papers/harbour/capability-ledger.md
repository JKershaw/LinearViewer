---
title: What has each model been seen to do on Harbour's tasks?
version: 3
date: 2026-09-14
authors: [Claude, John Kershaw]
model: by hand, by the session that conned the cheap-implementer bake-off, over the read-write proxy; the runs it reports ran as their own lineages say
grounded_at: fcd0a71 (LinearViewer), 7617b731 (simple-dispatcher)
cites: [docs/papers/harbour/cheap-implementer.md (v6, 2026-09-14), LIN-2875 (run brief and the driver's summary comments, 2026-09-14), LIN-2873 and simple-dispatcher PR #234, LIN-2872 and PR #1493, LIN-2837 and simple-dispatcher PR #235, LIN-2874 and LIN-2835 (research comments, 2026-09-14), LIN-2876 to LIN-2881, docs/reviews/cheap-implementer-bakeoff-2026-09-13.md, docs/reviews/model-effort-routing-proposal-2026-09-11.md, docs/papers/harbour/capability-ledger-method.md (v1, 2026-09-13), LIN-2831 (results, close-out and floor tables, 2026-09-13), LIN-2828 (voyage log, 2026-09-12 and 2026-09-13), PR #1470 to PR #1482, PR #1485, PR #1486, LIN-2856, simple-dispatcher PR #233, LIN-2772 and PR #1487, LIN-2121 and PR #1488, LIN-2787 and PR #1489, LIN-2771 and PR #1491, LIN-2153 and LIN-2322 (research, plan and plan-review comments, 2026-09-13), LIN-2828 (voyage log, 2026-09-13 evening)]
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
path, a **multi-session** ticket, or a **lane**. Edition 3 adds **harness code**: three
simple-dispatcher and Harbour tickets that change how dispatches are guarded, reported or
finalised, each a predicate or a state write over the feedback the harness itself emits
(LIN-2873, LIN-2872 with LIN-2869, LIN-2837), and it adds the **autopilot driver** as a
shape for Opus, since this edition's run was driven by one rather than conned by hand.

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

**Drives a run.** LIN-2875, six harness tickets, 226 minutes: read a brief, dispatched four
workers in parallel inside four minutes, parked, and woke on each result. It verified every
worker's claim before accepting it, twice by fetching the shipped predicate and running it
against the real stored rows, which is how it caught two green-CI legs that were wrong. It
waited at every human gate the brief named, refused to write the ledger acceptance
reserved for a human, declined a conning instruction to re-dispatch a research worker once
it had found the permission wedge that would have taken it, and stopped lanes at the
brief's stop conditions rather than loop. It blocked twice on gates a human had already
answered on the ticket, because its own last read was older than the answer. About
seventeen wakes; 150 thousand output tokens, 364 thousand cache writes, fifty million
cache reads; about $32 at Harbour's Opus 5 table, which is what a hand-conned evening cost
on 13 September. The discipline is the reason to use it; the cache-read line is the reason
it is not yet cheap.

**Reads the host where a cheap worker cannot.** LIN-2874 research, eleven minutes, about
$6: found the 502 burst that ate a finalize tail in the dispatcher's oplog, and found that
the other case was unprovable because the reaper had deleted the log, and said so rather
than guess. Two Flash research workers before it had wedged on the permission prompt the
host directory raises.

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
finished in 17 minutes. Its log was reaped before anyone read it, but three sessions the
next day with the same signature each ended on an unanswered opencode permission prompt
(LIN-2874), so the hang was probably the harness, not the plan.

**Researches the harness against its own live servers.** LIN-2835, eighteen minutes, a
fifth of a cent: found four running opencode servers from the same morning, queried each,
and showed the session roll-up equals the sum over its 23 assistant messages to the last
digit, which settled the ticket's open question and named the one-fetch fix. The Opus
driver verified the comment rather than the claim and closed the lane on it.

**Implements harness code, and is green when it is wrong.** Three tickets on 14 September,
all predicates or state writes over the feedback the harness emits. LIN-2873 (the runner's
stalled note): fixed the real defect, an eight-character prefix of an id whose first eight
characters are the same on every session, and also built a fire-time re-read for a cause the
ticket asserted and the code contradicts; Opus review proved the hypothesis false at HEAD
and approved with the dead branch as a named-rollback item. LIN-2872 (exempt a launch-time
failure from the duplicate guard): three legs, each green on seven checks and eleven
thousand hermetic tests, each with mutation witnesses, and the first two returned false on
all three incident rows the ticket was filed for, because the tests encoded the same
assumption as the code about which harness lines mean work. Given the criterion as an
allow-list instead of a symptom, the third leg fixed the three rows first try and
over-fired on a fourth class the criterion had not named. LIN-2837 (surface the provider's
refusal): first leg fixed the three named surfaces and reverted a guard on a terminal
write; second leg guarded that arm and left its sibling; «2837-OUTCOME». The
pattern across both tickets, in the driver's words, is that each pass fixes the instance
it was shown and leaves the adjacent member of the class, and a research pass before the
first leg would have enumerated the class in each case.

**Closes out harness tickets once told to stay home.** LIN-2873's first close-out wedged
ten minutes in on the permission prompt, grepping the host's state directory for a proxy
token it already held. The second, with one line at the top of its prompt saying never to
read outside the clone, merged in five minutes, verified the landed commit, and discharged
the review's monitor item with a live sighting of the fixed note.

**Wedges on a permission prompt when sent outside its clone.** Four opencode sessions in
one morning, two research and one close-out on 14 September and probably one plan on the
13th, each ended on `permission=external_directory` in its own log and heartbeat as busy
until aborted, for between ten and eighty minutes. A prompt line prevented it twice out of
two. The fix belongs to the harness (LIN-2876), and until it lands no opencode worker
should be told to read the host.

**Closes out reviewed tickets, empty ledger or not.** Four close-outs: LIN-2697 (empty
ledger), LIN-2772, LIN-2787 and LIN-2771 (non-empty, each after a human read and accepted
the items on the ticket). Each merged, verified on the landed commit, set Done, cited the
acceptance item by item, and filed only outside items. LIN-2787's ran the review's own
post-deploy check against the live site; LIN-2771's built a five-scenario browser repro
against a server with no AI key to discharge the one item nobody had, unasked. Two to ten minutes each, under a cent each. The
Opus control on LIN-2637 did the same in three minutes for $3.44 and its terminal marker
never reached Harbour.

**Not tried:** a visual layout, a lane, a multi-session ticket, review as a gate, a plan
after its own research, and a ticket whose ledger a human has not read first.

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
  Every retry worked. The runner's five-minute stall note carried a fixed placeholder
  session id until LIN-2873 landed on 14 September.
- Green CI and mutation witnesses did not distinguish a right harness predicate from a
  wrong one. On the 14 September run five of Flash's six deliverables were green and four
  were wrong, and every defect was found the same way, by executing the code against real
  stored rows or against the base branch. Mutation testing proves the tests pin the code,
  not that the code matches the harness it describes.
- An opencode worker that reads outside its clone hangs on a permission prompt nobody can
  answer, and the runner reports it healthy throughout. Four sessions in one morning. One
  prompt line prevents it; LIN-2876 is the real fix.
- Flash research passed the Opus gate every time it was tried, three of three, for under a
  cent each. The three implementation tickets that went round more than once were the three
  where the conning session had judged research unnecessary.

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

Edition 3 adds the 14 September run under `sessionId: e0bbc3a9`, six harness tickets
driven by an Opus autopilot session from a brief on LIN-2875, with the conning session
reading each ledger, answering gates on the tickets and, after the driver finished,
dispatching the last leg and review by hand. Costs for that run are the sessions' own
cumulative usage rows priced at Harbour's Opus 5 table, since the cost endpoint keys on
tickets, not sessions; the driver's row is one cumulative snapshot across its wakes.

## Limits

One run of small tickets chosen to be safe, one evening of one ticket per new shape, plus
one 30-day read of the defaults. Every new shape rests on one ticket, so each new sentence
is a first sighting, not a rate. The stepper comparison is confounded: the stepped ticket
was the harder of the pair. The two plan threads were confounded by the conning session's
own concurrent merges moving HEAD under one of them. The ledger acceptances that preceded
three cheap close-outs were written by the conning session on John's mandate, not by John.
The harness-code entries rest on three tickets in one morning, two of which were
sent round on criteria the conning session wrote, so the miss rate is at least partly the
spec's. The driver cost figure is one run and includes about fifty minutes of idling on a
gate the conning session's watcher missed. The shape vocabulary is a reading, not a measurement. In particular it
should not be read as a ranking: the models with the thinnest entries are the ones with
the least evidence, not the least ability.

## Next

- Put research first on every cheap-worker ticket, including the ones that look understood,
  and count the review rounds against this edition's three.
- Land LIN-2876 and give Flash the LIN-2874 research again, on the same prompt, to see
  whether the permission fix or the prompt line is what it needed.
- Run the fleet week on Flash with a driver whose context is compacted at each beat
  (LIN-2117), and price the driver against this edition's $32.
- Give Flash a plan on a ticket it has just researched, which no run has yet done, before
  reading anything more about Flash plans.
- Run five more cheap close-outs on tickets in the simple-dispatcher repository, each with
  the stay-inside line, and count wedges.
- Try one harness-code ticket on Sonnet, to learn whether green-and-wrong is a Flash trait
  or a shape trait.
- Read the opencode logs for the gpt-oss-120b and Llama sessions if any survive LIN-2877.
