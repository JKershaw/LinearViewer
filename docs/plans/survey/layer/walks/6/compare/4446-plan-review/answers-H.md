# Answers H (ticket plus facts): LIN-4446, second plan-review

Read: `ticket-plus-facts.md` only.

1. **Addressed to this stage:** the revised Implementation Plan, which answers the first Plan Review Verdict (Request Changes). This stage has to check that finding 1 (the `workspace-kpis.js` deferral, the restated ordering rule, the Chart-stub witness) is folded in, and give a fresh verdict. The facts list nothing addressed to the stage directly ("3. Addressed to it: (none)"). They do show verdict-35 as STALE (it rests on plan-28@12, and the plan is now @13), and that stale verdict is what calls for this review. *Source: plan's "Plan status" and "Revision note", facts §3 and §4.* One conflict: the plan says "plan-review due: no", yet this stage is running. I go with the stale verdict. A Request Changes verdict on an older version still needs a verdict on the version that replaced it.

2. **Still open, and whose:**
   - check-17: **John** reads the first slice's result before the next slice starts.
   - finding-14, finding-20, finding-31: **review**. They concern judging "lighter" on logic and commentary counted separately, and the agreed counting method (lines starting `*`, `//` or `/*`, which gives 1,985 of 4,679 non-blank).
   - finding-12: the **area** (area-1). It covers the `common.js` globals and view size, which are kept out of the slice.
   - Area-1 has 8 open items addressed to it in all. I can't list all 8 from what I read.
   - The blocker (finding-34) does not appear as open in the facts' index. The plan says it is folded in, and confirming that is this stage's job.

   *Source: facts §5 and §7, plan step 7.*

3. **Size:** "just the task". The rule's reading goes into the notes, and one cost formatter is shared, retiring `public/cost-format.js` and its parity test. Then a pause for John. Cuts: none. It was decided by a **ruling from John** ("the size is John's call… it's small") and recorded by scoping as decision-26. It **still holds** (the facts say [stands]). *Source: ticket's "Size of the move", facts §4 decision-26.*

4. **Approval covering the current plan:** **None.** The only verdict is verdict-35, which is Request Changes, not an approval. It is also stale: it was given on plan-28@12, and the plan is now @13. *Source: facts §4 "STALE: on plan-28@12, now @13", the Plan Review Verdict comment.*

5. **Findings in the last verdict:** **1 blocking and 8 non-blocking** builder notes. *Source: verdict comment ("Blocking findings: 1", notes 1–8), plan status line.*

6. **Consumers changed in behaviour:** **only `public/workspace-kpis.js`**, whose IIFE body now runs from a `DOMContentLoaded` listener. The other three (`flight-companion.js`, `observation.js`, `prompt-section.js`) get comment edits only. **Six renderers** must get the shim: `lib/render.js`, `render-flight-companion.js`, `render-observation.js`, `render-swipe.js`, `render-task-page.js` and `render-workspace-kpis.js`. *Source: plan "Which way" and "Where the behaviour lives".* The global survey named only two renderers, and the first plan had five. I trust the revised plan's six: it was re-grounded at HEAD, and review note 1 confirms the sixth (`lib/render.js`).
