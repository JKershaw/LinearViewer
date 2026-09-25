# Prompt-template change log

Append-only. One row per prompt-template change that could plausibly move the
follow-on ratio.

**Why this exists.** The follow-on-ratio measurement (`scripts/follow-on-ratio.mjs`,
read tracked by LIN-1661) is **not** protected by freezing prompt-template
changes — it is protected by *recording* them, so the read can segment an
interrupted time series instead of assuming a clean one. That is John's ruling
of 2026-08-04 on LIN-1661, which withdrew the informal "no prompt-template
changes before 2026-08-25" freeze; the definitional requirement for this log
lives on **LIN-1662**.

The freeze was withdrawn because it was not buying what it cost: the primary
instrument was already flagged `sufficient: false` at its baseline (n=30), and
the window was already contaminated by LIN-1859 landing mid-window on
2026-08-03 — while the freeze itself was blocking five tickets.

**Placement.** Single file, append-only, next to the instrument — readable by
whoever runs `scripts/follow-on-ratio.mjs`. LIN-1662 fixes that requirement and
leaves the exact path an implementation choice.

## Columns

| Column | Why it is here |
| --- | --- |
| **Date (UTC)** | Segments the series. |
| **Commit** | Makes the claim checkable at HEAD. |
| **Ticket** | Attribution. |
| **Paths** | `handwritten` (`lib/prompt-template-defs.js`) and `meta` (`lib/prompts/meta-prompt-template.js`) are named **separately**, because they can move independently. |
| **Change** | One line, so a reader knows what moved without reading the diff. |
| **Expected direction** | `up` / `down` / `unknown`, recorded **before** the read. |

**On the last column, which is the one most likely to be dropped as
bureaucratic.** It is what makes this a piece of evidence rather than a
changelog: a direction recorded before the number arrives cannot be
rationalised after it does. `unknown` is a legitimate, common, and honest
value — it is not a failure to think, and guessing a direction to avoid writing
it would defeat the column's whole purpose.

## Rows

Newest last.

| Date (UTC) | Commit | Ticket | Paths | Change | Expected direction |
| --- | --- | --- | --- | --- | --- |
| 2026-07-26 | `56bf3cd0` | LIN-1579 | handwritten + meta | Widened the proportional lane on what review can name (monitor / rollback routes out of the hard-gate class). | unknown (backfilled) |
| 2026-07-26 | `a88c2cf7` | LIN-1602 | handwritten + meta | Added the `plan-review` prompt template and registered it. | *(baseline — see note below)* |
| 2026-07-26 | `7f1efdb8` | LIN-1603 | handwritten + meta | The plan-review gate itself: its routing branch, the one-revision-cycle loop bound, and the eval. | *(baseline — see note below)* |
| 2026-08-01 | `7814cec5` | LIN-1770 | handwritten + meta | close-out archives and prunes stage artifacts; a plan revision replaces the prior plan block rather than appending beside it. | unknown (backfilled) |
| 2026-08-01 | `da3790e7` | LIN-1772 | handwritten + meta | Added the missing archive-verification failure branch to close-out's Archive & Prune. | unknown (backfilled) |
| 2026-08-01 | `e4ad28d1` | LIN-1773 | handwritten + meta | Aligned the close-out catalog/aiHint and meta-prompt text with archive & prune. | unknown (backfilled) |
| 2026-08-03 | `b6c5e046` | LIN-1859 | handwritten + meta | Added a 7th plan-review check — source-of-truth re-grounding. | unknown (backfilled) |
| 2026-08-09 | `5a0b7210` | LIN-1455 | handwritten + meta | Capability-gated the CI/checks precondition instead of asserting it unconditionally. | unknown (backfilled) |
| 2026-08-22 | `8bb1f10a` | LIN-2202 | handwritten + meta | Extended the Principle 0 gate and ruling format to the worker task templates. | unknown (backfilled) |
| 2026-08-22 | `4b926b03` | LIN-2219 | handwritten + meta | Added acceptance-witness discipline to the implementation guidelines. | unknown (backfilled) |
| 2026-08-24 | `229992c8` | LIN-2261 | handwritten + meta | Added the retrospective-audit prompt template (a new registered kind). | unknown (backfilled) |
| 2026-08-24 | `a954dc0c` | LIN-2274 / LIN-2303 | handwritten + meta | Institutionalised the reviewer-side mutation check and pinned it on both paths. | unknown (backfilled) |
| 2026-08-25 | `6692c3b2` | LIN-2309 | handwritten + meta | close-out follow-ups now carry a priority and a type label. | unknown (backfilled) |
| 2026-08-25 | `842db225` | LIN-2311 | handwritten + meta | Dropped the native priority field from the Follow-up Triage instruction. | unknown (backfilled) |
| 2026-08-25 | `3c573ac6` | LIN-2316 | handwritten | Annotated triage's displayed priority; named `priorityLevel` as the sole write field. | unknown (backfilled) |
| 2026-08-25 | `b5235e9e` | LIN-2317 | handwritten + meta | Named `priorityLevel` in the meta-prompt triage path; annotated canonical 0. | unknown (backfilled) |
| 2026-09-04 | `d8152ee8` | LIN-1873 | handwritten + meta | Generalised the cited-sweep rule into plan and plan-review: a claim of covering a class must cite the reproducible query whose output IS the enumeration (with output and sha), the reviewer re-runs that query rather than searching independently, and a class with no possible sweep is declared as such with its reason. | **down** |
| 2026-09-05 | PR #1403 | LIN-2618 | neither (lib/prompts/flight-companion-brief.js) | Extracted the Flight Companion's persona, disposition, readout shape, fossil-row instruction, surfacing policy, vocabulary and propose-then-wait gate into one shared brief rendered by BOTH the pasted kickoff and the in-page chat's system turn; the chat additionally gained the clock, the turn kind and the headline-block-plus-six-part readout it previously had none of. | unknown |
| 2026-09-12 | PR #1456 | LIN-2804 | neither (`lib/proxy-preamble.js`, `lib/prompts/autopilot-kickoff.js`) | Gated the auto-appended proxy preamble's and the autopilot kickoff's `/issues/{id}`/`/relations` endpoint hints on the resolved provider's `issueDetail`/`relations` capability (new `provider.ui.issueDetail`/`.relations` flags) instead of advertising them unconditionally; GitHub/GitHub-Projects/Jira workspaces now see a `brief`+`/search`-based hint instead of a hint that 422s. Linear/Local output is byte-identical. **Review round 2 (Finding 1):** the `/search` fallback was itself an unconditional hint that 422s on GitHub Projects/Jira (neither supports `search`); added a third derived flag, `provider.ui.search`, and gated every `/search` mention on it too, so those two providers now see a brief-only fallback with no read hint that 422s. | **up** |
| 2026-09-12 | PR #1459 | LIN-1871 | handwritten + meta | Revised the LIN-1873 cited-sweep rule into class-not-member enumeration, extended to a third template: research now names each class and how it bounded it, plan works from research's classes and is sent back only for a missing class (never a missing member inside a class already bounded), and plan-review argues the class a missing member belongs to rather than stopping at the member. | **down** |
| 2026-09-12 | PR #1467 | LIN-2825 | handwritten + meta | Review marks every class-check instance and ledger item inside/outside the ticket's bounded classes (LIN-1871); close-out's Ledger Gate now discharges an inside item only by cited evidence of done or an explicit drop, never by filing a follow-up ticket for it, and Follow-up Triage is restricted to outside items and explicitly-dropped inside items. | **down** |
| 2026-09-18 | PR #1505 | LIN-2923 | handwritten | Corrected the close-out's stale "no comment-edit endpoint" claim: comments are untouched by policy (the prune is a description edit only), and the existing `PATCH /api/proxy/issues/:issueId/comments/:commentId` route is now acknowledged rather than denied. Meta twin never carried the claim; left unchanged. | unknown |
| 2026-09-18 | PR #1506 | LIN-2917 | handwritten + meta | A routed follow-up ticket is no longer a monitor: struck "a routed follow-up ticket that owns the watch" from the named-monitor list on both the review and close-out sides of both paths, leaving a ticket citable *beside* a monitor but never as one; and turned the misfire guard from prose into a required step — review writes one line naming why no check short of production could prove the claim, and close-out rejects an unprovable-lane entry missing that line as undischarged. | **down** |
| 2026-09-21 | PR #1533 | LIN-2973 | handwritten + meta | The Principle 0 gate was asserted by name in every worker path but defined nowhere a worker could reach it; stated the one-sentence test (plus its positive half) inline in the manual's hand-back section, and composed it into `formatIfBlocked()`, the `blocked` template, and their meta-prompt mirrors via a new narrow extractor, so a bare pointer no longer strands the consumer. | unknown |
| 2026-09-22 | PR #1545 | LIN-2977 | meta | Closed the LIN-2973 follow-up: the meta path's three Principle 0 quality-rule bullets hand-copied the test sentence instead of composing `extractPrincipleZeroTest()` as the handwritten path already did, so a manual reword left all 5 meta-path assertions green while the same reword correctly failed the handwritten path. `buildMetaPromptTemplate()` now computes the extractor's output once and substitutes the flattened value at all 3 sites. Handwritten path (`lib/prompt-formatters.js`, `lib/prompt-template-defs.js`) unchanged. | unknown |
| 2026-09-24 | PR #1554 | LIN-3006 | handwritten + meta (plus neither: `docs/passage-planner-prompt.md`, `docs/worker-lane-prompt.md`, `docs/autopilot-operating-manual.md`) | Amends LIN-2825: inside is now defined by kind (same defect/idiom), not by research's enumerated list; removed the drop-then-file route in close-out's Follow-up Triage; added a materiality bar to the drop route; limited ruling options to file-only-for-outside; stopped the passage planner from pre-scheduling follow-up filings in a leg's exclusions; extended the same rule to the worker lane. | **down** |
| 2026-09-25 | PR #1578 | LIN-3033 | handwritten + meta (plus neither: `docs/worker-lane-prompt.md`, `docs/autopilot-operating-manual.md`, `docs/architecture/prompt-system.md`, `lib/completion-signals.js`) | Bounds close-out's own authoring: it may write a change itself only when review named it with its exact content and it is trivially small (at most 2 files/3 hunks, no new or changed test/function/branch/condition/control flow — an update to an existing review-quoted literal/expected-string pin is allowed), whatever prompted it — a ledger item, a conditional-Approve caveat, a non-gating review finding, a self-found sibling, a close-out-raised "do it here" ruling, or a merge-conflict resolution while landing the PR (a conflict-free merge/rebase stays ordinary mechanics, not authoring); anything else holds the merge and routes back to `implementation` then `review`. Expected direction: **down** on unreviewed content merged at close-out, **up** on implementation/review round trips. | **down / up** |
| 2026-09-25 | PR #1579 | LIN-3049 | handwritten + meta | Breakdown-created subtasks of an approved plan now carry their own copied plan slice, a committed session-fit answer, and `Plan-review due: no` citing the parent's approving verdict (both prompt paths), gated on the decomposed ticket's OWN comment trail — not its rendered Parent Task section — actually carrying a recorded `### Plan Review Verdict: Approve` for the plan being decomposed (F4); a breakdown child whose decomposed ticket carries no such Approve still gets a plain acceptance-criteria description on both paths (no false session-fit or plan-review-due claim). The meta-prompt's Step 1 over-fire guard, completed-prep rule, and gate now recognize a qualifying copied slice as completed prep via three new, narrowly-scoped sentences outside the (a)-(d) criteria text (though the gate addition narrows when criterion (d) re-fires for this population — see the gate record in the LIN-3049 description). All three guards withhold that recognition when the copied slice visibly diverges from what the cited approving verdict approved, so a stale/diverged slice re-derives instead of routing to `implementation` (R1). A new `Breakdown prompts` quality rule mandates the same precondition and copy on the AI path. Expected direction: **down** on plan/plan-review sessions per breakdown-created subtask (the primary signal this ticket exists to move). Note `follow-on-ratio`'s `PLAN_MARKER` diagnostic (description-only "fits one session" match) may tick up harmlessly on these subtasks — a diagnostic-only field, not the ratio's numerator/denominator. Note also that `meta-prompt.baseline.txt`'s regen diff includes ~22+/10− lines of pre-existing drift unrelated to this change (present at HEAD before any LIN-3049 edit; last regenerated at LIN-1455) — do not attribute the full diff to this ticket. Timing: the LIN-1871 plan-gate re-read that the plan's timing section protected already RAN on 2026-09-25 (LIN-2924 `a814fadd`, window closed 09-25 07:00Z), one day early and before LIN-3049 was filed, so no exempted child can enter that sample; no tag-or-exclude instruction is owed. Commit SHA to be filled at merge (per this log's rule: cite the squash-merge commit on `main`, never a branch head). | **down** |

### On the LIN-2917 row's `down`, recorded before the read

**Expected direction: down.** A routed-follow-up-ticket-as-monitor discharge was
sometimes itself the mechanism that *filed* a follow-up ticket — the ledger item
discharged by naming a ticket that then had to exist. Removing that discharge route
removes one source of such filings, so the follow-on ratio should fall.

**The honest counter, recorded now rather than after the read.** Some claims that
previously took the lane will fall back into the hard-gate class, because no monitor
that actually fires can be named for them. That raises Request-Changes round-trips on
the *review* side of a single ticket — a real within-ticket cost that the follow-on-ratio
instrument counts generated tickets, not review rounds, and so may not register in
either direction. If the ratio does not move, that is not by itself evidence the change
did nothing; the cost and the benefit land on axes the instrument reads differently.

**The `Commit` cell names PR #1506 rather than a sha**, for the reason the LIN-2618 note
below already gives: the merge sha does not exist until the runner merges, and it cannot
be self-referenced from inside the commit that would carry it.

### On the LIN-2618 row, and why its Paths cell reads `neither`

Recorded by analogy, not by the two-path rule. The Flight Companion brief is not
a registered template: there is no `flight`/`companion` entry in
`lib/prompt-template-defs.js`, `lib/prompt-templates.js` or
`lib/completion-signals.js`, and the `Paths` column above admits only
`handwritten` and `meta`. So neither path moved, no meta-prompt edit was owed,
and the row as the column is specified could not be filled.

**On "seven-part".** LIN-2618's description calls the body seven-part while its
own enumeration lists six, and its acceptance asks for "the seven body
headings". The implementation follows the enumeration — a mandatory headline
block plus six body parts, seven sections in all — because the enumeration is
the substance and the count word is a slip. Whoever scores the LIN-2634
agent-graded side-by-side should grade against the six enumerated parts plus the
headline block, not hunt for a seventh body heading that was never specified.

**On the `Commit` cell.** It names the PR rather than a sha. A sha cannot be
self-referenced from inside the commit that would carry it, and the merge sha
does not exist until the runner merges — the earlier rows carry merge shas
because they were backfilled after landing. The PR is checkable at HEAD in the
same way and is knowable now; whoever next appends here can swap it for the
merge sha if they prefer the uniformity.

It is recorded anyway because the pasted kickoff **drives real dispatches** — a
session running that prompt does the same class of work a registered template's
session does, so a change to it can move the same series. The in-page chat half
cannot: every write on that surface is propose-only, executed by a human tap.

**Direction `unknown`, and the reasoning written before the read.** The honest
answer is that this cuts both ways and I cannot pick between them. Giving the
chat the readout shape and the propose-then-wait gate it never had should reduce
the follow-on turns spent asking it to say something useful. But the same change
gives the pasted kickoff a longer, more prescriptive brief, and a more
prescriptive brief can produce more proposals to accept or reject. `unknown` is
the honest value here rather than a failure to think — guessing a direction to
avoid writing it is what this column exists to prevent.

### On the LIN-1873 row's direction, recorded before the read

**`down`**, and the reasoning is written here so it can be judged rather than
taken: the rule exists to stop the plan → plan-review → plan loop cycling on
disputed enumerations. LIN-1871 measured four tickets each sitting at that step
through 4+ agent sessions with **zero commits between them**, and in every case
the convergent query was cheap and already discoverable — on LIN-1717 the
reviewer had even written it down and the plan simply never cited it. If the
rule works, plan-review rounds per ticket fall, which lowers the follow-on
ratio.

The honest counter-argument, recorded now rather than after the number lands:
this could push the ratio **up** instead. Requiring a cited sweep gives a
reviewer a concrete new thing to reject a plan for, and a plan that would
previously have passed on a hand-list may now come back as Request Changes for
a missing or mismatched sweep. That would be a *quality* win and a *ratio* loss,
and the two are not distinguishable in this metric.

I am recording `down` because the loop-shortening effect is the one the four
measured cases actually exhibit, and the rejection effect is speculative. If the
read comes back up, that counter-argument is the first thing to check — not a
post-hoc explanation invented to fit the number.

### On the LIN-1871 row's direction, recorded before the read

**`down`**, per John's own ruling on the ticket: "expected direction `down` on
plan-review rounds per ticket." The reasoning, restated here so it can be
judged: `docs/papers/harbour/review-loops.md` (LIN-2800) measured that the LIN-1873
row above did NOT deliver the loop-shortening effect its own recorded `down`
predicted — 33 of 94 tickets still went round plan-review two or more times,
and the send-back rule that change left in place still let a reviewer stop at
one missing member rather than the whole class, so the plan → plan-review →
plan loop could still cycle one member at a time. This change targets that
specific gap: a plan is now sent back only for a missing or wrongly-bounded
class, never for a missing member inside a class already correctly bounded,
which should shorten exactly the cycle LIN-1873 did not.

The same honest counter-argument as the LIN-1873 row applies again, and is not
weaker for having been wrong once already: naming the class-not-member rule
gives a reviewer a new, sharper thing to send a plan back for, and some plans
that would have passed on a narrower member-level finding may now come back
Request Changes for an unbounded or wrongly-bounded class. If this read also
comes back `up` or flat, the question is the same one LIN-1873's did not get
asked in time: is the rule producing a quality win that this ratio cannot see,
or is the mechanism itself not the lever the round count responds to.

### On the LIN-2825 row's direction, recorded before the read

**`down`**, per the ticket's own stated expectation: "expected direction `down` on
tickets filed per close-out." `harbour/tasks-generate-tasks.md` measured close-out
follow-ups as 1.95 tickets per generating ticket and 74% never worked;
`harbour/never-worked-pile.md` found 23 of 40 sampled never-worked filings were
the parent's own unfinished scope; `harbour/close-out-claims.md` found every one
of those 23 close-outs named the filing and closed anyway, with the filing itself
what discharged the ledger item. This change removes that discharge route for an
inside-scope item — the close-out that used to file and close now has to finish
the work or write an explicit drop instead — so the direct prediction is fewer
close-out-generated tickets, which is exactly what `scripts/follow-on-ratio.mjs`
would read as `down`.

The honest counter-argument: a close-out that can no longer file its way past an
inside item may instead reach for an explicit drop more freely than it used to
file, which is a wording change this ratio cannot distinguish from real work
getting done. It could also simply take longer per ticket without changing how
many follow-up tickets get created, in which case this read moves the ratio not
at all. If the read comes back flat or `up`, that is the first thing to check —
not a post-hoc explanation invented to fit the number.

### On the backfilled rows

Every row above except LIN-1873's is a **backfill**, added when this file was
created on 2026-09-04. LIN-1662's ruling requires the backfill explicitly and
names why: *"A log that starts empty at the moment of writing understates the
interruptions and is worse than no log — it would present a contaminated window
as clean, with the authority of a record."*

Two honesty notes about what a backfilled row is worth:

1. **A backfilled direction is weaker evidence than a recorded one.** The whole
   point of the direction column is that it is written before the number
   arrives; for these rows that is no longer possible, so they are all recorded
   as `unknown` rather than reconstructed. Guessing a direction retrospectively
   would be exactly the rationalisation the column exists to prevent, and it
   would look identical to a real prediction in the table.

2. **The inclusion filter is deliberately wide, and here is the sweep.**
   LIN-1662 asks for changes that "could plausibly move the ratio", which is a
   judgement. Rather than make that call retrospectively, this backfill lists
   **every** commit touching either prompt path since the baseline window
   opened. Over-recording is recoverable by a later reader; the failure mode
   LIN-1662 names is under-recording.

   ```
   git log --since="2026-07-26T00:00:00+00:00" --format="%h|%ad|%s" --date=short --reverse \
     -- lib/prompt-template-defs.js lib/prompts/meta-prompt-template.js
   ```

   Run at `a518422e`: **17 commits**, which are the rows above including
   LIN-1873's own. LIN-1873 then landed two rounds of review fixes over the
   same two paths; they are the same change as the row above, not new
   interruptions.

   **A row must cite a sha that is on `main`.** This repo squash-merges, so
   every branch commit is discarded at merge and a row citing one is
   unresolvable the moment it lands — which defeats the column whose stated
   purpose is "makes the claim checkable at HEAD". The LIN-1873 row first cited
   its branch head `76911b8b`; that sha does not exist on `main` and the row is
   now corrected to the squash commit `d8152ee8`. Cite the MERGE commit, not
   the work.

   **Note the explicit timestamp, because the obvious form of this query is
   wrong.** `--since=2026-07-26` uses git's *approxidate*, which resolves a bare
   date to that date **at the current time of day** — so run in the evening it
   silently drops every commit from earlier in the window's first day. The first
   version of this log was built that way and lost exactly two rows: `56bf3cd0`
   and `a88c2cf7`, the second of which *creates the plan-review step being
   measured*. Review caught it.

   That is this ticket's own rule paying out on this ticket's own artifact: a
   cited sweep is re-runnable and therefore checkable, and a hand-list is not.
   The query is recorded here so the next person appending a row extends a
   verifiable enumeration rather than trusting this one.

`7f1efdb8` (LIN-1603) and `a88c2cf7` (LIN-1602) are listed with no direction
because they are the **intervention being measured**, not interruptions to the
measurement — LIN-1602 adds the plan-review template and LIN-1603 adds the gate
that routes to it, which is precisely the effect LIN-1661's read exists to
detect. Both landed on the window's opening day and are recorded here so a
reader does not have to wonder whether they were missed.
