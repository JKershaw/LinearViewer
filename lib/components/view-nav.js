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
 * Tier model (per `docs/view-tiers.md`):
 *   - First-class (observation / swipe / swim / tasks / settings): ALWAYS shown.
 *   - Flagged power-user (roadmap / dispatch / proxy): shown only when the
 *     per-user feature flag is on.
 *   - Experimental (the six in `EXPERIMENTAL_VIEWS`): shown in the nav's `⋯ more`
 *     overflow ONLY when the feature's flag is on — gated inclusion (LIN-1247,
 *     reversing the earlier Settings-only policy). Still discoverable in Settings
 *     too; both surfaces read the same `EXPERIMENTAL_VIEWS` source of truth.
 *
 * The switcher is rendered INTO the shared nav bar (see `renderNavBar`), so every
 * `renderNavBar` page gets header-level view navigation for free; observation
 * folds its bespoke app bar into the same nav.
 */

import { escapeHtml } from '../utils/html.js';
import { EXPERIMENTAL_VIEWS } from '../feature-defaults.js';

/**
 * The first-class views (per `docs/view-tiers.md`) — always shown, and in the
 * "Confident CLI tab strip" redesign (LIN-1058) they form the PRIMARY inline
 * group that stays on the tab strip at every width. The flag-gated power-user
 * views (roadmap / dispatch / proxy) and the flag-gated experimental views
 * (LIN-1247) are the OVERFLOW group, collapsed behind a `⋯ more` in-flow
 * expander on narrow widths. Keyed on the bare view text so it pairs with the
 * key-equality active match and the single-source-of-truth list.
 */
const FIRST_CLASS_VIEWS = ['observation', 'swipe', 'swim', 'projects', 'settings'];

// Short view labels for the tab strip where the route key does not read cleanly
// as a label. The map key is the nav `text` (the kebab route / active-match key,
// which stays the testid); the value is the human display text only. Experimental
// multi-word routes get a spaced short label (LIN-1247) — NOT Settings' longer
// "open the …" action phrases — mirroring the existing `projects` → "tasks" case.
const DISPLAY_LABELS = {
  projects: 'tasks',
  'task-chat': 'task chat',
  'next-run': 'next run',
  'flight-companion': 'flight companion',
  'ship-biscuit': "ship's biscuit",
  'live-console': 'live console'
};

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
    { href: `${prefix}/`, text: 'projects' },
    { href: `${prefix}/swipe`, text: 'swipe' },
    { href: `${prefix}/swim`, text: 'swim' },
    { href: `${prefix}/observation`, text: 'observation' },
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
  // Experimental views (LIN-1247): gated inclusion, one entry per enabled flag.
  // Gate on the camelCase `flag` (strict `=== true`, matching the power-user
  // tier) but emit the kebab `path` as the link `text`, because active-match and
  // active-hoist compare `link.text === currentPage` and the pages thread the
  // kebab route key (e.g. `task-chat`). These are non-first-class, so
  // `partitionViewLinks` routes them into the `⋯ more` overflow automatically.
  for (const { flag, path } of EXPERIMENTAL_VIEWS) {
    if (featureFlags[flag] === true) {
      links.push({ href: `${prefix}/${path}`, text: path });
    }
  }
  return links;
}

/**
 * Partition the view links into the primary (inline) group and the overflow
 * (behind `⋯ more`) group for the redesigned tab strip (LIN-1058).
 *
 * The first-class five are always primary; the flag-gated views are overflow.
 * The ACTIVE view is HOISTED inline even when it is a flag-gated/overflow view,
 * so the current tab is never hidden inside the collapsed `⋯ more` expander
 * (the design's active-hoist rule). It is appended after the first-class five
 * (preserving their fixed order) and removed from the overflow group.
 *
 * @param {Array<{href: string, text: string}>} links - getViewNavLinks output
 * @param {string} currentPage - Bare current-page key (active match)
 * @returns {{ primary: Array, overflow: Array }}
 */
export function partitionViewLinks(links, currentPage = '') {
  const primary = [];
  const overflow = [];
  for (const link of links) {
    if (FIRST_CLASS_VIEWS.includes(link.text)) primary.push(link);
    else overflow.push(link);
  }
  // Active-hoist: if the current view lives in overflow, lift it inline so the
  // active tab is always visible even while the expander is collapsed.
  const hoistIdx = overflow.findIndex(link => link.text === currentPage);
  if (hoistIdx !== -1) {
    primary.push(overflow[hoistIdx]);
    overflow.splice(hoistIdx, 1);
  }
  return { primary, overflow };
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
  const { primary, overflow } = partitionViewLinks(links, currentPage);

  // The active view stays a bold, non-link `<strong>` with `aria-current`; the
  // leading `▸` marker and tab underline are added by CSS in beat 3 (a
  // `.nav-view-current::before`), so this markup is UNCHANGED byte-for-byte and
  // the LIN-978 unit contract still holds. Others are anchors.
  const renderLink = (link) => {
    const display = DISPLAY_LABELS[link.text] || link.text;
    const isActive = link.text === currentPage;
    if (isActive) {
      return `<strong class="nav-view nav-view-current" data-testid="nav-view-${escapeHtml(link.text)}" aria-current="page">${escapeHtml(display)}</strong>`;
    }
    return `<a href="${escapeHtml(link.href)}" class="nav-view" data-testid="nav-view-${escapeHtml(link.text)}">${escapeHtml(display)}</a>`;
  };

  const primaryHtml = primary.map(renderLink).join('\n      ');

  // Overflow group + `⋯ more` toggle only when there are flag-gated views to
  // collapse. The expander is an IN-FLOW disclosure (not an overlay): the toggle
  // owns `aria-expanded`/`aria-controls` and the JS in common.js reveals the
  // in-flow `.nav-views-overflow` block below the strip (LIN-984 — nothing
  // floats over content, no backdrop). At desktop, beat-3 CSS shows the overflow
  // group inline and hides the toggle; at narrow widths it collapses.
  let overflowMarkup = '';
  if (overflow.length) {
    const overflowHtml = overflow.map(renderLink).join('\n        ');
    overflowMarkup = `
      <button type="button" class="nav-more-toggle" data-testid="nav-more-toggle" aria-expanded="false" aria-controls="nav-views-overflow">⋯ more</button>
      <div class="nav-views-overflow" id="nav-views-overflow">
        ${overflowHtml}
      </div>`;
  }

  return `<div class="nav-views" role="navigation" aria-label="Views">
      ${primaryHtml}${overflowMarkup}
    </div>`;
}
