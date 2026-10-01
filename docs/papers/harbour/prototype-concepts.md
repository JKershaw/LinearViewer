---
title: Which ideas from John's prototypes would serve the levers the fifth wave found, and what does a lean research process like Lighthouse's cost and catch next to a Harbour ticket?
kind: paper
version: 1
date: 2026-10-01
authors: [Claude (LIN-3187), for John Kershaw]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 89a0d16c, kind custom, LIN-3187); effort not recorded in the dispatch item. One bounded research session with no plan, review or close-out legs, by the brief's design. Three in-session subagents of the same tier gathered evidence: one read Lighthouse, one read the other prototype repositories, and one coded what each independent check of a Harbour paper found. The author coded the concept matrix and spot-checked the other two."
grounded_at: "d88e2216 (LinearViewer, origin/main when this session began); 3366748 (simple-dispatcher, origin/main); JKershaw/lighthouse@7828bb8b; the other prototype repositories at the shas in prototype-concepts-matrix.json; local Claude Code transcripts on the runner machine read 1 Oct 2026 about 10:00Z, sessions 1 Sep–1 Oct"
cites:
  - "docs/steady-base.md@d88e2216:101-124 (points 19–23) and :164-193 (the effort-to-savings map; rows 3, 14 and 16 at :172, :183, :185)"
  - "docs/papers/harbour/what-should-an-agent-leave-behind.md@d88e2216 and what-should-an-agent-leave-behind-evidence.md@d88e2216:13-80 (claims C1–C7 and the five prototype pins)"
  - "docs/reviews/context-efficiency-ceiling-review-2026-08-15.md@d88e2216:196-251 (LIN-2115: the 93-token pointer, 18 turns against 51)"
  - "docs/papers/harbour/starting-context.md@d88e2216 (v2; options B, C and E)"
  - "docs/papers/harbour/held-or-fresh.md@d88e2216 (v2; options A, B and D)"
  - "docs/papers/harbour/where-judgement-happens.md@d88e2216 (v2; options 1, 3 and 5)"
  - "docs/papers/harbour/cost-mix.md@d88e2216 (v2; the survey papers 10% of September's tokens)"
  - "docs/papers/harbour/which-rules-pay.md@d88e2216 (v2) and reliability-baseline.md@d88e2216 (v2)"
  - "docs/papers/harbour/model-choice.md@d88e2216 (v2; tier is not what raised cost)"
  - "docs/papers/harbour/survey-check.md … survey-check-9.md, steady-base-check.md, paid-where-written-check.md, what-should-an-agent-leave-behind-check.md, learning-while-the-tools-change-check.md @d88e2216 (coded in prototype-concepts-checks.json)"
  - "JKershaw/lighthouse@7828bb8b: AGENTS.md:18-41, charter.md:9,39,86, releases.md:5-25, studies/LH016/LH016.md:16-69, studies/LH016/data/costs.csv, changes.csv, changes_secondary.csv, harbour/usage.py, harbour/prices.json, harbour/instruments.md"
  - "LIN-3187 (description read 1 Oct 2026); sibling papers what-hides-between-sessions.md (LIN-3188) and replay-small-work.md (LIN-3189), running alongside"
---

# Which ideas from John's prototypes would serve the levers the fifth wave found, and what does a lean research process like Lighthouse's cost and catch next to a Harbour ticket?

**Nearly every lever has a prototype concept behind it, but none of the evidence is strong.** No prototype produced
better than a single-run controlled comparison on its own endpoint. Where the evidence points, it agrees with the fifth
wave:
- **Starting context.** A short pointer beats a maintained map or wiki. Pith's map lost to fresh exploration on 14 of 15
  tasks, and CodeWiki's answers got worse as it grew.
- **The conductor.** Code that holds the sequence around a narrow model call is the best-supported concept
  (Browser-agent: 3/20 to 19/20), but only on a small model and narrow tasks.
- **Relay handoffs.** A durable record lets a fresh worker resume, but it did not stop repeated work: tag-two's planner
  re-proposed done work at 51% with the record against 29% without it.

**Lighthouse.** A study costs about **$16 at list rates** (median of 13, from its own records). That was $14 before it
added a second, reader-and-inference review on 28–29 September and $52 after. A one-session Harbour paper costs
**$12** (median of 30), $21 with its share of the independent check, and a Harbour code change **$31** (median of 202).

Both review processes catch mostly figures and how sure a sentence sounds, and both kept finding things:
- **Lighthouse.** Its post-release corrections all came from review the keeper relayed after release, or from work the
  keeper commissioned, not from its second agent. Three of its twelve earlier articles had their main claim corrected.
- **Harbour.** 23 of 24 checked Harbour documents had a load-bearing claim corrected by their check.

So the lean shape is not cheaper than Harbour's lean paper shape. Its lesson is where the check sits (before release)
and that each added reader finds what the last one passed.

![Concepts against levers, shaded by strength of evidence](figures/prototype-concepts/concept-lever-matrix.svg)

## Findings

**1. The prototypes supply a concept for every lever, but at most a single-run controlled comparison for any of them.**
The matrix above codes each concept against the five levers by the strongest evidence the prototype produced on its own
endpoint:
- 0: an idea only;
- 1: a recorded observation with no control;
- 2: a controlled comparison with single runs or an internal endpoint;
- 3: a controlled comparison, repeated, with a stated endpoint.

Fourteen concepts, from twelve prototype repositories plus Harbour's own pointer probe as a comparator, reach 2 at most. Six
repositories hold nothing relevant: memory-monitor, yap-agents, Herd, harbour, opencode-lite-js and mangodb. Two more,
doc-maker and ma-test, are empty.

The five projects `what-should-an-agent-leave-behind.md` read are still at the commits it pinned, so nothing new has
landed in them since 20 September. The new evidence here is:
- Lighthouse;
- harbour-evals (three cheap models over sixteen Harbour step fixtures, one run each);
- tag (the first TAG, a fresh worker per bounded step chosen by a code scheduler);
- session-viewer and dash-analysis (observations or ideas only).

Every concept's evidence, endpoint and citation is in [`prototype-concepts-matrix.json`](prototype-concepts-matrix.json).

| Lever | Concepts | Best evidence, and which way it points |
|---|---|---|
| Starting context | Pointer (Harbour, LIN-2115); code map (pith); maintained wiki (CodeWiki, CodeWiki-Generator) | **A pointer, not a pack.** The 93-token pointer: 18 turns against 51, one task, one no-pointer run (strength 2). Pith's map answers scored 236 of 300 rubric points against 286 for direct exploration, 0 wins in 15 (2, against). CodeWiki went from 6 of 15 fully accurate answers to 4 as pages grew from 30 to 62 (1, against). |
| Handoffs in a relay | Durable task record (tag-two); graph state with a fresh worker per step (tag) | **A record is necessary, not sufficient.** Stateless readers rebuilt three closed episodes, but a planner given the record re-proposed done work for 24 of 47 nodes against 4 of 14 without it, on another commit (1). tag's one self-run resumed from the graph; every live model dispatch failed (1). |
| Research and planning cost | Graph investigation (tangle); fixture evals per step (harbour-evals); Lighthouse | **More coverage costs more tokens.** Tangle's graph found more topics in 14 of 18 single-run comparisons, often at 2–5 times the tokens (2). harbour-evals passed 11–14 of 16 step fixtures on cheap models, but review and research failed for every model (2). |
| Deterministic conductor | Code holds the plan and the model makes one narrow call per step (Browser-agent); code scheduler (tag); intervention labels (session-viewer) | **The best-supported concept, on the smallest model.** A chain driver took a two-hop task from 3/20 to 19/20, then 20/20, and a title-resolving tool took URL tasks from 29/40 to 39/40. Both are development before-and-after comparisons on a cheap small model, tuned on it (2). |
| Proportional process | Staged review (Lighthouse); a tier per step (harbour-evals) | **Review layers keep finding things; nothing yet says which to drop.** Lighthouse's coded changes and replays (2), below. |

The strengths are of each prototype's own endpoint: rubric points, keyword coverage, task pass rates and internal
grades. None of these is Harbour's correct, complete change at a cost. The one figure measured inside Harbour is the
pointer probe, which the fifth wave already counts (`starting-context.md` v2).

**2. Read against the levers, the prototypes confirm the fifth wave's direction and add no new size.** The fifth wave
found three things:
- re-finding costs 4.9–12.1% of tokens, and a short pointer beats a big pack (`starting-context.md` v2);
- a lean relay pays only with a small handoff, −19% as a bound (`held-or-fresh.md` v2);
- judgement concentrates at the gates, while 77–86% of supervision is mechanical (`where-judgement-happens.md` v2,
  `what-supervisors-do.md` v2).

The prototypes agree in each case:
- **No maintained map paid.** Both map projects lost to fresh exploration.
- **A durable record carried state but not judgement.** tag-two's planner repeated done work with it, and stateless
  readers still re-ran passing verifications and built one conclusion on empty output.
- **Code-led sequencing worked where the call was narrow.** That is the anchor's row 3 in miniature. The fifth wave puts
  27% of fleet tokens in supervision steps that observable state decides; Browser-agent shows code can carry such steps,
  on a 0.6B model.

What each would need to pay inside Harbour is in the trial table under Options.

**3. A Lighthouse study costs about what a checked Harbour paper costs, and its review now costs more than its
research.** Lighthouse prices each dispatch with `harbour/usage.py` and `harbour/prices.json`. All 16 dispatches with
committed token records re-price to their recorded cost to the cent. Studies after 26 September carry only the dollar
figures the agents transcribed from their transcripts, with the driving session marked incomplete.

| | n | Median, list-price dollars | Range or IQR |
|---|---:|---:|---|
| Lighthouse study, LH002–LH010 (one evidence review) | 7 | $14.03 | $11.00–16.10 |
| Lighthouse study, LH011–LH017 (reader review added) | 6 | $52.42 | $20.06–57.84 |
| Harbour paper, one session | 30 | $11.91 | $7.96–18.36 |
| Harbour check (one session, checks 2–3 papers) | 11 | $17.39 | $15.24–19.66 |
| Harbour paper with its share of its check | 22 | $21.11 | $16.82–29.75 |
| Harbour paper through the pipeline (research, review, close-out legs) | 8 | $27.70 | $23.31–31.84 |
| Harbour code change merged in September | 202 | $31.13 | $12.81–52.79 |

![What one study or change costs](figures/prototype-concepts/cost-per-piece.svg)

Over 13 studies, Lighthouse's research cost $109, review $128 and driving sessions $125. Review was 27–47% of subagent
spend for LH002–LH010 and 49–72% for LH011–LH016. This was by design: its working rules say "the review is where money
buys the most" (lighthouse `AGENTS.md:18`).

Its stated bound of about $20 of subagent spend a session was exceeded three times: $35.9, $36.75 against a raised
$50, and a $43.66 driving session that the bound does not count. The bound is a measurement, not a cap.

On the Harbour side:
- **The checks.** A Harbour check is a third of what a checked paper costs (median 33%).
- **The two charging rules.** The figures are charged to the session entered. Charged to the child the log names, they
  barely move: one-session papers $11.68, code changes $31.48.
- **The repos.** LinearViewer's code changes cost $31.48 at the median (163), and simple-dispatcher's $28.68 (39).
- **Size.** By size band, code changes cost $16.32 under 50 production lines, $32.20 at 50–299 and $50.52 at 300 or
  more.

**4. Both review processes mostly fix figures and certainty, and in both the uncaught problems came from a later
reader.** Lighthouse's own study of itself, LH016, coded 66 public-claim changes over six rounds of 28–29 September:
- **Where they happened.** 42 were made before release and 24 after, plus 29 more after release in its secondary frame.
- **The evidence review** made 23: certainty 8, figure 5, unit 4, scope 3, consistency 2, post hoc 1.
- **The reader review** that followed made 17 at its second stage, and the recheck of its resolutions 10.
- **What later steps caught.** 15 of the reader review's 17 were in passages an evidence review had already read and
  passed (lighthouse `studies/LH016/LH016.md:63`).
- **After release.** Every correction to a released piece came from review the keeper relayed after release, much of it
  by an outside reviewer, or from work the keeper commissioned (18 directly, 17 in the rounds those opened;
  `LH016.md:20,69`).
- **Replays.** Three fresh reader reviews replayed on released pieces found 5 of 16 known problems, 7 in part, and
  missed 4.

Of 15 released articles:
- 3 carry revisions after release;
- 2 carry correction notices and 5 later-evidence notices (13 notices in all);
- no figure changed in a revised piece. The corrections were to meaning.

Harbour's checks run after a paper merges, so all of what they find is a correction after release:
- **Load-bearing corrections.** 23 of 24 checked documents (22 papers, 2 essays) had at least one load-bearing claim
  corrected: 95 in all, about 9 corrected figures a document at the median.
- **Answers.** The headline answer held in 20 and changed in 4: `where-the-effort-goes`, `what-doubled-the-dispatches`,
  `browser-flakes` and `cost-mix`.
- **Revisions.** 23 of the 24 are now at version 2 or later, most revised in the check's own commit
  ([`prototype-concepts-checks.json`](prototype-concepts-checks.json)).
- **Code tickets.** For comparison, code review on a Harbour ticket led to production fixes of 44 real faults in 18 of
  the last 100 reviewed tickets, concentrated in a few risky ones (`which-rules-pay.md` v2). Escapes run at 5.7 per 100
  merged PRs in LinearViewer and 27.3 in simple-dispatcher in September, without residue (`reliability-baseline.md` v2).

**5. The comparison is unfair in five named ways, and the unfairness runs both ways.**
- **Research against code.** A Lighthouse study and a Harbour paper both end in prose with figures. A Harbour code change
  ends in a merged diff that a later Bug can name. The $31 code change pays for CI, review rounds and close-out that no
  paper needs. That makes code look dearer than its research-shaped share, so the bias is against code.
- **Different stakes.** A wrong Lighthouse claim is a public correction. A wrong Harbour figure enters the anchor that
  steers the steady-base epic. A wrong merged change can break a credential cutover. Harbour's heavier review on risky
  code is priced for that (`cost-mix.md` v2).
- **Different price tiers.** Lighthouse reviews on its top-priced tier, at 2.5 times its frontier tier's list rates.
  Harbour's checks ran on the frontier tier. A Lighthouse review dollar buys fewer tokens, which favours Harbour on cost
  per token.
- **Self-reported costs.** Lighthouse's dollar figures after 26 September are the agents' own transcriptions. Its
  driving-session figures are marked incomplete, and it estimates output tokens from characters. Harbour's are read
  from every transcript and subagent. This biases Lighthouse low.
- **Small and young.** Lighthouse is 153 commits over five days, with 13 costed studies, one shared keeper and the same
  model family coding and reviewing. Harbour's figures are a month of a fleet.

## Options

Each option is sized from the evidence above and from the fifth wave. None is a change; John decides. Effects are shares
of the fleet's weighted tokens unless stated. They overlap the anchor's map rows and each other, so they do not add.

| # | Option | Estimated effect | Evidence | Risk to correctness | How the scorecard would measure it |
|---|---|---|---|---|---|
| A | **Hand later sessions a short pointer, never a maintained map or wiki** (the anchor's row 14 and `starting-context.md` option B, chosen over building a map) | ~1.5–2% as sized there, bounded by re-finding at 4.9–12.1%. Building a map adds its upkeep, unpriced in any prototype | Pointer: 51 → 18 turns, one task (strength 2). Map: 0 wins in 15 against exploration (2). Wiki: accuracy fell as pages grew (1) | Low as a pointer; a stale one misleads, so it carries the commit it was read at | Repeat-read share and tokens per correct change, before and after |
| B | **Code holds the sequence around a narrow model call** in supervision: the completion gate, re-arms and liveness (the anchor's row 3) | Up to ~27% with rows 1–2, as the anchor sizes it; the prototypes add no Harbour size | Browser-agent 3/20 → 19/20 and 29/40 → 39/40 on a small model (2); tag's code scheduler, one run (1) | Lost wakes and stale state are where supervisors fail today (`what-supervisors-do.md` v2); the plumbing moves, it does not vanish | Tokens and wakes per correct change; supervisor failures per week |
| C | **A relay handoff that carries a "done and answered" list as well as the record** (inside the anchor's row 16) | Inside −9% to −19%; the list is what tag-two lacked | tag-two: 24 of 47 re-proposed with the record against 4 of 14 without (1); 0 of 48 acted wakes needed memory alone (`held-or-fresh.md` v2) | Medium: a fresh step that repeats done work or misses a verdict; the one held-memory recovery (LIN-2078) | Repeat legs and tokens per judgement step; send-backs per correct change |
| D | **Check a Harbour paper before it merges, not after** (Lighthouse's order) | About cost-neutral: a check is ~$8 a paper today, a third of a checked paper. Papers were 10% of September's tokens (`cost-mix.md` v2) | 23 of 24 checks found a load-bearing error after merge; Lighthouse's pre-release reviews made 42 public-claim changes before release | Positive for the anchor: fewer wrong figures cited in the meantime. The check stays independent of the author | Load-bearing corrections found after merge per paper |
| E | **Add a reader-and-inference pass to Harbour's checks** | A cost, not a saving: Lighthouse's study cost 3.7× after adding it ($14 → $52), with review 49–72% of subagent spend | Lighthouse's stage 2 found 15 problems in passages an evidence review had passed; it still missed 4 of 16 known problems in replay | Positive for correctness, negative for budget | Corrections after release per paper, against the check's cost |
| F | **A per-step fixture eval with at least three runs per arm before a step changes tier** (harbour-evals' method, applied to close-out) | Enables `where-judgement-happens.md` option 3 (2–5% of ticket cost at a cheaper close-out) without the scorecard's eight-week wait | harbour-evals: one run per arm; one model scored 7–14 of 16 across harness revisions; review and research failed for all three models (2) | Low as a measurement; tier alone is not the cost lever (`model-choice.md` v2) | Agreement with the frontier close-out on held-out tickets; then holds overturned |
| G | **Not recommended: a graph-structured investigation for research legs** | Probably a cost: more coverage at 2–5× the tokens. Research legs are 5.3% of tokens (`starting-context.md` v2) | tangle: 14 of 18 single runs found more topics, often at several times the tokens (2) | Low for correctness | n/a |

**What a small trial of each would look like** (Part 4 of the brief):

| Concept | Smallest version | What it would measure | Risk |
|---|---|---|---|
| Pointer (A) | On ten tickets with a prior session, add one line to the next session's prompt naming the files the last session edited, at its commit | Turns and tokens to first edit; repeat reads; correct rate | Low; a wrong file anchors the session |
| Code holds the sequence (B) | Answer one supervisor role's completion gate in code, in shadow, beside the model, for a week | Agreement with the model's reply; the tokens the reply cost | None in shadow; shadow measures agreement, not cost (`how-process-changes-land.md` v2) |
| Done list in a handoff (C) | Replay 20 acted wakes as fresh sessions in a sandbox (`held-or-fresh.md`'s Next): record only, against record plus a done-and-answered list | Re-proposed done work; decisions matching the held session; tokens | None; local and unpushed |
| Check before merge (D) | Run the next wave's checks on the paper's branch before its PR merges | Load-bearing errors found before merge; days a wrong figure stands in the anchor | Low; a slower merge |
| Reader pass (E) | Add Lighthouse's stage-2 reader review to two checks and code what it adds | Load-bearing corrections the evidence check passed; dollars per correction | Spend only |
| Fixture eval (F) | Freeze 16 close-out cases from Done tickets, run frontier and cheaper tiers three times each | Agreement on hold and Done decisions; variance across runs | None; offline |
| Lean pipeline for code | Already running: `replay-small-work.md` (LIN-3189) replays small finished tickets as one agent, a review and a close-out | Correctness and cost against what shipped | Its own pre-registration |

## Method

**Prototype survey.** Twenty public repositories under `JKershaw` were cloned read-only to a git-ignored path, two of
them empty. Each is cited at its HEAD sha, which the matrix file records. For the five that
`what-should-an-agent-leave-behind.md` already read, HEAD equals its pins, and this paper cites its register. Lighthouse
had a pass of its own, and the other twelve were read for a relevant concept and its evidence. The account's product,
fixture and site repositories (LinearViewer, harbour-acceptance-fixture, yap, market-accurate, LocalHarbor,
jkershaw.github.io), the empty claude-linear-session-viewer, and repositories last pushed before November 2025 were not
read. An in-session subagent read each repository's evaluations and build logs and reported endpoint, result,
comparator, repeats and citations. The author coded each concept against the five levers on the 0–3 scale fixed in the
matrix file before the chart was drawn. Strength is the prototype's own evidence on its own endpoint.

**Lighthouse.** `scripts/survey-protoconcepts-lighthouse.mjs` reads every file with `git show 7828bb8b:<path>`, so the
checkout's state does not matter:
- **Studies' spend** comes from `studies/LH016/data/costs.csv`. Twelve driving-session and subagent figures that file
  leaves out are each checked against the commit message or close-out note that states them.
- **The 26 September token records** are re-priced with `usage.py`'s formula as a check.
- **LH016's coded change files** are tallied by step, type and release.
- **Each released article's front matter and notices** are counted.

Steps are grouped as follows:
- research: research, writing, reanalysis;
- review: every evidence, blind, reader and recheck step, and the keeper's relayed review, whose cost is unrecorded;
- driver: the driving session.

**Harbour.** The cost-mix census is re-run unchanged on transcripts from 1 September to 1 October 10:00Z
(`survey-costmix-tokens.mjs`, 2,004 fleet sessions, 3,575M weighted tokens). `survey-protoconcepts-dollars.mjs` is the
same census priced in dollars at Lighthouse's price table:
- three models with no row are priced at the nearest row of the same tier;
- 2,004 sessions come to $12,850, plus $787 in sessions with no ticket.

`survey-costmix-classes.mjs` classes changes from 1 August by the paths they touched.
`survey-protoconcepts-harbour.mjs` then sets these populations before reading any cost:
- **one-session paper:** a docs-only ticket that touched `docs/papers/`, worked in at most two custom, research or wake
  sessions, and is not a check;
- **check:** one of those that is a check;
- **pipeline paper:** three or more sessions;
- **code change:** production lines merged 1–30 September.

The V1 passage's own ticket is excluded. Every cost is given by the session entered and by the child the log names. A
checked paper's cost adds its check's cost divided by the papers that check covered.

**Harbour's checks.** An in-session subagent read all 13 checks and coded each of the 24 (check, document) pairs:
- whether the headline held, held with a load-bearing claim changed, or changed;
- how many load-bearing claims were overturned;
- how many figures changed.

It coded from the check's own words, took the less favourable code on a tie and quoted the check's lines. The author
re-read the four "changed" codes against their quoted lines.

**Re-running.** All snapshots go under the git-ignored `data/survey-protoconcepts/`:

```
git clone https://github.com/JKershaw/lighthouse data/survey-protoconcepts/repos/lighthouse
node scripts/survey-costmix-tokens.mjs --since 2026-09-01 --until 2026-10-01T10:00:00Z --out data/survey-protoconcepts/tokens.json
node scripts/survey-protoconcepts-dollars.mjs
node scripts/survey-costmix-classes.mjs --since 2026-08-01 --sd ../simple-dispatcher --out data/survey-protoconcepts/classes.json
node scripts/survey-protoconcepts-lighthouse.mjs
node scripts/survey-protoconcepts-harbour.mjs
node scripts/survey-protoconcepts-figures.mjs
```

No proxy call feeds any number.

## Limits

- **The evidence-strength codes are one reader's**, a subagent's reading checked by the author, not a blind recode. A
  stricter reader would lower some 2s to 1s, since Pith's and Tangle's comparisons are single runs on internal endpoints,
  so the matrix leans generous to the prototypes. No code reaches 3, so the headline does not depend on it.
- **Prototype endpoints are not Harbour's.** Rubric points, keyword coverage and a small model's pass rate say nothing
  about a correct, complete change at a cost. Translating any of them into Harbour savings would be an assumption, and
  none is made here. The Options' sizes come from the fifth wave's measurements, not from the prototypes.
- **Selection is John's own public repositories.** Private work (simple-dispatcher's own experiments among it) and
  failed experiments that were never pushed are invisible, as are the unread product and older repositories. yap, a
  chat room for humans and agents, may hold a coordination idea this paper does not score. Pushed failures were kept: Pith, CodeWiki and tag's dispatches are all against or empty.
- **Lighthouse's costs are self-reported and partly incomplete.** Driving sessions are marked incomplete, the keeper's
  relayed review has no cost, and output tokens are estimated from characters. Its study costs are therefore low, and
  its "about the same as a checked Harbour paper" may understate it.
- **Lighthouse's catch counts are its own coding**, by agents of the same model family that wrote and reviewed the
  pieces, and LH016 says its costs per change "do not rank the steps". Five days and 13 studies cannot show a steady
  correction rate. Pieces released in the last day have had hours in public, which biases the after-release count low.
- **Harbour's paper populations mix eras.** The one-session papers span early-September research legs (LIN-2788 to
  LIN-2826, eight papers at $4–24) and the steady-base waves (22 papers at $4–35). The 8 pipeline papers are all from
  early and mid September, on different questions. The pipeline-against-one-session gap is therefore partly content,
  not process.
- **Dollars and weighted tokens differ.** At the frontier tier's list rates, a cache read costs a twentieth of an input
  token, where the weighted unit charges a tenth. Fleet-wide, cache writes are 25% of dollars against 22% of weighted
  units. A one-session paper is cheap in dollars for its weighted tokens ($2.6 per million weighted) and a multi-session
  pipeline paper dear ($4.5). Weighted tokens therefore understate what extra fresh sessions cost, and the gap between
  one-session and pipeline papers is wider in dollars (2.3×) than in weighted tokens (1.3×). Three models with no row
  in the price table are priced at a neighbouring row: the newer mid tier at the older mid row, and two older models,
  which carried 374 messages across every transcript read, at their tier's row.
- **Code-change costs are not cost per correct change.** September's 30-day correctness window has not closed. The
  anchor's 11–16M weighted tokens per correct change (`steady-base.md` v2) is the scorecard's figure; this paper's
  per-ticket median is a different measure.
- **Charging rules.** Both rules give nearly the same per-ticket medians here, because one-session papers take no wakes
  and code-change medians sit away from the passage's children. The rule matters more for fleet totals than for these
  medians.

## Next

- **Does pricing at list rates instead of weighted tokens change the relay's verdict?** `held-or-fresh.md` priced fresh
  and held supervisors in weighted tokens, which charge a frontier cache read at a tenth of input where the list rate
  is a twentieth. This paper finds a multi-session paper costs 1.7 times as much per weighted token as a one-session one.
  Re-price that paper's model at list rates and say whether the relay's −17% to +9% and the 21k break-even handoff move.
  Added to `proposals.md`.
- **Does a check run before a paper merges find what the post-merge checks found?** Option D's trial, on the next wave.
  Added to `proposals.md`.
- **What does a done-and-answered list in a fresh step's handoff change?** Option C's trial, folded into
  `held-or-fresh.md`'s replay of acted wakes.
- `replay-small-work.md` (LIN-3189) draws the lean shape's point for code, and `what-hides-between-sessions.md`
  (LIN-3188) sizes "code detects, the model decides". The second is the deterministic-conductor concept applied to
  failures, and session-viewer and dash-analysis are its unevaluated prototypes.
