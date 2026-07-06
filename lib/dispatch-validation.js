/**
 * Shared validation for opaque dispatch execution fields (`model`, `harness`).
 *
 * Both `routes/proxy.js` and `routes/dispatch.js` independently hand-rolled the
 * same type/length/dangerous-chars checks for `model`, and drifted: the proxy
 * path rejected `model: 0` (a falsy non-string) while the dispatch path silently
 * accepted it as absent. This helper is the single source of truth going
 * forward — used by both routers for both fields — so the two paths can no
 * longer diverge. See LIN-1084.
 */

const MAX_NAME_LENGTH = 1000;
const DANGEROUS_CHARS_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

/**
 * Validates an opaque dispatch execution field (e.g. `model`, `harness`).
 * `undefined`/`null` are treated as "absent" and are always valid — the field
 * is optional/nullable at every seam it flows through.
 *
 * @param {*} value - The field value to validate
 * @param {string} fieldName - Field name, used in the returned error message
 * @param {{maxLength?: number}} [options]
 * @returns {{error: string}|null} An error object, or null when valid
 */
function validateOpaqueDispatchField(value, fieldName, { maxLength = MAX_NAME_LENGTH } = {}) {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    return { error: `${fieldName} must be a string` };
  }
  if (value.length > maxLength) {
    return { error: `${fieldName} exceeds maximum length of ${maxLength}` };
  }
  if (DANGEROUS_CHARS_REGEX.test(value)) {
    return { error: `${fieldName} contains invalid characters` };
  }
  return null;
}

export { validateOpaqueDispatchField, MAX_NAME_LENGTH, DANGEROUS_CHARS_REGEX };
