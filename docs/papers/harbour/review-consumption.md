---
title: Which of a review's sentences does the close-out actually cite, discharge or act on?
version: 2
date: 2026-09-18
authors: [Claude]
model: claude-opus-5, claude-code, effort medium, kind research (dispatch item dba57115, LIN-2911); version 2 rewritten the same day, rebased onto current main and corrected after an independent review (comment 3106897e) found the sentence table did not reconcile with the committed marks and the word-weighted shares had no committed basis
grounded_at: 4919ec0a (LinearViewer, origin/main)
cites: [lib/prompt-template-defs.js@4919ec0a:1061, lib/prompt-template-defs.js@4919ec0a:1074, lib/prompt-template-defs.js@4919ec0a:1082, lib/prompt-template-defs.js@4919ec0a:1146-1152, lib/prompt-template-defs.js@4919ec0a:1194, docs/papers/harbour/ticket-record-and-quality.md (v2, 2026-09-18, PR #1503), docs/papers/harbour/writing-length.md@4919ec0a, LIN-2442 (review 1d7c33a7, close-out 37e3ebcd, 2026-09-01/02), LIN-2468 (review dbae9972, close-out 7949478e, 2026-09-04), LIN-2516 (review 08261320, close-out e5b61dc2, 2026-09-04), LIN-2540 (review cbdd5998, close-out 09134881, 2026-09-05), LIN-2572 (review ca99a943 2026-09-12, close-out 9eddfc53 2026-09-13), LIN-2622 (review 56acfe69, close-outs d137f60f and d1fc9e1c, 2026-09-05), LIN-2648 (review 9691eca0, close-outs 5b02d76d and 55e31406, 2026-09-05), LIN-2697 (review da6079c6, close-out 93d25e41, 2026-09-13), LIN-2716 (reviews 6415ab9f and 3a77e67a, fix comment c39786fa, close-out 3b08385b, 2026-09-11), LIN-2755 (review ba383376, close-outs ec304bfe and b2006cf7, 2026-09-12), LIN-2468 (plan review b61126fe, revision 1af2b6de, 2026-09-04), LIN-2516 (plan review f65ff3a5, revision e467eb5b, 2026-09-04), LIN-2622 (plan review 55455a9c, revision abc2f8a7, 2026-09-05), independent review (comment 3106897e, 2026-09-18)]
---

# Which of a review's sentences does the close-out actually cite, discharge or act on?

About half. Across ten final reviews — 957 sentence units, drawn from 17,292 words of review
text — the close-out consumes **48% of the sentences** (463 of 957); the implementation's fix
round consumes **none**, because in all ten the final review is an Approve and nothing is fixed
after it; and 52% is consumed by neither. The split is not even across the review. The
`### What CI Did Not Prove` ledger is read almost completely (97% of its sentences), the findings
47%, and the method and check narration — the largest section at 45% of the review — only 25%.
The review's consumed half comes mostly from its ledger and findings together (61% of everything
consumed); the leftover is mostly the account of how the reviewer checked things (65% of
everything left over is method/check narration).

## Findings

**The ledger is the artifact; the rest is context.** The ledger is 20% of a review's sentence
units (187 of 957) and carries 39% of everything the close-out marks consumed (181 of 463). 181
of its 187 sentences were consumed. The six that were not are table headers and one framing line.
This is exactly what the templates specify — review is told the ledger is "the artifact the
`close-out` step consumes" (`lib/prompt-template-defs.js@4919ec0a:1061`) and close-out is told to
gate on it (`:1146-1152`) — and it is the only part of the contract the data shows working end to
end. LIN-2442's close-out (`37e3ebcd`) dispositions all eight ledger rows in a table of its own;
LIN-2716's (`3b08385b`) dispositions all ten.

| Section | Sentences | Consumed by close-out |
|---|---|---|
| Ledger | 187 | **97%** (181/187) |
| Findings (incl. class check) | 215 | 47% (101/215) |
| Verdict | 62 | 56% (35/62) |
| Grounding preamble | 64 | 58% (37/64) |
| Method / check narration | 429 | **25%** (109/429) |
| All | 957 | 48% (463/957) |

Every number in this table is a straight sum over `review-consumption-marks.json`'s section
ranges — run `node scripts/review-consumption-recompute.mjs` to reproduce it from the committed
marks file with no re-fetching.

**Nearly half of a review is check narration, and three quarters of it is read by nobody.** Method
and check narration — plan-conformance tables, mutation tables, boundary checks, suite re-runs —
is 429 sentence units, 45% of the corpus, and 320 of those units are consumed by neither close-out
nor a fix round: 65% of everything left over. The mutation evidence is the clearest case. All ten
reviews re-run mutations (4 to 17 each), nine of them tabulated; a close-out cites a mutation row
only when a finding or ledger item already names it — M4 and M8 in LIN-2442, M1 in LIN-2716,
M2/M3/M7/M8/M9 in LIN-2716's ledger. LIN-2516's seventeen-mutation table and LIN-2540's ten-row
table are cited nowhere in their close-outs. The work is not wasted — it is what makes the
findings trustworthy — but its written form is not an input to anything downstream.

**Nothing at all is consumed by a fix round, because the last review never asks for one.** In all
ten sampled tickets the final ledger-bearing review records Approve (eight of them "Approve —
conditional on close-out discharging the ledger", the form `:1082` mandates for a non-empty
ledger), and no comment between that review and the close-out is an implementation fix.
Category (b) is therefore zero by construction, not by accident: the review that carries a ledger
is the last one, and its only consumer is close-out. Where a fix round exists it sits on an
*earlier* review. The sample has one — LIN-2716's first review (`6415ab9f`, Request Changes)
answered by a fix comment (`c39786fa`). That pair consumes 25% of the review's sentences (28 of
111): findings 33% (13/40), ledger 26% (9/34) — two of eight items, the two marked
closure-blocking — method 17% (5/29), grounding 0% (0/6), verdict 50% (1/2). The other six ledger
items survived the fix round unchanged into the second review's ledger, where close-out
discharged them — the same sentences travelling twice.

**Where a close-out does read the narration, it is re-reading, not learning.** The consumed
quarter of the method sections is almost entirely CI lines and suite counts the close-out
independently re-establishes: LIN-2648's close-out (`55e31406`) re-reads run `33969190256` and the
six checks the review listed; LIN-2572's (`9eddfc53`) re-runs the review's 5/5 store suite;
LIN-2442's re-runs the review's 8833-test baseline. The close-out template requires that re-read
(`:1146-1152` — green CI never discharges a ledger item), so these sentences are consumed in the
sense of being checked again, not in the sense of carrying information forward. Strip them and the
consumed share of check narration falls close to the mutation tables' zero.

**The plan gate's consumption runs the other way.** Three of the ten tickets carry a plan-review
verdict. Read against the plan revision that followed, those three plan reviews (189 sentence
units) are 51% consumed by sentence count (96/189) — findings 83% (59/71), verdict 80% (16/20),
method 26% (16/61), grounding 14% (5/37). LIN-2516's revision (`e467eb5b`) answers F1 through F8
in order, restating each correction; LIN-2622's revision (`abc2f8a7`) consumes half of its
twelve-sentence plan review (6/12). A plan review is read almost entirely for its findings and
almost not at all for its checks — the same shape as an implementation review, but with a
consumer that answers point by point rather than dispositioning a ledger.

**Per ticket, the consumed share is stable and the length is not.** The ten reviews run 940 to
2,336 words (median 1,876) and their close-outs 292 to 1,424 words (median 811, taking each
ticket's merging close-out where more than one exists). Consumed share by sentence count ranges
34% (LIN-2622) to 61% (LIN-2648), with no clear relationship to review length: the longest review
in the sample (LIN-2468, 2,336 words) sits in the lower half at 46%, and the shortest (LIN-2697,
940 words) sits in the upper half at 56%. What moves the share is the size of the ledger relative
to the mutation table.

## Method

Population: tickets LIN-2440 to LIN-2910, read at read scope through the workspace API proxy on
2026-09-18 at no more than one call per second, `GET /api/proxy/issues/LIN-n`. A ticket qualifies
if it is Done and not trashed, has at least one comment carrying a `### What CI Did Not Prove`
heading that is neither a close-out nor a plan review and contains a verdict word, and has at
least one close-out comment dated at or after that review. 91 tickets qualify. The fixed sampling
rule is every eighth qualifying identifier ascending, first ten: LIN-2442, 2468, 2516, 2540, 2572,
2622, 2648, 2697, 2716, 2755.

For each ticket the final qualifying review was split into sentence units by script: a paragraph
splits at terminal punctuation followed by a capital, and a table row, a list item and a code line
each count as one unit. Headings, code fences and rule lines are excluded from the counts; 957
sentence units remain across the ten reviews. Each unit was hand-marked (a) consumed by the
close-out — a ledger item it discharges or accepts, a finding it names or files from, a CI state
or suite result it re-reads, a verdict it quotes or gates on; (b) consumed by an implementation
fix comment between the review and the close-out; (c) neither. Where a ticket has more than one
close-out comment (LIN-2622's HELD and merged pair, LIN-2648's pre-merge gate and close-out,
LIN-2755's close-out and its autopilot verification), (a) counts consumption by any of them.
Sections were assigned per heading by hand: grounding preamble, method or check narration,
per-check findings (including the class check), ledger, verdict. The same procedure was run for
the three plan-review verdicts in the sample against the plan revision that followed, and for
LIN-2716's first review against its fix comment.

Every mark and section range is in `docs/papers/harbour/review-consumption-marks.json` beside this
paper, keyed by ticket, with the raw unit indices the splitter produced. Summing a ticket's
section ranges gives its total unit count and, intersected with its `a` array, its consumed
count — directly, with no re-fetching or re-splitting. `scripts/review-consumption-recompute.mjs`
does that summation for all ten final reviews (default), or for the plan reviews or the fix round
(`--block plan_reviews` / `--block fix_round`), and prints the same sentence counts and consumed
shares reported above. **This is the paper's reproducible basis, and the only one**: the marks
file records unit *membership* — which sentence, which section, consumed or not — not the *word
count* of each unit, so a word-weighted share (words consumed ÷ words total, per section or
overall) cannot be re-derived from it. See Limits for what v1 got wrong here and why this version
reports sentence shares throughout instead of trying to patch the word-weighted ones.

The whole-review and whole-close-out word counts above (940–2,336, median 1,876; 292–1,424, median
811) are a different, simpler measurement: a plain word count of each full comment
(`text.split(/\s+/).length` against the body the cited comment id returns), not a per-sentence
tally. They need no splitter and no per-unit data, and any reader can reproduce them by fetching
the cited comment id and counting.

## Limits

The marking is one author's, against the standard's own rule that a paper is checked by a second
paper; the boundary cases are re-reads (a close-out that re-runs a suite the review also ran was
counted as consuming that sentence, which flatters the consumed share) and restatements in a
close-out's "what shipped" prose. Sentence units are not uniform — a ledger row can be 60 words
and a mutation row 10 — so a sentence-weighted share can overstate or understate a section's true
share of a review's *attention* relative to a word-weighted one; which direction that bias runs is
not established here.

v1 of this paper reported a word-weighted answer instead (55% of words consumed, 902 sentences,
15,081 words) and it did not reconcile with its own evidence file: `review-consumption-marks.json`
records marks and section ranges, and summing those ranges gives 957 sentence units, not 902,
while the file records no word count for any unit at all. An independent review (comment
`3106897e`) caught both problems. Reconstructing the word-weighted numbers for this revision was
tried and abandoned: a plain word count of the ten full reviews gives 17,292 words, not v1's
15,081; stripping heading and rule lines from that count gives 16,653, still not 15,081; and
neither approach can say which specific words within a review were marked consumed, because that
requires knowing where each of the 957 hand-marked units begins and ends in the original text, and
that boundary information was never committed — only the unit's index, its section, and whether it
was consumed. Recovering it exactly would mean re-doing the sentence split and the hand marking
together, not just adding a word-count column. Rather than publish a second, differently-wrong
word-weighted number, this revision reports sentence shares only, reproducible end to end from
`review-consumption-marks.json` via the script cited in Method. A reader who wants the
word-weighted answer needs a marking pass that records each unit's text (or at least its word
count) alongside its consumption mark — the standard's second-paper check is the right place for
that, not a second guess layered onto this paper's evidence file.

The rule "last review carrying a ledger" caught a non-gating shadow review in two of ten cases
(LIN-2572, LIN-2697), where close-out gated on an earlier Opus review and consumed both; consumed
shares there are against the shadow review's own text. Consumption by anything other than
close-out and the fix round is not counted — runner and autopilot comments quote reviews too
(LIN-2622's leg summary `b16bac84` cites the mutation count), so (c) is an upper bound on what is
truly read by nobody. The cohort is 18 days of a single tracker under one review template; nothing
here says whether the unconsumed half is worth writing for a human reader, only that no downstream
step cites it.

## Next

Cut the check narration to its conclusions for a fortnight — keep the ledger, the findings, the
verdict and a one-line CI statement, drop the mutation and conformance tables into the PR body or
a link — and re-run `ticket-record-and-quality.md`'s method: if first-pass approval and the
later-found miss rate hold, 45% of the largest comment kind was for nobody. Ask the opposite
question of the close-out: what does it write that no later reader cites? And measure whether a
review whose ledger is a larger share of its sentences produces a faster close-out. A second
paper checking this one's marks should also record each unit's word count as it re-marks, so the
word-weighted answer this version could not reconstruct becomes available for the one after it.
