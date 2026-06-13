/**
 * Shared Card Component (LIN-468, Phase A.4)
 *
 * The slot-based content-card primitive: a pure `renderCard() → HTML string`
 * helper in the same idiom as `renderSection`/`renderField`/`renderPageHeader` —
 * no framework, no build step.
 *
 * It owns the canonical card chrome (the bordered, padded container + its
 * optional header row) that the per-page cards (`.prompt-card`,
 * `.custom-prompt-card`, …) hand-rolled as near-duplicate rules. Migrated pages
 * keep their variant class NAME as a no-style semantic/E2E hook (passed via
 * `className`) riding alongside the canonical `.card`, exactly like the
 * section/field precedent (LIN-461/463).
 *
 * Canonical look lives in `public/style.css` on Phase-0 tokens:
 *   .card           the container — token border, --bg-alt fill, --radius-sm
 *   .card-accent    state-colored left border (with .card-accent--<state>)
 *   .card-header    the title/meta/labels row (flex, baseline, wrap)
 *   .card-title     the card's heading text
 *   .card-meta      right-aligned meta (counts, timestamps, …)
 *   .card-labels    the tag/chip row container (chip styling is LIN-465's)
 *
 * Slots are RAW HTML (the caller escapes its own dynamic text, as with
 * `renderSection`/`field`'s `valueHtml`): `title`, `meta`, `labels`, `header`,
 * and `body` are emitted verbatim. The header row is built from `title` +
 * `labels` + `meta`; pass `header` to supply the whole header inner markup
 * instead (escape hatch). `accent` is a state modifier
 * (`in-progress|done|todo|backlog|failed`) that adds `card-accent` +
 * `card-accent--<accent>`. `className`/`attrs` extend the wrapper. At least one
 * of `title` or `body` is required — a card with neither is a styling shell with
 * no content, so it throws.
 *
 * @param {Object} opts
 * @param {'in-progress'|'done'|'todo'|'backlog'|'failed'} [opts.accent] - State accent.
 * @param {string} [opts.header] - Raw header-row inner markup. Wins over title/meta/labels.
 * @param {string} [opts.title] - Heading markup (raw). Goes in `.card-title`.
 * @param {string} [opts.meta] - Right-aligned meta markup (raw). Goes in `.card-meta`.
 * @param {string} [opts.labels] - Label/chip row markup (raw). Goes in `.card-labels`.
 * @param {string} [opts.body] - Card body markup (raw).
 * @param {string} [opts.className] - Extra class(es) on the wrapper (semantic/E2E hook).
 * @param {string} [opts.attrs] - Extra raw wrapper attributes (already escaped).
 * @returns {string} Card HTML.
 */
export function renderCard({
  accent,
  header,
  title,
  meta,
  labels,
  body,
  className,
  attrs,
} = {}) {
  const has = (v) => v != null && v !== '';
  if (!has(title) && !has(body)) {
    throw new Error('renderCard requires at least one of `title` or `body`.');
  }

  const classes = ['card'];
  if (accent) classes.push('card-accent', `card-accent--${accent}`);
  if (className) classes.push(className);
  const attrStr = attrs ? ` ${attrs}` : '';

  let headerHtml = '';
  if (has(header)) {
    headerHtml = `<div class="card-header">${header}</div>`;
  } else if (has(title) || has(meta) || has(labels)) {
    const parts = [
      has(title) ? `<span class="card-title">${title}</span>` : '',
      has(labels) ? `<span class="card-labels">${labels}</span>` : '',
      has(meta) ? `<span class="card-meta">${meta}</span>` : '',
    ].join('');
    headerHtml = `<div class="card-header">${parts}</div>`;
  }

  const bodyHtml = has(body) ? body : '';

  return `<div class="${classes.join(' ')}"${attrStr}>${headerHtml}${bodyHtml}</div>`;
}
