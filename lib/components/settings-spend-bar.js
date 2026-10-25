/**
 * The spend bar (LIN-3855): one job's share of the window's priced spend, as a native `<progress>`
 * (no inline style, no script). `share` is 0 to 1; a job with no priced spend passes null and shows
 * an empty bar, never a $0 figure dressed as a share. The label is the words a screen reader hears.
 */

import { escapeHtml } from '../utils/html.js';

export function spendBar({ share = null, label = '', testid = '' }) {
  const pct = share === null || !Number.isFinite(share) ? 0 : Math.round(Math.min(Math.max(share, 0), 1) * 100);
  return `<progress class="settings-spend-bar" max="100" value="${pct}" aria-label="${escapeHtml(label)}"${testid ? ` data-testid="${escapeHtml(testid)}"` : ''}>${pct}%</progress>`;
}
