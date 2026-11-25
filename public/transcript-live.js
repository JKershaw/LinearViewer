/**
 * A run's transcript on a page, drawn and kept live (LIN-4560, LIN-4508 piece E). The run page (public/session.js) and
 * Dispatch history (public/dispatch.js) both import this one module:
 *
 *   - `transcriptItemsHtml(entries, live)`: the transcript's items through the one look (lib/transcript.js), with the
 *     page's host (common.js's renderers, read when called) and the relative words (lib/time-words.js). Both pages' first
 *     draw and every live redraw go through it, so the two pages cannot draw a transcript two ways.
 *   - `redrawTranscript(list, entries, live)`: redraws a transcript list in place, keeping what the reader has done: its
 *     scroll position (or its place at the bottom, which then follows the new entries) and every child-agent thread they
 *     opened. The list is shown once it has something to draw.
 *   - `createTranscriptFollower(o)`: follows a page's live runs through the signed-in hold-open read
 *     (`GET /workspace/:urlKey/api/dispatch/transcripts?ids=…&wait=…`, routes/dispatch.js), first one start window after
 *     the page loads (it was drawn from fresh data). One read at a time for every
 *     run the page follows (coalesced: never two in flight); paused while the tab is hidden, and read again at once when
 *     it shows; stopped for good on a 401/403/404, as the page's other polls stop. Each read says how many entries the
 *     page has for each run (`have`), so the server answers at once when the page is behind and holds only when it is
 *     not: an entry posted before a read, or between two, never waits for the next change. Each response carries each run's whole
 *     entry list keyed on its dispatch row id, so a run's list is replaced whole: an entry is never drawn twice or lost,
 *     and a run is redrawn only when its entries or its liveness changed. A run that reports done gets one more read
 *     (the final entries land), is drawn with no in-progress marker, and is not followed again.
 *
 * A module page modules import: it touches no global at load (common.js's helpers are read when a function is called),
 * so a suite can import it, or a page that imports it, in Node.
 */
import { renderTranscript } from '../lib/transcript.js';
import { relativeAgo } from '../lib/time-words.js';

/** How long one read holds open, in seconds (below Heroku's 30s H12; the server's keepalive covers a longer hold). */
export const TRANSCRIPT_WAIT_S = 25;
/** How long after a failed read the follower tries again. */
export const TRANSCRIPT_RETRY_MS = 5000;
/**
 * How long after the page loads the follower first reads. The page was drawn from fresh data, so nothing is missed;
 * the page settles before a held read opens (as the task page's timeline re-reads one window after load, LIN-4405).
 */
export const TRANSCRIPT_START_MS = 3000;

/** The transcript's items for `entries` (the server's transcript entries); '' when nothing is drawn. */
export function transcriptItemsHtml(entries, live) {
  return renderTranscript(entries || [], { live: !!live, host: window, relative: relativeAgo });
}

/** Redraws `list` (a transcript's `<ul>`) in place, keeping the reader's scroll position and opened threads. */
export function redrawTranscript(list, entries, live) {
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 4;
  const top = list.scrollTop;
  const opened = new Set();
  for (const details of list.querySelectorAll('details[open]')) {
    const thread = details.closest('[data-agent]');
    if (thread) opened.add(thread.getAttribute('data-agent'));
  }
  const html = transcriptItemsHtml(entries, live);
  list.innerHTML = html;
  list.hidden = !html;
  for (const thread of list.querySelectorAll('[data-agent]')) {
    if (!opened.has(thread.getAttribute('data-agent'))) continue;
    const details = thread.querySelector('details');
    if (details) details.setAttribute('open', '');
  }
  list.scrollTop = atBottom ? list.scrollHeight : top;
}

/**
 * @param {object} o
 * @param {string} o.urlKey
 * @param {() => string[]} o.liveIds - the dispatch row ids the page shows as live now (read each round, so rows the page
 *   draws later, a history page loaded after "show more", are followed too)
 * @param {(row: {id: string, live: boolean, entries: Array}) => void} o.apply - draws one run's entries
 * @param {(url: string) => Promise<object>} o.fetchJson - the page's JSON read (throws an error carrying `.status`)
 * @param {() => boolean} [o.visible]
 * @param {Function} [o.setTimer]
 * @param {Function} [o.clearTimer]
 * @param {number} [o.waitSeconds]
 * @param {number} [o.startDelayMs] - when the first read goes (default TRANSCRIPT_START_MS)
 * @param {(id: string) => number} [o.drawnCount] - how many entries the page first drew for `id` (-1 when unknown)
 */
export function createTranscriptFollower(o) {
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((id) => clearTimeout(id));
  const visible = o.visible || (() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const waitSeconds = o.waitSeconds ?? TRANSCRIPT_WAIT_S;
  const seen = new Map(); // id -> `${count}|${live}` last drawn
  const counts = new Map(); // id -> how many entries the page has drawn (sent as `have`, so the server answers when behind)
  const done = new Set(); // ids that reported done and had their last read
  const finishing = new Set(); // ids that reported done and still owe one more read
  let inFlight = false;
  let stopped = false;
  let timer = null;

  const following = () => [...new Set([...finishing, ...o.liveIds().filter((id) => !done.has(id))])].slice(0, 25);

  function schedule(ms) {
    clearTimer(timer);
    timer = setTimer(() => { timer = null; read(); }, ms);
  }

  // What the page has drawn for `id`: the last answer's count, else the page's own first draw, else unknown (-1).
  const haveOf = (id) => (counts.has(id) ? counts.get(id) : (o.drawnCount ? o.drawnCount(id) : -1));

  function applyRow(row) {
    const count = (row.entries || []).length;
    const key = `${count}|${row.live}`;
    // The page's own first draw counts as drawn: a first answer that matches it (same entries, still live) redraws
    // nothing, so a reader's click or scroll is never disturbed for no change.
    if (!seen.has(row.id) && row.live && !counts.has(row.id) && o.drawnCount && o.drawnCount(row.id) === count) seen.set(row.id, key);
    counts.set(row.id, count);
    if (seen.get(row.id) !== key) {
      seen.set(row.id, key);
      o.apply(row);
    }
    if (row.live) return;
    if (finishing.has(row.id)) { finishing.delete(row.id); done.add(row.id); } else finishing.add(row.id);
  }

  function read() {
    if (stopped || inFlight || !visible()) return Promise.resolve();
    const ids = following();
    if (!ids.length) return Promise.resolve();
    inFlight = true;
    // A run owing its last read is read at once, never held.
    const wait = ids.some((id) => finishing.has(id)) ? 0 : waitSeconds;
    const url = `/workspace/${encodeURIComponent(o.urlKey)}/api/dispatch/transcripts?ids=${ids.map(encodeURIComponent).join(',')}`
      + `&have=${ids.map(haveOf).join(',')}&wait=${wait}`;
    let failed = false;
    let request;
    try { request = Promise.resolve(o.fetchJson(url)); } catch (err) { request = Promise.reject(err); }
    return request
      .then((body) => {
        if (stopped || !body || !Array.isArray(body.rows)) return;
        for (const row of body.rows) applyRow(row);
      }, (err) => {
        failed = true;
        if (err && (err.status === 401 || err.status === 403 || err.status === 404)) stopped = true;
      })
      .then(() => {
        inFlight = false;
        if (stopped || !visible()) return;
        if (failed) schedule(TRANSCRIPT_RETRY_MS);
        else if (following().length) schedule(0);
      });
  }

  function onVisibility() {
    if (visible()) read();
  }

  return {
    /** Starts following: the first read one start window after load, then one after each answer while anything is live. */
    start() {
      if (typeof document !== 'undefined' && document.addEventListener) document.addEventListener('visibilitychange', onVisibility);
      schedule(o.startDelayMs ?? TRANSCRIPT_START_MS);
    },
    /** Reads now if no read is in flight (a page that drew new live rows calls this). */
    poke: read,
    stop() { stopped = true; clearTimer(timer); timer = null; },
    /** Test seam: what the follower is watching and has finished. */
    state: () => ({ inFlight, stopped, following: following(), done: [...done] })
  };
}
