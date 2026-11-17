# Key: LIN-4446, second plan-review (started 2026-11-13T14:31:06Z)

State at that moment: three comments (Survey open-0 13:14, Survey global 13:18, Plan Review Verdict 14:27:54). The description has As asked, Size of the move, and the **revised** Implementation Plan (written by the design session dispatched 14:28:30; present in the 14:31:22 snapshot). No PR exists yet.

## 1. What is addressed to this stage to act on?

**Answer:** The revised Implementation Plan, re-reviewed against the last verdict (Request Changes). Mainly: check that blocking finding 1 is fixed. That finding was that `public/workspace-kpis.js` reads `window.CostFormat` during load through Chart.js's synchronous tick callback. The revision answers it with a `DOMContentLoaded` wrap, a restated ordering rule and a Chart-stub witness. Also check that the 8 builder notes are folded in as the Revision note claims.

**Source:** Plan Review Verdict comment 14:27:54 (real/5-plan-review.md); description `## Implementation Plan`, "Plan status" and "Revision note" (real/6-design.md; snapshot 14:31:22).

## 2. What is still open on the task, and whose is each item?

**Answer:**
- Blocking finding 1: the designer says it is answered, but no reviewer has checked it yet. That is this plan-review's job.
- The build of slice 1 (one shared cost formatter, retiring `public/cost-format.js` and its parity test): implementation's. It has not started and there is no PR.
- The 8 non-blocking notes: the builder's, now written into the plan.
- John's read of the first slice's result before any next slice: John's, after the slice lands.

**Source:** Verdict 14:27:54 ("Once finding 1 is folded in … ready to build"); description Done-when and plan step 8.

## 3. What size was the move given, by whom, and does it still hold?

**Answer:** "Just the task": the rule's reading goes into the notes, one cost formatter is shared (retiring its restated copy and parity check), then a pause for John. Cuts: none. Decided by a ruling (John ruled small). It still holds: the first verdict and the revised plan both cite it as why no view is reworked.

**Source:** description `## Size of the move` (real/3-scoping.md); verdict 14:27:54 "How the plan meets what was asked"; revised plan "What this is for".

## 4. Does any approval cover the plan as it now stands?

**Answer:** No. The only verdict, Request Changes at 14:27:54, is on the first plan. The revised plan has no verdict. Its `plan-review due: no` line is the designer's own claim and is not an approval.

**Source:** comments up to 14:31:06 (only one Plan Review Verdict); revised plan "Session fit and review" (real/6-design.md).

## 5. How many findings did the last verdict raise, blocking and non-blocking?

**Answer:** 1 blocking finding and 8 non-blocking builder notes. The revision says all 1 + 8 are folded in.

**Source:** verdict 14:27:54 ("Blocking findings: 1"; "Notes for the builder (not blocking)" 1–8); Revision note.

## 6. Which consumers of `window.CostFormat` does the plan now change in behaviour, and how many renderers must get the shim?

**Answer:** Only `public/workspace-kpis.js` changes in behaviour: its IIFE body runs on `DOMContentLoaded` (step 4). `flight-companion.js`, `observation.js` and `prompt-section.js` get comment edits only. This overturns the first plan's "no change to them". **Six** renderers list `/cost-format.js` and get the shim. The survey brief named 2, the first plan said 5, and review note 1 added `lib/render.js`.

**Source:** verdict 14:27:54 blocking 1 and note 1; revised plan "Which way, and why" (ordering rule) and "Where the behaviour lives" (real/6-design.md).
