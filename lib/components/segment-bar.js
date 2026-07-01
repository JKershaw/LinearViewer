/**
 * Shared Segment Bar Primitive (LIN-786, Theme S2 §9)
 *
 * A generic equal-cell segmented track — pure `renderSegmentBar() → HTML
 * string`, token-only and page-agnostic. The track lays its cells out in equal
 * fractions (CSS flex); the CONSUMER assigns each cell's meaning (LIN-783's
 * per-worker-run progress bar is one consumer, not baked in here).
 *
 * Each segment exposes its state WITHOUT relying on colour alone: every cell
 * carries a `title` (defaulting to its state) and, when given, a `count`, so the
 * state is readable to assistive tech and on hover. State colours reuse the
 * run-status vocabulary (`running/done/error/queued`); an absent/`empty` state
 * is the neutral unfilled cell.
 *
 * @param {Object} opts
 * @param {Array<{state?: string, title?: string, count?: string|number, label?: string}>} opts.segments
 *   - One entry per cell. `state` selects the colour; `title` is the hover/a11y
 *     text (defaults to `state`); `count`/`label` render inside the cell.
 * @param {string} [opts.ariaLabel] - Accessible name for the whole track.
 * @param {string} [opts.className] - Extra class(es) (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw attributes (already escaped).
 * @returns {string} Segment-bar HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderSegmentBar({ segments, ariaLabel, className, attrs } = {}) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('renderSegmentBar requires a non-empty `segments` array.');
  }
  const has = (v) => v != null && v !== '';

  const classes = ['segment-bar'];
  if (className) classes.push(className);
  const labelAttr = has(ariaLabel) ? ` role="img" aria-label="${escapeHtml(ariaLabel)}"` : ' role="group"';
  const attrStr = attrs ? ` ${attrs}` : '';

  const cells = segments.map((seg = {}) => {
    const state = has(seg.state) ? seg.state : 'empty';
    const cellClasses = ['segment-bar__cell', `segment-bar__cell--${state}`];
    // Title is never colour-alone state: it always carries the textual state.
    const title = has(seg.title) ? seg.title : state;
    const inner = has(seg.label)
      ? escapeHtml(String(seg.label))
      : (has(seg.count) ? `<span class="segment-bar__count">${escapeHtml(String(seg.count))}</span>` : '');
    return `<span class="${cellClasses.join(' ')}" title="${escapeHtml(title)}">${inner}</span>`;
  }).join('');

  return `<span class="${classes.join(' ')}"${labelAttr}${attrStr}>${cells}</span>`;
}
