---
version: 1
date: 2026-09-11
authors: [Claude, John Kershaw]
grounded_at: 894b328
cites: [docs/papers/archive-proposal.md, docs/reviews/, CLAUDE.md]
---

# Does the writing get longer faster than the ideas do?

Yes, by about 1.6×, and the surplus is not evenly spread. Length roughly tripled over three
months. The crude count of distinct things being said roughly doubled. The gap between those
two numbers is the part with no idea behind it.

## Findings

**Reviews grew 2.6×; their findings grew 1.6×.** Across the 42 reports in `docs/reviews/`, the
mean report went from 1,946 words in June (18 reports) to 5,076 in August (18 reports). Taking
a labelled finding (`F1`, `H3`, `D5`, `M2` …) as the unit of idea, findings per report went
4.9 → 8.0 and words per finding went 400 → 659. The growth splits almost evenly: half is more
findings, half is more words each. All seven periodicals with more than one edition grew
from first to last — by 1.9× (integration-surface-maturity) to 7.2× (code-quality). None shrank.

**`CLAUDE.md` grew 11.5× while its section count fell.** Across its whole history the file went
from 1,656 words under 57 headings (27 Jan) to 19,008 words under 32 headings (10 Sep) — 29 words
per section to 594, a 20× increase in prose per heading. A June restructure explains the drop
in headings; inside the regime that restructure created, the file still went 5,212 → 19,008
words (3.6×) while headings went 30 → 32. This is the clearest case in the archive: the outline
stopped growing and the prose did not.

**The tracker splits in two.** In a sample of 111 issues (every 25th identifier, LIN-25 to
LIN-2775, of about 2,788 — sampled by identifier, not by date), description length shows no
trend: 763 words per issue in June, 1,290 in July, 534 in August, 614 in September. Comment
volume does: comment words per issue went 1,201 in June to 4,332 in August, 3.6×. What
lengthened is the conversation about the work, not the statement of it. Months before June hold
1–6 sampled issues each and are too thin to read.

**The one counter-example was deliberate.** `docs/papers/archive-proposal.md` version 1 ran
3,414 words; version 2, the same proposal, is 325. A 10.5× cut with no idea removed. It is the
only compression in this data set, and it happened because someone asked for it.

**The instrument that should have caught this never fired.** All three
`comprehension-debt-review-*.md` editions declare rationale-inflation — "manufactured
explanation for self-evident code" — a finding in its own right. None of the three ever records
one. Over the same editions the reports went 1,227 → 2,238 → 2,467 words while their own
finding counts went 2 → 4 → 1. The review that owns the question of explanation outrunning
substance was running the pattern and did not see it.

## What could not be measured

The idea denominator is the weak part. A labelled finding is not an idea, and a report that
splits one concern into three scores as three. But that error runs toward *understating* the
gap — splitting inflates the denominator — so 1.6× is a floor on idea growth and the surplus
above it is a ceiling on the excess, not a point estimate.

Ceremony was never separated from content. The intended measure — the share of a report that is
method, provenance and limitations prose — needs a section classifier the headings will not
support: the six periodicals share no section vocabulary, and the late editions invent sections
(`Adversarial Second-Read`, `Scope decisions`, `Method notes`) with no early counterpart. That
failure is itself a reading. The new sections *are* the growth, and they are all apparatus.

The tracker figures are a sample, uniform over the numbering rather than over time, and comment
words include machine-written dispatch feedback that no query here separates from human comment.

Nothing measured whether the longer writing is better. A report that doubles in length and
doubles in usefulness is not the failure this paper describes, and these queries cannot tell
the two apart. This paper was given an 800-word cap, which is the only reason it is short.

```sh
# 1 Reviews: words + labelled findings per report, aggregated by month (docs/reviews/*.md)
for f in docs/reviews/*.md; do
  echo "$(echo "$f"|grep -oE '[0-9]{4}-[0-9]{2}') $(wc -w <"$f") $(grep -cE '^#+ +\**[A-Z]+[0-9]+\b' "$f")"
done | awk '{W[$1]+=$2;R[$1]++;if($3){w[$1]+=$2;n[$1]+=$3;r[$1]++}} END{for(k in W)printf \
  "%s all:n=%d mean_w=%d | labelled:n=%d finds/rep=%.1f w/find=%d\n",k,R[k],W[k]/R[k],r[k],\
  (r[k]?n[k]/r[k]:0),(n[k]?w[k]/n[k]:0)}' | sort

# 2 Periodicals: first vs last edition
for s in recent-headwinds documentation code-quality drift-coherence design-interface comprehension-debt integration-surface-maturity; do
  set -- $(ls docs/reviews/$s-review-*.md|grep -v lin568); eval l=\${$#}
  echo "$s editions=$# $(wc -w <"$1") -> $(wc -w <"$l")"
done

# 3 CLAUDE.md: words vs headings, at the last commit of each month
git log --format='%h %ad' --date=short --reverse -- CLAUDE.md | while read h d; do
  c=$(git show $h:CLAUDE.md); echo "$d $(echo "$c"|wc -w) $(echo "$c"|grep -cE '^#+ ')"
done | awk '{m=substr($1,1,7);l[m]=$0} END{for(k in l)print l[k]}' | sort

# 4 Specimen: every version of the archive proposal
for h in $(git log --format=%h --reverse -- docs/papers/archive-proposal.md); do
  echo "$h $(git show $h:docs/papers/archive-proposal.md|wc -w)"; done

# 5 Tracker SAMPLE: every 25th identifier, LIN-25..LIN-2775 (111 of ~2788)
for n in $(seq 25 25 2775); do curl -s "$HARBOUR_LOCAL_BASE/api/proxy/issues/LIN-$n"; echo; sleep 1.1; done >s.json
python3 -c '
import json,collections;d=collections.defaultdict(lambda:[0,0,0])
for l in open("s.json"):
 if l.strip():
  i=json.loads(l);r=d[i["createdAt"][:7]];r[0]+=1;r[1]+=len((i.get("description") or "").split())
  for c in i.get("comments") or []:r[2]+=len((c.get("body") or "").split())
for m in sorted(d):n,w,c=d[m];print(m,"n=%d desc_w/issue=%d comment_w/issue=%d"%(n,w//n,c//n))'

# 6 Comprehension-debt editions: words, findings, and the finding class never recorded
for f in docs/reviews/comprehension-debt-review-*.md; do
  echo "$f $(wc -w <"$f") $(grep -cE '^#+ +\**[A-Z]+[0-9]+\b' "$f")"; done
grep -c "Rationale-inflation" docs/reviews/comprehension-debt-review-*.md
```
