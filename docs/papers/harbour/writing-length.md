---
title: Does the writing get longer faster than the ideas do?
version: 2
date: 2026-09-12
authors: [Claude, John Kershaw]
model: claude-opus-5, claude-code, effort high (the study, LIN-2788); this edition rewritten by hand
grounded_at: 894b328
cites: [docs/reviews/@894b328, CLAUDE.md@894b328, docs/reviews/comprehension-debt-review-2026-08-23.md@894b328, LIN-2788 (2026-09-11)]
---

# Does the writing get longer faster than the ideas do?

Yes, by about 1.6×. Over three months the length of Harbour's reviews roughly tripled while
the count of distinct things they say roughly doubled. The gap between those two numbers is
the part of the writing with no idea behind it.

## Findings

**Reviews grew 2.6×; their findings grew 1.6×.** Across the 42 reports in `docs/reviews/`,
the mean report went from 1,946 words in June to 5,076 in August. Counting a labelled finding
(F1, H3, D5) as one idea, findings per report went from 4.9 to 8.0 and words per finding from
400 to 659. Half the growth is more findings; half is more words per finding. All seven
periodicals with more than one edition grew from first to last, by 1.9× to 7.2×. None shrank.

**`CLAUDE.md` grew 11.5× while its section count fell.** From 1,656 words under 57 headings
in January to 19,008 words under 32 headings in September. The June restructure explains the
drop in headings; inside the regime it created, the file went from 5,212 to 19,008 words with
the headings almost unchanged. The outline stopped growing and the prose did not.

**The tracker split in two.** In a sample of 111 issues, description length shows no trend.
Comment words per issue went from 1,201 in June to 4,332 in August, 3.6×. What lengthened is
the conversation about the work, not the statement of it.

**The one compression was deliberate.** The archive proposal's first version ran 3,414 words;
its second, the same proposal, ran 325. It is the only compression in the data, and it
happened because someone asked for it.

**The instrument that should have caught this never fired.** All three comprehension-debt
reviews declare rationale inflation, "manufactured explanation for self-evident code", a
finding class in its own right. None records one. Over the same three editions the reports
went from 1,227 to 2,467 words while their finding counts went 2, 4, 1.

## Method

Reviews: words and labelled findings per report, aggregated by the month in the filename.
Periodicals: first edition against last. `CLAUDE.md`: words and headings at the last commit
of each month. Tracker: every 25th identifier from LIN-25 to LIN-2775, description and comment
words by creation month.

```sh
for f in docs/reviews/*.md; do
  echo "$(echo "$f"|grep -oE '[0-9]{4}-[0-9]{2}') $(wc -w <"$f") $(grep -cE '^#+ +\**[A-Z]+[0-9]+\b' "$f")"; done
git log --format='%h %ad' --date=short --reverse -- CLAUDE.md | while read h d; do
  c=$(git show $h:CLAUDE.md); echo "$d $(echo "$c"|wc -w) $(echo "$c"|grep -cE '^#+ ')"; done
for n in $(seq 25 25 2775); do curl -s "$HARBOUR_LOCAL_BASE/api/proxy/issues/LIN-$n"; echo; sleep 1.1; done
```

## Limits

A labelled finding is not an idea, and a report that splits one concern into three scores
three. That error understates the gap, so 1.6× is a floor on idea growth and the surplus is a
ceiling. Ceremony was never separated from content: the periodicals share no section
vocabulary, so no classifier could split method from finding. The late editions' new sections
are themselves apparatus. The tracker sample is uniform over identifiers, not time, and comment
words include machine-written dispatch feedback. Nothing measured whether longer writing is
better.

## Next

Separate ceremony from content by hand on a sample of ten reports, two per month, and report
the share of words that are method, provenance or limitation prose rather than finding.
