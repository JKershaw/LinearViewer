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
 * LIN-786 (Theme S2) EXTENDS — not forks — this same seam with the autopilot
 * run-status vocabulary (`running | done | error | queued`) and a `dot` variant.
 * The collision resolution is canonical: `running → --amber`, `done → --green`,
 * `error → --red`, `queued → --slate` (dot uses the bright fill token; the label
 * text uses the AA-safe `-dim` companion). `done` is the shared member of both
 * vocabularies and maps to green in each, so the two never conflict. Run-status
 * pills carry a small leading `dot` (set `dot: true`) instead of a glyph and
 * always pair it with a `label`/`title`, so state is never conveyed by color
 * alone. Forking a second status system is explicitly disallowed.
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
 * @param {'in-progress'|'done'|'todo'|'backlog'|'failed'|'running'|'error'|'queued'} [opts.state] - State color + default glyph.
 * @param {string} [opts.label] - Pill text (escaped).
 * @param {string} [opts.char] - Glyph override (escaped). Defaults from `state`.
 * @param {boolean} [opts.dot] - Render a leading status dot (run-status style) instead of a glyph.
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
  dot,
  variant,
  className,
  attrs,
} = {}) {
  const has = (v) => v != null && v !== '';

  // The dot variant carries the marker itself, so it satisfies the "has a
  // marker" requirement without a glyph (run-status pills have no glyph).
  const glyph = has(char) ? char : (state ? STATE_GLYPHS[state] : undefined);
  if (!dot && !has(glyph) && !has(label)) {
    throw new Error('renderStatusPill requires at least one of `char`, `label`, `dot`, or a known `state`.');
  }

  const classes = ['status-pill'];
  if (dot) classes.push('status-pill--dot');
  if (state) classes.push(`status-pill--${state}`);
  if (variant) classes.push(`status-pill--${variant}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';

  // `dot` wins over a glyph (a run-status pill is dot-led); both never co-render.
  const markerHtml = dot
    ? '<span class="status-pill__dot" aria-hidden="true"></span>'
    : (has(glyph) ? `<span class="status-pill__char">${escapeHtml(glyph)}</span>` : '');
  const labelHtml = has(label)
    ? `<span class="status-pill__label">${escapeHtml(label)}</span>`
    : '';

  return `<span class="${classes.join(' ')}"${attrStr}>${markerHtml}${labelHtml}</span>`;
}
