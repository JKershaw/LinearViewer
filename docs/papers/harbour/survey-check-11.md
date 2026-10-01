---
title: Does the replay-small-work paper hold up?
kind: paper
version: 1
date: 2026-10-01
authors: [Claude (LIN-3191)]
model: "Frontier tier, Claude Code CLI dispatched by simple-dispatcher (dispatch 1c193554, kind custom, LIN-3191); the dispatch item read over the proxy carries no effort field. One bounded session, with no research, plan, review or close-out legs, by the brief's design. In-session subagents: five frontier-tier helpers. One audited the pre-registration, deviations and fences; one re-ran the cost scripts; one recovered the pre-implementation descriptions; one checked the sample and citations; one re-ran the known faults' tests, including the browser specs. Also 19 frontier-tier blind readers: 15 for the 13 re-judgements in a randomised order, since LIN-2414's was stopped twice and run a third time, and 4 hindsight-free comparisons and 12 mid-tier replay roles (4 tickets × implementer, reviewer and close-out). This session settled every figure, wrote the check and the paper's version 2. It did not write the paper, which came from dispatch a6213a6b."
grounded_at: 066232d6 (LinearViewer, origin/main when the check was written; docs/steady-base.md is unchanged from 6d2e03d4, so its line numbers hold at 27c4456f too); the paper's data at d88e2216 and its scorecard heads 26014544 (LinearViewer) and 33667480 (simple-dispatcher), re-run from the author's own git-ignored snapshots; transcripts, runner logs and the runner's state read on this machine on 1 October 2026, 11:22–13:10Z
cites:
  - "docs/papers/harbour/replay-small-work.md@c29d0add (version 1, LIN-3189), its pre-registration @d2fa2773, its codes and its scripts survey-replay-select, -cost, -chores, -tests, -fences and -analyse, each re-run"
  - "LIN-3189's session transcript and its 66 subagent transcripts (session 480e1ef6, 09:59–10:41Z on 1 October), and the runner's state/sessions.json item metadata for dispatch a6213a6b"
  - "docs/papers/harbour/cost-mix.md@d88e2216:238-253 (the standalone floor, 49.6%; the fit's intercept 7.8M of 8.8M) and survey-check-9.md@066232d6:43-45, :194-203 (that reading of it, corrected)"
  - "docs/papers/harbour/starting-context.md@d88e2216:67, :89-90, :110 (24 calls before the first edit; the bootstrap about 77k; system prompt, tools and CLAUDE.md 13% of carried context)"
  - "docs/papers/harbour/held-or-fresh.md@d88e2216:20, :77-87 (a fresh review spends 115k before its first decision; about 33k of system prompt)"
  - "docs/papers/harbour/proportional-process-backtest.md@d88e2216:76-95, :102, :324 (M3's light group, 12.9% of raw tokens over 171 changes)"
  - "docs/papers/harbour/measuring-throughput.md@d88e2216:118-121 and model-choice.md@d88e2216:224 (per-change tokens are fleet totals over correct changes; whole-life includes rework)"
  - "LIN-2268 (99c604b4), LIN-2272 (740bded7), LIN-2804 (f66c82ec), LIN-2468 (simple-dispatcher 2ef854b): the named fixes, whose tests were re-run here, LIN-2272's in a browser"
  - "task snapshots via GET /api/proxy/issues/:id/snapshots for LIN-2123, LIN-2252 and LIN-2355 (three reads)"
  - "docs/steady-base.md@066232d6 (the lines listed below)"
  - "LIN-3191's description and brief, read over the workspace proxy 2026-10-01"
  - "scripts/survey-check-11.mjs and survey-check-11-codes.json (this check)"
---

# Does the replay-small-work paper hold up?

Its arithmetic holds, but its two headline readings do not. Every committed script re-runs, and
every printed cost figure reproduces exactly. The pre-registration was pushed 22 seconds before
the first replay, and the selection reproduces ticket for ticket. A fresh blind reader in a
randomised order agrees with the paper's first reads on 12 of 13 tickets. What fails is what the
numbers are taken to mean.

**Cost.** The 4.1% is the lean replay's in-session subagents against every fleet session charged
to the ticket. It is not a price for a lean lane in production:
- The original's review and close-out ran at the frontier tier and the replay's at the mid tier,
  although the paper says no tier was changed. At matched tier the median is 5.4%.
- Production would still open a PR, wait on CI, merge and write to the tracker. Three ways of
  pricing those chores put the median at 5–10% in a lean harness. With the chore habits the
  fleet's legs have today, it is 18–24%.
- The replay's legs paid none of the fleet's fixed per-leg costs. A fresh fleet review spends
  3.7 times the replay's whole review leg before its first decision. So most of the gap is the
  in-session harness, not the lean pipeline.
- "Whole-life" is not the scorecard's measure. The scorecard has no per-ticket tokens, and
  whole-life includes rework, which the paper leaves out.

Lean is still much cheaper, about a tenth to a twentieth in a lean harness rather than a
twenty-fifth.

**Correctness.** Hindsight explains more than the paper allows:
- **Two of the three "same faults" were in the description.** LIN-2414's final description tells
  the implementer to clear `pendingFollowUp`, which is the escape itself. LIN-2980's names the
  fault's ticket as out of scope. LIN-2715's names the exact one-line fix.
- **Four replays re-run from the pre-implementation text.** Two blind verdicts moved from better
  to worse (LIN-2355, LIN-2414) and two did not move. Each replay that could reproduce its ticket's
  known fault without being told did so.
- **The "better" verdicts.** About half rest on test strength with the same production code. One
  (LIN-2559) gives a reason that describes a bug in the replay's own first draft.
- **The pre-registered verdict, as registered,** is 5 better, 1 equivalent and 7 worse. The
  failure class was widened after registration.

"No worse on ordinary small work" is therefore not established. "The full process's extra legs
bought no detectable correctness" holds only for these 13 tickets and only with hindsight. Four
replays without hindsight do not support it.

**What does hold:**
- Nothing was pushed from a replay worktree.
- The only tracker writes were LIN-3189's own comment and status change, and there were no
  dispatches.
- The fence check's 0 breaches in 327 calls re-runs exactly, and a scan of all 559 role calls
  finds none.
- LIN-2252's caught fault is now confirmed in a browser.

The paper is at version 2 in this PR, with this check's author added. Twelve lines of
`docs/steady-base.md` would change. A new point, a map row and two evidence rows would be added.
They are listed below. This check does not edit the anchor.

## Findings

**Every script re-runs, and every printed number reproduces.** The author's snapshots
(`data/survey`, `data/survey-replay`) survive in the LIN-3189 workspace and were copied, not
touched.
- `survey-costmix-tokens.mjs --since 2026-08-01 --until 2026-10-01` gives the same 1,988
  sessions and the same per-ticket totals under both charging rules.
- `survey-replay-cost`, `-chores` and `-analyse` give byte-identical JSON once `generatedAt` is
  removed. Re-running to 2 October adds 52 sessions and none on the 13 tickets.
- `survey-replay-select.mjs`, in a clone at 27c4456f with the author's data, gives:
  - 75 eligible and 74 replayable changes;
  - the same 13 tickets, merges and parents;
  - identical M3 flags on all 1,337 rows.
- `survey-replay-fences.mjs` prints "tool calls 327; flagged 4; in written code 4; breaches 0",
  byte for byte.
- All 26 blind prompts carry exactly `git diff parent..replay` and `git diff parent..merge`.

| Figure | Version 1 | Checked | Verdict |
|---|---|---|---|
| **Pre-registration and selection** | | | |
| Pre-registration before the first replay | committed and pushed | committed 10:07:18Z; branch created on GitHub 10:07:27Z; first replay launched 10:07:49Z; the file is unchanged since | holds |
| "Committed alone as d2fa2773" | | the commit also adds the selection and prepare scripts; the quotas were reset from 7/4 to 6/2 at 10:04, with the candidates visible, before any replay | corrected |
| 75 eligible, 74 replayable, 13 selected; systematic within stratum | | reproduce; indices 0, 2, 4, 6, 8, 10 of the Harbour pool of 11 | holds |
| **Cost** | | | |
| Median 4.1% (0.9–5.4%, 10 tickets); hours 5.9%; per-ticket table | | reproduce | holds, as computed |
| "Whole-life weighted tokens … the scorecard's measure" | | every session whose header names the ticket. The scorecard has no per-ticket tokens (fleet totals over correct changes), and whole-life includes 30-day rework (`model-choice.md`), which is left out | corrected: lifetime session tokens charged to the ticket |
| "Every original implementer … mid tier, so no tier was changed" | | implementers: mid tier, but an earlier mid-tier model (undeclared, though the pre-registration says a mismatch is reported). Every original review and close-out ran at the frontier tier; the replay's ran at mid | corrected |
| Reviewer + close-out "like for like" 5.2% | | 8.6% at matched tier; headline 5.4% at matched tier | corrected |
| "The chores the replay never did come to 34%" | 34% | tracker + remote 33.2%. Of the tracker share, 7.6 points fetched the leg's own prompt and brief, which the replay received inline, and 2.4 made no proxy call. Proxy writes plus remote work: about 15% | qualified |
| "About 25 times" with every chore removed | 25× | 25.2× pooled; per-ticket median 17.4× | qualified |
| Originals: median 9 dispatches, 0.7 working hours, 3.6M | | the dispatches and hours are over 13 tickets, two of them August rows the paper itself calls incomplete. Over the 10 costed tickets: 14.5 dispatches, 0.87 hours | corrected |
| Charging rules "differ by at most 13%" | | 11.3% unrounded | holds |
| Mid tier weighted 0.6 | | at its September list ratio of 0.4 the median is 3.1% | holds, sensitivity added |
| Not-the-fleet's-harness bias "direction unknown" | | on cost every difference favours lean. The replay wrote 5-minute cache at weight 1.25, the fleet 1-hour at weight 2 (+27.5% for lean in the fleet's harness, 5.2%). The replay's first turn carried 22.5k of prompt against the fleet's 33–44k. No bootstrap, Stop hook, stepper or proxy | corrected |
| Option 1's "5–40% of today's cost" for lean in production | | 5–10% (lean harness, three chore estimates); 18–24% (today's per-leg chore habits); hindsight-free replays cost 1.1–2.0× the replay's | holds; the range sits inside it |
| **Correctness** | | | |
| Blind reads 8 better, 3 equivalent, 2 worse; swapped read agrees 12 of 12 | | reproduce. A randomised re-judgement agrees on 12 of 13. LIN-2406 moves from equivalent to better: the replay's tests catch a counting mutation the original's miss | holds |
| Pre-registered verdict 5 / 2 / 6; "7 of 13 equivalent or better" | | the shipped-test failure class was widened after registration to count a message's wording as interface. Under the registered rule LIN-2406's failure is behaviour: 5 / 1 / 7, and 6 of 13 | corrected |
| "Seven carry a post-merge section; three more carry an approved plan" | 7 + 3 + 4 = 14 | 8 shipped (LIN-2406 says "Implemented and merged — PR #1327"), 1 plan (LIN-2414), 4 none | corrected |
| "If hindsight drove the result, the shipped group should score best. It scores worst." | | as a count, still true (shipped 3 / 3 / 2). As an argument it does not hold: four replays without hindsight moved 2 of 4 verdicts from better to worse | corrected |
| "The replay reproduced three of the four code faults" | 3 | as coded. LIN-2414's fault was prescribed by its final description and LIN-2980's description named the fault's ticket. Coded by outcome, LIN-2123 is the fourth (the residual is live on both) | qualified |
| LIN-2123 "avoided" | | declined: no production line runs differently, and the users' residual is the same | corrected |
| LIN-2252 "caught by its review" | (e2e not run) | LIN-2272's browser spec fails on the parent, the original and the replay's first draft at the same 32 scroll offsets, and passes on the replay's final tree and the fix | holds, now measured |
| LIN-2355 "35 of 475 fail on both" | | true, and the untouched parent fails the same 35. The tests cannot tell "shipped the fault" from "did nothing"; the fault rests on reading, which holds | qualified |
| LIN-2559 better: its review "caught a regex that would have … deferred a real DONE for thirty minutes" | | the regex was in the replay's own first draft; the original never had it. The original does register every Agent call as a wait; no foreground Agent completion appears in 360 recent results, so it is latent | corrected |
| LIN-2400 better: the original's `1rem` "enlarged every login button on phones" | | true as a size mismatch at phone widths (16px against 13–14px body) and a design call. The objective difference is the exit link the ticket listed, which the original omits | qualified |
| "Hung for ten minutes" (LIN-2702) / "stopped after ten minutes" (LIN-2559 swapped) | 10 / 10 | 8.8 and 7.8 minutes | corrected |
| **Safety** | | | |
| Fence check: 0 breaches in 327 tool calls | | re-runs exactly. The 327 are the 39 lean roles only; the 27 blind reads made 232 more, never checked by the script, and clean on this check's scan. The script's live-clone pattern skips the very clone that held each ticket's future | holds, scope stated |
| No pushes from replay worktrees; no tracker writes; no dispatches | | holds. No git push, fetch, pull or remote, and no `gh`, curl or proxy call, in any of 559 role calls. The orchestrator's only push was the paper's branch | holds |
| "The only proxy calls were the dispatch item, the brief, the ticket, one comment and one status change" | 5 | 15: plus `/me`, two 404 probes, a second ticket read and four `/instructions` reads. The writes were only LIN-3189's comment and status | corrected |
| "Run unit tests only, by file" fence | | broken by five roles that ran whole suites (`npm test`, `test:unit`, `test:hermetic`, a glob). One wrote logs outside its worktree. Unit-only, so no safety breach | corrected |
| Header: "effort not recorded in the dispatch item" | | the proxy's copy has no effort field; the runner's item metadata records effort high | clarified |

**Two of the three shared faults were in the description the replay read.** This is the
finding the paper's hindsight section misses. The descriptions were recovered from the earliest
fleet transcripts and task snapshots. All 13 have a text that predates the first commit. Three
carry their own outcome:
- **LIN-2414.** Its final description is the research leg's recommendation. That tells the
  implementer to re-park a lapsed blocked hold and "clear `holdingSince`/`holdKind`/`pendingFollowUp`".
  Deleting `pendingFollowUp` is what LIN-2468 later fixed. The replay did what it was told.
- **LIN-2980.** Its final description names LIN-2983, the escaped dereference, as out of scope.
  The replay's reviewer then deferred the dereference to LIN-2983 as a nit.
- **LIN-2715.** Its final description says what shipped: "One declaration: `overflow-y: auto`
  added to the existing … rule". The replay shipped that line.

So "a cheaper review is … missing the same faults" is in part a cheaper review reading the same
instructions.

**Without hindsight, two of four blind verdicts move from better to worse.** Four tickets were
re-run under the same protocol from the pre-implementation text. The same `PROMPTS` were
imported unchanged from `survey-replay-prepare.mjs`, with mid-tier roles in detached worktrees at
the same parents. Each was judged blind at the frontier tier against the final description, as
the paper's reads were. The four are LIN-2355, LIN-2414, LIN-2980 (escape) and LIN-2715 (clean,
shipped). The other nine either have a pre-implementation text identical to the final one
(LIN-2123, 2252, 2400, 2738) or a pre text that already carries the fix's shape.

| Ticket | What hindsight added | Pipeline | Blind (v1 → hindsight-free) | Known fault | Lean tokens, hindsight-free ÷ v1 replay |
|---|---|---|---|---|--:|
| LIN-2355 | a research rewrite: eight routes, one fix chosen, acceptance criteria | review asked only to drop a symlink; READY | better → **worse**: seven routes, and the error-mapping backstop the final ticket rules out | **same**: the preamble still points at a read that now 422s (35 of 475 fix tests fail, as before) | 1.32× |
| LIN-2414 | the research recommendation, which prescribes the escape | APPROVE; READY | better → **worse**: leaves the stale-`refiredAt` force-FAIL the research named | **different**: keeps the follow-up, but the refire still loses its text; 8 of 53 fix tests fail against 7 | 1.19× |
| LIN-2980 | the "propagate" ruling, LIN-2983 named | APPROVE; READY | equivalent → equivalent | **same**: the production change is the original's, comment for comment but one | 1.07× |
| LIN-2715 | a Shipped section naming the one-line fix | REQUEST CHANGES; **NOT READY** (no browser allowed) | worse → worse: a different fix that lets the section grow past the screen. In a browser it passes the original's own witness, 3 of 3. Its new pre-start specs fail the parent and pass the fix. Its mid-session specs mock the wrong endpoint and would fail in CI | not applicable | 2.02× |

Without the hindsight, the lean pipeline:
- got two escape tickets wrong that it had got right;
- shipped the same fault on the two where the fault could ship without being prescribed;
- on the clean ticket, found a working fix of its own but could not verify it, and left specs
  that would fail CI.

Its cost rose a median 1.26 times. Four tickets cannot size the effect. They are enough to show
that "the four tickets with no hindsight were judged better on all four" is not evidence against
hindsight. Those four have no hindsight because nothing was written into their descriptions, not
because the replay did well without help.

**About half of the "better" verdicts rest on tests, not on what ships.** The re-judgement
readers applied both diffs and re-ran tests, several with mutations. The faults check re-ran the
replay's tests on the original merge.
- **Production differences:** five preferences rest on behaviour that differs in use.
  - LIN-2252: the browser spec above.
  - LIN-2400: the exit link.
  - LIN-2559: the latent foreground-agent wait.
  - LIN-2414: the original re-parks and loses a follow-up. The replay, by its probe, refires.
  - LIN-2702: the replay leaves `postScan` private. Four of the original's tests fail on it ("postScan is not a function"), and
    Phase 2 calls `window.ScanSection.postScan`. This one is a "worse".
- **Test strength only:** five more rest on test strength with identical or equivalent
  production code. These are LIN-2355, LIN-2406, LIN-2715, LIN-2738 and LIN-2981.
- **No objective support:** LIN-2123, where nothing that runs changed.

An outsider would accept a test that fails on the other tree for a behavioural reason. On that
standard the replay is better on three tickets (2252, 2400, 2559) and worse on one (2702). On
the rest it is equal in what ships.

**The sample represents small work in size and kind, but not in month or stratum.**

| | 13 chosen | 74 replayable | M3-light with production lines, June–September (198) |
|---|---|---|---|
| Production lines, median | 21 | 22.5 | 23 |
| Test lines, median | 98 | 83 | 56 |
| Runner share | 23% | 16% | 17% |
| September share | 77% (clean: 8 of 8) | 38% | 16% |
| Dispatches, median | 9 (clean 14.5) | 7 | 7 |
| Original lifetime tokens, median | 3.60M | 4.20M (16 with transcripts) | 3.81M |

Which way each bias runs:
- **September.** The transcript requirement puts the whole clean stratum in September, which
  took a median 14 dispatches per change against August's 5. On cost this biases the ratio low
  if it is read as typical. Direction on correctness is unknown.
- **The clean stratum did not pick cheap originals.** The replays' median against the pool's
  originals gives 2.5–2.7%, so the sampled originals make the ratio slightly worse for lean, by
  under a point.
- **The escape stratum is oversampled:** 5 of 13 tickets against 5 of 74 replayable changes.
  Weighted to the population:
  - "worse" under the registered rule falls from 46% to about 29%;
  - "better" on blind reads falls from 62% to about 52%, because originals chosen for their
    faults lose blind reads.
- **Coverage.** 42% of M3-light changes have no production lines and could never be selected, but
  Option 1 is sized on the whole group.

### Reconciling 4.1% with the cost papers

**The paper repeats the cost-mix reading that survey-check-9 corrected.** It cites
`cost-mix.md@d88e2216:238` as "at least half of a small change's cost is fixed". The line, and
cost-mix's version 2, say a *standalone* change: half of all standalone cost sits at the
small-change floor (49.6%). The fit's intercept is 7.8M of an 8.8M mean, about 89%.

**Against that fixed cost, three fleet-style legs alone would cost 15–31% of the originals.** At
cost-mix's 1–49-line median, the fixed part is 210–374k a dispatch. That assumes it spreads evenly
over dispatches, which cost-mix does not claim.

**Orientation alone exceeds the replay's whole legs.** The replay's legs cost a median 56k
(implementer), 31k (reviewer) and 20k (close-out).
- The fleet's bootstrap summary is about 77k (`starting-context.md:89-90`).
- A fresh review spends 115k before its first decision (`held-or-fresh.md:82`).
- An implementation leg makes 24 calls before its first edit. The replay's implementer took 11
  turns in all.

So 4.1% is plausible only because the replay's harness paid none of that fixed cost.

**Most of the gap is the harness, not the lean pipeline.** Pooled over the 10 costed tickets:

| Step | Tokens |
|---|--:|
| The originals | 50.7M |
| Keep only implementation, review and close-out | 25.4M |
| Then remove their tracker and remote chores | 17.4M |
| Then price review and close-out at the mid tier | 14.1M |
| The replay | 1.34M (9.5% of that, about 10.5% after the cache adjustment) |

- **Fewer legs** is worth about 2×; that part is what "lean" means.
- **The other ~10×** is leg weight: 5–10 times the turns, at 2.4–3.4 times the tokens a turn. That
  comes from the in-session subagent harness, the fenced protocol and hindsight.
- **The paper says the weight "is in what the legs do".** That line leaves out its own source,
  `steady-base.md:215`, which puts most of the rest of a leg's context in the harness's own system
  prompt and tools.

**Held-or-fresh.** Every replay leg is fresh, so held-or-fresh's held-supervisor costs do not
apply. Its fresh-leg orientation figures are the ones that bind, as above.

**4.1% is plausible as what this harness cost.** As a production lean lane it is not plausible:
5–10% in a lean harness, and towards a quarter with today's per-leg habits.

### The Options sections: sizes and overlap

**Option 1, a lean lane for M3-light tickets.**
- **The saving holds.** Its arithmetic holds: 12.9% × (0.60–0.95) is 7.7–12.3%, or 1.08–1.14×.
  The measured 5–24% for lean in production sits inside its 5–40% allowance, giving 9.8–12.3%,
  about 1.11–1.14×.
- **The base is weaker than stated.** The 12.9% is raw, unweighted tokens over 171 changes. 42%
  of the group's changes have no production line and were never sampled.
- **The evidence column does not hold:** "equivalent or better on 11 of 13 by blind reading".
  Without hindsight it is 1 of 4 on the tickets re-run, and 6 of 13 on the registered rule.
- **The risk column needs one more line.** On two escape tickets the lean pipeline's correctness
  depended on a research leg's output it did not pay for.

**Option 2, lighter legs everywhere.** It holds as sized, about 1.1–1.2×. Fleet-wide, tracker
calls are 24.7% and remote work 4.4%, so halving them saves 14.6%, about 1.17×. Of the tracker
share, the prompt and brief fetches (7.6 points on these tickets) cannot be halved by skipping
them. They can be by passing the text inline, as the replay did.

**Overlap.** The two options overlap as the paper says. Option 1 overlaps the anchor's row 7
(size the process to the change), and Option 2 overlaps rows 1–3 and the bootstrap row.

### The lines of `docs/steady-base.md` that would change

The lines are at `066232d6`. The anchor does not yet cite replay-small-work; line 260 only plans
"a pre-registered replay of small work". These are the lines a fold-in of the version 2 paper
would change. This check did not edit the anchor.

| Line | Now | Should read |
|---|---|---|
| 3 | the preamble listing the waves and their checks | add the sixth wave's `replay-small-work.md` v2, checked by `survey-check-11.md` |
| 21, 26 | "Most of a ticket's cost is fixed overhead…"; the cost-mix fixed-part bullet | add: a lean replay's in-session legs paid none of that fixed cost, at 4.1% of the original's session tokens; a lean lane in production is estimated at 5–10% in a lean harness, up to a quarter with today's per-leg habits (`replay-small-work.md` v2) |
| 33 | "implementation is about a quarter of the tokens" | add: an in-session replay's implementer cost 6.3% of the original's implementation sessions at the same tier, so the weight is in the legs' harness and habits, not the model |
| 86 | "…the process is not lighter on it today. The most a lighter process could save is what the light groups cost now: 13–18%…" | stands; add: a lean pipeline replayed on 13 M3-light tickets cost 5–10% of their sessions once chores are priced, so the light groups' cost is close to the whole of what a lean lane could save |
| after 124 | (no point) | new point 24: "**A lean pipeline on small work is much cheaper; whether it is as correct is not known.** One implementer, review and close-out, replayed in-session on 13 small low-risk tickets, cost 4.1% of the originals' session tokens (5–10% with chores priced, up to a quarter with today's habits). It missed the same faults where it was told to or could. Without the descriptions' hindsight it did worse on two of four. (`replay-small-work.md` v2, `survey-check-11.md`)" |
| 130 | "Proportionality is a real but smaller lever…" | stands; add: a lean lane on M3-light work is about 1.1× (`replay-small-work.md` v2 Option 1) |
| 134 | "Review's value is concentrated…" | stands; add: in the replay, three of five known faults passed every review, lean or full |
| 135 | "What a session reads before it acts is a lever of a few percent…" | stands; add: one fleet leg's orientation (77k bootstrap, 115k before a fresh review's first decision) exceeds a whole in-session replay leg (20–56k) |
| 176 (row 7) | "Size the process to the change…" evidence and saving | add the replay as evidence; the saving at 8–12% of tokens on M3-light work; the risk: a forward trial is needed, since correctness without hindsight is unmeasured |
| after 186 | (no row) | row 17: "**Lighter legs everywhere:** fewer tracker reads and writes per leg, prompt and brief passed inline" (`replay-small-work.md` v2 Option 2): about 14.6% of tokens, 1.1–1.2× |
| 190 | "From the fifth wave: 13–16…" | add "From the sixth wave: 17, and row 7's evidence" |
| 192 | "Proportionality: 7 and 8…" | add: the lean replay sizes a lean lane at about 1.1× |
| 208 | "Every paper cited here has been checked by a second document…" | would be false after a fold-in until `survey-check-11.md` is cited: add it |
| after 245 | (last evidence row) | rows for `replay-small-work` (v2) and `survey-check-11` |

Unchanged and confirmed:
- Line 133, "Choosing cheaper models is not the lever". Part of the replay's gap is review and
  close-out at the mid tier. That is a harness difference, not evidence for tier choice.
- Line 260's plan for a pre-registered replay. It was pre-registered as planned.

## Method

The author's git-ignored snapshots were copied into this checkout's own git-ignored `data/` and
re-run there. The LIN-3189 workspace was read only. Replay heads were read from its object store
with `git archive`. Transcripts were read from `~/.claude/projects`.

```sh
node scripts/survey-proportional-classifiers.mjs --out <scratch>/features.json   # 1,337 rows, identical light flags
node scripts/survey-replay-select.mjs                                            # 75 / 74 / the same 13
node scripts/survey-costmix-tokens.mjs --since 2026-08-01 --until 2026-10-01     # 1,988 sessions, identical
node scripts/survey-replay-cost.mjs --subagents <LIN-3189 subagents>             # identical
node scripts/survey-replay-chores.mjs                                            # identical (50 sessions)
node scripts/survey-replay-analyse.mjs --subagents <LIN-3189 subagents>          # identical but for its first line
node scripts/survey-replay-fences.mjs --subagents <LIN-3189 subagents>           # 327; 4; 4; 0 — byte for byte
node scripts/survey-check-11.mjs --subagents <this session's subagents> --orig-subagents <LIN-3189 subagents>
```

- **Pre-registration timing** comes from the orchestrator's transcript and GitHub's commit and
  branch-activity APIs.
- **Deviations.** Every rule in the pre-registration was compared with what the orchestrator and
  its 66 roles did, read from their transcripts and from the 66 prompt files.
- **Fences.** All 559 role tool calls were scanned by hand-written patterns:
  - git beyond HEAD, remotes and `gh`;
  - HTTP, the proxy and the harbour tool;
  - paths outside the role's worktree;
  - Agent spawns.
- **Costs** use `survey-costmix-tokens.mjs`'s weights unchanged. The add-backs are:
  - **A.** The chore tokens the originals' own implementation, review and close-out legs spent,
    as spent and re-priced at mid.
  - **B.** The 251 fleet close-outs that merged, checked CI and wrote to the proxy, taking the
    cheapest and the 10th percentile, re-priced at mid.
  - **C.** A minimum count of 8–10 chore turns at the replay's and the fleet's tokens a turn.
  - **The orchestrator's pipeline-only share,** 43k a ticket.
- **Hindsight.** Descriptions were recovered from each ticket's earliest fleet transcript (the
  creation POST body, or the first issue or brief read), or for August from the task-snapshot
  archive. Each predates the ticket's first commit.
- **Hindsight-free replays.**
  - **Protocol.** The LIN-3189 protocol was used unchanged: its `PROMPTS` were imported from
    `survey-replay-prepare.mjs`, with mid-tier roles, one review pass and detached worktrees at
    the original parents. Only the ticket text differs.
  - **Isolation.** Both clones' push URLs were set to a non-existent path for the run.
  - **Tests.** Fix tests were run as the paper ran them, on a tree extracted from the replay's
    head.
- **Re-judgement.**
  - **Prompts.** Each reader got LIN-3189's own blind prompt with A and B re-drawn by a seeded
    coin (seed 3191), launched in a seeded random order.
  - **Parent trees** were extracted with `git archive`.
  - **One sentence was added:** never run an interactive command, and stop a test run after two
    minutes.
  - **LIN-2414's reader stalled twice** while copying the tree and applying the diffs (16 and 8
    minutes, with no process running). Both were stopped. A third reader was told to judge by
    reading only, and finished.
  - **Keys** are in `survey-check-11-codes.json`.
- **Browser checks.** LIN-2272's and LIN-2715's Playwright specs were run on each tree, each
  server on its own port.
- **Proxy.** This session made four reads: the dispatch item, the brief, the ticket and the
  instructions. The descriptions helper made three task-snapshot reads. The writes were this
  ticket's comment and status, and nothing else.

## Limits

- **Four hindsight-free replays is a small sample.** It can show that hindsight moved verdicts
  and that faults recur without it. It cannot size either effect. *Bias:* the four were chosen
  where the pre and final texts differ most, so they likely overstate hindsight's average effect
  on the 13.
- **The hindsight-free blind reads used the final description.** That keeps the paper's standard,
  but the final text carries the research leg's scope. That is part of why LIN-2355's replay is
  judged worse. *Bias:* against the hindsight-free replays, in the way the work would have been
  judged at merge.
- **Every reader shares a tier with the authors.** The re-judgement used the same tier and prompt
  as the paper's reads, so a shared reader taste is not ruled out. It is a replication, not an
  independent standard. The readers also re-ran tests, so many of their reasons can be checked.
- **The final descriptions leak into the blind reads.** One of LIN-3189's swapped readers on
  LIN-2702 cited "the same size as the shipped change recorded in the ticket", and this check's
  LIN-2715 reader saw the Shipped note. *Bias:* towards the original wherever a description says
  what shipped.
- **The role sessions may have loaded the live clone's current `CLAUDE.md`** as their working
  directory's. That holds for both LIN-3189's roles and this check's. Transcripts do not record
  it. *Bias:* unknown, and small.
- **The data are the authors' snapshots,** re-run, not re-collected. Only the cut was checked
  for drift.
- **The anchor may move.** The lines are listed at `066232d6`. A later edit shifts them.

## Next

- **A forward trial of the lean lane is the only measure of its correctness.** It should run in
  the fleet's own harness, on new M3-light tickets, from the description as filed, with PR, CI
  and tracker chores included and escapes counted at 30 days. The replay cannot answer it, with
  or without hindsight. This goes into `proposals.md`.
- **Which part of a fleet leg's weight is the harness, and which is the work?** A lean
  in-session leg costs 20–56k. A fleet leg spends more than that orienting. One fleet leg replayed
  with the fleet's prompt but no tracker, beside an in-session leg with the fleet's prompt, would
  split the ~10× leg-weight factor this check could not split.
- The paper's own Next items stand, with its figures as corrected in version 2.
