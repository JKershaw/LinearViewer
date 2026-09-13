---
title: How should Harbour learn which model can do which task?
version: 1
date: 2026-09-13
authors: [Claude, John Kershaw]
model: by hand, by the session that conned the cheap-implementer bake-off, over the read-write proxy
grounded_at: 85584846 (LinearViewer), d3c27c4 (simple-dispatcher)
cites: [lib/prompts/meta-prompt-template.js@85584846:129-230, lib/dispatch-factory.js@85584846:503-512, lib/proxy-instructions.js@85584846:706-713, docs/papers/harbour/cheap-implementer.md (v3, 2026-09-13), docs/reviews/model-effort-routing-proposal-2026-09-11.md, docs/papers/harbour/capability-ledger.md (v1, 2026-09-13), LIN-2828 (comments 2026-09-12 and 2026-09-13), LIN-2831 (2026-09-13)]
---

# How should Harbour learn which model can do which task?

By keeping one short paper, in plain English, that says for each model what it has been
seen to do on Harbour's own tasks, how that was judged, where it failed, what it has never
been tried on, and what it cost, with every sentence citing the tickets behind it; by
rewriting that paper from the evidence after every run that adds to it; and by having the
router read it. The first edition is `capability-ledger.md`. The bake-off of 12 to 13
September showed that everything needed to fill it already exists: every dispatch records
the model and the kind, every review records a verdict and a ledger, every close-out
records what merged, and Harbour's cost lineages join them. What was missing was the
record itself, and a rule that reads an absent entry as unknown rather than fine.

## Findings

**Harbour routes by kind today, not by capability.** The meta-prompt chooses the next verb
for a task, research, plan, implementation, review, close-out, from the task's own state
(`lib/prompts/meta-prompt-template.js:129-230`). The model is then chosen by precedence,
explicit request, then preset, then the anchor's preset, then the workspace default
(`lib/dispatch-factory.js:503-512`). Nothing in either seam consults a record of what any
model has done on a task of this shape. The routing proposal of 11 September set the
defaults from a 30-day read of 1,068 sessions, and its own first line says it is a
proposal, not a mechanism: the numbers were read once and the table typed by hand.

**The evidence to fill a capability record is produced by every monitored run for free.**
The bake-off's thirteen tickets and its five floor tickets each left a model, a harness, a
kind, an Opus verdict, a ledger, a merge commit and a cost lineage, none of which was
recorded for the bake-off's sake. The routing proposal's survival read (implementation on
Sonnet approved first pass 97 of 115 times) came from the same instruments. So the cost of
keeping the record is the cost of writing it down, and the cost of growing it is the cost
of choosing what to try next.

**Prose carries a boundary and its uncertainty in one sentence; a table cannot.** A
model-by-task-shape table has cells of two or three tickets for months: the routing
proposal's Opus implementation cell held nine, the bake-off's Gemini cell two, the floor
run's cells two each. A cell of 2 of 3 is a number a router cannot act on. "Flash approves
first time on grounded test-heavy library tickets, has never been given a page, and the one
layout GLM was given it missed" is something a router can act on, because it says what is
known, what is not, and where the edge was found. The meta-prompt already reasons in prose
from grounded facts, so the record should be written in the shape it reads.

**An absent entry must route to the model that can do every step.** The floor run's
gpt-oss-120b sessions each reported a terminal marker inside a minute, one `[done]` after
fifteen tokens and one `[failed]` naming a file that exists, and Harbour's markers could not
tell either from a finished ticket. A ledger that is silent on a model and a shape is not
evidence the pair is safe. The rule is: the cheapest model whose entry covers this shape
with a first-hand record, and Opus when no entry does. Novel shapes go to Opus because they
are unknown, not because they are hard, and the ledger grows when someone decides to try a
cheaper model on that shape and says so on the ticket.

**The judge is fixed, and routing never changes it.** Every entry's label is an Opus review
at the effort the routing proposal set. If a cheaper reviewer replaces Opus on some class,
the labels for that class drift with the reviewer, and the ledger stops being comparable
with itself. The shadow-review record in the bake-off (two cold agreements, one cold miss on
the hardest finding) is the beginning of a case for a cheap reviewer on some shapes, but
that decision is made on the ledger, and the ledger is written by the fixed judge.
Routing that changed the reviewer would be marking its own homework.

**The stepper is a second axis, not a second row.** A single-shot task has one boundary per
model. A stepped task (`variant: stepper`, `lib/proxy-instructions.js:706-713`) decomposes
the worker prompt into ordered beats drip-fed into one warm session, judged between beats,
so a model has to hold less at once and a stronger model can sit at the wheel. A model that
fails a shape single-shot may pass it stepped, and two cheap models alternating as steppers
is a configuration with its own entry. The ledger describes a configuration, model plus
harness plus variant, and says which shapes it has been seen to carry.

**Growth is chosen, and a chosen experiment is a safe one.** The bake-off ratified its
tickets on the parent, ran each through the same review and close-out as a Claude session,
and never landed a cheap PR without an Opus verdict. That is the whole safety design, and it
is already the house process. A ledger edition names what was tried and why; a ticket that
tries a new pair says so; the review gate is unchanged whatever ran the work. A wrong ledger
entry costs a send-back. A model that regresses after a provider change loses its entry when
the next few tickets fail, because the entry is rewritten from the evidence, never appended
to.

## Method

An edition of the ledger is written from the dispatch lineages since the previous edition,
read over the proxy: `GET /api/proxy/cost/{identifier}` for model, harness, kind, cost and
duration per session; the review and close-out comments for the verdict, the ledger and the
merge; the ticket description for the task's shape. The classes are the configuration
(model, harness, variant, effort) crossed with the task shape, described in words: how well
grounded the description was, what surface the change touched (tests, docs, library code,
a route, a page, a data path, a contract), how large it was, whether CI could prove it, and
which kind it was. Each entry cites the tickets it rests on and says how many there are.
The router consumes the edition as a block in the meta-prompt once an edition has been used
by hand for a run and corrected, so that the sentence shape a router needs is learned
before it is wired. This paper and the first edition were written together and check each
other: the method claims the record can be kept, and the edition is the proof that it can.

## Limits

This is a design with one run behind it. The bake-off chose safe tickets, so the first
edition is biased toward success on small grounded work and silent on everything else. The
task-shape vocabulary is chosen by the person writing the edition and is not yet computed
by Harbour; a later edition could stamp it at dispatch time, which would make the shapes
comparable across editions. Effort has no data at all in either source. The judge is one
model at one effort, and the ledger inherits whatever that reviewer systematically misses.

## Next

- Write and use the first edition (done alongside this paper), then run the fleet week with
  the ledger consulted by hand and write the second edition from what it got wrong or
  could not say.
- Stamp a task-shape record on each dispatch item, computed from the issue and the
  workspace, so editions can be built from a query rather than a reading.
- Wire the current edition into the meta-prompt as a routing block once the second edition
  exists, with the absent-entry rule as its first line.
- Give the stepper its own entries: the same shapes, stepped, on the cheapest model that
  failed them single-shot.
- Grow the ledger upward as well as sideways: give the models that cleared small tickets a
  bigger one each, since a thin entry measures how little was tried, not how little the
  model can do.
