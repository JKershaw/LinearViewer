/**
 * Proxy Page Client-Side Logic
 *
 * Handles: token generation, agent prompt creation, token CRUD, event log display.
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
  const tokenList = document.querySelector('.proxy-token-list');
  const tokensCollapsible = document.getElementById('proxy-tokens-collapsible');
  const tokensCount = document.getElementById('proxy-tokens-count');
  const eventsList = document.querySelector('.proxy-events-list');
  const eventsCollapsible = document.getElementById('proxy-events-collapsible');
  const eventsCount = document.getElementById('proxy-events-count');
  const eventsPager = document.getElementById('proxy-events-pager');
  const eventsPagerInfo = eventsPager?.querySelector('.proxy-events-pager-info');
  const eventsPrevBtn = eventsPager?.querySelector('.proxy-events-prev');
  const eventsNextBtn = eventsPager?.querySelector('.proxy-events-next');
  const refreshBtn = document.querySelector('.proxy-events-refresh');

  const urlKey = tokenList?.dataset?.urlKey || generateBtn?.closest('[data-url-key]')?.dataset?.urlKey;
  if (!urlKey) return;

  const apiBase = `/workspace/${encodeURIComponent(urlKey)}/api/proxy`;
  const baseUrl = window.location.origin;

  const TOKENS_INITIAL_VISIBLE = 5;
  const EVENTS_PAGE_SIZE = 25;

  let tokensExpanded = false;
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
        const scope = scopeSelect?.value || 'read';
        // on401:false — failures surface via showFeedback (the catch), so a 401
        // must not redirect out from under the bespoke inline feedback.
        const data = await window.api(`${apiBase}/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            label: 'agent-prompt',
            scope,
            singleUse: false
          }),
          on401: false
        });
        const token = data.token;

        const prompt = buildAgentPrompt(token, scope);
        promptOutput.textContent = prompt;
        promptOutput.classList.add('has-prompt');

        // Copy to clipboard
        try {
          await navigator.clipboard.writeText(prompt);
          showFeedback(generateFeedback, 'Copied!', false);
        } catch {
          showFeedback(generateFeedback, 'Generated (copy manually)', false);
        }

        // Refresh token list (only renders if expanded; always refreshes count)
        refreshTokenCount();
        if (tokensExpanded) loadTokens();
      } catch (err) {
        showFeedback(generateFeedback, err.message, true);
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

  function buildAgentPrompt(token, scope) {
    const instructionsUrl = `${baseUrl}/api/proxy/instructions`;
    return `You have access to a Linear API proxy. Use it to read${scope === 'readWrite' ? ' and modify' : ''} Linear issues, projects, and more.

To get started, fetch the full API documentation:

curl -H "Authorization: Bearer ${token}" ${instructionsUrl}

This will return all available endpoints with examples. Your token scope is: ${scope}.`;
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

        // Open the tokens section so the new token is visible, and refresh
        if (tokensCollapsible && !tokensCollapsible.open) {
          tokensCollapsible.open = true;
        }
        refreshTokenCount();
        loadTokens();
      } catch (err) {
        toast('Failed to create token: ' + err.message, { type: 'error' });
      }
    });
  }

  async function fetchTokens() {
    try {
      // on401:false — callers treat null as "failed to load"; never redirect.
      const data = await window.api(`${apiBase}/tokens`, { on401: false });
      return (data && data.tokens) || [];
    } catch {
      return null;
    }
  }

  async function refreshTokenCount() {
    if (!tokensCount) return;
    const tokens = await fetchTokens();
    if (tokens === null) {
      tokensCount.textContent = '';
      return;
    }
    tokensCount.textContent = tokens.length ? `(${tokens.length})` : '(0)';
  }

  async function loadTokens() {
    if (!tokenList) return;

    const tokens = await fetchTokens();
    if (tokens === null) {
      tokenList.innerHTML = '<div class="token-list-empty">Failed to load tokens</div>';
      return;
    }
    if (tokensCount) {
      tokensCount.textContent = tokens.length ? `(${tokens.length})` : '(0)';
    }
    renderTokenList(tokens);
  }

  function renderTokenList(tokens) {
    if (!tokens.length) {
      tokenList.innerHTML = '<div class="token-list-empty">No proxy tokens yet</div>';
      return;
    }

    const initial = tokens.slice(0, TOKENS_INITIAL_VISIBLE);
    const rest = tokens.slice(TOKENS_INITIAL_VISIBLE);

    const itemsHtml = initial.map(renderTokenItem).join('');
    const hiddenHtml = rest.length
      ? `<div class="token-items-extra" hidden>${rest.map(renderTokenItem).join('')}</div>
         <button type="button" class="action-btn token-show-more">show ${rest.length} more</button>`
      : '';

    tokenList.innerHTML = itemsHtml + hiddenHtml;

    // Revoke handlers
    tokenList.querySelectorAll('.token-revoke').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tokenId = btn.dataset.tokenId;
        if (!confirm('Revoke this token?')) return;

        try {
          // on401:false — failure is reported by the catch's toast, not a redirect.
          await window.api(`${apiBase}/tokens/${tokenId}`, { method: 'DELETE', on401: false });
          loadTokens();
        } catch (err) {
          toast('Failed to revoke: ' + err.message, { type: 'error' });
        }
      });
    });

    // Show-more handler
    const showMore = tokenList.querySelector('.token-show-more');
    if (showMore) {
      showMore.addEventListener('click', () => {
        const extra = tokenList.querySelector('.token-items-extra');
        if (extra) extra.hidden = false;
        showMore.remove();
      });
    }
  }

  function renderTokenItem(t) {
    const scopeBadge = t.scope === 'readWrite' ? ' [rw]' : ' [r]';
    const consumedBadge = t.consumed ? ' (consumed)' : '';
    const expiryBadge = renderExpiryBadge(t.expiresAt);
    const meta = [
      formatTimeAgo(t.createdAt),
      t.lastUsedAt ? `used ${formatTimeAgo(t.lastUsedAt)}` : 'never used'
    ].join(' \u00B7 ');

    return `<div class="token-item">
      <div class="token-info">
        <div class="token-label-text">${escapeHtml(t.label)}${scopeBadge}${consumedBadge}${expiryBadge}</div>
        <div class="token-meta">${escapeHtml(meta)}</div>
      </div>
      <button class="action-btn token-revoke" data-token-id="${escapeHtml(t.tokenId)}">revoke</button>
    </div>`;
  }

  function renderExpiryBadge(expiresAt) {
    if (!expiresAt) return '';
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (Number.isNaN(ms)) return '';
    if (ms <= 0) {
      return ' <span class="token-expiry expired">expired</span>';
    }
    const days = Math.floor(ms / (24 * 60 * 60 * 1000));
    const cls = days <= 7 ? 'warn' : 'ok';
    const text = days < 1 ? 'expires <1d' : `expires in ${days}d`;
    return ` <span class="token-expiry ${cls}">${text}</span>`;
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
      const statusClass = e.status < 300 ? 'status-ok' : e.status < 400 ? 'status-warn' : 'status-error';
      const label = e.tokenLabel ? ` · ${escapeHtml(e.tokenLabel)}` : '';
      return `<div class="proxy-event-item">
        <span class="proxy-event-method">${escapeHtml(e.method)}</span>
        <span class="proxy-event-endpoint">${escapeHtml(e.endpoint)}</span>
        <span class="proxy-event-status ${statusClass}">${e.status}</span>
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

  if (tokensCollapsible) {
    tokensCollapsible.addEventListener('toggle', () => {
      if (tokensCollapsible.open && !tokensExpanded) {
        tokensExpanded = true;
        loadTokens();
      }
    });
  }

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
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  // =========================================================================
  // Init — fetch counts only; full lists lazy-load when sections expand
  // =========================================================================
  refreshTokenCount();
  refreshEventsCount();
})();
