# Answers (Reader S, store), LIN-4469 second review, as of 2026-11-13T23:17:09Z

Read: `brief.txt`, `questions.md`, BUILD-NOTES.md; queried with `show --task task-131`, `get` (change-142, run-141, run-156, run-158, run-161, run-162, finding-143, finding-145, question-144, verdict-139), `find --kind verdict`, `find --state open --in task-131`, `find --to review`.

1. **Addressed to this stage:** check-148 (open, to review, from autopilot): judge whether PR #2447's move was too small or too large for one piece, comparing it to plan-117 piece 5 and the done-when. The first review left it open and did not judge it (run-156). Implicitly, also re-review PR #2447 at its new head after the second build pass. finding-145 (to review) is already done.
   *Source:* brief part 3; `find --to review`; run-156 account.

2. **Still open on the task:**
   - question-159, John's: ruling lin-4469-witness. Do the 4 byte-identical work kinds and seams-tangles' +24 meet "a net fall across every kind"? Merge waits on this only (decision-160).
   - check-148, review's: the move-size check (Q1).
   - finding-153, close-out's: Fix 5. Move the `area-registry-path.js` import to the top of `leftover-words.js`, and revise lesson-10's wording on merge. run-161 says it was not done.
   - check-155, John's: after deploy, confirm restricted tokens get 403 (look-into comment POST, triage description PATCH). Not verified.
   - finding-147, area-1's (LLM & prompts): look-first was skipped on this piece. It is raw material and does not block.
   - change-142 (PR #2447) itself is still open, unmerged.
   *Source:* `find --state open --in task-131`; run-161 account; decision-160.

3. **Ruling lin-4469-cuts:** the builder recommended `accept` (question-144 v1). Review corrected the facts and recommended `fold` (v2). John ruled **fold** (decision-157): shrink the guarded tracker-write clauses in `prompt-template-defs.js` at about lines 268 (triage), 975 (survey-task), 994 (survey-place) and 1065 (blind-read) down to the code, branch and PR words, then go back to implementation and re-pin the ceilings with a lower `FROZEN_TOTAL_BYTES`. **It still holds** (state stands, nothing supersedes it), and it has been carried out: survey-task, survey-place and blind-read were folded in 04bb47598, triage in the second pass (run-161), and finding-143 is done. The witness half split off into question-159, which is still open.
   *Source:* question-144 v1 to v3; decision-157; decision-160; finding-143 v4 and v5; run-161.

4. **Approval at the current head:** **No.** The current head is **877f32cb4** (change-142 v3, leftover's header tidies, CI green). Earlier heads were 3533f37c2 and then 05b592742. No review verdict exists for PR #2447 at any head. The first review (run-156, at 3533f37c2) was "Needs Discussion" and wrote no verdict record. verdict-124 approves the *plan* (plan-117), not the PR. verdict-139 is a request-changes on the parent task-108, not on this PR. question-159 is also unanswered, so the merge gate is not cleared.
   *Source:* `get change-142` versions; `find --kind verdict`; run-156; verdict-139.

5. **`FROZEN_TOTAL_BYTES`:** the branch carries **396064**. That is the second pass's re-pin, equal to the sum of the ceilings. It was 396559 after the first pass, and main carries 396884. It must be **below 396575** (decision-140's condition from LIN-4467). The leftover pass (877f32cb4) reports no re-pin, so I take 396064 to still stand at the head. That is inferred: no record states the figure at 877f32cb4 itself.
   *Source:* change-142 v2 reason; run-161; finding-145; decision-140; run-162.

6. **Byte-identical kinds in real context:** **4** work kinds (blocked, breakdown, close-out, retrospective-audit). **Yes, one rises:** seams-tangles, +24, from the shared committed-tool wording (Stability's spelling). The total still falls 827520 -> 825330 (-2190). This was measured at 05b592742, not at the current head 877f32cb4, but the leftover tidies were header comments only. Beware the stale figure: the first pass's "11 kinds identical" was wrong and was corrected to 4.
   *Source:* question-159; run-161; question-144 v2; finding-150.
