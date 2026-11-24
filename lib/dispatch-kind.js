/**
 * LIN-4416: the kind a dispatch row is stored with: its own `kind`, else the kind its promptName derives
 * (lib/prompt-templates.js deriveDispatchKind, case- and separator-blind over template keys and display names). The one
 * expression of it, moved here from lib/dispatch-factory.js: the factory stores it, and the session lane's close-out guard
 * and the proxy lane's judging-run refusal (lib/dispatch-entrance.js) ask it, so no request shape (kind left out, an alias
 * spelling of promptName, a followUpTo) can be read as one kind by a check and stored as another.
 *
 * Its own module, not prompt-templates.js beside deriveDispatchKind: that file's source bytes are frozen as prompt text
 * (tests/unit/prompt-size-budget.test.js), and this is dispatch code.
 */
import { deriveDispatchKind } from './prompt-templates.js';

/**
 * @param {{kind?: string|null, promptName?: string|null}} [row]
 * @returns {string} the row's own kind (the kind step has validated it), else a value from DISPATCH_KINDS
 */
export function effectiveDispatchKind({ kind, promptName } = {}) {
  return kind || deriveDispatchKind(promptName);
}
