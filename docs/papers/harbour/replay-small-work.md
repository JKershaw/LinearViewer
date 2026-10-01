---
title: For small changes, how does a lean pipeline compare with what Harbour's full process shipped, in correctness and in cost?
kind: paper
version: 2
date: 2026-10-01
authors: [Claude (version 1, LIN-3189), Claude (version 2 corrections, LIN-3191), for John Kershaw]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch a6213a6b, kind custom, LIN-3189); the runner's item metadata records effort high, which the dispatch item read over the proxy does not carry. One bounded session, with no research, plan, review or close-out legs, by the brief's design. In-session subagents: 39 mid-tier replay roles (13 implementers, 13 reviewers, 13 close-outs) and 27 frontier-tier blind reads. There were 14 first-order reads, one of them stopped and re-run, and 13 with the order swapped, one of which stopped without a judgement. Version 2: frontier tier, Claude Code CLI, the independent check's session (dispatch 1c193554, LIN-3191). It re-ran every script, re-judged the 13 pairs in a randomised order and replayed four tickets without hindsight."
revision: "Version 2 corrects statements per docs/papers/harbour/survey-check-11.md (LIN-3191). (1) The 4.1% is lean in-session subagents against every fleet session charged to the ticket. It is not the scorecard's whole-life measure, which has no per-ticket tokens and includes rework. The original's review and close-out ran at the frontier tier against the replay's mid tier; at matched tier it is 5.4%. A lean lane in production is estimated at 5–10% in a lean harness and up to a quarter with today's per-leg habits. (2) Hindsight: 8 descriptions carry a post-merge section, not 7, and 1 a plan, not 3. LIN-2414's final description prescribes its own escape, LIN-2980's names the fault's ticket and LIN-2715's names the exact fix. Four replays from the pre-implementation text moved two blind verdicts from better to worse. (3) The pre-registered verdict, with the shipped-test failure class as registered, is 5 better, 1 equivalent and 7 worse, not 5/2/6; LIN-2406 moves. (4) LIN-2559's stated reason for 'better' described the replay's own first draft; LIN-2123 is 'declined', with the residual live on both; LIN-2252's catch is now confirmed in a browser. (5) The originals' medians over the ten costed tickets are 14.5 dispatches and 0.87 hours. Chores the replay truly skipped are about 15% of the original's tokens, not 34%. 'About 25 times' is pooled; the per-ticket median is 17.4×. (6) Method: the pre-registration commit also carried the two scripts; 15 proxy calls, not 5, all reads but LIN-3189's comment and status; the stalled reads ran 8.8 and 7.8 minutes; eight undeclared deviations are listed. Unchanged: every printed cost figure reproduces; the blind reads (8/3/2) reproduce and a randomised re-judgement agrees on 12 of 13; the pre-registration preceded the first replay; nothing was pushed, written or dispatched from the replays."
grounded_at: d88e2216 (LinearViewer, origin/main); scorecard heads 26014544 (LinearViewer) and 33667480 (simple-dispatcher). Transcripts and runner logs read on 1 October 2026. Version 2 at 066232d6, from the same snapshots.
cites:
  - "docs/papers/harbour/replay-small-work-preregistration.md (commit d2fa2773, with scripts/survey-replay-select.mjs and -prepare.mjs, before any replay)"
  - "docs/papers/harbour/survey-check-11.md (LIN-3191: the independent check; scripts/survey-check-11.mjs, survey-check-11-codes.json)"
  - "docs/papers/harbour/cost-mix.md@d88e2216:238-253 (half of all standalone cost sits at the small-change floor, 49.6%; the fit's intercept is about 89%) and :320 (a light lane for small changes, 1.1×)"
  - "docs/papers/harbour/proportional-process-backtest.md@d88e2216:76-95 (rule M3; its light group's share of hours, dispatches and raw tokens) and :136-143 (2.0 in 100 went wrong after reading) and :198-203 (review caught real faults on 8 of 328, 11 at plan review)"
  - "docs/papers/harbour/proportional-process-backtest-codes.json@d88e2216 (the named-fix readings the selection uses)"
  - "docs/papers/harbour/measuring-throughput.md@d88e2216:41-50, :118-121 (change, correct and cost; per-change tokens are fleet totals over correct changes)"
  - "docs/papers/harbour/starting-context.md@d88e2216:67, :89-90 and held-or-fresh.md@d88e2216:77-87 (a fleet leg's orientation: 24 calls before the first edit; a 77k bootstrap; 115k before a fresh review's first decision)"
  - "docs/papers/harbour/steady-base.md@d88e2216:195-220 (the dispatched prompt is about 2% of a leg's context; most of the rest is the harness's system prompt and tools) and :432-441 (the three risk tiers)"
  - "docs/papers/harbour/what-doubled-the-dispatches.md@d88e2216 (the two charging rules)"
  - "docs/papers/harbour/reliability-baseline-defects.json@d88e2216 (the escape verdicts: LIN-2272, LIN-2804, LIN-2983)"
  - "LIN-2268 (99c604b4), LIN-2272 (740bded7), LIN-2804 (f66c82ec), LIN-2468 (simple-dispatcher 2ef854b): the named fixes whose tests were run"
  - "LIN-3189 (2026-10-01), LIN-3191 (2026-10-01)"
---

# For small changes, how does a lean pipeline compare with what Harbour's full process shipped, in correctness and in cost?

A lean pipeline cost a tenth to a twentieth as much, by the best estimate. Whether it is as
correct is not established. The replay had hindsight, and without it the lean pipeline did worse.

Thirteen Done tickets were replayed, ten from Harbour and three from the runner. Each was small
and low-risk, merged between August and late September, and five had a known escape or a named
fix. Each replay was one implementer, one review and one close-out, all mid tier, run as
in-session subagents in a local worktree at the original merge's parent.

- **Cost as measured.** The replay's in-session legs cost a median 4.1% of the weighted tokens of
  every fleet session charged to the original ticket (0.9–5.4%, ten tickets with transcripts). In
  working hours the replay cost 5.9% (all thirteen). That is not a price for a lean lane in
  production, for three reasons:
  - The original's review and close-out ran at the frontier tier and the replay's at the mid
    tier. At matched tier the median is 5.4%.
  - Production would still open a PR, wait on CI, merge and write to the tracker. With those
    priced, a lean lane costs 5–10% in a lean harness, and up to a quarter with the chore habits
    the fleet's legs have today.
  - Most of the gap is the in-session harness, which pays none of a fleet leg's fixed
    orientation cost, rather than the pipeline's shape.
- **Blind comparison.** A blind frontier-tier reader judged the replay better than what shipped on
  8, equivalent on 3 and worse on 2. A second read with the diffs swapped agreed on every one of
  the 12 it completed, and a third reader with A and B randomised agreed on 12 of 13. About half
  of the "better" verdicts rest on stronger tests with the same production code.
- **Hindsight.** Eight descriptions carry what shipped and one carries the approved plan. Three
  carry their own outcome:
  - LIN-2414's tells the implementer to make the very change that escaped.
  - LIN-2980's names the escaped fault's ticket.
  - LIN-2715's names the exact one-line fix.

  Four tickets were replayed again from the description as it stood before implementation. Two
  blind verdicts moved from better to worse, and two did not move.
- **Known faults.** On three of the five known faults the replay shipped the same fault as the
  original, two of them as its description directed. On one, its own review caught the fault
  that the full process had shipped: the inert CSS fix on LIN-2252, now confirmed in a browser. On
  the fifth, LIN-2123, it declined to attempt the fix, which the ticket's constraint allowed, and
  the fault stays live.
- **The pre-registered verdict.** This moves a replay to "worse" whenever a shipped test fails on
  behaviour or it shares a known fault, even one the original also shipped. On that rule, applied
  as registered, the count is 5 better, 1 equivalent and 7 worse.

So lean is much cheaper. On these tickets the full process's extra legs bought no correctness
that a reader *with hindsight* could detect. Without hindsight, the four replays re-run do not
support "no worse". Only a forward trial in the fleet's own harness can say.

![Per ticket, lean cost ÷ original session cost against the correctness verdict](figures/replay-small-work/cost-ratio-vs-verdict.svg)

## Findings

**Per ticket.** Columns:
- **Hindsight**: what the final description carries beyond the pre-implementation spec. *shipped*
  means a post-merge section; *plan* means an approved plan or research recommendation.
- **Same**: the author's coding of whether the replay's production change behaves like the
  original's.
- **Review**: the replay's own reviewer.
- **Blind / swapped**: the replay judged against the original, by the first blind read and by the
  read with A and B swapped.
- **Shipped tests**: the original change's unit tests, run on the replay.
- **Fix tests fail**: the named fix's tests, run on the replay against the original (failures).
- **Tokens and Hours**: lean ÷ original. Tokens are charged by session entered; hours are the
  replay's wall-clock ÷ the original's working hours.

| Ticket | Repo | Stratum | Hindsight | Same | Review | Blind / swapped | Verdict | Shipped tests | Fix tests fail | Tokens | Hours |
|---|---|---|---|---|---|---|---|---|---|--:|--:|
| LIN-2123 | Harbour | escape | none | different | approve | better / better | worse (test) | 40/42 | 4 vs 4 | – | 7.8% |
| LIN-2252 | Harbour | escape | none | different | **changes** | better / better | better | none | (e2e: replay passes, original fails) | – | 20.1% |
| LIN-2355 | Harbour | escape | shipped | same | approve | better / better | worse (fault) | 25/25 | 35 vs 35 (parent 35) | – | 5.8% |
| LIN-2414 | runner | escape | plan (prescribes the fault) | same | approve | better / better | worse (fault) | 40/40 | 7 vs 7 | 5.4% | 9.8% |
| LIN-2980 | Harbour | escape | shipped (names LIN-2983) | same | approve | equivalent / equivalent | worse (fault) | 4/4 | (read) | 1.7% | 2.1% |
| LIN-2406 | Harbour | clean | shipped | same | approve | equivalent / equivalent | worse (test) | 13/14 | | 3.0% | 3.7% |
| LIN-2400 | Harbour | clean | none | partial | approve | better / better | better | 15/15 | | 4.3% | 5.9% |
| LIN-2702 | Harbour | clean | shipped | partial | approve | worse / worse | worse | 30/34 | | 1.0% | 1.6% |
| LIN-2715 | Harbour | clean | shipped (names the fix) | same | approve | worse / worse | worse | none | | 0.9% | 1.2% |
| LIN-2981 | Harbour | clean | shipped | same | approve | better / better | better | 5/5 | | 4.3% | 8.7% |
| LIN-3013 | Harbour | clean | shipped | same | approve | equivalent / equivalent | equivalent | 170/170 | | 5.1% | 5.4% |
| LIN-2559 | runner | clean | shipped | partial | **changes** | better / – | better | 86/86 | | 3.9% | 6.0% |
| LIN-2738 | runner | clean | none | same | approve | better / better | better | 87/87 | | 4.5% | 11.6% |

**What lean cost.**
- **Per ticket.** A replay took three legs, a median 24 turns, 103k weighted tokens and 1.9 minutes
  of wall-clock.
- **The originals.** The ten tickets with transcripts took a median 14.5 dispatches, 0.87 working
  hours and 3.6M weighted tokens. Over all thirteen, the medians are 9 dispatches and 0.7 hours,
  but two August rows show 1 dispatch each and are incomplete.
- **What "original cost" counts.** It is every fleet session whose header names the ticket, of
  every leg kind, each message counted once. It leaves out:
  - 30-day rework, such as LIN-2468 and LIN-2983;
  - wakes delivered from other sessions (the child-named rule below covers these);
  - unmapped fleet sessions.

  The scorecard's own whole-life cost is a fleet total over correct changes and has no per-ticket
  tokens, so this is the ticket's lifetime session cost, not the scorecard's measure.
- **Across the sample.** The replays used 1.67M weighted tokens for all thirteen tickets. The ten
  originals with transcripts used 50.7M.
- **By repo.** Harbour's seven costed tickets range from 0.9% to 5.1% of their originals. The
  runner's three range from 3.9% to 5.4%.
- **By stratum.** The escape stratum's median is 3.6% in tokens (two tickets) and 7.8% in hours.
  The clean stratum's is 4.1% and 5.7%.
- **Charging rule.** The two rules (child named, session entered) differ by at most 11% on any one
  ticket: LIN-2414 is 6.1% against 5.4%, and LIN-2715 is 0.8% against 0.9%. The median is 4.1%
  under both.
- **Weights.** At the mid tier's September list ratio of 0.4 instead of 0.6, the median is 3.1%.
- **Not counted.** The blind reads are measurement, not lean cost. They cost 2.36M, more than all
  thirteen replays together. The orchestrator's pipeline-only calls (worktrees, prompts,
  launches) were about 43k a ticket.

**What a lean lane would cost in production.** Each estimate below is per ticket, and the median
is over the ten costed tickets.

| Adjustment | Median lean ÷ original |
|---|--:|
| As measured | 4.1% |
| Review and close-out at the frontier tier, as the originals ran them | 5.4% |
| The fleet's 1-hour cache writes instead of the replay's 5-minute ones | 5.2% |
| Chores added at the minimum: 8–10 turns at the replay's 5k a turn | 5.2% |
| The orchestrator's pipeline share added instead (worktrees, prompts, launches) | 5.1–5.6% |
| Chores as the cheapest real fleet close-outs spend them, re-priced at mid | 5.8–8.2% |
| Chores as the originals' own legs spent them on proxy writes and remote work, at mid | 10.0% |
| Chores as the originals' legs spent all tracker and remote work | 18–24% |

- **A lean harness** gives 5–10%.
- **Today's per-leg habits** give up to a quarter.
- **Without hindsight,** the replays cost 1.1–2.0 times as much (four tickets, median 1.26×).

**Most of the gap is the harness's leg weight, not fewer legs.**
- **Like for like.** The replay's implementer cost a median 6.3% of the original's implementation
  sessions, at the same tier. Its reviewer and close-out together cost 5.2% of the original's
  review and close-out sessions. The originals ran those at the frontier tier; at matched tier
  it is 8.6%.
- **Fewer legs alone would save far less.** Taking away every leg that is not implementation,
  review or close-out removes about half the original's tokens. Those legs are the stepper beats
  inside sessions (22%), research (12%), plan, bug, autopilot, plan-review and triage.
- **What the original's turns did.** We charged each turn's tokens to the action it took (`where-the-gap-is.svg`):

  | Action | Share of the original's tokens |
  |---|--:|
  | Tracker calls to the proxy | 27% |
  | Reading files | 20% |
  | Tests | 10% |
  | Git remote, PR and CI work | 6% |
  | Edits | 4% |

  The rest was reasoning text and other tools.
  - Tracker and remote work together are 33%. Not all of it was skipped. The replay received its
    prompt and brief inline, which the fleet fetched for 7.6 points, and 2.4 points of
    "tracker" commands made no proxy call. The chores the replay truly never did, proxy writes
    and remote work, are about 15%.
  - In close-out alone, tracker calls are 41% and remote work 12%.
- **Leg shape.** A fleet implementation leg ran a median 77 turns at about 13k weighted tokens a
  turn. The replay's implementer ran 11 turns at about 5k. Review and close-out legs ran 38 turns
  at about 15k a turn, against the replay's 7 and 4 turns at about 5k.
  - Removing every chore would still leave the original 25 times the replay pooled, or 17 times
    at the per-ticket median.
  - `steady-base.md` puts the dispatched prompt at about 2% of a leg's context. Most of the rest
    is the harness's own system prompt and tools, and the turns that orient a fresh leg. Those
    costs are exactly what an in-session subagent does not pay:
    - The fleet's bootstrap summary is about 77k.
    - A fresh review spends 115k before its first decision.
    - The replay's legs cost 20–56k in all.
- **Split pooled over the ten tickets.**
  - **Fewer legs** is worth about 2×; that part is what "lean" means.
  - **Leg weight** is about 10× more: 5–10 times the turns, at 2.4–3.4 times the tokens a turn.
    That comes from the harness, the fenced protocol and hindsight.

![Where the original's tokens went, against the lean replay, pooled](figures/replay-small-work/where-the-gap-is.svg)

**On ordinary small work the replay was as good or better about as often as it was worse, with
hindsight.** In the clean stratum the blind reader judged it better on 4, equivalent on 2 and
worse on 2.
- **The two worse.** Both are partial deliveries, not defects:
  - LIN-2702 kept a function private that the next phase needed exported. The original's tests
    that need it fail on it (4 of 34), and Phase 2 calls it.
  - LIN-2715 shipped the identical one-line fix the description named. Its end-to-end test's
    overlap measurement cannot see the bug, though its `overflowY` assertion still fails a
    revert.
- **The better ones.** Most were better on tests rather than on what ships:
  - LIN-2400 added the exit link the ticket asked for, which the original omitted. It also used
    `font-size: inherit`, where the original's `1rem` makes the login buttons 16px against
    13–14px body text on phones. That second point is a design call; the first is objective.
  - LIN-2559's review caught a regex in the replay's own first draft that would have counted a
    finished foreground sub-agent as still running. The original never had that regex. It does
    register every Agent call as a wait, so the replay is ahead on a case that no recent fleet
    session has hit.
  - LIN-2738 and LIN-2981 were preferred for tests that catch a mutation or stay offline.
    Their production changes are equivalent.
- **Shipped tests.** Eight of the eleven tickets with unit tests pass all of the original's own
  tests:
  - LIN-2702 fails on interface: the missing export.
  - LIN-2406 fails on a warning's wording. The registered rule counts that as behaviour, so its
    verdict is worse.
  - LIN-2123 fails on behaviour, by design (below).

**On known faults the lean pipeline matched the full process, mostly by missing the same thing,
and twice by being told to.**
- **Same fault.** Three replays ship the original's fault:
  - LIN-2355 left the proxy preamble pointing at reads that 422. LIN-2804's tests fail 35 of 475
    on the replay, exactly as on the original. The untouched parent also fails those 35, so the
    tests cannot show the fault. A reading of both diffs does.
  - LIN-2414's re-park drops an undelivered follow-up. LIN-2468's tests fail 7 of 53 on both. Its
    final description, the research leg's recommendation, tells the implementer to clear
    `pendingFollowUp` on re-park.
  - LIN-2980 makes an unguarded dereference stream-aborting. The production change is identical
    to the original's.

  Their reviews approved all three. LIN-2980's reviewer named the dereference as a nit and
  deferred it to LIN-2983, a ticket the final description names.
- **Caught.** On LIN-2252 the replay's implementer wrote the same inert bottom padding as the
  original. Its reviewer rejected it, and the close-out applied the horizontal reservation that
  LIN-2272 later shipped as the fix. LIN-2272's browser spec fails on the parent, the original and
  the replay's first draft at the same 32 scroll offsets. It passes on the replay's final tree.
- **Declined.** On LIN-2123 the replay obeyed the description's constraint ("do not widen the
  derivation … it lands in simple-dispatcher, not here"). It documented and pinned the residual
  instead of attempting a fix.
  - It ships no production no-op, but nothing that runs changed and the residual stays live.
    LIN-2268's tests fail 4 of 45 on it, as on the original.
  - Both blind reads preferred the replay.
  - The pre-registered rule makes it "worse" because a shipped test fails on behaviour.

The pre-registration predicted the replay would reproduce at most two of the four code faults.
As coded it reproduced three. By outcome, with LIN-2123's residual counted, it reproduced four.

**Hindsight explains more than version 1 allowed.** The replay read each description as finally
written. The earliest text that predates each ticket's first commit was recovered from the fleet's
transcripts and task snapshots:
- **Eight carry a post-merge section** ("Shipped", "Outcome", "Landed", "Implemented and merged").
- **One carries a research recommendation:** LIN-2414.
- **Four are unchanged** from the filing: LIN-2123, 2252, 2400 and 2738.

The four tickets without hindsight were judged better on all four. The shipped group scored 3
better, 3 equivalent and 2 worse. That pattern says little about hindsight. The four are
hindsight-free because nothing was ever written into their descriptions, not because the replay
did well without help.

`survey-check-11.md` re-ran four tickets with the same protocol from the pre-implementation text:

| Ticket | With hindsight | Without | Known fault without hindsight |
|---|---|---|---|
| LIN-2355 | better | **worse** | the same |
| LIN-2414 | better | **worse** | keeps the follow-up, but leaves a second harm the research named |
| LIN-2980 | equivalent | equivalent | the same, line for line |
| LIN-2715 | worse | worse | not applicable; the pipeline could not verify its own (working) fix and was NOT READY |

**The predictions, scored.**

| Pre-registered prediction | Result |
|---|---|
| Lean costs a tenth to a half of the original, median | **Wrong, low:** 4.1% (tokens), 5.9% (hours) as measured. An estimate for production of 5–10% sits at or below the bottom of the predicted range |
| At least 9 of 13 equivalent or better | **Met** by the blind reads (11 of 13); **not met** by the verdict rule as registered (6 of 13), which charges the replay for faults the original shared |
| The replay reproduces at most 2 of the 4 code faults | **Wrong:** 3 as coded, 4 by outcome |

## Options

Each option is a choice for John, not a change made here.

| Option | Estimated effect | Evidence | Risk to correctness | How the scorecard would measure it |
|---|---|---|---|---|
| **1. A lean lane for M3-light tickets.** One implementer, one review and one close-out, chosen by a path check in code (the backtest's M3), and no research, plan, stepper or supervision legs. | M3's light group is 12.9% of raw tokens and 13% of hours (backtest). Lean in production must add PR, CI, merge and a closing comment, so allow 5–40% of today's cost there; the estimate here is 5–10%, up to a quarter. That saves 8–12% of tokens: **1.08–1.14× correct work per budget**, close to `cost-mix.md`'s 1.1× for its light-lane option | The 13 replays: equivalent or better on 11 by blind reading with hindsight, and on 6 by the registered rule. Without hindsight, on 1 of the 4 re-run. The same known faults as the full process; one the full process missed | Review caught real faults on 8 of the backtest's 328 M3-light changes, 11 of its 15 findings at plan review. This replay cannot see those catches, because the descriptions already carried the plans. On two escape tickets the replay's correctness came from a research leg it did not pay for. Escapes in the M3 light group run 2.0 in 100 (0.9–4.6) under the full process | Escapes and named fixes per 100 lane changes, against the M3 light group's 2.0 in 100; weighted tokens per correct change in the lane. At 2 in 100, about 400 lane changes are needed to see a doubling |
| **2. Lighter legs, everywhere.** Fewer tracker reads and writes per leg, the prompt and brief passed inline, and a turn budget per leg kind. | Fleet-wide, tracker calls are 25% of tokens and remote work 4%. Halving them saves about 15%, **1.1–1.2×** on all work, not just small work | `survey-replay-chores.mjs` over 50 sessions of these tickets. Fleet legs run 5–10 times the replay's turns, at 2.4–3.4 times the tokens per turn | Low for reads. Moderate for writes, because later legs read what earlier ones wrote (see `step-overlap.md`) | Per-leg turns and tokens from transcripts, by kind (`survey-replay-chores.mjs` run monthly); correct changes per week unchanged |

The two options overlap: the lean lane is option 2 taken to its limit on a fifth of the work.
Neither removes the risk the known faults show. The full process missed them too, so they argue
that the current legs are not what stands between Harbour and those faults.

## Method

**Before anything ran.**
- **Pre-registration.** `replay-small-work-preregistration.md` fixed the selection, protocol,
  metrics and predictions.
  - It was committed as d2fa2773, with the selection and prepare scripts, at 10:07:18Z, and
    pushed before the first replay. The branch existed on GitHub at 10:07:27Z, and the first
    replay was launched at 10:07:49Z.
  - The selection's quotas were reset from 7 Harbour and 4 runner to 6 and 2 at 10:04Z, with the
    candidates visible, before the commit.
- **Selection.** `scripts/survey-replay-select.mjs` reads the scorecard's snapshot and applies
  `survey-proportional-classifiers.mjs`'s rule M3, unchanged.
  - 75 Done changes were eligible, 74 of them with exactly one merge to replay from.
  - The escape stratum is all five that survive the backtest's readings.
  - The clean stratum is a systematic sample by last-merge date: six of the eleven Harbour
    changes with full transcripts, and both of the runner's two.

**The replay.**
- `scripts/survey-replay-prepare.mjs` built 13 detached worktrees at each original's parent and
  holds the fixed prompts. `scripts/survey-replay-emit.mjs` renders the reviewer, close-out and
  blind prompts from those templates.
- Each role was a fresh in-session subagent at the mid tier.
  - Every original implementer whose transcript survives was also mid tier, but an earlier
    mid-tier model.
  - Every original review and close-out ran at the frontier tier, so the tier did change for
    those two roles.
- **Fences.** `scripts/survey-replay-fences.mjs` checked the 327 tool calls the 39 lean roles
  made: no git history past HEAD, no remote, no proxy or HTTP call, no read of the live clones,
  and no subagents. It found no breach; its four pattern hits are route strings inside code the
  agents wrote. The 27 blind reads made 232 more calls, which the script does not check and
  `survey-check-11.md` found clean.
- Nothing was pushed. No comment touched a source ticket, nothing was dispatched, and the
  worktrees were removed afterwards.

**Measurement.**

```
node scripts/survey-proportional-classifiers.mjs --out data/survey-replay/features.json   # rule M3, unchanged
node scripts/survey-replay-select.mjs                       # the pre-registered selection
node scripts/survey-replay-prepare.mjs --root <dir>         # worktrees and implementer prompts
node scripts/survey-replay-emit.mjs <role> LIN-n --root <dir> --subagents <dir>   # later prompts
node scripts/survey-costmix-tokens.mjs --since 2026-08-01 --until 2026-10-01 --out data/survey-replay/costmix-tokens.json
node scripts/survey-replay-cost.mjs --subagents <dir>       # lean per role; original session cost, both charging rules
node scripts/survey-replay-tests.mjs --root <dir>           # shipped and fix tests on replay, original and fix trees
node scripts/survey-replay-chores.mjs                       # what the originals' turns did
node scripts/survey-replay-fences.mjs --subagents <dir>     # fence check
node scripts/survey-replay-analyse.mjs --subagents <dir>    # verdicts and every table above
node scripts/survey-replay-figures.mjs                      # the two SVGs
```

- **Inputs.** The scorecard snapshot (`data/survey/`, cut 30 September) is the one the wave's
  other papers used. It was taken that morning by `measuring-throughput.md`'s scripts and copied
  into this branch's git-ignored `data/`.
- **Tokens.** Weighted as `survey-costmix-tokens.mjs` weights them: frontier-input equivalents,
  with mid ×0.6. Each message id counts once.
- **Tests.** Every test run happened in a throwaway worktree, never the replay's own.
- **Hand codes** are in `replay-small-work-codes.json`, with their rubric. They were written after
  eleven first-order blind results had reached the coder.
- **Proxy.** The orchestrator made 15 calls:
  - the dispatch item, the brief and `/me`;
  - two reads of LIN-3189;
  - four reads of the endpoint catalog;
  - two probes that returned 404;
  - one comment and one status change on LIN-3189, the only writes.

**Deviations from the pre-registration.**
- **Declared in version 1:**
  - The first blind reader for LIN-2702 stalled on an interactive `patch` prompt for 8.5 of its
    8.8 minutes. It was stopped and re-run with the same prompt, plus one sentence forbidding
    interactive commands.
  - The swapped-order second read, the chore split and the fence check were added after the
    pre-registration. None of them feeds the verdict.
  - The swapped read for LIN-2559 stalled in a test run for 6.8 of its 7.8 minutes. It was stopped
    without a judgement and was not re-run, so the swapped read covers 12 tickets.
  - The test script's first run read no counts until it was switched to the TAP reporter. That
    changed no outcome.
  - The runner's `test/isolate-local-halt.js` does not exist at these parents, so the runner's
    tests ran under plain `node --test`.
  - Some implementers committed the worktree's `node_modules` symlink. Every diff and judgement
    here excludes it.
- **Found by `survey-check-11.md`:**
  - The shipped-test failure class was widened in the codes to count a message's wording as
    interface. Version 2 restores the registered rule, which moves LIN-2406 to worse.
  - The hand codes were written after the blind results arrived.
  - The original implementers' different mid-tier model was not reported, though the
    pre-registration says a mismatch is.
  - Five lean roles ran whole unit suites rather than tests by file, and one wrote logs outside
    its worktree.
  - The blind readers copied the parent tree, applied both diffs and ran tests, beyond reading
    two diffs.
  - LIN-2355's blind diffs include a docs file.
  - Every worktree's `node_modules` linked to the live clone's current one.

## Limits

- **Hindsight favours the replay, and more than version 1 allowed.** The descriptions are final:
  - Eight carry what shipped and one carries the research recommendation.
  - Three carry their own outcome: LIN-2414's prescribes the escape, LIN-2980's names the fault's
    ticket and LIN-2715's names the fix.

  The final text also reached the blind readers, and one cited the shipped size as a reason.
  Four replays from the pre-implementation text moved two verdicts from better to worse. Only a
  forward trial removes it.
- **The plan legs' output came free, which favours lean.** Where a description carries an approved
  plan or research recommendation, the replay got the product of legs whose cost sits in the
  original's total. The cost ratio counts those legs against the original. The correctness
  comparison quietly assumes them.
- **The chores were skipped, which favours lean on cost.** The replay never opened a PR, waited on
  CI, merged, or wrote to the tracker. Priced, they take the median from 4.1% to 5–10% in a lean
  harness.
- **Not the fleet's harness, which favours lean on cost.** In-session subagents have their own
  smaller system prompt, no Stop hook, no meta-prompt-written worker prompt, no proxy, and
  5-minute cache writes. Each role was one turn of delegation inside a frontier-tier session, and
  was free to run tests but not browsers. On correctness a fleet leg might do better (more
  context) or worse (more to do).
- **Review and close-out ran a tier lower than the originals', which favours lean on cost.** At
  matched tier the median is 5.4%.
- **No browser checks, which biases UI verdicts either way.** Playwright and visual specs were not
  run by the replay. LIN-2252, LIN-2400 and LIN-2715 were judged by reading CSS and tests;
  `survey-check-11.md` ran LIN-2252's fix spec since.
- **The blind readers were not blind to style, which probably favours the replay a little.** They
  saw diffs without commit messages, but the originals' comments cite tickets and plan labels more
  heavily, and a reader could guess. The swapped read rules out position bias: the first position
  was preferred 9 times and the second 10. It does not rule out a shared reader taste, since
  every read used the same tier and prompt.
- **The verdict rule is harsh on shared faults, which biases against the replay.** It counts a
  fault against the replay even when the original shipped the same one. On the blind reads alone
  the replay is worse on only 2 of 13.
- **The sample is small and leans on September and on faults.**
  - **Size.** 13 tickets: 10 from Harbour and 3 from the runner, 5 with known faults. One caught
    fault in five has a 95% interval of about 4 to 62 in 100.
  - **Month.** The clean stratum is all September changes with full transcripts. September took
    a median 14 dispatches per change against August's 5, so the ratio is biased low if read as
    typical.
  - **Faults.** The escape stratum is 5 of 13 against 5 of 74 replayable changes. Weighted to the
    population, "better" on blind reads would fall from 62% to about 52%.
- **Only M3-light.** Every ticket is under 50 production lines on low-risk paths. Nothing here
  says anything about credential, data or prompt work, or about anything larger.

## Next

What John would need to decide, or have measured, next:

- **Whether to try the lean lane forward.** That means:
  - running it in the fleet's own harness, on new M3-light tickets;
  - starting from the description as filed, with the plan not written first;
  - including the PR, CI and tracker chores.

  That trial is the only way to remove the hindsight and free-plan biases above. Its escape rate
  needs about 400 changes to show a doubling of the full process's 2 in 100.
- **What a leg should cost.** The fleet's legs take five to ten times the replay's turns, at two
  and a half to three and a half times the tokens a turn. This paper did not measure which of
  those turns change the outcome, or how much is the harness's fixed orientation.
  `what-hides-between-sessions.md` and `prototype-concepts.md`, landed alongside, look at the
  sessions from other sides.
- **What catches the faults both pipelines miss.** Three of the four code faults here passed every
  review, full or lean. Each was found by a later sweep or by use.

Proposal line added to `proposals.md`: *on the three faults both the full process and the lean
replay shipped (LIN-2355, LIN-2414, LIN-2980), what kind of check (test, sweep, reviewer prompt or
use) found each one, and would any check that runs before merge have found it?*
