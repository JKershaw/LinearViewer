---
title: Does the steady-base menu hold up?
kind: check
version: 1
date: 2026-10-01
authors: [Claude (LIN-3195)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 664b48ea, kind custom, LIN-3195); the dispatch item carries no effort field. One bounded session with no research, plan, review or close-out legs, by the brief's design. In-session subagents: three frontier-tier readers, one tracing the token-sized options M1–M17 and M34 to their sources and checks, one tracing the hours-sized options, the enablers, the exclusions and the findings page, and one reading the landing order against its sources and recounting the method note. This session re-ran both scripts, measured where the tracker chores sit, settled every figure, and wrote this check and the paper's version 2. It did not write the paper, which came from dispatch 9f3f13bd."
grounded_at: 264d13f8 (LinearViewer, origin/main; every cited paper and docs/steady-base.md are unchanged from the paper's 01277614, so its line numbers hold); the paper itself at 7dbe666d; the tracker split from LIN-3189's git-ignored token snapshot (costmix-tokens.json, 1,988 sessions, August–September), re-read against the transcripts on this machine on 1 October 2026
cites:
  - "docs/papers/harbour/steady-base-menu.md@7dbe666d (version 1, LIN-3194) and its scripts survey-menu-analyse.mjs and survey-menu-figures.mjs, each re-run"
  - "docs/papers/harbour/held-or-fresh.md@264d13f8:328-333 (Options A–D: −10% by class, −14% if code could tell; B's further −5 at 20k, −9 at none, 0 at 40k; C −1.9%)"
  - "docs/papers/harbour/where-judgement-happens.md@264d13f8:199-204 (Options 1–5; option 3 is close-out's 6% × 0.4–0.8)"
  - "docs/papers/harbour/cost-mix.md@264d13f8:216-233 (the bound), :318-332 (Options 1–6)"
  - "docs/papers/harbour/survey-check-9.md@264d13f8:47-50, :109-112 (option 4 is 1.23×), :293-298 (the trial modes' smallest visible change)"
  - "docs/papers/harbour/how-process-changes-land.md@264d13f8:167-172 (trial modes), :189-207 (charging rules), :236-243 (which rule sees which saving), :356-363 (Options 1–6)"
  - "docs/papers/harbour/measuring-throughput.md@264d13f8:26-30 (what the scorecard detects at four and eight weeks)"
  - "docs/papers/harbour/survey-check-7.md@264d13f8:35-38, :240-250; survey-check-8.md@264d13f8:214; survey-check-10.md@264d13f8:130-152; survey-check-11.md@264d13f8:271-277; survey-check-2.md@264d13f8:28-31; survey-check-3.md@264d13f8:30-34"
  - "docs/papers/harbour/model-choice.md@264d13f8:22-26, :60-62 (close-out to the cheap tier on 25 September)"
  - "docs/papers/harbour/prototype-concepts.md@264d13f8:117-122 (a paper and a check in weighted tokens), :228-231 (Options E and G)"
  - "docs/papers/harbour/what-hides-between-sessions.md@264d13f8:344-350 (Options A–E)"
  - "docs/steady-base.md@264d13f8 (the anchor; not edited)"
  - "scripts/survey-replay-chores.mjs (LIN-3189), run over every ticket in the token snapshot; scripts/survey-check-12.mjs (this check)"
  - "LIN-3195's description and brief, read over the workspace proxy 2026-10-01"
---

# Does the steady-base menu hold up?

Its arithmetic and its archive count, yes; three of its readings, no. Both scripts re-run and the
two charts come out byte for byte. Every printed number reproduces, except the script count, which
now includes the paper's own two scripts. Most of the 34 options trace to a checked paper at
version 2. What fails is in what the numbers are taken to mean.

- **"The plumbing code can see" includes a saving code cannot see.** The 14% in F1 needs code to
  know in advance which wakes will change nothing. `survey-check-7` showed it cannot: those wakes
  are indistinguishable by class. Only 10% is class-visible. S1 is ×1.19–1.26, not ×1.19–1.34,
  and every stack's low end should rest on 10%, not 14%.
- **The factors are not as separate as multiplying assumes.** Lighter legs (M12) and the conductor
  (M3) overlap. 58% of the fleet's tracker tokens sit in supervisor sessions, which are 37% of the
  budget, so the conductor takes a disproportionate share of what lighter legs would cut. Measured
  that way, M12 is 13.9% of what F1 leaves at the low end and 12.3% at the top. The paper used 10%
  and 15%, so it was understated at the bottom and overstated at the top.
- **The landing order mixes units and overstates what the scorecard can see.** Its ×1.3 floor is
  in dispatches or hours per correct change, from one design under its kindest assumption. The
  options are sized in weighted tokens. Group B is not "at the edge" of the scorecard at eight
  weeks, and Groups B and C are not independent.

With these and smaller corrections, the whole menu is **×1.57–2.38**, not ×1.55–2.44. With
credential work held it is **×1.49–2.10**, not ×1.47–2.14. Only the whole menu reaches 2×, still
only in the upper part of its range, and still a little under `cost-mix.md`'s bound of 2.5×. The
×1.9 "geometric middle" survives as arithmetic: putting every member at its range's midpoint also
gives about ×1.9. It is not an estimate, because no source weighs how likely either end is.

The anchor's conclusion holds: 2× is reachable on the evidence, but not comfortably. It turns on
the conductor's unmeasured ceiling. Version 2 of the paper carries every correction below.

## Findings

### 1. The scripts re-run

`node scripts/survey-menu-analyse.mjs` and `node scripts/survey-menu-figures.mjs` at 264d13f8
reproduce every option count, stack, "if added" and credential-held figure the paper prints, and
both SVGs come out byte for byte (`git status` clean after the run). The archive count reproduces
for 39 documents (26 papers, 13 checks), 187,711 words, 29 September to 1 October, 25 of 26 papers
at version 2 or later, and the anchor at 13 commits and 9,479 words.

Three small errors in the archive count:
- **Scripts.** At HEAD the script prints 166 scripts and 19,771 lines. Taking out the paper's own
  two scripts (174 and 86 by the script's count) gives the printed 164 and 19,511.
- **Line count.** The count is `split('\n').length`, one more than the real lines per file. By
  `wc -l` it is 19,347.
- **What the counts include.** The glob misses one `.cjs` helper. Of the anchor's 13 commits,
  three are a three-line LIN-3163 edit and two merges.

Every script was added on or after 29 September, as stated. The one paper below version 2 is
`fleet-complexity-read.md`, which has no header. It is cited for M8, M17 and M19, not for "two"
simplifications.

### 2. Sizes: most trace, five do not

Each figure in Part 2's tables and in the script's `OPTIONS` rows was read at its cited section and
against that paper's check. Every cited paper is at version 2, except `fleet-complexity-read.md`,
which is always cited beside a version 2 source. The menu has no M15: version 1 skipped the
number, so "M1–M35" is 34 options.

| Option | Menu says | Source says | Class | Version 2 |
|---|---|---|---|---|
| M3 | 10% by class, 14% if code could tell, 27% ceiling | `held-or-fresh` v2 A: the 14% is sized by outcome, which code cannot see (`survey-check-7`); 27% = 77% × 35%, about 30% on the blind recode's 86% | right as quoted, misused in S1 and every low end | 10% is the class-visible figure; 14% enters no stack |
| M3 trial | shadow "agreement on about 1,450 follow-ups" | 1,000 paired decisions bound disagreement below 0.3%; 1,450 is the fleet's follow-ups a week | misquoted | "until 1,000 paired decisions agree (under a week fleet-wide)" |
| M4 | "a further 0–9 points on top of A at a 20k handoff; break-even 21k" | a further −5 at 20k, −9 at none, 0 at about 40k; 21k is the break-even of option D | misquoted | corrected; range −9% to −19% stands |
| M5 | script 0.3–1 of fleet tokens | under 1% of ticket cost, 0.6% in these cycles | unit mismatch; no stack effect (inside M3) | 0–1, a share of ticket cost |
| M8 | derived 1–3% | 44/430 × 10% ≈ 1%; the mutation rounds are unsized, so the 3 has no source | unchecked | about 1%, upper end unsized; F2 2–4%, not 2–6% |
| M10 | about 1.5–2% "as sized" | the anchor's row 14 and `prototype-concepts` v2 A cite each other; no paper derives it | unchecked | marked unsized; bound 4.9–12.1% stands |
| M11 | perhaps 1–2% | `survey-check-8`: a ceiling; search and history are 32% of research legs' result tokens, so about 1.7% at most | above its check | at most about 1.7% |
| M12 | about 15%; "about 15 points … truly avoidable"; derived low 10% | fleet-wide 24.7% + 4.4%, halved 14.6% (`survey-check-11`); the "15 points" is a share of 13 small tickets' tokens; the 10% nets all 35% of supervision, more than M3 removes | unit mismatch; derivation superseded by §3 | 14.6% alone; 13.9% / 12.3% of what F1 leaves |
| M13 | "2–5% of ticket cost × 5.2% = 1–3%" | that product is 0.1–0.26%. The source's 2–5% is close-out's 6% × 0.4–0.8, so on the fleet it is 5.2% × 0.4–0.8 = 2.1–4.2%, before the frontier step it keeps (`survey-check-7`: leans high) | derivation wrong, low | 2.1–4.2%; and see §5 on 25 September |
| M14 | script 0.2–1 | under 1% of a four-step ticket's tokens; no source for 0.2 | unchecked low end | 0–1 |
| M17 | "1.2× … which is a 17% cut" | `survey-check-9`: 1.23× on the whole budget, an 18.7% cut | rounded low | 8–18.7% |
| M17 risk | escapes "2.1–3.7%" | 3.7% is the old convention `survey-check-9` replaced; 2.1 in 100 (1.1–3.9) | pre-check | corrected |
| M21 | "42 hours … and 165 hours of stalls" | option A claims the 42 hours and the overnight freezes; the stalls are already caught in code after 60 minutes | misquoted | corrected |
| M29 vs Part 4 | M29 ×1.8–2.7 / ×1.5–1.9; Part 4 ×1.8–1.9 / ×1.5–1.9 | the source's independent and clustered figures, mixed | inconsistent | see §4 |
| M32 | "about 20 of 24 checks corrected" | 20 of 24 *documents*, counted before the sixth wave | misquoted | corrected |

Everything else in Part 2's tables traces exactly, sampled in full rather than in part:
- **M1 and M2:** 5.7%, 4.1%, 7–10% and 8–15% of dispatches, 15 of 25, 11 of 15, 27 lost and 39%.
- **M6, M7 and M34:** 1.1×, 13%, 1.8×, 1–3%, 3.9% / 4.3%, and up to 3.1% (a ceiling, not a saving).
- **M9 and M16:** 3% raised to 5%, 46 days, 8–12%, 4.1%, 5–10%, 18–24%, 2.0 in 100 (0.9–4.6),
  8 of 328, 11 of 15, 8 of 13 and about 400.
- **The hours items and enablers:** M18–M20, M22–M28, M30, M31, M33, M35 and the three done items.

### 3. Stacking: the factors overlap, and the low ends used an unseeable 14%

**F1 by class is 10%.** S1 is named for "the plumbing code can see" but takes F1 at 10–14%. S2–S4
take 14% as their low end, and the paper calls 14% the class-visible figure ("if code can route
only the wakes it can tell apart by class (14%)"). In `held-or-fresh.md` v2 option A, −10% is
"routed by delivery class" and −14% is "if code could tell which wakes will change nothing". The
paper's own Part 5, question 3, says those 938 quiet wakes are indistinguishable by class. So 14%
is a hope about a measurement not yet made, and every stack's low end should be 10%.

**Within factors, the overlaps are handled once, with one exception.** M1 and M2 sit inside M3,
M4 overlaps M1–M3, M17 contains M16, and M10's forms share the re-finding bound. Each is counted
once. F3, however, adds M9 to M14 as disjoint pools, and no source says they are.
`survey-check-11` says lighter legs (M12) overlap the bootstrap row (M9). So F3's sum is an upper
end by an unmeasured amount. M13 shares close-out's spend with M8 across F3 and F2
(`survey-check-7`), which multiplying treats as independent.

**Across factors, the overlap is real and now measured in part.** The menu's example is the right
one: the conductor (M3, F1) and lighter legs (M12, F3). Multiplying assumes M12's share is the same
in the supervisor tokens F1 removes as in what it leaves. To test that, `survey-replay-chores.mjs`,
the replay paper's classifier, was run unchanged over every ticket in LIN-3189's token snapshot:
1,986 sessions and 3.55B weighted tokens. It reproduces `survey-check-11`'s fleet-wide 24.7%
tracker and 4.4% remote within a tenth of a point.

| Where the chores sit | Share of fleet tokens | Tracker calls | Remote work |
|---|--:|--:|--:|
| Supervisor sessions (autopilot, wake) | 37.1% | 14.4 points (58% of the class; 39% of these sessions' tokens) | 1.0 point (23%) |
| Every other session | 62.9% | 10.4 points | 3.3 points |
| Fleet | 100% | 24.8% | 4.3% |

Chores are concentrated where the conductor works. Suppose the conductor removes chores in
proportion to the supervisor tokens it removes; this is a kind assumption, since its steps are the
polling and posting. Then halving the chores that are left is 13.9% of what F1 leaves with F1 at
10%, and 12.3% with F1 at 27%. Version 1 used 10% and 15%. Its derived low end netted out all 35%
of supervision and then multiplied again, counting the overlap twice. Its top ignored the overlap.

**Recomputed.** With F1 at 10% by class and the corrected sizes, here are the stacks. The
arithmetic is in both `scripts/survey-menu-analyse.mjs` (version 2) and
`scripts/survey-check-12.mjs`, which agree.

| Stack | Version 1 | Version 2 | Credential work held, v1 → v2 |
|---|--:|--:|--:|
| S0 Quick and reliability-neutral | ×1.05–1.09 | ×1.05–1.09 | ×1.04–1.08 → ×1.04–1.08 |
| S1 The plumbing code can see | ×1.19–1.34 | ×1.19–1.26 | ×1.17–1.30 → ×1.17–1.23 |
| S1+ with proportionality | ×1.29–1.62 | ×1.29–1.55 | ×1.26–1.53 → ×1.26–1.47 |
| S2 The conductor | ×1.25–1.58 | ×1.19–1.55 | ×1.22–1.50 → ×1.17–1.47 |
| S3 The conductor with proportionality | ×1.35–1.91 | ×1.29–1.91 | ×1.31–1.75 → ×1.26–1.75 |
| S4 The whole menu | ×1.55–2.44 | ×1.57–2.38 | ×1.47–2.14 → ×1.49–2.10 |

S4's low end rises slightly, because the honest M12 is larger than 10% at a low F1. That almost
cancels the lower F1. "If added" for S4 goes from ×1.69–4.55 to ×1.71–4.15. The sum of every token
option's high end goes from 129% to 132%, with M15 added. On the blind recode's 86% mechanical
share (`survey-check-2`), the conductor's ceiling is about 30% and S4's top is ×2.47.

**Against `cost-mix.md` v2's bound.** The comparison is made on the right footing: the stack is
applied to the 90.3% outside credential work. The bound is 2.5× at three times cheaper elsewhere,
and the corrected top is ×2.10, a 58% cut of that 90.3% against the bound's 67%. The bound's own
ceiling is 10.3, or 9.9 at the list-price tier ratio (`survey-check-9`), which the paper's "about
10×" covers.

One sentence is wrong. It says cost-mix's options 1–4 at 1.7–1.8× "are the proportionality and
fixed-part rows alone" and that "the menu adds the structural rows". Cost-mix's option 3, cutting
the fixed part by half, *is* the structural rows, and Part 2 says so ("what F1 and F3 together
would do"). The menu's larger figure comes from sizing those rows above half: F1 and F3 together
cut 29–46% of the budget, against option 3's 23%.

**The ×1.9 "geometric middle".** √(1.57 × 2.38) is ×1.93. Putting every member at its range's
midpoint gives ×1.92. The number is stable, but it is not meaningful as a central estimate. The
ranges' ends are not equally likely, and the two that matter most are the ones no paper has
measured: F1 above 10% and the lane's correctness. Version 2 says so.

### 4. The landing order

**What the scorecard can detect.** The before-and-after figures hold: ×2.1 on the weekly ratio at
four weeks a side, and ×2.8 dispatches or ×2.0 hours per change (`measuring-throughput.md` v2;
`how-process-changes-land.md` v2:169). The holdout figures were mixed. Part 4 took the independent
dispatch figure (×1.8–1.9) with the clustered hours range (×1.5–1.9), while M29 quotes both ends.
When whole lineages are assigned together, as Group C does, the clustered ×2.1–2.7 and ×1.6–1.9
apply.

**"No option under about a 23% saving is visible on its own."** The arithmetic is right
(1 − 1/1.3), but the claim needs two qualifiers:
- **×1.3 is the smallest any design sees, not the floor of every design.** It is `survey-check-9`'s
  holdout at eight weeks, in hours, if changes are independent (×1.33; ×1.45 in dispatches). A
  before-and-after at eight weeks needs ×1.6–1.7.
- **The floors are in dispatches or hours per correct change; the options are in weighted
  tokens.** No paper gives the scorecard a floor in weighted tokens. The two can differ widely:
  the lane's 8–12% of tokens is 21–30% of dispatches.

Group B's expectation does not follow from this. "×1.19–1.34 … at the edge of what the scorecard
sees at eight weeks" and "up to ×1.58 … visible at four" are wrong, for three reasons:
- Group B is a before-and-after, whose floors are ×1.6–1.7 at eight weeks and ×2.0–2.8 at four.
- S1 and S2 include Group A's and Group C's options.
- Group B's own F1 is ×1.11, or up to ×1.37 at the conductor's ceiling.

Group B is invisible to the scorecard on its own. It has to be read on per-role tokens, wakes per
correct change and the shadow's agreement.

**Groups B and C confound each other in one direction.** Session entered is blind to savings in
epics' and Runners' sessions (`how-process-changes-land.md` v2:242), so C's read is largely clean
of B. But B is read pooled and lineage-spread, and both include C's treated arm. A Group C start,
or an addition to it, inside a B slice's before or after window leaks into B's read.

The two are not independent in mechanism either. The lane drops supervision legs that B makes
cheaper, so each B cutover shrinks C's measured effect.

The paper attributes "one change at a time, or a few independent groups measured on different
rules" to M27. Neither M27 nor its source says the second half. Running B and C in parallel
departs from M27 as the paper states it, which version 2 now says.

**Step 0 is achievable, but not as stated.** The census figures hold (47.1 against 33.6,
`survey-check-9`). Three parts of the step conflict:
- **The burn-down.** M30's burn-down is 47 code items, 100 follow-ups and 114 residue tickets,
  and the source says "each removal is its own change". So "four weeks with the half-finished
  items burned down and nothing else landing" is weeks of landing followed by a freeze.
- **Group A.** Group A, "now", lands M9's switch deletion, itself an M30 item, inside the window
  that is supposed to be frozen.
- **Running during V1.** "It can run during V1" holds for the census and the rule. It does not
  hold for the frozen baseline. Pooled dispatches per correct change were 48.4 from 13 September,
  when the passage layer went live, against 25.8 in the month before. Group B's after-windows fall
  between passages, so a baseline frozen during a passage would flatter every cutover.

Version 2 makes Step 0 a sequence: census and rule, burn-down, Group A, then the freeze in the
same passage state as the after-windows.

**"Within about three months."** Landing A–C in three months is plausible. Group C's read is not.
About 400 lane changes at the backtest's roughly 19 light changes a week, half of them routed to
the lane, is about 40 weeks plus the 30-day escape lag.

### 5. Recommendations and the method note

**The "not recommended" list is fair on six of seven.**
- **Fair.** The relay as proposed, plan review re-deriving less, writing less, the graph research
  leg, tier as the cost lever, and a lighter review on the judgement paper's strength are each
  excluded on their source's own words.
- **Not fair.** `prototype-concepts` v2 E, a reader-and-inference pass on every check, is not
  advised against. The source calls it positive for correctness and negative for budget, so it is
  a correctness option at a cost. Version 2 moves it out of the list.

**Two of the sources' options were missing.**
- **`held-or-fresh` v2 C.** Start fresh instead of a cold resume above about 100–155k tokens:
  −1.9% alone, −0.8% on top of A, inside B and D. It becomes M15, inside M3 and M4, so no stack
  changes.
- **`where-judgement-happens` v2 4.** Retry service faults inside the tools, with a duplicate
  guard. It is unsized, and becomes M36, in hours.
- **`step-overlap` v2 D** is M10 again and is now cited there.

**Tier is already moving.** `model-choice.md` v2's run log records implementation, research and
close-out moved to the cheap tier on 25 September, without a commit and without M33's eval. M13 is
therefore partly live and ungated, and part of its saving may already be in October's figures.
The menu excluded tier as the cost lever without saying so.

**The method note's counts reproduce; three of its claims do not.**
- **"About 20 of 24".** These are documents, counted before the sixth wave (`survey-check-10`),
  not checks.
- **The rule class.** "8%, reproduced at 2–4%" mixes bases. It is 12% by the first reader against
  2–4% by two fresh readers on the same nine tickets.
- **"Option sizes stated high".** This includes two finding counts (23 → 20 of 24; about 90 → 40
  alarms) and two upward moves from earlier waves (77% → 86%, `survey-check-2`; 2× → 2.5×,
  `survey-check-4`). Only the bootstrap's 3% → 5% is a fifth- or sixth-wave option moved up.

The drift examples hold, with one correction:
- **Hold:** four charging rules where two were asked; the map growing from 12 rows to 16, then 17;
  and the hindsight replay.
- **Corrected:** the anchor carried wrong version 1 figures for about an hour, twice (e3a2a3d7 →
  3dd1ccb2 and b6e20a07 → b863bded), not "for a day".

**Part 1, two figures.**
- **Escapes.** "The claim that escapes had quadrupled did not survive" is mis-cited. `survey-check-3`
  cut the escape share's rise from 1.1% → 7.1% to 1.1% → 3.1%, so escapes still roughly tripled.
  The "four times" that did not survive was LIN-3155's mid-tier ratio (`model-choice.md` v2).
- **Re-finding.** It is 4.9–12.1% of all tokens, not "of" orientation.

The rest of Part 1 traces. Two qualifiers: simple-dispatcher's escapes are "only partly explained"
in the source, and "production comments" are comment lines.

### 6. Costs

The paper's one cost in currency, "about $11.68 at list prices and a check about $8", is replaced
by weighted tokens. It was also misread: $8 was a check's share per paper, not a check.
`prototype-concepts.md` v2:119–121 gives the weighted-token figures:
- a one-session paper, a median 4.5M weighted tokens;
- a check, 6.2M;
- a paper with its share of its check, 8.1M;
- the check's share per paper, about 2.95M, a third.

Every other cost in the paper and in this check is a ratio or a share of weighted tokens.

### 7. Corrections: version 2 of the paper

`steady-base-menu.md` v2 carries every correction above:
- the header's `revision:` line and this check added as an author's source;
- Part 1's two figures;
- the M3, M4, M5, M8, M10–M14, M17, M21, M29 and M32 rows;
- M15 and M36, the not-recommended list and the merge notes;
- Part 3's table and text;
- Part 4's detection paragraph, Step 0, Groups B and C, and its timescale;
- Part 5, question 1;
- the method note's counts, costs and corrections;
- Method, Limits and Next.

The scripts carry the same: `OPTIONS`, `FACTORS`, `STACKS` and the not-recommended list in
`survey-menu-analyse.mjs`, M15 in the figures' "inside M3" set, and both SVGs regenerated. No
option's risk step was moved.

### 8. The lines of `docs/steady-base.md` that would change

The lines are at 264d13f8. The anchor does not yet cite `steady-base-menu.md` in its evidence
table. These are the lines a fold-in of version 2 would change. This check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | the preamble listing the waves and their checks | add the closing paper, `steady-base-menu.md` v2, checked by `survey-check-12.md` |
| 119 | "ten times cheaper 5.2× … also holding fleet machinery, 2.8×" | mixes footings: 5.3× and 2.7× on cost-mix's weights (5.2× and 2.8× at the list-price tier ratio); state one |
| 124, 168 | "neither sees a saving under ×1.3 within eight weeks" | add: in dispatches or hours per correct change; ×1.3 is a holdout in hours with independent changes; a before-and-after needs ×1.6–1.7 at eight weeks; the menu's sizes are in weighted tokens |
| 141 | "About 27% of fleet tokens go to supervision steps that observable state fully decides" | stands; add: of which code can route 10% by class today, 14% only if it could tell quiet wakes in advance (`steady-base-menu.md` v2) |
| 198 (row 14) | "~1.5–2% as sized" | "unsized; bounded by 4.9–12.1%" |
| 201 (row 17) | "about 15 points of it truly avoidable"; "~15% of tokens" | "tracker 24.7% and remote 4.4% of fleet tokens, halved 14.6%; 58% of the tracker share is in supervisor sessions, so 12–14% of what the conductor leaves" |
| 207 | "the synthesis menu will merge them and count overlapping savings once" | "`steady-base-menu.md` v2 merges them: 18 token-sized options, 7 in hours, 11 enablers" |
| 208, 149 | "A doubling needs the structural rows" | stands; add: the whole menu is ×1.57–2.38, ×1.49–2.10 with credential work held, against the bound's 2.5× |
| 223 | "proportionality and sized gates alone give 1.7–1.8× at most" | cost-mix's options 1–4 include option 3, half the fixed part, so 1.7–1.8× is proportionality plus a halved fixed part; the menu reaches 2× only by sizing the structural rows above half |
| 226 | "Every paper cited here has been checked … `survey-check-11.md` checked the sixth wave's three" | add: `survey-check-12.md` checked `steady-base-menu.md` |
| after 268 | (last evidence row) | rows for `steady-base-menu` (v2) and `survey-check-12` |
| 285 | "The research stage closes after one last paper … and its check" | stands; the check is `survey-check-12.md` |

Unchanged and confirmed:
- Line 28's 27% and 86%.
- Line 119's 2.5× and "about 10×".
- Line 187's −10% by class, −14% if code could tell.

## Method

```sh
node scripts/survey-menu-analyse.mjs          # at 264d13f8 before any edit: every printed figure; 166 / 19,771 scripts
node scripts/survey-menu-figures.mjs          # both SVGs byte for byte (git status clean)
node scripts/survey-check-12.mjs --costmix <LIN-3189 snapshot>/costmix-tokens.json --write-selection <scratch>/sel.json   # 348 tickets
node scripts/survey-replay-chores.mjs --selection <scratch>/sel.json --costmix <LIN-3189 snapshot>/costmix-tokens.json --out <scratch>/chores.json   # 1,986 sessions
node scripts/survey-check-12.mjs --chores <scratch>/chores.json   # the split, M12 given F1, v1 and v2 stacks
```

- **The token snapshot** is LIN-3189's git-ignored `data/survey-replay/costmix-tokens.json`, the
  output of `survey-costmix-tokens.mjs`. It was copied, not modified. Transcripts were read from
  `~/.claude/projects`.
- **Supervisor sessions** are the snapshot's `autopilot` and `wake` kinds. Together they are 37.1%
  of tokens, against `where-the-effort-goes.md` v2's 35% for the supervision layers.
- **The chores classifier** is `survey-replay-chores.mjs` unchanged: a proxy call is tracker; `gh`
  and remote git are remote.
- **M12 given F1** assumes the conductor removes chores in proportion to the supervisor tokens it
  removes, F1 ÷ 37.1. What is left is halved and divided by what F1 leaves.
- **Sizes** were traced by reading each cited section at 264d13f8 and its check. Three
  frontier-tier subagents did the reading; this session re-read every figure that changed.
- **Proxy.** This session made six reads: the dispatch item, the brief, the ticket, its relations,
  and `/me` and `/instructions` while orienting. The writes were this ticket's comment and status, and nothing else.

## Limits

- **The tracker split is by session kind, not by step.** It assumes the conductor removes chores
  in proportion to the supervisor tokens it removes. *Bias:* the conductor's steps are the polling
  and posting, so they likely carry more than their share of the chores. M12's top would then be
  lower than 12.3%, and S4's top lower than ×2.38.
- **The snapshot covers August and September; the menu's shares are September's.** The fleet-wide
  tracker share reproduces `survey-check-11`'s September figure within a tenth of a point.
  *Bias:* small.
- **The other overlaps are not measured.** These are F1 against orientation and the bootstrap,
  M12 against M9, and M13 against M8. *Bias:* each would lower the stacks' tops.
- **The scorecard's detection floors are not converted to weighted tokens.** This check says the
  units differ; it does not size the difference. *Bias:* unknown in direction.
- **The subagents shared a tier with the paper's author.** Their readings are of quoted text, so
  each can be checked, and this session re-read every changed figure at its source.
- **The anchor may move.** The lines are listed at 264d13f8, and a later edit shifts them.

## Next

- **The proposals line on the factors' overlap is answered in part.** The tracker chores sit 58%
  in supervisor sessions. The line in `proposals.md` is narrowed to what remains: the step-level
  split of chores, orientation and the bootstrap inside the conductor's 27%. No new line is added.
- **The research stage closes.** The one measurement that decides whether 2× is in reach is still
  the paper's Part 5, question 2: how much of the supervision cycle a reader of the runner's state
  would have answered identically.
