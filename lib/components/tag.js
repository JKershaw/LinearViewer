/**
 * Shared Tag + Chip Primitives (LIN-786, Theme S2)
 *
 * Two small label leaves, pure `render*() → HTML string` helpers, token-only:
 *
 *   renderTag  — a soft, sans label chip (labels, categories). Optional trailing
 *                `count` rendered in the structural (mono) face, mirroring the
 *                audit `.label-tag` look the canonical `.tag` converges on.
 *   renderChip — a hard-edged MONO data chip (IDs, counts, paths, key=value):
 *                the machine-fact counterpart to the human-facing Tag, per the
 *                typographic split (mono for machine facts).
 *
 * Both escape their text inputs (plain text in, like `field`/`status-pill`).
 * `tone` adds a state colour modifier to a Tag (`.tag--<tone>`); the default is
 * the neutral surface look. `className`/`attrs` extend the element.
 *
 * @returns {string} HTML string.
 */
import { escapeHtml } from '../utils/html.js';

/**
 * @param {Object} opts
 * @param {string} opts.label - Tag text (escaped).
 * @param {string|number} [opts.count] - Optional trailing count (escaped, mono).
 * @param {'brand'|'running'|'done'|'error'|'queued'} [opts.tone] - State colour modifier.
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 */
export function renderTag({ label, count, tone, className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(label)) {
    throw new Error('renderTag requires a `label`.');
  }
  const classes = ['tag'];
  if (tone) classes.push(`tag--${tone}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';
  const countHtml = has(count) ? `<span class="tag__count">${escapeHtml(String(count))}</span>` : '';
  return `<span class="${classes.join(' ')}"${attrStr}><span class="tag__name">${escapeHtml(label)}</span>${countHtml}</span>`;
}

/**
 * @param {Object} opts
 * @param {string} opts.label - Chip text (escaped; rendered in the mono face).
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 */
export function renderChip({ label, className, attrs } = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(label)) {
    throw new Error('renderChip requires a `label`.');
  }
  const classes = ['chip'];
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';
  return `<code class="${classes.join(' ')}"${attrStr}>${escapeHtml(label)}</code>`;
}
