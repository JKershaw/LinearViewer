# Answers (Reader S): LIN-4469, second review, as of 2026-11-13T23:17:09Z

Read: `brief.txt`, `questions.md`, `model/BUILD-NOTES.md`; queried `store.json` with `layer.mjs` (`show --task task-131`, `get run-161 / change-142 / question-144 / finding-143 / run-156`, `find --kind verdict`, `find --to review --state open`, `find --in task-131 --state open`, `find --text 396`), all `--by review`.

1. **Addressed to review:** check-148 (open, from autopilot): judge whether piece 5 (PR #2447) was too small or too large for one piece, comparing the diff with plan-117 piece 5 and the done-when, since it skipped survey-task, survey-place and scoping. Implied by the rest of the store: re-review PR #2447 at its new head after the fold and Fixes 1 to 4.
   *Source:* brief part 3; `find --to review --state open`.

2. **Open on the task:**
   - change-142, PR #2447 (head `877f32cb4`): awaiting this review.
   - check-148: review's (above).
   - finding-153, Fix 5 (move the `area-registry-path.js` import to the top of `leftover-words.js`, revise lesson-10's wording): close-out's. Not done by implementation.
   - question-159, ruling `lin-4469-witness` (accept the four byte-identical work kinds and seams-tangles +24 as meeting "net fall across every kind"?): John's. It gates the merge (decision-160).
   - check-155, post-deploy 403 checks (look-into comment POST, triage description PATCH): John's.
   - finding-147, look-first was skipped on this piece: addressed to area-1 (LLM & prompts), as raw material for the area.
   *Source:* `find --in task-131 --state open`; decision-160; run-161 ended reason.

3. **`lin-4469-cuts`:** the builder's v1 recommended `accept` (two cuts: 11 kinds byte-identical, and the template clauses left unfolded). Review revised the question (v2): it corrected the count to 4 and recommended `fold`. John ruled **fold** (decision-157, 23:03:15): shrink the tracker-write clauses at about lines 268 (triage), 975 (survey-task), 994 (survey-place) and 1065 (blind-read) to the code, branch and PR words, then re-pin lower. The decision **still stands**, and it has been carried out: `04bb47598` covers survey-task, survey-place and blind-read; `05b592742` covers triage, keeping its scope rule. finding-143 is done.
   *Source:* `get question-144` (versions 1–3), decision-157, finding-143's ended reason.

4. **Approval of the current head:** **none**. The head is `877f32cb4` (change-142 v3, leftover's header tidies, with CI reported green). The only review of the code so far ran at `3533f37c2` and came out Needs Discussion, not an approval (run-156). No review verdict record exists for change-142. verdict-124 (plan-review approve) covers plan-117@1, the plan, not the code. Merge also waits on question-159.
   *Source:* `get change-142`, run-156, `find --kind verdict`.

5. **`FROZEN_TOTAL_BYTES`:** **396064** (equal to the ceilings' sum; main has 396884), re-pinned at `05b592742`. The earlier pins were 396559 at `3533f37c2` and then 396419 after `04bb47598`. The leftover's tidies at `877f32cb4` report no re-pin. I can't confirm the figure on that exact head. It must stay **below 396575**, decision-140's condition on LIN-4467's raise. decision-157 also asks that it end lower than the earlier 396559.
   *Source:* run-161 (comments 8933968d, a8749d0b, ec59bd26), finding-143's ended reason, decision-140.

6. **Real-context bytes:** **4** stage kinds stay byte-identical: the `work` kinds blocked, breakdown, close-out and retrospective-audit. **Yes, one kind rises:** seams-tangles is **+24**, from the shared committed-tool wording (Stability's spelling). Overall the renders fall 827520 → 825330 (−2190) at `05b592742`. Do not use the stale figures: the "11" in question-144 v1, and the "eight" in the resumed first pass's comment ec59bd26. Both exceptions are what question-159 puts to John.
   *Source:* question-159, run-161, finding-150.
