# Answers (Reader T): LIN-4469, close-out, as of 2026-11-13T23:26:58Z

Read: `ticket.md` only (LIN-4469 description, `## Current` and comments; parent LIN-4448 description and comments).

1. **What is addressed to this stage?** The re-review's (23:21:48Z, verdict "Approve — conditional on close-out discharging the ledger") **Fixes for close-out**:
   - Fix 1: in `lib/periodicals.js` `generateSeamsTanglesPrompt`, drop the hand-typed "(no path is written here)" from the first runReview bullet; re-pin both `seams-tangles` hashes (`tests/unit/lin-4313-periodical-prompt-bytes.test.js:94`); update the change-log row (`scripts/prompt-template-change-log.md:635`) to 827520 → 825278 (−2242), seams −2, no "Up" clause, ruling sentence "four `work` kinds unchanged; `lin-4469-witness` withdrawn as moot"; update the PR body's Measured and DECISION sections. Then re-run a base-vs-head render before merge.
   - Fix 2: delete the stray fragment "(396821 -> 396571), the rest was unused headroom. " in `tests/unit/prompt-size-budget.test.js:146`.
   - The post-deploy 403 checks are named "after the deploy", not before merge. The builder's Leftovers (23:24Z) says "For close-out: none". The blind read (23:26Z) lists fix-sized finds; I can't tell from the ticket whether this close-out is meant to take them (the parent's own close-out stub later says #2457 took "the blind read's fix-sized finds", but that stub is from after this moment).
   - Source: re-review comment 2026-11-13T23:21:48Z; Leftovers 23:24:42Z; Blind read 23:26:25Z.

2. **What is still open, and whose?**
   - Fixes 1 and 2: close-out's (re-review).
   - Post-deploy 403 checks (look-into comment POST, triage description PATCH): after the deploy; no owner named (builder: "Not verified"). Rollback = revert the merge commit.
   - Merge of PR #2447: waits on close-out discharging the ledger (re-review). John can still object to the `work`-kind reading on the PR, but no ruling is open.
   - Blind read finds: 6 fix-sized inside (unassigned in the ticket; possibly close-out's, see Q1) and 2 larger inside (the witness-fixture decision about the test suite; `STEP_KIND_WORDS` display words, runs-and-dispatch).
   - Named but not this ticket's: simple-dispatcher's retirement-line copies (that repo's owner); blind-read re-pilot (a person's run, per the Waiting entry).
   - Source: re-review 23:21Z; status 23:15Z; Leftovers 23:11Z and 23:24Z; Blind read 23:26Z.

3. **Does "merge waits on John's answer to `lin-4469-witness`" still hold?** No. The re-review says `lin-4469-witness` was **withdrawn as moot at 23:17Z, not answered** (a kind with no folded text cannot fall; withdrawn rows are not re-raised), and reads the sentence as met for the four `work` kinds. The remaining gap (`seams-tangles` +24) is covered by no ruling and is removed by Fix 1. I only saw the withdrawal as reported in the re-review, not the withdrawal itself. Source: autopilot 23:05Z; re-review 23:21Z ("Witness" bullet).

4. **Does an approval cover the current head?** No, not strictly. The re-review's conditional Approve is at **`05b592742`**. The current head is **`877f32cb4`** (Leftovers 23:24Z: two header/comment tidies plus a Lesson/Waiting-entry edit for the witness ratchet; CI green there). The blind read read `877f32cb4` but gives a verdict ("better") on the area, not an approval of the PR. And the approval is conditional on Fixes 1–2, which are not yet made. Source: re-review 23:21Z; Leftovers 23:24Z; Blind read 23:26Z.

5. **Blind read counts:** **6** fix-sized inside the area, **2** larger inside, **0** outside ("None"). (One fix-sized item, `lib/completion-signals.js`, is tagged runs-and-dispatch and one, `source-map.md`, "unmapped", but the blind read lists both under "Inside the area, fix-sized".) Source: Blind read 23:26:25Z.

6. **After Fix 1:** the base-vs-head real-context render must show every render that carries folded text falling, **`seams-tangles` at −2** (from +24), and the **total 827520 → 825278 (−2242)**; "wrong" would be any non-`work` kind or Periodical with folded text at ≥0. **`FROZEN_TOTAL_BYTES` does not change** (stays 396064): `periodicals.js` is not in a budgeted source ceiling. Source: re-review 23:21Z, Fix 1 and "What CI Did Not Prove".
