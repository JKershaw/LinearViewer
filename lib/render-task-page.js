/**
 * Task page renderer (LIN-3329, Subtask B of LIN-3324).
 *
 * Formats the model `lib/task-page-loader.js` builds; it derives nothing. The
 * page reads top to bottom (LIN-3324's approved mockup, polished in LIN-3356 after
 * John's phone review of a real run):
 *
 *   1. the answer — id, title, a status pill (running / waiting / done), one
 *      sentence, and the brief's `## Current` paragraph when one is cached;
 *   2. stages — one bar row per stage (`model.stages`): filled when done,
 *      ticking while running, grey and dashed while still ahead, each with when
 *      it started and how long it took. A stage opens to its sessions; the
 *      orchestrator's check-ins are folded into it, closed. The one progress
 *      picture on the page (no second summary strip);
 *   3. the pull request — a justification in plain words, the owner's one
 *      primary merge button under it (LIN-3340's close-out box), and the raw
 *      evidence and ledger in a closed disclosure;
 *   4. the brief and the recap, cache-only (beside the stages on desktop);
 *   5. description and comments, from the one tracker read, closed disclosures;
 *   6. task details, closed to start with;
 *   7. the share slot (LIN-3330 fills it).
 *
 * The running or blocked stage starts open; the rest start closed. The task's
 * evidence is NOT hosted in a stage (LIN-3340): it lives in the pull request
 * section, outside every repainted mount, so the poll can neither lose it nor
 * move it.
 *
 * Viewer isolation (for LIN-3330's guest page). `viewer` is read in one place:
 * `renderOwnerControls(model, …)` holds every owner-only fragment (the widget
 * marker, the close-out box, the share slot). Nothing else is viewer-aware, so
 * the owner and guest HTML differ only by what this one function returns. Links
 * back into Harbour stay for every viewer (John's check-in), so `harbourHref`
 * takes no viewer.
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
import { renderContextPanel } from './render-run-steps.js';
import { renderEvidence, renderCloseOutBox } from './render-run-evidence.js';
import { fmtWhen, stageLabel } from './task-page-loader.js';

const STYLESHEETS = ['/style.css', '/common-actions.css', '/session.css', '/task-page.css'];
// One script list for both viewers. The viewer is read in exactly one place
// (`renderOwnerControls`); owner-only behaviour starts from an owner-only DOM
// hook (`task-page-owner-widgets`, the close-out box), so the guest loads the
// same scripts and they no-op. This keeps the owner/guest `<head>` byte-identical.
const SCRIPTS = ['/purify.min.js', '/marked.min.js', '/common.js', '/brief.js', '/recap.js', '/close-out.js', '/task-page.js'];

const VIEWERS = new Set(['owner', 'guest']);

/**
 * A short, deterministic signature of a rendered context fragment (FNV-1a, hex).
 * The page stamps it on the context mount and the state endpoint returns the
 * same value, so the client repaints the mount only when the brief/recap HTML
 * actually changed — an unchanged brief is never repainted (no flicker, and a
 * guest's client-side markdown survives; LIN-3340 F2).
 *
 * @param {string} html
 * @returns {string}
 */
export function contextSignature(html) {
  let hash = 0x811c9dc5;
  const text = String(html || '');
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Header pill state per page status (the shared `.status-pill` vocabulary). */
const STATUS_PILL = {
  done: { state: 'done', label: 'done' },
  waiting: { state: 'running', label: 'waiting' },
  running: { state: 'running', label: 'running' },
  idle: { state: 'queued', label: 'idle' },
};

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

/** The cached brief's paragraph as plain text: inline Markdown marks dropped. */
function plainParagraph(text) {
  return String(text || '').replace(/\*\*|__|`/g, '').replace(/\s*\n\s*/g, ' ').trim();
}

/**
 * The status pill, its one sentence, and — when the brief's `## Current`
 * paragraph is cached — that paragraph (LIN-3356). Viewer-blind; the state
 * endpoint repaints exactly this fragment.
 *
 * @param {Object} model
 * @returns {string}
 */
export function renderTaskStatus(model) {
  const pill = STATUS_PILL[model.status] || STATUS_PILL.idle;
  const summary = model.summary
    ? `\n      <p class="task-summary" data-testid="task-page-summary">${escapeHtml(plainParagraph(model.summary))}</p>`
    : '';
  return `<div class="task-status" data-testid="task-page-status" data-status="${escapeHtml(model.status)}">
      <span class="status-pill status-pill--${pill.state} task-status-pill" data-testid="task-page-status-pill"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(pill.label)}</span>
      <p class="task-sentence" data-testid="task-page-sentence">${escapeHtml(model.sentence)}</p>${summary}
    </div>`;
}

// ─── 2. Stages ───────────────────────────────────────────────────────────────

/**
 * A span of time as `1h 40m` / `4m 5s` / `45s`. The client's `formatElapsed`
 * (public/task-page.js) is the same function, so a ticking clock reads exactly
 * as the server drew it.
 */
export function formatSpan(ms) {
  if (!(ms >= 0)) return null;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** The word a stage's state is spoken as (never colour alone). */
const STAGE_STATE_WORD = {
  done: 'done',
  continued: 'done',
  running: 'running',
  queued: 'queued',
  waiting: 'waiting for an answer',
  failed: 'failed',
  aborted: 'aborted',
  cancelled: 'cancelled',
  expired: 'expired',
  closed: 'closed',
};

/** Bar tone per stage state: the run-status vocabulary the page already uses. */
function stageTone(state) {
  if (state === 'done' || state === 'continued') return 'done';
  if (state === 'running') return 'running';
  if (state === 'queued') return 'queued';
  if (state === 'waiting') return 'waiting';
  if (state === 'ahead') return 'ahead';
  // LIN-3364: closed at the source is not a failure; it must not fall through to error red.
  if (state === 'closed') return 'neutral';
  return 'error';
}

/** "started 2h 5m ago" / "took 1h 40m" / "running 4m": the stage's time line. */
function stageTime(stage, now) {
  const started = stage.startedAt ? Date.parse(stage.startedAt) : NaN;
  const ago = Number.isFinite(started) ? formatSpan(now.getTime() - started) : null;
  const parts = [];
  if (ago) {
    parts.push(`<span class="task-stage-ago" data-testid="task-page-stage-ago" data-started-at="${escapeHtml(stage.startedAt)}" title="${escapeHtml(fmtWhen(stage.startedAt, now) || '')}">started ${escapeHtml(ago)} ago</span>`);
  }
  const live = stage.state === 'running';
  if (live && Number.isFinite(started)) {
    parts.push(`<span class="task-stage-took" data-testid="task-page-stage-took" data-running-since="${escapeHtml(stage.startedAt)}">running ${escapeHtml(formatSpan(now.getTime() - started) || '')}</span>`);
  } else if (stage.durationMs != null) {
    parts.push(`<span class="task-stage-took" data-testid="task-page-stage-took">took ${escapeHtml(formatSpan(stage.durationMs) || '')}</span>`);
  }
  return parts.join(' · ');
}

/** One session line inside an opened stage. */
function renderStageSession(session, index, now) {
  const when = fmtWhen(session.endedAt, now);
  const line = [`attempt ${index + 1}`, STAGE_STATE_WORD[session.state] || session.state];
  if (session.state !== 'running' && session.state !== 'queued' && session.state !== 'waiting' && when) line.push(when);
  const message = session.message
    ? `<p class="task-stage-message" data-testid="task-page-session-message">${escapeHtml(session.message)}</p>`
    : '<p class="task-stage-message sess-muted" data-testid="task-page-session-message">no message recorded</p>';
  const links = session.links.length
    ? `<ul class="task-stage-links" data-testid="task-page-session-links">${session.links.map(l => `<li>${externalLink(l.url, l.label || l.url, 'task-page-session-link')}</li>`).join('')}</ul>`
    : '';
  return `<li class="task-stage-session" data-testid="task-page-session" data-state="${escapeHtml(session.state)}" data-loop-id="${escapeHtml(String(session.loopId || ''))}">
          <div class="task-stage-session-line" data-testid="task-page-session-line">${escapeHtml(line.join(' · '))}</div>${message}${links}
        </li>`;
}

/** The folded check-ins: a closed disclosure, one quiet line each. */
function renderCheckIns(checkIns, now) {
  if (!checkIns.length) return '';
  const rows = checkIns.map((c) => {
    const when = fmtWhen(c.loop.takenAt || c.loop.dispatchedAt, now);
    return `<li class="task-checkin" data-testid="task-page-checkin" data-kind="${escapeHtml(c.kind || '')}">${escapeHtml(c.label)}${when ? ` · ${escapeHtml(when)}` : ''}${c.message ? `<span class="task-checkin-message">${escapeHtml(c.message.split('\n')[0])}</span>` : ''}</li>`;
  }).join('');
  return `<details class="task-checkins" data-testid="task-page-checkins"><summary>${checkIns.length} check-in${checkIns.length === 1 ? '' : 's'}</summary><ul class="task-checkin-list">${rows}</ul></details>`;
}

function renderStage(stage, now) {
  const tone = stageTone(stage.state);
  const attempts = stage.attempts > 1 ? ` <span class="task-stage-attempts" data-testid="task-page-stage-attempts">${stage.attempts} attempts</span>` : '';
  const classes = ['task-stage', 'task-step'];
  if (stage.open) classes.push('sess-run--expanded');
  const body = stage.sessions.map((s, i) => renderStageSession(s, i, now)).join('');
  return `<li class="${classes.join(' ')}" data-testid="task-page-stage" data-state="${escapeHtml(stage.state)}" data-tone="${tone}" data-kind="${escapeHtml(stage.kind || '')}" data-loop-id="${escapeHtml(String(stage.id || ''))}">
        <button type="button" class="task-stage-head" data-testid="task-page-stage-head" aria-expanded="${stage.open ? 'true' : 'false'}">
          <span class="task-stage-top"><span class="task-stage-name" data-testid="task-page-stage-name">${escapeHtml(stage.label)}</span>${attempts} <span class="task-stage-state" data-testid="task-page-stage-state">${escapeHtml(STAGE_STATE_WORD[stage.state] || stage.state)}</span></span>
          <span class="task-stage-bar" aria-hidden="true"><span class="task-stage-fill"></span></span>
          <span class="task-stage-time" data-testid="task-page-stage-time">${stageTime(stage, now)}</span>
        </button>
        <div class="task-stage-body" data-testid="task-page-stage-body">
          <ol class="task-stage-sessions">${body}</ol>
          ${renderCheckIns(stage.checkIns, now)}
        </div>
      </li>`;
}

function renderAheadStage(stage) {
  return `<li class="task-stage task-stage--ahead" data-testid="task-page-stage-ahead" data-state="ahead" data-tone="ahead" data-kind="${escapeHtml(stage.kind || '')}">
        <div class="task-stage-head task-stage-head--ahead">
          <span class="task-stage-top"><span class="task-stage-name">${escapeHtml(stage.label)}</span> <span class="task-stage-state">usually next</span></span>
          <span class="task-stage-bar" aria-hidden="true"><span class="task-stage-fill"></span></span>
        </div>
      </li>`;
}

/**
 * The stages (replaces LIN-3329's session-by-session progress feed; same name so
 * both state endpoints keep repainting through it). Viewer-blind.
 *
 * @param {Object} model
 * @param {Object} [opts]
 * @param {Date} [opts.now]
 * @returns {string}
 */
export function renderTaskTrack(model, { now = new Date() } = {}) {
  const stages = Array.isArray(model.stages) ? model.stages : [];
  const empty = !stages.some(st => st.state !== 'ahead')
    ? '<p class="sess-muted task-track-empty" data-testid="task-page-track-empty">○ no sessions yet</p>'
    : '';
  const rows = stages.map(st => (st.state === 'ahead' ? renderAheadStage(st) : renderStage(st, now))).join('');
  return `${empty}${rows ? `<ol class="task-stages-list" data-testid="task-page-track">${rows}</ol>` : ''}`;
}

// ─── 3. Pull request ─────────────────────────────────────────────────────────

/** Does the evidence model have anything to show? (a PR or a ledger) */
function hasEvidence(evidence) {
  return !!(evidence && ((evidence.state && evidence.state.pr) || evidence.ledger));
}

/** The plain-words lead per close-out status (every `CLOSE_OUT_STATUS`). */
function prLead(closeOut, pr) {
  const n = (closeOut && closeOut.pr && closeOut.pr.number != null ? closeOut.pr.number : pr && pr.number);
  const label = n != null ? `PR #${n}` : 'The pull request';
  switch (closeOut && closeOut.status) {
    case 'ready': return `${label} is approved and ready to merge.`;
    // A guest's load has no runner, so it reads 'not-ready' for a PR the owner
    // sees as ready; that reason is about the viewer, not the PR.
    case 'not-ready':
      if (closeOut.reason === 'runner-not-set-up') return `${label} is approved and ready to merge.`;
      return `${label} is open, but it isn't ready to merge yet.`;
    case 'merged': return closeOut.mergedByYou ? `You merged ${label}.` : `${label} is merged.`;
    case 'partial': return 'Some of this task\'s pull requests are merged and others are still open.';
    case 'closed': return `${label} was closed without being merged.`;
    case 'multiple-prs': return 'This task has more than one pull request, so it can\'t be merged from here.';
    case 'no-pr': return 'No pull request has been opened for this task yet.';
    default: return `${label} couldn't be read just now, so its state isn't known.`;
  }
}

/**
 * The finished task's merge sentence: third person for every viewer, from the
 * stored close-out events (never GitHub's owner-blind "merged by you"). No merge
 * time is stored, so the "when" is the close-out's date, worded as such.
 */
function mergerSentence(closeOut, summary, now) {
  const n = closeOut.pr && closeOut.pr.number != null ? closeOut.pr.number : null;
  const label = n != null ? `PR #${n}` : 'The pull request';
  let base;
  if (closeOut.mergedBy === 'person') base = `${label} was merged by hand`;
  else if (closeOut.mergedBy === 'close-out') base = `${label} was merged by Harbour's close-out, after the owner pressed merge`;
  else base = `${label} is merged`;
  const when = summary ? fmtWhen(summary.at, now) : null;
  return `${base}${when ? `, as reported in the close-out on ${when}` : ''}.`;
}

const REVIEW_COPY = {
  approve: 'Review approved it',
  'approve-conditional': 'Review approved it, with conditions',
  'request-changes': 'Review asked for changes',
};

const CHECKS_COPY = {
  passing: 'Checks are passing',
  failing: 'Checks are failing',
  pending: 'Checks are still running',
  unknown: "Checks couldn't be read",
};

/** The review, checks and ledger as plain sentences (no SHAs, ids or ISO times). */
function prDetail(evidence, now, finished = false) {
  const status = evidence.closeOut && evidence.closeOut.status;
  // With no single PR there is nothing to check; say only what the review said.
  const singlePr = status !== 'no-pr' && status !== 'multiple-prs';
  const review = evidence.evidence && evidence.evidence.checked && evidence.evidence.checked.review;
  const check = evidence.evidence && evidence.evidence.checked && evidence.evidence.checked.now;
  const sentences = [];
  if (review) {
    const base = REVIEW_COPY[review.verdict] || 'A review is on record';
    const when = fmtWhen(review.at, now);
    sentences.push(`${base}${when ? ` on ${when}` : ''}.`);
  } else {
    sentences.push('No review is on record yet.');
  }
  if (!singlePr) {
    // no PR to check
  } else if (check && check.state && CHECKS_COPY[check.state]) {
    sentences.push(`${CHECKS_COPY[check.state]}${check.headMoved ? ', but the code has changed since the review' : ''}.`);
  } else if (check && check.headMoved) {
    sentences.push('The code has changed since the review.');
  }
  const ledger = evidence.ledger && evidence.ledger.ledger;
  if (ledger && ledger.present) {
    if (ledger.empty) {
      sentences.push('CI covered everything, so there is nothing to check.');
    } else if (finished) {
      // A finished task doesn't re-adjudicate the review-time ledger: no count,
      // no stamps (LIN-3373). The review's and the close-out's own words follow.
      // Wording is set by renderTaskPullRequest, which knows the final state.
    } else if (Array.isArray(ledger.items) && ledger.items.length) {
      const total = ledger.items.length;
      const cleared = ledger.items.filter(i => i.discharged).length;
      sentences.push(`${total} thing${total === 1 ? '' : 's'} CI couldn't prove: ${cleared === total ? 'all checked' : `${cleared} of ${total} checked`}.`);
    }
  }
  return sentences.join(' ');
}

/**
 * The task's pull request: its justification in plain words for EVERY viewer,
 * the owner's merge button under it (passed in as the owner fragment), and the
 * raw evidence and ledger in a closed disclosure. Rendered only when there is a
 * PR or a ledger, so a task with no run shows no empty section. The section sits
 * outside every repainted mount, so a poll cannot move or lose it.
 *
 * @param {Object} model
 * @param {string} [ownerBox] - `renderOwnerControls().pullRequest`
 * @param {Date} [now]
 * @returns {string}
 */
export function renderTaskPullRequest(model, ownerBox = '', now = new Date()) {
  if (!hasEvidence(model.evidence)) return '';
  const evidence = model.evidence;
  const closeOut = evidence.closeOut || null;
  const prInfo = evidence.state && evidence.state.pr;
  const finished = !!model.finished;
  const summary = evidence.closeOutSummary || null;
  const lead = finished && closeOut && closeOut.status === 'merged'
    ? mergerSentence(closeOut, summary, now)
    : prLead(closeOut, prInfo);
  let detail = prDetail(evidence, now, finished);
  if (finished && (summary || (evidence.ledger && evidence.ledger.ledger && evidence.ledger.ledger.present && !evidence.ledger.ledger.empty))) {
    const end = model.tracker && model.tracker.state && model.tracker.state.type === 'canceled' ? 'This task was cancelled.' : 'This task is done.';
    detail = `${detail} ${end} ${summary ? "The close-out's summary and the review's ledger are" : "The review's ledger is"} under “The checks and the review ledger”.`;
  }
  const says = `<div class="task-pr-says" data-testid="task-page-pr-summary" data-state="${escapeHtml((closeOut && closeOut.status) || 'unknown')}">
      <p class="task-pr-lead" data-testid="task-page-pr-lead">${escapeHtml(lead)}</p>
      <p class="task-pr-detail" data-testid="task-page-pr-detail">${escapeHtml(detail)}</p>
    </div>`;
  const quote = finished && summary
    ? { label: `Close-out summary${fmtWhen(summary.at, now) ? `, ${fmtWhen(summary.at, now)}` : ''} — its own words, not re-reviewed`, text: summary.text }
    : null;
  const raw = renderDisclosure({
    summary: 'The checks and the review ledger',
    body: renderEvidence(evidence, finished ? { finished: true, closeOutQuote: quote } : {}),
    className: 'task-pr-raw',
    attrs: 'data-testid="task-page-pr-raw"',
  });
  return renderSection({
    className: 'sess-section task-pr-section',
    title: 'Pull request',
    body: `<div class="task-pr-mount" data-testid="task-page-pr-mount">${says}${ownerBox}${raw}</div>`,
  });
}

// ─── 3. Brief and recap ──────────────────────────────────────────────────────
/**
 * The brief and recap panels, cache-only. Viewer-blind: the owner's live
 * widgets are mounted client-side from the `task-page-owner-widgets` marker
 * (see `renderOwnerControls`), so the state endpoint can repaint the panels
 * without ever re-sending a control.
 *
 * @param {Object} model
 * @param {{urlKey: string}} opts
 * @returns {string}
 */
export function renderTaskContext(model, { urlKey }) {
  // A cached doc withheld by the loader says why, rather than "none yet".
  const contextMissText = (label, kind, m) => {
    const miss = m.contextMiss && m.contextMiss[kind];
    if (miss === 'stale') return `○ ${label.toLowerCase()} out of date: written before the latest changes`;
    if (miss === 'unverifiable') return `○ ${label.toLowerCase()} can't be checked against the latest changes`;
    return `○ no ${label.toLowerCase()} yet`;
  };
  const panel = (label, kind, doc) => renderContextPanel({
    label,
    kind,
    issueIdentifier: model.identifier,
    issueId: model.issueId,
    body: doc ? doc.body : null,
    model: doc ? doc.model : null,
    generatedAt: doc ? doc.generatedAt : null,
    urlKey,
    missText: contextMissText(label, kind, model),
  });
  return `<div class="task-context" data-testid="task-page-context">
      ${panel('Brief', 'brief', model.brief)}
      ${panel('Recap', 'recap', model.recap)}
    </div>`;
}

// ─── 4. Description and comments ─────────────────────────────────────────────

/**
 * The task's description and its comments, from the ONE tracker read, as closed
 * disclosures for both viewers. Placed outside every repainted mount, so the
 * poll never touches them: they show the tracker as of page load and a reload
 * refreshes them. Text is escaped here; the client upgrades `[data-md]` bodies
 * to markdown once at load.
 *
 * @param {Object} model
 * @param {Date} now
 * @returns {string}
 */
export function renderTaskDocs(model, now = new Date()) {
  const description = typeof model.description === 'string' && model.description.trim() ? model.description : null;
  const comments = Array.isArray(model.comments) ? model.comments : [];
  if (!description && comments.length === 0) return '';
  const descHtml = description
    ? renderDisclosure({
        summary: 'Description',
        body: `<div class="task-md" data-md="description" data-testid="task-page-description-body">${escapeHtml(description)}</div>`,
        className: 'task-doc',
        attrs: 'data-testid="task-page-description"',
      })
    : '';
  const commentsHtml = comments.length
    ? renderDisclosure({
        summary: `Comments (${comments.length})`,
        body: comments.map(c => `<article class="task-comment" data-testid="task-page-comment">`
          + `<div class="task-comment-head"><span class="task-comment-author" data-testid="task-page-comment-author">${escapeHtml(c.author || 'unknown')}</span>`
          + (c.createdAt ? ` <span class="task-comment-time" data-testid="task-page-comment-time">${escapeHtml(fmtWhen(c.createdAt, now) || '')}</span>` : '')
          + `</div><div class="task-md task-comment-body" data-md="comment" data-testid="task-page-comment-body">${escapeHtml(c.body)}</div></article>`).join(''),
        className: 'task-doc',
        attrs: 'data-testid="task-page-comments"',
      })
    : '';
  return `<div class="task-docs" data-testid="task-page-docs">${descHtml}${commentsHtml}</div>`;
}

// ─── 5. Task details ─────────────────────────────────────────────────────────

function kv(key, valueHtml, testid) {
  return `<div class="sess-kv"><span class="sess-k">${escapeHtml(key)}</span><span class="sess-v" data-testid="${testid}">${valueHtml}</span></div>`;
}

function refList(ctx, refs, testid) {
  return `<ul class="task-ref-list" data-testid="${testid}">${refs.map(r => `<li class="task-ref"><span class="task-ref-glyph" aria-hidden="true">${stateGlyph(r.state && r.state.type)}</span> ${taskLink(ctx, r, `${testid}-link`)} <span class="task-ref-title">${escapeHtml(r.title || '')}</span>${r.state && r.state.name ? ` <span class="task-ref-state">${escapeHtml(r.state.name)}</span>` : ''}</li>`).join('')}</ul>`;
}

/**
 * What the sessions row counts, so it agrees with the stage bars above it: every
 * session inside the stages, grouped by the word the bars speak (`STAGE_STATE_WORD`,
 * the whole vocabulary incl. closed/expired; an unknown state still appears under
 * its own name), plus the folded check-ins. Only non-zero groups are named, so the
 * parts sum to the total by construction. No stages: no row.
 */
export function sessionsLine(model) {
  const stages = (Array.isArray(model.stages) ? model.stages : []).filter(st => st.state !== 'ahead');
  if (!stages.length) return null;
  const groups = new Map();
  let total = 0;
  let checkIns = 0;
  for (const st of stages) {
    checkIns += (st.checkIns || []).length;
    for (const sess of st.sessions || []) {
      const word = STAGE_STATE_WORD[sess.state] || sess.state;
      groups.set(word, (groups.get(word) || 0) + 1);
      total += 1;
    }
  }
  const parts = [...groups].map(([word, n]) => `${n} ${word}`).join(', ');
  return `${total} across ${stages.length} stage${stages.length === 1 ? '' : 's'} (${parts})${checkIns ? `, plus ${checkIns} check-in${checkIns === 1 ? '' : 's'}` : ''}`;
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
    sessionsLine(model) ? kv('sessions', escapeHtml(sessionsLine(model)), 'task-page-detail-sessions') : '',
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
 *   - `context`: a hidden marker telling the client to upgrade the brief/recap
 *     panels to live `BriefSection`/`RecapSection` widgets (which carry their own
 *     inline refresh). The panels themselves render for both viewers, so their
 *     presence is not the signal — this marker is. Opening the page never
 *     generates anything; the widget GETs status only.
 *   - `pullRequest`: the close-out box (the merge click), keyed from the task's
 *     own data — the tracker UUID and the provider kind — by `public/close-out.js`.
 *   - `share`: the share/revoke controls (LIN-3330). The button, list and
 *     one-time URL box are wired by `public/task-page.js`; the guest render omits
 *     the whole fragment (so a guest has no controls at all).
 *
 * @param {Object} model
 * @param {{urlKey: string, binding: Object}} ctx
 * @returns {{context: string, pullRequest: string, share: string}}
 */
export function renderOwnerControls(model, { urlKey, binding = {} }) {
  const context = '<span class="task-owner-widgets" data-testid="task-page-owner-widgets" hidden></span>';
  const closeOut = model.evidence ? model.evidence.closeOut : null;
  const prNumber = closeOut && closeOut.pr && closeOut.pr.number != null ? closeOut.pr.number : null;
  const pullRequest = renderCloseOutBox(closeOut, { issueId: model.issueId, source: binding.source, pressLabel: prNumber != null ? `Merge PR #${prNumber}` : 'Merge' });
  const shareBase = `/workspace/${encodeURIComponent(urlKey || '')}/api/task/${encodeURIComponent(model.identifier || '')}`;
  const share = `<div class="task-share" data-testid="task-page-share-slot" data-create-url="${escapeHtml(harbourHref(`${shareBase}/share`, binding))}" data-shares-url="${escapeHtml(harbourHref(`${shareBase}/shares`, binding))}">
      <div class="task-share-head">
        <span class="task-share-label">Share this task</span>
        <button type="button" class="task-share-create" data-action="task-share-create" data-testid="task-share-create">Create share link</button>
        <span class="task-share-note" data-testid="task-share-note" role="status" aria-live="polite"></span>
      </div>
      <div class="task-share-new" data-testid="task-share-new" hidden></div>
      <ul class="task-share-list" data-testid="task-share-list"></ul>
    </div>`;
  return { context, pullRequest, share };
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
  const owner = viewer === 'owner' ? renderOwnerControls(model, ctx) : { context: '', pullRequest: '', share: '' };

  const backHref = harbourHref(`/workspace/${encodeURIComponent(urlKey)}/`);
  const backLink = `<a class="sess-back" data-testid="task-page-back" href="${escapeHtml(backHref)}">← back to tasks</a>`;

  const title = model.title || '';
  const headingHtml = `<span class="task-ident" data-testid="task-page-ident">${escapeHtml(model.identifier)}</span>${title ? ` <span class="task-title" data-testid="task-page-title">${escapeHtml(title)}</span>` : ''}`;
  const docTitle = `${escapeHtml(model.identifier)}${title ? ` — ${escapeHtml(title)}` : ''}`;

  const binding_ = binding || {};
  const mergeReady = !!(model.evidence && model.evidence.closeOut && model.evidence.closeOut.ready);
  const mainAttrs = [
    'class="sess-page task-page"',
    'data-testid="task-page"',
    `data-url-key="${escapeHtml(urlKey)}"`,
    `data-identifier="${escapeHtml(model.identifier)}"`,
    `data-state-url="${escapeHtml(stateUrl)}"`,
    `data-status="${escapeHtml(model.status)}"`,
    `data-live="${model.live ? 'true' : 'false'}"`,
    `data-merge-ready="${mergeReady ? 'true' : 'false'}"`,
    binding_.source ? `data-source="${escapeHtml(binding_.source)}"` : '',
  ].filter(Boolean).join(' ');

  const { deployInfo = {}, openRouterSource = null, workspaces: navWorkspaces = [], featureFlags = {} } = pageOptions;
  // A drill-down borrows its parent's nav entry (the task list), no view tier.
  const navHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'projects', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/', urlKey, openRouterSource, featureFlags });

  const contextHtml = renderTaskContext(model, { urlKey });
  const content = `<main ${mainAttrs}>
    ${backLink}
    ${renderPageHeader({ titleHtml: headingHtml, headerClass: 'sess-header task-header' })}
    <section class="section sess-section task-answer" data-testid="task-page-answer">${renderTaskStatus(model)}</section>
    ${renderSection({ className: 'sess-section task-stages', title: 'Stages', body: `<div class="task-track-mount" data-testid="task-page-track-mount">${renderTaskTrack(model, { now })}</div>` })}
    ${renderTaskPullRequest(model, owner.pullRequest, now)}
    ${renderSection({ className: 'sess-section task-context-section', title: 'Brief and recap', body: `<div class="task-context-mount" data-testid="task-page-context-mount" data-context-sig="${contextSignature(contextHtml)}">${contextHtml}</div>${owner.context}` })}
    ${renderTaskDocs(model, now)}
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
