/**
 * Task page renderer (LIN-3329, Subtask B of LIN-3324).
 *
 * Formats the model `lib/task-page-loader.js` builds; it derives nothing. The
 * page reads top to bottom in the order John approved (LIN-3324, "The page John
 * approved in a mockup"):
 *
 *   1. the answer — id, title, a status pill (running / waiting / done) and one
 *      sentence;
 *   2. progress — every session oldest-first, repeats included, each row the
 *      run page's lifted step face (`renderStepFace`), then the usual stages it
 *      hasn't had yet, drawn quietly as a guess;
 *   3. the brief and the recap, cache-only;
 *   4. task details, closed to start with;
 *   5. the share slot (LIN-3330 fills it).
 *
 * The running or blocked row starts open; the rest start closed. A row opens to
 * the session's own stored message, its `[evidence]` links, and — once, inside
 * the newest implementation/review/close-out row — the task's evidence.
 *
 * Viewer isolation (for LIN-3330's guest page). `viewer` is read in one place:
 * `renderOwnerControls(model, …)` holds every owner-only fragment ("ask for an
 * update", the share slot). Nothing else is viewer-aware, so the owner and guest
 * HTML differ only by what this one function returns. Links back into Harbour
 * stay for every viewer (John's check-in), so `harbourHref` takes no viewer.
 * No viewer flag goes into the run renderer (LIN-3325 history signal).
 *
 * The state endpoint repaints with `renderTaskStatus`, `renderTaskTrack` and
 * `renderTaskContext` — the same functions the page uses, so a poll can never
 * draw a row the page wouldn't.
 *
 * Escaping: `renderPage`'s `title` and `renderPageHeader`'s `titleHtml` are raw
 * by contract, so the user-controlled task title is escaped here at the call
 * site (the LIN-1567 sink, one page over).
 */

import { escapeHtml } from './utils/html.js';
import { taskPageHref } from './task-page-href.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderDisclosure } from './components/disclosure.js';
import { renderStepFace, renderContextPanel, runStatusMeta } from './render-run-steps.js';
import { renderEvidence } from './render-run-evidence.js';
import { computeSupersededLoopIds } from './loop-supersede.js';
import { fmtWhen, stageLabel } from './task-page-loader.js';

const STYLESHEETS = ['/style.css', '/common-actions.css', '/session.css', '/task-page.css'];
const SCRIPTS = ['/common.js', '/task-page.js'];

const VIEWERS = new Set(['owner', 'guest']);

/** Header pill state per page status (the shared `.status-pill` vocabulary). */
const STATUS_PILL = {
  done: { state: 'done', label: 'done' },
  waiting: { state: 'running', label: 'waiting' },
  running: { state: 'running', label: 'running' },
  idle: { state: 'queued', label: 'idle' },
};

/** The face's live status pill, and the queued pill a queued session gets instead. */
const QUEUED_FACE_FROM = 'status-pill--running" data-testid="session-run-status"><span class="status-pill__dot" aria-hidden="true"></span>running</span>';
const QUEUED_FACE_TO = 'status-pill--queued" data-testid="session-run-status"><span class="status-pill__dot" aria-hidden="true"></span>queued</span>';

/** Tracker state type → the CLI state glyph (✓ done, ◐ in progress, ○ todo). */
function stateGlyph(type) {
  if (type === 'completed') return '✓';
  if (type === 'canceled') return '✕';
  if (type === 'started') return '◐';
  return '○';
}

function assertViewer(viewer) {
  if (!VIEWERS.has(viewer)) throw new Error(`render-task-page: unknown viewer ${JSON.stringify(viewer)}`);
}

/**
 * Every link back into Harbour goes through here, the same for every viewer.
 * `query` carries the issue's provider-kind provenance (`?source=`, as the Edit
 * and Chat links do); empty values are dropped so a source-less task gets a bare
 * path.
 *
 * @param {string} path - already-encoded Harbour path
 * @param {Object<string,string|null|undefined>} [query]
 * @returns {string} href (unescaped; escape at the attribute)
 */
export function harbourHref(path, query = {}) {
  const params = Object.entries(query || {}).filter(([, v]) => v != null && v !== '');
  if (!params.length) return path;
  return `${path}?${params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')}`;
}

/** A Harbour link to another task's page, keeping this page's provider-kind source. */
function taskLink(ctx, ref, testid) {
  const href = taskPageHref({
    urlKey: ctx.urlKey,
    identifier: ref.identifier,
    source: ctx.binding?.source,
  });
  return `<a class="task-ref-ident" data-testid="${testid}" href="${escapeHtml(href)}">${escapeHtml(ref.identifier)}</a>`;
}

/** An external link (tracker, PR, evidence), opened in a new tab; http(s) only. */
function externalLink(url, text, testid) {
  if (!/^https?:\/\//i.test(String(url || ''))) return `<span data-testid="${testid}">${escapeHtml(text)}</span>`;
  return `<a class="task-ext" data-testid="${testid}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`;
}

// ─── 1. The answer ───────────────────────────────────────────────────────────

/**
 * The status pill and its one sentence. Viewer-blind; the state endpoint
 * repaints exactly this fragment.
 *
 * @param {Object} model
 * @returns {string}
 */
export function renderTaskStatus(model) {
  const pill = STATUS_PILL[model.status] || STATUS_PILL.idle;
  return `<div class="task-status" data-testid="task-page-status" data-status="${escapeHtml(model.status)}">
      <span class="status-pill status-pill--${pill.state} task-status-pill" data-testid="task-page-status-pill"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(pill.label)}</span>
      <p class="task-sentence" data-testid="task-page-sentence">${escapeHtml(model.sentence)}</p>
    </div>`;
}

// ─── 2. Progress ─────────────────────────────────────────────────────────────

/** The always-visible one-line "how it went" for a session row. */
function sessionSummary(session, now) {
  const when = (v) => fmtWhen(v, now);
  switch (session.state) {
    case 'running': {
      const since = when(session.loop.takenAt || session.loop.dispatchedAt);
      return since ? `running since ${since}` : 'running';
    }
    case 'queued':
      return 'queued, waiting for a worker';
    case 'waiting':
      return session.message ? `blocked: ${session.message.split('\n')[0]}` : 'blocked, waiting for an answer';
    default: {
      const at = when(session.endedAt);
      return at ? `${session.state} ${at}` : session.state;
    }
  }
}

/**
 * Does the evidence model have anything to show? A task with no PR and no
 * review ledger would render only "not recorded" rows, so it renders nothing.
 */
function hasEvidence(evidence) {
  return !!(evidence && ((evidence.state && evidence.state.pr) || evidence.ledger));
}

/** A session's opened body: its stored message, its links, maybe the evidence. */
function renderSessionBody(session, model) {
  const message = session.message
    ? `<p class="task-step-message" data-testid="task-page-step-message">${escapeHtml(session.message)}</p>`
    : '<p class="task-step-message sess-muted" data-testid="task-page-step-message">no message recorded</p>';
  const links = session.links.length
    ? `<ul class="task-step-links" data-testid="task-page-step-links">${session.links.map(l => `<li>${externalLink(l.url, l.label || l.url, 'task-page-step-link')}</li>`).join('')}</ul>`
    : '';
  // The slot renders even when empty: the state endpoint can't read evidence
  // (it needs the tracker), so the client carries the page's evidence across a
  // repaint into whichever row hosts the slot now.
  const evidence = session.evidenceHost
    ? `<div class="task-step-evidence" data-testid="task-page-evidence" data-evidence-slot="true">${hasEvidence(model.evidence) ? renderEvidence(model.evidence) : ''}</div>`
    : '';
  return `<div class="sess-run-body task-step-body" data-testid="task-page-step-body">${message}${links}${evidence}</div>`;
}

/**
 * The progress track: every session oldest-first (repeats are separate rows),
 * then the quiet guesses. Viewer-blind.
 *
 * @param {Object} model
 * @param {Object} [opts]
 * @param {Date} [opts.now]
 * @returns {string}
 */
export function renderTaskTrack(model, { now = new Date() } = {}) {
  const sessions = Array.isArray(model.sessions) ? model.sessions : [];
  const supersededLoopIds = computeSupersededLoopIds(sessions.map(s => s.loop));
  const rows = sessions.map((s) => {
    let faceHtml = renderStepFace(s.loop, { supersededLoopIds });
    // Two task-page corrections on this page's copy of the face (the shared
    // renderer is untouched, so the run page stays byte-identical): the face
    // always renders `aria-expanded="false"`, so an open row's head says
    // otherwise; and `runStatusMeta` reads only terminal markers, so a session
    // still in the queue would say "running" — it says "queued". Each replace
    // hits the first occurrence, which is the head's.
    if (s.open) faceHtml = faceHtml.replace('aria-expanded="false"', 'aria-expanded="true"');
    if (s.state === 'queued') faceHtml = faceHtml.replace(QUEUED_FACE_FROM, QUEUED_FACE_TO);
    const accent = s.state === 'queued' ? 'queued' : runStatusMeta(s.loop).state;
    const classes = ['sess-run', 'task-step'];
    if (s.open) classes.push('sess-run--expanded');
    return `<li class="${classes.join(' ')}" data-testid="task-page-step" data-status="${accent}" data-state="${escapeHtml(s.state)}" data-kind="${escapeHtml(s.kind || '')}" data-loop-id="${escapeHtml(String(s.loopId || ''))}">
        ${faceHtml}
        <div class="task-step-line"><span class="task-step-stage" data-testid="task-page-step-stage">${escapeHtml(s.label)}</span> <span class="task-step-summary" data-testid="task-page-step-summary">${escapeHtml(sessionSummary(s, now))}</span></div>
        ${renderSessionBody(s, model)}
      </li>`;
  }).join('');
  const list = sessions.length
    ? `<ol class="sess-runs task-track" data-testid="task-page-track">${rows}</ol>`
    : '<p class="sess-muted task-track-empty" data-testid="task-page-track-empty">○ no sessions yet</p>';
  const guesses = Array.isArray(model.guesses) ? model.guesses : [];
  const guessHtml = guesses.length
    ? `<div class="task-guesses" data-testid="task-page-guesses">
        <span class="task-guesses-label">usually next — a guess</span>
        <ol class="task-guess-list">${guesses.map(k => `<li class="task-guess" data-testid="task-page-guess" data-kind="${escapeHtml(k)}"><span class="task-guess-dot" aria-hidden="true">○</span> ${escapeHtml(stageLabel(k))}</li>`).join('')}</ol>
      </div>`
    : '';
  return `${list}${guessHtml}`;
}

// ─── 3. Brief and recap ──────────────────────────────────────────────────────

/**
 * The brief and recap panels, cache-only. Viewer-blind: the owner's "ask for an
 * update" sits beside this fragment (see `renderTaskPage`), so the state
 * endpoint can repaint the panels without ever re-sending a control.
 *
 * @param {Object} model
 * @param {{urlKey: string}} opts
 * @returns {string}
 */
export function renderTaskContext(model, { urlKey }) {
  const panel = (label, kind, doc) => renderContextPanel({
    label,
    kind,
    issueIdentifier: model.identifier,
    issueId: model.issueId,
    body: doc ? doc.body : null,
    model: doc ? doc.model : null,
    generatedAt: doc ? doc.generatedAt : null,
    urlKey,
    missText: `○ no ${label.toLowerCase()} yet`,
  });
  return `<div class="task-context" data-testid="task-page-context">
      ${panel('Brief', 'brief', model.brief)}
      ${panel('Recap', 'recap', model.recap)}
    </div>`;
}

// ─── 4. Task details ─────────────────────────────────────────────────────────

function kv(key, valueHtml, testid) {
  return `<div class="sess-kv"><span class="sess-k">${escapeHtml(key)}</span><span class="sess-v" data-testid="${testid}">${valueHtml}</span></div>`;
}

function refList(ctx, refs, testid) {
  return `<ul class="task-ref-list" data-testid="${testid}">${refs.map(r => `<li class="task-ref"><span class="task-ref-glyph" aria-hidden="true">${stateGlyph(r.state && r.state.type)}</span> ${taskLink(ctx, r, `${testid}-link`)} <span class="task-ref-title">${escapeHtml(r.title || '')}</span>${r.state && r.state.name ? ` <span class="task-ref-state">${escapeHtml(r.state.name)}</span>` : ''}</li>`).join('')}</ul>`;
}

/** Task details (closed to start with). Viewer-blind. */
function renderTaskDetails(model, ctx, now) {
  const d = model.details;
  if (!d) return '';
  const t = model.tracker || {};
  const mono = (v) => `<code>${escapeHtml(String(v))}</code>`;
  const rows = [
    kv('id', mono(d.identifier), 'task-page-detail-id'),
    d.issueId ? kv('tracker id', mono(d.issueId), 'task-page-detail-issue-id') : '',
    d.state ? kv('state', escapeHtml(d.state.name || d.state.type || ''), 'task-page-detail-state') : '',
    d.labels.length ? kv('labels', escapeHtml(d.labels.join(', ')), 'task-page-detail-labels') : '',
    d.createdAt ? kv('created', escapeHtml(fmtWhen(d.createdAt, now) || ''), 'task-page-detail-created') : '',
    d.updatedAt ? kv('updated', escapeHtml(fmtWhen(d.updatedAt, now) || ''), 'task-page-detail-updated') : '',
    kv('sessions', escapeHtml(`${d.sessionCount} (${d.doneCount} done, ${d.failedCount} failed)`), 'task-page-detail-sessions'),
    d.firstSessionAt ? kv('first session', escapeHtml(fmtWhen(d.firstSessionAt, now) || ''), 'task-page-detail-first') : '',
    d.lastSessionAt ? kv('last session', escapeHtml(fmtWhen(d.lastSessionAt, now) || ''), 'task-page-detail-last') : '',
    d.prUrl ? kv('pull request', externalLink(d.prUrl, d.prUrl.replace(/^https:\/\/github\.com\//, ''), 'task-page-detail-pr-link'), 'task-page-detail-pr') : '',
    d.headSha ? kv('head commit', mono(d.headSha), 'task-page-detail-head') : '',
    d.url ? kv('tracker', externalLink(d.url, 'open in tracker ↗', 'task-page-detail-tracker-link'), 'task-page-detail-tracker') : '',
  ].filter(Boolean).join('');
  const parent = t.parent ? `<div class="task-refs"><span class="task-refs-label">parent</span>${refList(ctx, [t.parent], 'task-page-parent')}</div>` : '';
  const subtasks = t.subtasks && t.subtasks.length ? `<div class="task-refs"><span class="task-refs-label">subtasks</span>${refList(ctx, t.subtasks, 'task-page-subtasks')}</div>` : '';
  const blockers = t.blockedBy && t.blockedBy.length ? `<div class="task-refs"><span class="task-refs-label">blocked by</span>${refList(ctx, t.blockedBy, 'task-page-blocked-by')}</div>` : '';
  return renderDisclosure({
    summary: 'Task details — ids, times, counts, subtasks and related tasks',
    body: `<div class="sess-kv-grid">${rows}</div>${parent}${subtasks}${blockers}`,
    className: 'task-details',
    attrs: 'data-testid="task-page-details"',
  });
}

// ─── Owner-only controls ─────────────────────────────────────────────────────

/**
 * Every owner-only fragment, and the only function that emits one:
 *   - `context`: "ask for an update" for the brief and the recap. Each button
 *     POSTs the existing session-only `/api/brief|recap/:issueId` with the
 *     issue's `source`; opening the page never starts one.
 *   - `share`: the slot LIN-3330's share/revoke controls fill. Empty for now.
 *
 * @param {Object} model
 * @param {{urlKey: string, binding: Object}} ctx
 * @returns {{context: string, share: string}}
 */
export function renderOwnerControls(model, { urlKey, binding = {} }) {
  const id = model.issueId || model.identifier;
  const askUrl = (kind) => harbourHref(`/workspace/${encodeURIComponent(urlKey || '')}/api/${kind}/${encodeURIComponent(id)}`, binding);
  const context = id
    ? `<div class="task-ctx-actions" data-testid="task-page-ask-update">
        <button type="button" class="task-ask" data-action="task-ask-update" data-kind="brief" data-url="${escapeHtml(askUrl('brief'))}" data-testid="task-page-ask-brief">ask for an updated brief</button>
        <button type="button" class="task-ask" data-action="task-ask-update" data-kind="recap" data-url="${escapeHtml(askUrl('recap'))}" data-testid="task-page-ask-recap">ask for an updated recap</button>
        <span class="task-ask-note" data-testid="task-page-ask-note" role="status" aria-live="polite"></span>
      </div>`
    : '';
  const share = '<div class="task-share-slot" data-testid="task-page-share-slot"></div>';
  return { context, share };
}

// ─── The page ────────────────────────────────────────────────────────────────

/**
 * @param {Object} model - `loadTaskPage(...).model`
 * @param {Object} [opts]
 * @param {'owner'|'guest'} [opts.viewer='owner']
 * @param {string} opts.urlKey
 * @param {{source?: string}} [opts.binding] - carried on Harbour links and owner POSTs
 * @param {string} [opts.stateUrl] - the stored-data state endpoint the client polls
 * @param {Date} [opts.now]
 * @param {Object} [opts.pageOptions] - shell options (deployInfo, workspaces, featureFlags, openRouterSource)
 * @returns {string} Complete HTML document
 */
export function renderTaskPage(model, { viewer = 'owner', urlKey = '', binding = {}, stateUrl = '', now = new Date(), pageOptions = {} } = {}) {
  assertViewer(viewer);
  const ctx = { urlKey, binding };
  const owner = viewer === 'owner' ? renderOwnerControls(model, ctx) : { context: '', share: '' };

  const backHref = harbourHref(`/workspace/${encodeURIComponent(urlKey)}/`);
  const backLink = `<a class="sess-back" data-testid="task-page-back" href="${escapeHtml(backHref)}">← back to tasks</a>`;

  const title = model.title || '';
  const headingHtml = `<span class="task-ident" data-testid="task-page-ident">${escapeHtml(model.identifier)}</span>${title ? ` <span class="task-title" data-testid="task-page-title">${escapeHtml(title)}</span>` : ''}`;
  const docTitle = `${escapeHtml(model.identifier)}${title ? ` — ${escapeHtml(title)}` : ''}`;

  const binding_ = binding || {};
  const mainAttrs = [
    'class="sess-page task-page"',
    'data-testid="task-page"',
    `data-url-key="${escapeHtml(urlKey)}"`,
    `data-identifier="${escapeHtml(model.identifier)}"`,
    `data-state-url="${escapeHtml(stateUrl)}"`,
    `data-status="${escapeHtml(model.status)}"`,
    `data-live="${model.live ? 'true' : 'false'}"`,
    binding_.source ? `data-source="${escapeHtml(binding_.source)}"` : '',
  ].filter(Boolean).join(' ');

  const { deployInfo = {}, openRouterSource = null, workspaces: navWorkspaces = [], featureFlags = {} } = pageOptions;
  // A drill-down borrows its parent's nav entry (the task list), no view tier.
  const navHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'projects', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/', urlKey, openRouterSource, featureFlags });

  const content = `<main ${mainAttrs}>
    ${backLink}
    ${renderPageHeader({ titleHtml: headingHtml, headerClass: 'sess-header task-header' })}
    <section class="section sess-section task-answer" data-testid="task-page-answer">${renderTaskStatus(model)}</section>
    ${renderSection({ className: 'sess-section task-progress', title: 'Progress', body: `<div class="task-track-mount" data-testid="task-page-track-mount">${renderTaskTrack(model, { now })}</div>` })}
    ${renderSection({ className: 'sess-section task-context-section', title: 'Brief and recap', body: `<div class="task-context-mount" data-testid="task-page-context-mount">${renderTaskContext(model, { urlKey })}</div>${owner.context}` })}
    ${renderTaskDetails(model, ctx, now)}
    ${owner.share}
  </main>
  ${footerHtml}`;

  return renderPage({
    title: docTitle,
    stylesheets: STYLESHEETS,
    nav: navHtml,
    content,
    scripts: SCRIPTS,
  });
}

/**
 * The not-found body (unknown id, or an id with no sessions the tracker doesn't
 * know): a rendered page on the shared shell, never a leak of whether the id
 * exists in some other workspace.
 *
 * @param {{identifier: string, urlKey: string}} data
 * @param {Object} [pageOptions]
 * @returns {string}
 */
export function renderTaskNotFoundPage({ identifier = '', urlKey = '' } = {}, pageOptions = {}) {
  const { deployInfo = {}, openRouterSource = null, workspaces: navWorkspaces = [], featureFlags = {} } = pageOptions;
  const backHref = harbourHref(`/workspace/${encodeURIComponent(urlKey)}/`);
  const content = `<main class="sess-page task-page" data-testid="task-page">
    <a class="sess-back" data-testid="task-page-back" href="${escapeHtml(backHref)}">← back to tasks</a>
    ${renderPageHeader({ titleHtml: 'Task not found', headerClass: 'sess-header task-header' })}
    ${renderSection({
      className: 'sess-section',
      title: 'Not found',
      body: `<p class="sess-notfound" data-testid="task-page-not-found">○ no task <code>${escapeHtml(identifier)}</code> in this workspace.</p>`,
    })}
  </main>
  ${renderPageFooter({ deployInfo, currentPage: '/', urlKey, openRouterSource, featureFlags })}`;
  return renderPage({
    title: 'Task not found',
    stylesheets: STYLESHEETS,
    nav: renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'projects', featureFlags }),
    content,
  });
}
