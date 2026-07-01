/**
 * Shared Empty-State Component (LIN-466, Phase A.6)
 *
 * The canonical "nothing here yet" placeholder: a pure
 * `renderEmptyState() → HTML string` helper in the same idiom as
 * `renderStatusPill`/`renderCard`/`renderField`/`renderSection` — no framework,
 * no build step.
 *
 * It is the single canonical seam for the server-rendered empty states scattered
 * across the app (`.custom-prompts-empty`, `.roadmap-empty`,
 * `.swipe-card-empty`).
 *
 * The per-page looks genuinely DIVERGE — only `color: var(--fg-dim)` is
 * universal; padding, alignment, borders, font-family (roadmap
 * structural) and font-style (swipe italic) all differ. So the canonical
 * `.emptyState` CSS carries ONLY that shared subset and the component emits
 * `class="emptyState <page-variant>"`: base + the RETAINED per-page modifier
 * compose, so rendering stays byte-identical. The per-page variant classes are
 * deliberately NOT deleted in A.6 — two of them (`custom-prompts`, `swipe`) are
 * load-bearing client-JS contracts, and convergence onto one look
 * would be a forbidden baseline-updating styling pass. Collapsing the variants /
 * re-pointing the client builders at this helper is the tracked Phase-B seam,
 * mirroring `section`/`statusPill`.
 *
 * `text` is the placeholder copy (escaped — plain text in, like `field`'s label;
 * any leading glyph is part of the text). `tag` is the
 * wrapper element (`div` default; roadmap needs `p`). `className` adds
 * the retained per-page variant class(es). `id` and `attrs` extend the wrapper
 * (the client-contract / E2E-hook escape hatch).
 *
 * @param {Object} opts
 * @param {string} opts.text - Placeholder copy (escaped). Required.
 * @param {string} [opts.tag='div'] - Wrapper tag (e.g. `p` for roadmap).
 * @param {string} [opts.className] - Retained per-page variant class(es).
 * @param {string} [opts.id] - Wrapper id (client contract).
 * @param {string} [opts.attrs] - Extra raw wrapper attributes (already escaped).
 * @returns {string} Empty-state HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderEmptyState({
  text,
  tag = 'div',
  className,
  id,
  attrs,
} = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(text)) {
    throw new Error('renderEmptyState requires `text`.');
  }

  const classes = ['emptyState'];
  if (className) classes.push(className);
  const idAttr = has(id) ? ` id="${escapeHtml(id)}"` : '';
  const attrStr = attrs ? ` ${attrs}` : '';

  return `<${tag} class="${classes.join(' ')}"${idAttr}${attrStr}>${escapeHtml(text)}</${tag}>`;
}
