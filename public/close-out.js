/**
 * Close-out client (LIN-3340).
 *
 * Drives the merge click on the TASK page, entirely off the close-out box
 * `renderCloseOutBox` renders: the task's tracker UUID (`data-issue-id`), its
 * provider kind (`data-source`), the stop-at fact and the PR ref. It never
 * reads a session reply box — the task page has none, and the run page's copy
 * (public/session.js) is left for LIN-3349.
 *
 * The press reuses the ordinary dispatch path (GET /api/prompt/:issueId/close-out
 * + window.dispatchPrompt) then records the press; the check re-reads the PR and
 * sets Done within R1. Same routes the run page uses, no new route.
 *
 *   - the close-out prompt GET carries `?source=` when the box has one (H1,
 *     plan-review `bc8e6aab`): without it the route resolves the wrong provider
 *     and the press silently finds no issue;
 *   - the check POST carries `{ source }` in its body for the same reason
 *     (G1, plan-review `7b61c8e2`).
 *
 * Exposed as `window.CloseOut` (a plain script, no build step).
 */
(function () {
  'use strict';

  function enc(value) { return encodeURIComponent(value); }

  /**
   * The close-out prompt URL, with `?source=` when the task has a provider kind.
   * The URLSearchParams shape yields nothing when the source is absent, so a
   * source-less task keeps the bare path (byte-identical to the run page).
   *
   * @param {string} urlKey
   * @param {string} issueId - the task's tracker UUID
   * @param {string} [source]
   * @returns {string}
   */
  function promptUrl(urlKey, issueId, source) {
    const base = '/workspace/' + enc(urlKey) + '/api/prompt/' + enc(issueId) + '/close-out';
    if (!source) return base;
    const params = new URLSearchParams();
    params.set('source', source);
    return base + '?' + params.toString();
  }

  /** The check route's URL, keyed by the task identifier. */
  function checkUrl(urlKey, issueIdentifier) {
    return '/workspace/' + enc(urlKey) + '/api/run-evidence/' + enc(issueIdentifier) + '/check';
  }

  /** The check POST body: `source` when the box has one, else `{}`. */
  function checkBody(source) {
    return source ? { source: source } : {};
  }

  /**
   * Everything the client needs, read off the box's own attributes.
   * @param {HTMLElement} box
   * @returns {{urlKey: string, issueId: string, issueIdentifier: string, source: string, stopAt: string, state: string}}
   */
  function boxContext(box) {
    const get = (k) => (box && box.getAttribute ? (box.getAttribute(k) || '') : '');
    return {
      urlKey: get('data-url-key'),
      issueId: get('data-issue-id'),
      issueIdentifier: get('data-issue-identifier'),
      source: get('data-source'),
      stopAt: get('data-stop-at'),
      state: get('data-state'),
    };
  }

  /** Replace the box's dynamic content with one text line (no markup injection). */
  function paint(box, testId, line) {
    while (box.firstChild) box.removeChild(box.firstChild);
    const p = document.createElement('p');
    p.setAttribute('data-testid', testId);
    p.textContent = line;
    box.appendChild(p);
  }

  /** Reflect a check result's state on the box. */
  function applyCloseOutState(box, state) {
    if (!box || !state || !state.status) return;
    const prevYou = box.getAttribute('data-merged-by-you') === 'true';
    const nextYou = !!state.mergedByYou;
    if (box.getAttribute('data-state') === state.status && prevYou === nextYou) return;
    box.setAttribute('data-state', state.status);
    box.setAttribute('data-merged-by-you', nextYou ? 'true' : 'false');
    if (state.status === 'ready') return;
    if (state.status === 'merged' || state.status === 'partial') {
      if (nextYou) {
        paint(box, 'run-evidence-closeout-merged', '✓ merged by you' + (state.message ? ' · ' + state.message : ''));
      } else {
        paint(box, 'run-evidence-closeout-neutral', state.message || 'the pull request is already merged');
      }
    } else if (state.status === 'not-ready' || state.status === 'no-pr' || state.status === 'multiple-prs' || state.status === 'closed') {
      paint(box, 'run-evidence-closeout-setup', '○ set up ›');
    } else {
      paint(box, 'run-evidence-closeout-withheld', state.message || 'the pull request could not be read — not checked');
    }
  }

  /**
   * The press. Reads identity off the box only; dispatches the close-out and
   * records the press. On a `done` check result the page reloads so the
   * tracker's Finished header shows.
   */
  function pressCloseOut(box, btn) {
    const ctx = boxContext(box);
    if (!ctx.urlKey || !ctx.issueId || !ctx.issueIdentifier) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'closing out…';
    return window.api(promptUrl(ctx.urlKey, ctx.issueId, ctx.source))
      .then(function (result) {
        return window.dispatchPrompt({
          urlKey: ctx.urlKey,
          prompt: result.prompt,
          promptName: result.promptName || 'close-out',
          kind: 'close-out',
          issue: { id: ctx.issueId, identifier: ctx.issueIdentifier, title: result.issueTitle || '', source: ctx.source },
          entryRung: 'run-step'
        });
      })
      .then(function (dispatch) {
        const dispatchId = (dispatch && dispatch.item && dispatch.item.id) || (dispatch && dispatch.id) || null;
        return window.api(
          '/workspace/' + enc(ctx.urlKey) + '/api/run-evidence/' + enc(ctx.issueIdentifier) + '/close-out-press',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prUrl: box.getAttribute('data-pr-url') || null,
              headSha: box.getAttribute('data-head-sha') || null,
              dispatchId: dispatchId
            })
          }
        );
      })
      .then(function () {
        btn.textContent = 'close-out sent ✓';
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = original;
        console.error('Close-out press failed:', err && err.message);
      });
  }

  /**
   * The self-merge / state check. Stop-at-PR runs only, and only while the box
   * is `ready`/`merged`/`partial` (the same gate the run page uses).
   */
  function runCheck(box) {
    const ctx = boxContext(box);
    if (!ctx.urlKey || !ctx.issueIdentifier) return Promise.resolve(null);
    if (ctx.stopAt !== 'pr') return Promise.resolve(null);
    if (ctx.state !== 'ready' && ctx.state !== 'merged' && ctx.state !== 'partial') return Promise.resolve(null);
    return window.api(checkUrl(ctx.urlKey, ctx.issueIdentifier), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkBody(ctx.source)),
    }).then(function (result) {
      applyCloseOutState(box, result && result.state);
      // A merge we just set Done for: reload so the tracker's header shows it.
      if (result && result.done && typeof window.location !== 'undefined' && window.location.reload) {
        window.location.reload();
      }
      return result;
    }).catch(function () { return null; });
  }

  // Debounce tab-return so one return fires one check (the run page's N-a fix).
  let checkTimer = null;
  function scheduleCheck(box) {
    if (checkTimer) return;
    checkTimer = setTimeout(function () {
      checkTimer = null;
      runCheck(box);
    }, 300);
  }

  /**
   * Wire the box the page rendered. The task page calls this once per load;
   * the box is outside the polled mounts, so it survives polls and needs no
   * re-init.
   *
   * @param {Document} [doc]
   * @returns {HTMLElement|null}
   */
  function init(doc) {
    if (!doc) return null;
    const box = doc.querySelector('[data-testid="run-evidence-closeout"]');
    if (!box) return null;
    doc.addEventListener('click', function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('[data-action="closeout-press"]') : null;
      if (!btn) return;
      e.preventDefault();
      pressCloseOut(box, btn);
    });
    runCheck(box);
    window.addEventListener('focus', function () { scheduleCheck(box); });
    doc.addEventListener('visibilitychange', function () { if (!doc.hidden) scheduleCheck(box); });
    return box;
  }

  window.CloseOut = {
    init: init,
    promptUrl: promptUrl,
    checkUrl: checkUrl,
    checkBody: checkBody,
    boxContext: boxContext,
    pressCloseOut: pressCloseOut,
    runCheck: runCheck,
    applyCloseOutState: applyCloseOutState,
  };

  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('DOMContentLoaded', function () { init(document); });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { promptUrl, checkUrl, checkBody, boxContext, pressCloseOut, runCheck, applyCloseOutState };
  }
})();
