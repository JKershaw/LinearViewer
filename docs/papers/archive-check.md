---
version: 1
date: 2026-09-12
authors: [Claude, John Kershaw]
model: claude-opus-5, effort high, harness null in lineage (dispatcher default claude-code)
grounded_at: 46c155cf
cites: [docs/papers/archive-proposal.md@46c155cf:16-33, docs/papers/writing-length.md@46c155cf:38-41, docs/papers/efficiency-levers.md@46c155cf:14, docs/papers/proposals.md@46c155cf:1-11, LIN-2788 2026-09-11, LIN-2800 2026-09-12, LIN-2801 2026-09-12, PR #1445 review 2026-09-11, PR #1454 review 2026-09-12]
---

# What the archive proposal got wrong

Three papers were written under `archive-proposal.md` version 2 in two days. Its two rules
held; its header did not, and the contract those papers followed was never in the archive.

## Findings

**Model attribution: confirmed, and flagged at the second paper.** The proposal fixes the
header as "version, date, authors, the commit it was grounded at, and what it cites … the
whole contract for now." The review of PR #1445 objected the same day: "`authors: [Claude,
John Kershaw]`. John proposed the question; the dispatched session wrote the paper. Proposer
and author are different roles; worth settling as a convention now." LIN-2788's merge comment
deferred it to "the archive's next paper or a version 2". Two papers later the line is
unchanged in all four. The lineage answers what the header cannot: each was dispatched to
`claude-opus-5` at effort `high`, one session: $7.93, $23.56, $7.90. The
conflict-of-interest note in the briefs — "the same model family" — understates itself:
one model at one effort, and this check is its fifth run. Correction to this paper's brief:
the lineage carries model and effort but reports `harness: null` on all four runs — a
dispatcher default, not a reading.

**Citation locators: confirmed; the checkers pay for it.** The levers paper's `cites:` is
five paths for a table whose 37 rows point at some sixty documents and tickets;
`writing-length.md` cites `docs/reviews/`, a directory of 47 files. Reviewing #1454 the
checker supplied by hand the locators the paper omitted — "`EFFORT_READOUT_HISTORY_LIMIT =
200` at `routes/dashboard.js:141`", `lib/effort-readout.js:70,75`,
`lib/plan-review-round-trips.js:21-24`. The format was already in the archive: one levers cell
reads `docs/dispatch-integration.md:426`. Once, in four papers.

**The Next section: confirmed.** Only the proposal has one; it commissioned this paper.
`proposals.md` gained two lines in two days, both minted by the operator in standalone commits
(`33c524d9`, `d69fb510`), not by a paper. Three papers landed and proposed nothing. When
#1454's checker found the follow-through — "the paper refutes the round-trips module's
'0-vs-1' pin but does not open a ticket for it … the pin should get a ticket" — it went into a
PR comment, where it remains.

**A fourth, larger than the three: the working contract is not in the archive.** Rule 1 says
"The files are the record." But the word caps (800, 900, 200), "findings first, then what
could not be measured", the 40-line query block and the order to keep "the same five-line
header … and nothing added to it" appear only in the three dispatch briefs. All four obey
them; the proposal states none. Two consequences. A writer who noticed the missing model field
was forbidden by the brief to add it — the gap was locked in, not overlooked. And the
compression the proposal claims by example was not inherited: the four papers run 325, 935,
1,261 and 2,563 words, `writing-length.md`'s three-month curve reproduced in two days.

## What it got right

Both rules, and the cut. No derived reading has drifted, because none is stored. Every finding
above rests on evidence the proposal's author could not have produced: rule 2 working. The
10.5× cut of version 1 is still, per `writing-length.md`, "the only compression in this data
set". Version 3 keeps all three.

## Next

Added to `proposals.md` here:

- Whether a check by a different model or effort finds different things: every paper so far,
  this one included, ran `claude-opus-5` at `high`.
- What else is contract only in a ticket brief: the header, the caps and the body shape were;
  no sweep of briefs has been done.
