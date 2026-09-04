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
 * The foot offers three explicit actions (LIN-918, LIN-952, LIN-1037) — Save,
 * Save + triage, and Save + autopilot. On submit it captures the current page URL
 * and browser user agent, then POSTs to the feedback route
 * (`POST /workspace/:urlKey/api/feedback`) with the chosen `action`; the route
 * always files the ticket first, then branches on the action (file only / enqueue
 * a triage pass / enqueue a scoped autopilot run).
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

    // LIN-2298: no trigger is rendered here any more. The fixed `.feedback-fab`
    // that used to lead this markup was a `position: fixed` element floating
    // over full-width content, and LIN-2272 established that no CSS reserve
    // clears such an element at every scroll offset once the content spans the
    // column. It is replaced by a normal-flow trigger in the nav bar
    // (`renderFeedbackTrigger`, lib/components/navbar.js), bound below. The
    // PANEL stays an overlay on purpose: it appears only once the user asks for
    // it, so it covers content by the user's own choice, which is the half of
    // the old behaviour John's ruling explicitly kept.
    root.innerHTML = `
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
          <div class="feedback-exec" data-testid="feedback-exec-controls">
            <span class="feedback-label">Model / harness <span class="feedback-exec-hint">(triage &amp; autopilot only)</span></span>
            <span class="feedback-exec-mount"></span>
          </div>
          <span class="feedback-label">Screenshot (optional)</span>
          <label class="feedback-drop" data-testid="feedback-drop">
            <input id="feedback-file" class="feedback-file" data-testid="feedback-file"
                   type="file" accept="image/*">
            <span class="feedback-drop-hint">Drag &amp; drop or paste an image, or choose a file</span>
          </label>
          <div class="feedback-file-chip" data-testid="feedback-file-chip" hidden>
            <span class="feedback-file-name" data-testid="feedback-file-name"></span>
            <button type="button" class="feedback-file-remove" data-testid="feedback-file-remove"
                    hidden>Remove screenshot</button>
          </div>
          <div class="feedback-status" data-testid="feedback-status" role="status" aria-live="polite"></div>
          <div class="feedback-popup-foot">
            <button type="button" class="feedback-submit feedback-submit-secondary" data-testid="feedback-submit-triage"
                    data-action="triage">Save + triage</button>
            <button type="button" class="feedback-submit feedback-submit-secondary" data-testid="feedback-submit-autopilot"
                    data-action="autopilot">Save + autopilot</button>
            <button type="button" class="feedback-submit" data-testid="feedback-submit"
                    data-action="save">Save</button>
          </div>
        </div>
      </div>`;

    // Model/harness override controls (LIN-1132) — the SAME shared exec-controls
    // the Dispatch page uses (window.renderDispatchExecControls, public/common.js),
    // so the widget can't drift from that control style. They apply only to the
    // dispatching actions (triage / autopilot); Save omits them (see submit()).
    // The workspace default rides in via the mount's data-default-* attrs and is
    // shown as a UX-only placeholder/pre-select hint (blank still inherits the
    // workspace default server-side). Guarded on the helper being present so the
    // widget still works if common.js hasn't loaded.
    const execMount = root.querySelector('.feedback-exec-mount');
    if (execMount && typeof window.renderDispatchExecControls === 'function') {
      const defaultModel = root.dataset.defaultModel || '';
      const defaultHarness = root.dataset.defaultHarness || '';
      execMount.innerHTML = window.renderDispatchExecControls('feedback', {
        modelPlaceholder: defaultModel ? `model (default: ${defaultModel})` : 'model',
        harnessDefault: defaultHarness || undefined
      });
    }

    // LIN-2298: the trigger now lives in the nav bar, OUTSIDE this root, so it
    // is queried from the document rather than from `root`. A NodeList, not a
    // single element, so a page that ever grows a second trigger (a mobile
    // duplicate, say) keeps every copy's `aria-expanded` and draft dot in step
    // rather than silently maintaining only the first.
    //
    // Empty is tolerated, not an error: the widget's own actions (draft
    // persistence, submit) do not depend on a trigger existing, so a surface
    // that mounts the widget without a nav must degrade to an unopenable panel
    // rather than a thrown TypeError that takes the rest of this script with
    // it. No such surface exists today — every page rendering the mount also
    // renders the nav, which tests/unit/navbar-feedback-trigger.test.js pins —
    // so this is a guard against a future page, not a live case.
    const triggers = Array.from(document.querySelectorAll('[data-testid="nav-feedback-trigger"]'));
    const popup = root.querySelector('.feedback-popup');
    const messageEl = root.querySelector('.feedback-message');
    const priorityEl = root.querySelector('.feedback-priority');
    const execControlsEl = root.querySelector('.feedback-exec');
    const fileEl = root.querySelector('.feedback-file');
    const dropZone = root.querySelector('.feedback-drop');
    const fileChip = root.querySelector('.feedback-file-chip');
    const fileNameEl = root.querySelector('.feedback-file-name');
    const removeFileBtn = root.querySelector('.feedback-file-remove');
    const statusEl = root.querySelector('.feedback-status');
    // Three action buttons (Save / Save + triage / Save + autopilot); a shared
    // handler reads each button's data-action (LIN-918, LIN-1037).
    const submitBtns = Array.from(root.querySelectorAll('.feedback-submit'));
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
      triggers.forEach(t => t.classList.toggle('nav-feedback-trigger-draft', hasDraft));
    }

    // The remove control and filename chip only exist while a screenshot is
    // selected; they give the user the escape hatch and the visible confirmation
    // a native file input lacks (and that a dropped/pasted file has no other way
    // to show, since the native input's value can't be set programmatically).
    function reflectFileSelection() {
      const has = !!selectedFile;
      removeFileBtn.hidden = !has;
      fileChip.hidden = !has;
      fileNameEl.textContent = has ? selectedFile.name : '';
    }

    // Drop the current screenshot and reset the native input. Resetting
    // fileEl.value is essential: a native <input type=file> cannot be cleared
    // by the user, and an unreadable file would otherwise re-fail on every
    // retry.
    function clearSelectedFile() {
      selectedFile = null;
      fileEl.value = '';
      reflectFileSelection();
    }

    function open() {
      popup.hidden = false;
      triggers.forEach(t => t.setAttribute('aria-expanded', 'true'));
      messageEl.focus();
    }

    // Minimize: hide popup, keep all input (draft persisted; file kept in memory).
    function minimize() {
      popup.hidden = true;
      triggers.forEach(t => t.setAttribute('aria-expanded', 'false'));
      reflectDraftIndicator();
    }

    function persist() {
      saveDraft({ message: messageEl.value, priority: parseInt(priorityEl.value, 10) || 0 });
    }

    // Bind, THEN enable. `renderFeedbackTrigger` (lib/components/navbar.js)
    // ships the button `disabled` because it is server-rendered and on screen
    // from first paint, while this file is a deferred script — a click in that
    // window would find no listener and vanish. Enabling only after the
    // listener is attached is what makes the button's enabled state mean "this
    // works", so the order of these two statements is the contract, not style.
    triggers.forEach(t => {
      t.addEventListener('click', () => {
        if (popup.hidden) open(); else minimize();
      });
      t.disabled = false;
    });
    minBtn.addEventListener('click', minimize);
    closeBtn.addEventListener('click', minimize);

    messageEl.addEventListener('input', () => { persist(); });
    priorityEl.addEventListener('change', () => { persist(); });

    // Single intake path for every source of a screenshot — the native file
    // input, a drag-and-drop, and a clipboard paste all converge here so the
    // size cap, image-type check, and selected-file handling stay identical and
    // a dropped/pasted file cannot bypass the picker's validation.
    function ingestFile(file) {
      if (!file) { clearSelectedFile(); setStatus(''); return; }
      if (file.type && !file.type.startsWith('image/')) {
        clearSelectedFile();
        setStatus('That doesn’t look like an image. Please choose an image file.', 'error');
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        clearSelectedFile();
        setStatus('That image is too large (max 7MB). Pick a smaller one or submit without it.', 'error');
        return;
      }
      selectedFile = file;
      reflectFileSelection();
      setStatus('');
    }

    fileEl.addEventListener('change', () => {
      ingestFile(fileEl.files && fileEl.files[0]);
    });

    // Drag-and-drop over the drop zone. Only react when the drag actually
    // carries files, and keep a visible drag-over state so the target is
    // discoverable. `preventDefault` on dragover is what makes the element a
    // valid drop target.
    const dragCarriesFiles = (e) =>
      e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    ['dragenter', 'dragover'].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        if (!dragCarriesFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        dropZone.classList.add('feedback-drop-over');
      });
    });
    ['dragleave', 'dragend'].forEach((evt) => {
      dropZone.addEventListener(evt, () => dropZone.classList.remove('feedback-drop-over'));
    });
    dropZone.addEventListener('drop', (e) => {
      if (!dragCarriesFiles(e)) return;
      e.preventDefault();
      dropZone.classList.remove('feedback-drop-over');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) ingestFile(file);
    });

    // Clipboard paste of an image anywhere in the open popup (e.g. after a
    // screenshot-to-clipboard capture) routes through the same intake path.
    popup.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const item of items) {
        if (item.kind === 'file' && item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) { e.preventDefault(); ingestFile(file); return; }
        }
      }
    });

    removeFileBtn.addEventListener('click', () => {
      clearSelectedFile();
      setStatus('Screenshot removed.');
    });

    // Disable/enable both action buttons together for the duration of a
    // send, so a second action can't fire mid-flight.
    function setSubmitting(disabled) {
      submitBtns.forEach((b) => { b.disabled = disabled; });
    }

    // Human-readable framing per action, reused for the in-flight and success
    // status lines. 'save' keeps the plain wording; the others name the follow-up.
    const SENDING_STATUS = {
      save: 'Saving…',
      triage: 'Saving & triaging…',
      autopilot: 'Saving & starting autopilot…'
    };
    const DONE_SUFFIX = {
      save: '.',
      triage: ' — triaging.',
      autopilot: ' — autopilot starting.'
    };

    // Shared submit handler, parameterized by the chosen action (LIN-918). The
    // save→create-ticket flow is identical for both; only the `action` sent
    // to the route and the status wording differ.
    async function submit(action) {
      const message = messageEl.value.trim();
      if (!message) {
        setStatus('Please enter some feedback first.', 'error');
        messageEl.focus();
        return;
      }
      if (submitBtns.some((b) => b.disabled)) return;
      setSubmitting(true);
      setStatus(SENDING_STATUS[action] || 'Saving…');

      try {
        let image;
        if (selectedFile) {
          try {
            image = await readFileAsDataUrl(selectedFile);
          } catch (readErr) {
            console.error('Failed to read screenshot:', readErr);
            // Drop the unreadable file so the user isn't stuck retrying it
            // forever — pressing Save again now submits without it, or they
            // can pick a different image.
            clearSelectedFile();
            setStatus("Couldn't read that image on this device — it's been removed. Pick a different one, or press Save to submit without it.", 'error');
            setSubmitting(false);
            return;
          }
        }

        const payload = {
          message,
          action,
          priority: parseInt(priorityEl.value, 10) || 0,
          url: window.location.href,
          userAgent: navigator.userAgent
        };
        if (image) payload.image = image;

        // Model/harness override (LIN-1132) — only carried for the DISPATCHING
        // actions; Save files a ticket without dispatching, so model/harness are
        // meaningless there. Blank omitted (same `if (x) payload.x = x` idiom as
        // window.dispatchPrompt) so the server + factory fill blanks from the
        // workspace default.
        if (action !== 'save' && execControlsEl && typeof window.readDispatchExecControls === 'function') {
          const { model, harness } = window.readDispatchExecControls(execControlsEl);
          if (model) payload.model = model;
          if (harness) payload.harness = harness;
        }

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
          clearSelectedFile();
          reflectDraftIndicator();
          const ident = data.issue && (data.issue.identifier || data.issue.id);
          const filed = ident ? `Filed ${ident}` : 'Your feedback was filed';
          setStatus(`Thanks! ${filed}${DONE_SUFFIX[action] || '.'}`, 'success');
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
        setSubmitting(false);
      }
    }

    submitBtns.forEach((btn) => {
      btn.addEventListener('click', () => submit(btn.dataset.action || 'save'));
    });

    reflectDraftIndicator();
    reflectFileSelection();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
