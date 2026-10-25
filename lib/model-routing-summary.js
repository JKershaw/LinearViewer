/**
 * The Models sidebar summary (LIN-3855). The sidebar used to show one model, the job-less default
 * `defaults['harbour-call']`, which no running Harbour call reads (every call resolves by its own
 * job, then its group). The summary now comes from the effective table: the model most jobs run
 * on, and how many other models are in use.
 *
 * Counted by jobs, not spend (an open question on the ticket). Ties go to the model the registry
 * meets first. A job with no stored model counts as `default`. The label is fitted to
 * STATE_MAX_LENGTH: the name is clipped and the ` +N` suffix is never cut.
 */
import { STATE_MAX_LENGTH } from './settings-areas.js';

const DEFAULT_LABEL = 'Default';

/**
 * @param {Array<{ model: string|null }>} effectiveRows - `effectiveTable(...).jobs`, every job.
 * @param {(model: string) => string} nameOf - a display name: catalog cache, then AVAILABLE_MODELS, then the slug.
 * @returns {string} e.g. "GPT-6.1 Sol +2", or "Default" when no job is listed.
 */
export function summariseRouting(effectiveRows, nameOf) {
  const counts = new Map();
  for (const row of effectiveRows || []) {
    const key = row.model || '';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return DEFAULT_LABEL;

  let top = null;
  for (const [model, n] of counts) {
    if (top === null || n > counts.get(top)) top = model;
  }
  const others = counts.size - 1;
  const name = top ? nameOf(top) : DEFAULT_LABEL;
  return fit(name, others);
}

/** `name` clipped, then ` +N` appended. The suffix always survives; the name gives way first. */
export function fit(name, others) {
  const suffix = others > 0 ? ` +${others}` : '';
  const room = STATE_MAX_LENGTH - suffix.length;
  const text = name.length > room ? `${name.slice(0, Math.max(room - 1, 0))}…` : name;
  return `${text}${suffix}`;
}
