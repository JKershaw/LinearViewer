/**
 * Recommendation kind guard (LIN-3309).
 *
 * `parseRecommendedAction` is a pure extractor that returns whatever token it finds;
 * the two DECIDERS — the routing parse and the full-mode parse — share this check so
 * an action deliberately excluded from AI recommendation (`retro`) is refused in
 * both modes. Kept out of the frozen `lib/prompt-templates.js`; the excluded set
 * itself stays defined there, so there is one source for the vocabulary.
 */
import { deriveDispatchKind, EXCLUDED_FROM_AI_RECOMMENDATION } from './prompt-templates.js';

/**
 * @param {string} action - The display name parsed from a reply
 * @returns {string} The action, unchanged, when allowed
 * @throws {Error} when the action's kind is excluded from recommendation
 */
export function rejectExcludedKind(action) {
  if (EXCLUDED_FROM_AI_RECOMMENDATION.has(deriveDispatchKind(action))) {
    throw new Error(`Invalid response: "${action}" cannot be recommended`)
  }
  return action
}
