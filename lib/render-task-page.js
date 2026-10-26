/**
 * Task page renderer (LIN-3329, Subtask B of LIN-3324).
 *
 * Formats the model `lib/task-page-loader.js` builds; it derives nothing. The
 * page reads top to bottom (LIN-3324's approved mockup, polished in LIN-3356 after
 * John's phone review of a real run):
 *
 *   1. the answer — id, title, a status pill (running / waiting / done), one
 *      sentence, and the brief's `## Current` paragraph when one is cached.
 *      `<main>` also carries `data-merge-ready` and, only when ready, the
 *      ready header's HTML as `data-ready-header` (both from `model.readyHeader`,
 *      LIN-3448), which the client paints when a poll finds nothing running;
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
import { taskPageHref, runPageHref } from './task-page-href.js';
import { READ_HORIZON_DAYS } from './read-horizon.js';
import { getStateDisplay } from './providers/state-map.js';
import { renderPage } from './components/page.js';
import { renderNavBar } from './components/navbar.js';
import { renderPageFooter } from './components/footer.js';
import { renderSection } from './components/section.js';
import { renderPageHeader } from './components/page-header.js';
import { renderDisclosure } from './components/disclosure.js';
import { renderContextPanel, fmtDuration } from './render-run-steps.js';
import { timeHtml } from './components/time.js';
import { renderEvidence, renderCloseOutBox } from './render-run-evidence.js';
import { renderQuestionCards } from './question-card.js';
import { canReplyTo } from './run-view.js';
import { fmtWhen, stageLabel, attemptStartedAt, briefWithoutCurrent } from './task-page-loader.js';
import { renderRunnerLink } from './components/runner-link.js';
import { renderTaskChatFold } from './render-task-chat.js';

// stage-track.css (LIN-3968) is the stage piece's one home; Home links it too. run-control.css (LIN-3975) is the
// PromptSection run control's sheet, shared with Home and Swipe.
const STYLESHEETS = ['/style.css', '/common-actions.css', '/session.css', '/stage-track.css', '/run-control.css', '/chat.css', '/task-chat.css', '/task-page.css'];
// One script list for both viewers. The viewer is read in exactly one place
// (`renderOwnerControls`); owner-only behaviour starts from an owner-only DOM
// hook (`task-page-owner-widgets`, the close-out box, the run control's root), so the guest loads the
// same scripts and they no-op. This keeps the owner/guest `<head>` byte-identical.
// prompt-section.js and decision-panel.js (LIN-3975) are the run control's client; a guest page never mounts it.
const SCRIPTS = ['/purify.min.js', '/marked.min.js', '/common.js', '/chat.js', '/task-chat.js', '/brief.js', '/recap.js', '/close-out.js', '/question-cards.js', '/prompt-section.js', '/decision-panel.js', '/task-page.js'];

// LIN-3975: 'member' is a signed-in workspace member who is not the owner: read-only, like a guest, but signed in.
const VIEWERS = new Set(['owner', 'member', 'guest']);

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
  // LIN-3991: a stage whose latest session failed reads failed, in the error colour, as its row does.
  failed: { state: 'error', label: 'failed' },
  idle: { state: 'queued', label: 'idle' },
};

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
 * The exact time a state sentence names, beside it (LIN-3991): local time with the zone once the page
 * script runs (`data-local-time="zoned"`); the UTC text is only the no-JS fallback. '' when there is none.
 */
function sentenceTime(at, now) {
  const text = at ? fmtWhen(at, now) : null;
  if (!text) return '';
  return `\n      <time class="task-sentence-at" data-testid="task-page-sentence-at" datetime="${escapeHtml(at)}" data-local-time="zoned">${escapeHtml(text)}</time>`;
}

/**
 * The tracker's own state for the answer (LIN-3975): "Tracker: In Review". It sits OUTSIDE the status mount the
 * state endpoint repaints, so a poll never rewrites the tracker's word (it is the page-load read's). The pill
 * beside it is Harbour's state. '' when the tracker has no state.
 */
export function renderTrackerLine(model) {
  const name = model.tracker && model.tracker.state ? (model.tracker.state.name || model.tracker.state.type) : null;
  if (!name) return '';
  // Outside the repainted status, so a poll never rewrites the tracker's state; the pill is Harbour's.
  return `<p class="task-tracker-state" data-testid="task-page-tracker-state">Tracker: ${escapeHtml(name)}</p>`;
}

/**
 * The status pill, its one sentence, and — when the brief's `## Current`
 * paragraph is cached — that paragraph (LIN-3356). Viewer-blind; the state
 * endpoint repaints exactly this fragment.
 *
 * @param {Object} model
 * @returns {string}
 */
export function renderTaskStatus(model, { now = new Date() } = {}) {
  const pill = STATUS_PILL[model.status] || STATUS_PILL.idle;
  const summary = model.summary
    ? `\n      <p class="task-summary" data-testid="task-page-summary">${escapeHtml(plainParagraph(model.summary))}</p>`
    : '';
  return `<div class="task-status" data-testid="task-page-status" data-status="${escapeHtml(model.status)}">
      <span class="task-status-who" data-testid="task-page-harbour-label">Harbour:</span> <span class="status-pill status-pill--${pill.state} task-status-pill" data-testid="task-page-status-pill"><span class="status-pill__dot" aria-hidden="true"></span>${escapeHtml(pill.label)}</span>
      <p class="task-sentence" data-testid="task-page-sentence">${escapeHtml(model.sentence)}</p>${sentenceTime(model.sentenceAt, now)}${summary}
    </div>`;
}

/**
 * "What comes next" for a viewer with no run control (a member, a guest, or a finished task), in plain words
 * (LIN-3975). Viewer-blind and page-load only, so it sits in the slot the owner's run control takes.
 *
 * @param {Object} model
 * @returns {string}
 */
export function renderNextLine(model) {
  let text;
  if (model.finished) text = 'Nothing comes next: this task is finished.';
  else if (model.status === 'waiting') text = 'Nothing comes next until the question above is answered.';
  else if (!model.nextStep) text = 'A step is running, so nothing else is offered yet.';
  else if (model.nextStep.failed) text = `${model.nextStep.label} failed, so it comes next, to run again.`;
  else if (model.nextStep.why === 'again') text = `${model.nextStep.label} was cancelled, so it comes next again.`;
  else text = `${model.nextStep.label} comes next.`;
  return `<p class="task-next" data-testid="task-page-next">${escapeHtml(text)}</p>`;
}

// ─── 2. Stages ───────────────────────────────────────────────────────────────


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
  const ago = Number.isFinite(started) ? fmtDuration(now.getTime() - started) : null;
  const parts = [];
  if (ago) {
    parts.push(`<span class="task-stage-ago" data-testid="task-page-stage-ago" data-started-at="${escapeHtml(stage.startedAt)}" title="${escapeHtml(fmtWhen(stage.startedAt, now) || '')}">started ${escapeHtml(ago)} ago</span>`);
  }
  const live = stage.state === 'running';
  if (live && Number.isFinite(started)) {
    parts.push(`<span class="task-stage-took" data-testid="task-page-stage-took" data-running-since="${escapeHtml(stage.startedAt)}">running ${escapeHtml(fmtDuration(now.getTime() - started) || '')}</span>`);
  } else if (stage.durationMs != null) {
    parts.push(`<span class="task-stage-took" data-testid="task-page-stage-took">took ${escapeHtml(fmtDuration(stage.durationMs) || '')}</span>`);
  }
  return parts.join(' · ');
}

/**
 * An attempt's link to its run (LIN-3975). A run it can resolve links to its run page; an attempt the run page
 * cannot open says why in plain words (older than the read window, or no session at all), rather than linking to a
 * page that cannot open it. Nothing for a viewer with no run page (a guest).
 */
function attemptRunLink(session, ctx) {
  if (!ctx.runLinks) return '';
  if (session.runId) {
    return ` <a class="task-stage-run" data-testid="task-page-attempt-run" href="${escapeHtml(runPageHref(ctx.urlKey, session.runId))}">open run ›</a>`;
  }
  const why = session.agedOut ? `older than ${READ_HORIZON_DAYS} days: no run page` : 'no run page for this attempt';
  return ` <span class="task-stage-run sess-muted" data-testid="task-page-attempt-unlinked">${why}</span>`;
}

/** One session line inside an opened stage. */
function renderStageSession(session, index, now, ctx = {}) {
  const line = [`attempt ${index + 1}`, STAGE_STATE_WORD[session.state] || session.state];
  const when = session.state !== 'running' && session.state !== 'queued' && session.state !== 'waiting'
    ? timeHtml(session.endedAt, { now })
    : '';
  const message = session.message
    ? `<p class="task-stage-message" data-testid="task-page-session-message">${escapeHtml(session.message)}</p>`
    : '<p class="task-stage-message sess-muted" data-testid="task-page-session-message">no message recorded</p>';
  const links = session.links.length
    ? `<ul class="task-stage-links" data-testid="task-page-session-links">${session.links.map(l => `<li>${externalLink(l.url, l.label || l.url, 'task-page-session-link')}</li>`).join('')}</ul>`
    : '';
  return `<li class="task-stage-session" data-testid="task-page-session" data-state="${escapeHtml(session.state)}" data-loop-id="${escapeHtml(String(session.loopId || ''))}">
          <div class="task-stage-session-line" data-testid="task-page-session-line">${escapeHtml(line.join(' · '))}${when ? ` · ${when}` : ''}${attemptRunLink(session, ctx)}</div>${message}${links}
        </li>`;
}

/** The folded check-ins: a closed disclosure, one quiet line each. */
function renderCheckIns(checkIns, now) {
  if (!checkIns.length) return '';
  const rows = checkIns.map((c) => {
    const when = timeHtml(attemptStartedAt(c), { now });
    return `<li class="task-checkin" data-testid="task-page-checkin" data-kind="${escapeHtml(c.kind || '')}">${escapeHtml(c.label)}${when ? ` · ${when}` : ''}${c.message ? `<span class="task-checkin-message">${escapeHtml(c.message.split('\n')[0])}</span>` : ''}</li>`;
  }).join('');
  return `<details class="task-checkins" data-testid="task-page-checkins"><summary>${checkIns.length} check-in${checkIns.length === 1 ? '' : 's'}</summary><ul class="task-checkin-list">${rows}</ul></details>`;
}

function renderStage(stage, now, ctx = {}) {
  const tone = stageTone(stage.state);
  const attempts = stage.attempts > 1 ? ` <span class="task-stage-attempts" data-testid="task-page-stage-attempts">${stage.attempts} attempts</span>` : '';
  const classes = ['task-stage', 'task-step'];
  if (stage.open) classes.push('sess-run--expanded');
  const body = stage.sessions.map((s, i) => renderStageSession(s, i, now, ctx)).join('');
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
  return `<li class="task-stage-ahead" data-testid="task-page-stage-ahead" data-state="ahead" data-tone="ahead" data-kind="${escapeHtml(stage.kind || '')}">`
    + `<span class="task-stage-name">${escapeHtml(stage.label)}</span> <span class="task-stage-state">usually next</span></li>`;
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
export function renderTaskTrack(model, { now = new Date(), urlKey = '', runLinks = false } = {}) {
  const stages = Array.isArray(model.stages) ? model.stages : [];
  const empty = !stages.some(st => st.state !== 'ahead')
    ? '<p class="sess-muted task-track-empty" data-testid="task-page-track-empty">○ no sessions yet</p>'
    : '';
  // `runLinks`: the viewer has a run page to open (LIN-3975). A guest's page does not.
  const ctx = { urlKey, runLinks };
  const rows = stages.map(st => (st.state === 'ahead' ? renderAheadStage(st) : renderStage(st, now, ctx))).join('');
  return `${empty}${rows ? `<ol class="task-stages-list" data-testid="task-page-track">${rows}</ol>` : ''}`;
}

/** The chip's state word: a stage's own word, the running minutes, or "next" / "usual" while ahead. */
function stripWord(stage, offered, now) {
  if (stage.state === 'ahead') return offered ? 'next' : 'usual';
  if (stage.state === 'running') {
    const started = stage.startedAt ? Date.parse(stage.startedAt) : NaN;
    const elapsed = Number.isFinite(started) ? fmtDuration(now.getTime() - started) : null;
    return elapsed ? `running ${elapsed}` : 'running';
  }
  return STAGE_STATE_WORD[stage.state] || stage.state;
}

/**
 * The stage strip (LIN-3968): every stage on one row, one chip each, for Home's opened task.
 * The rule: the stages this task reached, in the order it first reached them, then the usual
 * stages still ahead (Research only if reached or still ahead). A stage that reached more than
 * once shows its latest attempt. The offered step is marked `data-offered`. Viewer-blind.
 *
 * @param {Object} model
 * @param {Object} [opts]
 * @param {Date} [opts.now]
 * @returns {string}
 */
export function renderStageStrip(model, { now = new Date() } = {}) {
  const stages = Array.isArray(model.stages) ? model.stages : [];
  const offeredKind = model.nextStep ? model.nextStep.kind : null;
  const chips = new Map();
  for (const st of stages) {
    // A later attempt of the same kind replaces the chip's state; the first position stays.
    chips.set(st.kind, st);
  }
  if (!chips.size) return '';
  const items = [...chips.values()].map((st) => {
    const offered = st.kind === offeredKind;
    const word = stripWord(st, offered, now);
    const tone = stageTone(st.state);
    return `<li class="task-strip-chip" data-testid="task-page-strip-chip" data-state="${escapeHtml(st.state)}" data-tone="${tone}" data-kind="${escapeHtml(st.kind || '')}"${offered ? ' data-offered="true"' : ''}>`
      + `<span class="task-strip-name">${escapeHtml(st.label)}</span> <span class="task-strip-state">${escapeHtml(word)}</span></li>`;
  });
  return `<ol class="task-strip" data-testid="task-page-strip">${items.join('')}</ol>`;
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
    // sees as ready; that reason is about the viewer, not the PR. A moved head
    // (LIN-3418) is about the PR, so the guest reads the owner's sentence.
    case 'not-ready':
      if (closeOut.reason === 'runner-not-set-up' && !closeOut.headMoved) return `${label} is approved and ready to merge.`;
      return `${label} is open, but it isn't ready to merge yet.`;
    case 'merged': return `${label} is merged.`;
    case 'partial': return 'Some of this task\'s pull requests are merged and others are still open.';
    case 'closed': return `${label} was closed without being merged.`;
    case 'multiple-prs': return 'This task has more than one pull request, so it can\'t be merged from here.';
    case 'no-pr': return 'No pull request has been opened for this task yet.';
    default: return `${label} couldn't be read just now, so its state isn't known.`;
  }
}

/**
 * The finished task's merge sentence: third person for every viewer, from the
 * stored close-out events (never a viewer-specific merger claim). No merge
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

// LIN-3443: the PR was read but reports no checks — distinct from unreadable.
const CHECKS_UNSET_COPY = 'No checks are set up for this pull request';

/** The review, checks and ledger as plain sentences (no SHAs, ids or ISO times). */
function prDetail(evidence, now, finished = false, settling = false) {
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
    const copy = check.state === 'unknown' && check.read === true
      ? CHECKS_UNSET_COPY : CHECKS_COPY[check.state];
    sentences.push(`${copy}${check.headMoved ? ', but the code has changed since the review' : ''}.`);
  } else if (check && check.headMoved) {
    sentences.push('The code has changed since the review.');
  }
  const ledger = evidence.ledger && evidence.ledger.ledger;
  if (ledger && ledger.present) {
    if (ledger.empty) {
      sentences.push('CI covered everything, so there is nothing to check.');
    } else if (finished || settling) {
      // A settling task (merged, not Done yet; LIN-3379) is treated the same way:
      // the review-time count would contradict a close-out that is still finishing.
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
  // LIN-3379: merged but not Done yet. Say plainly that the close-out is still
  // finishing rather than counting items against a ledger it may have settled.
  // Never read discharge out of the close-out text. Only status `merged` settles;
  // `partial` and every other status keep today's behaviour.
  const settling = !finished && !!closeOut && closeOut.status === 'merged';
  let detail = prDetail(evidence, now, finished, settling);
  if (settling) {
    const hasItems = evidence.ledger && evidence.ledger.ledger && evidence.ledger.ledger.present && !evidence.ledger.ledger.empty;
    // With an empty ledger there are no "items" to settle, so the sentence stops short.
    if (hasItems) detail = `${detail} The pull request is merged and the close-out is still finishing; it settles these items.`;
    else if (summary) detail = `${detail} The pull request is merged and the close-out is still finishing.`;
  }
  if (finished && (summary || (evidence.ledger && evidence.ledger.ledger && evidence.ledger.ledger.present && !evidence.ledger.ledger.empty))) {
    const endType = model.tracker && model.tracker.state ? model.tracker.state.type : null;
    const end = endType === 'canceled' || endType === 'duplicate' ? 'This task was cancelled.' : 'This task is done.';
    detail = `${detail} ${end} ${summary ? "The close-out's summary and the review's ledger are" : "The review's ledger is"} under “The checks and the review ledger”.`;
  }
  const says = `<div class="task-pr-says" data-testid="task-page-pr-summary" data-state="${escapeHtml((closeOut && closeOut.status) || 'unknown')}">
      <p class="task-pr-lead" data-testid="task-page-pr-lead">${escapeHtml(lead)}</p>
      <p class="task-pr-detail" data-testid="task-page-pr-detail">${escapeHtml(detail)}</p>
    </div>`;
  const quote = (finished || settling) && summary
    ? { label: `Close-out summary${fmtWhen(summary.at, now) ? `, ${fmtWhen(summary.at, now)}` : ''} — its own words, not re-reviewed`, text: summary.text }
    : null;
  const raw = renderDisclosure({
    summary: 'The checks and the review ledger',
    body: renderEvidence(evidence, { ...(finished ? { finished: true, closeOutQuote: quote } : (settling ? { settling: true, closeOutQuote: quote } : {})), formatAt: (at) => timeHtml(at, { now }) }),
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
export function renderTaskContext(model, { urlKey, now = new Date() }) {
  // A cached doc withheld by the loader says why, rather than "none yet". The owner's "✦ generate" comes from the
  // widget the owner fragment mounts, so this text is the same for every viewer (the owner-minus-fragments parity).
  const contextMissText = (label, kind, m) => {
    const miss = m.contextMiss && m.contextMiss[kind];
    if (miss === 'stale') return `○ ${label.toLowerCase()} out of date: written before the latest changes`;
    if (miss === 'unverifiable') return `○ ${label.toLowerCase()} can't be checked against the latest changes`;
    return `○ no ${label.toLowerCase()} yet`;
  };
  // The header already shows the brief's `## Current` paragraph, so the brief panel does not repeat it.
  const briefBody = model.brief && model.summary ? briefWithoutCurrent(model.brief.body) : (model.brief ? model.brief.body : null);
  const panel = (label, kind, doc) => renderContextPanel({
    label,
    kind,
    issueIdentifier: model.identifier,
    issueId: model.issueId,
    body: doc ? (kind === 'brief' ? briefBody : doc.body) : null,
    model: doc ? doc.model : null,
    generatedAt: doc ? doc.generatedAt : null,
    urlKey,
    missText: contextMissText(label, kind, model),
    formatGenerated: (at) => timeHtml(at, { now }),
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
/** The description's cut (LIN-3975): about a dozen lines, or a long single paragraph. */
const DESCRIPTION_CUT_LINES = 12;
const DESCRIPTION_CUT_CHARS = 700;

export function renderTaskDocs(model, now = new Date()) {
  const description = typeof model.description === 'string' && model.description.trim() ? model.description : null;
  const comments = Array.isArray(model.comments) ? model.comments : [];
  if (!description && comments.length === 0) return '';
  // The description is what the task is about, so it shows without a fold (LIN-3975). A long one is cut at about a
  // dozen lines with a fade and "Read all of it"; the cut is a height, not a character count, because the client
  // renders the Markdown and a character cut would split its structure.
  const cut = description && (description.split('\n').length > DESCRIPTION_CUT_LINES || description.length > DESCRIPTION_CUT_CHARS);
  const descHtml = description
    ? `<section class="task-description" data-testid="task-page-description">`
      + `<h3 class="section-header">Description</h3>`
      + `<div class="task-md${cut ? ' task-md--cut' : ''}" data-md="description" data-testid="task-page-description-body">${escapeHtml(description)}</div>`
      + (cut ? `<button type="button" class="btn--quiet task-md-more" data-testid="task-page-description-more" aria-expanded="false">Read all of it</button>` : '')
      + `</section>`
    : '';
  const commentsHtml = comments.length
    ? renderDisclosure({
        summary: `Comments (${comments.length})`,
        body: comments.map(c => `<article class="task-comment" data-testid="task-page-comment">`
          + `<div class="task-comment-head"><span class="task-comment-author" data-testid="task-page-comment-author">${escapeHtml(c.author || 'unknown')}</span>`
          + (c.createdAt ? ` ${timeHtml(c.createdAt, { now, className: 'task-comment-time', testid: 'task-page-comment-time' })}` : '')
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
  return `<ul class="task-ref-list" data-testid="${testid}">${refs.map(r => `<li class="task-ref"><span class="task-ref-glyph" aria-hidden="true">${getStateDisplay(r.state && r.state.type).char}</span> ${taskLink(ctx, r, `${testid}-link`)} <span class="task-ref-title">${escapeHtml(r.title || '')}</span>${r.state && r.state.name ? ` <span class="task-ref-state">${escapeHtml(r.state.name)}</span>` : ''}</li>`).join('')}</ul>`;
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
    d.createdAt ? kv('created', timeHtml(d.createdAt, { now }), 'task-page-detail-created') : '',
    d.updatedAt ? kv('updated', timeHtml(d.updatedAt, { now }), 'task-page-detail-updated') : '',
    sessionsLine(model) ? kv('sessions', escapeHtml(sessionsLine(model)), 'task-page-detail-sessions') : '',
    d.firstSessionAt ? kv('first session', timeHtml(d.firstSessionAt, { now }), 'task-page-detail-first') : '',
    d.lastSessionAt ? kv('last session', timeHtml(d.lastSessionAt, { now }), 'task-page-detail-last') : '',
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
 * The question and its answer box, owner-only (LIN-3499): the same card the run
 * page pins (lib/question-card.js), shown exactly when the pill says waiting —
 * `model.status === 'waiting'`, the pill's own predicate. Called from
 * `renderOwnerControls`, the one place the viewer is read, so a guest and a
 * non-owner get nothing (hidden, not disabled).
 *
 * It sits in its own section OUTSIDE `task-page-answer`: the poll repaints that
 * section's innerHTML, which would wipe a half-typed answer. The client removes
 * the section when a poll reports the task is no longer waiting.
 *
 * The card's inputs come from the waiting loop (`model.question`, built by the
 * loader). `canReply` is the run page's rule: the waiting loop's target must be
 * a session target. Values the run page supplies that this page cannot:
 * `producer.case` (the bare-blocked "why" fallback), so that card shows its
 * question without a "why" when there is no decision case.
 *
 * @param {Object} model
 * @param {{urlKey?: string, binding?: {source?: string}}} ctx
 * @returns {string}
 */
export function renderTaskQuestion(model, { urlKey = '', binding = {} } = {}) {
  const q = model.status === 'waiting' ? model.question : null;
  if (!q) return '';
  const producer = q.producer
    ? { ...q.producer, issueSource: q.producer.issueSource || (binding && binding.source) || null }
    : null;
  const canReply = canReplyTo(producer);
  const cards = renderQuestionCards({
    decisions: q.decisions,
    waiting: true,
    waitingMessage: q.waitingMessage,
    decision: q.decision,
    decisionCase: q.decisionCase,
    producer,
    urlKey,
    canReply,
    sessionTerminal: false,
  });
  if (!cards) return '';
  return `<section class="section sess-section task-question" data-testid="task-page-question">${cards}</section>`;
}

/**
 * The owner's run control (LIN-3975): the shared PromptSection (public/prompt-section.js, surface `task`), mounted
 * under the answer from the page-load model, never from a poll. Its options ride in `data-run-opts`, which the client
 * reads before any Markdown renders (public/task-page.js). A finished task offers no step, so it has no control.
 * With no runner, the copy-first view is the control, with the runner link beside it (lib/components/runner-link.js).
 *
 * @param {Object} model
 * @param {{urlKey: string, binding?: {source?: string}, promptOpts?: Object|null}} ctx
 * @returns {string}
 */
function renderTaskRunControl(model, { urlKey, binding = {}, promptOpts = null }) {
  if (!promptOpts || model.finished || !model.issueId) return '';
  const opts = {
    ...promptOpts,
    urlKey,
    surface: 'task',
    issue: {
      id: model.issueId,
      identifier: model.identifier,
      title: model.title || '',
      url: model.tracker?.url || '',
      source: binding.source || undefined,
      stateType: model.tracker?.state?.type || '',
    },
    why: [],
    subtaskNeedsYou: null,
    idPrefix: `task-${model.identifier}`,
    // LIN-3975: the chat proposals still pending for this task's runs, as staged changes (routes/task-page.js).
    proposals: Array.isArray(model.proposals) ? model.proposals : [],
  };
  const runner = promptOpts.dispatchEnabled
    ? ''
    : `<p class="task-runner-line" data-testid="task-page-runner-line">${renderRunnerLink(urlKey)}</p>`;
  return `<section class="section sess-section task-run" data-testid="task-page-run"><div class="task-run-mount" data-testid="task-page-run-control" data-run-opts="${escapeHtml(JSON.stringify(opts))}"></div>${runner}</section>`;
}

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
 *   - `question`: the question card and its answer box while the task is waiting
 *     (LIN-3499), see `renderTaskQuestion`.
 *   - `runControl`: the run control and, with no runner, the runner link (LIN-3975),
 *     see `renderTaskRunControl`.
 *
 * @param {Object} model
 * @param {{urlKey: string, binding: Object, promptOpts?: Object|null}} ctx
 * @returns {{context: string, pullRequest: string, share: string, question: string, runControl: string}}
 */
export function renderOwnerControls(model, { urlKey, binding = {}, promptOpts = null, taskChat = false }) {
  const question = renderTaskQuestion(model, { urlKey, binding });
  const runControl = renderTaskRunControl(model, { urlKey, binding, promptOpts });
  // LIN-3975: the chat fold is the owner's, behind the per-user `taskChat` flag; a member or guest gets none.
  const chat = taskChat && model.identifier ? renderTaskChatFold({ urlKey, identifier: model.identifier, source: binding.source || null }) : '';
  const context = '<span class="task-owner-widgets" data-testid="task-page-owner-widgets" hidden></span>';
  const closeOut = model.evidence ? model.evidence.closeOut : null;
  const prNumber = closeOut && closeOut.pr && closeOut.pr.number != null ? closeOut.pr.number : null;
  // The PR's state is said once, in the pull request's lead sentence; the box beside it keeps only the press (LIN-3975).
  const pullRequest = renderCloseOutBox(closeOut, { issueId: model.issueId, source: binding.source, pressLabel: prNumber != null ? `Merge PR #${prNumber}` : 'Merge', sayState: false, pressClass: 'btn btn--primary' });
  const shareBase = `/workspace/${encodeURIComponent(urlKey || '')}/api/task/${encodeURIComponent(model.identifier || '')}`;
  const share = `<div class="task-share" data-testid="task-page-share-slot" data-create-url="${escapeHtml(harbourHref(`${shareBase}/share`, binding))}" data-shares-url="${escapeHtml(harbourHref(`${shareBase}/shares`, binding))}">
      <div class="task-share-head">
        <span class="task-share-label">Share this task</span>
        <button type="button" class="btn btn--quiet task-share-create" data-action="task-share-create" data-testid="task-share-create">Create share link</button>
        <span class="task-share-note" data-testid="task-share-note" role="status" aria-live="polite"></span>
      </div>
      <div class="task-share-new" data-testid="task-share-new" hidden></div>
      <ul class="task-share-list" data-testid="task-share-list"></ul>
    </div>`;
  return { context, pullRequest, share, question, runControl, chat };
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
export function renderTaskPage(model, { viewer = 'owner', urlKey = '', binding = {}, stateUrl = '', now = new Date(), pageOptions = {}, promptOpts = null } = {}) {
  assertViewer(viewer);
  const ctx = { urlKey, binding, promptOpts };
  const taskChat = viewer === 'owner' && pageOptions.featureFlags?.taskChat === true;
  const owner = viewer === 'owner' ? renderOwnerControls(model, { ...ctx, taskChat }) : { context: '', pullRequest: '', share: '', question: '', runControl: '', chat: '' };

  const backHref = harbourHref(`/workspace/${encodeURIComponent(urlKey)}/`);
  const backLink = `<a class="sess-back" data-testid="task-page-back" href="${escapeHtml(backHref)}">← back to tasks</a>`;

  const title = model.title || '';
  const headingHtml = `<span class="task-ident" data-testid="task-page-ident">${escapeHtml(model.identifier)}</span>${title ? ` <span class="task-title" data-testid="task-page-title">${escapeHtml(title)}</span>` : ''}`;
  const docTitle = `${escapeHtml(model.identifier)}${title ? ` — ${escapeHtml(title)}` : ''}`;

  const binding_ = binding || {};
  const mergeReady = !!model.readyHeader;
  const mainAttrs = [
    'class="sess-page task-page"',
    'data-testid="task-page"',
    `data-url-key="${escapeHtml(urlKey)}"`,
    `data-identifier="${escapeHtml(model.identifier)}"`,
    `data-state-url="${escapeHtml(stateUrl)}"`,
    `data-status="${escapeHtml(model.status)}"`,
    `data-live="${model.live ? 'true' : 'false'}"`,
    `data-merge-ready="${mergeReady ? 'true' : 'false'}"`,
    // The ready header's HTML, only when ready (LIN-3448); no summary, so a
    // repaint keeps the load-time one.
    mergeReady ? `data-ready-header="${escapeHtml(renderTaskStatus({ ...model, ...model.readyHeader, summary: null }, { now }))}"` : '',
    binding_.source ? `data-source="${escapeHtml(binding_.source)}"` : '',
  ].filter(Boolean).join(' ');

  const { deployInfo = {}, openRouterSource = null, workspaces: navWorkspaces = [], featureFlags = {} } = pageOptions;
  // A drill-down borrows its parent's nav entry (the task list), no view tier.
  const navHtml = renderNavBar({ workspaces: navWorkspaces, urlKey, currentPage: 'projects', featureFlags });
  const footerHtml = renderPageFooter({ deployInfo, currentPage: '/', urlKey, openRouterSource, featureFlags });

  const contextHtml = renderTaskContext(model, { urlKey, now });
  // Neither brief nor recap yet: one quiet line, with no heading and no grid column (LIN-3975).
  const contextEmpty = !model.brief && !model.recap;
  const contextMount = `<div class="task-context-mount" data-testid="task-page-context-mount" data-context-sig="${contextSignature(contextHtml)}">${contextHtml}</div>${owner.context}`;
  const contextSection = contextEmpty
    ? `<section class="sess-section task-context-section task-context-section--quiet" data-testid="task-page-context-quiet">${contextMount}</section>`
    : renderSection({ className: 'sess-section task-context-section', title: 'Brief and recap', body: contextMount });
  const runLinks = viewer !== 'guest';
  const content = `<main ${mainAttrs}>
    ${backLink}
    ${renderPageHeader({ titleHtml: headingHtml, headerClass: 'sess-header task-header' })}
    <section class="section sess-section task-answer" data-testid="task-page-answer">${renderTrackerLine(model)}<div class="task-answer-status" data-testid="task-page-answer-status">${renderTaskStatus(model, { now })}</div></section>
    ${owner.runControl || renderNextLine(model)}
    ${owner.chat}
    ${owner.question}
    ${renderSection({ className: 'sess-section task-stages', title: 'Stages', body: `<div class="task-track-mount" data-testid="task-page-track-mount">${renderTaskTrack(model, { now, urlKey, runLinks })}</div>` })}
    ${renderTaskPullRequest(model, owner.pullRequest, now)}
    ${contextSection}
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
