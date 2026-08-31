/**
 * Shared chat-transcript predicate (LIN-2430).
 *
 * The one filtering rule task-chat's `sanitizeHistory` and saved-chat-store's
 * `sanitizeTranscript` have in common: only user/assistant turns with string
 * content survive. Callers apply their own boundary-specific rules on top
 * (task-chat: none, unclamped live replay; saved-chat-store: durability
 * clamps) — this module owns only the shared predicate.
 */

export function filterChatTurns(list) {
  return Array.isArray(list)
    ? list.filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    : [];
}
