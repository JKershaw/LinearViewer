# Answers — Reader H (ticket plus facts), LIN-4469 second review, as of 2026-11-13T23:17:09Z

1. **Addressed to this stage:** a re-review of PR #2447 at its new head `05b592742`, after the fold and the Fixes. One open item is addressed to review by name: **check-148** (autopilot). It asks review to compare what #2447 changed against plan piece 5 and the task's done-when, and to say whether the move was too small or too large for one piece, since look-first was skipped.
   *Read:* facts §3 (check-148); ticket comments 23:15:58 (status, head) and 22:39:47 on the parent (autopilot note).

2. **Still open, and whose:**
   - **question-159 / ruling `lin-4469-witness`: John's.** He must accept the four `work` kinds staying byte-identical and seams-tangles +24 as meeting "a net fall across every kind". Merge waits on it.
   - **check-148: review's** (see Q1).
   - **check-155: John's, after deploy.** A look-into token's comment POST must get 403, and a triage token's description PATCH must get 403. The builder marks it not verified. Rollback is reverting the merge commit.
   - **finding-153 (Fix 5): close-out's.** Move the mid-file import in `leftover-words.js` to the top, and revise lesson-10's "import-free leaf" on merge. No build comment says this was done.
   - The other review fixes (1 to 4) and the Leftovers answer are reported done on the branch. The facts list no open findings for them. I can't tell for certain that the LIN-4350 correction reply (part of Fix 2) was posted. The status comment mentions only the PR's DECISION section.
   *Read:* facts §3 and §7; comments 23:05:04, 23:11:39, 23:15:58 and 23:16:04; parent 23:11:46.

3. **`lin-4469-cuts`:** the builder recommended "accept", which meant not folding the sibling clauses. **John ruled "fold"** (23:03:14; decision-157). Shrink the tracker-write clauses at ~975 (survey-task), ~994 (survey-place), ~1065 (blind-read) and ~268 (triage) to the code, branch and PR words. Triage keeps its scope rule. The ruling also called for re-pinned ceilings and a lower `FROZEN_TOTAL_BYTES`. **It still holds** (facts: [stands]). It has been carried out in `04bb47598` and `05b592742`. The witness question was split off into the replacement ruling `lin-4469-witness`, which is still open. Note that the ruling's comment names three templates, but the option chosen also covers triage.
   *Read:* comments 23:03:14, 23:05:04 and 23:16:04; facts decision-157 and decision-160.

4. **No.** The only verdict on the PR is the first review, "Needs Discussion", given at head `3533f37c2`. The head is now **`05b592742`**, with `04bb47598` landed in between, so no verdict covers it. The plan-review "Approve" (verdict-124) covers the parent's plan, not this head. CI is green on `05b592742` (run 43525065043), but CI is not a verdict.
   *Read:* review comment 23:03:57; status 23:15:58; facts verdict-124.

5. **`FROZEN_TOTAL_BYTES` = 396064** at head `05b592742`, equal to the sum of the ceilings. **It must be below 396575**, the condition from LIN-4467's settlement (decision-140). On main it is 396884.
   The intermediate figures were 396559 (at `3533f37c2`) and 396419 (after `04bb47598`). I trust 396064 because two comments state it at the current head (23:11:46 and 23:15:58). The 396419 in the 23:16:04 comment describes only `04bb47598`, before `05b592742`.
   *Read:* comments 21:49:17, 22:58:22, 23:15:58 and 23:16:04; parent 23:11:46; facts decision-140.

6. **Four kinds** stay byte-identical in real context: blocked, breakdown, close-out and retrospective-audit, all `work`. **One kind rises: seams-tangles, +24,** from the shared committed-tool wording. Overall, real-context renders fall 827520 → 825330 bytes (−2190).
   *Disagreement:* the 23:16:04 comment says eight kinds "remain byte-identical", and the builder's first summary said 11. Both counts measure the templates without the proxy preamble. I trust the review's real-context measurement and the later status: four, plus the +24. question-159 states the same.
   *Read:* review 23:03:57; comments 23:05:04, 23:15:58 and 23:16:04; facts question-159.
