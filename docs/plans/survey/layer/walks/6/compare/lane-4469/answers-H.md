# Answers — Reader H (ticket plus facts), lane LIN-4448 at LIN-4469 close-out (2026-11-13T23:26:58Z)

Read: `ticket-plus-facts.md` only (LIN-4469 ticket and comments, parent LIN-4448, area notes on main, computed facts).

**A warning about the source.** The parent's description is given "as it stands now", not as it stood at the moment. Its "Close-out stub" lists #2450 (piece 6), #2457 (parent close-out), "22 to 12" Waiting entries and a ruling from 14 Nov 10:29Z. All of these come after 13 Nov 23:26Z. I have not used that stub for any answer below. For the description I trust the comments and the facts, which stop at the moment.

## 1. What is still open across the lane, and whose is each item

- **LIN-4464, 4465, 4466, 4467, 4468 (pieces 0–4):** none open. #2430 and #2433 merged. The area notes on main carry the LIN-4466 and LIN-4467 Lessons, and the LIN-4469 review says main already includes LIN-4467 and LIN-4468. So #2441, #2444 and #2443 had merged too. That is an inference: no ticket state is given.
- **LIN-4469 (piece 5):** PR #2447 is open. The re-review approved it at `05b592742`, on condition that close-out discharges the ledger. The current head is `877f32cb4`. Open items:
  - **Close-out's:** finding-166 (Fix 1: drop the hand-typed "(no path is written here)" in the first seams-tangles bullet, re-pin both hashes, update the change-log row and the PR body). finding-167 (Fix 2: the stray "(396821 -> 396571)" fragment in the budget test comment). check-168 (re-run the base-vs-head render after Fix 1; expect −2242, with seams-tangles at −2). finding-153 (revise the store's lesson-10 "import-free leaf"). Blind-read findings 173–176:
    - the test should assert `=== 0`;
    - `committedSearch` needs an optional tail in place of `.slice(0,-1)`;
    - the header comment in the lin-4313 test;
    - the `source-map.md` "imports nothing" line.
  - **Review's:** check-148, from autopilot ("was piece 5 undersized or oversized?"), is still marked open. The re-review never answers it explicitly.
  - **John's:** check-155, the post-deploy 403 checks (a look-into comment POST, a triage description PATCH). This comes after the merge.
  - No ruling gates the merge: `lin-4469-witness` was withdrawn as moot at 23:17Z.
- **LIN-4470 (piece 6):** not started. It is blocked by LIN-4469. Its owner is the next implementation stage.
- **LIN-4448 (parent):** open. Its last review (20:34Z) was Request Changes, waiting on its children. A parent re-review comes after LIN-4470.

## 2. Asks across lanes

**(a) Asks this lane made:**
- The report to LIN-4350 was posted (eeb740b0) and corrected (25b09538). It is a report, not a question, and no answer is needed.
- The seam correction to LIN-4447 (097a3442) was informational.
- LIN-4468's notes on LIN-1273 and LIN-1242 were informational. Neither ticket is to be closed.
- Rulings asked of John:
  - safety cuts: answered;
  - look-into exception: answered;
  - held-wake stamp: answered ("Ruling applied", 22:03Z);
  - `lin-4469-cuts`: answered, fold;
  - LIN-4467's departures: cleared as not needed;
  - `lin-4469-witness`: withdrawn.
- I can see no ask this lane made of another lane that still waits.

**(b) Replies this lane may owe:**
- LIN-4447's three seam moves: answered "agree" on LIN-4447 (08c9c898).
- LIN-4459's renewed ask and its addition: moot. #2432 merged at 17:12Z under the "proceeding unless told otherwise" terms.
- LIN-4458's renewed classifier ask and census boundary: no reply is visible. It is phrased as "tell me if you want it drawn differently", and its builder proceeds without one. So no reply is strictly owed, but I can't tell whether one was posted.

## 3. Was the first build's "fold only the four mandates" overridden, and what stands now

Yes. John ruled **fold** on `lin-4469-cuts` (23:03Z; decision-157), covering survey-task, survey-place and blind-read. The engineering settlement (fab0cf08) and decision-157's chosen option also cover triage at line ~268.

What stands now:
- The tracker-write clauses are gone from the four mandates and from the triage, survey-task, survey-place and blind-read templates (commits `04bb47598` and `05b592742`).
- Triage keeps its scope rule.
- The code, branch and PR prohibitions and the merge sentences stay in words, because nothing backs them in code.
- The four `work` kinds cannot fall, since they carry no folded text. The witness ruling on them was withdrawn, not answered, and the review reads the witness as met for them.

## 4. Waiting entries on main now, and which this lane settled or is settling

- **On main now: 23 Waiting entries.** I counted the bullets in the committed `## Waiting` section. The facts' "area-1: 24 open addressed to it" counts store items, not Waiting entries.
- **Already settled by this lane:**
  - #2441 retired the blind-read entry.
  - #2444 rewrote the "fourteen parallel tables" entry to name the tables that stay.
  - The live-wait and runner-kickoff entries left through LIN-4459. That is the Runs lane, not this one.
- **About to settle on PR #2447** (not yet on main):
  - Removed:
    - the docs-only notes-PR entry (the first Leftovers' `Retires:` line);
    - the lin-4467 witness entry (decided: keep the witness as a ratchet; the second Leftovers' `Retires:`).
  - Rewritten down to what is left:
    - CUT vs "narrowing" (the token-order part stays);
    - the first-match lookup;
    - the committed-tool wording (the policy wording stays);
    - the retirement-line restatement (only simple-dispatcher's half stays).
- I can't tell from what I read whether first-match was removed outright or only narrowed, so I won't state the count after the merge (probably 21).

## 5. What John has decided for this lane that still holds

1. **The safety cuts** (`lin4448-safety-cuts`, decision-111). The merge limit (LIN-3417) stays with simple-dispatcher, and the token tickets (LIN-1372/1395/1408) stay with A12 and the harness. LIN-4448 closes only the read-only limit, through the proxy's write guard.
2. **Retire look-into's "post nothing to Linear unless the person asks" exception** (bdcd3128, decision-137). Look-into stays `none`.
3. **Fold the guarded clause** in survey-task, survey-place and blind-read, with triage ~268 covered by the option (`lin-4469-cuts`, decision-157).
4. **The held-wake credential stamp.** The 22:03Z comment says the ruling was applied in LIN-4468 (f5dab00f6). The ruling's own text isn't shown, and the facts don't list it as a decision, so this one rests only on that comment.
5. **His guidance on the prompt-size limit:** "push against lists of rules… not hard and fast." This is not a ruling.

## 6. PR #2447 at the head the re-review approved

- **Head `05b592742`:** real-context renders went from 827520 to 825330 bytes (**−2190**). 56 of 72 renders fall.
- **What rises:** `seams-tangles` and its autopilot form, **+24 each**, from the hand-typed parenthesis (Fix 1 makes it −2 and the total −2242).
- **Unchanged (±0):** the four `work` kinds, plus Stability, Recent Headwinds and Integration Surface Maturity.
- **`FROZEN_TOTAL_BYTES`:** **396064**, down from 396884 and below the 396575 condition.
- **One comment to discard:** ec59bd26 says 396419 and "eight kinds identical". Both are wrong at this head. The later a8749d0b and the review give 396064 and the four `work` kinds.

## Where the ticket and the facts disagree

- **verdict-169 is marked STALE** (made on change-142@2; the head is now @3, `877f32cb4`). The ticket shows that `877f32cb4` only tidied two header comments. I trust both: the approval formally covers `05b592742`, not the current head, but the later change looks comment-only. Close-out should confirm this with check-168's re-render.
- **lesson-10 says "import-free leaf"** in both the store and the main area notes. The updated wording exists only on the PR branch (finding-153). There is no real conflict: main is not yet updated.
- **The parent's description (its close-out stub) contradicts the moment.** I trust the comments and the facts for the reason given at the top.
