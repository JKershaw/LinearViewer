/**
 * Shared Accent Bar Primitive (LIN-786, Theme S2 §9)
 *
 * A thin (3px) status stripe — pure `renderAccentBar() → HTML string`,
 * token-only. The standalone sibling of `card`'s left-border accent: where a
 * card paints the accent on its own edge, this is a free-standing rule any
 * surface can place (e.g. the top of a session card in LIN-783). State maps to
 * the same colour vocabulary as the run-status pill (`running → --amber`,
 * `done → --green`, `error → --red`, `queued → --slate`, plus the issue-state
 * names for parity with `card`).
 *
 * Decorative by default (`aria-hidden`), since the colour repeats information a
 * sibling label already carries — never the sole state signal. Pass `label` to
 * expose an accessible name when the bar stands alone.
 *
 * @param {Object} opts
 * @param {string} opts.state - State colour (run-status or issue-state name).
 * @param {string} [opts.label] - Accessible name (when the bar conveys state alone).
 * @param {'vertical'} [opts.orientation] - Render as a vertical (left-edge) stripe.
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 * @returns {string} Accent-bar HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderAccentBar({ state, label, orientation, className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(state)) {
    throw new Error('renderAccentBar requires a `state`.');
  }
  const classes = ['accent-bar', `accent-bar--${state}`];
  if (orientation === 'vertical') classes.push('accent-bar--vertical');
  if (className) classes.push(className);

  const a11yAttr = has(label)
    ? ` role="img" aria-label="${escapeHtml(label)}"`
    : ' aria-hidden="true"';
  const attrStr = attrs ? ` ${attrs}` : '';

  return `<span class="${classes.join(' ')}"${a11yAttr}${attrStr}></span>`;
}
