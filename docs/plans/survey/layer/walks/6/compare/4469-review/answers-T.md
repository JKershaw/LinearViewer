# Answers, Reader T (ticket only): LIN-4469, second review, as of 2026-11-13T23:17:09Z

Read: `ticket.md` (all of it, including the parent LIN-4448) and `questions.md`.

1. **What is addressed to this stage?** Re-review PR #2447 at its new head, `05b592742`. The engineering settlement (23:05:04) gave the build step its list, and the review has to check each item: (a) the guarded tracker clause folded in survey-task, survey-place, blind-read (commit `04bb47598`) and triage (commit `05b592742`), with ceilings and `FROZEN_TOTAL_BYTES` re-pinned lower; (b) the first review's Fixes 1 to 5; (c) a `### Leftovers` answer with a `Retires:` line naming an entry the diff removes; (d) corrected figures in the PR's decision text, the change-log row and the LIN-4350 comment.
   *Source:* settlement comment 23:05:04; review 23:03:57 (Fixes 1 to 5); builder comments 23:11:39, 23:11:46, 23:15:58, 23:16:04.

2. **What is still open, and whose?**
   - John's ruling `lin-4469-witness`: the four `work` kinds stay byte-identical and `seams-tangles` rises +24. Merge waits on it. *(John.)*
   - Review of head `05b592742`. *(This review stage.)*
   - Post-deploy 403 checks: a look-into token's comment POST and a triage token's description PATCH. They are not verified and come after the deploy. *(After merge and deploy. No owner is named; the builder states them as not verified.)*
   - No comment says these two fixes were made. Both are for the build or close-out step to show:
     - Fix 5: move the import in `leftover-words.js` to the top and update the Lesson.
     - Fix 2: correct the figures on the PR's DECISION, the change-log row and LIN-4350. The ticket doesn't show this. The 23:16:04 comment still describes the open DECISION as "eight kinds … byte-identical".
   - These items are shown as done:
     - Fix 1: the retirement-line docs (23:15:58).
     - Fix 3: the line on LIN-4448 (23:11:46).
     - Fix 4: the RETIRED spelling (23:15:58).
     - The Leftovers answer (23:11:39).

   *Source:* comments 23:11:39, 23:11:46, 23:15:58, 23:16:04; review fixes list.

3. **Builder's `accept` on `lin-4469-cuts`: what was decided, and does it hold?** It was not accepted. John ruled "Fold the guarded clause in survey-task, survey-place and blind-read templates too" (23:03:14). The engineering settlement (23:05:04) also settled "fold", adding triage line 268 (its scope rule stays). It replaced `lin-4469-cuts` with a one-question ruling, `lin-4469-witness`, which has the corrected figures. The decision still holds: the fold is built in `04bb47598` and `05b592742`. Only the witness question is still open.
   *Source:* comments 23:03:14, 23:05:04, 23:16:04, 23:11:46.

4. **Does a verdict cover the current head?** No. The PR head is `05b592742`. The only review of the PR was at `3533f37c2`, and its verdict was **Needs Discussion**, not an approval. The parent's plan-review Approve covers the plan, not this head. All that covers `05b592742` is green CI (run 43525065043).
   *Source:* review 23:03:57; comments 23:15:58, 23:16:04.

5. **`FROZEN_TOTAL_BYTES` now, and what it must be below.** **396064**, equal to the ceilings' sum. Earlier values were 396884 on main, 396559 at the first head, and 396419 after `04bb47598`. It must be below **396575**, the condition from LIN-4467's settlement.
   *Source:* comments 23:15:58, 23:11:46, 21:49:17 (condition), 23:16:04.

6. **Real context: how many kinds stay byte-identical, and does anything rise?** **Four** stay byte-identical, the `work` kinds: blocked, breakdown, close-out and retrospective-audit. **`seams-tangles` rises +24**, from the committed-tool wording. Overall the renders fall 827520 → 825330 bytes (−2190). The 23:16:04 comment says "eight … byte-identical", which conflicts. That figure comes from the template-only view the review already corrected.
   *Source:* comments 23:15:58, 23:11:46; review 23:03:57; settlement 23:05:04.
