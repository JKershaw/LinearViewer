---
title: Could Harbour adopt the plain-language standard, ISO 24495-1?
version: 1
date: 2026-09-13
authors: [Claude, John Kershaw]
model: claude-fable-5-1, Claude Code on the web, effort default; an interactive session rather than a dispatch, so no lineage record exists; the hand-read is the author's own
grounded_at: 5b3e599
cites: [ISO 24495-1:2023 (iso.org/standard/78907), docs/autopilot-operating-manual.md@5b3e599:437, lib/prompt-template-defs.js@5b3e599:1026, lib/prompts/flight-companion-brief.js@5b3e599:132, docs/papers/standard.md@5b3e599:25, lib/prompt-formatters.js@5b3e599:889, lib/prompts/meta-prompt-template.js@5b3e599:112, docs/papers/harbour/writing-length.md@5b3e599, LIN-2839 (ruling read 2026-09-13)]
---

# Could Harbour adopt the plain-language standard, ISO 24495-1?

Yes, as a rule about readers rather than a readability gate. The standard is four principles,
each about what a reader can do with a document, and it says so itself: success is whether
readers can find, understand and use the text, not a formula score. Harbour already states each
principle somewhere, in four places that do not know about each other, and none of them names
the reader. The tracker shows the cost of that. A comment usually puts its outcome up front and
usually says which stage wrote it, but almost never says whether the person reading it is
needed, and every comment carries the operator's own name, so the tracker cannot tell a ruling
from a recap.

## Findings

**The standard is principles, not a score, and its text cannot be copied in.** ISO 24495-1:2023
sets four governing principles: readers get what they need (relevant), can easily find it
(findable), can easily understand it (understandable), and can easily use it (usable). Its scope
statement measures plain language by how successfully readers use the document, "rather than on
mechanical measures such as readability formulas." The text is paid and copyrighted; the
principles are public. Adopting it means naming the four principles and the reader, not pasting
guidelines into a template. Parts 2 (legal communication, 2025) and 3 (science writing, 2026)
exist and do not change this.

**Harbour states every principle already, in four unconnected places, and never names the
reader.** The operating manual asks that a hand-back be "answerable in a single reply" (usable;
`docs/autopilot-operating-manual.md:437`). The review template asks that an outside finding be
"stated so a reader with no access to this ticket can act on it" (relevant;
`lib/prompt-template-defs.js:1026`). The Flight Companion brief demands a headline block "that
fit[s] one phone screen" (findable; `lib/prompts/flight-companion-brief.js:132`). The papers
standard puts "the answer in the first paragraph" (findable; `docs/papers/standard.md:25`). The
one output rule both prompt paths share, Scale to the task (`lib/prompt-formatters.js:889`,
`lib/prompts/meta-prompt-template.js:112`), governs how much a prompt says and not who it is for.
Harbour's prose has two readers, the operator and the next session, and no template says which
one a given comment serves.

**Findable mostly holds.** In 59 sampled tickets, 146 comments run to 120 words or more. Of the
120 whose text contains an outcome word (a verdict, Done, merged, a recommendation), the median
puts it 22 words in and 68% put it within the first 60 words. Every review and plan-review comment
in the sample leads with its verdict on the first or second line. The template shapes did this.

**Relevant fails at the byline.** All 155 comments in the sample carry one author name, the
operator's, because agents write through the operator's token. A reader cannot tell a ruling from
a bot recap by looking at who posted it, and this paper could not split human from agent prose
either. Where a comment names its own stage in its first line ("Close-out", "Autopilot run
summary", "Ruling from John"), it does so by convention, not by rule.

**The first screen says what happened and who is speaking, but not whether you are needed.**
Reading the final comment on each of the 21 completed tickets with comments, on its first 120
words alone: 19 say what happened, 17 name the stage or role that wrote them, and 4 say whether
the reader owes anything. Those four are the ones that matter most to an operator: a follow-up
owner named (LIN-2511), "nothing remains here" (LIN-2455), "merge is not mine, leaving for review
approval" (LIN-2791), and a dated re-read (LIN-2826). The other 17 leave silence to mean "no
action", which the usable principle does not allow.

**Sentence length rises with distance from a human reader.** Comment sentences run 22 words at
the median, with 29% over 30 words and 7% over 50. The hand-rewritten papers run 25 words per
sentence with 5% over 50. `CLAUDE.md`, written for the next session and never for a person, runs
41 words per sentence with 53% over 30 and 30% over 50. The one open ruling at the time of
reading (LIN-2839), the most human-facing prose in the system, carries a 49-word question and a
139-word case whose first sentence is 105 words long.

**Ceremony sits before content in a third of long comments.** 34% of comments of 120 words or
more open with grounding lines in their first five non-empty lines: a sha, "tree clean",
"re-grounded", "no drift". That text is written for the next agent and is scrolled past by a
person. Descriptions do the same with provenance: 39% open with who filed the ticket and from
where, before saying what it asks.

**Length by stage, for the record.** Median words per comment: research 3,178 (n=4), review 1,883
(27), plan-review 1,286 (20), bug 713 (29), close-out 523 (29), plan 335 (13), hand-back 308 (3).
Descriptions run 459 words at the median. `writing-length.md` measured the growth; this paper
measured the shape, and the shape is more reader-first than the length suggests.

## Method

Population: every 7th identifier from LIN-2420 to LIN-2830, 59 tickets, read through the
workspace API proxy at read scope on 2026-09-13. 24 carry comments, 155 comments in all,
154,039 words. The one open ruling came from `GET /api/proxy/rulings`. Comment kinds are
classified by the markers their templates emit (the regexes below); "long" is 120 words or more.
The corpus comparison ran the same sentence splitter over `docs/papers/harbour/*.md`,
`docs/reviews/*.md` and `CLAUDE.md` at `5b3e599`. The hand-read is the author reading the first
120 words of the last comment on each completed ticket and answering three questions: what
happened, who is speaking, is the reader needed.

```sh
mkdir -p sample
for n in $(seq 2420 7 2830); do
  curl -s -H "Authorization: Bearer $TOKEN" "https://harbour.cat/api/proxy/issues/LIN-$n" > sample/LIN-$n.json; sleep 1.05
done
```

```js
// node measure.mjs — run beside sample/
import fs from 'node:fs';
const T = fs.readdirSync('sample').map(f => JSON.parse(fs.readFileSync('sample/' + f))).filter(i => i.identifier);
const wc = s => s.split(/\s+/).filter(Boolean).length, med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const pct = x => Math.round(x * 100) + '%';
const prose = t => t.replace(/```[\s\S]*?```/g, ' ').split('\n').filter(l => !/^\s*[|#]/.test(l) && !/^\s*[-*] /.test(l)).join(' ');
const sentences = t => prose(t).split(/(?<=[.!?])\s+(?=[A-Z`*(\["'])/).map(wc).filter(n => n >= 3);
const OUTCOME = /(Verdict|Approve|Request Changes|Needs Discussion|Done|merged|Root cause|CONFIRMED|Recommend|next action|Ruling|DECISION:|BLOCKED:|PENDING-EXTERNAL|Surface Assessment:|plan-review due|Implemented|Outcome)/;
const CEREMONY = /(grounded at|re-grounded|tree clean|git status|rev-parse|porcelain|no drift|fresh[- ]context|same SHA|unchanged since)/i;
const kind = b => /What CI Did Not Prove/.test(b) && /(Approve|Request Changes|Needs Discussion)/.test(b) ? 'review'
  : /Plan Review Verdict|plan-review/i.test(b) && /(Approve|Request Changes|Needs Discussion)/.test(b) ? 'plan-review'
  : /(Ledger Gate|ledger item|discharged|Follow-up Triage)/i.test(b) && /(merged|Done)/.test(b) ? 'close-out'
  : /Surface Assessment|Audit the Layers|Name the Classes|exploration notes/i.test(b) ? 'research'
  : /Strategy Framing|Scope Assessment|session-fit|plan-review due/i.test(b) ? 'plan'
  : /DECISION:|BLOCKED:|PENDING-EXTERNAL/.test(b) ? 'hand-back' : /Root cause|CONFIRMED|reproduc/i.test(b) ? 'bug' : wc(b) < 120 ? 'short' : 'other';
const C = T.flatMap(i => (i.comments || []).map(c => ({ b: c.body, w: wc(c.body), k: kind(c.body), u: c.user?.name })));
console.log('comments', C.length, 'authors', new Set(C.map(c => c.u)).size);
const byK = {}; for (const c of C) (byK[c.k] ||= []).push(c.w);
console.table(Object.fromEntries(Object.entries(byK).map(([k, w]) => [k, { n: w.length, median: med(w) }])));
const long = C.filter(c => c.w >= 120);
const before = long.map(c => { const i = c.b.search(OUTCOME); return i < 0 ? null : wc(c.b.slice(0, i)); }).filter(x => x !== null);
console.log('outcome: median words before', med(before), 'within 60', pct(before.filter(x => x <= 60).length / before.length));
console.log('ceremony open', pct(long.filter(c => CEREMONY.test(c.b.trim().split('\n').filter(l => l.trim()).slice(0, 5).join(' '))).length / long.length));
const cs = C.flatMap(c => sentences(c.b));
console.log('comment sentences median', med(cs), '>30', pct(cs.filter(n => n > 30).length / cs.length), '>50', pct(cs.filter(n => n > 50).length / cs.length));
const D = T.filter(i => i.description?.trim()), first = d => d.description.trim().split(/\n\s*\n/)[0].replace(/[*_#>]/g, '').trim();
console.log('descriptions median', med(D.map(d => wc(d.description))), 'provenance-first', pct(D.filter(d => /^(Filed|Raised|Spun|Minted|Carved|Follow-up|Origin|Per John|From the|Companion defect|Child of|Phase [A-Z], beat)/i.test(first(d))).length / D.length));
```

## Limits

The sample is recent tickets only, so it says nothing about drift over time; `writing-length.md`
covers that. Comment kinds come from template markers and a comment that mixes stages is counted
once, by the first rule that matches. The outcome and ceremony reads are regexes over structure,
a proxy for the standard's own test, which is a reader trying to use the text; 26 long comments
matched no outcome word and are excluded, which flatters the findable figure if they are the
ones with no outcome to find. The sentence splitter treats a semicolon-chained list as one
sentence, so the long tail is a ceiling. The author split is impossible from the data, so the
comment corpus includes the operator's own short rulings, which pull the medians down. The
hand-read was judged by the paper's author, against the standard's rule that a paper is checked
by a second paper; a second reader may score the 17 silent comments differently.

## Next

Run the standard's own test rather than a proxy: give a fresh session one comment and ask it
what happened, who wrote it and what the reader must do, then score against the ticket. The eval
harnesses under `scripts/eval-*.mjs` already have the shape. If that read agrees with this one,
the change is one shared reader rule on both prompt paths beside Scale to the task, and a
first-line marker naming the stage and session on every agent comment.
