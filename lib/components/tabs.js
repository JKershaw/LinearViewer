/**
 * Shared Tab Strip (LIN-3983, PR 1)
 *
 * A row of mutually exclusive tabs: `renderTabs() → HTML string`, token-only and
 * page-agnostic. The strip is markup only. The page owns which tab is selected
 * (it passes `activeKey`), what a click does, and what the tab shows, so this
 * file has no state and no script. A page that wants arrow-key movement adds it
 * in its own client code; each tab is a real `<button>`, so Tab and Enter work
 * without it.
 *
 * Each tab carries `data-tab` (its key, which the page reads on click) and a
 * `data-testid` of `<testIdPrefix>-<key>`, so specs select a tab by its key
 * through `SELECTORS` and never by label text. Labels must fit on one line: the
 * strip does not wrap them, and a page that needs a long label says it in a
 * line of its own under the strip instead.
 *
 * Consumers: Observation (`lib/render-observation.js`). The task-edit tabs
 * (`lib/render-task-edit.js`, `.task-edit-tab`) predate this and stay as they
 * are; `docs/architecture/ui-pieces.md` names them as the next consumer to move.
 *
 * @param {Object} opts
 * @param {Array<{key: string, label: string}>} opts.tabs - One entry per tab, in order.
 * @param {string} opts.activeKey - The key of the selected tab.
 * @param {string} opts.ariaLabel - Accessible name for the strip (escaped here).
 * @param {string} opts.testIdPrefix - Stable hook prefix, e.g. `obs-tab`.
 * @param {string} [opts.className] - Extra class(es) for the page's own layout.
 * @returns {string} Tab-strip HTML.
 */
import { escapeHtml } from '../utils/html.js';

export function renderTabs({ tabs, activeKey, ariaLabel, testIdPrefix, className } = {}) {
  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new Error('renderTabs requires a non-empty `tabs` array.');
  }
  if (!tabs.some(t => t.key === activeKey)) {
    throw new Error(`renderTabs: activeKey "${activeKey}" is not one of the tabs.`);
  }
  const classes = ['tabs'];
  if (className) classes.push(className);

  const buttons = tabs.map(({ key, label }) => {
    const on = key === activeKey;
    const testId = testIdPrefix ? ` data-testid="${escapeHtml(`${testIdPrefix}-${key}`)}"` : '';
    return `<button type="button" class="tabs__tab${on ? ' is-active' : ''}" role="tab"`
      + ` data-tab="${escapeHtml(key)}" aria-selected="${on ? 'true' : 'false'}"`
      + ` tabindex="${on ? '0' : '-1'}"${testId}>${escapeHtml(label)}</button>`;
  }).join('');

  return `<div class="${classes.join(' ')}" role="tablist" aria-label="${escapeHtml(ariaLabel || 'Tabs')}">${buttons}</div>`;
}
