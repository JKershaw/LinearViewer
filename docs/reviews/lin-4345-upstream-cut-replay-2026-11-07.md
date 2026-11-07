# The upstream cut rule, replayed on LIN-4085 (7 November 2026)

LIN-4345's done-when, kept open by John's `merge-carry` and `keep-upstream` rulings: "If
LIN-4085's request for 'a full guide' were replayed through this change, its review would judge
against those words, not against the plan." Two review-wording attempts left LIN-4085 at 0/3
(`docs/reviews/lin-4353-lin4085-review-replay-2026-11-07.md`,
`docs/reviews/lin-4345-per-sentence-replay-2026-11-07.md`). This attempt moves upstream, to the
stages that **make** the cut. `DECIDE` now tells every deciding stage that a sentence or clause of
the `## As asked` block not delivered in full is a cut. The stage quotes each cut where it writes
and raises them as one ruling; until the person answers, a cut is not agreed. Scoping loses its
licence to decide what is in and out of scope, and plan's opening lists each cut or says there is
none.

This is evidence for review, not a CI result. A model's judgement is not something CI can test.
The pre-registration (`_evidence-2026-11-07-lin4345-upstream-cut/preregistration.md`), the brief
and the harness were committed and pushed in `dfdbb0a8` at 18:55 UTC, before any run started,
together with the change-log row (expected direction `down`).

## Result

| Stage (LIN-4085 unless named) | OLD (`main` after #2348) | NEW (this branch) |
| -- | -- | -- |
| scoping @ 17:35:35 | **0 of 3** pass (0 cut rulings) | **3 of 3** pass (1 ruling each, `DECISION:` + `BLOCKED:`) |
| plan @ 17:39:57 (old scoping text) | **0 of 3** pass (0 cut rulings) | **3 of 3** pass (1 ruling each, put in the comment, outcome `DONE:`) |
| review link @ 18:19:44, plan replaced by NEW plan r13 | n/a | **3 of 3** pass (Needs Discussion, `DECISION:` + `BLOCKED:`) |
| over-asking control: LIN-998 plan @ 09:14:33 | n/a | **3 of 3** pass (0 cut rulings) |

Superseded for plan by the route re-run below: scored by the `DECISION:` route, the first NEW plan arm was 0 of 3 and NEW2 is 2 of 3, so plan does not show a clean separation; scoping's 3/3 against 0/3 stands.

By the pre-registered reading (only NEW 3/3 against OLD 0/3 on at least one stage counts), this
is a **clean separation on both stages**. On a plan that names the cut, review returns Needs
Discussion every time, because nobody has agreed to the cut. The control raised no ruling on a
ticket whose delivered work met its ask in full.

**What the effect is, precisely.** Every passing run named the same reduction. LIN-4085's
person asked for "essentially a full guide on how to properly configure Harper for whatever
your situation is **without the user needing to follow those steps** as the use uses the agent
having naturally would". On 1 November scoping read that as "The guide's job is to sequence the
human's few clicks, not to remove them": the few-clicks framing, which the pre-registration
counts as naming the reduction. The OLD runs make the same reduction in silence, for example
r01 ("clear about which steps only the human can do"), r11 ("What only a human can do: OAuth
sign-in, the OpenRouter key … and minting the runner key") and r10 ("the agent a guide and
checker while the user does the browser steps"). The NEW runs quote the clause, call it a cut,
recommend accepting it, and leave it to the person.

## Limits: what this does not show

- **No run in either arm named a size limit as a cut.** The cap behind 1 November's 577-word
  guide (the plan's ~4.5 KB) came from scoping putting the guide under the frozen prompt-size
  rule. In this replay, every scoping run that said anything about size, in both arms (r03, r04,
  r09, r10), decided the freeze does not apply to the guide. So the scoping-stage source of the
  cap did not reappear. The plan runs read the old scoping text, which does apply the freeze, and
  all six plan runs, NEW included, kept the guide under new frozen ceilings set to its measured
  size. One NEW run, r13, adds a soft target ("Aim for a guide that renders under about 8 KB")
  without calling it a cut. Whether a guide built from these plans would be thin is not tested
  here.
- **Review did not judge the guide's sufficiency.** All three review-link runs mark the sentence
  "met in part" for the human-steps clause alone. None asks whether the shipped guide is "a full
  guide … for whatever your situation is". The chain now reaches review's verdict through the
  cut that was written down. It still does not catch a guide that is thin with no cut named. This
  matches the two earlier replays: review catches a cut that is written down and misses one that
  is not.
- **"For whatever your situation is", for self-hosters,** is reduced to a README pointer in the
  old scoping text. One NEW plan run (r14) named it as a second cut. Two (r06, r13) argued it is
  "delivery by link, not a cut", which is the stage's own judgement and was not put to the
  person. On this clause the rule worked in 1 run of 3.
- **The plan runs did not use the closing contract's ruling line.** All three NEW plan runs put
  the ruling in their comment ("Until someone answers, these cuts don't count as agreed") and
  ended `DONE:`, because the plan does not depend on the answer. Harbour records a ruling from a
  `DECISION:` line, not from a comment, so live, a plan-stage cut would reach the person only as
  comment text. The NEW scoping runs and every review-link run did use `DECISION:` + `BLOCKED:`.
  The plan said to add no parking rule or format until a replay showed a need. This is the
  nearest thing to such a need, and I record it here for review rather than act on it.
- **The review link replaced only the description's plan.** The code under review is still the
  4f247b68 build of the *old* plan, and the comments still describe the old plan and its
  plan-review. All three reviewers noticed the mismatch and listed plan items as missing. That is
  noise around the verdict, not a cause of it: each run gives the unagreed cut as the reason for
  Needs Discussion and says an answered ruling would turn it into a conditional Approve.
- **n = 3 per cell**, at a ceiling in every cell. This cannot measure a small effect, only the
  clean separation the pre-registration asked for.
- **Isolation.** Each run had its own clone holding history only up to its start commit (one ref;
  no later commit reachable), and its directory had an opaque name (`r01`–`r18`) so that no run
  could read its arm from its path. One review-link run (r16) ran its suites and mutations in
  copies under `scratchpad/r16-work/`, outside its run directory, built from its own clone. It
  read no other run's directory.

## Per run

Cut rulings are counted as cuts named and put to the person; the cut count is in brackets.

| Run | Arm | Outcome | Cut rulings | Scored |
| -- | -- | -- | -- | -- |
| r01 scoping | OLD | DONE | 0 | fail: the human-steps reduction is unnamed |
| r10 scoping | OLD | DONE | 0 | fail: the same; agent-editable settings left out silently |
| r05 scoping | OLD | DONE | 0 | fail: the same ("tell me … which steps I have to do myself") |
| r03 scoping | NEW | DECISION + BLOCKED | 1 (2 cuts) | pass |
| r09 scoping | NEW | DECISION + BLOCKED | 1 (2 cuts) | pass |
| r04 scoping | NEW | DECISION + BLOCKED | 1 (1 cut, two clauses) | pass |
| r02 plan | OLD | DONE | 0 | fail: builds on the few-clicks scope, adds frozen ceilings |
| r11 plan | OLD | DONE | 0 | fail: the same |
| r07 plan | OLD | DONE | 0 | fail: the same |
| r13 plan | NEW | DONE, ruling in comment | 1 (1 cut) | pass (adds an unnamed ~8 KB aim) |
| r14 plan | NEW | DONE, ruling in comment | 1 (2 cuts: human steps, self-host) | pass |
| r06 plan | NEW | DONE, ruling in comment | 1 (1 cut) | pass (calls self-host "delivery by link, not a cut") |
| r16 review | NEW plan r13 | Needs Discussion, DECISION + BLOCKED | 1 | pass |
| r17 review | NEW plan r13 | Needs Discussion, DECISION + BLOCKED | 1 | pass |
| r18 review | NEW plan r13 | Needs Discussion, DECISION + BLOCKED | 1 | pass |
| r15 control | NEW, LIN-998 | DONE | 0 ("Cuts to the ask: none.") | pass |
| r08 control | NEW, LIN-998 | DONE | 0 ("Nothing is cut from the request.") | pass |
| r12 control | NEW, LIN-998 | DONE | 0 ("nothing from the ask is cut") | pass |

On the control, all three runs widened the plan beyond what research had suggested (they also
regenerate out-of-date sections) *because* leaving them manual would cut "populated on section
open". The rule pushed toward delivering the ask in full, not toward asking about it.

## Reading

- **The upstream lever works for the cut that was made at scoping and plan.** Naming moved from
  0/6 to 6/6, and review turned a named, unagreed cut into Needs Discussion 3/3. In the two
  earlier replays, a cut nobody named was approved 6/6.
- **It does not settle the guide's size.** The reduction that made the guide thin was a size
  rule, and no run in any arm treats a size limit as a cut, although `CUT` lists "size limit".
  Plan runs inherit the frozen ceilings from scoping's text and apply them as engineering. If
  review agrees this keeps the done-when open, the next lever is narrow: the frozen-size rule is
  about stage prompt text (CLAUDE.md, `tests/unit/prompt-size-budget.test.js`), and 1 November's
  scoping applied it to a product guide. That is a misreading at its source, separate from the
  cut rule.
- **The done-when, read literally,** is met on this evidence: replayed through this change, the
  review judges against the person's words and returns Needs Discussion rather than approving
  against the plan. Read as "review would catch the thin guide", it is not met: no review run
  assessed the guide's sufficiency. Which reading closes LIN-4345 is John's call. I recommend
  recording it as met for the cut rule and met-in-part for the size reduction.

## Setup

- **Prompts.** `generatePrompt('scoping' | 'plan' | 'review', …)` via `render.mjs`, from a
  worktree at `8198bd40` (OLD) and from this branch (NEW). The OLD and NEW scoping and plan
  prompts differ only in the changed lines (scoping's lead, `DECIDE`, Out of Scope; `DECIDE` and
  plan's opening). The review prompt is byte-identical on both arms and matches #2348's rendered
  review prompt.
- **Tickets** (`build_tickets.py`): Harbour task snapshots, with the filed request sealed into an
  `## As asked` block as #2348's harness does it. LIN-4085 at `2026-11-01T17:35:35.250Z` (1
  comment), `17:39:57.470Z` (3 comments, old scoping's text) and `18:19:44.010Z` (8 comments,
  its `## Implementation Plan` section replaced by r13's `description.md`). LIN-998 at
  `2026-07-04T09:14:33.430Z` (2 comments).
- **Code.** LIN-4085 at `e1f75fe7` (scoping and plan) and `4f247b68` (review, with
  `change.diff`). LIN-998 at `973a8ec7`.
- **Runs.** Each run was a fresh Claude Code subagent (Opus 5.5) with no tracker, GitHub or
  network, given `brief.md` verbatim (the runner's closing contract included), apart from its
  directory and the stage's name. Outputs are in `runs/<id>-<arm>/`; `run-map.tsv` maps the
  opaque ids to arms.

## Route re-run (review finding 1, 7 November)

Review of PR #2351 scored the plan arm 0/3 by the plan's own route, because the three NEW plan
runs left the ruling in their comment and ended `DONE:`. `CUT` now ends "raise them as one
ruling, a `DECISION:` before `BLOCKED:`; unanswered, a cut is not agreed". The plan arm and the
LIN-998 control were run again under that wording.

- **Pre-registration:** `_evidence-2026-11-07-lin4345-upstream-cut/preregistration-route.md`,
  pushed in `45ffebd0` with the change-log row, before any run started.
- **Prompts:** `prompt-4085-plan-new2.md` and `prompt-998-plan-new2.md`. Each differs from the
  first NEW arm's prompt by the 33-byte route clause and nothing else.
- **Inputs, brief and isolation:** as in the first replay. Six fresh Opus 5.5 subagents, run
  directories `r19`–`r24` in shuffled order, each with its own clone holding history only up to
  its start commit (one ref).

### Result

| Stage | First NEW arm (`dfdbb0a8`) | NEW2 (route named) |
| -- | -- | -- |
| LIN-4085 plan: cut named | 3 of 3 | **2 of 3** |
| LIN-4085 plan: cut named **and** `DECISION:` + `BLOCKED:` (review's pass line) | 0 of 3 | **2 of 3** |
| LIN-998 control: no ruling, `DONE:` | 3 of 3 | **3 of 3** |

| Run | Ticket | Outcome | Cut rulings | Scored |
| -- | -- | -- | -- | -- |
| r20 plan | LIN-4085 | `DECISION:` + `BLOCKED:` | 1 (2 cuts: the human clicks; Harbour's settings, which no agent-API route exposes) | pass |
| r21 plan | LIN-4085 | `DECISION:` + `BLOCKED:` | 1 (1 cut: the human clicks) | pass |
| r23 plan | LIN-4085 | `DONE:` | 0 ("Cuts to the `## As asked` block: None.") | **fail**: it quotes the human-steps clause and judges it delivered in full |
| r19 control | LIN-998 | `DONE:` | 0 ("Nothing in the request is cut.") | pass |
| r22 control | LIN-998 | `DONE:` | 0 ("Cuts: none.") | pass |
| r24 control | LIN-998 | `DONE:` | 0 ("nothing is cut from what was asked") | pass |

**The route works when a cut is named.** Every run that named a cut ended `DECISION:` +
`BLOCKED:`, 2 of 2, against 0 of 3 before. Each ruling quotes the clause, recommends accepting
it, and says the cut is unagreed until answered. Neither plan run put the ruling only in comment
text. On LIN-998, where the delivered work met the ask in full, all three runs ended `DONE:`
with no ruling, as before. Naming the route did not make a stage park on a ticket with nothing
cut.

**Naming the cut fell from 3/3 to 2/3.** r23 quotes "without the user needing to follow those
steps" and argues the clause is delivered in full. In its words: "the person never reads or
follows the guide. The agent reads it and asks for each human action at the moment it is
needed. … Each is a single press the agent asks for, which is 'using the agent naturally'."
The plan keeps the same human clicks as r20 and r21: OAuth sign-in, the person's own key and the
runner-key mint. It calls them no cut. This is the stage's own judgement that a reduction is
not a cut, the same move r06 and r13 made on self-host in the first replay. The route clause
cannot change this, because the route applies only after a cut is named. With n = 3 per arm, 3/3
against 2/3 cannot separate a wording effect from run-to-run variance. Each arm has one
plausible reading that misses.

**Recorded, not scored (feeds `lin4345-attempt2-size-cut`).**
- **Size: named as a cut in 0 of 3 runs again.** All three LIN-4085 plans add frozen
  size ceilings for the guide at its measured size (r20 and r21: "the new size ceilings carry
  their reason"; r23: three ceilings in `prompt-size-budget.test.js`). None names a ceiling as
  a cut to "a full guide". Across both NEW plan arms, size is 0 of 6.
- **Self-host: named as a cut in 0 of 3 runs.**
  - r21 closes the inherited "pointer, not a walkthrough" cut instead of keeping it. It gives
    the guide a self-host path the agent carries out. That is delivery in full, so there is
    nothing to name.
  - r20 and r23 send self-hosters to the README. They argue the README *is* the full guide,
    so the clause is delivered, not cut.

### Reading, by the pre-registered rule

The plan arm is below 3/3, so by `preregistration-route.md` the result is recorded as it is and
returns to review, with no more text added in this pass. Finding 1's route gap is closed for
every cut a stage names: 2 of 2 rulings now reach Harbour as `DECISION:` lines. The control
shows no over-asking: 0 rulings in 3 runs. What remains open is naming, not routing. A plan
can still judge a reduction to be delivery and so name nothing (r23 here; r06 and r13 on
self-host before). The size reduction behind 1 November's thin guide is still named in 0 of 6
NEW plan runs. Whether that keeps LIN-4345 open is John's ruling `lin4345-attempt2-size-cut`.
This re-run gives it one more data point and does not settle it.
