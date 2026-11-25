/**
 * The one transcript look (LIN-4560, LIN-4508 piece E): a run's words as a conversation, drawn the same way wherever a
 * transcript appears. The run page (public/session.js) and Dispatch history (public/dispatch.js) both draw through
 * `renderTranscript`; it replaced the run page's bubble loop (`renderRunTranscripts`' ChatUI calls and `agentThreadFor`)
 * and Dispatch's `renderFeedbackEntries` tree lines.
 *
 * Its input is the server's transcript entries (lib/dispatch-transcript.js): already masked, with `blocked`, `waiting`
 * and `quiet` decided there, by the server's own readers. This file decides only how they look:
 *   - entries keep their stored order; a `quiet` entry is not drawn;
 *   - a run's own entry is a bubble (`agent`); a wait line is a waiting note, never a bubble;
 *   - a child agent's words (`agent` set, kind `agent-text`, LIN-4559) are one collapsed thread per child, placed where
 *     that child's first entry falls, its summary naming the child and counting its messages;
 *   - only a live run's newest own entry, when it is a bubble, carries the in-progress pill; every other bubble is
 *     settled (a plain tag pill), and a child's never needs to settle (LIN-2546);
 *   - a link only for an http(s) URL, with its label, else "link";
 *   - a time in the words the rest of Harbour uses for times: relative words, then the exact local time with its zone.
 *
 * A leaf: it imports nothing and names no browser or Node global (tests/unit/shared-modules.test.js), so the page hands
 * in what it draws with (`host`: `renderMarkdown`, `renderStatusPill`, `renderSurface`, `formatLocalTime`, common.js's)
 * and the relative words (`relative`: lib/time-words.js `relativeAgo`). The escape is its own, the same five characters
 * lib/utils/html.js escapes (as lib/question-record-card.js does). The message body goes through `host.renderMarkdown`
 * (marked + DOMPurify, or escaped text without the sanitizer); with no `renderMarkdown` it is escaped text.
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

const SAFE_URL = /^https?:\/\//i;

/** The most runs one live transcripts read follows: the route (routes/dispatch.js) refuses more, the page (public/transcript-live.js) sends no more. */
export const TRANSCRIPT_WATCH_MAX_IDS = 25;

/** "5 minutes ago · 10:49 PM GMT": the relative words, then the exact local time; '' when neither says anything. */
export function transcriptTime(iso, { host = {}, relative = null } = {}) {
  if (!iso) return '';
  const rel = typeof relative === 'function' ? relative(iso) : '';
  const exact = typeof host.formatLocalTime === 'function' ? host.formatLocalTime(iso, { zone: true }) : '';
  return [rel, exact].filter((part) => part).join(' · ');
}

function bodyHtml(entry, host) {
  const message = entry.message || '';
  const text = typeof host.renderMarkdown === 'function' ? host.renderMarkdown(message, { breaks: true }) : esc(message);
  const link = entry.url && SAFE_URL.test(entry.url)
    ? ` <a class="sess-tx-link" data-testid="transcript-link" href="${esc(entry.url)}" target="_blank" rel="noopener noreferrer">${esc(entry.urlLabel || 'link')}</a>`
    : '';
  return `<span class="sess-tx-msg markdown-content chat-md">${text}</span>${link}`;
}

function timeHtml(entry, opts) {
  const words = transcriptTime(entry.timestamp, opts);
  return words ? `<span class="chat-msg__time">${esc(words)}</span>` : '';
}

function bubble(entry, { inProgress, liClass, testId }, opts) {
  const { host } = opts;
  const pill = { label: 'agent', className: 'chat-msg__who' };
  if (inProgress) pill.state = 'in-progress';
  else pill.variant = 'tag';
  const surface = host.renderSurface({ body: bodyHtml(entry, host), as: 'div', className: 'chat-msg__body' });
  return `<li class="chat-msg ${liClass}" data-testid="${testId}">${host.renderStatusPill(pill)}${surface}${timeHtml(entry, opts)}</li>`;
}

function waitingNote(entry, opts) {
  const what = entry.waiting && entry.waiting.what;
  const words = what ? `waiting on ${what}` : 'waiting';
  const time = transcriptTime(entry.timestamp, opts);
  return `<li class="chat-note sess-tx-waiting" data-testid="transcript-waiting">${esc(time ? `${words} · ${time}` : words)}</li>`;
}

function agentThread(part, opts) {
  const n = part.entries.length;
  const items = part.entries.map((entry) => bubble(entry, { inProgress: false, liClass: 'sess-run-tx-entry sess-agent-tx-entry', testId: 'transcript-agent-entry' }, opts)).join('');
  return `<li class="sess-agent-thread" data-testid="transcript-agent-thread" data-agent="${esc(part.agent)}">`
    + '<details class="sess-agent-thread__details">'
    + '<summary class="sess-agent-thread__summary" data-testid="transcript-agent-summary">'
    + `<span class="sess-agent-thread__who">child agent</span> <span class="sess-agent-thread__name">${esc(part.agent)}</span>`
    + ` <span class="sess-agent-thread__count">· ${n} ${n === 1 ? 'message' : 'messages'}</span></summary>`
    + `<ul class="sess-agent-thread__tx chat-thread" data-testid="transcript-agent-list">${items}</ul>`
    + '</details></li>';
}

/**
 * The parts a transcript draws, in order: `{ type: 'say' | 'waiting', entry }` for a run's own entry and
 * `{ type: 'thread', agent, entries }` for each child agent, at its first entry. `quiet` entries are left out.
 */
export function transcriptParts(entries) {
  const parts = [];
  const threads = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || entry.quiet) continue;
    if (entry.agent) {
      const agent = String(entry.agent);
      if (!threads.has(agent)) {
        const thread = { type: 'thread', agent, entries: [] };
        threads.set(agent, thread);
        parts.push(thread);
      }
      threads.get(agent).entries.push(entry);
      continue;
    }
    parts.push({ type: entry.waiting ? 'waiting' : 'say', entry });
  }
  return parts;
}

/**
 * The transcript's items, as the inner HTML of a `<ul class="chat-thread">` the page owns ('' when nothing is drawn).
 *
 * @param {Array} entries - the server's transcript entries (lib/dispatch-transcript.js)
 * @param {{live?: boolean, host?: object, relative?: Function}} [opts]
 *   `live`: the run is still running, so its newest own entry, if a bubble, is in progress.
 *   `host`: what the page draws with (common.js's `renderMarkdown`, `renderStatusPill`, `renderSurface`, `formatLocalTime`).
 *   `relative`: the relative time words (lib/time-words.js `relativeAgo`).
 * @returns {string}
 */
export function renderTranscript(entries, { live = false, host = {}, relative = null } = {}) {
  const parts = transcriptParts(entries);
  const opts = { host, relative };
  let newestOwn = -1;
  parts.forEach((part, i) => { if (part.type !== 'thread') newestOwn = i; });
  return parts.map((part, i) => {
    if (part.type === 'thread') return agentThread(part, opts);
    if (part.type === 'waiting') return waitingNote(part.entry, opts);
    const liClass = 'sess-run-tx-entry' + (part.entry.blocked ? ' chat-msg--blocked' : '');
    return bubble(part.entry, { inProgress: live && i === newestOwn, liClass, testId: 'transcript-entry' }, opts);
  }).join('');
}
