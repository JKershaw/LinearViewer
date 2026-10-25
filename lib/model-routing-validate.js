/**
 * Shape validation for a model-routing write (LIN-3855). `readPatch` and `readReason` were
 * the proxy's (routes/proxy-model-routing.js, LIN-3854); the Settings page's session routes
 * validate the same way, so both read one copy. Shape only, as before: whether a model can
 * run on its harness is a separate check (lib/model-routing-harnesses.js), made by the page.
 */
import { SURFACES } from './llm-jobs.js';
import { FIELDS, MAX_REASON_LENGTH, MODEL_ID_PATTERN } from './model-routing.js';
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from './dispatch-validation.js';

const MAX_HARBOUR_MODEL_LENGTH = 100;

/** Validate the settings in a body for one surface: `{ patch }` or `{ error }`. Shape only. */
export function readPatch(body, surface) {
  const allowed = FIELDS[surface];
  const patch = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'reason' || key === 'surface') continue;
    if (!allowed.includes(key)) return { error: `${surface} settings have no "${key}" field; allowed: ${allowed.join(', ')}` };
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') return { error: `${key} must be a string, or null to clear it` };
    if (value !== null) {
      if (surface === SURFACES.HARBOUR_CALL) {
        if (value.length > MAX_HARBOUR_MODEL_LENGTH || value.includes('..') || !MODEL_ID_PATTERN.test(value)) {
          return { error: 'model must look like provider/model (for example anthropic/claude-sonnet-4)' };
        }
      } else {
        if (value.trim() === '') return { error: `${key} must not be blank; send null to clear it` };
        const bad = validateOpaqueDispatchField(value, key, { maxLength: MAX_NAME_LENGTH });
        if (bad) return { error: bad.error };
      }
    }
    patch[key] = value;
  }
  if (Object.keys(patch).length === 0) return { error: `nothing to change: send at least one of ${allowed.join(', ')}` };
  return { patch };
}

export function readReason(body) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return { error: 'reason is required: say why the model is changing' };
  if (reason.length > MAX_REASON_LENGTH) return { error: `reason is at most ${MAX_REASON_LENGTH} characters` };
  return { reason };
}

