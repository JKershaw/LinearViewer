/**
 * Public share-page renderer (LIN-3243, Session A of LIN-3073).
 *
 * Renders an owner's snapshot (`{ title, items }` from lib/share-snapshot.js)
 * as a standalone, read-only HTML document at `/s/:token`. The page is
 * deliberately inert and self-contained:
 *
 *   - NO `nav` — `renderPage` is called without one, so there is no site
 *     chrome and no link back into the app;
 *   - no outbound links or external scripts — the ONLY `<script>` is the
 *     inline theme pre-paint that `renderPage` always emits, and the only
 *     `<link>` is the same-origin `/style.css` stylesheet;
 *   - `headExtra` carries `noindex` (belt) alongside the route's
 *     `X-Robots-Tag: noindex` header (braces);
 *   - identifiers and titles are escaped plain text; a description is rendered
 *     ONLY when the share opted in (`includeDescriptions`) and is escaped.
 *
 * Member selection, projection and the canceled/duplicate hiding rules all
 * live in lib/share-snapshot.js — this module renders exactly what it is given.
 */

import { escapeHtml } from './utils/html.js';
import { renderPage } from './components/page.js';
import { renderTaskRow } from './render.js';
import { renderSessionPage } from './render-session.js';

function formatSnapshotAt(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Render the public share document.
 *
 * @param {Object} options
 * @param {{title?: string, items?: Object[]}|null} options.snapshot - the stored snapshot
 * @param {boolean} [options.includeDescriptions=false] - render item descriptions (escaped)
 * @param {Date|string|null} [options.snapshotAt=null] - when the snapshot was captured; shown when stale
 * @param {boolean} [options.stale=false] - true when this is last-good content on a failed refresh
 * @returns {string} complete HTML document
 */
export function renderSharePage({ snapshot, includeDescriptions = false, snapshotAt = null, stale = false } = {}) {
  const title = snapshot?.title || 'Shared tasks';
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];

  const bodyParts = [`<h1 class="share-title">${escapeHtml(title)}</h1>`];

  // The parent share's OWN description, under the title and gated on the same
  // opt-in as member descriptions. Label shares never carry it in the snapshot.
  if (includeDescriptions && snapshot?.description) {
    bodyParts.push(`<p class="share-description">${escapeHtml(snapshot.description)}</p>`);
  }

  const capturedAt = formatSnapshotAt(snapshotAt);
  if (stale && capturedAt) {
    bodyParts.push(`<p class="share-stale" data-testid="share-stale">as of ${escapeHtml(capturedAt)}</p>`);
  }

  if (items.length === 0) {
    bodyParts.push('<p class="share-empty" data-testid="share-empty">No tasks in this collection.</p>');
  } else {
    const rows = items.map(item => {
      const line = renderTaskRow({
        state: item?.state?.type,
        identifier: item?.identifier,
        title: item?.title,
        priority: item?.priority,
        updatedAt: item?.updatedAt
      });
      const description = includeDescriptions && item?.description
        ? `<p class="task-description">${escapeHtml(item.description)}</p>`
        : '';
      return `<li class="share-task">${line}${description}</li>`;
    });
    bodyParts.push(`<ul class="share-list" data-testid="share-list">${rows.join('')}</ul>`);
  }

  return renderPage({
    title: `${escapeHtml(title)} - Shared - Harbour`,
    stylesheets: ['/style.css'],
    bodyClass: 'share-page',
    headExtra: '<meta name="robots" content="noindex">',
    content: `<main class="share-content">${bodyParts.join('\n')}</main>`
  });
}

/**
 * Render a shared RUN (LIN-3312, LIN-2950 S6a): the run page in guest mode
 * from a stored guest projection (`buildGuestRunProjection`,
 * lib/guest-run.js). Pure — no read, no clock: the page's `now` is the
 * projection's `capturedAt`. There is no separate share page for a run; this
 * is `renderSessionPage(…, {guest: true})`, which cuts the stub again, drops
 * every owner-only affordance, ships no script beyond the theme pre-paint and
 * carries `noindex`. A last-good serve (`stale`) shows the same `share-stale`
 * "as of" line the collection page shows.
 *
 * Not reachable yet: no route calls this until LIN-2950 Phase 3, which also
 * runs `scanGuestHtml` over the result before serving it.
 *
 * @param {Object} options
 * @param {Object} options.snapshot - the stored guest projection
 * @param {Date|string|null} [options.snapshotAt=null] - when the snapshot was stored; shown when stale
 * @param {boolean} [options.stale=false] - true when this is last-good content on a failed refresh
 * @returns {string} complete HTML document
 * @throws {Error} when the snapshot has no session or capture time (the route answers 503)
 */
export function renderGuestRunPage({ snapshot, snapshotAt = null, stale = false } = {}) {
  const s = snapshot && typeof snapshot === 'object' ? snapshot : {};
  return renderSessionPage({
    session: s.session || null,
    runEvidence: s.runEvidence || null,
    runParagraph: s.runParagraph || null,
    prState: s.prState || null,
    prRef: s.prRef || null,
    sessionTerminal: s.settled === true,
    capturedAt: s.capturedAt || null,
    stale: !!stale,
    snapshotAt
  }, { guest: true });
}
