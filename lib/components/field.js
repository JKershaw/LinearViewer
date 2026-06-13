/**
 * Shared Field Component (LIN-463, Phase A.3)
 *
 * The horizontal **dim-label + value** row primitive: a pure
 * `renderField() → HTML string` helper in the same idiom as
 * `renderSection`/`renderPageHeader` — no framework, no build step.
 *
 * It owns the aligned key:value row that dispatch / proxy / settings hand-rolled
 * as byte-identical per-page rules (`.dispatch-label`/`.dispatch-value`,
 * `.proxy-label`, and — Session 2 — `.settings-label`/`.settings-value`). The
 * value slot is deliberately flexible: it holds plain text, a status span, OR a
 * control (a `<select>`), so the one primitive covers every aligned field.
 *
 * Canonical look lives in `public/style.css` on Phase-0 tokens:
 *   .field         the flex row — matches the shared `.X-section .line` rule
 *                  (the `.line` name survives on NON-field rows in those sections)
 *   .field-label   the dim, min-width:10ch label — absorbs the per-page *-label rules
 *   .field-value   the value — absorbs the per-page *-value rules
 *
 * `label` is escaped (the API contract: plain text in). The value comes via
 * either `value` (escaped text) or `valueHtml` (pre-built markup emitted raw,
 * e.g. a `<select>` or `<code>`); omit both for a label-only row. `labelClass`/
 * `valueClass` are the escape hatches to keep a load-bearing no-style/semantic
 * hook class riding alongside the canonical one (the LIN-461 precedent) — e.g.
 * `valueClass: 'connected'` for the settings status colours, which are also E2E
 * selectors. `className`/`attrs` extend the row wrapper.
 *
 * @param {Object} opts
 * @param {string} [opts.label] - Label text (escaped).
 * @param {string} [opts.labelClass] - Extra class(es) on the label span.
 * @param {string} [opts.value] - Value text (escaped). Ignored if `valueHtml`.
 * @param {string} [opts.valueHtml] - Pre-built value markup, emitted raw. Wins
 *   over `value`.
 * @param {string} [opts.valueClass] - Extra class(es) on the value span
 *   (semantic/no-style hook).
 * @param {string} [opts.className] - Extra class(es) on the row wrapper.
 * @param {string} [opts.attrs] - Extra raw wrapper attributes (already escaped).
 * @returns {string} Field row HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderField({
  label,
  labelClass,
  value,
  valueHtml,
  valueClass,
  className,
  attrs,
} = {}) {
  const classes = ['field'];
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';

  const labelClasses = ['field-label'];
  if (labelClass) labelClasses.push(labelClass);
  const labelHtml = `<span class="${labelClasses.join(' ')}">${escapeHtml(label)}</span>`;

  let valuePart = '';
  const hasHtml = valueHtml != null && valueHtml !== '';
  const hasText = value != null && value !== '';
  if (hasHtml || hasText) {
    const valueClasses = ['field-value'];
    if (valueClass) valueClasses.push(valueClass);
    const inner = hasHtml ? valueHtml : escapeHtml(value);
    valuePart = `<span class="${valueClasses.join(' ')}">${inner}</span>`;
  }

  return `<div class="${classes.join(' ')}"${attrStr}>${labelHtml}${valuePart}</div>`;
}
