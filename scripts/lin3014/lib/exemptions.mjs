/**
 * scripts/lin3014/lib/exemptions.mjs (LIN-3014)
 *
 * The 5 loop-output paths where lean and non-lean legitimately differ
 * (research beat 2, `81a1b99f`, "L-D"; proved complete on real mongod in
 * beat 3, `299efc16`, step 7 B1): `promptText` (LIN-622, absent on lean),
 * `feedback` (`[]` on lean), `toolPeak` (digest value on lean, null on
 * non-lean), `telemetry.metrics` (R4-retained subset on lean, full on
 * non-lean), `lineageMetrics` (union of retained subsets on lean).
 *
 * Every OTHER path must be identical between the two builds. The equivalence
 * comparator strips exactly these 5 before running `deepStrictEqual` with no
 * normalisation — stripping any more would hide a real regression; stripping
 * fewer would fail on a difference the plan already knows about and accepts.
 */
export const LOOP_EXEMPTIONS = Object.freeze([
  'promptText',
  'feedback',
  'toolPeak',
  'telemetry.metrics',
  'lineageMetrics'
]);

/**
 * The same 5 exemptions, scoped under a session's `loops[]` array — for
 * comparing whole SESSION objects (`{sessionId, loops, telemetry, ...}`)
 * rather than a single loop.
 */
export const SESSION_LOOP_EXEMPTIONS = Object.freeze(LOOP_EXEMPTIONS.map((p) => `loops[].${p}`));

function applyStrip(node, parts) {
  if (node == null || typeof node !== 'object') return;
  const [head, ...rest] = parts;
  const arrayMatch = head.match(/^(.+)\[\]$/);
  if (arrayMatch) {
    const arr = node[arrayMatch[1]];
    if (Array.isArray(arr)) {
      for (const item of arr) applyStrip(item, rest);
    }
    return;
  }
  if (rest.length === 0) {
    delete node[head];
    return;
  }
  applyStrip(node[head], rest);
}

/**
 * Deep-clone `obj` and delete each path in `paths`. A path is dot-separated;
 * a segment written `name[]` descends into every element of an array field
 * named `name` (e.g. `'loops[].telemetry.metrics'`), which is what the
 * session-level exemptions need. A path segment that doesn't exist (or
 * isn't an object/array) is a no-op for that path — it does not throw,
 * since not every shape carries every exempted field (e.g. a loop with no
 * `telemetry` at all has nothing to strip for `telemetry.metrics`).
 *
 * @param {Object} obj
 * @param {Array<string>} paths - e.g. 'telemetry.metrics' or 'loops[].toolPeak'
 * @returns {Object} a new object with those paths removed
 */
export function stripPaths(obj, paths) {
  const clone = structuredClone(obj);
  for (const path of paths) {
    applyStrip(clone, path.split('.'));
  }
  return clone;
}
