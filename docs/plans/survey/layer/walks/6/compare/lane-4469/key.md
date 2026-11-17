# Key: lane LIN-4448 (LLM & prompts), at the start of LIN-4469's close-out

Moment: 2026-11-13T23:26:58Z (close-out dispatched on LIN-4469). The answers count only what was written before that moment. LIN-4469's close-out comment (23:59Z), the merge of #2447, LIN-4470's work and everything on LIN-4448 dated 14 Nov came later and are **not** true yet.

Sources: `LIN-4469.json`, `LIN-4469-snapshots.json` (23:27:13 snapshot), `LIN-4469-rulings.json`, `LIN-4448.json`, `LIN-4448-rulings.json`, `LIN-4447.json`, `replay-4469/real/`, and `lane-4469/area-notes.md` (the area notes on main at the time).

---

## 1. What is still open across the lane, and whose is each item?

**Answer.**
- **LIN-4469 (piece 5), In Progress. Close-out owns all of this:**
  - PR #2447 is open and unmerged (head `877f32cb4`, CI green). Close-out merges it and sets Done.
  - The re-review approves only on condition that close-out discharges its ledger:
    - Fix 1: remove Seams & Tangles' hand-typed "(no path is written here)", re-pin both `seams-tangles` hashes, and update the change-log row and the PR body.
    - Fix 2: delete the stray fragment in the `prompt-size-budget.test.js` comment.
  - The blind read lists six fix-sized inside finds, plus two larger finds that have no home yet: the witness's table hashes (llm-and-prompts) and `run-view.js` `STEP_KIND_WORDS` (runs-and-dispatch).
  - The post-deploy 403 checks (a look-into comment POST and a triage description PATCH) have not been run. They come after the deploy. If close-out cannot mint restricted tokens, they fall to the operator.
- **LIN-4470 (piece 6), Todo, blocked by LIN-4469.** It is the next piece in the lane: settle the Waiting entries and repeat the area reads (the blind-read measure).
- **LIN-4448 (parent), In Progress.** Its latest review is **Request Changes** (20:34Z, written while only pieces 0–2 were in flight). It needs a fresh review once the children land. The Done-when blind-read measure is still open, and it belongs to piece 6.
- Pieces 0–4 (LIN-4464–LIN-4468) have landed. Nothing in them is open.
- Tied to the lane but not its own work:
  - LIN-4350 stays open (it spans two repos, and this lane only reported to it).
  - LIN-1273 and LIN-1242 keep their merge and Done halves open, by ruling.
  - simple-dispatcher's copies of the retirement-line rules belong to that repo's owner.

**Shown in:**
- LIN-4469 23:27:13 snapshot (state In Progress; parent In Progress).
- Re-review 042f607d (23:21:48, "Fixes for close-out", "What CI Did Not Prove", verdict "Approve — conditional on close-out discharging the ledger").
- Leftovers a2efc9a8 (head `877f32cb4`).
- Blind read d96c0849 (23:26:25).
- LIN-4469 relation "blocks LIN-4470".
- LIN-4448 breakdown 4b22eb22 (graph) and parent review 882fc992 (20:34, Request Changes).

## 2. (a) Asks this lane made to another lane, answered? (b) Replies owed?

**Answer.**
- **(a) Asks this lane made:**
  - **To Runs & dispatch (LIN-4447):**
    - Seam correction 097a3442 (15:55): the full list of Runs files the pieces edit, with collisions. A notice. No reply was recorded.
    - Heads-up 15de14a7 (21:49): `COMPLETION_SIGNALS` becomes a view, so LIN-4462's after-read should read `lib/prompts/stage-kinds.js`. No reply.
    - Seam notice b555094d (21:58): LIN-4468 adds one argument in `releaseHeldWake`, "if this collides … say so here". **No reply by 23:26:58.** LIN-4468 went ahead.
  - **To LIN-4350:** piece 5's findings (eeb740b0), corrected in 25b09538 to the four `work` kinds and −2190. This is a report, not an ask awaiting an answer.
- **(b) Replies owed:**
  - Runs' first ask (d3ba7421, the three seam moves) **was answered**: "agree" to all three, on LIN-4447 (08c9c898, 15:39).
  - Runs' renewed asks on LIN-4448 got **no reply**: 1a2e7cba (LIN-4458, the census boundary), and 0510ffe0 and b564445b (LIN-4459).
  - Runs went ahead on the earlier agreement (44101230: "not waiting on a reply"; 15a858eb: the fallback was used and LIN-4459 merged). None of these replies blocks anything now.

**Shown in:**
- LIN-4447 comments 097a3442, 15de14a7, b555094d, 08c9c898, 44101230 and 15a858eb (no LIN-4447 comment between 21:58 and 23:26:58).
- LIN-4448 comments d3ba7421, 1a2e7cba, 0510ffe0 and b564445b.
- LIN-4469 re-review 042f607d ("Report to LIN-4350. Met, and corrected: 25b09538").

## 3. Piece 5's four-mandate scope and "accept" recommendation: overridden? What stands?

**Answer.** Yes, it was overridden.
- **The first build (22:58):**
  - It folded only the four mandates and left the guarded clause in survey-task, survey-place and blind-read unfolded. Triage line 268 was not mentioned.
  - It recommended `accept` on `lin-4469-cuts`, which claimed "11 kinds byte-identical".
- **What overrode it:**
  - John answered **`fold`** (23:03:14).
  - The autopilot's engineering settlement added triage's write clauses as the same class, and corrected 11 kinds to the **four `work` kinds**.
- **What stands now:**
  - Guarded tracker-write clauses are gone from the four mandates and from triage, survey-task, survey-place and the blind read's read-only line (commits `04bb47598` and `05b592742`).
  - The code, branch and PR prohibitions and the merge sentences stay in words.
  - Triage keeps its scope rule.
  - Only blocked, breakdown, close-out and retrospective-audit are byte-identical. That was accepted without a ruling.
- Also accept, as a second override: the plan put `committedSearch` in `leftover-words.js`. It lives in `lib/periodicals.js` instead, and that deviation is recorded on LIN-4448 (8933968d).

**Shown in:**
- cc7fbe5d (22:58).
- `LIN-4469-rulings.json` (`lin-4469-cuts`, recommended accept, answered `fold` at 23:03:14).
- 62f57ef4 (23:03:14).
- fab0cf08 (23:05).
- ec59bd26 and a8749d0b.
- Re-review 042f607d ("Shrink only …", "Witness …").
- 8933968d.

## 4. How many Waiting entries on main now, and which has this lane settled or is about to settle?

**Answer.**
- There are **23** Waiting entries in `docs/areas/llm-and-prompts.md` on main.
- **PR #2447 is not merged, so none of piece 5's settlements is on main yet.**
- On its branch, #2447:
  - **removes 2 entries:**
    - the docs-only notes-PR rule (the `Retires:` line in bbc2b1c7);
    - the LIN-4467 witness entry (the `Retires:` line in a2efc9a8: kept as a ratchet and recorded as a Lesson);
  - **rewrites 4 entries down to their remainders:**
    - `CUT` vs "narrowing" (the token order remains);
    - the first-match lookup (the blind read's piloted sentence remains);
    - the committed-tool wording (the policy wording remains);
    - the retirement line's restatement in this repo's docs (simple-dispatcher's half remains).
- Earlier, this lane's LIN-4466 retired the blind-read entry (3f26885a), and LIN-4467 rewrote the stage-kind-tables entry to name the tables that stay (431b4772).
- Trap: the two live-wait entries and the runner-kickoff entry left through the **Runs lane's** LIN-4459 (#2432), not this lane.
- Accept also: the count was 25 at the plan (the ask said 26) and 23 at the 20:34 parent review.

**Shown in:**
- `lane-4469/area-notes.md`, `## Waiting` (23 bullets, still including the notes-PR, first-match, committed-tool, CUT, retirement-line and witness entries).
- bbc2b1c7 and a2efc9a8 (`Retires:` lines).
- Re-review 042f607d ("Retires": removed or rewritten to their remainder).
- 3f26885a and 431b4772.
- d3553049 and b564445b (LIN-4459 settles the LLM note's live-wait and runner-kickoff entries).
- Plan review 72406236 (25).
- Review 882fc992 (23).

## 5. What has John decided for this lane that still holds?

**Answer.**
1. **`lin4448-safety-cuts` = defer** (15:33): the merge limit (LIN-3417) waits for simple-dispatcher, and the token tickets (LIN-1372, 1395, 1408) wait for A12. LIN-4448 closes only the read-only limit, through the proxy's write guard.
2. **`lin4448-lookinto-none` = retire** (15:57, bdcd3128): look-into's "post nothing to Linear unless the person asks" exception goes. Look-into reports in its session, and a person posts the comment if they want it.
3. **`lin-4469-cuts` = fold** (23:03:14): fold the guarded clause in survey-task, survey-place and blind-read too.
4. **On the byte limit:** "That limit is to push against lists of rules. Worth knowing, but not hard and fast."

**Not John's decisions:**
- `lin-4469-witness` was **withdrawn as moot** (23:17:16) and never answered.
- The triage fold and the budget-raise condition (a77d9b51) are engineering settlements.
- No ruling yet says how to treat the blind-read measure or close the parent.
- Optional: the held-wake stamp DECISION was settled at 22:03 (83e69cd5). The material holds no John ruling record for it.

**Shown in:**
- `LIN-4448-rulings.json`, `LIN-4469-rulings.json`.
- LIN-4448 comments 643eef60, bdcd3128 and b0dc78f0.
- LIN-4469 comments 62f57ef4 and a77d9b51.
- LIN-4448 description `## As asked`.

## 6. PR #2447's real-context byte change at the approved head; does anything rise; `FROZEN_TOTAL_BYTES`?

**Answer.**
- At `05b592742`, the head the re-review approved (the later `877f32cb4` changes only headers), real-context renders with preambles go **827520 → 825330 (−2190)**. 56 of the 72 renders fall.
- **`seams-tangles` and its autopilot form rise +24**, because of a hand-typed "(no path is written here)".
- Seven renders stay ±0, because they carry no folded text: the four `work` kinds, Stability, Recent Headwinds and Integration Surface Maturity.
- −2242 (with `seams-tangles` at −2) is only the reviewer's probe of Fix 1. **That fix is not applied yet.**
- **`FROZEN_TOTAL_BYTES` = 396064**, down from 396884 on main. It equals the ceilings' sum and is below the 396575 condition.
- 396559 (the first build) and 396419 (ec59bd26) are stale.

**Shown in:**
- Re-review 042f607d ("Independent measurement", "Re-pin once", "Stale comment, superseded", Fix 1).
- a8749d0b and 8933968d.
- a77d9b51 (the 396575 condition).
- Leftovers a2efc9a8 (head `877f32cb4`, header tidies only).
