/**
 * Shared Button Primitive (LIN-786, Theme S2)
 *
 * A pure `renderButton() → HTML string` helper in the card/status-pill idiom —
 * no framework, no build step. Theme-owned and page-agnostic: it reads tokens
 * only and carries no page logic, so any surface (and LIN-783's Observation
 * composition) can drop it in.
 *
 * Canonical look lives in `public/style.css` on semantic tokens:
 *   .btn              the base control — token border, --raised fill, --text
 *   .btn--primary     filled brand action; ≥40px touch target (a11y floor)
 *   .btn--ghost       borderless, transparent-until-hover variant
 *   .btn--quiet       chromeless tinted label, WITHOUT `.btn` (its geometry is the label's)
 *   .btn--green|blue|red   a tone: bordered with `.btn`, or tinted with `.btn--quiet`
 *
 * Variants stack: `variant: 'primary'` adds `.btn--primary`. `quiet: true` drops the `btn` base
 * and emits `btn--quiet`, the look the live Dispatch, Proxy and Settings buttons use; `tone` adds
 * one of green, blue or red to either look. Any other tone throws. The global S1
 * `:focus-visible` ring covers it for free — the primitive NEVER sets
 * `outline:none`. `label` is escaped (plain text in). `icon` is RAW HTML (an
 * inline `<svg>` from `renderIcon`, the caller's trusted markup) rendered before
 * the label. `as: 'a'` renders an anchor (pass `href` via `attrs`) for link-
 * styled actions. `className`/`attrs` extend the element (semantic/E2E hook).
 *
 * @param {Object} opts
 * @param {string} [opts.label] - Button text (escaped).
 * @param {'primary'|'ghost'} [opts.variant] - Visual variant.
 * @param {boolean} [opts.quiet] - Chromeless look: `btn--quiet` with no `btn` base class.
 * @param {'green'|'blue'|'red'} [opts.tone] - Tone class (`btn--<tone>`); with `quiet`, the tinted quiet tone.
 * @param {string} [opts.icon] - Leading icon markup (raw, e.g. renderIcon()).
 * @param {'button'|'submit'|'reset'} [opts.type] - Button type (default 'button'; ignored when as:'a').
 * @param {'button'|'a'} [opts.as] - Element to render (default 'button').
 * @param {boolean} [opts.disabled] - Disable the button.
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 * @returns {string} Button HTML.
 */
import { escapeHtml } from '../utils/html.js';

// The named tones the live buttons carry. `teal` is retired (lin-3890-dead-button-classes.test.js).
const TONES = ['green', 'blue', 'red'];

export function renderButton({
  label,
  variant,
  quiet = false,
  tone,
  icon,
  type = 'button',
  as = 'button',
  disabled,
  className,
  attrs,
} = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(label) && !has(icon)) {
    throw new Error('renderButton requires at least one of `label` or `icon`.');
  }

  if (tone != null && !TONES.includes(tone)) {
    throw new Error(`renderButton tone must be one of ${TONES.join(', ')}; got "${tone}".`);
  }

  const classes = quiet ? ['btn--quiet'] : ['btn'];
  if (variant) classes.push(`btn--${variant}`);
  if (tone) classes.push(`btn--${tone}`);
  if (className) classes.push(className);

  const iconHtml = has(icon) ? `<span class="btn__icon" aria-hidden="true">${icon}</span>` : '';
  const labelHtml = has(label) ? `<span class="btn__label">${escapeHtml(label)}</span>` : '';
  const attrStr = attrs ? ` ${attrs}` : '';

  if (as === 'a') {
    return `<a class="${classes.join(' ')}"${attrStr}>${iconHtml}${labelHtml}</a>`;
  }
  const disabledAttr = disabled ? ' disabled' : '';
  return `<button class="${classes.join(' ')}" type="${escapeHtml(type)}"${disabledAttr}${attrStr}>${iconHtml}${labelHtml}</button>`;
}
