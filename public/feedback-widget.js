/**
 * Feedback Widget (LIN-635)
 *
 * A floating feedback control, hidden by default and enabled per-user via the
 * `feedbackWidget` flag (toggled from the footer or Settings). When enabled it
 * paints a floating button; clicking it opens a popup with a free-text area, a
 * priority select, and an optional screenshot. The popup can be minimized
 * without losing input (draft text/priority persist in localStorage; the
 * selected screenshot persists in memory while the page is not reloaded).
 *
 * On submit it captures the current page URL and browser user agent, then POSTs
 * to the existing feedback route (`POST /workspace/:urlKey/api/feedback`) which
 * files a fresh ticket and enqueues a triage follow-up.
 *
 * No framework, no build step — matches the repo's vanilla client convention.
 */
(function () {
  'use strict';

  const DRAFT_KEY = 'feedback-widget-draft';
  // Linear priority scale (0 = none, 1 = urgent … 4 = low).
  const PRIORITIES = [
    { value: 0, label: 'No priority' },
    { value: 1, label: 'Urgent' },
    { value: 2, label: 'High' },
    { value: 3, label: 'Medium' },
    { value: 4, label: 'Low' }
  ];
  // Keep client-side intake within the route's 10mb image ceiling, leaving room
  // for base64 inflation (~4/3) under the route's 12mb body limit.
  const MAX_IMAGE_BYTES = 7 * 1024 * 1024;

  const esc = (s) => (window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s));

  // ---- Draft persistence (single JSON key + try/catch, app.js idiom) --------
  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return { message: '', priority: 0 };
      const parsed = JSON.parse(raw);
      return {
        message: typeof parsed.message === 'string' ? parsed.message : '',
        priority: Number.isInteger(parsed.priority) ? parsed.priority : 0
      };
    } catch (e) {
      console.warn('Failed to load feedback draft:', e);
      return { message: '', priority: 0 };
    }
  }

  function saveDraft(draft) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch (e) {
      console.warn('Failed to save feedback draft:', e);
    }
  }

  function clearDraft() {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      console.warn('Failed to clear feedback draft:', e);
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  function init() {
    const root = document.getElementById('feedback-widget-root');
    if (!root || root.dataset.initialized === 'true') return;
    root.dataset.initialized = 'true';

    const urlKey = root.dataset.urlKey;

    // The footer toggle persists the flag through the shared /settings/features
    // path, then reloads so the widget appears/disappears. Delegated so it works
    // regardless of where the toggle lives in the footer.
    document.addEventListener('click', async (e) => {
      const toggle = e.target.closest('.footer-feedback-toggle');
      if (!toggle) return;
      e.preventDefault();
      if (toggle.dataset.busy === 'true') return;
      toggle.dataset.busy = 'true';

      const tUrlKey = toggle.dataset.urlKey || urlKey;
      const next = toggle.dataset.enabled !== 'true';
      try {
        const res = await fetch(`/workspace/${encodeURIComponent(tUrlKey)}/settings/features`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest'
          },
          body: new URLSearchParams({ feature: 'feedbackWidget', enabled: String(next) })
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        window.location.reload();
      } catch (err) {
        console.error('Failed to toggle feedback widget:', err);
        toggle.dataset.busy = 'false';
      }
    });

    // The widget itself only renders when the flag is on.
    if (root.dataset.enabled !== 'true' || !urlKey) return;

    buildWidget(root, urlKey);
  }

  function buildWidget(root, urlKey) {
    const draft = loadDraft();
    let selectedFile = null; // in-memory; survives minimize (no reload)

    root.innerHTML = `
      <button type="button" class="feedback-fab" data-testid="feedback-fab"
              aria-label="Give feedback" title="Give feedback">feedback</button>
      <div class="feedback-popup" data-testid="feedback-popup" hidden role="dialog" aria-label="Feedback">
        <div class="feedback-popup-head">
          <span class="feedback-popup-title">Feedback</span>
          <div class="feedback-popup-actions">
            <button type="button" class="feedback-min" data-testid="feedback-minimize"
                    title="Minimize (keeps your draft)" aria-label="Minimize">–</button>
            <button type="button" class="feedback-close" data-testid="feedback-close"
                    title="Close" aria-label="Close">×</button>
          </div>
        </div>
        <div class="feedback-popup-body">
          <label class="feedback-label" for="feedback-message">What's on your mind?</label>
          <textarea id="feedback-message" class="feedback-message" data-testid="feedback-message"
                    rows="5" placeholder="Describe the issue or idea…"></textarea>
          <label class="feedback-label" for="feedback-priority">Priority</label>
          <select id="feedback-priority" class="feedback-priority" data-testid="feedback-priority">
            ${PRIORITIES.map(p => `<option value="${p.value}">${esc(p.label)}</option>`).join('')}
          </select>
          <label class="feedback-label" for="feedback-file">Screenshot (optional)</label>
          <input id="feedback-file" class="feedback-file" data-testid="feedback-file"
                 type="file" accept="image/*">
          <div class="feedback-status" data-testid="feedback-status" role="status" aria-live="polite"></div>
          <div class="feedback-popup-foot">
            <button type="button" class="feedback-submit" data-testid="feedback-submit">Send feedback</button>
          </div>
        </div>
      </div>`;

    const fab = root.querySelector('.feedback-fab');
    const popup = root.querySelector('.feedback-popup');
    const messageEl = root.querySelector('.feedback-message');
    const priorityEl = root.querySelector('.feedback-priority');
    const fileEl = root.querySelector('.feedback-file');
    const statusEl = root.querySelector('.feedback-status');
    const submitBtn = root.querySelector('.feedback-submit');
    const minBtn = root.querySelector('.feedback-min');
    const closeBtn = root.querySelector('.feedback-close');

    // Hydrate from draft.
    messageEl.value = draft.message;
    priorityEl.value = String(draft.priority);

    function setStatus(text, kind) {
      statusEl.textContent = text || '';
      statusEl.className = 'feedback-status' + (kind ? ' feedback-status-' + kind : '');
    }

    function reflectDraftIndicator() {
      const hasDraft = !!messageEl.value.trim();
      fab.classList.toggle('feedback-fab-draft', hasDraft);
    }

    function open() {
      popup.hidden = false;
      fab.setAttribute('aria-expanded', 'true');
      messageEl.focus();
    }

    // Minimize: hide popup, keep all input (draft persisted; file kept in memory).
    function minimize() {
      popup.hidden = true;
      fab.setAttribute('aria-expanded', 'false');
      reflectDraftIndicator();
    }

    function persist() {
      saveDraft({ message: messageEl.value, priority: parseInt(priorityEl.value, 10) || 0 });
    }

    fab.addEventListener('click', () => {
      if (popup.hidden) open(); else minimize();
    });
    minBtn.addEventListener('click', minimize);
    closeBtn.addEventListener('click', minimize);

    messageEl.addEventListener('input', () => { persist(); });
    priorityEl.addEventListener('change', () => { persist(); });

    fileEl.addEventListener('change', () => {
      const file = fileEl.files && fileEl.files[0];
      if (!file) { selectedFile = null; setStatus(''); return; }
      if (file.size > MAX_IMAGE_BYTES) {
        selectedFile = null;
        fileEl.value = '';
        setStatus('That image is too large (max 7MB). Pick a smaller one or submit without it.', 'error');
        return;
      }
      selectedFile = file;
      setStatus('');
    });

    submitBtn.addEventListener('click', async () => {
      const message = messageEl.value.trim();
      if (!message) {
        setStatus('Please enter some feedback first.', 'error');
        messageEl.focus();
        return;
      }
      if (submitBtn.disabled) return;
      submitBtn.disabled = true;
      setStatus('Sending…');

      try {
        let image;
        if (selectedFile) {
          try {
            image = await readFileAsDataUrl(selectedFile);
          } catch (readErr) {
            console.error('Failed to read screenshot:', readErr);
            setStatus('Could not read that screenshot. You can submit without it.', 'error');
            submitBtn.disabled = false;
            return;
          }
        }

        const payload = {
          message,
          priority: parseInt(priorityEl.value, 10) || 0,
          url: window.location.href,
          userAgent: navigator.userAgent
        };
        if (image) payload.image = image;

        // text/plain (not application/json) so the request bypasses the global
        // 250kb express.json cap and is parsed by the feedback route's own
        // larger body parser (LIN-636).
        const res = await fetch(`/workspace/${encodeURIComponent(urlKey)}/api/feedback`, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
          body: JSON.stringify(payload)
        });

        let data = {};
        try { data = await res.json(); } catch (_) { /* ignore */ }

        if (res.ok && data.success) {
          clearDraft();
          messageEl.value = '';
          priorityEl.value = '0';
          fileEl.value = '';
          selectedFile = null;
          reflectDraftIndicator();
          const ident = data.issue && (data.issue.identifier || data.issue.id);
          setStatus(ident ? `Thanks! Filed ${ident}.` : 'Thanks! Your feedback was filed.', 'success');
          setTimeout(minimize, 2500);
          return;
        }

        // Failure — keep the draft and input intact so nothing is lost.
        if (res.status === 413) {
          setStatus('That screenshot is too large. Remove it and try again.', 'error');
        } else if (res.status === 422) {
          setStatus("This workspace's provider can't file feedback tickets.", 'error');
        } else {
          setStatus((data && data.error) ? data.error : 'Something went wrong. Please try again.', 'error');
        }
      } catch (err) {
        console.error('Feedback submit failed:', err);
        setStatus('Network error. Your draft is saved — please try again.', 'error');
      } finally {
        submitBtn.disabled = false;
      }
    });

    reflectDraftIndicator();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
