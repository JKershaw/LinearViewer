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

function renderLedgerItem(item) {
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
  return `<li class="rev-ledger-item" data-testid="run-evidence-ledger-item" data-scope="${escapeHtml(item.scope || 'unknown')}" data-discharged="${item.discharged ? 'true' : 'false'}">`
    + `<div class="rev-ledger-claim">${item.id ? `<span class="rev-ledger-id" data-testid="run-evidence-ledger-id">${text(item.id)}</span> ` : ''}<span class="rev-ledger-mark">${text(SCOPE_MARK[item.scope] || 'scope unknown')}</span> <span class="rev-ledger-text">${text(item.claim)}</span></div>`
    + discharge + dischargedBy + followUp
    + '</li>';
}

function renderLedger(ledgerModel) {
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
    body = `<ul class="rev-ledger-items" data-testid="run-evidence-ledger-items">${ledger.items.map(renderLedgerItem).join('')}</ul>`;
  }
  return `<details class="rev-ledger" data-testid="run-evidence-ledger">`
    + `<summary class="rev-ledger-summary" data-testid="run-evidence-ledger-summary">Review ledger — ${text(summaryTail)}</summary>`
    + body
    + '</details>';
}

/**
 * Render the evidence rows + collapsed ledger.
 * @param {{state?: Object, evidence?: Object, ledger?: Object}|null} model
 * @returns {string}
 */
export function renderEvidence(model) {
  if (!model || typeof model !== 'object') return '';
  const evidence = model.evidence || {};
  const asked = evidence.asked
    ? text(evidence.asked)
    : '<span class="rev-muted" data-testid="run-evidence-asked-empty">not recorded</span>';
  const done = evidence.done
    ? text(evidence.done)
    : '<span class="rev-muted" data-testid="run-evidence-done-empty">not recorded</span>';
  return `<section class="rev-evidence" data-testid="run-evidence">`
    + renderRow('run-evidence-asked', 'asked', asked)
    + renderRow('run-evidence-done', 'done', done)
    + renderCheckedRow(evidence.checked)
    + renderLedger(model.ledger)
    + '</section>';
}

/**
 * Render the close-out display box. Display only — the press and its script are
 * P3 (LIN-3248). Returns '' for a guest / non-owner viewer.
 * @param {{owner?: boolean, status?: string, pr?: Object|null, message?: string|null}|null} state
 * @returns {string}
 */
export function renderCloseOutBox(state) {
  if (!state || typeof state !== 'object' || !state.owner) return '';
  if (state.status === 'ready' && state.pr) {
    return `<div class="rev-closeout" data-testid="run-evidence-closeout" data-state="ready">`
      + '<p class="rev-closeout-ready" data-testid="run-evidence-closeout-ready">✓ PR ready for close-out</p>'
      + `<p class="rev-closeout-actions">${anchor(state.pr.url, 'or merge it yourself on GitHub ›', 'run-evidence-closeout-merge-yourself')}</p>`
      + '</div>';
  }
  const message = state.message || 'close-out is not available yet';
  return `<div class="rev-closeout" data-testid="run-evidence-closeout" data-state="${escapeHtml(state.status || 'unknown')}">`
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
