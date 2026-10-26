/**
 * The Settings › Models page's writes (LIN-3855): what a staged form means, how each posted value is
 * checked, and the one runnable-on-harness guard that every table-changing page write passes.
 *
 * The page posts every field it shows (`c__<scope>__<surface>__<key>__<field>`, see
 * lib/components/decision-panel.js). `stagedChanges` diffs those against the stored table and keeps
 * only what differs, so one save is one set of changes, one reason and one log entry. A blank value means
 * "follow the group" (or "inherit the default"): it clears the field.
 *
 * Shape is validated here (the same rules as the proxy's, lib/model-routing-validate.js). Whether a model
 * can run on its harness is judged by `runnableGuard`, passed to the store on `applyChanges`, `applyPreset`
 * and `undo`, so a refusal names the jobs and writes nothing.
 */
import { RoutingError, FIELDS, MODEL_ID_PATTERN, currentValue } from './model-routing.js';
import { SURFACES, getJob } from './llm-jobs.js';
import { DISPATCH_HARNESS_SUGGESTIONS, runnabilityProblems } from './model-routing-harnesses.js';
import { validateOpaqueDispatchField, MAX_NAME_LENGTH } from './dispatch-validation.js';

/** What a refused page write says, in place, on the Models page or the Dispatch page's No job section (LIN-3855, LIN-3952). */
export const REFUSAL_MESSAGES = {
  CONFLICT: 'The models changed while you were editing, so nothing was saved. Your edits are still here: check them and save again.',
  REASON_REQUIRED: 'Save needs a reason: say why these models are changing.'
};

const PREFIX = 'c__';
const SCOPES = ['job', 'group', 'default'];
const MAX_HARBOUR_MODEL_LENGTH = 100;

/** Shape-check one staged value for its field. Throws INVALID with the reason. */
function checkValue({ surface, field }, value) {
  if (value === null) return;
  if (field === 'harness') {
    if (!DISPATCH_HARNESS_SUGGESTIONS.includes(value)) throw new RoutingError('INVALID', `harness must be ${DISPATCH_HARNESS_SUGGESTIONS.join(' or ')}, or blank to follow the group`);
    return;
  }
  if (field === 'model' && surface === SURFACES.HARBOUR_CALL) {
    if (value.length > MAX_HARBOUR_MODEL_LENGTH || value.includes('..') || !MODEL_ID_PATTERN.test(value)) {
      throw new RoutingError('INVALID', 'model must look like provider/model (for example anthropic/claude-sonnet-4)');
    }
    return;
  }
  const bad = validateOpaqueDispatchField(value, field, { maxLength: MAX_NAME_LENGTH });
  if (bad) throw new RoutingError('INVALID', bad.error);
}

/**
 * The changes a staged form asks for, against `table` (the table the page was rendered from, which
 * must be the one the save is judged against: the caller checks its version).
 *
 * @param {Object<string, string>} body - the posted form fields
 * @param {Object} table - the stored table
 * @returns {Array<{scope, surface, key, field, to}>}
 */
export function stagedChanges(body, table) {
  const changes = [];
  for (const [name, raw] of Object.entries(body || {})) {
    if (!name.startsWith(PREFIX)) continue;
    const [, scope, surface, key, field] = name.split('__');
    if (!SCOPES.includes(scope) || !FIELDS[surface] || !FIELDS[surface].includes(field)) {
      throw new RoutingError('INVALID', `"${name}" is not a Models field`);
    }
    if (scope === 'job') {
      const job = getJob(key);
      if (!job || job.surface !== surface) throw new RoutingError('INVALID', `no ${surface} job "${key}"`);
    }
    const to = typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : null;
    checkValue({ surface, field }, to);
    const from = currentValue(table, { scope, surface, key, field });
    if (to === from) continue;
    changes.push({ scope, surface, key, field, to });
  }
  return changes;
}

/** The message a refusal shows, naming the jobs that could not run their model. */
export function runnableMessage(problems) {
  const names = problems.map((p) => (p.job === null ? 'the Dispatch default' : p.job));
  return `These could not run the model on their harness: ${names.join(', ')}. Nothing was changed. Pick a harness that runs that model, or a model that runs on the harness.`;
}

/**
 * The store's guard for every table-changing page write: refuses (INVALID, with the problems) when a
 * changed job's (harness in force, model) pair cannot run. `{ check }` is passed as the store's guard.
 */
export function runnableGuard() {
  return {
    check: (before, after) => {
      const problems = runnabilityProblems(before, after);
      if (problems.length) throw new RoutingError('INVALID', runnableMessage(problems), { problems });
    }
  };
}
