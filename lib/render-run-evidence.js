// Host-agnostic run-evidence fragments (LIN-3247, P2 of LIN-2949; S13).
//
// `renderEvidence(model)` renders the asked / done / checked rows and the
// collapsed review ledger. `renderCloseOutBox(state)` renders the close-out
// display box. Both are pure string builders: no I/O, no client-side actions
// wired here, every interpolated value escaped. The close-out box renders
// nothing for a non-owner viewer, and neither fragment carries transcripts,
// comments, diffs or cost.
//
// LIN-2948 composes the real page (heading, paragraph, order). Until it does,
// `renderRunEvidence(model)` is the one call the session page mounts.

import { escapeHtml } from './utils/html.js';

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

const SCOPE_MARK = { inside: 'inside', outside: 'outside', unknown: 'scope unknown' };

function renderRow(testid, label, body) {
  return `<div class="rev-row" data-testid="${testid}"><span class="rev-row-label">${text(label)}</span><div class="rev-row-body">${body}</div></div>`;
}

/** The two-line "checked" row: review's claim, then the live head. Never blended. */
function renderCheckedRow(checked) {
  const review = checked && checked.review;
  const now = checked && checked.now;

  let reviewLine = '<span class="rev-muted" data-testid="run-evidence-checked-review-empty">no review on record</span>';
  if (review) {
    const meta = [];
    if (review.at) meta.push(text(review.at));
    if (review.sha) meta.push(`sha ${text(review.sha)}`);
    const verdict = review.verdictText || review.verdict || 'review recorded';
    reviewLine = `<span class="rev-claim-verdict" data-testid="run-evidence-checked-review-verdict">${text(verdict)}</span>`
      + (review.ciLine ? `<span class="rev-claim-ci" data-testid="run-evidence-checked-review-ci">${text(review.ciLine)}</span>` : '')
      + (meta.length ? `<span class="rev-claim-meta" data-testid="run-evidence-checked-review-meta">${text(meta.join(' · '))}</span>` : '');
  }

  let nowLine;
  if (now && now.state !== 'unknown') {
    const bits = [`<span class="rev-now-state" data-testid="run-evidence-checked-now-state">${text(CHECK_STATE_COPY[now.state] || now.state)}</span>`];
    if (now.headSha) bits.push(`<span class="rev-now-sha" data-testid="run-evidence-checked-now-sha">head ${text(now.headSha)}</span>`);
    if (now.checksUrl) bits.push(anchor(now.checksUrl, 'checks ↗', 'run-evidence-checks-link'));
    nowLine = bits.join(' ');
  } else {
    nowLine = `<span class="rev-not-checked" data-testid="run-evidence-not-checked">not checked</span>`;
  }
  const headMoved = now && now.headMoved
    ? '<span class="rev-head-moved" data-testid="run-evidence-head-moved">head moved since review</span>'
    : '';

  const reviewLabelled = renderRow('run-evidence-checked-review', "Review's claim", reviewLine);
  const nowLabelled = renderRow('run-evidence-checked-now', 'Now', nowLine + headMoved);
  return `<div class="rev-checked" data-testid="run-evidence-checked">${reviewLabelled}${nowLabelled}</div>`;
}

function renderLedgerItem(item, atMerge = false) {
  const followUp = item.followUp
    ? (/^https?:\/\//i.test(item.followUp)
      ? ` ${anchor(item.followUp, item.followUp, 'run-evidence-ledger-followup')}`
      : ` <span class="rev-ledger-followup" data-testid="run-evidence-ledger-followup">${text(item.followUp)}</span>`)
    : '';
  const discharge = item.discharge
    ? `<p class="rev-ledger-discharge" data-testid="run-evidence-ledger-discharge">${text(item.discharge)}</p>`
    : '';
  const dischargedBy = item.dischargedBy
    ? `<p class="rev-ledger-discharged-by" data-testid="run-evidence-ledger-discharged-by">discharged: ${text(item.dischargedBy)}</p>`
    : '';
  // A finished run that was merged by the person keeps every still-open item
  // visible, marked "open at merge". Inside-scope items with no follow-up are
  // explicit about that ("open, no follow-up filed"). Never hoisted to the top.
  const openAtMerge = atMerge && !item.discharged
    ? `<p class="rev-ledger-open-at-merge" data-testid="run-evidence-ledger-open-at-merge">open at merge</p>`
      + ((item.scope === 'inside' && !item.followUp)
        ? '<p class="rev-ledger-open-no-followup" data-testid="run-evidence-ledger-open-no-followup">open, no follow-up filed</p>'
        : '')
    : '';
  return `<li class="rev-ledger-item" data-testid="run-evidence-ledger-item" data-scope="${escapeHtml(item.scope || 'unknown')}" data-discharged="${item.discharged ? 'true' : 'false'}">`
    + `<div class="rev-ledger-claim">${item.id ? `<span class="rev-ledger-id" data-testid="run-evidence-ledger-id">${text(item.id)}</span> ` : ''}<span class="rev-ledger-mark">${text(SCOPE_MARK[item.scope] || 'scope unknown')}</span> <span class="rev-ledger-text">${text(item.claim)}</span></div>`
    + discharge + dischargedBy + followUp + openAtMerge
    + '</li>';
}

function renderLedger(ledgerModel, atMerge = false, finished = false) {
  const ledger = (ledgerModel && ledgerModel.ledger) || null;
  let body;
  let summaryTail;
  if (!ledger || !ledger.present) {
    summaryTail = 'not on record';
    body = '<p class="rev-ledger-none" data-testid="run-evidence-ledger-none">no review ledger on record</p>';
  } else if (ledger.empty) {
    summaryTail = 'empty';
    body = '<p class="rev-ledger-empty" data-testid="run-evidence-ledger-empty">ledger empty — CI covered the deliverable</p>';
  } else if (ledger.unparsed || ledger.items.length === 0) {
    summaryTail = 'unparsed';
    body = `<pre class="rev-ledger-raw" data-testid="run-evidence-ledger-raw">${text(ledger.raw || '')}</pre>`;
  } else {
    summaryTail = `${ledger.items.length} item${ledger.items.length === 1 ? '' : 's'}`;
    body = `<ul class="rev-ledger-items" data-testid="run-evidence-ledger-items">${ledger.items.map(item => renderLedgerItem(item, atMerge)).join('')}</ul>`;
  }
  return `<details class="rev-ledger" data-testid="run-evidence-ledger">`
    // A finished task shows the review's rows as the review wrote them, with no
    // count (LIN-3373): the count would be a claim about the final state.
    + `<summary class="rev-ledger-summary" data-testid="run-evidence-ledger-summary">Review ledger — ${text(finished && /^\d+ items?$/.test(summaryTail) ? 'as the review wrote it' : summaryTail)}</summary>`
    + body
    + '</details>';
}

/**
 * Render the evidence rows + collapsed ledger.
 * @param {{state?: Object, evidence?: Object, ledger?: Object}|null} model
 * @param {{finished?: boolean, closeOutQuote?: {label: string, text: string}|null}} [opts]
 *   `finished` (LIN-3373, the task page's finished-task view only): the ledger
 *   keeps its rows but loses its item count and the per-row "open at merge"
 *   stamps, and `closeOutQuote` is shown verbatim above it as the close-out's own
 *   words. Absent, the output is exactly what it always was.
 * @returns {string}
 */
export function renderEvidence(model, { finished = false, closeOutQuote = null } = {}) {
  if (!model || typeof model !== 'object') return '';
  const evidence = model.evidence || {};
  const asked = evidence.asked
    ? text(evidence.asked)
    : '<span class="rev-muted" data-testid="run-evidence-asked-empty">not recorded</span>';
  const done = evidence.done
    ? text(evidence.done)
    : '<span class="rev-muted" data-testid="run-evidence-done-empty">not recorded</span>';
  const atMerge = !finished && model.closeOut && (model.closeOut.status === 'merged' || model.closeOut.status === 'partial');
  const quote = finished && closeOutQuote && closeOutQuote.text
    ? `<div class="rev-closeout-summary" data-testid="run-evidence-closeout-summary"><p class="rev-closeout-summary-label">${text(closeOutQuote.label)}</p><pre class="rev-closeout-summary-text">${text(closeOutQuote.text)}</pre></div>`
    : '';
  return `<section class="rev-evidence" data-testid="run-evidence">`
    + renderRow('run-evidence-asked', 'asked', asked)
    + renderRow('run-evidence-done', 'done', done)
    + renderCheckedRow(evidence.checked)
    + quote
    + renderLedger(model.ledger, !!atMerge, finished)
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
 * @param {{owner?: boolean, status?: string, pr?: Object|null, message?: string|null, variant?: string, urlKey?: string|null, issueIdentifier?: string|null, mergedByYou?: boolean}|null} state
 * @param {{issueId?: string|null, source?: string|null, pressLabel?: string|null}} [opts] - additive caller
 *   identity for a host that isn't the run page (LIN-3340): the task page passes
 *   the task's tracker UUID and its provider kind so `public/close-out.js` can
 *   drive the existing routes off the box. Emitted ONLY when passed, so the run
 *   page's golden stays byte-identical. `pressLabel` (LIN-3356) is the task
 *   page's own label for the press button ("Merge PR #N"); absent, the run page's
 *   text stays.
 * @returns {string}
 */
export function renderCloseOutBox(state, { issueId = null, source = null, pressLabel = null } = {}) {
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
    `data-merged-by-you="${state.mergedByYou ? 'true' : 'false'}"`,
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
      + '<p class="rev-closeout-ready" data-testid="run-evidence-closeout-ready">✓ PR ready for close-out</p>'
      + '<p class="rev-closeout-actions">'
      + '<button type="button" class="rev-closeout-press" data-testid="run-evidence-closeout-press" data-action="closeout-press">' + (pressLabel ? text(pressLabel) : '[ close out &amp; merge ]') + '</button> '
      + anchor(state.pr.url, 'or merge it yourself on GitHub ›', 'run-evidence-closeout-merge-yourself')
      + '</p>'
      + promise
      + '</div>';
  }

  if (status === 'merged' || status === 'partial') {
    const message = state.message || (status === 'merged' ? 'the pull request is already merged' : '');
    // F1: "merged by you" is a stop-at-PR claim and never when a close-out
    // (press) merge is recorded. Anything else reads neutrally.
    if (state.mergedByYou) {
      return open
        + `<p class="rev-closeout-merged" data-testid="run-evidence-closeout-merged">✓ merged by you${message ? ` · ${text(message)}` : ''}</p>`
        + '</div>';
    }
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
