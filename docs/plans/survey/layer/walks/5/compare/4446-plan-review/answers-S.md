# Answers, Reader S (store): LIN-4446, second plan-review

1. **What is addressed to this stage to act on?**
   Nothing open. Brief part 3 says "addressed to you: none". The only record ever sent to plan-review, check-30 (purity rule and no load-time reads of window.CostFormat), was ended `done` by plan-review in round 1 (14:23:57). The work in front of the stage is plan-28@13. It is flagged stale against verdict-35, so it needs a fresh review.
   *Read:* brief part 3; `find --to plan-review` (check-30, state done); `show --task task-9`.

2. **What is still open on the task, and whose is each item?**
   Five open records in task-9:
   - finding-12, to area-1 (common.js globals and view size are kept out of the slice);
   - finding-14, to review ("lighter" judged on logic and comments counted separately);
   - finding-20, to review (a different comment count);
   - finding-31, to review (reproduces 1,985 of 4,679 and names the method);
   - check-17, to John (read the first slice's result before the next slice starts).

   Also live: plan-28@13 (kept, design's); decision-26 stands; verdict-35 stands but is stale. Brief part 5 shows area-1 with 8 open; I did not list those.
   *Read:* `find --in task-9 --state open`; `show --task task-9`; brief parts 4–5.

3. **What size was the move given, by whom, and does it still hold?**
   Small: "just the task". The rule's reading goes into the notes and one cost formatter (lib/cost-format.js) is shared with the browser. This retires public/cost-format.js and its parity check, then the work pauses for John. Cuts: none. Scoping recorded it as decision-26 (v3, 13:18:55), resting on John's ruling in the ask ("the size is John's call, and for this work it's small"). It still holds: state is stands, it is not stale, and plan-28@13 keeps to it (no view rework, which goes to the area note as Waiting).
   *Read:* `get decision-26`; brief part 4; plan-28@13 "Cuts to the ask".

4. **Does any approval cover the plan as it now stands?**
   No. The only verdict is verdict-35, which is request-changes, not an approval. It was given on plan-28@12 and is flagged stale ("on plan-28@12, now @13"). Design revised the plan to @13 at 14:28:32. Plan-28 itself says "plan-review due: no (already reviewed…)", but that is design's own claim. No verdict on @13 exists.
   *Read:* `get verdict-35`; `get plan-28` versions; brief parts 2 and 4.

5. **How many findings did the last verdict raise, blocking and non-blocking?**
   One blocking: finding-34 (workspace-kpis.js reads window.CostFormat at load through Chart.js tick callbacks). Seven non-blocking builder notes: finding-36 to finding-42, all to implementation, added by plan-review at 14:23:50–56. That is 8 new findings in all. Plan-review also revised one existing finding, finding-24 to v3 (a sixth renderer, lib/render.js); it is not a new finding. The verdict's `on` links name only finding-34; the seven notes come from the record times and their authorship by plan-review.
   *Read:* `get verdict-35` (reasoning "One blocker", links); `get finding-34/36…42/24` version histories.

6. **Which consumers of `window.CostFormat` does the plan now change in behaviour, and how many renderers must get the shim?**
   One consumer changes behaviour: public/workspace-kpis.js, whose IIFE body runs from a DOMContentLoaded listener. The other three (flight-companion.js, observation.js, prompt-section.js) get comment edits only. **Six** renderers get the shim: lib/render.js, render-flight-companion.js, render-observation.js, render-swipe.js, render-task-page.js (const SCRIPTS) and render-workspace-kpis.js.
   *Read:* plan-28@13 fields ("Places", step 4) via brief part 2; finding-24@3/4; finding-34.
