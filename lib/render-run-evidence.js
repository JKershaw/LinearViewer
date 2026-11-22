// Host-agnostic run-evidence fragments (LIN-3247, P2 of LIN-2949; S13).
//
// `renderEvidence(model)` renders the asked / done / checked rows and the
// collapsed review-ledger box (the open-findings reading). `renderCloseOutBox(state)` renders the close-out
// display box. Both are pure string builders: no I/O, no client-side actions
// wired here, every interpolated value escaped. The close-out box renders
// nothing for a non-owner viewer, and neither fragment carries transcripts,
// comments, diffs or cost.
//
// LIN-2948 composes the real page (heading, paragraph, order). Until it does,
// `renderRunEvidence(model)` is the one call the session page mounts.

import { escapeHtml } from './utils/html.js';
import { findingsCopy, findingsCount } from './close-out-findings.js';

/** Only http(s) links are rendered as anchors; anything else yields null. */
function safeHref(url) {
  if (typeof url !== 'string') return null;
  return /^https?:\/\//i.test(url.trim()) ? url.trim() : null;
}

function text(value) {
  return value == null ? '' : escapeHtml(String(value));
}

function anchor(url, label, testid, extra = '') {
  const href = safeHref(url);
  if (!href) return `<span class="rev-link-disabled"${testid ? ` data-testid="${testid}"` : ''}>${text(label)}</span>`;
  return `<a${testid ? ` data-testid="${testid}"` : ''} href="${escapeHtml(href)}" target="_blank" rel="noopener"${extra ? ' ' + extra : ''}>${text(label)}</a>`;
}

const CHECK_STATE_COPY = {
  passing: 'passing',
  failing: 'failing',
  pending: 'pending',
  unknown: 'not checked',
};


function renderRow(testid, label, body) {
  return `<div class="rev-row" data-testid="${testid}"><span class="rev-row-label">${text(label)}</span><div class="rev-row-body">${body}</div></div>`;
}

/** The two-line "checked" row: review's claim, then the live head. Never blended. */
function renderCheckedRow(checked, formatAt = text) {
  const review = checked && checked.review;
  const now = checked && checked.now;

  let reviewLine = '<span class="rev-muted" data-testid="run-evidence-checked-review-empty">no review on record</span>';
  if (review) {
    // Each piece is already escaped (`formatAt` is `text` by default, or the task page's time piece, LIN-3975).
    const meta = [];
    if (review.at) meta.push(formatAt(review.at));
    if (review.sha) meta.push(`sha ${text(review.sha)}`);
    // A record's verdict is the bare word (`approve`); its conditions are open findings to close-out, shown in the ledger box.
    const verdict = review.verdict ? review.verdict.charAt(0).toUpperCase() + review.verdict.slice(1) : 'review recorded';
    reviewLine = `<span class="rev-claim-verdict" data-testid="run-evidence-checked-review-verdict">${text(verdict)}</span>`
      + (meta.length ? `<span class="rev-claim-meta" data-testid="run-evidence-checked-review-meta">${meta.join(' · ')}</span>` : '');
  }

  // LIN-3443: a readable PR with no checks is "unknown" state with `read: true`.
  // It is not the same as an unreadable PR, so it says so (and keeps the head).
  const readNoChecks = !!(now && now.state === 'unknown' && now.read === true);
  let nowLine;
  if (now && (now.state !== 'unknown' || readNoChecks)) {
    const stateCopy = readNoChecks ? 'no checks set up' : (CHECK_STATE_COPY[now.state] || now.state);
    const bits = [`<span class="rev-now-state" data-testid="run-evidence-checked-now-state">${text(stateCopy)}</span>`];
    if (now.headSha) bits.push(`<span class="rev-now-sha" data-testid="run-evidence-checked-now-sha">head ${text(now.headSha)}</span>`);
    if (now.checksUrl) bits.push(anchor(now.checksUrl, 'checks ↗', 'run-evidence-checks-link'));
    nowLine = bits.join(' ');
  } else {
    nowLine = `<span class="rev-not-checked" data-testid="run-evidence-not-checked">not checked</span>`;
  }
  const headMoved = now && now.headMoved
    ? '<span class="rev-head-moved" data-testid="run-evidence-head-moved">head moved since review</span>'
    : '';

  // LIN-4437: the blind read's verdict and reason beside the review's, or that none is on record.
  const read = checked && checked.blindRead;
  const readLine = read
    ? `<span class="rev-claim-verdict" data-testid="run-evidence-checked-blind-read-verdict">${text(read.verdict)}</span>`
      + `<span class="rev-claim-ci" data-testid="run-evidence-checked-blind-read-reason">${text(read.reason)}</span>`
      + (read.at ? `<span class="rev-claim-meta" data-testid="run-evidence-checked-blind-read-meta">${formatAt(read.at)}</span>` : '')
    : '<span class="rev-muted" data-testid="run-evidence-checked-blind-read-empty">no blind read on record</span>';

  const reviewLabelled = renderRow('run-evidence-checked-review', "Review's claim", reviewLine);
  const readLabelled = renderRow('run-evidence-checked-blind-read', 'Blind read', readLine);
  const nowLabelled = renderRow('run-evidence-checked-now', 'Now', nowLine + headMoved);
  return `<div class="rev-checked" data-testid="run-evidence-checked">${reviewLabelled}${readLabelled}${nowLabelled}</div>`;
}

/**
 * LIN-4495: the review's ledger box, as the close-out gate reads it. The open findings to close-out are records (the
 * `reading` from lib/close-out-findings.js), shown as a count with its copy. A finished task keeps no count (LIN-3373),
 * so its summary says "as the review wrote it". LIN-4527: the pre-cutover section text is no longer shown here (the
 * gate does not read it); the box is the live open-findings reading only, and its label stays.
 */
function renderLedger(reading = null, finished = false) {
  const copy = findingsCopy(reading);
  const findingsLine = `<p class="rev-ledger-findings" data-testid="run-evidence-findings">${text(copy)}</p>`;
  const count = findingsCount(reading);
  const summaryTail = finished ? 'as the review wrote it' : (count === null ? 'not measured' : `${count} open to close-out`);
  return `<details class="rev-ledger" data-testid="run-evidence-ledger">`
    + `<summary class="rev-ledger-summary" data-testid="run-evidence-ledger-summary">Review ledger — ${text(summaryTail)}</summary>`
    + findingsLine
    + '</details>';
}

/**
 * Render the evidence rows + the collapsed review-ledger box (the open-findings reading, `model.closeOut.openFindings`).
 * @param {{state?: Object, evidence?: Object, closeOut?: {openFindings?: Object}}|null} model
 * @param {{finished?: boolean, settling?: boolean, closeOutQuote?: {label?: string, labelHtml?: string, text: string}|null}} [opts]
 *   `finished` (LIN-3373, the task page's finished-task view only): the box's summary reads "as the review wrote it"
 *   instead of a live count, and `closeOutQuote` is shown verbatim above it as the close-out's own words.
 *   `settling` (LIN-3379, the task page only): a merged task that isn't Done yet gets the same treatment, since its
 *   close-out may already have ended findings the reading still shows open. Absent, the summary shows the live count.
 * @returns {string}
 */
export function renderEvidence(model, { finished = false, settling = false, closeOutQuote = null, formatAt = text } = {}) {
  if (!model || typeof model !== 'object') return '';
  const evidence = model.evidence || {};
  const asked = evidence.asked
    ? text(evidence.asked)
    : '<span class="rev-muted" data-testid="run-evidence-asked-empty">not recorded</span>';
  const done = evidence.done
    ? text(evidence.done)
    : '<span class="rev-muted" data-testid="run-evidence-done-empty">not recorded</span>';
  const quote = (finished || settling) && closeOutQuote && closeOutQuote.text
    ? `<div class="rev-closeout-summary" data-testid="run-evidence-closeout-summary"><p class="rev-closeout-summary-label">${closeOutQuote.labelHtml != null ? closeOutQuote.labelHtml : text(closeOutQuote.label)}</p><pre class="rev-closeout-summary-text">${text(closeOutQuote.text)}</pre></div>`
    : '';
  return `<section class="rev-evidence" data-testid="run-evidence">`
    + renderRow('run-evidence-asked', 'asked', asked)
    + renderRow('run-evidence-done', 'done', done)
    + renderCheckedRow(evidence.checked, formatAt)
    + quote
    + renderLedger(model.closeOut ? model.closeOut.openFindings : null, finished || settling)
    + '</section>';
}

/**
 * Render the close-out display box (LIN-3248, P3 of LIN-2949). Consumes a
 * `deriveCloseOutState` model — ready / not-ready / merged / partial / withheld.
 * Correct for a guest / non-owner (`owner: false`) by rendering nothing.
 *
 * The press + check behaviour is wired client-side (public/session.js,
 * `initCloseOut`) off this box's data attributes; this function only renders.
 *
 * @param {{owner?: boolean, status?: string, pr?: Object|null, message?: string|null, variant?: string, urlKey?: string|null, issueIdentifier?: string|null}|null} state
 * @param {{issueId?: string|null, source?: string|null, pressLabel?: string|null}} [opts] - additive caller
 *   identity for a host that isn't the run page (LIN-3340): the task page passes
 *   the task's tracker UUID and its provider kind so `public/close-out.js` can
 *   drive the existing routes off the box. Emitted ONLY when passed, so the run
 *   page's golden stays byte-identical. `pressLabel` (LIN-3356) is the task
 *   page's own label for the press button ("Merge PR #N"); absent, the run page's
 *   text stays.
 * @returns {string}
 */
// LIN-3975: `sayState: false` drops the box's ready tick: the task page's one PR sentence already says it, and the box
// keeps what the owner can do (the press beside it, and the promise). A merged box keeps its attribution (who merged).
export function renderCloseOutBox(state, { issueId = null, source = null, pressLabel = null, sayState = true, pressClass = '' } = {}) {
  if (!state || typeof state !== 'object' || !state.owner) return '';

  const status = state.status || 'unknown';
  // Fail closed: only a POSITIVELY standard run gets the promise.
  const variant = state.variant === 'standard' ? 'standard' : (state.variant === 'stepper' ? 'stepper' : 'unknown');
  const prUrl = state.pr && state.pr.url ? state.pr.url : null;
  const headSha = state.pr && state.pr.headSha ? state.pr.headSha : null;
  const attrs = [
    `data-state="${escapeHtml(status)}"`,
    `data-variant="${variant}"`,
    `data-stop-at="${state.stopAt ? escapeHtml(state.stopAt) : ''}"`,
    state.urlKey ? `data-url-key="${escapeHtml(state.urlKey)}"` : '',
    state.issueIdentifier ? `data-issue-identifier="${escapeHtml(state.issueIdentifier)}"` : '',
    issueId ? `data-issue-id="${escapeHtml(issueId)}"` : '',
    source ? `data-source="${escapeHtml(source)}"` : '',
    prUrl ? `data-pr-url="${escapeHtml(prUrl)}"` : '',
    headSha ? `data-head-sha="${escapeHtml(headSha)}"` : '',
  ].filter(Boolean).join(' ');

  const open = `<div class="rev-closeout" data-testid="run-evidence-closeout" ${attrs}>`;

  if (status === 'ready' && state.pr) {
    // N2: the "stops this run at the PR" promise (see tests: grep
    // "leaves the merge to a person") is backed by the seam guard only for
    // standard-variant runs; a stepped run's copy omits it.
    const promise = variant === 'standard'
      ? '<p class="rev-closeout-promise" data-testid="run-evidence-closeout-promise">Harbour stops this run at the PR and leaves the merge to a person. The runner acts with its owner&#39;s GitHub access, so to enforce that, protect the default branch on GitHub.</p>'
      : '';
    return open
      + (sayState ? '<p class="rev-closeout-ready" data-testid="run-evidence-closeout-ready">✓ PR ready for close-out</p>' : '')
      + '<p class="rev-closeout-actions">'
      + '<button type="button" class="rev-closeout-press' + (pressClass ? ' ' + pressClass : '') + '" data-testid="run-evidence-closeout-press" data-action="closeout-press">' + (pressLabel ? text(pressLabel) : '[ close out &amp; merge ]') + '</button> '
      + anchor(state.pr.url, 'or merge it yourself on GitHub ›', 'run-evidence-closeout-merge-yourself')
      + '</p>'
      + promise
      + '</div>';
  }

  if (status === 'merged' || status === 'partial') {
    const message = state.message || (status === 'merged' ? 'the pull request is already merged' : '');
    // LIN-3426: a merge reads the same for every viewer; no viewer is named the merger.
    return open
      + `<p class="rev-closeout-neutral" data-testid="run-evidence-closeout-neutral">${text(message || 'the pull request is already merged')}</p>`
      + '</div>';
  }

  if (status === 'not-ready' || status === 'no-pr' || status === 'multiple-prs' || status === 'closed') {
    const message = state.message ? `<p class="rev-closeout-withheld" data-testid="run-evidence-closeout-withheld">${text(state.message)}</p>` : '';
    return open
      + '<p class="rev-closeout-setup" data-testid="run-evidence-closeout-setup">○ set up ›</p>'
      + message
      + '</div>';
  }

  const message = state.message || 'close-out is not available yet';
  return open
    + `<p class="rev-closeout-withheld" data-testid="run-evidence-closeout-withheld">${text(message)}</p>`
    + '</div>';
}

/**
 * The one call the session page mounts: the evidence rows + the close-out box.
 * @param {Object|null} model
 * @returns {string}
 */
export function renderRunEvidence(model) {
  if (!model || typeof model !== 'object') return '';
  const evidence = renderEvidence(model);
  const box = renderCloseOutBox(model.closeOut);
  if (!evidence && !box) return '';
  return `<div class="rev-mount" data-testid="run-evidence-mount">${evidence}${box}</div>`;
}
