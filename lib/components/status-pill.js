/**
 * Shared Status Pill Component (LIN-465, Phase A.5)
 *
 * The canonical state→glyph+label pill: a pure `renderStatusPill() → HTML string`
 * helper in the same idiom as `renderCard`/`renderField`/`renderSection` — no
 * framework, no build step.
 *
 * It is the single canonical seam for the ~20 hand-rolled state pills scattered
 * across the app (swipe `.state.*`, `.swim-box-state.*`, …).
 * Those live in client JS (ship.js, swipe.js) and are
 * **Phase B**; this subtask ships ONLY the server component + canonical CSS +
 * styleguide lock, so the new `.status-pill` deliberately COEXISTS with the
 * existing per-page pill CSS until Phase B points the JS at it. That duplication
 * is the intentional, tracked Phase-B seam, not an orphan.
 *
 * The state vocabulary is shared with `card`'s accent (LIN-464): the variant
 * names (`in-progress | done | todo | backlog | failed`) and the Phase-0 color
 * tokens are the SAME, so a pill and a card accent compose on one interface
 * rather than forking two parallel state systems.
 *
 * Canonical look lives in `public/style.css` on Phase-0 tokens:
 *   .status-pill            the chip — token hairline, --bg-alt fill, rounded
 *   .status-pill__char      the leading state glyph (✓ ◐ ○ ✕)
 *   .status-pill__label     the label text
 *   .status-pill--<state>   the state color modifier (text color by token)
 *
 * `state` selects the color modifier AND a default glyph (✓ done, ◐ in-progress,
 * ○ todo/backlog, ✕ failed); `char` overrides that glyph. `label` is the text.
 * Both `char` and `label` are escaped (the API contract: plain text in, like
 * `field`'s label). `variant` adds an extra `.status-pill--<variant>` modifier
 * (e.g. `tag` for a neutral, stateless label chip). `className`/`attrs` extend
 * the wrapper (the semantic/E2E-hook escape hatch, per the LIN-461 precedent).
 * A pill with neither a glyph nor a label is a styling shell with no content, so
 * it throws — mirroring `card`'s title-or-body guard.
 *
 * @param {Object} opts
 * @param {'in-progress'|'done'|'todo'|'backlog'|'failed'} [opts.state] - State color + default glyph.
 * @param {string} [opts.label] - Pill text (escaped).
 * @param {string} [opts.char] - Glyph override (escaped). Defaults from `state`.
 * @param {string} [opts.variant] - Extra modifier name, e.g. `tag` (neutral chip).
 * @param {string} [opts.className] - Extra class(es) on the wrapper (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw wrapper attributes (already escaped).
 * @returns {string} Status pill HTML.
 */
import { escapeHtml } from '../utils/html.js';

// Default state glyphs — the CLI/terminal state vocabulary (public/llms.txt,
// render.js). done/in-progress/todo mirror the styleguide STATE_GLYPHS exactly.
const STATE_GLYPHS = {
  done: '✓',
  'in-progress': '◐',
  todo: '○',
  backlog: '○',
  failed: '✕',
};

export function renderStatusPill({
  state,
  label,
  char,
  variant,
  className,
  attrs,
} = {}) {
  const has = (v) => v != null && v !== '';

  const glyph = has(char) ? char : (state ? STATE_GLYPHS[state] : undefined);
  if (!has(glyph) && !has(label)) {
    throw new Error('renderStatusPill requires at least one of `char`, `label`, or a known `state`.');
  }

  const classes = ['status-pill'];
  if (state) classes.push(`status-pill--${state}`);
  if (variant) classes.push(`status-pill--${variant}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';

  const charHtml = has(glyph)
    ? `<span class="status-pill__char">${escapeHtml(glyph)}</span>`
    : '';
  const labelHtml = has(label)
    ? `<span class="status-pill__label">${escapeHtml(label)}</span>`
    : '';

  return `<span class="${classes.join(' ')}"${attrStr}>${charHtml}${labelHtml}</span>`;
}
