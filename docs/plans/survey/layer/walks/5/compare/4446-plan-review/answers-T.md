# Answers: Reader T (ticket), LIN-4446 second plan-review

Read: `ticket.md` (description, size record, revised Implementation Plan, three comments) and `questions.md`. Nothing else.

1. **Addressed to this stage:** the revised Implementation Plan, which answers the first Plan Review Verdict (Request Changes, 14:27). The review has to check that blocking finding 1 is folded in: the `workspace-kpis.js` `DOMContentLoaded` deferral, the ordering rule restated as "including through a callback a library runs synchronously", and the Chart-stub witness. It should also check the 8 builder notes, then give a new verdict. One oddity: the plan's own line says "plan-review due: no" because it was already reviewed once, yet this stage is running anyway.
   *Source:* plan "Plan status" and "Revision note"; Comment 2026-11-13T14:27 "What must change" and its closing line.

2. **Still open, and whose:**
   - The verdict on the revised plan. This stage owns it.
   - Building the slice and opening the PR (docs reading, shared serving, shim, KPI fix, retirements). The builder owns it.
   - John reading the first slice's result before any next slice starts. John owns it.
   - Deferred work that goes to the area note as Waiting: the `common.js` globals and twins, a module-capable client-test loader, and finding out why `observation.js` is so large. These are future slices, with no owner named.

   No John ruling is pending.
   *Source:* Done-when; plan steps 7 and 8; Size record.

3. **Size:** "just the task", with cuts "none", decided by a ruling (John's: "John ruled small"). It still holds. The revision restates it, the first verdict accepted it, and nothing reopens it.
   *Source:* "Size of the move"; plan "What this is for"; the verdict's "How the plan meets what was asked".

4. **Approval covering the plan as it now stands:** no. The only verdict is Request Changes on the earlier version. Its line "once finding 1 is folded in … the plan is ready to build" is conditional and is not an approval of this revision. The plan says HEAD `4b5001ddf` is still `origin/main`, so no landed code makes the review stale. That is the plan's claim, and I can't check the current head.
   *Source:* Comment 14:27; plan "Plan status".

5. **Last verdict's findings:** 1 blocking and 8 non-blocking builder notes, 9 in all.
   *Source:* Comment 14:27 ("Blocking findings: 1"; notes 1–8); the plan's revision note repeats the same counts.

6. **Consumers changed in behaviour:** only `public/workspace-kpis.js`, whose IIFE body now runs on `DOMContentLoaded`. `flight-companion.js`, `observation.js` and `prompt-section.js` get comment edits only. **Renderers that get the shim:** 6 (`lib/render.js`, `render-flight-companion.js`, `render-observation.js`, `render-swipe.js`, `render-task-page.js`, `render-workspace-kpis.js`). The global survey named 2 and the first plan named 5.
   *Source:* plan "Which way" (ordering rule), "Where the behaviour lives"; verdict builder note 1.
