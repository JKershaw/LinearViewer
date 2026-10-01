---
title: Do the cost-mix and how-process-changes-land papers hold up?
kind: paper
version: 1
date: 2026-10-01
authors: [Claude (LIN-3185)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 1c1b8348, kind custom, LIN-3185); effort not recorded in the dispatch item. One bounded session, with no research, plan, review or close-out legs, by the brief's design. One in-session subagent of the same tier re-ran how-process-changes-land's scripts and checked its claims and cites; this session re-ran cost-mix's, read both papers against their sources, settled every figure below and wrote the check. It is not the author of either paper, which came from dispatches 747fe269 (cost-mix) and 8ae2b27d (how-process-changes-land)."
grounded_at: 9a73a179 (LinearViewer, origin/main when the check was written, for the anchor's line numbers; docs/steady-base.md is unchanged from cce25f13 and 26014544); cost-mix's data at 26014544, how-process-changes-land's at cce25f13 (each re-run in a clone with origin/main pinned to that sha); simple-dispatcher 3366748; transcripts and runner logs read on this machine on 1 October 2026
cites:
  - "docs/papers/harbour/cost-mix.md@9a73a179 (version 1, LIN-3180) and its scripts survey-costmix-classes.mjs, -tokens.mjs, -analyse.mjs, each re-run"
  - "docs/papers/harbour/how-process-changes-land.md@9a73a179 (version 1, LIN-3182), its four coded JSON files and its scripts survey-landing-history.mjs, -halfdone.mjs, -accretion.mjs, -charge.mjs, -trials.mjs, each re-run"
  - "docs/papers/harbour/reliability-baseline.md@26014544:71-86 (attributed escapes by size: 0.7, 1.2 and 2.5 per 100) and survey-check-readings.json@26014544 (the residue and finder rows version 2 removed)"
  - "docs/papers/harbour/proportional-process-backtest.md@26014544:36-41, :133-150 (5 of 249 mature M3 light changes went wrong after merge) and :195-203 (review caught a real fault on 8 of 328 M3 light changes)"
  - "docs/papers/harbour/which-rules-pay.md@26014544:57-70 (44 real faults on 18 of 100 tickets)"
  - "docs/papers/harbour/what-doubled-the-dispatches.md@cce25f13:52-68 (36.3 by the session entered and 47.1 by the child named, 14–28 September code changes)"
  - "docs/papers/harbour/measuring-throughput.md@cce25f13:115-122, :160-167 (11.4–16.0M per correct change; ×2.1 on the weekly ratio and ×2.8 on the per-change series at four weeks)"
  - "docs/papers/harbour/fleet-complexity-read.md@26014544:15-18 (the mid tier weighted at 0.6) and lib/model-pricing.js@26014544:111-129 (the September mid tier listed at $2 per million input tokens against the frontier tier's $5)"
  - "docs/reviews/intra-session-efficiency-review-2026-08-14.md@26014544:141-149 (the day understated by $254.75, +18.2%) and docs/reviews/capacity-test-run-review-2026-08-14.md@26014544:127-135"
  - "docs/steady-base.md@9a73a179 (the lines listed below)"
  - "LIN-3185's description and brief, read over the workspace proxy 2026-10-01"
  - "scripts/survey-check-9.mjs and scripts/survey-check-9-landing.mjs (this check)"
---

# Do the cost-mix and how-process-changes-land papers hold up?

Their counts hold, but several of their readings do not. Every committed script re-runs, and
every table reproduces byte for byte from the authors' snapshots. That covers cost-mix's
classes, tokens and analysis, and how-process-changes-land's history, census, accretion
sample, charging rules and trial sizes. Both papers' arithmetic is right. Where they fail is
in what they compare with.

**Cost-mix.** Its Amdahl bound survives every test made here:
- re-weighting the mid tier: 2.5×, 5.2× and a ceiling of 9.9;
- re-reading the class rules;
- the escape conventions.

Five claims do not hold:

- **"Escapes run at about 3 in 100 in every size band."** It counts the review-residue and
  finder rows that `reliability-baseline.md` v2 removed. On v2's terms the rates are 1.3, 2.1 and
  2.2 per 100 for 1–49, 50–299 and 300+ lines, the same rising order v2 found. The intervals
  overlap.
- **"About half of a small change's cost is fixed."** What was measured is different: about half
  of what the 120 standalone changes cost would remain if each cost what a 1–49-line change costs.
  That floor is a lower bound. A linear fit puts the size-independent share near nine-tenths.
- **The backtest's 5 of 249.** Cost-mix reads them as faults review caught. They are failures that
  shipped. Review caught a real fault on 8 of 328 small low-risk changes. At that rate, finding
  none in 23 changes happens about half the time.
- **Option 4's 1.5×.** It halves the survey papers and the parent and unmerged spend along with
  the gates. Applied to changes only, it is about 1.2×.
- **"About one weekly allowance a week."** The derivation applies the 18.2% pricing correction
  as a divisor. It also takes weighted tokens as list prices. The September mid tier is listed at
  0.4 of the frontier tier's price, not 0.6. Corrected, September's fleet used 0.82–0.97
  allowances a week at list ratios, or 0.89–1.06 on cost-mix's weights. It is still about one.

The class called "proxy, dispatch and fleet machinery" also holds about 10 points of feature
work: the rulings feed, the Flight Companion and scan-due. Cutting that work too raises the
ceiling with credentials and fleet held from 2.7 to about 3.7.

**How-process-changes-land.** Its history, half-finished census, accretion ratio (κ 0.72) and
trial sizes reproduce. Four claims do not hold:

- **The 214 "open process follow-ups".** They are 100 follow-ups and 114 review-residue tickets,
  at a median of about 53 days, not two months.
- **The headline table's "×2.1 … as printed".** The anchor prints 2.8× in dispatches and 2.0× in
  hours. The ×2.1 is `measuring-throughput.md`'s weekly ratio, a different series.
- **Holdout in hours, ×1.5.** That figure assumes changes are independent; the same paper inflates
  dispatches for clustering. On its own assumptions it is ×1.6–1.9.
- **"That matches its 36.3."** The comparison is not like for like. `what-doubled-the-dispatches.md`
  v2's 36.3 is session-entered, and its child-named count is 47.1. For the same population (code
  changes merged 14–28 September), this paper's census gives 33.6 and 29.2. The two censuses
  differ, and the gap between the charging rules is 15% on one and 30% on the other. That gap is
  unreconciled.

The four charging rules are each correct as set out, and this check chooses none of them.

Both papers are at version 2 in this PR, with this check's author added. Nine lines of
`docs/steady-base.md` would change; they are listed below. This check does not edit the anchor.

## Findings

**Every script re-runs, and every printed number reproduces.** For cost-mix, the
re-runs were made in a clone with `origin/main` pinned to 26014544:
- `survey-costmix-classes.mjs` gives the same 1,337 changes, row for row.
- `survey-costmix-tokens.mjs` gives the same 3,426.4M plus 166.8M unmapped.
- `survey-costmix-analyse.mjs` writes an identical `analyse.txt` from the author's dispatch,
  runner and scorecard snapshots.

For how-process-changes-land, all five landing scripts give the author's JSON, with heads and
timestamps removed. `survey-doubling-runner.mjs`, re-run from the runner's state, still holds
every one of the 21,212 items. It finds 12 more cut at the same time.

| Figure | Version 1 | Checked | Verdict |
|---|---|---|---|
| **cost-mix** | | | |
| September's mix: fleet 27.1%, no change of its own 22.5%, docs and tests 18.0% (papers 10.0%), credentials 9.7% | | reproduce; 25.6%, 23.1%, 19.1% (10.8%), 10.1% with the mid tier at its list ratio | holds |
| 43 coded faults all in 50+ lines, 32 in 300+, none in the 23 small or docs-only | | reproduce | holds, as a count |
| "Review neither catches faults" on small changes | 0 of 23 | the backtest's census: a catch on 8 of 328 small low-risk changes and 5 of 140 docs-only; P(none in 23) 0.43–0.57 | corrected |
| Escapes "about 3 in 100 in every size band that has code" | 3.0, 3.7, 3.3 | 1.3, 2.1, 2.2 per 100 without residue and finder rows (4/297, 9/434, 4/181); 34 escaped Bugs become 18 | corrected |
| Escapes by class | credentials 5.1%, fleet 4.4%, SD 3.6%, UI 1.5%, other 1.7%, docs 1.1% | 5.1%, 2.3%, 1.4%, 0%, 1.2%, 0% on v2's terms; fleet still half the escapes | corrected |
| Backtest's 5 of 249 | "faults … that review caught, mostly at plan review" | failures after merge in M3's 249 mature light changes; review caught faults on 8 of M3's 328 light changes | corrected |
| More hours for size, fewer wrong changes | no | reproduces (15.6%, 9.9%, 14.2%) | holds |
| Bounds 2.5×, 5.3×, ceiling 10.3; 2.7× with fleet held | | reproduce; 2.5×, 5.2×, 9.9 and 2.8 at list ratios | holds |
| Class assignments | path rules | credentials mostly credential work (three wake and proxy tickets, 27M, misfiled in); "fleet machinery" holds 21 rulings, Flight Companion and scan-due tickets, 9.7% of the budget; ceiling with credentials and fleet held 2.7 → 3.7 without them | qualified |
| "About half of a small change's cost is fixed" | | half of the 120 standalone changes' cost is the small-change floor (49.6%); the linear fit's intercept is 89% of a code change's mean | corrected |
| A split family costs 1.8× its children standalone | | reproduces (1,572M against 889M, standalone means) | holds |
| 14.1M per correct change, 70.7 per billion | | reproduce; 13.0M at list ratios | holds |
| One weekly allowance | 790–970M | 793–937M (the +18.2% applied as a markup) | corrected |
| September in allowances a week | 0.87–1.06 | 0.89–1.06 on cost-mix's weights; 0.82–0.97 at list ratios | corrected |
| "Weighted tokens are list-price ratios" | | true for the frontier and cheap tiers; the September mid tier lists at 0.4, weighted 0.6 | corrected |
| Option 4, gates sized to the change | 1.5× | 1.23× on 0–299-line changes; 1.54× only if the papers, parents and unmerged spend halve too | corrected |
| Options 1–4 together | about 1.7× | 1.74× as the example computes it, 1.82× with option 1 at a third | holds |
| **how-process-changes-land** | | | |
| 27 changes; 2 measured before and after; 9 half-finished; none with a retirement condition | | reproduce (5 changes touch both repos: 22 + 10 − 5) | holds |
| Adds to removals 6:1 (8:1 second reader, κ 0.72) | | reproduce: 25:4 and 25:3; κ 0.718 on effects, 0.739 on classes; the ratio's interval runs about 2:1 to 21:1 | holds, interval added |
| 47 switches, kept old paths and parked experiments | 21 / 19 / 7 | reproduce | holds |
| "214 open follow-ups on process work, median about two months" | | 100 `kind:follow-up` and 114 `kind:review-residue`; median 53 days; 204 of the 214 ages interpolated | corrected |
| Before and after ×2.1 at four weeks a side; alternate weeks ×2.1 in 8 | | reproduce (×2.14 dispatches, ×2.10 hours) | holds |
| Holdout ×1.8 dispatches, ×1.5 hours | | ×1.87 / ×1.83 dispatches, ×2.1–2.7 clustered; hours ×1.5 independent, ×1.64–1.9 clustered | corrected |
| "Detectable change at four weeks … ×2.1 (weekly ratio), as printed" | | the anchor prints 2.8× (dispatches, per-change series) and 2.0× (hours) | corrected |
| Rules agree until LIN-2121: 4 differ before, 896 after | | reproduce | holds |
| Per-change rules charge "42–55%" | | 42% is the July block, 49–55% September | clarified |
| Late September 36.9 / 35.0 "matches its 36.3" | | what-doubled v2: 47.1 child, 36.3 session; this census, like for like: 33.6 / 29.2 | corrected |
| The anchor's "about a third" is the gap on wakes; a tenth on dispatches | | what-doubled v2's wakes, 29 against 18, are a third apart; this census's dispatches are 15% apart like for like and what-doubled's 30% | qualified |
| Working hours "fell from 4.4 to about 2.5 and held" | | the anchor says July's 4.4 counted other workspaces' sessions | qualified |
| Cold resumes 0.2 → 2.6; 7.6 → 20.0; supervision 28% → 45%; the change log's 9/2/18 | | reproduce at their sources | holds |

**Cost-mix's escapes are not flat by size on the measurement paper's terms.** Cost-mix takes
every escaped Bug whose `introducedBy` names a change merged from June to August: 34 Bugs on 33
changes. `reliability-baseline.md` v2 removed two kinds of row (`survey-check.md`), and its
"24 attributed escapes" are what remains:
- **review residue:** a Bug filed from another ticket's review ledger, by label or by its own
  text;
- **finder rows:** an `introducedBy` that names the ticket whose review found an older fault.

Sixteen of cost-mix's 34 are those rows. Without them:

| Size | Changes, Jun–Aug | Cost-mix | v2's terms (95%) |
|---|--:|--:|--:|
| 1–49 lines | 297 | 9 (3.0%) | 4 (1.3%, 0.5–3.4) |
| 50–299 | 434 | 16 (3.7%) | 9 (2.1%, 1.1–3.9) |
| 300+ | 181 | 6 (3.3%) | 4 (2.2%, 0.9–5.5) |

This is the order `reliability-baseline.md` found on total lines: 0.7, 1.2 and 2.5 per 100.
Neither convention is the truth. Some residue does name the change that wrote the fault:
LIN-2272 against LIN-2252's inert padding fix is one, and the backtest counts it as a failure.
So the true small-change rate lies between about 1.3 and 3.0 per 100. "About 3 in 100 in every
size band" is the top of that range.

By class, credentials stay at 4 of 78 (5.1%). Fleet machinery falls to 9 of 388 (2.3%), still
half the escapes. UI, and docs and tests, fall to none.

The paper's sharpest contrast is between small changes, which escape like large ones, and
review catching nothing on them. That contrast becomes "small changes escape at most as often,
probably about half as often".

**Review does catch faults on small changes, about as often as they escape.** The 0 of 23 is
true of `which-rules-pay.md`'s 100 tickets. The backtest read every send-back across June to
September:
- small, low-risk changes (M3): a real fault caught on 8 of 328;
- docs- and tests-only changes: 5 of 140;
- "small by size" (M4): 10 of 468.

At those rates a sample of 23 shows no catch 43–61% of the time, so the 0 of 23 says little.

Cost-mix's Option 1 also misreads the backtest. Its "5 faults on 249 small changes that review
caught, mostly at plan review" are the 5 of M3's 249 mature light changes that went wrong after
merge. Those are what a light lane would add to the escapes. Review's catches on the same group
are the 8 of 328 above, 11 of 15 findings at plan review, and they are what a light lane would
put at stake.

**The bound is robust; the class boundary is the weak joint.** Re-weighting the September mid tier
at its list ratio (0.4 of the frontier tier, `lib/model-pricing.js`, against
`fleet-complexity-read.md`'s 0.6) moves every share by under 1.5 points. The bound becomes
2.5×, 5.2× and a ceiling of 9.9, or 2.8 with fleet held.

The credential regex reads file names, and in September it mostly finds credential work:
connection binding, email auth and token scopes. Three tickets are misfiled in, together 27M,
under 1% of the budget:
- LIN-3139, a wake and follow-up census, through `lib/wake-credential.js`;
- LIN-3130, runner proxy routes;
- LIN-2360, the proxy split.

The fleet-machinery rule is broader than its name. It lists `flight-companion`,
`task-decisions`, `shelved-rulings`, `dismissal-suggestions`, `recommend`, `brief`, `recap` and
`periodical` among its paths. Twenty-one of the 91 fleet tickets with September spend are the
rulings feed, the Flight Companion and scan-due by title, read by hand: 348M, 9.7% of the budget.
Among them are LIN-2444 (35.5M), LIN-2991, LIN-2650, LIN-3022 and LIN-2623.

The 2.7× ceiling applies only if all of that must stay rigorous. Held as product features, it is
about 3.7, and the gain at a third is 1.95× rather than 1.73×. Which side these tickets belong on
is a judgement this check does not make. The bound should say where its boundary sits.

**"About half of a small change's cost is fixed" misstates the measure.** The script's floor share
asks what the 120 standalone changes born in September would cost if each cost the median 1–49-line
change. The answer is 49.6% of what they did cost. For a small change the floor is its whole cost,
by construction. Two further points:
- The 120 include 50 docs-only changes, mostly survey papers.
- The script's own linear fit over the 70 code changes puts the intercept at 7.8M of an 8.8M mean,
  89%.

The defensible claim is that at least half of a standalone change's cost does not depend on its
size, and probably most of it. The "at most double" for shrinking size-dependent work is
therefore an upper bound: between about 1.1× and 2×.

**The family multiple holds.** 1,572M against 889M uses the standalone *mean* by band, as the paper
says. The script's variable is called `saMed`, but it holds means. Children of a split cost more
than standalone changes of their size even before the parent's spend: 951M against 889M. So
about 0.1 of the 1.8× is the children themselves.

**The allowance derivation, step by step.**
- 27 meter points against $1,070.58 is $3,965 per allowance.
- At $5 per million frontier-input tokens, that is 793M weighted tokens.
- LIN-2113's figure is that the old table understated a day by $254.75, "+18.2%". The base is the
  intra-session review's own $1,400 day, so it is a markup: ×1.182 gives 937M.
- Cost-mix divides by 0.818, which gives 970M.
- September's fleet spent 838M a week on cost-mix's weights: 0.89–1.06 allowances.
- The weights price the September mid tier, which carried 23.6% of weighted tokens, at 0.6 of the
  frontier tier. The list table that priced the calibration day has it at 0.4, so at list ratios
  September is 773M a week, 0.82–0.97 allowances.

"About one weekly allowance a week" holds. "The meter's units are this paper's units" needs that
one correction. "Correct work is capped by the allowance, not by demand" is an inference from
being near one, not a measurement. The same re-weighting puts September at 13.0M per correct
change, not 14.1M, and would lower the anchor's 11–16M by about 8%.

**How-process-changes-land: the follow-ups are two kinds, and three detection figures are
mis-set.**
- **The 214.** It is the table's two rows added: 100 open `kind:follow-up` and 114 open
  `kind:review-residue` tickets on process fronts. The median ages are 53.5 and 53 days, both
  interpolated for 204 of the 214.
- **"As printed".** The paper's table of headline figures puts "×2.1 (weekly ratio), as printed"
  under the pooled rule. The anchor (line 125) prints 2.8× in dispatches and 2.0× in hours, both
  `measuring-throughput.md`'s per-change series on the observed spread of weekly means (`:166-167`).
  The ×2.1 is the same paper's weekly ratio (`:162`), a fair figure for before-and-after but not
  the one printed.
- **Holdout in hours.** `survey-landing-trials.mjs:67` gives hours no design effect. Dispatches get
  one (`:52-62`). With the paper's own ρ of 0.1–0.3 and cluster size 6.1, hours by holdout see
  ×1.64–1.9 at four weeks, not ×1.5. Option 4 inherits this.

**The 36.3 does not match.** The paper counts late September "as `what-doubled-the-dispatches.md`
counts", gets 36.9 by the child and 35.0 by the session, and says that matches its 36.3. But
what-doubled v2's 36.3 is session-entered; by the child named it is 47.1 (`:58, :66-67`). Like for
like is code changes, `prodLines` above 0, whose last merge falls 14–28 September: 76 merged, 64
correct and complete. On that population this paper's census gives 33.6 by the child and 29.2 by
the session.

| Census | By the child named | By the session entered | Gap |
|---|--:|--:|--:|
| what-doubled-the-dispatches v2 | 47.1 | 36.3 | 30% |
| how-process-changes-land, like for like | 33.6 | 29.2 | 15% |

The censuses read the same runner logs, so a gap of 13.5 dispatches by the child is unexplained.
The likeliest sources are the code-change definition and the session ticket's rule. This check
does not settle it. Until it is settled, two statements depend on which census is right:
- the paper's "on dispatches per change it is about a tenth";
- the anchor's "about a third" (line 168).

**The four charging rules, as set out.** Each was checked against `survey-landing-charge.mjs` and
reproduces in every cell of the block table:
- **child named:** the item's `Issue:` line, else its chain's root;
- **session entered:** the ticket of the fresh launch that opened the session;
- **lineage spread:** the session's ticket if correct, else split equally over the correct
  changes beneath it;
- **pooled:** the week's dispatches over the week's correct changes.

The "42–55%" is right but reads as one block. 42.2% is 13 July–9 August under both per-change
rules, and 54.8% and 49.3% are September's. The fairness table follows from where each kind of
change saves, and nothing in this check moves it. The choice of rule stays John's.

**The Options sections: sizes and overlap.**

Cost-mix's options:
- Options 1, 2, 5 and 6 are sized correctly from its shares.
- Option 3 (1.3×) halves the fixed part everywhere, survey papers included. The fixed part is at
  least half and probably most of a change's cost, so this is a floor on what halving it would buy,
  not a ceiling.
- Option 4 is overstated, as above.
- Option 1's risk column needs the corrected backtest reading.

How-process-changes-land's options:
- Option 2's "makes ×2 visible" sits at the edge, because ×2.1 is the 80%-power floor.
- Option 3's "~27% at most" is the anchor's row 3, which already includes rows 1 and 2.
- Option 4 needs its hours figure corrected.
- Options 1, 5 and 6 are unsized by design, and their counts reproduce.

The two menus overlap in three places:
- Cost-mix's options 1 and 4 (a light lane, gates sized to the change) are the anchor's row 7.
  That is the case the other paper's Option 4 and its "session entered" fair rule address.
- Cost-mix's option 3 (the fixed part: orientation, gates, wakes) spends on the same wakes as the
  other paper's Option 3 (map rows 1–3).
- Cost-mix's option 2 (split families) is exactly the spend the child, session and lineage rules
  disagree on. Its 1.8× and +52% are child-named; session-entered it is +56%.

The two menus also collide in one place. Cost-mix's options 1–3 are worth 1.1–1.3×, which is
below every cost trial mode in the other paper within eight weeks: holdout's smallest is about
×1.45 in dispatches, or ×1.33 in hours if changes are independent. Option 4 at 1.2× is below them
too. As things stand, none of cost-mix's first four options could be shown to work by the trials
the other paper sizes. A trial would need many more changes, or a narrower measure than cost per
correct change: for example, tokens per 1–49-line change, which cost-mix's own Option 1 proposes.
Neither paper adds options here, and neither does this check.

### The lines of `docs/steady-base.md` that change

The lines are at `9a73a179`. The anchor does not yet cite either paper, so these are the lines a
fold-in of the two version 2 papers would change. This check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | "…and `survey-check-6.md` checked `why-legs-repeat.md`, now at version 2.)" | …now at version 2. The fifth wave's `cost-mix.md` and `how-process-changes-land.md` were checked by `survey-check-9.md`, and each is now at version 2.) |
| 25 | "A docs- or tests-only ticket still costs about 77% of the median ticket's tokens…" | The line stands; add after it: at least half of a September standalone change's cost does not depend on its size, and probably most of it; a split family costs 1.8× its children as standalone changes (`cost-mix.md` v2) |
| 105 | "**Proportionality is a real but smaller lever.** … 13–18% of working hours (21–30% of dispatches) …" | …and, in correct work per weekly budget, about 1.1× for a light lane on small non-credential changes and 1.2× for gates sized to the change (`cost-mix.md` v2). The rest of the line stands |
| 123 | "11–16M weighted tokens each in September." | 11–16M weighted tokens each in September (14.1M for the month), about 8% less at list-price ratios, because the September mid tier is weighted at 0.6 of the frontier tier and listed at 0.4; about one weekly allowance a week (`cost-mix.md` v2) |
| 125 | "Over four weeks the instrument detects a 2.8× shift in dispatches per change or 2.0× in hours…" | The line stands; add: on the weekly ratio a before-and-after sees ×2.1 at four weeks a side; a holdout by ticket sees ×1.8–1.9 in dispatches and ×1.5 in hours if changes are independent, ×2.1–2.7 and ×1.6–1.9 if changes under one supervisor move together; neither sees a saving under ×1.3 within eight weeks (`how-process-changes-land.md` v2) |
| 148 | Row 7's evidence: "…Backtest: 11–26% of changes route light (`proportional-process-backtest`)" | …; in correct work per budget, 1.1–1.2×, and small changes escape at 1.3–3.0 per 100 by the escape convention (`cost-mix.md` v2) |
| 168 | "**Should a change's cost include the wakes into the epics and Runner above it?** The answer moves September's figures by about a third…" | …There are four rules (child named, session entered, lineage spread, pooled), and which is fair depends on where a change saves (`how-process-changes-land.md` v2). On code changes merged 14–28 September the first two differ by 30% in `what-doubled-the-dispatches.md`'s census and 15% in `how-process-changes-land.md`'s; the two censuses are not yet reconciled (`survey-check-9.md`). So the scorecard needs one rule, and one census, before the epic is measured |
| 171 | "**Every paper cited here has been checked by a second document.** `survey-check-6.md` checked the last…" | …`survey-check-9.md` checked the fifth wave's `cost-mix.md` and `how-process-changes-land.md` |
| 199 | (the last evidence row, `survey-check-6`) | add three rows: `cost-mix` (v2), where the weekly budget goes by kind of change and the bound on correct work per budget; `how-process-changes-land` (v2), how process changes landed and how the next should be trialled; `survey-check-9`, the independent check of the two papers above, and every figure it changed |

Unchanged and confirmed:
- Line 36's "22 real bugs in 9 tickets, mostly credential work" and line 82's "5 of its 249 went
  wrong (2 in 100)" are their papers' figures. Cost-mix's misreading of the 249 did not reach the
  anchor.
- Line 130's "The structure doesn't change mid-passage" is quoted rightly by
  how-process-changes-land.
- Line 209's "~2× throughput as the aim" is a decision. Cost-mix's bound says 2× needs cutting
  more than credentials, fleet and size-sorted gates alone can give: options 1–4 come to about
  1.7–1.8×. That is for John, not a line to change.

## Method

Each paper's scripts were re-run unchanged in a clone of this branch's repository with
`origin/main` pinned to the paper's grounding sha (26014544 for cost-mix, cce25f13 for
how-process-changes-land). Each clone holds the author's `data/` snapshots, copied from the
session workspace that made them. Outputs were diffed against the authors'.

```sh
# cost-mix (clone at 26014544, the author's data/survey, data/survey-costmix, data/survey-effort)
node scripts/survey-costmix-classes.mjs --sd <simple-dispatcher>           # 1,337 rows, identical
node scripts/survey-costmix-tokens.mjs --out data/rerun/tokens.json        # identical totals and tickets
node scripts/survey-costmix-analyse.mjs --out data/rerun/analysis.json     # analyse.txt identical
# the mid tier at its list ratio: survey-costmix-tokens.mjs with line 32's 0.6 set to 0.4, then the analysis again
# how-process-changes-land (clone at cce25f13, the author's data/survey and data/survey-doubling)
node scripts/survey-landing-history.mjs --sd <simple-dispatcher>           # then -halfdone, -accretion, -charge, -trials: each identical
node scripts/survey-doubling-runner.mjs --out data/rerun/runner-fresh.json # all 21,212 items present
# this check (from the repository root, with both papers' data/ in place)
node scripts/survey-check-9.mjs           # escapes on v2's terms, units by tier, the meter, the fleet class, the options, catch odds, the fixed part
node scripts/survey-check-9-landing.mjs   # the like-for-like count, follow-up ages, clustered holdout hours, the add:remove interval
```

- **Escapes on v2's terms.** These are cost-mix's population and join, without three kinds of Bug:
  - Bugs carrying `residueLabel`;
  - Bugs on `survey-check-readings.json`'s `unlabelledResidue` list;
  - Bugs on its `finderRows` lists, both those dropped by the lag filter and those kept in
    version 1.
- **Feature work in the fleet class.** A title rule (rulings, Flight Companion, companion,
  scan-due, rung-two, self-resolved, first screen) found 24 tickets. Each was read by hand, and
  three that are process or fleet work stayed in the class: LIN-2896 (CLAUDE.md), LIN-2825 (a
  scope ruling) and LIN-2645 (an observer pass).
- **Catch odds.** (1 − k/n)^23 at the backtest's census rates.
- **The like-for-like count.** The population is scorecard changes with `prodLines` above 0 and
  their last merge on 14–28 September (UTC). Every claimed dispatch naming one of them is counted,
  over the correct and complete ones:
  - by the child named: the item's `Issue:` line, else its chain's root;
  - by the session entered: the first fresh launch with a ticket in the item's session.
- **Proxy.** Reads of the ticket and its brief, and nothing else. The only writes are this
  ticket's comment and status.

## Limits

- **Every reader shares a tier with the authors.** The re-runs and readings are independent of the
  authors' sessions, not of their model tier.
- **The data are the authors' snapshots.** A re-run proves that the scripts are deterministic over
  them, not that the snapshots were complete. Cost-mix's tracker snapshot was partial (its own
  Limits), and how-process-changes-land's was copied mid-fetch.
- **Neither escape convention is the truth.** Cost-mix's counts residue that the measurement paper
  removed, some of which did name the writer. v2's terms drop them all. *Bias:* the true rates lie
  between the two columns, and the small-change rate is the least certain.
- **The feature-work count is a title rule read by hand.** A rulings ticket can carry machinery,
  and a machinery ticket can be named for a feature. *Bias:* unknown in direction, about ±2 points
  on the 9.7%.
- **The list-ratio re-weighting uses one month's tier mix.** Applying the 0.92 factor to the
  anchor's weekly 11–16M assumes every week had September's mix.
- **The two-census gap is found, not explained.** The 33.6 against 47.1 could be either census's
  error.
- **The anchor may move.** The lines are listed at `9a73a179`. A later edit shifts them.

## Next

- **Why do two censuses of the same runner logs give 47.1 and 33.6 dispatches per correct change,
  by the child named, for code changes merged 14–28 September?**
  `what-doubled-the-dispatches.md` and `how-process-changes-land.md` count the same items. One
  puts the gap between charging rules at 30%, the other at 15%, and the anchor's open question
  needs one census before it needs one rule. Join the two censuses item by item for that fortnight
  and name every item one counts and the other does not, by code-change definition, session rule
  and window edge. This goes into `proposals.md`.
- **Which side of the bound do the rulings feed and the Flight Companion sit on?** They are a
  tenth of the budget inside "fleet machinery". Whether review on them catches what review on
  wake and dispatch code catches would settle whether the ceiling is 2.7 or nearer 3.7. The
  cost-mix proposal on fleet-machinery catches can split the class first.
- Both papers' own Next items stand, with their figures as corrected in version 2.
