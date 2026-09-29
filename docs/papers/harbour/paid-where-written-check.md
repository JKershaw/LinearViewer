---
title: Do the sources in "Every Fix Is Paid Where It Is Written" support the readings it gives them?
kind: paper
version: 1
date: 2026-09-30
authors: [Claude]
model: "Frontier tier, Claude Code CLI; effort not recorded in the dispatch item. The same bounded session (dispatch afe16c11, kind custom, LIN-3144) that wrote the essay, so this is a self-check, not an independent one."
grounded_at: feb2f323 (LinearViewer, origin/main)
cites:
  - "docs/papers/harbour/paid-where-written.md (version 1, this PR)"
  - "docs/papers/harbour/steady-base.md@feb2f323"
  - "docs/papers/harbour/steady-base-rules.json@feb2f323, via scripts/steady-base-rules-recompute.mjs"
  - "scripts/steady-base-render.mjs, run at feb2f323"
  - "docs/papers/harbour/fleet-complexity-read.md@feb2f323"
  - "docs/papers/harbour/review-loops.md@feb2f323"
  - "docs/papers/harbour/review-consumption.md@feb2f323"
  - "docs/papers/harbour/what-the-reviews-checked.md@feb2f323"
  - "docs/papers/harbour/efficiency-levers.md@feb2f323:48"
  - "tests/unit/claude-md-line-budget.test.js@feb2f323:28-53"
  - 'docs/architecture/prompt-system.md@feb2f323:10, "no longer re-types these rules as prose and they cannot drift"'
  - "35dc0e14 (LIN-1270 commit message)"
  - "LIN-3143 closing comment (2026-09-29) and LIN-3144 description, read over the workspace proxy"
  - "c2.com/doc/oopsla92.html, sunset.texas.gov, nao.org.uk Business Impact Target report page (all read 2026-09-30)"
---

# Do the sources in "Every Fix Is Paid Where It Is Written" support the readings it gives them?

For the draft as first written: every figure matched its source, but eleven sentences read
more into a source than it says, and one read a headline its own table does not bear out. All
twelve are corrected in version 1 as filed. None changed the argument. Most narrowed a claim:
"about 1%" became "at most about 1%", "fivefold" became "four- to sixfold", "almost none was
removed" became "almost no rule was retired". The weakest part of the evidence is the
structure beneath it rather than any single number. Most of the essay's Harbour figures come
from one paper, which is itself unchecked, and this check was written by the essay's own
session.

## Findings

**Every figure matches its source.** The Harbour figures were read in the paper that measured
them, and the ones that can be re-run cheaply were re-run at `feb2f323`.

| Essay's claim | At the source |
|---|---|
| Guide to writing prompts: 103,568 bytes, about 26,000 tokens | `steady-base-render.mjs`: 103,568 bytes, ~25,892 tokens ✓ |
| Review and close-out fixed text (via the growth claim) | render: review 19,760, close-out 19,799 ✓; paper's table: May review 3,825 (5.2×), June close-out 4,374 (4.5×), May meta-prompt 18,299 (5.7×) ✓ |
| 102 of 112 dispatched prompts model-written; median digest ~7 KB | steady-base §Findings ✓ |
| Dispatched prompt about 2% of carried context | 1.6% pooled, 1.9% median leg ✓ |
| Close-out lineage: ten tickets, 71 KB, eight changed no runtime code, none added a firing check, last four within 14 days | steady-base lineage table and text ✓ (LIN-550 changed registration only; LIN-1365 preamble plumbing) |
| Merge-and-closure gate written in six places, no code refuses without it | steady-base ✓; a grep at `feb2f323` finds the "recorded … Approve" wording in `lib/proxy-instructions.js`, `lib/proxy-preamble.js` and `lib/prompts/meta-prompt-template.js`, and no line in `routes/proxy-writes.js` that pairs a Done transition with an Approve or ledger check |
| 213 census rules: 8 runtime, all in the briefing; ~6 in 10 pinned; 175 restated; 55 convertible; 2 risk-specific | `steady-base-rules-recompute.mjs`: 8 / 131 (61%) / 175 / 55 / 2 ✓ |
| 221 prompt-text commits, 17 left it smaller; 5 of 101 citations left | steady-base ✓ |
| #462: −19%, caution prose 43%, 38,643 bytes seven days later, 72,812 three weeks later | steady-base ✓ |
| 493 text-match assertions, 279 at end of June | steady-base ✓ |
| Comments a fifth of net new production lines before June, 45–55% since; plan-label citations 0 → 688; test per net new production line ~1 → 2.94 | steady-base ✓ (1.04 in June) |
| 89 finished tickets: median 10 comments, 6,063 words; descriptions no trend | steady-base ✓ (497, 317, 584, 521 words by month) |
| Review loops: gates 30% of priced cost, re-passes 9%; 11 of 94 plans approved first time | review-loops table and first paragraph ✓ |
| 48% of review sentences consumed; ledger 97%; method narration 25% | review-consumption ✓ |
| LIN-3131: two extra rounds, 43% of wall-clock, ~26% of tokens, no production change | fleet-complexity-read §2 ✓ |
| LIN-3133: 41 queue items, 60 minutes, both reviews changed nothing, John 10–20 min | fleet-complexity-read §2, §4 ✓ |
| LIN-3124 PR3: about seven credential bugs CI missed, including a healthy connection deleted and a refresh-token double spend | fleet-complexity-read §2 (blockers 3 and 8) and §4 ✓ |
| "27 of 27 green" after deleting the code | efficiency-levers line 48 ✓ |
| Seven genuine misses: no further review round would have caught one | what-the-reviews-checked, first paragraph ✓ |
| Budget: 110 lines, 12,000 bytes; 153,845 → 9,174 bytes; now under the cap; docs grew ~21 KB | test lines 28–29 ✓; `git cat-file -s d4f749c1^1:CLAUDE.md` 153,845 ✓; `CLAUDE.md` 9,806 bytes at HEAD ✓; `docs/architecture` 147,422 at `d4f749c1` → 168,768 at `8f5fe4aa` ✓ |
| Budget failure message quoted | test line 43 ✓ |
| LIN-435: "no longer re-types these rules as prose and they cannot drift" | prompt-system.md line 10 ✓ |
| LIN-1270: "never fires in practice", "zero clean fired notes" | commit message of `35dc0e14` ✓ |
| Cunningham: "every minute spent on not-quite-right code counts as interest on that debt" | c2.com ✓ |
| Texas: abolished "unless the Legislature passes a bill to continue it"; since 1977, 42 abolished, 54 consolidated | sunset.texas.gov home page ✓ |
| NAO: £8.3 billion outside scope "greatly exceed" £0.9 billion inside, 29 June 2016 | NAO report page ✓ |
| John's two hours of full concentration; thorough, consistent, always on; trends upward | LIN-3144 description ✓ |

**Twelve readings went past their source, and each is corrected.**

1. *Loops.* The draft said every send-back the review-loops study read "asked for one more
   item in a list". That is the paper's headline, but its own breakdown of eight verdicts is
   four missing members, two reconciliations, one unhandled case and one failed re-derivation.
   The essay now gives the breakdown. "None asked for a different design" holds.
2. *Priced money.* Review-loops' cost column covers the priced subset only (119 tickets report
   no dollars). "Priced" is added.
3. *Token saving.* The paper says halving the rule text would save "at most about 1%". The
   draft dropped "at most".
4. *Which tickets.* The 89-ticket comment median is over LIN-2951 to LIN-3140, not "tickets
   closed in September". Reworded.
5. *Flat descriptions.* 497, 317, 584 and 521 words is no trend, not flat. Reworded.
6. *Pins.* A text-match test fails when a *pinned* sentence is deleted, not any sentence.
7. *Test ratio.* "Up from one" is June's 1.04. Before June it was 0.57–0.79. The essay now
   says "about one in June".
8. *The cutover.* PR3 was a cutover of how credentials are *read* and refreshed, not how they
   are stored. Reworded.
9. *Where review paid.* The draft said credentials, auth, data and external contracts "are
   where review has found real bugs". The sources show that for the credential cutover only.
   The others are protected by the proposal's design, not by a measured catch. Reworded.
10. *Seven misses.* They are seven of thirteen later-found bugs on reviewed tickets. The draft
    blurred the population.
11. *Growth range and removal.* Close-out grew 4.5×, so "five- to sixfold" became "four- to
    sixfold". "Almost none of it was ever removed" was wrong as well. The commits removed
    204,851 bytes, mostly in rewrites. What almost never happens is a rule being *retired*.
12. *The NAO figure.* The £8.3 billion is expected costs so far in that Parliament. The draft
    left out "expected".

**One inference is the essay's own and is labelled as such.** Section 7 says the merge rule
"is in the preamble added to every dispatch, this one included". The steady-base paper lists
the proxy preamble as one of the six places. That this session's preamble carried it was seen
directly in the dispatch item. That the LIN-3143 session's preamble carried it is inferred
from the preamble being added to every dispatch, not read from that session's transcript.

**One mismatch is between sources, not in the essay.** The steady-base paper gives the gates
and their re-passes as "38% of dollars". Review-loops' own table gives 30% plus 9%, which
reads as 39%, with rounding presumably accounting for the gap. The essay cites review-loops'
two figures directly and does not sum them.

## Method

Every sentence in the essay that carries a number, a quotation or an attribution was listed
and compared with the passage it cites. Harbour figures were read in the document that
measured them. The rule-inventory counts and fixed prompt sizes were re-run with the paper's
own scripts (`steady-base-rules-recompute.mjs`, `steady-base-render.mjs`) at `feb2f323`. The
`CLAUDE.md` split sizes were re-run with the paper's `git cat-file` and `git ls-tree` lines.
The quotations from the budget test, `prompt-system.md` and the LIN-1270 commit were read in
the repository. The three outside sources were read at their URLs on 2026-09-30.

## Limits

- **Not independent.** The session that wrote the essay wrote this check. It can catch a
  number misread. It is much weaker at catching a reading the author already believes, and
  every correction above narrows a claim in the direction the author was already hedging.
- **The paper under the essay is unchecked.** Most Harbour figures come from `steady-base.md`,
  whose own limits say it has no second document. This check confirms that the essay reports
  the paper correctly. It does not confirm the paper. Only the render sizes, the inventory
  counts and the `CLAUDE.md` split were re-measured.
- **Outside sources read as pages, not as papers.** The NAO figures come from its report page
  and the Texas figures from the commission's home page, which is the commission's own
  account. Neither report was read in full.
- **Sources the essay does not have.** A check can test the sources an essay uses, not the
  ones it lacks. The organisational literature on rule accumulation and regulatory sunsets is
  larger than the two cases cited here.

## Next

An independent reader should check the paper before anyone relies on this essay's figures. The
paper's Next, a hand-built firing record for the review and close-out rules (already in
`proposals.md`), would also test the essay's central claim directly.
