# Key: LIN-4469, close-out stage, as of 2026-11-13T23:26:58Z

At this moment LIN-4469 is In Progress. Its description is `## As asked` plus `## Current` (the look-into ruling bdcd3128). Since the second review started, three comments have landed: the re-review 042f607d (23:21:48, Approve, conditional), a second `### Leftovers` a2efc9a8 (23:24:42, head `877f32cb4`) and the `## Blind read` d96c0849 (23:26:25). The ruling `lin-4469-witness` was withdrawn at 23:17:16. PR #2447 is open and not merged. The parent LIN-4448 is In Progress.

## 1. What is addressed to this stage to act on?

**Answer:** Discharge the re-review's ledger, then merge:
- **Fix 1:** in `lib/periodicals.js`, Seams & Tangles' first runReview bullet, drop the hand-typed "(no path is written here)" (back to main's words). Then re-pin both `seams-tangles` hashes, and update the change-log row and the PR body's Measured and DECISION sections (−2242; `lin-4469-witness` withdrawn as moot).
- **Fix 2:** delete the stray "(396821 -> 396571), the rest was unused headroom." fragment in `tests/unit/prompt-size-budget.test.js`.
- Before merging, re-run a base-vs-head render to show the witness.
- After the deploy, run the live 403 checks (a look-into token's comment POST, a triage token's description PATCH), with rollback by reverting the merge commit.

Also handle the blind read's finds. The latest Leftovers says "For close-out: none", but the review and the blind read both hand work over.

**Shown in:** re-review 042f607d (23:21:48, "Fixes for close-out" 1–2, "What CI Did Not Prove", "Verdict: Approve — conditional on close-out discharging the ledger"); Blind read d96c0849 (23:26:25); Leftovers a2efc9a8 (23:24:42, "For close-out: none").

## 2. What is still open on the task, and whose is each item?

**Answer:**
- Fixes 1–2, the re-render and the merge of PR #2447: **close-out**.
- The post-deploy 403 checks: after the deploy. The review names no owner, so close-out carries them or hands them to a person.
- The blind read's six fix-sized finds and two larger finds (the witness fixture's hashes; `run-view.js`'s `STEP_KIND_WORDS`): **close-out**, to fix or give a home.
- Simple-dispatcher's retirement-line copies: **that repo's owner**; named in the llm-and-prompts Waiting entry.
- LIN-4350: stays open (it spans two repos); this piece only reports to it.
- LIN-4470 (piece 6): its own piece, blocked by this one.
- The Survey completion criteria (`stage-kinds.js` ~534/559): marked outside by both reviews.

No ruling for John is open: `lin-4469-cuts` was answered and `lin-4469-witness` was withdrawn.

**Shown in:** 042f607d (Fixes, ledger, "Isolated, or one of a class?"); d96c0849 (the three sections); a2efc9a8 ("Noted, already in a note"); the `## As asked` "LIN-4350" paragraph; LIN-4469's relations (blocks LIN-4470).

## 3. The autopilot said merge waits on John's answer to `lin-4469-witness`. Does that still hold?

**Answer:** No. `lin-4469-witness` was **withdrawn as moot** at 23:17:16, never answered. The reason: John answered `lin-4469-cuts` with `fold`, and a kind carrying no folded text needs no ruling to stay flat. The re-review reads the witness sentence as met for the four `work` kinds. The `seams-tangles` +24 is covered by no ruling; it is self-inflicted, and Fix 1 removes it. Merge now waits on the ledger, not on John.

**Shown in:** settlement fab0cf08 (23:05:04, "Merge waits on that answer"); a8749d0b ("Open before merge: John's ruling `lin-4469-witness`"); re-review 042f607d ("`lin-4469-witness` was **withdrawn** as moot at 23:17Z, not answered", "No ruling covers it").

## 4. Does any approval or verdict cover the work as it now stands (the PR's current head)? Name the head.

**Answer:** Only partly. The re-review is **Approve, conditional on close-out discharging the ledger**, but it was given at `05b592742`. The current head is **`877f32cb4`**: the leftover follow-up added two header tidies after that, and they were not re-reviewed. The blind read read `877f32cb4`, but its verdict ("better") is not a review approval. CI is green on `877f32cb4`. The ledger (Fixes 1–2 and the re-render) is not discharged yet.

**Shown in:** re-review 042f607d (head `05b592742`, Verdict); Leftovers a2efc9a8 (head `877f32cb4`, CI green, the two "Tidied" lines); Blind read d96c0849 ("at `877f32cb4` against `b937237a4`").

## 5. How many fix-sized finds inside the area does the blind read list, how many larger ones, and how many outside?

**Answer:** **6** fix-sized:
1. the folds test asserts `<= 1`;
2. `committedSearch`'s `.slice(0, -1)`;
3. the lin-4313 header comment;
4. `source-map.md`'s leaf line;
5. `stage-kinds.js`'s `intent: null` overwrite;
6. `completion-signals.js`'s six unused exports.

**2** larger: the witness fixture's hashes and `run-view.js`'s `STEP_KIND_WORDS`. **0** outside.

**Shown in:** Blind read d96c0849 (23:26:25), "Inside the area, fix-sized", "Inside the area, larger", "Outside the area: None".

## 6. After review Fix 1, what must the base-vs-head real-context render show, and does `FROZEN_TOTAL_BYTES` change?

**Answer:** The total goes 827520 → **825278 (−2242)**, and `seams-tangles` shows **−2**, not +24. No non-`work` kind or Periodical that carries folded text may be at ≥0. `FROZEN_TOTAL_BYTES` stays **396064**, because `periodicals.js` is not in a budgeted source ceiling. Quoting −2190, +24 or 396419 (ec59bd26, stale) would be wrong.

**Shown in:** re-review 042f607d ("Independent measurement", the probe "−2", "−2242"; Fix 1's last bullet; "What CI Did Not Prove", Right/Wrong; "Stale comment, superseded").
