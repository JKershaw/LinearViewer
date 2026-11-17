# Answers: Reader T (ticket), lane LIN-4448 at the start of LIN-4469's close-out (2026-11-13T23:26:58Z)

Read: `ticket.md` only (LIN-4469 with its comments, parent LIN-4448 with comments to 23:26:58Z, area notes as committed then) and `questions.md`.

Caution: the parent's description in `ticket.md` is "as it stands now". Its "Close-out stub" names #2450, #2457 and a 14 Nov ruling, which are after this moment. I did not use them.

## 1. What is still open across the lane, and whose

- **LIN-4469 (piece 5), this close-out's.** PR #2447 is open, with re-review "Approve, conditional on close-out discharging the ledger" at head `05b592742`. Close-out still has to:
  - **Fix 1:** drop the hand-typed "(no path is written here)" from the first Seams & Tangles runReview bullet in `lib/periodicals.js`. Then re-pin both `seams-tangles` hashes, update the change-log row and the PR body (−2242, seams −2, "four `work` kinds unchanged; `lin-4469-witness` withdrawn as moot"), and re-run the base-vs-head render.
  - **Fix 2:** delete the stray "(396821 -> 396571)…" fragment in `tests/unit/prompt-size-budget.test.js:146`.
  - Merge.
  - **After the deploy:** the 403 checks (look-into comment POST under `none`, triage description PATCH under `ticket-fields`). These are not verified. Rollback is reverting the merge commit. Whose: close-out, or a person after the deploy.
  - Read: re-review 23:21:48 (Fixes, What CI Did Not Prove), status 23:15:58 and 23:11:46.
- **Blind read finds (23:26:25).** Six are fix-sized inside the area: the test's `<= 1` assertion, `committedSearch`'s `.slice(0,-1)`, the lin-4313 header comment, the `source-map.md` "imports nothing" line, `stage-kinds.js` `intent: null` mutation, and the unused `completion-signals.js` exports. The last of these is runs-and-dispatch's file. Two are larger: the lin-4467 witness fixture (llm-and-prompts) and `run-view.js` `STEP_KIND_WORDS` (runs-and-dispatch). Not yet assigned in the ticket. They fall to this lane's close-out or to LIN-4470. The two runs-and-dispatch files are the Runs lane's (A13).
- **LIN-4470 (piece 6):** Waiting entries and repeat reads. Not started; it waits on LIN-4469. Whose: LIN-4470's build. Read: breakdown table, parent review 20:34.
- **LIN-4448 (parent):** open. Its last review (20:34) was Request Changes, pending the children; it is reviewed again after them.
- **Rulings:** none open. `lin-4469-witness` was withdrawn as moot at 23:17Z, not answered (re-review).
- **Outside the lane but named:** LIN-1273 and LIN-1242 stay open (merge, Done, staleness). LIN-3417 stays with simple-dispatcher and LIN-1372/1395/1408 with A12/the harness, by ruling. simple-dispatcher's retirement-line restatement belongs to its owner.
- Pieces 0–4 (LIN-4464, 4465, 4466, 4467, 4468) are merged: the area-note Lessons cite LIN-4465, 4466 and 4467, and the re-review says main includes LIN-4467 and LIN-4468. I can't tell their Linear states.

## 2. Asks

(a) **Asks this lane made of another lane.**
- The seam correction posted on LIN-4447 (comment 097a3442, at breakdown) told the Runs lane about collisions with LIN-4459, LIN-4460 and #2427. It was a notice, not a question, and I see no reply in `ticket.md`. Can't tell whether it was acknowledged.
- The report to LIN-4350 (eeb740b0, corrected by 25b09538) is a report, not an ask.
- I find no other ask with a pending answer.

(b) **Asks other lanes made of this one.**
- LIN-4447's three seam moves: answered "agree" (08c9c898, 15:39Z).
- LIN-4459's renewed ask on the live-wait move, and its 17:06 addition: #2432 merged at 17:12Z, and the parent review (20:34) says that answers it.
- LIN-4458's classifier-home and census boundary (16:42): "building on that unless you say otherwise". No reply is shown, and by its own terms none is needed.
- So, as far as `ticket.md` shows, the lane owes no reply.

## 3. Piece 5's tracker-clause fold: overridden?

Yes. The premise is slightly off, though. The first build (22:58) did keep the fold to the four mandates, but its DECISION 2 *recommended shrinking* the three read-only templates. Its DECISION 1 was the one that recommended accepting a measured cut, on the witness.

The scope was overridden twice:
- John's ruling (23:03:14, `lin-4469-cuts` = fold): "Fold the guarded clause in survey-task, survey-place and blind-read templates too".
- The engineering settlement (23:05) also took in triage `:268` under the standing same-class rule (LIN-2825/LIN-3006).

What stands now: every guard-refused tracker clause is folded. That covers the four mandates plus survey-task, survey-place, blind-read's read-only line (`04bb47598`) and triage (`05b592742`; its scope rule stays). The code, branch and PR words and the merge sentences stay in words. The Survey completion criteria (`stage-kinds.js:534,559`) are left outside.

## 4. Waiting entries on main now; which this lane settled

- **23** entries in the committed `## Waiting` (I counted them). This agrees with the parent review's "23 at `e666c4b60`".
- **Already settled on main by this lane:**
  - the blind-read entry, retired by LIN-4466;
  - the "~fourteen parallel tables" entry, rewritten by LIN-4467 to name the tables that stay;
  - LIN-4468 rewrote the agent-api entry, which is another area's.
- **About to settle with #2447 (not merged yet):**
  - removed: the docs-only notes-PR rule (Leftovers `Retires:` 23:11);
  - removed: the lin-4467 witness entry (Leftovers `Retires:` 23:24; kept as a ratchet, now a Lesson);
  - removed or rewritten: first-match lookup;
  - rewritten to the remainder: committed-tool (the policy wording);
  - rewritten to the token-order remainder: `CUT` vs "narrowing";
  - rewritten to the simple-dispatcher half: retirement-line restatement.
- After merge I'd expect about 21. That is not stated, so I can't confirm it.

## 5. What John has decided for the lane that still holds

1. **Both cuts (15:33):** the merge limit (LIN-3417) waits for simple-dispatcher, and the token tickets (LIN-1372/1395/1408) wait for A12 and the harness. "LIN-4448 closes only the read-only limit, through the proxy's write guard."
2. **Retire look-into's "post nothing to Linear unless the person asks" exception (15:57, bdcd3128).** Look-into stays `none`, and the clause is dropped in #2447.
3. **`lin-4469-cuts` = fold (23:03):** survey-task, survey-place and blind-read lose the guarded clause.
4. **The held-wake stamp DECISION:** "Ruling applied" (22:03). The held wake takes the resumed parent's stage. The ruling's own text isn't shown.
5. **On the prompt-size limit:** "That limit is to push against lists of rules. Worth knowing, but not hard and fast."

Not a John decision: `lin-4469-witness`, which was withdrawn, not answered.

## 6. PR #2447 at the re-reviewed head

- **Head:** the re-review approved `05b592742`.
- **Real-context renders:** **827520 → 825330, −2190**, reproduced independently by the re-review. 56 of 72 renders fall.
- **What rises:** **`seams-tangles` and its autopilot form, +24 each.** The cause is the hand-typed "(no path is written here)".
- **What does not move:** the four `work` kinds and three Periodicals (Stability, Recent Headwinds, Integration Surface Maturity) are ±0.
- **`FROZEN_TOTAL_BYTES`:** **396064**, down from 396884 and equal to the ceilings' sum.
- After Fix 1 the total would be −2242 and seams −2, with `FROZEN_TOTAL_BYTES` unaffected. That is not yet done.
- The later Leftovers head `877f32cb4` changes only header comments; I can't tell whether it changes bytes.
