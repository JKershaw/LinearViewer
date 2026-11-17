# Answers (Reader S, store) — LIN-4448 lane at LIN-4469 close-out, 2026-11-13T23:26:58Z

Read: `brief.txt`, `questions.md`, `model/BUILD-NOTES.md`. Queried `store.json` with `model/layer.mjs` (`show --task task-108`, `show --task task-131`, five child `show`s, `find --to John`, `find --to area-1`, `find --kind question`, `find --text …`, `get` on single records), all `--by close-out`.

## 1. What is still open across the lane, and whose

- **LIN-4448 (task-108)**: open. Its last parent review (verdict-139, 20:34) is request-changes: go down into the children, then review the parent again.
- **Pieces 0–4 (LIN-4464…LIN-4468, task-126…130)**: all done (merged), with no open records in them.
- **LIN-4469 (task-131)**: open. PR #2447 (change-142) is not merged; head is 877f32cb4.
  - **Close-out** owns 8 open items: finding-166 (Fix 1, seams-tangles parenthesis), finding-167 (Fix 2, stray budget-test comment), check-168 (re-render base vs head after Fix 1), finding-153 (revise lesson-10 on merge), and blind-read findings 173 (folds test `=== 0`), 174 (`committedSearch` tail, drop `.slice`), 175 (lin-4313 header comment) and 176 (source-map line for `leftover-words.js`).
  - **John** owns check-155: after deploy, confirm restricted tokens get a 403.
  - **Review** owns check-148 (was piece 5 too small or too large?). It is still open. verdict-169 does not discharge it.
  - **area-1 (LLM & prompts)** owns finding-147, the look-first skip.
- **LIN-4470 (piece 6)**: not started. It has no task record in the store, and it is blocked by LIN-4469 (decision-135).
- New area findings from the blind read: 177 and 179 go to area-1, 178 and 180 go to area-65 (Runs & dispatch).
- Store hygiene: question-110 and question-136 still read `open`, but both are answered (decision-111, decision-137).

Source: `show` of task-108, task-131 and task-126…130; `find --to area-1`; brief parts 3 and 7.

## 2. Asks to and from other lanes

**(a) Asks this lane made:**
- **LIN-4447 (Runs & dispatch seam).** plan-review (verdict-120, item 7) asked the lane to correct the seam reply on LIN-4447 with the full list of Runs files, and to warn LIN-4460 and LIN-4459. **Can't tell** whether it was posted or answered: the store has no record of it.
- **LIN-4350.** This was a report, not an ask. The findings comment eeb740b0 was corrected by 25b09538 ("four work kinds", −2190). The store shows no reply.
- **simple-dispatcher and A12 (LIN-4416).** Nothing was asked. Both are cuts John ruled on (decision-111), and simple-dispatcher's retirement-line copy is only named in finding-42.
- **Rulings asked of John.** question-110 was answered (decision-111), question-136 was answered (decision-137), question-144 was answered (decision-157), and question-159 (`lin-4469-witness`) was withdrawn as moot. check-155 to John is open.
- **Runs & dispatch area.** findings 178 and 180 were filed to area-65. They are open and unanswered.

**(b) Replies this lane owes:** none that I can find in the store. No record from another lane is addressed to this lane's tasks or stages. I can't rule out asks that exist only on Linear.

Source: `find --text LIN-4447 / LIN-4350 / simple-dispatcher`, `get verdict-120`, `find --kind question`, `find --to John`.

## 3. Was the four-mandates-only fold overridden? What stands now

**Yes, it was overridden.** run-141 had recommended accepting the cuts and leaving the clauses at 975, 994 and 1065 unfolded. The autopilot then settled the fold as engineering (decision-160, comment fab0cf08), and John ruled **fold** (decision-157, ruling `lin-4469-cuts`, comment 62f57ef4).

What stands now: the tracker-write clauses are also shrunk in:
- survey-task (~975), survey-place (~994) and blind-read (~1065), down to the code, branch and PR words;
- triage (~268), which keeps its scope rule and "findings stay observations".

The code, branch, PR and merge words stay, because nothing backs them in code. The fold was built at 04bb47598 and 05b592742, and finding-143 is done. The ceilings were re-pinned lower. The "11 kinds identical" figure was corrected to the 4 work kinds.

Source: decision-157, decision-160, finding-143, question-144, run-141.

## 4. Waiting entries in `docs/areas/llm-and-prompts.md` on main now, and which this lane settles

- **On main (b937237a4): 23.** That is the area-1 entries finding-22…finding-44, seeded when piece 4 merged at 22:29:42. PR #2447 is unmerged, so main is unchanged. This is partly uncertain: the ask said 26 and breakdown said 25. The store holds nothing from before b937237a4, so I can't tell which entries pieces 0–4 removed.
- **Removed by PR #2447, and so settled when it merges:**
  - finding-37: the docs-only notes-PR rule, now `NOTES_PR`. It is named in the Retires: line.
  - finding-26: the lin-4467 witness, kept as a ratchet (decision-163, lesson-164).
  - After the merge, main has **21**.
- **Narrowed but still waiting:**
  - finding-24: the naming half of `CUT` vs "narrowing" is folded; the token order stays.
  - finding-38: `areaLookup` is folded; the piloted blind-read sentence stays.
  - finding-40: the spelling is folded; the per-template tooling policy stays.
  - finding-42: this repo's docs are fixed; simple-dispatcher's copy stays.
- **Candidates for close-out to add:** finding-147, finding-177 and finding-179. These are why the brief shows 24 open records addressed to area-1.

Source: `find --to area-1`, `get` on finding-24, 26, 37, 38, 40, 42 (with versions), and the brief's part 5.

## 5. What John has decided that still holds

- **decision-111** (ruling `lin4448-safety-cuts`): both cuts. The merge limit (LIN-3417 and the merge half of LIN-1273) waits for simple-dispatcher. The token tickets (LIN-1372, LIN-1395, LIN-1408) wait for A12 and the harness. LIN-4448 closes only the read-only limit, through the proxy write guard.
- **decision-137** (ruling `lin4448-lookinto-none`): retire look-into's "unless the person asks" exception.
- **decision-157** (ruling `lin-4469-cuts`): fold the guarded clause into survey-task, survey-place, blind-read and triage, and re-pin to a lower `FROZEN_TOTAL_BYTES`.
- **His word on the limit** (quoted in the ask and in decision-140): "push against lists of rules … not hard and fast."
- **Not a decision by John:**
  - `lin-4469-witness` was withdrawn, not answered.
  - decision-109 ("rebuild the area", with "Decided by: a ruling") was written by scoping. I can't tell whether John made that call.
  - decision-140's condition (below 396575) came from LIN-4467's settlement, written by the autopilot.

Source: decision-111, 137, 157, 109, 140 and question-159.

## 6. PR #2447's measured byte change at the approved head

- **Approved head:** 05b592742 (verdict-169). Real-context renders fall **827520 → 825330 (−2190)**, and 56 of 72 renders fall.
- **What rises:** **seams-tangles and its autopilot form, +24 each.** The cause is the hand-typed parenthesis that finding-166 removes. Once it is removed: seams-tangles −2, total −2242.
- **What stays the same:** the four work kinds (blocked, breakdown, close-out, retrospective-audit), plus Stability, Recent Headwinds and Integration Surface Maturity. They carry no folded text.
- **`FROZEN_TOTAL_BYTES`:** 396884 → **396064**, below decision-140's 396575.
- **The approval is now stale:** the head moved to 877f32cb4 after the leftover header tidies (change-142 v3).

Source: verdict-169 (flagged STALE), run-165, check-168, finding-166 and change-142.
