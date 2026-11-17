# Answers, Reader S (store): LIN-4446 (task-9), second plan-review

Read: `brief.txt`, `questions.md`, `model/BUILD-NOTES.md`; queried `store.json` with `layer.mjs` (`show --task task-9`, `find --to plan-review`, `find --state open --in task-9`, `find --kind verdict`, `find --kind approval`, `get` on finding-24/34/36–42, check-30), all `--by plan-review`.

1. **Addressed to this stage:** nothing open. The only record ever `to: plan-review` is check-30 (check the purity rule and load-time reads), and plan-review itself closed it as done at 14:23:57. What the stage has to act on is the revised plan, plan-28 v13 (design, 14:28:32). Design revised it to answer verdict-35 and wrote "plan-review due: no". verdict-35 is now stale against it.
   *Source:* brief §3 "(none)"; `find --to plan-review` gives check-30 only, state done; brief §2 and §4; run-43.

2. **Open on the task:**
   - finding-12 (common.js globals and view size, kept out of the slice) is addressed to area-1.
   - finding-14, finding-20 and finding-31 (how "lighter" and the observation.js comment lines are counted) are addressed to review.
   - check-17 (read the first slice's result before the next starts) is addressed to John.
   - plan-28 (state kept) is the piece.
   - verdict-35 still stands but is stale.
   - Every other finding (11, 13, 15, 16, 22–25, 29, 34, 36–42) has been handed on into plan-28.
   *Source:* `find --state open --in task-9`; `show --task task-9`.

3. **Size:** "Just the task". The rule's reading goes into the notes, one cost formatter (lib/cost-format.js) is shared with the browser, its restated copy public/cost-format.js and its parity test are retired, and then the work pauses for John. Cuts: none. This was John's ruling, given in the ask ("the size is John's call… small"). Scoping recorded it as decision-26 v3. It still holds: state stands, and plan-28 v13 builds on decision-26@3.
   *Source:* brief §4 decision-26; plan-28 `on`.

4. **Approval of the plan as it now stands:** none. The only verdict, verdict-35 (plan-review, 14:23:48), was request-changes, and it is pinned to plan-28@12. The plan is now @13, so the verdict is stale. There is no approval record at all. verdict-35 did say the plan would be "ready to build" once the deferral, the restated rule and the Chart-stub witness were in, but that is a condition, not an approval of v13.
   *Source:* `find --kind verdict` (stale "on plan-28@12, now @13"); `find --kind approval` returns [].

5. **Findings in the last verdict:** 9 in all, 1 blocking and 8 non-blocking.
   - Blocking: finding-34 (workspace-kpis.js reads window.CostFormat at load through Chart.js tick callbacks).
   - Non-blocking builder notes: findings 36 to 42 (7 new records, added at 14:23:50 to 14:23:56), plus plan-review's revision of finding-24 to v3 (a sixth renderer, lib/render.js:384).
   - The plan's revision note says the same: "1 blocking finding, 8 builder notes".
   *Source:* `get` version histories (each v1 is by plan-review at 14:23:47 to 14:23:56); run-43 revision note.

6. **Consumers and renderers:**
   - Only public/workspace-kpis.js changes in behaviour: its IIFE body now runs from a DOMContentLoaded listener.
   - flight-companion.js, observation.js and prompt-section.js get comment edits only.
   - **Six** renderers must get the shim: lib/render.js:384, render-flight-companion.js:400, render-observation.js:366, render-swipe.js:149, render-task-page.js:82 (as `const SCRIPTS`) and render-workspace-kpis.js:226.
   *Source:* brief §2 plan-28 "Places" and step 4; finding-24 v3/v4.
