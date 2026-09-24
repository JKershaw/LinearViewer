/**
 * LIN-3011 (LIN-2996 Phase 3) test seam: the lean `_buildLoops` path now
 * derives ONLY from a row's persisted `feedbackDigest`, never a re-scan of
 * raw `feedback` (production Mongo excludes it entirely under the new
 * `{prompt:0, feedback:0}` projection). Many pre-existing mock `listHistory`
 * implementations across this test suite predate `feedbackVersion`/
 * `feedbackDigest` and simply ignore the projection option, always returning
 * whatever raw `feedback` their fixture set — which the lean build no longer
 * reads. `withFreshDigests` attaches a FRESH digest, computed from each
 * item's own `feedback` (the exact same per-row derivation `_buildLoops`'s
 * non-lean path and the real digest writers use — `lib/digest-feedback.js`'s
 * `digestFeedback`), so a mock `listHistory` can keep returning full items
 * and still exercise real lean derivation instead of silently reading
 * nothing. Skips any item that already carries `feedbackVersion`/
 * `feedbackDigest` (an explicit test of staleness/legacy shapes), so it never
 * overrides a fixture that deliberately controls those fields itself.
 */
import { digestFeedback } from '../../lib/digest-feedback.js';

export function withFreshDigests(items) {
  return (items || []).map(item => {
    if (!item || 'feedbackDigest' in item || 'feedbackVersion' in item) return item;
    const digest = digestFeedback({ feedback: item.feedback, dispatchedAt: item.dispatchedAt }, { now: Date.now() });
    digest.version = 0;
    return { ...item, feedbackVersion: 0, feedbackDigest: digest };
  });
}
