# Answers S (store): LIN-4469 close-out, as of 2026-11-13T23:26:58Z

1. **Addressed to close-out:** eight open items, all on PR #2447 (change-142):
   - finding-166: review Fix 1, before merge. Drop the hand-typed "(no path is written here)" from seams-tangles' first runReview bullet. Re-pin both seams-tangles hashes. Update the change-log row and the PR body's Measured and DECISION sections.
   - finding-167: review Fix 2. Delete the stray "(396821 -> 396571)…" fragment in the budget test's comment.
   - check-168: after Fix 1, re-run the base-vs-head real-context render.
   - finding-153: on merge, revise lesson-10's "import-free leaf" wording.
   - finding-173 to finding-176: from the blind read. Make the folds test assert `=== 0`. Give `committedSearch` an optional tail and drop the `.slice`. Correct the lin-4313 test header. Fix the `source-map.md` leftover-words line.

   check-148 (to review) also shows as addressed. Read: brief part 3; `find --in task-131 --state open`.

2. **Still open on the task, and whose:**
   - change-142 (PR #2447, open, head 877f32cb4).
   - The eight close-out items in answer 1.
   - check-148, review's: the undersized/oversized check.
   - check-155, John's: after deploy, a look-into comment POST and a triage PATCH must each get 403.
   - finding-147, area-1's: look-first was skipped.

   The blind read also left open finds addressed to areas, not to this task's stages: finding-177 and finding-179 (area-1), finding-178 and finding-180 (area-65). question-159 is withdrawn, not open. Read: `find --in task-131 --state open`; `find --text` for each blind-read find.

3. **No, it no longer holds.** Review withdrew question-159 (ruling lin-4469-witness) as moot at 23:17Z; John never answered it. Reasons:
   - A kind that carries no folded text cannot fall, and review reads "net" as net across kinds.
   - The seams-tangles +24 is self-inflicted, and Fix 1 (finding-166) removes it.

   Merge now waits on close-out discharging review's ledger, not on John. Read: `get question-159` (v3, end reason); verdict-169.

4. **No approval covers the current head, 877f32cb4.**
   - Review's verdict-169 (approve-with-notes) was given at 05b592742 (change-142@2). The brief marks it STALE: the leftover tidies moved the head to @3. It was also conditional on close-out discharging the ledger.
   - The blind read's verdict-172 ("better") is on change-142@3 (877f32cb4), but it is an area-quality verdict, not an approval.

   Read: `get change-142` (versions); brief part 4.

5. **6 fix-sized inside the area, 2 larger inside, 0 outside.**
   - Of the six fix-sized finds, four became close-out findings (173 to 176). The other two went to areas: stage-kinds `intent: null` (finding-177, area-1) and completion-signals unused exports (finding-178, area-65).
   - The two larger finds: the witness fixture (finding-179) and `STEP_KIND_WORDS` (finding-180).

   Read: brief part 8 (run-171); `find --text`.

6. **After Fix 1:**
   - Every render that carries folded text must fall. Seams-tangles must show -2. The total must go 827520 -> 825278 (-2242).
   - The four work kinds, Stability, Recent Headwinds and Integration Surface Maturity stay equal, because they carry no folded text.
   - Wrong: any non-work kind or Periodical that carries folded text at >= 0.

   **FROZEN_TOTAL_BYTES does not change.** It stays at 396064, because `periodicals.js` is in no budgeted source ceiling. Read: check-168, finding-166; the 396064 figure is from verdict-169 and change-142@2's reason.
