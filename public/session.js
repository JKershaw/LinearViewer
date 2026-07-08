/**
 * Session Page Client (LIN-1004 Phase 2, LIN-1133 per-run/inline reply).
 *
 * The session page is otherwise a no-client-JS snapshot (LIN-1003). This is its
 * TWO scoped interactions:
 *   1. Reply box(es) — per-run inline reply + bottom fallback reply (LIN-1133)
 *   2. Brief/recap refresh buttons in the Task context panels (LIN-1133)
 *
 * Reply behaviour (LIN-1004):
 *   - Each per-run box POSTs a follow-up scoped to that run's dispatch id
 *     (`followUpTo` = the loop's `loopId` from `data-follow-up`).
 *   - The bottom reply box POSTs a follow-up to the session's root dispatch id
 *     (`followUpTo` = `data-session-id`).
 *   - `force` only from the terminal flag on the bottom box; per-run replies
 *     never force (they're about continuing from a specific context).
 *
 * Depends on common.js (loaded as a script before this one) for renderMarkdown,
 * escapeHtml, and api helpers used by the brief/recap refresh path.
 */
(function () {
  'use strict';

  // Generic reply helper — shared by per-run inline and bottom reply boxes.
  function wireReplyBox(box, followUpTo, urlKey, target, terminal) {
    var textarea = box.querySelector('.sess-run-reply-input, .sess-reply-input');
    var btn = box.querySelector('.sess-run-reply-send, .sess-reply-send');
    var feedback = box.querySelector('.sess-run-reply-feedback, .sess-reply-feedback');
    if (!textarea || !btn) return;

    function setFeedback(msg, isError) {
      if (!feedback) return;
      feedback.textContent = msg;
      feedback.className = (feedback.className || '').replace(/\s*error$/g, '') + (isError ? ' error' : '');
    }

    function send() {
      var prompt = (textarea.value || '').trim();
      if (!prompt) {
        setFeedback('enter a reply', true);
        return;
      }
      var original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'sending\u2026';
      setFeedback('', false);

      var body = { prompt: prompt, followUpTo: followUpTo, target: target };
      if (terminal) body.force = true;

      fetch('/workspace/' + encodeURIComponent(urlKey) + '/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
        .then(function (resp) {
          if (resp.ok) return resp.json().catch(function () { return {}; });
          return resp.json().catch(function () { return {}; }).then(function (data) {
            throw new Error((data && data.error) || ('HTTP ' + resp.status));
          });
        })
        .then(function () {
          textarea.value = '';
          setFeedback(
            terminal
              ? 'reply queued \u2014 if the session has ended you\u2019ll see \u201cno live session to resume\u201d in the transcript on reload'
              : 'reply queued \u2014 reload to see the session continue',
            false
          );
          btn.textContent = 'queued \u2713';
        })
        .catch(function (e) {
          setFeedback('reply failed: ' + e.message, true);
          btn.textContent = 'failed';
        })
        .then(function () {
          setTimeout(function () {
            if (btn.isConnected) {
              btn.textContent = original;
              btn.disabled = false;
            }
          }, 1800);
        });
    }

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      send();
    });

    textarea.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        send();
      }
    });
  }

  // ── Per-run inline reply boxes (LIN-1133) ────────────────────────────────
  var runReplies = document.querySelectorAll('[data-testid="session-run-reply"]');
  for (var i = 0; i < runReplies.length; i++) {
    var box = runReplies[i];
    var followUpTo = box.dataset.followUp;
    var urlKey = box.dataset.urlKey;
    var target = box.dataset.target === 'web' ? 'web' : 'cli';
    // Per-run replies never force — force is only for the session-level box.
    wireReplyBox(box, followUpTo, urlKey, target, false);
  }

  // ── Bottom reply box (LIN-1004) ──────────────────────────────────────────
  var bottomBox = document.querySelector('[data-testid="session-reply"]');
  if (bottomBox) {
    var sessionId = bottomBox.dataset.sessionId;
    var bUrlKey = bottomBox.dataset.urlKey;
    var bTarget = bottomBox.dataset.target === 'web' ? 'web' : 'cli';
    var bTerminal = bottomBox.dataset.sessionTerminal === 'true';
    wireReplyBox(bottomBox, sessionId, bUrlKey, bTarget, bTerminal);
  }

  // ── Brief/recap refresh (LIN-1133) ───────────────────────────────────────
  var refreshBtns = document.querySelectorAll('[data-sess-kind]');
  for (var j = 0; j < refreshBtns.length; j++) {
    refreshBtns[j].addEventListener('click', function (e) {
      e.preventDefault();
      var btn = this;
      var kind = btn.dataset.sessKind; // 'brief' | 'recap'
      var identifier = btn.dataset.sessIdentifier;
      var key = btn.dataset.sessUrlKey;
      if (!kind || !identifier || !key) return;

      var panel = btn.closest('[data-testid="session-' + kind + '"]');
      if (!panel) return;

      var originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'generating\u2026';

      var apiPath = '/workspace/' + encodeURIComponent(key) + '/api/' + kind + '/' + encodeURIComponent(identifier);
      var api = window.api || fetch;
      var isApiFn = typeof api === 'function' && api !== fetch;
      var fetchFn = isApiFn ? function (url, opts) { return api(url, opts); } : fetch;

      fetchFn(apiPath, { method: 'POST', credentials: 'same-origin' })
        .then(function (resp) {
          if (!resp.ok) {
            return resp.json().catch(function () { return {}; }).then(function (d) {
              throw new Error((d && d.error) || ('HTTP ' + resp.status));
            });
          }
          return resp.json();
        })
        .then(function (data) {
          // Replace the panel body with freshly rendered markdown.
          var bodyEl = panel.querySelector('.sess-ctx-body, .sess-ctx-recap');
          var metaEl = panel.querySelector('.sess-ctx-meta');

          if (kind === 'brief' && data.brief) {
            var renderFn = window.renderMarkdown || function (t) { return t; };
            var html = renderFn(data.brief);
            if (bodyEl) {
              bodyEl.className = 'sess-ctx-body rendered-markdown';
              bodyEl.innerHTML = html;
            } else if (panel.querySelector('.sess-ctx-miss')) {
              // Replace the miss affordance.
              var p = panel.querySelector('.sess-ctx-miss');
              if (p) p.remove();
              var div = document.createElement('div');
              div.className = 'sess-ctx-body rendered-markdown';
              div.innerHTML = html;
              panel.appendChild(div);
            }
          } else if (kind === 'recap' && data.recap) {
            // Structured recap object — render client-side with the same groupings.
            if (bodyEl) bodyEl.remove();
            var groups = [
              { key: 'done', label: 'Done', icon: '\u2713', secondary: 'evidence' },
              { key: 'pending', label: 'Pending', icon: '\u25CB', secondary: 'predicted' },
              { key: 'deviations', label: 'Deviations', icon: '\u25D0', secondary: 'evidence' }
            ];
            var recapHtml = groups.map(function (g) {
              var items = (data.recap && data.recap[g.key]) || [];
              if (!items.length) return '';
              var lis = items.map(function (it) {
                var what = (window.escapeHtml || function (s) { return s; })(String(it.item || ''));
                var tag = it.type ? ' <span class="sess-recap-tag">' + what + '</span>' : '';
                var sub = it[g.secondary] ? '<span class="sess-recap-sub">' + (window.escapeHtml || function (s) { return s; })('' + it[g.secondary]) + '</span>' : '';
                return '<li class="sess-recap-item"><span class="sess-recap-what">' + what + '</span>' + sub + '</li>';
              }).join('');
              return '<div class="sess-recap-group" data-testid="session-recap-' + g.key + '"><div class="sess-recap-group-head"><span class="sess-recap-icon">' + g.icon + '</span> ' + g.label + '</div><ul class="sess-recap-list">' + lis + '</ul></div>';
            }).filter(Boolean).join('');
            recapHtml = recapHtml || '<p class="sess-ctx-body sess-muted">recap generated but recorded no items</p>';
            var recapDiv = document.createElement('div');
            recapDiv.className = 'sess-ctx-recap';
            recapDiv.innerHTML = recapHtml;
            panel.appendChild(recapDiv);
            var missEl = panel.querySelector('.sess-ctx-miss');
            if (missEl) missEl.remove();
          }

          // Update meta.
          var metaParts = [];
          if (data.model) metaParts.push('model ' + data.model);
          if (data.generatedAt) metaParts.push('generated ' + data.generatedAt);
          var metaText = metaParts.join(' \u00B7 ');
          if (metaEl) {
            metaEl.textContent = metaText;
          } else if (metaText) {
            var mDiv = document.createElement('div');
            mDiv.className = 'sess-ctx-meta';
            mDiv.textContent = metaText;
            panel.appendChild(mDiv);
          }

          // Update the button to "↻ refresh".
          panel.setAttribute('data-testid', panel.getAttribute('data-testid') || '');
          btn.textContent = '\u21BB refresh';
          btn.dataset.testid = 'session-' + kind + '-refresh';
          btn.disabled = false;
        })
        .catch(function (err) {
          btn.textContent = 'retry';
          btn.disabled = false;
          setTimeout(function () {
            if (btn.isConnected) btn.textContent = originalLabel;
          }, 2000);
        });
    });
  }
})();
