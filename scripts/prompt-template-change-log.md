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
| 2026-09-04 | *(this change)* | LIN-1873 | handwritten + meta | Generalised the cited-sweep rule into plan and plan-review: a claim of covering a class must cite the reproducible query whose output IS the enumeration (with output and sha), the reviewer re-runs that query rather than searching independently, and a class with no possible sweep is declared as such with its reason. | **down** |

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

2. **The inclusion filter is deliberately wide.** LIN-1662 asks for changes that
   "could plausibly move the ratio", which is a judgement. Rather than make that
   call retrospectively on fourteen commits, this backfill lists **every**
   commit touching either prompt path since the baseline window opened
   (2026-07-26). Over-recording is recoverable by a later reader; the failure
   mode LIN-1662 names is under-recording.

`7f1efdb8` (LIN-1603) is listed with no direction because it is the
**intervention being measured**, not an interruption to the measurement — the
plan-review gate whose effect LIN-1661's read exists to detect. It landed on
the window's opening day and is recorded here for completeness so a reader does
not have to wonder whether it was missed.
