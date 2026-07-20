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
 * Input-scope contract (LIN-1478): callers MUST pass exactly one session's
 * loops. This function has no session boundary of its own — it trusts the
 * caller's array. Widening the input to include a loop from a different
 * session silently supersedes a same-id-named loop in the wrong session's
 * lineage (the tests/unit/loop-supersede.test.js cross-session scope pin
 * exists to catch exactly this mutation). Never call this with a merged
 * cross-session or cross-lineage loop set.
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
