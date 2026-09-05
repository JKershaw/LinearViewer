/**
 * Scan Section — shared client renderer (LIN-2197 Phase 5).
 *
 * Renders a per-task "scan for blockers" widget inside a container. Mirrors
 * brief.js/recap.js's four-state contract (missing/stale/fresh/generating)
 * but is human-triggered ONLY — unlike Brief/Recap, `init()` never
 * auto-scans on first open (LIN-2197's whole premise is a TRIAGE instrument:
 * a human presses a button, an LLM reads the task once, not on every card
 * expand). `init()` only performs the cheap GET status check; a scan itself
 * always requires an explicit click.
 *
 * The `fresh` state branches further than Brief/Recap's, since a scan result
 * carries a decision (or not) and an outcome (or not):
 *   - decision: null                    → zero-finding, the common case
 *   - decision present, outcome: null   → an unanswered ruling: question,
 *                                          options, an answer box, dismiss
 *   - decision present, outcome set     → 'dismissed' or 'answered', shown
 *                                          as a collapsed note (LIN-2197
 *                                          Phase 4 close-out ledger item L2:
 *                                          an outcome-stamped row is durable,
 *                                          never silently re-escalated)
 *
 * `stale` carries the SAME three branches (LIN-2211): a decision found before
 * unrelated task activity (e.g. an unconnected comment) moved the content
 * hash is still a live ruling, not a shape the operator lost the ability to
 * act on — `renderStale` reuses `renderDecisionBody` verbatim so an orphaned
 * unanswered ruling keeps its answer/dismiss controls alongside the rescan
 * affordance, rather than degrading to a bare "rescan" placeholder.
 *
 * Answering posts a durable comment via the shared `window.ReplyDelivery`
 * chain (LIN-2200) — NOT `window.api` directly, per this ticket's own
 * constraint — carrying `{taskDecisionId, taskDecisionIssueId}` so the
 * server can best-effort stamp the row 'answered' alongside the comment
 * write (Phase 4 close-out ledger item L4). Dismissing calls the scan
 * store's own dismiss route instead (a purely local state change with no
 * comment attached).
 *
 * Exposed as a global `ScanSection` since the swipe page is a plain script
 * (no module loader / build step) — same convention as BriefSection/
 * RecapSection.
 */
(function () {
  'use strict';

  const esc = window.escapeHtml;
  const relativeTime = window.relativeTime;

  // `suffix` (e.g. '/dismiss') is inserted into the PATH, before the `?source=`
  // query string — appending it after the full scanUrl() result instead would
  // produce `...?source=local/dismiss`, silently routing to the base scan
  // endpoint rather than 404ing (an easy, undetectable mistake this shape
  // rules out by construction).
  function scanUrl(urlKey, identifier, source, suffix) {
    const base = `/workspace/${encodeURIComponent(urlKey)}/api/scan/${encodeURIComponent(identifier)}${suffix || ''}`;
    if (!source) return base;
    const params = new URLSearchParams();
    params.set('source', source);
    return `${base}?${params.toString()}`;
  }

  // on401:false — scan errors (incl. 401) throw with .status/.body so the
  // inline renderError path shows them, rather than redirecting to /logout.
  async function fetchScanStatus(urlKey, identifier, source) {
    return window.api(scanUrl(urlKey, identifier, source), { on401: false });
  }

  async function postScan(urlKey, identifier, source) {
    return window.api(scanUrl(urlKey, identifier, source), { method: 'POST', on401: false });
  }

  async function postDismiss(urlKey, identifier, source, id) {
    return window.api(scanUrl(urlKey, identifier, source, '/dismiss'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      on401: false,
      body: JSON.stringify({ id })
    });
  }

  function actionButton(action, label) {
    return `<button type="button" class="scan-action" data-scan-action="${esc(action)}">${label}</button>`;
  }

  function header(label, meta, actionHtml) {
    const metaHtml = meta ? `<span class="scan-meta">${esc(meta)}</span>` : '';
    return `
      <div class="scan-header">
        <span class="scan-status-label">${esc(label)}</span>
        ${metaHtml}
        ${actionHtml || ''}
      </div>`;
  }

  function renderOptions(decision) {
    const options = Array.isArray(decision.options) ? decision.options : [];
    if (!options.length) return '';
    return `<ul class="scan-decision-options" data-testid="scan-decision-options">${options.map(o => {
      const label = String(o.label || '');
      const rec = decision.recommended && o.id === decision.recommended
        ? ' <span class="scan-decision-recommended">recommended</span>' : '';
      return `<li class="scan-decision-option"><button type="button" class="scan-decision-option-btn" data-option-label="${esc(label)}">${esc(label)}</button>${rec}</li>`;
    }).join('')}</ul>`;
  }

  function renderDecisionBody(decision, { interactive }) {
    const question = `<p class="scan-decision-question" data-testid="scan-decision-question">${esc(decision.question || '')}</p>`;
    const optionsHtml = renderOptions(decision);
    const answerHtml = interactive ? `
      <div class="scan-answer">
        <textarea class="scan-answer-input" data-scan-answer-input placeholder="Type your answer…" aria-label="Answer"></textarea>
        <div class="scan-answer-actions">
          <button type="button" class="scan-answer-submit" data-scan-action="answer">Send answer</button>
          <button type="button" class="scan-dismiss" data-scan-action="dismiss">Dismiss</button>
        </div>
      </div>` : '';
    return `<div class="scan-decision" data-testid="scan-decision">${question}${optionsHtml}${answerHtml}</div>`;
  }

  function renderFresh(data) {
    const ts = data.scannedAt ? relativeTime(data.scannedAt) : '';
    const meta = `scanned ${ts || 'now'}`;
    const rescanBtn = actionButton('rescan', '↻ rescan');

    if (!data.decision) {
      return `${header('scan · no blockers', meta, rescanBtn)}
        <div class="scan-empty" data-testid="scan-empty">No blockers found. This task looks clear.</div>`;
    }

    if (data.outcome === 'dismissed' || data.outcome === 'answered') {
      const outcomeLabel = data.outcome === 'dismissed' ? 'dismissed' : 'answered';
      const outcomeTs = data.outcomeAt ? relativeTime(data.outcomeAt) : '';
      return `${header(`scan · ${outcomeLabel}`, meta, rescanBtn)}
        <div class="scan-outcome-note" data-testid="scan-outcome-${outcomeLabel}">
          ${esc(outcomeLabel.charAt(0).toUpperCase() + outcomeLabel.slice(1))}${outcomeTs ? ' ' + esc(outcomeTs) : ''}.
          <details class="scan-outcome-detail"><summary>show ruling</summary>${renderDecisionBody(data.decision, { interactive: false })}</details>
        </div>`;
    }

    return `${header('scan · blocker found', meta, rescanBtn)}${renderDecisionBody(data.decision, { interactive: true })}`;
  }

  // LIN-2241 tier 1. `status: 'stale'` is derived from `inputHash`
  // (`hashContext`), which carries LABELS — on the issue and on every child
  // (lib/recap-cache.js:54, :64) — so a label-only edit reports "content has
  // changed" and invites a rescan that costs an LLM call and cannot possibly
  // find a different answer. `basisChanged: false` says precisely that: the
  // content the scan's judgement rests on did NOT move, only fields it never
  // reads did. Saying so is the whole point of acceptance criterion 1.
  //
  // Strictly `=== false`. The field is TRI-state and `null` means unknown (a
  // row raised before this landed, or one whose stored digest came from an
  // earlier BASIS_VERSION); unknown must fall through to the original,
  // non-committal copy rather than claim a check that never happened.
  function staleReasonNote(data, tail) {
    if (data && data.basisChanged === false) {
      return `<div class="scan-placeholder" data-testid="scan-stale-metadata-only">Only fields this scan does not read (labels, priority, assignee) have changed. ${tail}</div>`;
    }
    return `<div class="scan-placeholder">Task content has changed since the last scan. ${tail}</div>`;
  }

  function renderStale(data) {
    const ts = data && data.scannedAt ? relativeTime(data.scannedAt) : '';
    const meta = ts ? `last ${ts}` : '';
    const rescanBtn = actionButton('rescan', '↻ rescan');
    const staleNote = staleReasonNote(data, data && data.basisChanged === false
      ? 'The ruling below still stands — a rescan is unlikely to tell you anything new.'
      : 'Rescan to check for further blockers.');

    if (!data || !data.decision) {
      return `${header('scan · out of date', meta, rescanBtn)}
        ${staleReasonNote(data, data && data.basisChanged === false
          ? 'A rescan is unlikely to tell you anything new.'
          : 'Rescan to check for blockers.')}`;
    }

    if (data.outcome === 'dismissed' || data.outcome === 'answered') {
      const outcomeLabel = data.outcome === 'dismissed' ? 'dismissed' : 'answered';
      const outcomeTs = data.outcomeAt ? relativeTime(data.outcomeAt) : '';
      return `${header(`scan · out of date · ${outcomeLabel}`, meta, rescanBtn)}
        <div class="scan-outcome-note" data-testid="scan-outcome-${outcomeLabel}">
          ${esc(outcomeLabel.charAt(0).toUpperCase() + outcomeLabel.slice(1))}${outcomeTs ? ' ' + esc(outcomeTs) : ''}.
          <details class="scan-outcome-detail"><summary>show ruling</summary>${renderDecisionBody(data.decision, { interactive: false })}</details>
        </div>`;
    }

    // Orphan case: an unanswered ruling whose task content has since changed
    // (LIN-2211) — still live and actionable, so it gets the same
    // answer/dismiss interaction `renderFresh` offers, plus the rescan
    // affordance and a note explaining why it's shown as stale.
    return `${header('scan · out of date', meta, rescanBtn)}${renderDecisionBody(data.decision, { interactive: true })}${staleNote}`;
  }

  // The comment an answer writes is itself part of the scan's own input
  // (`comments` feeds `hashContext`), so the just-answered row routinely
  // reports 'stale' the moment `runAnswer` re-fetches status — expected, not
  // a failure, but bare "out of date" copy would read as if the answer never
  // landed. Confirms the send before handing off to the ordinary stale
  // affordance.
  function renderAnswerSentStale() {
    return `${header('scan · answer sent', '', actionButton('rescan', '↻ rescan'))}
      <div class="scan-placeholder">Your answer was recorded as a comment. Task content has changed since the scan — rescan to check for further blockers.</div>`;
  }

  function renderMissing() {
    return `${header('scan', '', actionButton('scan', '🔍 scan for blockers'))}
      <div class="scan-placeholder">Not scanned yet. Run a scan to check whether this task has a decision waiting on you.</div>`;
  }

  const GENERATING_COPY = {
    load: { status: 'loading', body: 'Checking scan status.' },
    scan: { status: 'scanning', body: 'Reading the task for a blocker.' },
    dismiss: { status: 'dismissing', body: 'Dismissing the ruling.' },
    answer: { status: 'sending', body: 'Recording your answer.' }
  };

  function renderGenerating(kind) {
    const copy = GENERATING_COPY[kind] || GENERATING_COPY.scan;
    return `
      <div class="scan-header">
        <span class="scan-status-label">scan · ${esc(copy.status)}…</span>
      </div>
      <div class="scan-placeholder scan-generating">
        <span class="scan-spinner"></span> ${esc(copy.body)}
      </div>`;
  }

  function renderError(message) {
    return `${header('scan · error', '', actionButton('scan', '↻ retry'))}
      <div class="scan-placeholder scan-error">${esc(message || 'Could not load scan.')}</div>`;
  }

  function applyState(container, html, state) {
    container.innerHTML = html;
    container.setAttribute('data-state', state);
  }

  /**
   * Wire the action buttons present in the CURRENT render. Called fresh
   * after every applyState (mirrors brief.js/recap.js's wireRefresh) — the
   * previous render's buttons were just discarded by the innerHTML replace,
   * so there is nothing to unbind first.
   */
  function wireActions(container, ctx) {
    const scanBtn = container.querySelector('[data-scan-action="scan"], [data-scan-action="rescan"]');
    if (scanBtn) scanBtn.addEventListener('click', () => runScan(container, ctx));

    const dismissBtn = container.querySelector('[data-scan-action="dismiss"]');
    if (dismissBtn) dismissBtn.addEventListener('click', () => runDismiss(container, ctx));

    const answerBtn = container.querySelector('[data-scan-action="answer"]');
    if (answerBtn) answerBtn.addEventListener('click', () => runAnswer(container, ctx));

    container.querySelectorAll('[data-option-label]').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = container.querySelector('[data-scan-answer-input]');
        if (input) {
          input.value = btn.dataset.optionLabel;
          input.focus();
        }
      });
    });
  }

  async function runScan(container, ctx) {
    applyState(container, renderGenerating('scan'), 'generating');
    try {
      const data = await postScan(ctx.urlKey, ctx.identifier, ctx.source);
      ctx.lastData = data;
      applyState(container, renderFresh(data), 'fresh');
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireActions(container, ctx);
  }

  async function runDismiss(container, ctx) {
    const id = ctx.lastData && ctx.lastData.id;
    if (!id) return;
    applyState(container, renderGenerating('dismiss'), 'generating');
    try {
      // Dismiss by the CANONICAL id when we have one (returned on every
      // GET/POST scan response) rather than the display identifier — the
      // route skips its provider context fetch entirely for an
      // already-UUID-shaped id (LIN-2197 Phase 4 close-out ledger item L3).
      const dismissIdentifier = ctx.lastData.issueId || ctx.identifier;
      const data = await postDismiss(ctx.urlKey, dismissIdentifier, ctx.source, id);
      ctx.lastData = data;
      applyState(container, renderFresh(data), 'fresh');
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireActions(container, ctx);
  }

  async function runAnswer(container, ctx) {
    const input = container.querySelector('[data-scan-answer-input]');
    const text = input ? input.value.trim() : '';
    if (!text) {
      if (input) input.focus();
      return;
    }
    const data = ctx.lastData;
    if (!data || !data.id || !data.issueId) return;

    applyState(container, renderGenerating('answer'), 'generating');
    try {
      const result = await window.ReplyDelivery.postComment(ctx.urlKey, ctx.identifier, text, {
        taskDecisionId: data.id,
        taskDecisionIssueId: data.issueId
      });
      if (!result.ok) {
        throw window.ReplyDelivery.errorFromResult(result);
      }
      // The answer stamp is best-effort server-side (mirrors the LIN-1728
      // loop-decision stamp's discipline) — re-fetch status rather than
      // optimistically rendering 'answered', so the UI always reflects
      // ground truth even if the stamp itself didn't land. The comment this
      // just wrote is itself part of the scan's own input (`comments` feeds
      // `hashContext`), so the freshly-answered row routinely reports
      // 'stale' here — that is expected, not a failure, and NOT the same
      // rendering as 'missing' (this task plainly has been scanned).
      const refreshed = await fetchScanStatus(ctx.urlKey, ctx.identifier, ctx.source);
      if (refreshed.status === 'fresh') {
        ctx.lastData = refreshed;
        applyState(container, renderFresh(refreshed), 'fresh');
      } else if (refreshed.status === 'stale') {
        applyState(container, renderAnswerSentStale(), 'stale');
      } else {
        applyState(container, renderMissing(), 'missing');
      }
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireActions(container, ctx);
  }

  /**
   * Initialise a scan section inside the given container. Only performs the
   * cheap GET status check — never auto-scans (see the module docstring).
   *
   * @param {HTMLElement} container - The element to render into.
   * @param {Object} opts
   * @param {string} opts.urlKey - Workspace url key.
   * @param {string} opts.identifier - Linear issue id (UUID) or identifier (LIN-123).
   * @param {string} [opts.source] - Resolved provider name (LIN-1910), forwarded as `?source=`.
   */
  async function init(container, opts) {
    if (!container || !opts || !opts.urlKey || !opts.identifier) return;
    container.classList.add('scan-section');
    applyState(container, renderGenerating('load'), 'loading');
    const ctx = { urlKey: opts.urlKey, identifier: opts.identifier, source: opts.source, lastData: null };

    try {
      const data = await fetchScanStatus(ctx.urlKey, ctx.identifier, ctx.source);
      if (data.status === 'fresh') {
        ctx.lastData = data;
        applyState(container, renderFresh(data), 'fresh');
      } else if (data.status === 'stale') {
        ctx.lastData = data;
        applyState(container, renderStale(data), 'stale');
      } else {
        applyState(container, renderMissing(), 'missing');
      }
    } catch (err) {
      applyState(container, renderError(err && err.message), 'error');
    }
    wireActions(container, ctx);
  }

  window.ScanSection = { init };
})();
