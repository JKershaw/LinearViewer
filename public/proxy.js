/**
 * Proxy Page Client-Side Logic
 *
 * Handles: token generation, agent prompt creation, event log display. The token
 * lists (ordinary and runner keys) moved to Settings › Agent access (LIN-3846).
 */

/* global escapeHtml, showModal, toast, api */

(function () {
  'use strict';

  // DOM references
  const generateBtn = document.getElementById('proxy-generate-btn');
  const scopeSelect = document.getElementById('proxy-scope-select');
  const promptOutput = document.getElementById('proxy-prompt-output');
  const generateFeedback = document.getElementById('proxy-generate-feedback');
  const createTokenForm = document.getElementById('proxy-create-token-form');
  const eventsList = document.querySelector('.proxy-events-list');
  const eventsCollapsible = document.getElementById('proxy-events-collapsible');
  const eventsCount = document.getElementById('proxy-events-count');
  const eventsPager = document.getElementById('proxy-events-pager');
  const healthPanel = document.getElementById('proxy-health-panel');
  const eventsPagerInfo = eventsPager?.querySelector('.proxy-events-pager-info');
  const eventsPrevBtn = eventsPager?.querySelector('.proxy-events-prev');
  const eventsNextBtn = eventsPager?.querySelector('.proxy-events-next');
  const refreshBtn = document.querySelector('.proxy-events-refresh');

  const urlKey = createTokenForm?.dataset?.urlKey || generateBtn?.closest('[data-url-key]')?.dataset?.urlKey;
  if (!urlKey) return;

  const apiBase = `/workspace/${encodeURIComponent(urlKey)}/api/proxy`;
  const baseUrl = window.location.origin;

  const EVENTS_PAGE_SIZE = 25;

  let eventsExpanded = false;
  let eventsOffset = 0;
  let eventsTotal = 0;

  // =========================================================================
  // Generate & Copy Agent Prompt
  // =========================================================================

  if (generateBtn) {
    generateBtn.addEventListener('click', async () => {
      generateBtn.disabled = true;
      showFeedback(generateFeedback, 'Generating...', false);

      try {
        const pick = scopeSelect?.value || 'read';
        // LIN-3491: "read-write + dispatch" is not a scope — it names a server
        // copy purpose. The client sends only that name; the server owns the
        // grants, label and lifetime, and never accepts a `grants` field.
        const wantsDispatch = pick === 'readWriteDispatch';
        const mintBody = wantsDispatch
          ? { purpose: 'agent' }
          : {
              label: 'agent-prompt',
              scope: pick,
              // LIN-376: the copied prompt carries a single-use bootstrap the agent
              // exchanges for a working token — never a standing token in the clipboard.
              bootstrap: true
            };
        // on401:false — failures surface via showFeedback (the catch), so a 401
        // must not redirect out from under the bespoke inline feedback.
        const data = await window.api(`${apiBase}/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(mintBody),
          on401: false
        });
        const token = data.token;

        // Scope and grants come from the mint response, never the picker.
        const prompt = buildAgentPrompt(token, data.scope, data.providerDisplayName || null, data.grants);
        promptOutput.textContent = prompt;
        promptOutput.classList.add('has-prompt');

        // Copy to clipboard
        try {
          await navigator.clipboard.writeText(prompt);
          showFeedback(generateFeedback, 'Copied!', false);
        } catch {
          showFeedback(generateFeedback, 'Generated (copy manually)', false);
        }

      } catch (err) {
        showFeedback(generateFeedback, mintErrorText(err, scopeSelect?.value === 'readWriteDispatch'), true);
      } finally {
        generateBtn.disabled = false;
      }
    });
  }

  // Click prompt output to copy
  if (promptOutput) {
    promptOutput.addEventListener('click', async () => {
      if (!promptOutput.classList.contains('has-prompt')) return;
      try {
        await navigator.clipboard.writeText(promptOutput.textContent);
        showFeedback(generateFeedback, 'Copied!', false);
      } catch {
        // Selection fallback
      }
    });
  }

  /**
   * LIN-3491: readable text for a failed mint. Only the dispatch option maps
   * through the driver-copy error map (the owner-only refusals are its point);
   * `read`/`readWrite` keep showing `err.message`, as before. Fallback order
   * mirrors getDriverCopyToken (public/common.js): the server's `code`, else
   * no HTTP status is NETWORK, else 429 is RATE_LIMITED, else UNKNOWN.
   */
  function mintErrorText(err, isDispatchPick) {
    const copy = isDispatchPick && window.ProxyToggle && window.ProxyToggle.DRIVER_COPY_ERROR_COPY;
    if (!copy) return err.message;
    const serverCode = (err && err.body && err.body.code) || null;
    let code;
    if (serverCode && Object.prototype.hasOwnProperty.call(copy, serverCode)) code = serverCode;
    else if (!(err && typeof err.status === 'number')) code = 'NETWORK';
    else code = err.status === 429 ? 'RATE_LIMITED' : 'UNKNOWN';
    return copy[code] || err.message;
  }

  /**
   * Compose the copy-to-clipboard agent prompt.
   *
   * LIN-2370: `providerDisplayName` is the DECLARED provider identity, carried on
   * the token-mint response (`POST .../api/proxy/tokens`). Reuses LIN-2354's
   * contract exactly — name the provider when one was declared, and OMIT the
   * clause entirely when it is null/absent. Never hedge ("unknown") and never
   * fall back to Linear: an unresolved workspace reading as "backed by Linear"
   * is precisely the defect this fixes, and this block is agent-facing, so a
   * human pastes it straight into a worker's context.
   *
   * @param {string} token - single-use bootstrap
   * @param {string} scope - 'read' | 'readWrite' (the minted token's, from the mint response)
   * @param {string|null} [providerDisplayName] - declared provider display name, or null
   * @param {string[]} [grants] - the minted token's grants (LIN-3491): `dispatch` switches
   *   the closing line from "cannot enqueue" to "can enqueue"
   */
  function buildAgentPrompt(token, scope, providerDisplayName, grants) {
    const instructionsUrl = `${baseUrl}/api/proxy/instructions`;
    const tokenUrl = `${baseUrl}/api/proxy/token`;
    const backing = providerDisplayName ? `; currently backed by ${providerDisplayName}` : '';
    const canDispatch = Array.isArray(grants) && grants.includes('dispatch');
    const enqueueNote = canDispatch
      ? ' It also holds the dispatch grant, so it can enqueue work (`POST /dispatch`, `/recommend-and-dispatch`, `/autopilot/kickoff`) that runs on the operator\'s machine.'
      : (scope === 'readWrite' ? ' It cannot enqueue work: the dispatch routes return 403 `DISPATCH_GRANT_REQUIRED`.' : '');
    return `You have access to a workspace API proxy (source-neutral${backing}). Use it to read${scope === 'readWrite' ? ' and modify' : ''} workspace issues, projects, and more.

This proxy is the workspace's own Harbour control-plane at ${baseUrl} — not a third-party service. An operator of this workspace generated this token for you; you do not have to take that on faith, because the exchange below returns live workspace data, which is itself the proof the channel is real. The token is scoped to this one workspace, is revocable, and every call is audit-logged.

First, exchange your single-use bootstrap token for a working token:

curl -X POST -H "Authorization: Bearer ${token}" ${tokenUrl}

That returns { "token": "<WORKING_TOKEN>", "scope": "${scope}", "expiresAt": "...", "notes": "…" }. The bootstrap is single-use — this exchange spends it — so use <WORKING_TOKEN> for everything from here on. Then fetch the full API documentation:

curl -H "Authorization: Bearer <WORKING_TOKEN>" ${instructionsUrl}

This will return all available endpoints with examples. Your token scope is: ${scope}.${enqueueNote}`;
  }

  // =========================================================================
  // Token Management
  // =========================================================================

  if (createTokenForm) {
    createTokenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(createTokenForm);
      const label = formData.get('label') || 'default';
      const scope = formData.get('scope') || 'read';

      try {
        // on401:false — failure is reported by the catch's toast; keep that path
        // rather than redirecting.
        const data = await window.api(`${apiBase}/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ label, scope }),
          on401: false
        });
        showTokenModal(data.token, data.label, data.scope);
        createTokenForm.reset();

      } catch (err) {
        toast('Failed to create token: ' + err.message, { type: 'error' });
      }
    });
  }

  // Hand-emits the shipped `.status-pill` dot markup (public/style.css) — the
  // client can't import the server `renderStatusPill` primitive, so it mirrors
  // its class contract per the Phase-B seam (swipe.js/swim.js precedent).
  function statusDotPill(state, label) {
    return `<span class="status-pill status-pill--dot status-pill--${state}">` +
      '<span class="status-pill__dot" aria-hidden="true"></span>' +
      `<span class="status-pill__label">${escapeHtml(String(label))}</span></span>`;
  }

  function showTokenModal(token, label, scope) {
    const bodyHtml = `
      <p>Save this token now — it cannot be retrieved later.</p>
      <div class="token-display">
        <span class="token-value">${escapeHtml(token)}</span>
        <button class="token-copy-btn">copy</button>
      </div>
      <div class="token-usage-hint">
        <div>Label: ${escapeHtml(label)} · Scope: ${escapeHtml(scope)}</div>
        <div class="token-usage-hint-code">
          <code>curl -H "Authorization: Bearer ${escapeHtml(token)}" ${escapeHtml(baseUrl)}/api/proxy/me</code>
        </div>
      </div>`;

    const { modal } = showModal({ className: 'token-modal', title: 'Token Created', bodyHtml });

    // Standardised on the dispatch copy-revert behaviour (was: stuck on "copied!").
    const copyBtn = modal.querySelector('.token-copy-btn');
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(token);
        copyBtn.textContent = 'copied!';
      } catch {
        copyBtn.textContent = 'failed';
      }
      setTimeout(() => { copyBtn.textContent = 'copy'; }, 1500);
    });
  }

  // =========================================================================
  // Credential Health (LIN-1586)
  //
  // Names the fault the Event Log can only spell out row by row: a token still
  // succeeding on workspace-free calls while its workspace-scoped calls report
  // `token_ownerless`. Not collapsible and loaded on init — the whole point is
  // that a human opening the page sees it without going looking.
  // =========================================================================

  async function loadCredentialHealth() {
    if (!healthPanel) return;

    let data;
    try {
      // on401:false — the inline empty state below reports failure; no redirect.
      data = await window.api(`${apiBase}/credential-health`, { on401: false });
    } catch {
      healthPanel.innerHTML = '<div class="proxy-health-empty">Failed to load credential health</div>';
      return;
    }

    const tokens = (data && data.tokens) || [];
    const dead = tokens.filter(t => t.verdict === 'credential_dead');
    const windowLabel = `last ${Math.round((data?.windowMs || 0) / 60000)} min`;

    if (!dead.length) {
      healthPanel.innerHTML =
        `<div class="proxy-health-empty">No credential faults in the ${escapeHtml(windowLabel)}</div>`;
      return;
    }

    healthPanel.innerHTML = dead.map(t => {
      const label = t.tokenLabel || t.tokenId;
      const counts = `${t.ownerlessCount} ownerless · ${t.okCount} ok · ${windowLabel}`;
      return `<div class="surface proxy-health-item" data-token-id="${escapeHtml(t.tokenId)}">
        <div class="proxy-health-info">
          <div class="proxy-health-label">${escapeHtml(label)} <span class="token-ownerless" title="This token's workspace-scoped calls report token_ownerless while its workspace-free calls still succeed. Re-issue it and update the consumer.">no owner · re-issue</span></div>
          <div class="proxy-health-meta">${escapeHtml(counts)}</div>
        </div>
        ${statusDotPill('error', 'credential dead')}
      </div>`;
    }).join('');
  }

  // =========================================================================
  // Event Log
  // =========================================================================

  async function loadEvents() {
    if (!eventsList) return;

    try {
      // on401:false — failure surfaces on the inline empty state below.
      const data = await window.api(`${apiBase}/events?limit=${EVENTS_PAGE_SIZE}&offset=${eventsOffset}`, { on401: false });
      eventsTotal = Number.isFinite(data.total) ? data.total : (data.items?.length || 0);
      if (eventsCount) {
        eventsCount.textContent = eventsTotal ? `(${eventsTotal})` : '(0)';
      }
      renderEvents(data.items || []);
      updateEventsPager();
    } catch {
      eventsList.innerHTML = '<div class="proxy-events-empty">Failed to load events</div>';
      if (eventsPager) eventsPager.hidden = true;
    }
  }

  function renderEvents(events) {
    if (!events.length) {
      eventsList.innerHTML = '<div class="proxy-events-empty">No proxy events yet</div>';
      return;
    }

    eventsList.innerHTML = events.map(e => {
      // Run-status dot pill (LIN-854): ok(2xx)→done, warn(3xx)→running, error(4xx+)→error.
      const state = e.status < 300 ? 'done' : e.status < 400 ? 'running' : 'error';
      const label = e.tokenLabel ? ` · ${escapeHtml(e.tokenLabel)}` : '';
      // LIN-1586: the reason already reaches the browser — listEvents projects
      // `note` and the route returns it unmodified — it was simply never drawn,
      // so a 503 row read as an anonymous failure. `note` is FREE TEXT (a reason
      // token from LIN-1540, an English sentence from LIN-961), hence escaped
      // like every other dynamic value in this template.
      const note = e.note
        ? `<span class="proxy-event-note" title="${escapeHtml(e.note)}">${escapeHtml(e.note)}</span>`
        : '';
      return `<div class="proxy-event-item">
        <span class="proxy-event-method">${escapeHtml(e.method)}</span>
        <span class="proxy-event-endpoint">${escapeHtml(e.endpoint)}</span>
        ${statusDotPill(state, e.status)}
        ${note}
        <span class="proxy-event-meta">${formatTimeAgo(e.timestamp)}${label}</span>
      </div>`;
    }).join('');
  }

  function updateEventsPager() {
    if (!eventsPager) return;

    if (eventsTotal <= EVENTS_PAGE_SIZE) {
      eventsPager.hidden = true;
      return;
    }

    eventsPager.hidden = false;

    const pageStart = eventsOffset + 1;
    const pageEnd = Math.min(eventsOffset + EVENTS_PAGE_SIZE, eventsTotal);
    if (eventsPagerInfo) {
      eventsPagerInfo.textContent = `${pageStart}–${pageEnd} of ${eventsTotal}`;
    }
    if (eventsPrevBtn) eventsPrevBtn.disabled = eventsOffset === 0;
    if (eventsNextBtn) eventsNextBtn.disabled = pageEnd >= eventsTotal;
  }

  async function refreshEventsCount() {
    if (!eventsCount) return;
    try {
      // on401:false — best-effort count; clears silently on failure (the catch).
      const data = await window.api(`${apiBase}/events?limit=1&offset=0`, { on401: false });
      const total = Number.isFinite(data.total) ? data.total : 0;
      eventsCount.textContent = total ? `(${total})` : '(0)';
    } catch {
      eventsCount.textContent = '';
    }
  }

  if (eventsPrevBtn) {
    eventsPrevBtn.addEventListener('click', () => {
      eventsOffset = Math.max(0, eventsOffset - EVENTS_PAGE_SIZE);
      loadEvents();
    });
  }
  if (eventsNextBtn) {
    eventsNextBtn.addEventListener('click', () => {
      eventsOffset += EVENTS_PAGE_SIZE;
      loadEvents();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', (e) => {
      // Prevent the surrounding <details> from toggling if the refresh sits
      // near the summary.
      e.stopPropagation();
      eventsOffset = 0;
      if (eventsExpanded) {
        loadEvents();
      } else {
        refreshEventsCount();
      }
    });
  }

  // =========================================================================
  // Collapsible Sections — lazy-load on first expand
  // =========================================================================

  if (eventsCollapsible) {
    eventsCollapsible.addEventListener('toggle', () => {
      if (eventsCollapsible.open && !eventsExpanded) {
        eventsExpanded = true;
        loadEvents();
      }
    });
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  function showFeedback(el, msg, isError) {
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('error', isError);
    if (!isError) {
      setTimeout(() => { el.textContent = ''; }, 3000);
    }
  }

  function formatTimeAgo(dateStr) {
    // Repointed onto the canonical window.relativeTime (LIN-539), retiring the
    // `Nd ago`-forever variant.
    return window.relativeTime(dateStr);
  }

  // =========================================================================
  // Init — fetch the event count only; the full list lazy-loads when expanded
  // =========================================================================
  refreshEventsCount();
  loadCredentialHealth();
})();
