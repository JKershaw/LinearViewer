/**
 * Shared Line-Icon Set (LIN-786, Theme S2 §10)
 *
 * The minimal inline-SVG icon set — a pure `renderIcon() → HTML string` helper,
 * no icon framework, no sprite build step. Each icon is a 16×16 stroke glyph
 * drawn with `stroke="currentColor"`, so it inherits the surrounding text colour
 * (and therefore themes for free — no per-icon token). Page-agnostic and
 * prop-driven: drop one into any button, pill, or label.
 *
 * Set (§10): `check`, `caret`, `branch`, `spark`, `error-circle`.
 *
 * `name` selects the glyph (unknown name throws — icons are a closed set).
 * `title` adds an accessible name (`role="img"` + `<title>`); omit it for purely
 * decorative icons, which render `aria-hidden="true"`. `className`/`attrs`
 * extend the `<svg>` (sizing hook / E2E hook). Sizing is owned by `.icon` in
 * `public/style.css` (1em square), so icons scale with their text context.
 *
 * @param {Object} opts
 * @param {'check'|'caret'|'branch'|'spark'|'error-circle'} opts.name - Icon name.
 * @param {string} [opts.title] - Accessible name; when set the icon is exposed as an image.
 * @param {string} [opts.className] - Extra class(es) on the <svg> (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 * @returns {string} Inline SVG icon HTML.
 */
import { escapeHtml } from '../utils/html.js';

// Each entry is the inner markup of a 0 0 16 16 viewBox, stroked in currentColor.
const ICON_PATHS = {
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  caret: '<path d="M5 6l3 3 3-3"/>',
  branch: '<circle cx="4.5" cy="4" r="1.6"/><circle cx="4.5" cy="12" r="1.6"/><circle cx="11.5" cy="12" r="1.6"/><path d="M4.5 5.6v4.8M4.5 9.5a3 3 0 0 0 3 3h2.4"/>',
  spark: '<path d="M8 2.5l1.4 3.7 3.6 1.4-3.6 1.4L8 12.7 6.6 9 3 7.6l3.6-1.4z"/>',
  'error-circle': '<circle cx="8" cy="8" r="5.5"/><path d="M8 5.2v3.4M8 10.6v.2"/>',
};

export function renderIcon({ name, title, className, attrs } = {}) {
  const path = ICON_PATHS[name];
  if (!path) {
    throw new Error(`renderIcon: unknown icon "${name}". Known icons: ${Object.keys(ICON_PATHS).join(', ')}.`);
  }

  const classes = ['icon', `icon--${name}`];
  if (className) classes.push(className);

  const has = (v) => v != null && v !== '';
  const titleHtml = has(title) ? `<title>${escapeHtml(title)}</title>` : '';
  const a11yAttr = has(title) ? ' role="img"' : ' aria-hidden="true"';
  const attrStr = attrs ? ` ${attrs}` : '';

  return `<svg class="${classes.join(' ')}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"${a11yAttr}${attrStr}>${titleHtml}${path}</svg>`;
}

export const ICON_NAMES = Object.keys(ICON_PATHS);
