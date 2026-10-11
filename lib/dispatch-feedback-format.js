/**
 * Formats a raw feedback array (as stored on a history doc) for API
 * response: `{message, url, urlLabel, timestamp: <ISO string>}`, plus
 * `rootItemId` when the entry carries one (LIN-1468) and `kind` when the
 * entry carries one (LIN-1475), additive-only (LIN-1297 idiom) — never
 * `rootItemId: null`/`kind: null` for an entry that lacks them.
 *
 * Promoted to a module-level export (LIN-3008/LIN-2996 Phase 0) so
 * `lib/digest-feedback.js`'s `digestFeedback` can reuse the EXACT same
 * formatter `_formatHistoryItem` already uses — never a second, independently
 * maintained copy that could silently diverge (the same discipline this
 * codebase already applies to `TERMINAL_FEEDBACK_REGEX`, shared via
 * `dispatch-terminal.js`'s `__internal`). `DispatchQueueStore`'s own
 * `_formatFeedbackEntries` method is a thin delegate onto this function, so
 * `_formatHistoryItem`/`_collectGroupFeedback` are unaffected.
 *
 * @param {Array} feedback - raw feedback entries (Mongo shape)
 * @returns {Array} formatted entries
 */
export function formatFeedbackEntries(feedback) {
  return (feedback || []).map(f => {
    const entry = {
      message: f.message,
      url: f.url || null,
      urlLabel: f.urlLabel || null,
      timestamp: f.timestamp?.toISOString?.() || f.timestamp
    };
    // Additive-only (LIN-1297 idiom): assign only when present, never emit
    // `rootItemId: null` for an entry that lacks it (LIN-1468).
    if (f.rootItemId) entry.rootItemId = f.rootItemId;
    // Additive-only (LIN-1297 idiom): assign only when present, never emit
    // `kind: null` for an entry that lacks it (LIN-1475).
    if (f.kind) entry.kind = f.kind;
    return entry;
  });
}
