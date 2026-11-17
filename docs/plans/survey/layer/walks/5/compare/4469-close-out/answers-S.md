# Answers (Reader S, store): LIN-4469 / task-131, close-out, as of 2026-11-13T23:26:58Z

1. **Addressed to close-out:** 8 open items.
   - From review (re-review at 05b592742): finding-153 (Fix 5 remainder: on merge, revise lesson-10 "import-free leaf" to "a leaf that imports only leaves (`area-registry-path.js`)"), finding-166 (Fix 1: drop the hand-typed `(no path is written here)` in the seams-tangles runReview bullet, re-pin both seams-tangles hashes, update the change-log row and the PR body), finding-167 (Fix 2: delete the stray "(396821 -> 396571)…" fragment in the budget test comment), check-168 (after Fix 1, re-run the base-vs-head real-context render).
   - From blind-read: finding-173 (folds test should assert `=== 0`), finding-174 (`committedSearch` tail param, drop `.slice(0, -1)`), finding-175 (fix the lin-4313 test header with Fix 1), finding-176 (source-map line for `leftover-words.js`).
   *Read:* brief part 3; `show --task task-131`.

2. **Still open on the task:**
   - change-142 (PR #2447, head 877f32cb4): open, not merged.
   - The 8 close-out items above.
   - check-155: John's, after deploy (look-into comment POST and triage description PATCH get 403).
   - check-148: review's (watch piece 5 for an undersized or oversized move). Still open in the store.
   - finding-147: to area-1 (look-first skipped; raw material for the area, not a task action).
   - Not in the task but filed by this blind read: finding-177 and finding-179 to area-1, finding-178 and finding-180 to area-65.
   *Read:* `find --state open --in task-131`; `get finding-177..180`.

3. **No, it no longer holds.** question-159 (ruling `lin-4469-witness`) was **withdrawn as moot** by review at 23:17Z, not answered. Net is read as net across kinds, so the four work kinds meet it. The seams-tangles +24 is a self-inflicted addition that finding-166 removes. decision-160 still shows `stands`, but its "merge waits on question-159 only" clause is out of date. Merge now depends on close-out discharging the review ledger (verdict-169 is conditional on that).
   *Read:* `get question-159` (v3 end reason); decision-160 in brief part 4; verdict-169.

4. **Current head: 877f32cb4** (change-142@3: leftover tidies, header comments only, CI green). **No review approval covers it.** Review's approve-with-notes (verdict-169) is on change-142@2 = 05b592742, is marked STALE, and is conditional on close-out discharging its ledger. The only verdict on @3 is blind-read's verdict-172, "better", which reads the area. It is not a merge approval.
   *Read:* `get change-142` (versions); brief part 4 (verdict-169 STALE flag, verdict-172 `on change-142@3`).

5. **Six fix-sized, two larger, none outside the area.** The six fix-sized are findings 173 to 178. The two larger are 179 (the trim decision on the lin-4467 witness) and 180 (one display word per kind). Caveat: 178 and 180 are filed to area-65 (Runs & dispatch), yet the blind read itself says "nothing outside the area".
   *Read:* run-171 account ("Six fix-sized and two larger findings; nothing outside the area"); verdict-172 ("Outside the area: none"); `get finding-177..180`.

6. **After Fix 1**, using base b937237a4 with every stage kind in fresh and fix mode (each with its writes preamble) and all 13 Periodicals in plain and autopilot form:
   - Every render that carries folded text falls.
   - seams-tangles shows -2.
   - The total goes from 827520 to 825278 (-2242).
   - These stay equal because they carry no folded text: the four work kinds (blocked, breakdown, close-out, retrospective-audit), Stability, Recent Headwinds and Integration Surface Maturity.
   - The check fails if any non-work kind or Periodical that carries folded text is at >= 0.

   **`FROZEN_TOTAL_BYTES` does not change.** `periodicals.js` is in no budgeted source ceiling, so it stays at 396064, already below decision-140's 396575. Fix 2 touches only a comment in the budget test.
   *Read:* check-168, finding-166, finding-167; verdict-169 (396884 -> 396064).
