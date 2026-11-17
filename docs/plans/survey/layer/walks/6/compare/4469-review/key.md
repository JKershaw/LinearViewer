# Key: LIN-4469, second review, as of 2026-11-13T23:17:09Z

At this moment LIN-4469 is In Progress. Its description is `## As asked` plus `## Current` (the look-into ruling bdcd3128). It has eight comments: the budget condition (21:49:17), the implementation summary (22:58:22), John's ruling (23:03:14), the first review (23:03:57), the autopilot's engineering settlement (23:05:04), Leftovers (23:11:39), "PR and status" (23:15:58) and "Follow-up on PR #2447" (23:16:04). The parent LIN-4448 has the piece-5 note 8933968d (23:11:46). PR #2447 is open, head `05b592742`. Nothing from the blind read or close-out exists yet, and the leftover follow-up's comment (23:24:42) has not landed.

## 1. What is addressed to this stage to act on?

**Answer:** Re-review PR #2447 at head `05b592742` against the `## As asked`, checking that the second build did what was handed to it:
- (a) the fold of the guard-refused tracker clauses in the four sibling places, `lib/prompt-template-defs.js` survey-task (~975), survey-place (~994), blind-read (~1065) and triage (~268, scope rule kept), with ceilings and a lower `FROZEN_TOTAL_BYTES` re-pinned;
- (b) the first review's Fixes 1–5;
- (c) a `### Leftovers` answer whose `Retires:` line names an entry the diff removes;
- (d) the corrected "eleven unchanged" figures in the PR's decision text, the change-log row and the LIN-4350 comment.

The comments report (a), (c), Fix 1, Fix 3 (the LIN-4448 note) and Fix 4 as done. Fix 5 (the leaf's import and the Lesson wording) and the LIN-4350 correction are reported nowhere, so they must be checked on the PR. The new `seams-tangles` +24 is also for this stage to judge.

**Shown in:** settlement comment fab0cf08 (23:05:04, "For the next build step"); first review 39207a24 (23:03:57, "Fixes for close-out" 1–5); Leftovers bbc2b1c7 (23:11:39); "PR and status" a8749d0b (23:15:58, "Done in this pass", "Measured"); "Follow-up" ec59bd26 (23:16:04, commit `04bb47598`); LIN-4448 note 8933968d (23:11:46).

## 2. What is still open on the task, and whose is each item?

**Answer:**
- The ruling `lin-4469-witness` on "a net fall across every kind" (the four `work` kinds, and per a8749d0b the `seams-tangles` +24): **John's**. Merge waits on it. (It was withdrawn as moot at 23:17:16, seven seconds after this stage started; nothing on the ticket shows that yet.)
- Reviewing PR #2447 at `05b592742`, then merging it: this review, then close-out.
- The post-deploy 403 checks (a look-into token's comment POST, a triage token's description PATCH): after the deploy; not verified; no owner named beyond "after the deploy".
- Simple-dispatcher's copies of the retirement-line forms: **that repo's owner**; named in the llm-and-prompts Waiting entry, not edited.
- LIN-4350: stays open and is not absorbed (it spans two repos); this piece only reports to it.

**Shown in:** fab0cf08 ("Still John's", "Merge waits on that answer"); a8749d0b ("Open before merge", "Not verified"); LIN-4448 8933968d ("gates merge"); first review 39207a24 ("What CI Did Not Prove", "Settle after the deploy"); bbc2b1c7 ("Outside this area"); the `## As asked` "LIN-4350" paragraph.

## 3. The builder recommended `accept` on the ruling `lin-4469-cuts`. What was decided, and does it still hold?

**Answer:** John answered **`fold`**, not `accept`, at 23:03:14: fold the guarded clause in the survey-task, survey-place and blind-read templates too. It holds, and it was widened: the autopilot's settlement also folds triage's write clauses (line ~268; its scope rule stays) as the same class (LIN-2825/LIN-3006), with the code, branch and PR words kept. The first review (23:03:57) still treated `lin-4469-cuts` as open; it had been answered 43 seconds earlier. The ruling's "11 kinds byte-identical" fact was wrong, so the witness half moved to a new ruling, `lin-4469-witness`.

**Shown in:** implementation summary cc7fbe5d (22:58:22, DECISION 1–2 and recommendations); John's comment 62f57ef4 (23:03:14, "Fold the guarded clause…"); first review 39207a24 ("The open ruling `lin-4469-cuts`…"); settlement fab0cf08.

## 4. Does any approval or verdict cover the work as it now stands (the PR's current head)? Name the head.

**Answer:** No. The head is `05b592742`. The only verdict on the code is the first review's **Needs Discussion**, at `3533f37c2`; two commits have landed since (`04bb47598`, `05b592742`). LIN-4448's Plan Review Verdict (Approve, rev 1) covers the plan, not the PR. CI is green on `05b592742` (run 43525065043), which is not an approval.

**Shown in:** first review 39207a24 (head `3533f37c2`, "Verdict: Needs Discussion"); a8749d0b (head `05b592742`, CI run); ec59bd26 (commit `04bb47598`, CI on `05b592742`); description ("Plan-review due: no — covered by LIN-4448's approving plan-review … rev 1").

## 5. What `FROZEN_TOTAL_BYTES` does the branch carry now, and what figure must it be below?

**Answer:** **396064**, equal to the ceilings' sum (396884 on main). It must be below **396575**, the condition from LIN-4467's budget raise. 396559 is the first pass's figure, and ec59bd26's 396419 is an intermediate figure that the later re-pin superseded.

**Shown in:** condition comment a77d9b51 (21:49:17, "below 396575"); cc7fbe5d (396884 → 396559); ec59bd26 (396559 → 396419); a8749d0b (23:15:58, "re-pin to `FROZEN_TOTAL_BYTES` 396064"); LIN-4448 8933968d (396064, "396884 on main").

## 6. In real context (proxy preamble included), how many stage kinds stay byte-identical, and does anything rise?

**Answer:** **Four**: the `work` kinds blocked, breakdown, close-out and retrospective-audit. One render rises: **`seams-tangles` +24**. The total falls 827520 → 825330 (**−2190**). It is not 11 (the builder's first figure and the old ruling text) and not 8 (ec59bd26, which is stale).

**Shown in:** first review 39207a24 (per-`writes` deltas, "7 of the '11 unchanged' kinds do fall"); settlement fab0cf08 (the four `work` kinds); a8749d0b ("Measured"); LIN-4448 8933968d; contrast cc7fbe5d (11) and ec59bd26 ("eight kinds").
