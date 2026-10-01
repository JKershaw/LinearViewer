---
title: Do the held-or-fresh and where-judgement-happens papers hold up?
kind: paper
version: 1
date: 2026-10-01
authors: [Claude (LIN-3183)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 73595a50, kind custom, LIN-3183); effort not recorded in the dispatch item. One bounded session, with no research, plan, review or close-out legs, by the brief's design. Six in-session subagents of the same tier were the fresh readers C and D, three each, D reading in reverse order. They saw only the codebook and the digests: not the paper, its codes or each other. This session re-ran every script, re-priced the relay and wrote the check and both version 2s. It wrote neither paper; those came from dispatches 309243c5 and df74b692."
grounded_at: 9a73a179 (LinearViewer, origin/main; docs/steady-base.md is identical to 26014544, where both papers read it); simple-dispatcher 3366748; transcripts, runner logs and oplog read 1 Oct 2026 about 08:35Z
cites:
  - "docs/papers/harbour/held-or-fresh.md@9a73a179 (version 1, LIN-3176) and held-or-fresh-codes.json; its scripts survey-held-extract.mjs, -analyse.mjs, -codes.mjs and -figures.mjs, each re-run"
  - "docs/papers/harbour/where-judgement-happens.md@9a73a179 (version 1, LIN-3177) and where-judgement-happens-codes.json; its scripts survey-doubling-runner.mjs, survey-doubling-transcripts.mjs, survey-wake-extract.mjs, survey-model-git.mjs, survey-judgement-sample.mjs, -fetch.mjs, -digests.mjs, -ci.mjs and -analyse.mjs, each re-run, and scripts/survey-judgement-codebook.md"
  - "docs/papers/harbour/what-supervisors-do.md@9a73a179 (version 2: 77–86% mechanical; 31% of wakes quiet, 25% of the supervision bill)"
  - "docs/papers/harbour/wake-inventory.md@9a73a179 (version 2: 1,614 relays of 4,602 wakes, 97% quiet; quiet wakes 12% of tokens)"
  - "docs/steady-base.md@9a73a179:3, :26-31, :91-99, :103-104, :140-144, :168, :171, :175-200"
  - "simple-dispatcher/README.md@3366748 (broker-armed launches skip the bootstrap summarise, LIN-2116)"
  - "LIN-3183's description and brief, read over the workspace proxy 2026-10-01"
  - "scripts/survey-check-7-held.mjs, scripts/survey-check-7-judgement.mjs and survey-check-7-codes.json (this check)"
---

# Do the held-or-fresh and where-judgement-happens papers hold up?

Their measurements hold. The relay's price and the rule class do not hold as stated. Every
committed script re-runs and every number reproduces. Both papers' figures re-draw byte for byte,
and where-judgement-happens' cycle table is identical. Four things do not hold.

- **The relay as proposed counted each fresh step's first decision twice.** A fresh start's
  "tokens to first decision" includes the decision step. The model then adds the wake's own steps,
  which include it again. Counted once, the relay as proposed comes to **0% of fleet tokens
  (−17% to +9%), not +2% (−18% to +11%)**. Its break-even handoff is 21k tokens, not 11k. The
  verdict stands: no reliable saving.
- **The mechanical share was pooled over equally sampled roles.** The coders marked 32% of the
  sampled acted wakes mechanical, but 12 cards a role over-weights the Runner (58%) and the
  autopilot (50%). Weighted by each role's acted wakes it is 24%. Every cheap end moves by 1–3
  points.
- **"Quiet wakes to code" was sized by outcome, which code cannot see.** Code can route by the
  class of a delivery: pause wakes, failsafe re-confirms, silence re-fires and the Runner's
  deliveries. That reaches 11.7% of fleet tokens of the 16.3%, and the shape saves **about −10%,
  not −14%**. Of that, −5.7% is the anchor's map row 1 and −4.1% is row 2.
- **The rule class does not reproduce.** Two fresh blind readers of nine tickets agree with each
  other at κ 0.76 and with reader A at κ 0.51–0.71. Both lean the same way from A: 67–73% of
  decisions need context, against A's 58% on the same tickets. Of A's seven rule-class calls
  there, both fresh readers confirmed one. Every reader other than A, including the paper's own
  reader B, put more decisions in context. So the paper's 61% is a low end and its 8% a high end.

The rest stands. The cost per wake rises linearly with history. A fresh supervisor costs
116–238k tokens to reach its first decision. In 48 sampled acted wakes, no decision rested on
memory alone. A relay would remove 11 of the 25 failures on record. Judgement concentrates at the
gates and in the making. A fresh session holding the record could have decided 82–91% of the
wrong turns, by every reader.

**The two papers measure one lever twice, and neither adds to the anchor's rows 1–3.**
held-or-fresh's option A and where-judgement-happens' option 1 are the same change, measured over
the fleet and per ticket. Both sit inside the map's rows 1–3. The anchor's row 1 (~9–11%) already
counts the Runner's quiet wakes, which are row 2. The fresh-session options (held-or-fresh's B and
D) are the only parts outside the map, and B pays only with a small handoff. On
where-judgement-happens' evidence, a small handoff is optimistic.

Version 2 of each paper is in the same PR. In `docs/steady-base.md`, eleven lines would change and
five would be added (listed below).

## Findings

**Every script re-runs, and every number reproduces.** Both pipelines were re-run in a fresh
worktree from the transcripts, runner logs and oplog, not from the authors' snapshots.

- **held-or-fresh.** The extract read 2,057 sessions, 17 more than the paper's 2,040, all begun
  in October. The analysis restricts to 1–30 September and reproduces every September figure in
  the paper. The coding scorer reproduces every agreement figure from `held-or-fresh-codes.json`.
  The figure script, run over the re-run analysis, writes all three SVGs byte-identical to the
  committed ones.
- **where-judgement-happens.** The sample draw is the same 36 tickets with the same replacement
  (LIN-2944 → LIN-3008). The fetch made 46 paced calls, 9 of which answered 503 and were repeated.
  The digests rebuilt 34 of 36 byte-identical. The two that differ, LIN-3079 and LIN-3163, differ
  only in rows of sessions still running when the author read them, and neither ticket is in the
  fresh sample. The cycle table is identical: 1,991 cycles and 328.4M units. The analysis
  reproduces every census, cost, wrong-turn, agreement and CI figure in the paper, including the
  one red attempt in 84 runs.

**held-or-fresh: the cost shape holds.** The per-step fits (3.3–6.3k + 0.107–0.129 × context),
the 7.4×, 4.0×, 2.3× and 3.5× band rises, the 1.11–1.17 session exponents and the 85%/68%/72%/77%
cache-read shares reproduce. Two qualifications are now in version 2. The per-step fit explains
little of the spread (R² 0.09–0.20), and its slope is mostly the 0.1 cache-read weight itself. The
paper's "one to two minutes" and "60–80k bootstrap" are 0.7–2.1 minutes and 62–82k on its own
table. The autopilot reaches its first decision in 0.7 minutes, after an 82k bootstrap.

**held-or-fresh: the relay counted the decision step twice.** `survey-held-analyse.mjs` prices an
acted wake under the relay as `orient + bootstrap + 2 × handoff + reprice(wake)`. `orient` is a
fresh start's units from task to first decision, inclusive. `reprice(wake)` re-prices every step
of the held wake, including the step that acted. Excluding the decision step from `orient` lowers
the role medians from 209k to 181k (leg), 238k to 208k (stepper) and 116k to 100k (autopilot).

| Figure | Version 1 | Decision step once, role-weighted mechanical share (version 2) |
|---|--:|--:|
| Relay as proposed, fleet tokens | +2.1% (−18.2 to +11.3) | −0.1% (−17.1 to +9.4) |
| Lean relay | −18.6% (−25.4 to −9.3) | −18.6% (−24.2 to −9.3) |
| Quiet wakes to code, acted held | −13.9% (−20.7 to −13.4) | −13.9% (−19.2 to −13.4) |
| Relay for Runner and autopilot only | −11.5% | −11.9% |
| Acted wakes, fresh against held | 2.0× | 1.9× |
| Orientation share of a fresh step | 62% | 60% |
| Break-even handoff, relay as proposed | 11k | 21k |
| Per merged change, relay as proposed (by child / by session) | ×1.09 / ×1.13 | ×1.07 / ×1.11 |
| Cold resumes started fresh instead | 45M; break-even 110–170k | 41M; break-even 100–155k |

The lean relay and the hybrid do not use `orient`, so only their cheap ends move.

**held-or-fresh: the mechanical share was pooled over equally sampled roles.** The 48 cards are
12 per role. Both coders' M share is 58% at the Runner, 50% at the autopilot, 13% at the stepper
and 8% at the leg. The cheap cases applied the pooled 32% to every acted wake. Applied per role,
it is 24% of acted wakes and 24% of their held cost. The paper said "the 32% of acted wakes the
coders marked mechanical"; that is the sample's share, not the population's.

**held-or-fresh: are the relay's assumptions stated and fair?** Mostly stated. Three assumptions
lean one way and the paper did not size them:

| Assumption | Stated? | Which way | Size, re-priced |
|---|---|---|---|
| Code sends to code exactly the wakes that changed nothing | Partly ("code is priced at zero") | Towards saving | The hybrid moves from −13.9% to −9.9% routed by class, and the relay as proposed from 0% to +8.9%, since every quiet terminal or unlabelled wake would also start a fresh session |
| The central relay pays the 62–82k bootstrap | Yes | Against saving | Broker-armed launches already skip it (simple-dispatcher's README, LIN-2116). Without it, the relay as proposed comes to −6.4% |
| Mechanical acted wakes stay with the model in the central case | Implicit | Against saving | With each role's share sent to code, the central relay comes to −7.7%; with the bootstrap also dropped, −12.4% |
| A fresh step takes the held wake's steps | Yes (Limits, and Next) | Unknown | Not measurable from transcripts; the paper's first Next line is the right test |

So the relay as proposed is not a fair worst case. It is the one variant that keeps every cost a
designer would remove first. Its honest range runs from about +9% (code cannot tell quiet from
acted) to about −12% (no bootstrap, mechanical wakes to code). That range still contains zero,
which is the paper's conclusion.

**Is the lean relay's small handoff realistic, given where-judgement-happens?** Not at its central
case. The handoff coders sized the note that would carry every remembered fact at a median of 300
characters. They did so knowing which decision the wake made, and a writer before the wake would
not know. where-judgement-happens shows what supervisors' judgement rests on. Its 37
context-class supervisor decisions cite:

- a worker's report in 22, which arrives in the wake and is free;
- a prior verdict in 17;
- ticket or plan text in 14;
- code at HEAD in 8;
- tracker state in 7.

A verdict and a report fit in a 10–20k handoff, but plan text and code do not. A fresh step needing
them either reads them, which the lean model does not price, or carries them, which is the 60k dear
case. At 60k the lean relay comes to −9.3%. That is 4.6 points worse than keeping acted wakes held,
and no better than code routing by class (−9.9%). The lean relay's −19% is a bound, as the paper's
Limits say. Its dear end, not its centre, is the planning figure.

**held-or-fresh: the memory and failure claims hold.** 0 of 48 memory-only (κ 1.00), 41–43 of 48
used a remembered fact, the note sizes, the 85% (κ 0.67) M/J agreement, and the failure codings
(80%, κ 0.64 and 0.66) all reproduce from the committed codes. Both coders' 11 avoided failures
and LIN-2078's memory-held remedy are as stated. 154 failsafe re-confirms were answered without a
tool call, and 81 of 116 silence re-fires read the record first.

**where-judgement-happens: every figure reproduces.** The census (260 decisions; 7.2 a ticket,
median 5, 6.4 re-weighted; 21/80/159, re-weighted 8/33/59), the role and tier tables, the bases
(95, 44, 44, 43), the cost table under both charging rules and both weightings, the per-role
decision shares (plan-review 58.7%, review 47.9%, close-out 44.9%, autopilot 9.7% and 6.7%), the
class split of cost (0.6/7.1/24.5%), the wrong-turn table (163 on 32 tickets; 135 one layer; 133
fresh-session yes) and the reader-B agreement all reproduce exactly. Two wording points: the
makers' 76 includes 12 other workers, and the cost shares by group are re-weighted while the
class split of cost is as sampled. Both are now explicit or unchanged in version 2.

**where-judgement-happens: a fresh blind double-coding confirms the context class and the
fresh-session result, and not the rule class.** The paper's reader B coded ten tickets. This check
drew every third of the other 26, nine tickets holding 60 of reader A's decisions, and had two new
readers code them from the same codebook and digests.

| Pair | Decisions (each) | Matched on cycle | Same type | Class | Context against the rest | Wrong turns matched | Fresh-session call |
|---|--:|--:|--:|--:|--:|--:|--:|
| C and D | 63 / 73 | 50 | 49 | 90% (κ 0.76) | 90% (κ 0.75) | 29 | 90% (κ 0.54) |
| A and C | 60 / 63 | 50 | 48 | 86% (κ 0.71) | 92% (κ 0.82) | 26 | 96% (κ 0.65) |
| A and D | 60 / 73 | 50 | 50 | 78% (κ 0.51) | 86% (κ 0.67) | 32 | 94% (κ 0.48) |

- **Decisions per ticket depend on the reader:** 6.7 for A on these tickets, 7.0 for C and 8.1 for
  D. D found 30 on LIN-2995 where A found 19.
- **The class mix leans the same way for every other reader.** On the nine tickets, A coded
  7/18/35 (a/b/c), C 1/20/42 and D 3/17/53. That is 58% context for A against 67% and 73%, and 12%
  rule against 2% and 4%. The paper's reader B also put three more of 58 in context. The paper
  says the net direction of its readers' biases is unknown. Three readers now say A's census leans
  towards a and b.
- **The rule class is the least reproducible.** Of A's seven class-a decisions on these tickets,
  both fresh readers confirmed one: a retry after `opencode exited with code 1`. Both coded the
  autopilot's escalation at the plan loop's bound as context. That escalation is the paper's first
  example of a rule-class call, and the codebook lists "framing a decision for John" under context.
  Both coded the close-out's undischargeable-ledger hold as a cheaper step.
- **The cost shares move with the readers.** On the nine tickets, C and D put 27% and 31% of the
  cost in decision cycles, against A's 25%. For the supervisors' cost it is 14% and 20%, against
  A's 12%. So the paper's "a third" and "12–14%" are low ends.
- **Wrong turns hold.** Every reader judged a fresh session could have made the call in 88–91% of
  these tickets' wrong turns, and more than one layer was needed in 9–12%. The fresh-session test
  agrees at κ 0.48–0.65. That is low, as the paper found (κ 0.50), because almost every call is
  "yes".

**Reconciling the quiet-wake figures.** Four documents count wakes that change nothing, with four
denominators:

| Document | What it counts | Quiet share |
|---|---|---|
| `what-supervisors-do.md` v2 | Supervisor wakes, follow-up handshake merged | 31% of wakes, 25% of the supervision bill (about 9% of fleet tokens at the 35% supervision share) |
| `wake-inventory.md` v2 | Harbour's 4,602 wakes into any dispatched session | 12% of tokens in dispatched sessions |
| `held-or-fresh.md` | All 6,209 deliveries into held supervisors, with their handshakes and gate replies | 16.3% of fleet tokens; 11.7% in classes code can see |
| `where-judgement-happens.md` | Wake cycles on 36 sampled Done changes, Runner excluded | 1.8–3.5% of those tickets' cost; about 3% with the gates after them (re-weighted) |

The wake counts differ because of what each one includes.

- **held-or-fresh's 6,209 against wake-inventory's 4,602.** held-or-fresh adds the Runner's
  unlabelled deliveries (824), task notifications, failsafe re-confirms and silence re-fires. It
  also folds 3,066 completion gates into the quiet wakes they follow.
- **where-judgement-happens' per-ticket figure is a fifth of the fleet figure.** Most quiet wakes
  land in sessions above the ticket, such as epics, passages and the Runner. Neither of its
  charging rules places those on a sampled change. held-or-fresh's own cohort shows the same gap:
  quiet wakes to code saves 6–9% per merged change against 14% of the fleet.

So the per-ticket and fleet views both stand; they answer different questions. The scorecard
divides fleet tokens by correct changes, so for the steady-base work the fleet figure is the one
that counts.

With `what-supervisors-do.md`'s 77–86% mechanical share the papers agree. held-or-fresh finds
24% of acted wakes mechanical and 52% of held wakes quiet. where-judgement-happens finds 12–20% of
supervisors' per-ticket cost in decision cycles. All of that sits inside a mostly mechanical bill.

**Do the savings double-count?** Yes, if any two of these are added.

- **held-or-fresh A and where-judgement-happens 1 are the same lever.** Both send to code the
  wakes that carry no decision.
- **Both are map rows 1 and 2, plus the gate replies after those wakes, a slice of row 3.**
  Routed by class, row 1 (supervisors' pause and re-ask wakes) is −5.7% of fleet tokens and row 2
  (the Runner) is −4.1%. The anchor's row 1 estimate of ~9–11% rests on `what-supervisors-do.md`'s
  25% of the supervision bill and `wake-inventory.md`'s 12%. Both include the Runner's quiet wakes,
  so row 1 as written already counts row 2.
- **held-or-fresh C overlaps A.** 95 of the 183 cold resumes changed nothing and go to code under
  A. On top of A, C is −0.8%, not −1.9%. It is inside B and D, which start every acted wake fresh
  anyway.
- **held-or-fresh B and D are outside the map.** B adds to A only below a 40k handoff.
- **where-judgement-happens 2** (rule-class calls in code) is inside row 3, and under 1%.
- **where-judgement-happens 3** (a cheaper close-out) is in no row. It shares close-out's 6% with
  row 8's repeated close-outs, so the two cannot together save more than close-out costs.
- **where-judgement-happens 4** is in no row and not sized. Option 5 is a limit on row 7.

**The Options sections.** Each option, against its own paper's figures:

| Paper, option | Size supported by the paper's figures? | Range honest? | Overlaps |
|---|---|---|---|
| held-or-fresh A (quiet wakes to code) | By outcome, yes. As code would route, no: −10% by class, not −13% to −21% | No. The dear end varied only the cache lifetime, not the routing | = where-judgement-happens 1; map rows 1–2 and part of 3 |
| held-or-fresh B (lean fresh step on top of A) | Yes: −5 points at 20k, −9 at none, 0 at about 40k | Yes, as a bound. The central handoff is optimistic (above) | Beyond the map; rests on where-judgement-happens' 82–91% fresh-session result |
| held-or-fresh C (fresh instead of a cold resume) | Alone, yes: −1.9% after the correction | It did not say it overlaps A | A by more than half; inside B and D |
| held-or-fresh D (relay as proposed) | After the correction: 0% (−17% to +9%) | Yes, after the correction | B and D are the same relay at different handoffs |
| where-judgement-happens 1 (wake only on decision events) | "Up to 8–10%" is the supervisors' whole bookkeeping. Wake filtering reaches about 3–4%. The rest, mostly the gate after working turns, needs row 3 | Yes, as "up to" | = held-or-fresh A |
| where-judgement-happens 2 (rule-class calls in code) | Yes, under 1% | Yes, but the 21 class-a decisions are the least reproducible class | Inside row 3 |
| where-judgement-happens 3 (close-out at a cheaper tier) | Arithmetic, yes: 6% × 0.4–0.8 | Leans high. The frontier step it keeps for open questions is not costed | Shares close-out's 6% with row 8 |
| where-judgement-happens 4 (retry service faults in the tools) | Not sized, as stated | n/a | None |

Version 2 of each paper carries these corrections in its Options. No option was added or removed.

### The lines of `docs/steady-base.md` that would change

The lines are at `9a73a179`. The anchor does not yet cite either paper, so most changes add their
evidence. This check did not edit the anchor; the Flight Companion owns it.

| Line | Now | Would read |
|---|---|---|
| 3 | "…and `survey-check-6.md` checked `why-legs-repeat.md`, now at version 2.)" | …now at version 2, and `survey-check-7.md` checked `held-or-fresh.md` and `where-judgement-happens.md`, each now at version 2.) |
| 28 | "Judgement is concentrated in judging a worker's report and writing the next beat, about a fifth of the bill." | …about a fifth of the bill. Per ticket, the cycles where a supervisor made a consequential decision are 12–20% of its cost; judgement concentrates at the gates and in the making (`where-judgement-happens` v2) |
| 29 | "**Nearly a third of wakes (31%) change nothing**, and they are 25% of the supervision bill. For the passage Runner, 94% of its wakes change nothing." | …change nothing. Counted as every delivery into a held supervisor with its handshake and gate replies, the wakes that changed nothing are 16% of fleet tokens, 12% in classes code can see (`held-or-fresh` v2) |
| 31 | "**Supervisor failures are mechanical, not judgement:** 22 of the 25…" | …21 were bugs in code. A relay of fresh sessions would remove 11 of the 25, mostly lost wakes; one recovery lived only in a held session's memory, LIN-2078 (`held-or-fresh` v2) |
| after 99 | — | A point 19, *(`held-or-fresh.md` v2)*: a held wake costs a few thousand tokens plus 0.11 of its context, a fresh supervisor 116–238k to its first decision plus a 62–82k bootstrap. The relay as proposed would have cost about the same as September (0%, −17% to +9%). It saves only with a small handoff (−19% as a bound, −9% at 60k). In 48 sampled acted wakes, no decision rested on memory alone |
| after 99 | — | A point 20, *(`where-judgement-happens.md` v2)*: a change carries about seven consequential decisions. 61–73% need context, by reader, and at most 8% a rule. Gates spend 45–59% of their cost in decision cycles, supervisors 12–20%. A fresh session holding the record could have decided 82–91% of wrong turns |
| 103 | "**The largest saving is mechanical supervision, and it keeps every altitude.** …" | …The failure record points the same way. Starting each judgement step fresh is not a saving while fresh sessions orient as they do today; it pays only with a small handoff (`held-or-fresh` v2) |
| 104 | "**The wake plumbing is where the growth is.** …" | …is a narrower and more mechanical target than "the process". Code routing wakes by the class it can see reaches about 10% of fleet tokens (`held-or-fresh` v2) |
| 142 | Row 1, "~9–11%; quiet wakes are 7–10% of September's dispatches…" | Evidence adds: supervisors' pause wakes, failsafe re-confirms and silence re-fires, routed by class, −5.7% of fleet tokens (`held-or-fresh` v2). Est. saving: ~6% by class; the 9–11% included the Runner's quiet wakes, which are row 2 |
| 143 | Row 2's evidence | Adds: the Runner's 960 September wakes, 93% quiet, 175M tokens; code taking them saves 4.1% of the month's fleet tokens (`held-or-fresh` v2). Est. saving unchanged |
| 144 | Row 3's evidence | Adds: rows 1 and 2 together −10% by class, −14% if code could tell which wakes change nothing; per ticket, supervisors' bookkeeping is 8–10% of a ticket's cost, about 4 points of it the completion gate after working turns (`held-or-fresh` v2, `where-judgement-happens` v2). Est. saving unchanged |
| 168 | "**Should a change's cost include the wakes into the epics and Runner above it?** …" | …So the scorecard needs one rule before the epic is measured. The wake lever shows as 10–14% of fleet tokens but about 3% of a sampled ticket's cost, because most quiet wakes land in sessions above the ticket (`survey-check-7.md`) |
| 171 | "**Every paper cited here has been checked by a second document.** `survey-check-6.md` checked the last, `why-legs-repeat.md`." | …`survey-check-7.md` checked the last two, `held-or-fresh.md` and `where-judgement-happens.md` |
| after 199 | — | Rows for [held-or-fresh](papers/harbour/held-or-fresh.md) (v2), "What a held supervisor costs against a fresh one, and what the relay would have cost"; [where-judgement-happens](papers/harbour/where-judgement-happens.md) (v2), "Where judgement changes a ticket's outcome, and where a program could decide"; and [survey-check-7](papers/harbour/survey-check-7.md), "The independent check of the two papers above, and every figure it changed" |

Unchanged and confirmed:

- Line 22's 35% supervision share is `where-the-effort-goes.md`'s. That held-supervisor wakes are
  also 35% of fleet tokens is a coincidence of two different counts.
- Line 123's 11–16M per correct change is the baseline both papers scale from (13.3M, 11.4–16.0M).
- Row 3's "up to ~27% in total, including 1 and 2" stands as a ceiling. Both papers measure
  inside it.

## Method

Both papers' scripts were re-run unchanged in a fresh branch off `origin/main`, from the local
transcripts, runner logs and oplog, not from the authors' snapshots. The check's re-pricing and
scoring are two new scripts. Version 2 changes `survey-held-analyse.mjs` in two places, marked in
the file.

```sh
# held-or-fresh: re-run, then compare
node scripts/survey-held-extract.mjs                       # 2,057 sessions; September identical
node scripts/survey-held-analyse.mjs                       # version 1 script: every figure reproduces
node scripts/survey-held-codes.mjs                         # from the committed codes: identical
node scripts/survey-held-figures.mjs --in <v1 analysis> --out <scratch>   # three SVGs byte-identical
node scripts/survey-check-7-held.mjs                       # the check's re-pricing: role-weighted M, decision step once, by class, rows 1 and 2, bootstrap, C beyond A
node scripts/survey-held-analyse.mjs && node scripts/survey-held-figures.mjs   # version 2 script and figures
# where-judgement-happens: re-run, then compare
node scripts/survey-doubling-runner.mjs && node scripts/survey-doubling-transcripts.mjs
node scripts/survey-wake-extract.mjs
node scripts/survey-model-git.mjs --since 2026-05-01 --out data/survey-doubling/git.json
node scripts/survey-judgement-sample.mjs && node scripts/survey-judgement-fetch.mjs     # 46 paced calls, 9 retried 503s
node scripts/survey-judgement-sample.mjs --issues data/survey-judgement/issues.json    # LIN-2944 -> LIN-3008, as the paper
node scripts/survey-judgement-digests.mjs                  # 34 of 36 identical; cycles.json identical
node scripts/survey-judgement-ci.mjs && node scripts/survey-judgement-analyse.mjs       # every figure reproduces
# the fresh double-coding
node scripts/survey-check-7-judgement.mjs                  # writes survey-check-7-codes.json from codes-C and codes-D, scores C–D, A–C, A–D, and the cost side
```

- **Fresh sample.** In the committed codes' order, the 26 tickets reader B did not code were
  taken every third from offset 1: LIN-3008, LIN-2702, LIN-2543, LIN-2456, LIN-2535, LIN-2716,
  LIN-2458, LIN-3129 and LIN-2995. The draw was fixed before any code was read. Each reader was
  split across three agents (LIN-2995 alone; four and four), D in reverse order and LIN-2995 read
  from the end. They were told to code from the codebook and digest only, and to open no paper,
  codes file or other reader's output. Every value was checked against the codebook's vocabulary.
- **Matching** is the paper's rule. Decisions match within a ticket on the same cycle and type,
  failing that on the same cycle, each at most once. Wrong turns match on cycle and type.
- **By class.** Code takes a held supervisor's delivery if it is a pause wake, a failsafe
  re-confirm or a silence re-fire, or if it goes to the Runner. A routed wake that acted is passed
  on at its held cost. The cache penalty is the paper's: a kept wake pays a cold re-write when no
  kept wake came within the hour but a removed one did.
- **Option 1's split.** On the sampled tickets, a supervisor's quiet wake cycle is taken with the
  completion gate that follows it in the same session and the resume handshake before it. The rest
  of its bookkeeping is what wake filtering does not reach.
- **Proxy.** About 55 reads: the brief, the ticket, its relations, the endpoint catalogue and the
  46 ticket fetches, paced at one every 8 s. Two writes: this ticket's comment and its status.

## Limits

- **Every reader shares a tier with the authors.** The fresh readers are independent of the
  authors' sessions, not of their model tier. They read the same digests, built by the same
  script, so whatever the digests cut (long cycles, red CI) all four readers miss.
- **Nine tickets.** The fresh mix (67–73% context) rests on 136 decisions, a third of them on one
  ticket, LIN-2995. The direction is consistent across three readers; the size is not a population
  estimate. The census's 61% is not replaced, only bounded.
- **The by-class route is optimistic.** It passes 219 class-routed wakes that acted at their held
  cost, as if code knew to hand them on. A real router would delay or drop some, and a dropped
  terminal report loses a decision. *Bias:* towards saving.
- **The decision-step correction assumes the fresh step's decision is the held wake's.** If a
  fresh session's first decision step were extra work the held one never did, version 1's count
  would be right. The transcripts cannot tell. *Bias:* unknown; it is at most the 2.2 points
  between the versions.
- **The relay remains a re-pricing.** This check re-ran the paper's model with one assumption at
  a time. It did not replay any wake fresh, which is the paper's first Next.
- **The anchor may move.** The table lists lines at `9a73a179`. A later edit shifts them.

## Next

- **Which deliveries into a held supervisor can code tell are quiet before a model reads them?**
  Routing by class reaches 2,295 of September's 3,233 quiet wakes and holds back 219 that acted.
  The other 938 quiet wakes, 4.5% of fleet tokens, are terminal and unlabelled deliveries that
  class alone cannot separate. Read a sample of each group with the state code could see at that
  moment, and say which fields would have separated them, and at what error. This goes into
  `proposals.md`.
- **Why does reader A's census lean towards the rule and cheaper classes?** Three readers put more
  decisions in context. Before where-judgement-happens' option 2 is built, re-code its 21 rule-class
  decisions with two readers and the codebook's tie rule. Count how many survive.
- Both papers' own Next lines stand, with their figures as corrected in version 2.
