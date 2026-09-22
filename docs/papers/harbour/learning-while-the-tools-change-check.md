---
title: Do the eleven sources in "Learning While the Tools Change" support the readings it gives them?
kind: paper
version: 2
date: 2026-09-22
authors: [Claude]
model: "Version 1 by claude-opus-5, version 2 by claude-opus-5-5 (Claude Opus 5.5), both in one Claude Code CLI web session, effort high as the session reports it; no Harbour dispatch lineage — run directly from John Kershaw's request in the session that filed the essay. Version 2 corrects this check's own reading of the Microsoft rollout after reading that paper at the source."
grounded_at: b4610b0 (LinearViewer), the commit that filed the essay
cites:
  - "docs/papers/harbour/learning-while-the-tools-change.md@b4610b0"
  - "docs/ladder.md@0d652fbc0f2fef12bf063f047d855c346b337595"
  - "docs/papers/harbour/developer-adoption-ladder.md@0d652fbc0f2fef12bf063f047d855c346b337595"
  - "pubsonline.informs.org/doi/10.1287/mnsc.2025.00535 and the Microsoft Research record (read 2026-09-21)"
  - "anthropic.com/research/AI-assistance-coding-skills (read 2026-09-21)"
  - "anthropic.com/research/measuring-agent-autonomy (read 2026-09-21)"
  - "arxiv.org/abs/2606.05391 (read 2026-09-21)"
  - "Bilalić, McLeod and Gobet 2008, via the Cognitive Psychology record and the authors' 2010 summary (read 2026-09-21)"
  - "Lee and Lim 2001, Tripsas 1997, Barley 1986, Bainbridge 1983, David 1990 — publisher records and secondary summaries (read 2026-09-21); see Limits"
  - "arxiv.org/html/2607.01418, Murphy-Hill, Butler and Savelieva (read 2026-09-22, for version 2)"
---

# Do the eleven sources in "Learning While the Tools Change" support the readings it gives them?

For version 1 of the essay, as filed at `b4610b0`: yes, on every claim that can be checked against a number or an attribution: all seven of the
essay's quantitative statements are exact, and no source is made to say something it does not
say. The failures are of reach and of position, not of fact. One reading runs past its source's
own boundary condition (the chess result). One source is renamed in a way that loses what it
named. And twice the essay reaches for a historical analogy where a 2026 study of software
engineers, sitting inside the evidence base of a source it already cites, measures the same
thing directly — that omission is the largest single improvement available to it. Its central
distinction is also not new to Harbour: `docs/ladder.md` made the same move two days earlier,
and the essay does not cite it.

## Findings

**Every checkable number is right.** Each was read at the publisher's own page or record.

| Essay's claim | At the source |
|---|---|
| Cui et al.: 4,867 developers, Microsoft, Accenture "and another large company" | 4,867 across three experiments; Microsoft, Accenture, an anonymous Fortune 100 company ✓ |
| "increased completed tasks by about 26 percent" | 26.08% (SE 10.3%) increase in completed tasks ✓ |
| "larger gains among less-experienced developers" | "Less experienced developers had higher adoption rates and greater productivity gains" ✓ |
| Shen and Tamkin: 52 mostly junior engineers, the Trio library | 52 software engineers, mostly junior, learning Trio ✓ |
| "50 percent … compared with 67 percent … a difference of 17 percentage points" | 50% and 67% ✓ — and the essay is *more* precise than its source, which says "17% lower" |
| "The time advantage was not statistically significant" | "about two minutes faster, although the difference was not statistically significant" ✓ |
| Anthropic: auto-approval more common among experienced users, interruption rates also higher | ~20% of sessions under 50 sessions, over 40% at ~750; interruptions ~5% of turns against ~9% ✓ |
| Dhanorkar et al.: 17 experienced developers, four forms of oversight | 17 experienced developers; four forms ✓ (but see below on their names) |
| Lee and Lim: stage-skipping in DRAM and automobiles, path creation in CDMA | ✓, and the authors' reason — a predictable technological trajectory — is the one the essay gives |
| Tripsas: the typesetter industry 1886 to 1990; typeface libraries as the surviving asset | ✓; the font library is the paper's own example of an asset resistant to the technical change |

The essay's hedges are honest in both directions. It says the Cui experiments "were noisy" rather
than quoting the standard error, and the standard error is 10.3% on a 26.08% effect — the hedge
is doing real work, not covering a weak result. It says the Shen and Tamkin interaction patterns
"were not randomly assigned", which the source also says.

**One reading runs past its source.** On Bilalić, McLeod and Gobet the essay says "stronger
experts were less susceptible" — true, and the authors' own words are that the more expert the
player, "the less prone they were to the effect". But the paper does not stop there: grandmasters
showed no Einstellung effect on the two-solution problems used, *and did show it* on problems
where the better solution was harder to find. The authors' conclusion is that inflexibility of
experts is "both reality and myth". Expertise raises the difficulty at which fixation appears; it
does not remove it. The essay's next sentence — "the capacity of deeper expertise to overcome it"
— reads a moderation as an escape, and §4's hypothesis that the person who understands why each
step was necessary "may be better placed to simplify the sequence" inherits that optimism. The
correction is small and it cuts the essay's way: if the same expert fixates again as soon as the
alternative is harder to see, then §3's instruction to revisit the classification of a skipped
step *as capability changes* is not good practice but the only thing that works.

**One source is renamed in a way that loses what it named.** The essay lists Dhanorkar et al.'s
four forms as "preparation, co-planning, monitoring and review". The paper's are *a priori
control*, *co-planning*, *real-time monitoring* and *post hoc review*. Three are fair shortenings.
"Preparation" is not: a priori control is configuring what the agent may do before delegating —
an act of control, which is why it belongs in a taxonomy of oversight. Calling it preparation
turns the one pre-emptive control into a warm-up, and §7's use of the taxonomy to distinguish
permissive prototype work from strict review of connected systems is precisely about how much
control is set in advance.

**The essay's central distinction is already in `docs/ladder.md`, dated two days before it.**
The essay's §1 and §2 read as a correction to the ladder: it "captures a recognisable personal
journey", but "a claim that everyone passes through those practices in order requires further
evidence". The ladder doc, revised 19 September 2026, already says so in John's own words —
*"the rungs are my personal journey, which seems to be happening to everyone, though of course as
people start these journeys at different points in time the models' behaviour is actually
different"* — and draws the same two conclusions the essay draws: "Each cohort starts on a higher
rung because the tools moved between their start dates, and later entrants arrive beside a
colleague rather than by climbing", and "'where developers are' is a distribution over cohorts,
not a queue". That is the adoption-cohort/career-cohort split and the calendar clock. The essay
cites three papers about the ladder and never the ladder. Nothing here is wrong; the essay is
positioned against a version of the document that the archive has already revised, which makes
its opening weaker than the material behind it.

**Twice, a historical analogy stands where a direct contemporary measurement was available inside
the essay's own reading list.** Source 2's evidence base contains the Microsoft CLI-agent rollout
(arXiv 2607.01418; tens of thousands of engineers, January–April 2026), summarised in
`developer-adoption-ladder.md` as its strongest disconfirming source. It measures two of this
essay's load-bearing claims directly, on the essay's own population:

- §5 argues from Barley's two radiology departments that practices spread through everyday
  interaction. The rollout puts a number on it: **+216% odds** of trying the agent where more than
  a quarter of skip-level peers had adopted, +82% where the manager had; tenure "barely mattered".
- §4 argues from chess that procedural familiarity and understanding of purpose transfer
  differently. The rollout has the sign: prior IDE-assistant use raised the odds of *trying* the
  CLI agent by 49–83% and **lowered 14-day retention by 12–15%**.

An essay is entitled to prefer a mechanism to a correlation, and Barley explains *why* while the
rollout only shows *that*. But the rollout is about software engineers, in 2026, at scale. Its
retention result needs care: the authors read it as substitution — an engineer with a working IDE
habit has "a familiar alternative to fall back on", so the new habit never forms — not as skill
failing to transfer. It supports the essay's claim that time on one practice does not simply buy
the next, without settling why. Leaving it out still costs the argument more than it saves it.

**What the essay has that Harbour does not.** Three things, and they are why it is worth filing
rather than folding into the ladder. First, the three clocks as a *measurement* claim rather than
a vocabulary: a cross-section of newcomers mixes a change in people with a change in tools, so the
instrument has to follow the same people through comparable work — `developer-adoption-ladder.md`
reports that no such instrument exists and does not say why one survey could never be enough.
Second, classifying a skipped step by function — compensates for a tool limitation, teaches a
concept or exposes a failure mode, coordinates people or controls an irreversible action — which
is a testable rule for pruning a prompt template or a gate, and the archive has no other. Third,
"more autonomy is a description of how work proceeds, not a complete measure of capability", which
contradicts nothing in the ladder and is absent from its *What to measure* section, where the
proposed Harbour analogue of Anthropic's auto-approve curve is permission mode by session count.

**Three bibliographic errors reached the archive, and are corrected in this PR.** The supplied
.docx carried no punctuation in any title — an artifact of how it was generated — so the filed
version's title punctuation is the transcriber's, and two words were wrong with it: Cui et al. is
"High-Skilled", Lee and Lim is "catching-up", and Tripsas 1997 is the Summer Special Issue of
volume 18. The Management Science DOI is added now that the Cui paper is published, so that entry
lands on the published article rather than only the 2025 summary. This check touched no argument
text: the checker is not the editor under rule 2. When John later invited the checker to revise the
essay as its second author, that made version 2 a document this check cannot cover.

## Method

Each of the eleven sources was reached from the URL in the essay's own reading list, on
2026-09-21, and each numeric or attributional sentence in the body was compared with what that
source says. Seven were verified at the publisher's own page or record: Cui et al. (Microsoft
Research record and the Management Science listing), Shen and Tamkin and the autonomy report (both
Anthropic), Dhanorkar et al. (arXiv), Bilalić et al. (the Cognitive Psychology record and the
authors' own 2010 restatement), Lee and Lim, Tripsas. Four could not be read as text — two PDFs
returned unparseable binary, one returned HTTP 503, one is behind a cookie wall — and were checked
against indexed bibliographic records and secondary summaries instead: David 1990, Barley 1986,
Bainbridge 1983, and Tripsas's body text. The Harbour claims in §1 were checked against
`developer-adoption-ladder.md` and `docs/ladder.md` in the working tree. Version 1 of this check
took the Microsoft rollout's figures second-hand from `developer-adoption-ladder.md`; version 2 read
them at arxiv.org/html/2607.01418 on 2026-09-22. Every figure held. The reading did not: see the
rollout finding above.

## Limits

The four sources that could not be read as text are the weak point, and the bias runs toward
confirmation: a secondary summary of a much-cited classic and an essay drawing on the same classic
can share one received reading, so agreement between them is weaker evidence than the paper
agreeing would be. All four are the essay's historical sources, which is where its analogies do
the most work.

An abstract is not a method. Nothing here tests whether Lee and Lim's stage-skipping
classification survives their own data, or whether Barley's two cases support the inference drawn
from them. This check asks only whether the essay reports its sources correctly.

This check tests the readings the essay gives the sources it has. It cannot in general test the
sources it does not have — the Microsoft rollout was visible only because it was already inside
the archive. A reader should assume other omissions of that kind exist and are invisible from
here.

## Next

Two lines go to `proposals.md` with this change. The first is a question for John rather than a
study: `docs/ladder.md` and this essay now make the same cohort argument independently, and one of
them should absorb the other — either the ladder gains the three clocks and the function
classification, or the essay gains the ladder's paragraph and stops correcting a claim the
document no longer makes. The second is the retention result: the Microsoft rollout found prior
IDE-assistant use *lowered* agent retention, and Harbour has the records to ask whether the same
sign shows up in its own operators' first bounded runs.

The three lines the essay itself filed stand unchanged; this check does not discharge them.
