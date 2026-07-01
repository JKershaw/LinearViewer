/**
 * Shared Icon-Button Primitive (LIN-786, Theme S2)
 *
 * A square, icon-only control — pure `renderIconButton() → HTML string`. Because
 * it has no visible text label, an accessible name is REQUIRED (`label` →
 * `aria-label`); a primitive that throws without one keeps the a11y floor from
 * being optional. The canonical look (`public/style.css`) gives `.icon-btn` a
 * ≥40px touch target (the §11 floor for primary/interactive controls) and reads
 * tokens only. The `ghost` variant drops the border for toolbar-dense rows.
 *
 * The global S1 `:focus-visible` ring covers it — the primitive NEVER sets
 * `outline:none`. `icon` is RAW HTML (an inline `<svg>` from `renderIcon`).
 * `className`/`attrs` extend the element (semantic/E2E hook).
 *
 * @param {Object} opts
 * @param {string} opts.icon - Icon markup (raw, e.g. renderIcon()).
 * @param {string} opts.label - Accessible name (becomes aria-label; REQUIRED).
 * @param {'ghost'} [opts.variant] - Visual variant.
 * @param {'button'|'submit'|'reset'} [opts.type] - Button type (default 'button').
 * @param {boolean} [opts.disabled] - Disable the button.
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 * @returns {string} Icon-button HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderIconButton({
  icon,
  label,
  variant,
  type = 'button',
  disabled,
  className,
  attrs,
} = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(icon)) {
    throw new Error('renderIconButton requires an `icon`.');
  }
  if (!has(label)) {
    throw new Error('renderIconButton requires a `label` for its accessible name (aria-label).');
  }

  const classes = ['icon-btn'];
  if (variant) classes.push(`icon-btn--${variant}`);
  if (className) classes.push(className);

  const disabledAttr = disabled ? ' disabled' : '';
  const attrStr = attrs ? ` ${attrs}` : '';

  return `<button class="${classes.join(' ')}" type="${escapeHtml(type)}" aria-label="${escapeHtml(label)}"${disabledAttr}${attrStr}><span class="icon-btn__icon" aria-hidden="true">${icon}</span></button>`;
}
