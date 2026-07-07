/**
 * Shared Brand Wordmark Component (LIN-725, Harbour brand S3)
 *
 * The lowercase `harbour` wordmark, defined ONCE here and surfaced in both
 * chrome partials — the top nav bar (`renderNavBar`) and the page footer
 * (`renderPageFooter`). Keeping the markup in a single helper is the whole
 * point of the ticket: the wordmark must not be hand-rolled twice and drift
 * between header and footer.
 *
 * Treatment, per LIN-716 / LIN-724:
 *   - lowercase `harbour`, sitting on the existing CLI mono stack
 *     (`--font-structural`) — NOT a serif face. DM Serif Display is explicitly
 *     rejected; the brand reads as the terminal aesthetic it lives in.
 *   - a trailing accent dot painted with the brand `--teal` token from S2
 *     (`public/style.css`). The dot is decorative, so it carries
 *     `aria-hidden="true"` and is excluded from the accessible name.
 *
 * Scope is chrome only — this never touches landing visuals (LIN-726 owns the
 * landing rebuild); call sites gate it to authenticated chrome.
 *
 * @param {Object} [opts]
 * @param {'nav'|'footer'} [opts.context] - Which chrome surface is rendering it.
 *   Drives the `wordmark-<context>` modifier class and the `<context>-brand`
 *   test id; does not change the brand text.
 * @param {string|null} [opts.href] - When set, the wordmark is an `<a>` linking
 *   home (e.g. the workspace projects view). When null it renders as a plain
 *   `<span>` brand label (the footer case).
 * @returns {string} Wordmark HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderWordmark({ context = 'nav', href = null } = {}) {
  const classes = `wordmark wordmark-${context}`;
  const testId = `${context}-brand`;
  // The accent dot is decorative (the readable brand is "harbour"), so it is
  // hidden from assistive tech and lives in its own span for the teal token.
  const inner = `harbour<span class="wordmark-accent" aria-hidden="true">.cat</span>`;

  if (href) {
    return `<a href="${escapeHtml(href)}" class="${classes}" data-testid="${testId}" aria-label="Harbour home">${inner}</a>`;
  }
  return `<span class="${classes}" data-testid="${testId}" aria-label="Harbour">${inner}</span>`;
}
