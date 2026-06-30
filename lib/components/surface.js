/**
 * Shared Surface / Inset-Panel Primitive (LIN-786, Theme S2 §9)
 *
 * The token-only container leaf — pure `renderSurface() → HTML string`. It owns
 * the three elevation surfaces from the semantic token layer so pages stop
 * hand-rolling `background: var(--bg-...)` blocks:
 *
 *   default       a flat `--card` panel (token hairline, --radius-md)
 *   variant inset  a recessed well (`--inset` fill) — the "InsetPanel"
 *   variant raised a lifted panel (`--raised` fill + `--shadow`)
 *
 * `body` is RAW HTML (slot convention, like `card`/`section`). `as` picks the
 * wrapper element (default `div`). `className`/`attrs` extend it. Page-agnostic
 * and prop-driven: no page logic, tokens only.
 *
 * @param {Object} opts
 * @param {string} opts.body - Panel contents (raw).
 * @param {'inset'|'raised'} [opts.variant] - Elevation variant.
 * @param {string} [opts.as] - Wrapper tag (default 'div').
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 * @returns {string} Surface HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderSurface({ body, variant, as = 'div', className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(body)) {
    throw new Error('renderSurface requires a `body`.');
  }
  const tag = escapeHtml(as);
  const classes = ['surface'];
  if (variant) classes.push(`surface--${variant}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';

  return `<${tag} class="${classes.join(' ')}"${attrStr}>${body}</${tag}>`;
}
