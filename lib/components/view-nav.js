/**
 * Shared View-Switcher Component (LIN-978, UI audit D keystone)
 *
 * The single source of truth for the cross-view navigation list — the tier/flag
 * gating that USED to live inline in `getFooterLinks` (`lib/components/footer.js`).
 * Extracting it here is the #1 drift guard for the header/footer split: the
 * header switcher (`renderNavBar`) consumes `getViewNavLinks` for its *presence*
 * and the footer's *absence* of view links stays correct because the list lives
 * in exactly one place.
 *
 * Tier model (per `docs/view-tiers.md`), unchanged from the old footer logic:
 *   - First-class (observation / swipe / swim / settings): ALWAYS shown.
 *   - Flagged power-user (roadmap / dispatch / proxy): shown only when the
 *     per-user feature flag is on.
 *   - Experimental (collective / taskChat / ship / nextRun / flightCompanion):
 *     NOT here at all — Settings-only discovery, never hoisted into the header.
 *
 * The switcher is rendered INTO the shared nav bar (see `renderNavBar`), so every
 * `renderNavBar` page gets header-level view navigation for free; observation
 * folds its bespoke app bar into the same nav.
 */

import { escapeHtml } from '../utils/html.js';

/**
 * Get the tier/flag-gated cross-view navigation links.
 *
 * The list order and gating mirror the historical `getFooterLinks` exactly so
 * the header switcher shows precisely what the footer used to.
 *
 * @param {string|null} urlKey - Current workspace URL key (for the link prefix)
 * @param {Object} [featureFlags] - Current per-user feature toggle states
 * @returns {Array<{href: string, text: string}>} View link objects
 */
export function getViewNavLinks(urlKey, featureFlags = {}) {
  const prefix = urlKey ? `/workspace/${encodeURIComponent(urlKey)}` : '';
  const links = [
    { href: `${prefix}/observation`, text: 'observation' },
    { href: `${prefix}/swipe`, text: 'swipe' },
    { href: `${prefix}/swim`, text: 'swim' },
    { href: `${prefix}/settings`, text: 'settings' }
  ];
  if (featureFlags.roadmap === true) {
    links.push({ href: `${prefix}/roadmap`, text: 'roadmap' });
  }
  if (featureFlags.dispatch === true) {
    links.push({ href: `${prefix}/dispatch`, text: 'dispatch' });
  }
  if (featureFlags.proxy === true) {
    links.push({ href: `${prefix}/proxy`, text: 'proxy' });
  }
  return links;
}

/**
 * Render the header-level view switcher row.
 *
 * Emits a single-row `.nav-views` list of `data-testid="nav-view-<text>"`
 * links (mirroring the footer's `footer-link-<text>` convention). The active
 * view is matched by simple key-equality: `link.text === currentPage`. Every
 * `renderNavBar` call site threads a BARE `currentPage` key (e.g. `'swim'`,
 * `'settings'`, `'observation'`) that already equals each view's path segment,
 * so no path normalisation is needed here — the navbar/footer identifier duality
 * collapses to key-equality.
 *
 * Returns '' when there is no `urlKey` (nothing to navigate to) so the nav on
 * pre-workspace surfaces stays clean.
 *
 * @param {Object} opts
 * @param {string|null} [opts.urlKey] - Current workspace URL key
 * @param {string} [opts.currentPage] - Bare current-page key (active match)
 * @param {Object} [opts.featureFlags] - Current per-user feature toggle states
 * @returns {string} HTML for the `.nav-views` switcher row (or '')
 */
export function renderViewNav({ urlKey = null, currentPage = '', featureFlags = {} } = {}) {
  if (!urlKey) return '';

  const links = getViewNavLinks(urlKey, featureFlags);
  const items = links.map(link => {
    const isActive = link.text === currentPage;
    if (isActive) {
      return `<strong class="nav-view nav-view-current" data-testid="nav-view-${escapeHtml(link.text)}" aria-current="page">${escapeHtml(link.text)}</strong>`;
    }
    return `<a href="${escapeHtml(link.href)}" class="nav-view" data-testid="nav-view-${escapeHtml(link.text)}">${escapeHtml(link.text)}</a>`;
  });

  return `<div class="nav-views" role="navigation" aria-label="Views">
      ${items.join('\n      ')}
    </div>`;
}
