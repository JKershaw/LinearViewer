/**
 * The Settings sidebar's state for Models (LIN-3855, LIN-3952). Two labels, one per question the sidebar answers:
 *
 *  - `summariseSpend`: on Models, the model that carries the most priced spend (LIN-3952 item 5). Spend is read
 *    only on Models (routes/settings.js), so this is the label Models itself shows.
 *  - `summariseRouting`: on every other Settings area, a spend-free label from the effective table, so those pages
 *    add no spend read. One model in use names it; several read "N models".
 *
 * The label is fitted to STATE_MAX_LENGTH: the name is clipped and any ` +N` suffix is never cut.
 */
/**
 * The sidebar's state width (lib/settings-areas.js STATE_MAX_LENGTH). It is passed in by the route rather than
 * imported, so this model-routing module does not depend on the Settings pages.
 */
export const SIDEBAR_STATE_WIDTH = 16;

const NO_MODEL = 'Not set';
const NO_SPEND = 'No priced runs';

/**
 * @param {Array<{ model: string|null }>} effectiveRows - `effectiveTable(...).jobs`, every job.
 * @param {(model: string) => string} nameOf - a display name (getModelDisplayName).
 * @param {{ width?: number }} [opts]
 * @returns {string} e.g. "Claude Sonnet 5.5", "3 models", or "Not set" when no job names a model.
 */
export function summariseRouting(effectiveRows, nameOf, { width = SIDEBAR_STATE_WIDTH } = {}) {
  const models = [...new Set((effectiveRows || []).map((row) => row.model).filter(Boolean))];
  if (models.length === 0) return NO_MODEL;
  if (models.length === 1) return fit(nameOf(models[0]), 0, width);
  return fit(`${models.length} models`, 0, width);
}

/**
 * @param {Array<{ model: string, spendUsd: number }>} spendByModel - `spendByEffectiveModel(...)`, largest first.
 * @param {(model: string) => string} nameOf - a display name (getModelDisplayName).
 * @param {{ width?: number }} [opts]
 * @returns {string} the top model's name, or "No priced runs".
 */
export function summariseSpend(spendByModel, nameOf, { width = SIDEBAR_STATE_WIDTH } = {}) {
  const top = (spendByModel || [])[0];
  if (!top) return NO_SPEND;
  return fit(nameOf(top.model), 0, width);
}

/** `name` clipped, then ` +N` appended, within `width`. The suffix always survives; the name gives way first. */
export function fit(name, others, width = SIDEBAR_STATE_WIDTH) {
  const suffix = others > 0 ? ` +${others}` : '';
  const room = width - suffix.length;
  const text = name.length > room ? `${name.slice(0, Math.max(room - 1, 0))}…` : name;
  return `${text}${suffix}`;
}
