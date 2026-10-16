/**
 * Pure helpers shared by the three dispatch entrances (routes/dispatch.js,
 * routes/proxy-dispatch.js, routes/proxy-kickoff.js; LIN-3592).
 *
 * Every entrance validates a body field by field and answers the FIRST failure,
 * so the order of the checks is part of the contract. These helpers let a route
 * write that order down once, as a list, instead of as a run of `if (...) { log;
 * return reject; }` blocks.
 *
 * Deliberately pure: no store, no mint, no response, no registration. Each
 * entrance keeps its own reads, enqueue calls, credential mints, gates and
 * replies, because the source-text censuses pin them by the route they sit in.
 */
import { validateOpaqueDispatchField } from './dispatch-validation.js';

/**
 * Run the checks in order and return the first failure message, or null.
 * A check returns a message (or a falsy value for "fine"), and may be async —
 * a check may read a store, as the preset lookup does. Later checks do not run
 * once one has failed, so an earlier failure never spends a later read.
 *
 * @param {Array<() => (string|null|undefined|false|Promise<string|null|undefined|false>)>} checks
 * @returns {Promise<string|null>}
 */
export async function firstFailure(checks) {
  for (const check of checks) {
    const message = await check();
    if (message) return message;
  }
  return null;
}

/**
 * The reject text for an opaque string field (model, harness, effort, repo, ...),
 * or null when the value is fine. `validateOpaqueDispatchField` answers
 * `{ error }`; every entrance wants only the text.
 *
 * @param {*} value
 * @param {string} name
 * @param {{maxLength?: number, reportReceivedLength?: boolean}} [options]
 * @returns {string|null}
 */
export function opaqueFieldError(value, name, options) {
  return validateOpaqueDispatchField(value, name, options)?.error ?? null;
}
