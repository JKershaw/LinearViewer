/**
 * Recommendation kind guard (LIN-3309).
 *
 * `parseRecommendedAction` is a pure extractor that returns whatever token it finds;
 * the two DECIDERS — the routing parse and the full-mode parse — share this check so
 * an action deliberately excluded from AI recommendation (`retro`) is refused in
 * both modes. Kept out of the frozen `lib/prompt-templates.js`. Hand-only is a template's
 * own `route: null` (LIN-4253), so there is one declaration and no name list here.
 */
import { deriveDispatchKind, PROMPT_TEMPLATES } from './prompt-templates.js';

/**
 * @param {string} action - The display name parsed from a reply
 * @returns {string} The action, unchanged, when allowed
 * @throws {Error} when the action's kind is excluded from recommendation
 */
export function rejectExcludedKind(action) {
  // `=== null`, not a falsy route: a meta kind with no template at all (`defer`) has no route and stays allowed.
  if (PROMPT_TEMPLATES[deriveDispatchKind(action)]?.route === null) {
    throw new Error(`Invalid response: "${action}" cannot be recommended`)
  }
  return action
}
