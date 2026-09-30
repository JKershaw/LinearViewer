---
title: What does each model tier really cost per correct change, once a ticket's afterlife is counted, and how has model choice changed?
kind: paper
version: 2
date: 2026-09-30
authors: [Claude (version 1, LIN-3165), Claude (version 2 corrections, LIN-3171), for John Kershaw]
model: Version 1: frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch e86a0765, kind custom, LIN-3165); effort not recorded in the dispatch item; one bounded session with no research, plan, review or close-out legs, by the brief's design. Version 2: frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 2d541647, kind custom, LIN-3171), effort not recorded in the dispatch item; the independent check `survey-check-4.md`
revision: "Version 2 corrects two inputs per docs/papers/harbour/survey-check-4.md (LIN-3171). Implementer tier: from 13 July to 30 August no change had a cost lineage, so version 1 took every tier from commit trailers, and 32 of the 69 trailer-frontier changes the runner can read were implemented by mid-tier sessions (a frontier close-out, review or autopilot wrote the final commit); 84 of the 91 readable 'tier not stated' changes were mid. Version 2 takes the tier from the runner's own implementation launches where there is no lineage. Dispatches: version 1 counted only dispatches whose log line names the ticket, which missed wakes until 13 September (what-doubled-the-dispatches.md); version 2 follows each follow-up to its root. Changed: whole-life hours per correct change (frontier 2.9-3.0, mid 3.2-3.3), the escape counts (13 of 302 against none of 60, p = 0.09 in those weeks), dispatches per correct change, now counting each follow-up for the session it entered (21 and 22; at the step 7.9 to 18.6 and 8.1 to 21.0; September 52, 32 and 37), the afterlife shares, the by-repo and standardised figures, the routing timeline (implementation ran at frontier 23-27 July; plan moved to mid on 28 July) and the selection limit. Working hours barely move: follow-ups carry no hours of their own. The conclusion that tier did not move cost per change stands. Two figures are redrawn from the corrected inputs."
grounded_at: f38acdf7 (LinearViewer), 3b1e734b (simple-dispatcher); version 2 at 25421c7c (LinearViewer)
cites: [docs/papers/harbour/survey-check-4.md (LIN-3171), docs/papers/harbour/what-doubled-the-dispatches.md@25421c7c:25-27, docs/papers/harbour/what-doubled-the-dispatches.md@25421c7c:38-43, docs/papers/harbour/measuring-throughput.md@f38acdf7:15-17, docs/papers/harbour/survey-check-2.md@cba8b7ae:301-316, docs/papers/harbour/survey-check-2.md@cba8b7ae:518-520, docs/papers/harbour/why-throughput-halved.md@f38acdf7:23-25, docs/papers/harbour/why-throughput-halved.md@f38acdf7:73-79, docs/papers/harbour/why-throughput-halved.md@f38acdf7:83-94, docs/papers/harbour/why-throughput-halved.md@f38acdf7:180-183, docs/papers/harbour/cheap-implementer.md@f38acdf7:39-44, docs/papers/harbour/cheap-implementer.md@f38acdf7:197, docs/papers/harbour/reliability-baseline.md@f38acdf7:37-40, docs/papers/harbour/why-throughput-halved.md@f38acdf7:79-81, docs/papers/harbour/where-the-effort-goes.md@f38acdf7:21, docs/papers/harbour/review-loops.md@f38acdf7:14-16, docs/reviews/model-effort-routing-proposal-2026-09-11.md@f38acdf7:11-36, docs/reviews/model-effort-routing-proposal-2026-09-11.md@f38acdf7:54-66, simple-dispatcher b39648b (LIN-1285, 2026-07-12), simple-dispatcher a5c7714 (LIN-1077, 2026-07-05), simple-dispatcher c97b26f (LIN-1694, 2026-08-07), simple-dispatcher 3f2fc6b (LIN-2567, 2026-09-05), LinearViewer fddf5271 (LIN-1094, 2026-07-06), LinearViewer a13880b4 (LIN-1390, 2026-07-17), LIN-3165 (2026-09-30)]
---

# What does each model tier really cost per correct change, once a ticket's afterlife is counted?

About the same for the frontier and mid tiers, and the afterlife barely changes that. In the
weeks where both tiers were in use and every change has had 30 days to show a fault (13 July to
30 August, both repos), a correct, complete change cost **3.2–3.3 working hours** over its whole
life when a mid-tier session implemented it, and **2.9–3.0** when a frontier session did. That
covers its own sessions plus the rework it later caused; the range runs from the fixes that name
the change to every fix on its files. The gap is within the noise: frontier's cost is 0.91 of
mid's, with a 95% interval of 0.70 to 1.21. Rework is under a tenth of either figure. A quarter
to three-fifths of it lands within a week, and a fifth to a quarter comes after day 30. Mid-tier
changes do escape more often: 13 of 302 here against none of 60, though in these weeks alone
that is not significant (one-sided p = 0.09). That count sets aside escape rows that name the
ticket whose review found an older fault. LIN-3155's "four times" (9.6% against 2.4%) counted
those rows too. On its own weeks, without them, the figures are 14 of 365 against none of 171.
But an escape's fix costs a fraction of the process around the original ticket, so escapes move
the whole-life cost by about a tenth of an hour. What moved the cost per change was not the
tier. At the 12 July step dispatches per correct change rose about two-and-a-half-fold for
frontier-implemented changes too (7.9 to 18.6). Since then they have kept climbing. In
September's provisional weeks the figures are 52 (frontier), 32 (mid) and 37 (cheap). The cheap
tier's changes are all younger than the 30-day window. Provisionally they cost what mid-tier
changes cost in hours (3.2 against 3.0) and less in dollars. LIN-3155's fall in frontier-written changes
(84 to 12 a week) and its equal cost per change reproduce. Its escape rates do not, so
`why-throughput-halved.md` is corrected to version 2 in the same PR.

![Who did the work: commits by trailer tier in each repo since January, and fleet working hours by session tier since 12 July, with every routing change numbered](figures/model-choice/who-did-the-work.svg)

![Whole-life working hours and dispatches per correct change by implementer tier, in two-week bins, with routing changes marked](figures/model-choice/whole-life-cost.svg)

![The afterlife curve: cumulative rework hours per change by days since it merged, frontier and mid implementers](figures/model-choice/afterlife-curve.svg)

## Findings

**Until 12 July every session ran at the frontier tier, whatever the dispatch asked for.**
Before simple-dispatcher's LIN-1285 (`b39648b`), claude-code sessions were launched with no
model flag, so they ran at the account default. Tier-bearing commit trailers from January to early
July name the frontier tier, apart from 25 changes in the fortnight before the switch. Harbour stored a per-kind model from 6 July (LIN-1094,
`fddf5271`) and per-kind presets from 17 July (LIN-1390, `a13880b4`). The values themselves
lived in runtime config, not in code, so the timeline below comes from the runner's own logs:

| # | Date | Rule change | Evidence |
|---|---|---|---|
| 1 | 5 Jul | Cheap-tier harness (OpenRouter via opencode) added; first real tickets on 8 Jul | SD `a5c7714`, run logs |
| 2 | 12 Jul | Sessions run at the dispatch's tier: implementation and close-out mid; autopilot, research, plan and review frontier | SD `b39648b`; first tier aliases in that day's log |
| 3 | ~20 Jul | Close-out back to frontier | mid close-outs through 20 Jul, frontier after, by prompt length in the run logs |
| — | 19–29 Jul | About fifteen tickets implemented at the cheap tier | run logs |
| — | 23–27 Jul | Implementation at frontier (64 of 67 implementation launches), then mid again; plan moves from frontier to mid on 28 Jul | run logs, by prompt length |
| 4 | 7 Aug | Harness resolved before model; unmappable models refused | SD `c97b26f` (LIN-1694) |
| 5 | 8–14 Sep | Cheap-implementer bake-off (LIN-2828); review and close-out stay frontier | `cheap-implementer.md:39-44` |
| 6 | 11 Sep | Review and close-out effort high → medium; tier unchanged | proposal `:11-36`, run log |
| 7 | 25 Sep | Implementation, research and close-out → cheap; plan stays mid; plan-review, review and autopilot frontier | run log, no commit |

By late August, implementation ran at the mid tier 172 times in 184 and plan 127 in 154. Every
other kind ran at frontier (`model-effort-routing-proposal-2026-09-11.md:11-36, 54-66`). In fleet
working hours the frontier tier still did most of the work after the switch, because it held
supervision, review and research: 65% of 943 hours from 13 July to 30 August (mid 32%, cheap 1%),
and 58% of 643 hours in September (mid 28%, cheap 13%). The cost lineages this survey fetched cover dispatches from late August onwards. They show the
same split by role:

- review: 381 of 385 sessions at frontier;
- plan-review: 163 of 169 at frontier;
- autopilot: 200 of 212 at frontier;
- close-out: 230 at frontier and 55 at cheap;
- research: 95 at frontier and 24 at cheap;
- plan: 191 at mid and 23 at frontier;
- implementation: 244 at mid, 104 at cheap and 27 at frontier.

**Changes written at the frontier tier fell from 84 a week to 12, as LIN-3155 said.** I
counted this before reading LIN-3155's script. Tier is the one most of a change's commit trailers
name, and a change is correct and complete on `measuring-throughput.md`'s rule. That gives
83.5 correct, complete frontier-written changes a week over 8–29 June, and 12.2 a week over
13 July–21 September. Over the same later weeks, frontier-written changes were 78.4% correct and
complete, with 2.3% escaping (4 of 171). Mid-tier changes were 66.6%, with 9.6% escaping (35 of
365). LIN-3155 reports 83.5, 12.1, 78%/2.4% and 67%/9.6% (`why-throughput-halved.md:73-94`).
Its script, read afterwards, uses the same trailer-majority rule, which is why the figures agree
to the first decimal. A trailer names the session that wrote a commit, though, not the one that
implemented the change. From 13 July a frontier close-out, review or autopilot often wrote the
last commit on a change a mid-tier session implemented. By the runner's own implementation
launches, about 9 frontier-implemented changes a week were correct and complete in the later
weeks, so the fall is if anything larger. Those escapes, though, come straight from the scorecard. The independent
check that landed today (`survey-check-2.md`) found that many of its escape rows name the ticket
whose review *found* an older fault. It also found that the scorecard's window opens two days
before the merge. Applying the check's own reading rule ("pre-existing", "predates", "older
code", "left out of scope") and requiring the Bug to be filed after the change merged leaves:

- frontier: none of 171 changes escaped (95% upper bound 2.2%);
- mid: 14 of 365 (3.8%, 95% interval 2.3–6.3%).

So mid does escape more; a one-sided Fisher exact test gives p = 0.004. But neither 9.6% against
2.4% nor "four times" holds: with no frontier escapes, the ratio has no upper bound, and the data
say only that it is above about 1.5. Taking the tier from the implementation sessions instead of
the trailers (the rule the rest of this paper uses) gives none of 129 against 16 of 517 (3.1%),
p = 0.03. On the same corrected basis the correct, complete shares are
79.5% and 69.6%. The tier's part of the June-to-July fall stays at about 3 to 4 of 48 changes a
week. `why-throughput-halved.md` version 2 makes exactly these corrections. Every escape figure
below uses this strict count, with the tier taken from the implementation sessions.

**Per correct change, the two tiers cost about the same, before and after the afterlife is counted.**
Code changes only, 13 July to 30 August (every one past its 30-day window):

| Implementer | Changes | Correct and complete | Escaped | Dispatches per correct change | Own hours per correct change | Whole-life hours per correct change | Rework hours per change |
|---|---|---|---|---|---|---|---|
| frontier | 60 | 72% | 0% (0) | 21.1 | 2.77 | 2.93–3.01 | 0.12–0.18 |
| mid | 302 | 66% | 4.3% (13) | 22.3 | 2.88 | 3.21–3.33 | 0.22–0.29 |
| tier not stated | 18 | 72% | 5.6% (1) | 13.8 | 2.37 | 3.02–3.19 | 0.47–0.59 |

One more change was implemented at the cheap tier. Frontier's whole-life cost is 0.91 of mid's
(bootstrap 95% interval 0.70–1.21), so the data cannot tell the tiers apart on hours. By repo
the picture differs but stays inside that noise. LinearViewer: frontier 3.4 and mid 3.3
whole-life hours per correct change, with 0 and 11 escapes. simple-dispatcher: frontier 2.1 and
mid 3.8, with 0 and 3 escapes, on 17 frontier changes. Holding size band and area fixed (17 cells
both tiers reach, weighted to their pooled mix), the escape gap stays (none against 4.3%) and the
cost gap all but closes: 2.0 against 1.9 own hours per change, and 2.2 against 2.2 whole-life. In dollars,
the priced lineage covers only September's dispatches, so it prices only provisional weeks.
The figure is ticket-scoped: it leaves out autopilot and wake sessions, which `/cost` reports
under every ticket they touch. On that basis a correct change cost $101 frontier-implemented
(13 correct changes), $53 mid and $31 cheap. The frontier figure rests on 13 changes and is 41%
imputed. The rework that September's changes have caused so far, on the ceiling, adds $22, $10
and $9 per change. Hours in the same weeks: 4.5, 3.0 and 3.2 own hours per correct change, with
frontier on only 26 timed changes. The tier's price shows up in dollars, not in time.

**An escape is cheap next to the ticket that caused it, so tier barely moves whole-life cost.**
Per 100 changes in those weeks, frontier-implemented work caused no escaped Bug and mid-tier
work 5; they had 10 and 8 later fixes that named them. Each also had follow-up filings (32 and 23
per 100), which this paper counts as carried scope, not rework. The rework those escapes and
fixes caused came to 0.1–0.2 hours per change for frontier and 0.2–0.3 for mid. That is under a
tenth of the 3 hours each change cost itself. So the tier's escape gap turns into about a tenth
of an hour.
Hours are not the operator's attention, though: `reliability-baseline.md` records who found each
escape, and this paper does not price the finding.

**The afterlife is front-loaded for mid, later for frontier, and has a tail past 30 days.** For
changes merged 13 July to 1 August, followed for 60 days on the same-file ceiling, 27% of
frontier's rework hours and 57% of mid's land in the first week. By day 30 the share is 73% and
80%, and the rest arrives by day 60. Mid-tier changes accumulate about twice as much: 0.54
against 0.26 hours per change by day 60. The gap opens in the first week and widens to day 26.
So the 30-day whole-life figures above miss about 0.1 hour per change, at either tier. Reopens
barely register: 1–3% of either tier's changes landed again three or more days after they first
merged.

**The 12 July step is a natural experiment, and it says the cost rise is not the tier.** On
12 July the rule moved implementation from frontier to mid overnight, while review, plan and
research stayed frontier. In the two weeks either side:

- Merged code changes fell from 125 a week to 65.
- Frontier-implemented changes fell from 102 a week to 26.5, while mid rose from 12.5 to 34.5.
  Before 16 July no session's kind can be read, so the before-fortnight's tiers are the trailers'.
- Dispatches per correct change rose about two-and-a-half-fold at *both* tiers: frontier 7.9 to
  18.6, mid 8.1 to 21.0. The frontier tier did not change for those tickets, so the rise is not a
  tier effect.

In the same merge weeks (20 July to 2 August), the changes the rule itself sent to frontier
(23–27 July) cost 2.6–2.7 whole-life hours per correct change and the mid-tier ones 4.0–4.2.
That is 0.64 of mid's, with a 95% interval of 0.41 to 1.07, on 41 and 54 changes, and the plan-review leg
arrived in the middle of that fortnight. It is too few, and too mixed with process changes, to
read as a tier effect either way.

The same day also brought the runner's new hook state machine (the oplog starts that afternoon).
Dispatch presets followed on 17 July and the plan-review leg on 26 July. So the step changed who
implements *and* how much process surrounds each change, and only the second moved cost per
change. A cleaner experiment would be a ticket switched between tiers part-way through. In the fetched
lineages that happened 12 times, all in September. Four went from frontier to mid in early
September. Five started cheap and ended at frontier or mid, and three went the other way around
the 25 September switch. Eight of the twelve are correct and complete so far, and none has
escaped yet. All twelve are younger than the 30-day window, and twelve is too few to read.

## Method

- **Population.** Changes are `survey-effort-git.mjs`'s: a ticket whose LIN-id names a
  first-parent commit on `origin/main` in LinearViewer or simple-dispatcher, dated by its last
  merge. *Correct* and *complete* are `measuring-throughput.md`'s definitions, taken from the
  same-day scorecard snapshot. Cost comparisons use code changes only: 1,164 of the 1,318
  changes since June, leaving out docs-only tickets such as papers.
- **Implementer tier.** Where the cost lineage records an implementation session, the tier of
  those sessions. Otherwise, the payload tier of the ticket's fresh implementation sessions in
  the runner's logs: the kind is read from a transcript from 29 August, and before that from the
  logged length of the bootstrap prompt, which names the kind from 16 July
  (`what-doubled-the-dispatches.md`'s decoder). Otherwise, the tier most of the change's commits'
  `Co-Authored-By` trailers name. The product-to-tier map lives in the scripts (`tierOfModel`,
  `tierOfModelName`); every OpenRouter model counts as cheap. 228 changes have a lineage tier;
  where they also have a runner tier, the two agree 165 times in 182. 339 more take the runner's
  tier, which differs from the trailer's for 144. Lineage and trailer agree 137 times in 178: a
  trailer names the session that wrote the commit, often a frontier close-out, review or
  autopilot after a mid-tier implementation, and a tie between tiers goes to frontier. 91 code
  and docs changes have no tier and are shown as *tier not stated*.
- **Own cost.** Dispatches come from the runner's logs, from 20 June: every fresh session whose
  log block names the ticket, plus every follow-up charged to the ticket of the session it
  entered (the root of its `followUpTo` chain), whatever its own log line says. One rule serves
  every period. Wakes named no ticket in the log until 13 September (LIN-2121), so counting only
  named items leaves out 40–47% of a ticket's dispatches before then
  (`what-doubled-the-dispatches.md:25-27`). From 13 September a wake's log line names the child
  whose boundary triggered it, not the session it enters, so a count by log line would charge
  wakes into epic autopilots and passage Runners to the child. That count gives 60, 35 and 48 for
  September; before 13 September the two counts agree. Working hours come from the runner's oplog, from
  12 July: each session's working phases, each interval capped at 2 hours, shared among the
  launches and cold resumes that ran in it. A warm follow-up carries no session in the log, so its
  time stays with the launch that opened the session, and the same fix moves hours by only 2–5%.
  A follow-up beat inherits the tier its session launched at. API-equivalent dollars come from
  `/issues/{id}/cost` for 671 changes merged from 20 July. A session at an unpriced model is
  imputed at its tier's median dollars per hour, and opencode rows are scaled by 1/0.55 for the
  known 45% under-report.
- **Afterlife.** Five events follow a change's last merge:
  - an escaped Bug naming it as introducer (`reliability-baseline-defects.json`);
  - a later fix-worded first-parent commit whose ticket names it (*named*);
  - any fix-worded commit on its production files within 60 days (*same-file*), with the fixing
    ticket's cost split equally among every change it could belong to;
  - a `kind:follow-up` filing whose parent or first-named ticket it is;
  - a re-landing three or more days after its first merge.

  An escape is *strict*: its reason does not read as a fault that predates the change
  (`survey-check-2.md`'s rule), and it was filed 0–30 days after the merge.
  Rework cost is the fixing ticket's own hours, dispatches or dollars. The *floor* counts escaped
  Bugs and named fixes. The *ceiling* adds same-file fixes. Whole-life cost is own cost plus
  30-day rework, divided by correct, complete changes. Follow-ups are reported beside rework, not
  inside it.
- **Standardisation.** Within 13 July–30 August, size bands (1–49, 50–299, 300+ production
  lines) × area (UI, lib, routes, prompts, runner, other). The cells both tiers reach are weighted
  by their pooled count.
- **Scripts.** `scripts/survey-model-git.mjs`, `survey-model-runner.mjs`,
  `survey-model-cost-fetch.mjs` (proxy, about 4.9 s a call), `survey-model-analyse.mjs` and
  `survey-model-figures.mjs`. Snapshots go to the git-ignored `data/survey-model/`, and the
  scorecard and tracker snapshots are reused from the same day's `data/survey/`. Version 2's
  inputs come from `scripts/survey-check-4-model.mjs variant <dir> --rule root`, which writes the runner and
  git snapshots with both corrections applied (it reads `what-doubled-the-dispatches.md`'s
  `data/survey-doubling/` snapshots); `survey-model-analyse.mjs` and `survey-model-figures.mjs`
  then run unchanged in that directory.

## Limits

- **The tier was not assigned at random, and after 12 July frontier implementation is the
  exception.** Of the 60 frontier-implemented changes of 13 July to 30 August, 44 had frontier
  implementation sessions, and 41 of those merged in the weeks of 20 and 27 July, when the rule
  itself ran implementation at frontier. The other 16 have no implementation session the logs can
  read and take the trailer's tier. Frontier's changes were larger (median 122 against 84
  production lines) and riskier (20% against 14% in a high-risk path). *Bias:* this inflates
  frontier's raw cost and, if harder work escapes more, its escape rate too. So the escape gap is,
  if anything, understated. Standardising on size and area leaves the escape gap and closes the
  cost gap.
- **The runner's implementation tier is decoded, not recorded, before 29 August.** It rests on the
  bootstrap prompt's length, which agrees with the lineage 165 times in 182 where both exist.
  Before 16 July no kind can be read. *Bias:* a misread kind moves a change between tiers in
  either direction. Taking trailers instead (version 1) gave frontier 3.4–3.5 and mid 3.25–3.4
  whole-life hours, a ratio of 1.02 (95% 0.75–1.30), so the conclusion does not rest on the
  choice.
- **The strict escape count reads reasons by rule, not by hand.** The rule drops 20 finder rows,
  where the check's reader found 35 of 66. So some finder rows may remain, and the scorecard's
  *correct* also inherits the check's mention-matched named fixes. *Bias:* both push escapes up
  and correct shares down. Finder rows fall mostly on the tier whose review files residue on
  older code, and that review runs at frontier for every change. So the effect on the gap
  between tiers is small, but mid's 3.8% is, if anything, still high.
- **Every mid-tier change was reviewed at the frontier tier.** The escape rates are what got past
  a frontier review, not what each tier writes. *Bias:* the reviewer is the same for both tiers,
  so it does not distort the comparison. It does hide mid's unreviewed rate, which is higher.
- **Escapes are counted when someone files them.** After July, agents found most of them
  (`why-throughput-halved.md:79-81`). *Bias:* direction unknown. Mid-tier work may be read more
  suspiciously, which would overstate its escapes. Or quiet frontier faults may simply go
  unfound.
- **Some later changes still have no stated tier.** A change with no lineage, no readable
  implementation session and no model trailer (18 code changes in 13 July–30 August) is shown
  separately, never merged into a tier. *Bias:* small. Of the changes trailers left untiered, the
  runner shows 84 of 91 implemented at mid.
- **Hours start on 12 July.** Before that date there are dispatches but no hours. The
  multi-beat follow-up design also changed what one dispatch is around the step, and the run logs
  are thin before 1 July and missing for 6–11 July. *Bias:* this overstates the rise in dispatches
  for both tiers alike, so it does not affect the between-tier reading.
- **Rework attribution.** The same-file ceiling over-counts on hot files: a fix is shared among
  every change that touched the file in the window, so it is spread thin rather than left out.
  The named floor misses fixes that name nothing. The truth lies between the two, and both
  bounds are reported. Follow-ups are left out of rework. Counting them would favour mid (23
  against 32 per 100).
- **Dollars.** Lineage exists only for dispatches in the last few weeks, some models are unpriced
  (imputed per tier), and Claude sessions run on the subscription, so a dollar here is quota, not
  cash. 77% of all lineage dollars are imputed from duration. Most of those are long orchestrator
  sessions, which the ticket-scoped figure leaves out. *Bias:* the unpriced models are the newest
  frontier and mid ones, imputed at their predecessors' rates, so if the new rates are higher,
  frontier and mid dollars are understated.
- **The cheap tier is barely measured here.** Its 38 September changes, including the bake-off,
  are all younger than the 30-day window. Their strict escapes so far (2 of 38) will rise as the
  window closes, as will mid's (3 of 165) and frontier's (0 of 50). `cheap-implementer.md` is the
  evidence for that tier to date. *Bias:* September figures understate every tier's escapes and
  rework, most for the latest changes, which are mostly cheap.

## Next

- **What does an escaped defect cost the operator, by implementer tier?** Hours say escapes are
  cheap. The finding, triage and re-dispatch fall on John, and this paper does not price them.
- **After 25 September's move to cheap implementers has had 30 days, does the whole-life cost
  per correct change change, and where does the rework land?** Re-run `survey-model-analyse.mjs`
  in late October.
- **What made dispatches per correct change climb from about 7 in June to between 32 and 52 in
  September, at every tier?** Which legs grew, and did they grow alike for every ticket kind?
  `what-doubled-the-dispatches.md` answers this for all tiers together; why frontier-implemented
  changes took the most in September is still open.

The first two go into `proposals.md`.
