/**
 * Shared Page Header Component (LIN-462, Phase A.2)
 *
 * The page-level `<header>` primitive: an `<h1>` title plus an optional
 * tagline subtitle. A pure `renderPageHeader() → HTML string` helper in the
 * same idiom as `renderSection`/`renderNavBar`/`renderPageFooter` — no
 * framework, no build step.
 *
 * It owns the page `<h1>` and its subtitle. In-card `h2`/`h3` headings stay
 * with `section` (LIN-461) — the two never both claim a heading. The simplest
 * shape, widest reach: ~14 pages previously hand-rolled
 * `<header><h1>…</h1><p class="X-subtitle">…</p></header>` with per-page CSS.
 *
 * Canonical look lives in `public/style.css` on Phase-0 tokens:
 *   header                    layout (centering, margin) — the global tag rule
 *   .page-header__subtitle    the tagline — absorbs the former `*-subtitle` rules
 *
 * `title`/`subtitle` are escaped here (the API contract: plain text in). For
 * pre-built heading markup (e.g. an `experimental` span) pass `titleHtml`
 * instead, which is emitted raw. `subtitleClass` is the escape hatch to keep a
 * load-bearing test-hook class (`.dashboard-subtitle`, `.dispatch-subtitle`,
 * `.prompts-subtitle`) as a NO-STYLE name riding alongside the canonical class
 * (LIN-461 precedent), so existing E2E selectors stay green.
 *
 * @param {Object} opts
 * @param {string} [opts.title] - Heading text (escaped). Omitted if `titleHtml`.
 * @param {string} [opts.titleHtml] - Pre-built heading markup, emitted raw.
 *   Wins over `title`/`titleHref`.
 * @param {string} [opts.titleHref] - Sugar: wraps `title` in an
 *   `<a class="header-link">`.
 * @param {string} [opts.subtitle] - Tagline text (escaped). Omitted ⇒
 *   title-only header (no `<p>`).
 * @param {string} [opts.subtitleClass] - Extra class(es) on the subtitle `<p>`
 *   (no-style test hook).
 * @param {string} [opts.headerClass] - Extra class(es) on the `<header>`.
 * @returns {string} Page header HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderPageHeader({
  title,
  titleHtml,
  titleHref,
  subtitle,
  subtitleClass,
  headerClass,
} = {}) {
  const classes = ['page-header'];
  if (headerClass) classes.push(headerClass);

  let inner;
  if (titleHtml != null && titleHtml !== '') {
    inner = titleHtml;
  } else {
    const text = escapeHtml(title);
    inner = titleHref
      ? `<a href="${escapeHtml(titleHref)}" class="header-link">${text}</a>`
      : text;
  }
  const headingHtml = `<h1>${inner}</h1>`;

  let subtitleHtml = '';
  if (subtitle != null && subtitle !== '') {
    const subClasses = ['page-header__subtitle'];
    if (subtitleClass) subClasses.push(subtitleClass);
    subtitleHtml = `\n    <p class="${subClasses.join(' ')}">${escapeHtml(subtitle)}</p>`;
  }

  return `<header class="${classes.join(' ')}">
    ${headingHtml}${subtitleHtml}
  </header>`;
}
