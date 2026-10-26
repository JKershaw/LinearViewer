/**
 * lib/components/time.js: the task page's one moment piece (LIN-3975, PR 2).
 *
 * A moment on the page reads as the relative words a reader takes in at a glance ("2 hours ago"), the same
 * words every other surface uses (`relativeAgo`). Tapping it, or pressing Enter on it, shows the exact time in
 * the reader's own zone with the zone named. That works on a phone, where a hover tooltip does not. The client
 * half is `initLocalTimes` in public/common.js, which handles `data-local-time="tap"`. The UTC text in `title` is
 * the no-script fallback and the hover text.
 *
 * The server cannot know the reader's zone, so it never writes the exact local time itself.
 */
import { escapeHtml } from '../utils/html.js';
import { fmtWhen, relativeAgo } from '../task-page-loader.js';

/**
 * @param {string|Date|null|undefined} at - the moment (an ISO string or a Date)
 * @param {{now?: Date, className?: string, testid?: string}} [opts]
 * @returns {string} the piece, or '' when there is no usable moment
 */
export function timeHtml(at, { now = new Date(), className = '', testid = '' } = {}) {
  const iso = at instanceof Date ? at.toISOString() : at;
  const relative = relativeAgo(iso, now);
  const utc = fmtWhen(iso, now);
  if (!relative || !utc) return '';
  const cls = ['task-time', className].filter(Boolean).join(' ');
  const tid = testid ? ` data-testid="${escapeHtml(testid)}"` : '';
  return `<time class="${escapeHtml(cls)}"${tid} datetime="${escapeHtml(iso)}" data-local-time="tap" title="${escapeHtml(utc)}">${escapeHtml(relative)}</time>`;
}
