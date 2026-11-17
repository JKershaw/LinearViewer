# Answers H (ticket plus facts): LIN-4469, close-out, as of 2026-11-13T23:26:58Z

Source: `ticket-plus-facts.md` only (ticket, parent LIN-4448, and the computed facts).

## 1. What is addressed to this stage to act on?

From the re-review's ledger (comment 23:21:48Z, "Fixes for close-out" and "What CI Did Not Prove"):
- **Fix 1** (finding-166): in `lib/periodicals.js` `generateSeamsTanglesPrompt`, drop the hand-typed "(no path is written here)" from the first runReview bullet. Then re-pin both seams-tangles hashes (`tests/unit/lin-4313-periodical-prompt-bytes.test.js:94`), update the change-log row (`scripts/prompt-template-change-log.md:635`), and update the PR body's Measured and DECISION sections.
- **check-168**: after Fix 1, re-run the base-vs-head real-context render before the merge.
- **Fix 2** (finding-167): delete the stray "(396821 -> 396571)…" fragment at `tests/unit/prompt-size-budget.test.js:146`.

From the facts only:
- **finding-153**: revise the store's lesson-10 wording "import-free leaf" on merge. The code and the docs Lesson are already done.

From the blind read's fix-sized finds (23:26Z) that the facts address to close-out:
- finding-173: make the retired-phrase test assert `=== 0`.
- finding-174: give `committedSearch` a tail and drop the `.slice(0, -1)`.
- finding-175: correct the lin-4313 header comment.
- finding-176: correct the `source-map.md` line for `leftover-words.js`.

The blind read lists two more fix-sized finds, `stage-kinds.js` `intent: null` and `completion-signals.js` unused exports. The facts don't address them to close-out, so I can't tell whether this stage owns them.

Also: close-out merges once the ledger is discharged.

*Read:* the 23:21Z review, the 23:26Z blind read, facts §3.

## 2. What is still open on the task, and whose is each item?

- **Close-out's:** everything listed in answer 1, and the merge of PR #2447.
- **check-155: John's**, after the deploy. A look-into token's comment POST must get a 403, and a triage token's description PATCH must get a 403. Rollback is reverting the merge commit.
- **check-148: review's.** It is still open in the facts: "watch for an undersized/oversized move". The re-review doesn't answer it in so many words.
- **The blind read's two larger finds:** the sha256 witness fixture (inside the area) and `lib/run-view.js` `STEP_KIND_WORDS` (Runs & dispatch). These are decisions for the area or Runs, not fix-sized work for close-out.
- **simple-dispatcher's restatement of the retirement-line forms:** its owner's. It is named in the llm-and-prompts Waiting entry, not edited here.
- **No John ruling is open on the task.** `lin-4469-witness` was withdrawn (see answer 3).

*Read:* facts §3 and §7 (check-155), the 23:21Z review, the 23:24Z Leftovers comment.

## 3. Does "merge waits on John's answer to `lin-4469-witness`" still hold?

**No.** The re-review (23:21Z) says `lin-4469-witness` was **withdrawn as moot at 23:17Z**, not answered. The reason: a kind that carries no folded text cannot fall. Merge now waits only on close-out discharging the ledger (Fix 1 with check-168, and Fix 2).

**Where the sources disagree:**
- decision-160 is still marked [stands] in the facts and says "Merge waits on question-159 only".
- The 23:11Z LIN-4448 comment and the 23:15Z status comment also say the ruling gates merge.

**Which I trust:** the 23:21Z re-review, because it is later and explicitly records the withdrawal. The facts back it up too: question-159 does not appear as an open item, and verdict-169 names the seams-tangles +24 as "the one miss".

*Read:* the 23:21Z review (Witness bullet), facts §4 (decision-160, verdict-169).

## 4. Does any approval or verdict cover the work as it now stands? Name the head.

**The current head is `877f32cb4`.** The Leftovers comment at 23:24Z says CI is green on it.

- **The review's approval does not cover this head.** The approval (verdict-169, "Approve — conditional on close-out discharging the ledger") was given at `05b592742`. The facts mark it **STALE**: it is on change-142@2, and the change is now @3. Between the two heads, `877f32cb4` only tidied two header comments (`leftover-words.js` and the `lin-4467-witness.js` header).
- **The blind read is the only verdict on `877f32cb4`.** verdict-172, "better", is on change-142@3. It is not a code-review approval.

So no review approval covers the current head. Even at `05b592742`, the approval was conditional on the ledger.

*Read:* facts §4 (verdict-169 STALE, verdict-172), the 23:24Z Leftovers comment, the 23:26Z blind read.

## 5. How many fix-sized finds inside the area, larger ones inside, and finds outside?

**6** fix-sized inside the area, **2** larger inside, **0** outside ("None").

Only 4 of the 6 fix-sized finds appear in the facts as close-out items (finding-173 to finding-176).

*Read:* the 23:26Z blind-read comment.

## 6. After Fix 1, what must the base-vs-head render show, and does `FROZEN_TOTAL_BYTES` change?

**The render (base `b937237a4`):**
- Every render that carries folded text falls.
- seams-tangles, and its autopilot form, shows **−2**.
- The total is **827520 → 825278 (−2242)**.
- The four `work` kinds (blocked, breakdown, close-out, retrospective-audit) stay equal. So do Stability, Recent Headwinds and Integration Surface Maturity.
- It is wrong if any non-`work` kind or Periodical that carries folded text is at ≥0.

**`FROZEN_TOTAL_BYTES` does not change.** `periodicals.js` is in no budgeted source ceiling, so it stays at **396064**.

*Read:* the 23:21Z review (Fix 1, What CI Did Not Prove), facts check-168 and finding-166.
