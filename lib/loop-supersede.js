/**
 * Loop supersede — the parent-pointer set built from `followUpTo` (LIN-1163
 * close-out, LIN-1341 RC2): a reply to a blocked run creates a NEW loop with
 * `followUpTo` set to the original's id, but the original's own feedback is
 * append-only and never touched — so its last marker stays
 * `[blocked]`/`[pending]` forever. A loop named by another loop's `followUpTo`
 * is EXCLUDED from "waiting" — it has since been replied to.
 *
 * Two consumers, same rule, different granularity:
 *   - `routes/dashboard.js`'s `deriveSessionWaiting` — excludes a superseded
 *     loop from the session-WIDE waiting rollup.
 *   - `lib/render-session.js`'s `runIsWaiting` — excludes a superseded loop
 *     from the PER-RUN collapsed-card waiting flag.
 *
 * Input-scope contract (LIN-1478; amended by LIN-1728 close-out). What this
 * function actually requires is that every `loopId` reachable in the input set
 * is UNIQUE: it has no session boundary of its own, it trusts the caller's
 * array, and a duplicated id silently supersedes the wrong lineage's loop (the
 * tests/unit/loop-supersede.test.js cross-session scope pin exists to catch
 * exactly this mutation).
 *
 * "Exactly one session's loops" is the SUFFICIENT condition that guarantees
 * uniqueness, and stays the default any caller should reach for. It is not the
 * necessary one, and this docstring previously overstated it as such. A merged
 * set is equally safe when its ids are globally unique — which the
 * dispatch-backed loop builder does guarantee: `loopId` is the dispatch history
 * item's own `_id` (`lib/pipeline-loops.js:371,392`), a UUID, so a `followUpTo`
 * minted in one session, or in one workspace, cannot collide with a `loopId` in
 * another.
 *
 * One caller is sanctioned on exactly that argument: `collectUnansweredDecisions`
 * (`lib/unanswered-decisions.js`, LIN-1728) passes a merged CROSS-WORKSPACE loop
 * set, deliberately and correctly. It is not a violation of this contract — the
 * blanket "never call this with a merged cross-session set" that used to sit here
 * had a live counter-example and was false as written.
 *
 * A NEW merged-set caller must make the uniqueness argument explicitly rather
 * than inherit it. In particular, a caller whose loops are not dispatch-backed —
 * so whose `loopId` is something other than a dispatch item id — does not get it
 * for free, and should pass one session's loops at a time.
 *
 * @param {Array<Object>} loops
 * @returns {Set<string>} loopIds superseded by a follow-up within the input set
 */
export function computeSupersededLoopIds(loops) {
  const superseded = new Set();
  for (const l of loops) {
    if (l && l.followUpTo) superseded.add(l.followUpTo);
  }
  return superseded;
}
